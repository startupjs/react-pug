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

const tempDirs: string[] = []

function createExampleEslint(cwd: string, fix: boolean): ESLint {
  return new ESLint({
    cwd,
    fix,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      ...neostandard({
        ts: true,
      }),
      {
        plugins: {
          'react-pug': reactPugPlugin as any,
        },
        processor: 'react-pug/pug-react',
      },
    ] as any,
  })
}

function createTempFixtureCopy(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'react-pug-eslint-fix-'))
  tempDirs.push(tempDir)
  cpSync(fixtureRoot, tempDir, {
    recursive: true,
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
  it('does not corrupt files and produces lint-clean output for an unformatted example fixture', async () => {
    const tempDir = createTempFixtureCopy()

    const firstPass = await createExampleEslint(tempDir, true).lintFiles(['src/**/*.{ts,tsx}'])
    await ESLint.outputFixes(firstPass)

    const secondPass = await createExampleEslint(tempDir, false).lintFiles(['src/**/*.{ts,tsx}'])
    const allMessages = secondPass.flatMap(result => result.messages)
    expect(allMessages).toEqual([])

    const fixedFiles = [
      'src/App.tsx',
      'src/Button.tsx',
      'src/Card.tsx',
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
  })
})
