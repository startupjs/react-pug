import { describe, expect, it } from 'vitest'
import { checkTypes, formatDiagnosticOutput, formatSummary, parseArgs, resolveCliTargets, resolvePrettyOption, resolveTsconfigPath, runCli } from '../../src/index.js'
import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const repoRoot = resolve(__dirname, '../../../..')
const require = createRequire(import.meta.url)
function lineAndColumnAt (text: string, offset: number) {
  let line = 1
  let column = 1
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

const loadPluginModule = async () => {
  const pluginDistPath = resolve(repoRoot, 'packages/typescript-plugin-react-pug/dist/plugin.js')
  if (!existsSync(pluginDistPath)) {
    execSync('npm run build:plugin', { cwd: repoRoot, stdio: 'pipe' })
  }

  let plugin
  try {
    plugin = require(pluginDistPath)
  } catch (error: any) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error
    execSync('npm run build:plugin', { cwd: repoRoot, stdio: 'pipe' })
    plugin = require(pluginDistPath)
  }

  return plugin.default ?? plugin
}
const loadTypeScriptModule = async () => ts

describe('@react-pug/check-types', () => {
  it('parses CLI args', () => {
    expect(parseArgs(['src/App.tsx', 'src/Button.tsx', '--project', 'example', '--tagFunction', 'view', '--injectCssxjsTypes', 'force']))
      .toEqual({
        help: false,
        positionals: ['src/App.tsx', 'src/Button.tsx'],
        projectPath: 'example',
        tagFunction: 'view',
        injectCssxjsTypes: 'force',
        pretty: 'auto'
      })
  })

  it('parses pretty flag values', () => {
    expect(parseArgs(['--pretty'])).toMatchObject({ pretty: true })
    expect(parseArgs(['--pretty', 'false'])).toMatchObject({ pretty: false })
  })

  it('treats a single positional directory as the project root for backward compatibility', () => {
    expect(resolveCliTargets(repoRoot, ['example'], undefined)).toEqual({
      projectDir: 'example',
      filePaths: []
    })
  })

  it('treats positional paths as file filters by default', () => {
    expect(resolveCliTargets(repoRoot, ['example/src/App.tsx', 'example/src/Button.tsx'], undefined)).toEqual({
      projectDir: '.',
      filePaths: ['example/src/App.tsx', 'example/src/Button.tsx']
    })
  })

  it('finds the nearest tsconfig by walking upward', () => {
    const found = resolveTsconfigPath(ts, repoRoot, 'example/src')
    expect(found).toBe(resolve(repoRoot, 'example/tsconfig.json'))
  })

  it('checks the example project successfully through the CLI API', async () => {
    const stdout = []
    const stderr = []
    const exitCode = await runCli(['example'], {
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
      cwd: repoRoot,
      loadPluginModule,
      loadTypeScriptModule
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('No TypeScript errors (with pug plugin)')
  })


  it('checks selected files inside the project context', async () => {
    const projectRoot = resolve(repoRoot, 'example')
    const result = await checkTypes({
      cwd: projectRoot,
      filePaths: ['src/App.tsx'],
      loadPluginModule,
      loadTypeScriptModule
    })

    expect(result.ok).toBe(true)
    expect(result.fileCount).toBe(1)
    expect(result.selectedFiles).toEqual([resolve(projectRoot, 'src/App.tsx')])
  })

  it('reports exact pug diagnostic positions for the broken example-unformatted fixture', async () => {
    const projectRoot = resolve(repoRoot, 'test/fixtures/example-unformatted')
    const filePath = resolve(projectRoot, 'src/TypeScriptErrorsInPug.tsx')
    const text = readFileSync(filePath, 'utf8')

    const result = await checkTypes({
      cwd: projectRoot,
      filePaths: ['src/TypeScriptErrorsInPug.tsx'],
      loadPluginModule,
      loadTypeScriptModule
    })

    expect(result.ok).toBe(false)
    expect(result.fileCount).toBe(1)

    const expected = [
      ['missingTitleValue', 2304],
      ['missingInlineHandler', 2304],
      ['missingInterpolationValue', 2304],
      ['missingConditionFlag', 2304],
      ['missingItemsSource', 2304]
    ] as const

    for (const [name, code] of expected) {
      const start = text.indexOf(name)
      expect(start).toBeGreaterThanOrEqual(0)
      const { line, column } = lineAndColumnAt(text, start)

      const diag = result.errors.find((item: any) => item.code === code && String(item.messageText).includes(name))
      expect(diag, `Expected diagnostic for ${name}`).toBeDefined()
      expect(diag!.file?.fileName).toBe(filePath)
      expect(diag!.start).toBe(start)
      expect(diag!.length).toBe(name.length)

      const formatted = result.formattedErrors.find((lineText: string) => lineText.includes(name))
      expect(formatted).toContain(`src/TypeScriptErrorsInPug.tsx:${line}:${column} - error TS${code}:`)
    }

    const wrongHandler = result.errors.find((item: any) =>
      item.code === 2322
      && item.start === text.indexOf('onClick')
      && item.length === 'onClick'.length)
    expect(wrongHandler).toBeDefined()
    expect(wrongHandler!.file?.fileName).toBe(filePath)
    expect(wrongHandler!.start).toBe(text.indexOf('onClick'))
    expect(wrongHandler!.length).toBe('onClick'.length)
  })

  it('formats summary close to tsc style', () => {
    expect(formatSummary(8, 2)).toBe('Found 8 TypeScript errors in 2 files.')
    expect(formatSummary(1, 0)).toBe('Found 1 TypeScript error.')
  })

  it('resolves pretty output mode from flag and tty', () => {
    expect(resolvePrettyOption('auto', false)).toBe(false)
    expect(resolvePrettyOption('auto', true)).toBe(true)
    expect(resolvePrettyOption(true, false)).toBe(true)
    expect(resolvePrettyOption(false, true)).toBe(false)
  })

  it('adds ansi styling only in pretty mode', () => {
    const line = 'src/App.tsx:1:1 - error TS2322: Broken type'
    expect(formatDiagnosticOutput(line, false)).toBe(line)
    expect(formatDiagnosticOutput(line, true)).toContain('\u001b[')
  })
})
