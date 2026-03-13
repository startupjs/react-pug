import { describe, expect, it } from 'vitest'
import { checkTypes, formatDiagnosticOutput, formatSummary, parseArgs, resolveCliTargets, resolvePrettyOption, resolveTsconfigPath, runCli } from '../../src/index.js'
import ts from 'typescript'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const repoRoot = resolve(__dirname, '../../../..')
const require = createRequire(import.meta.url)
const loadPluginModule = async () => {
  const plugin = require(resolve(repoRoot, 'packages/typescript-plugin-react-pug/dist/plugin.js'))
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
