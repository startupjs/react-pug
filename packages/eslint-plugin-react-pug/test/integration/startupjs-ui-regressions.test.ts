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
          'react/jsx-boolean-value': 'error',
        },
        processor: 'react-pug/react-pug',
      },
    ] as any,
  })
}

describe('startupjs-ui regressions', () => {
  it('does not report false indent or Provider(value=true) diagnostics for startupjs-ui repros', async () => {
    const files = [
      resolve(fixtureRoot, 'StartupjsUiDialogsReadme.js'),
      resolve(fixtureRoot, 'StartupjsUiDraggableReadme.js'),
      resolve(fixtureRoot, 'StartupjsUiTypeCell.js'),
      resolve(fixtureRoot, 'StartupjsUiWrapInput.tsx'),
      resolve(fixtureRoot, 'StartupjsUiMdxComponents.js'),
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
      'StartupjsUiDraggableReadme.js',
      'StartupjsUiMdxComponents.js',
      'StartupjsUiTypeCell.js',
      'StartupjsUiWrapInput.tsx',
    ]) {
      const filePath = resolve(fixtureRoot, relativePath)
      const input = readFileSync(filePath, 'utf8')
      const [result] = await createStartupjsUiStyleEslint(true).lintText(input, { filePath })
      expect(result.output ?? input).toBe(input)
    }
  })
})
