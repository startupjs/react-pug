import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import neostandard from 'neostandard'
import reactPugPlugin from '../../src/index'

const repoRoot = resolve(__dirname, '../../../..')
const fixtureRoot = resolve(repoRoot, 'test/fixtures/example-unformatted')
const diagnosticsSnapshotRoot = resolve(fixtureRoot, 'snapshots/diagnostics')
const reactHooksStubPlugin = {
  rules: {
    'rules-of-hooks': {
      meta: { schema: [] },
      create: () => ({}),
    },
  },
}

function createExampleEslint(): ESLint {
  return new ESLint({
    cwd: fixtureRoot,
    fix: false,
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
          'react-hooks': reactHooksStubPlugin as any,
          'react-pug': reactPugPlugin as any,
        },
        processor: 'react-pug/react-pug',
      },
    ] as any,
  })
}

function formatMessagesForSnapshot(messages: Awaited<ReturnType<ESLint['lintFiles']>>[number]['messages']): string {
  if (messages.length === 0) return 'No diagnostics.\n'

  const lines = messages.map(message => {
    const line = message.line ?? 0
    const column = message.column ?? 0
    const severity = message.severity === 2 ? 'error' : 'warning'
    const ruleId = message.ruleId ?? '(no rule)'
    return `${line}:${column}  ${severity}  ${ruleId}  ${message.message}`
  })

  return `${lines.join('\n')}\n`
}

describe('eslint diagnostics for example-unformatted fixture', () => {
  it('snapshots pre-fix diagnostics per file and suppresses synthetic style-call warnings', async () => {
    const results = await createExampleEslint().lintFiles(['src/**/*.{js,jsx,ts,tsx}'])

    for (const result of results) {
      const relativePath = result.filePath.replace(/.*\/src\//, 'src/')
      await expect(formatMessagesForSnapshot(result.messages))
        .toMatchFileSnapshot(resolve(diagnosticsSnapshotRoot, `${relativePath}.txt`))
    }

    const modalScreen = results.find(result => result.filePath.endsWith('/src/ModalScreen.tsx'))
    expect(modalScreen?.messages.some(message => message.ruleId === 'no-unused-expressions')).toBe(false)

    const startupjsTabThree = results.find(result => result.filePath.endsWith('/src/StartupjsTabThree.js'))
    expect(startupjsTabThree?.messages.some(message => message.ruleId === '@stylistic/jsx-indent')).toBe(false)

    const startupjsLogin = results.find(result => result.filePath.endsWith('/src/StartupjsLogin.js'))
    expect(startupjsLogin?.messages.some(message => message.ruleId === '@stylistic/jsx-indent')).toBe(false)

    const startupjsUiDialogsReadme = results.find(result => result.filePath.endsWith('/src/StartupjsUiDialogsReadme.js'))
    expect(startupjsUiDialogsReadme?.messages.some(message => message.ruleId === 'react/jsx-fragments')).toBe(false)

    const startupjsUiDraggableReadme = results.find(result => result.filePath.endsWith('/src/StartupjsUiDraggableReadme.js'))
    expect(startupjsUiDraggableReadme?.messages.some(message => message.ruleId === 'no-unneeded-ternary')).toBe(false)

    const startupjsUiTypeCell = results.find(result => result.filePath.endsWith('/src/StartupjsUiTypeCell.js'))
    expect(startupjsUiTypeCell?.messages.some(message => message.ruleId === '@stylistic/no-multi-spaces')).toBe(false)

    const startupjsUiPrompt = results.find(result => result.filePath.endsWith('/src/StartupjsUiPrompt.tsx'))
    expect(startupjsUiPrompt?.messages.some(message => message.ruleId === '@stylistic/indent')).toBe(false)

    const startupjsUiMdxComponents = results.find(result => result.filePath.endsWith('/src/StartupjsUiMdxComponents.js'))
    expect(startupjsUiMdxComponents?.messages.map(message => message.ruleId)).toEqual([
      'react/jsx-boolean-value',
      'react/jsx-boolean-value',
    ])
  }, 30000)
})
