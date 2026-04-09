import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import neostandard from 'neostandard'
import reactPlugin from 'eslint-plugin-react'
import reactPugPlugin from '../../src/index'

const repoRoot = resolve(__dirname, '../../../..')
const fixtureRoot = resolve(repoRoot, 'test/fixtures/example-unformatted/src')
const reactHooksStubPlugin = {
  rules: {
    'rules-of-hooks': {
      meta: { schema: [] },
      create: () => ({}),
    },
    'exhaustive-deps': {
      meta: { schema: [] },
      create: () => ({}),
    },
  },
}

function createStartupjsUiStyleEslint(fix: boolean): ESLint {
  return new ESLint({
    cwd: repoRoot,
    fix,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      {
        linterOptions: {
          reportUnusedDisableDirectives: 'off',
        },
      },
      ...neostandard({
        ts: true,
      }),
      {
        plugins: {
          react: reactPlugin as any,
          'react-hooks': reactHooksStubPlugin as any,
          'react-pug': reactPugPlugin as any,
        },
        rules: {
          '@stylistic/jsx-indent': ['error', 2, {
            checkAttributes: false,
            indentLogicalExpressions: true,
          }],
          '@stylistic/jsx-wrap-multilines': ['error', {
            declaration: 'parens-new-line',
            assignment: 'parens-new-line',
            return: 'parens-new-line',
            arrow: 'ignore',
            condition: 'ignore',
            logical: 'ignore',
            prop: 'ignore',
          }],
          'react/jsx-boolean-value': 'error',
        },
        processor: 'react-pug/react-pug',
      },
    ] as any,
  })
}

describe('startupjs-ui regressions', () => {
  it('does not report false processor diagnostics for startupjs-ui repros', async () => {
    const files = [
      resolve(fixtureRoot, 'StartupjsUiDialogsReadme.js'),
      resolve(fixtureRoot, 'StartupjsUiDropdown.tsx'),
      resolve(fixtureRoot, 'StartupjsUiDraggableReadme.js'),
      resolve(fixtureRoot, 'StartupjsUiTypeCell.js'),
      resolve(fixtureRoot, 'StartupjsUiTextInput.tsx'),
      resolve(fixtureRoot, 'StartupjsUiWrapInput.tsx'),
      resolve(fixtureRoot, 'StartupjsUiMdxComponents.js'),
      resolve(fixtureRoot, 'StartupjsUiMultiSelect.tsx'),
      resolve(fixtureRoot, 'StartupjsUiPrompt.tsx'),
    ]

    const results = await createStartupjsUiStyleEslint(false).lintFiles(files)
    const messages = results.flatMap(result => (
      result.messages.map(message => ({
        filePath: result.filePath,
        ruleId: message.ruleId,
        line: message.line,
        column: message.column,
        message: message.message,
      }))
    ))

    expect(messages).toEqual([])
  })

  it('still reports jsx-boolean-value for intrinsic boolean attrs inside pug', async () => {
    const filePath = resolve(repoRoot, 'intrinsic-boolean-pug.js')
    const input = [
      "import { pug } from 'startupjs'",
      '',
      'export default function Demo () {',
      '  return pug`',
      '    button(disabled=true) Click',
      '  `',
      '}',
      '',
    ].join('\n')

    const [result] = await createStartupjsUiStyleEslint(false).lintText(input, { filePath })
    const booleanDiagnostic = result.messages.find(message => message.ruleId === 'react/jsx-boolean-value')

    expect(booleanDiagnostic).toBeTruthy()
    expect(booleanDiagnostic?.line).toBe(5)
    expect(booleanDiagnostic?.column).toBe(12)
  })

  it('does not rewrite startupjs-ui repros under eslint --fix', async () => {
    for (const relativePath of [
      'StartupjsUiDialogsReadme.js',
      'StartupjsUiDropdown.tsx',
      'StartupjsUiDraggableReadme.js',
      'StartupjsUiMdxComponents.js',
      'StartupjsUiPrompt.tsx',
      'StartupjsUiTextInput.tsx',
      'StartupjsUiTypeCell.js',
      'StartupjsUiWrapInput.tsx',
      'StartupjsUiMultiSelect.tsx',
    ]) {
      const filePath = resolve(fixtureRoot, relativePath)
      const input = readFileSync(filePath, 'utf8')
      const [result] = await createStartupjsUiStyleEslint(true).lintText(input, { filePath })
      expect(result.output ?? input).toBe(input)
    }
  })
})
