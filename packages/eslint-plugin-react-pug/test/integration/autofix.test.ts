import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import neostandard from 'neostandard'
import reactPugPlugin from '../../src/index'

const repoRoot = resolve(__dirname, '../../../..')
const fixtureRoot = resolve(repoRoot, 'test/fixtures/example-unformatted')
const snapshotRoot = resolve(fixtureRoot, 'snapshots/fixed')
const postFixDiagnosticsSnapshot = resolve(fixtureRoot, 'snapshots/post-fix-diagnostics.json')
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

const tempDirs: string[] = []

function createExampleEslint(cwd: string, fix: boolean): ESLint {
  return new ESLint({
    cwd,
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
          'react-hooks': reactHooksStubPlugin as any,
          'react-pug': reactPugPlugin as any,
        },
        processor: 'react-pug/react-pug',
      },
    ] as any,
  })
}

function createInlineEslint(fix: boolean): ESLint {
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
          'react-hooks': reactHooksStubPlugin as any,
          'react-pug': reactPugPlugin as any,
        },
        processor: 'react-pug/react-pug',
      },
    ] as any,
  })
}

function createTempFixtureCopy(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'react-pug-eslint-fix-'))
  tempDirs.push(tempDir)
  cpSync(fixtureRoot, tempDir, {
    recursive: true,
    filter: source => {
      const relative = source.slice(fixtureRoot.length).replace(/^\/+/, '')
      if (relative === '') return true
      if (relative === 'node_modules' || relative.startsWith('node_modules/')) return false
      if (relative === 'snapshots' || relative.startsWith('snapshots/')) return false
      return true
    },
  })
  return tempDir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

describe('eslint --fix integration for react-pug processor', () => {
  it('applies multiple autofixes within a single embedded expression site without corrupting the site text', async () => {
    const filePath = resolve(repoRoot, 'embedded-autofix-multi-fix.js')
    const input = [
      "import { pug } from 'startupjs'",
      'const showCompleted = true',
      '',
      'const view = pug`',
      '  Button(',
      '    label=showCompleted ? "Hide Done" : "Show Done"',
      '  ) Save',
      '`',
      '',
    ].join('\n')

    const [firstPass] = await createInlineEslint(true).lintText(input, { filePath })
    const output = firstPass.output ?? input

    expect(output).toContain("label=showCompleted ? 'Hide Done' : 'Show Done'")
    expect(output).not.toContain(`'Hide Done'e"`)

    const [secondPass] = await createInlineEslint(false).lintText(output, { filePath })
    expect(secondPass.messages.some(message => message.ruleId === '@stylistic/quotes')).toBe(false)
  })

  it('applies source-faithful autofixes across embedded expression-site kinds', async () => {
    const filePath = resolve(repoRoot, 'embedded-autofix-matrix.js')
    const input = [
      "import { pug } from 'startupjs'",
      "const label = 'label'",
      "const suffix = 'suffix'",
      '',
      'const view = pug`',
      '  Button(',
      '    label=label+suffix',
      '    onClick=() => { return label+suffix }',
      '  ) Save',
      '  p= label+suffix',
      '  p Hello #{label+suffix}',
      '  Span.text= ${label+suffix}',
      '`',
      '',
    ].join('\n')

    const [firstPass] = await createInlineEslint(true).lintText(input, { filePath })
    const output = firstPass.output ?? input

    expect(output).toContain('label=label + suffix')
    expect(output).toContain('return label + suffix')
    expect(output).toContain('p= label + suffix')
    expect(output).toContain('p Hello #{label + suffix}')
    expect(output).toContain('Span.text= ${label + suffix}')

    const [secondPass] = await createInlineEslint(false).lintText(output, { filePath })
    expect(secondPass.messages.some(message => message.ruleId === '@stylistic/space-infix-ops')).toBe(false)
  })

  it('does not corrupt files and preserves only the expected non-fixable diagnostics for an unformatted example fixture', async () => {
    const tempDir = createTempFixtureCopy()

    const firstPass = await createExampleEslint(tempDir, true).lintFiles(['src/**/*.{js,jsx,ts,tsx}'])
    await ESLint.outputFixes(firstPass)

    const secondPass = await createExampleEslint(tempDir, false).lintFiles(['src/**/*.{js,jsx,ts,tsx}'])
    const allMessages = secondPass.flatMap(result => (
      result.messages.map(message => ({
        filePath: result.filePath.replace(/.*\/src\//, 'src/'),
        ruleId: message.ruleId,
        line: message.line,
        column: message.column,
        message: message.message,
      }))
    ))
    const allowedRules = new Set(['@typescript-eslint/no-unused-vars'])
    expect(allMessages.every(message => (
      String(message.ruleId).startsWith('@stylistic/')
      || allowedRules.has(String(message.ruleId))
    ))).toBe(true)
    await expect(JSON.stringify(allMessages, null, 2) + '\n').toMatchFileSnapshot(postFixDiagnosticsSnapshot)

    const fixedFiles = [
      'src/App.tsx',
      'src/Button.tsx',
      'src/Card.tsx',
      'src/ModalScreen.tsx',
      'src/RootLayout.tsx',
      'src/StartupjsUiAvatar.tsx',
      'src/StartupjsUiDialogsReadme.js',
      'src/StartupjsUiDropdown.tsx',
      'src/StartupjsUiDraggableReadme.js',
      'src/StartupjsLogin.js',
      'src/StartupjsUiMdxComponents.js',
      'src/StartupjsUiMultiSelect.tsx',
      'src/StartupjsUiPrompt.tsx',
      'src/StartupjsUiTextInput.tsx',
      'src/StartupjsUiTypeCell.js',
      'src/StartupjsUiWrapInput.tsx',
      'src/StartupjsTabThree.js',
      'src/TypeScriptErrorsInPug.tsx',
      'src/TypeScriptInPug.tsx',
      'src/helpers.ts',
    ]

    for (const relativePath of fixedFiles) {
      const absolutePath = resolve(tempDir, relativePath)
      const text = readFileSync(absolutePath, 'utf8')
      await expect(text).toMatchFileSnapshot(resolve(snapshotRoot, relativePath))
    }

    const fixedApp = readFileSync(resolve(tempDir, 'src/App.tsx'), 'utf8')
    expect(fixedApp).toContain('return pug`')
    expect(fixedApp).toContain('style')
    expect(fixedApp).toContain('Button(onClick=handleReset')

    const fixedTypeScriptInPug = readFileSync(resolve(tempDir, 'src/TypeScriptInPug.tsx'), 'utf8')
    expect(fixedTypeScriptInPug).toContain('title = maybeTitle as string')
    expect(fixedTypeScriptInPug).toContain("config.title satisfies CardConfig['title']")
    expect(fixedTypeScriptInPug).toContain('Card(title = item!)')
  }, 60000)
})
