import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function printUsage (stdout = console.log) {
  stdout('Usage: npx @react-pug/check-types [files...] [--project <tsconfig-path>]')
  stdout('       [--tagFunction <name>] [--injectCssxjsTypes <never|auto|force>] [--pretty [true|false]]')
  stdout('')
  stdout('Examples:')
  stdout('  npx @react-pug/check-types')
  stdout('  npx @react-pug/check-types src/App.tsx src/Button.tsx')
  stdout('  npx @react-pug/check-types --project example example/src/App.tsx')
  stdout('  npx @react-pug/check-types example')
}

export function parseArgs (argv) {
  const positionals = []
  let projectPath
  let tagFunction = 'pug'
  let injectCssxjsTypes = 'auto'
  let pretty = 'auto'

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--project' || arg === '-p') {
      projectPath = argv[i + 1]
      i += 1
      continue
    }
    if (arg === '--tagFunction') {
      tagFunction = argv[i + 1] ?? tagFunction
      i += 1
      continue
    }
    if (arg === '--injectCssxjsTypes') {
      injectCssxjsTypes = argv[i + 1] ?? injectCssxjsTypes
      i += 1
      continue
    }
    if (arg === '--pretty') {
      const next = argv[i + 1]
      if (next === 'true' || next === 'false') {
        pretty = next === 'true'
        i += 1
      } else {
        pretty = true
      }
      continue
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!['never', 'auto', 'force'].includes(injectCssxjsTypes)) {
    throw new Error(`Invalid --injectCssxjsTypes value: ${injectCssxjsTypes}`)
  }

  return { help: false, positionals, projectPath, tagFunction, injectCssxjsTypes, pretty }
}

function formatWithPretty (text, code) {
  return `\u001b[${code}m${text}\u001b[0m`
}

export function resolvePrettyOption (pretty, isTTY = false) {
  if (pretty === 'auto') return Boolean(isTTY)
  return Boolean(pretty)
}

export function formatSummary (errorCount, fileCount) {
  if (fileCount > 0) {
    return `Found ${errorCount} TypeScript error${errorCount === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}.`
  }
  return `Found ${errorCount} TypeScript error${errorCount === 1 ? '' : 's'}.`
}

export function resolveCliTargets (cwd, positionals, explicitProjectPath) {
  if (explicitProjectPath) {
    return { projectDir: '.', filePaths: positionals }
  }

  if (positionals.length === 1) {
    const candidate = path.resolve(cwd, positionals[0])
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return { projectDir: positionals[0], filePaths: [] }
    }
  }

  return { projectDir: '.', filePaths: positionals }
}

function loadModuleFromLocations (specifier, locations) {
  let lastError
  for (const location of locations) {
    try {
      const resolved = require.resolve(specifier, { paths: [location] })
      const mod = require(resolved)
      return mod.default ?? mod
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`Cannot load ${specifier}.\n${String(lastError)}`)
}

export function loadTypeScript (projectDir, cwd = process.cwd()) {
  return loadModuleFromLocations('typescript', [projectDir, cwd, packageDir])
}

export function loadPlugin (projectDir, cwd = process.cwd()) {
  return loadModuleFromLocations('@react-pug/typescript-plugin-react-pug', [projectDir, cwd, packageDir])
}

export function resolveTsconfigPath (ts, cwd, projectDirArg = '.', explicitProjectPath) {
  if (explicitProjectPath) {
    const resolved = path.resolve(cwd, explicitProjectPath)
    if (ts.sys.directoryExists?.(resolved)) {
      const found = ts.findConfigFile(resolved, ts.sys.fileExists, 'tsconfig.json')
      if (!found) throw new Error(`Cannot find tsconfig.json inside ${resolved}`)
      return found
    }
    return resolved
  }

  const searchDir = path.resolve(cwd, projectDirArg)
  const found = ts.findConfigFile(searchDir, ts.sys.fileExists, 'tsconfig.json')
  if (!found) {
    throw new Error(`Cannot find tsconfig.json from ${searchDir}`)
  }
  return found
}

export function createLanguageServiceFromTsconfig ({ ts, tsconfigPath, pluginInit, pluginConfig }) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    return { configErrors: [configFile.error], parsedConfig: undefined, ls: undefined }
  }

  const configDir = path.dirname(tsconfigPath)
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir)

  const host = {
    getScriptFileNames: () => parsedConfig.fileNames,
    getScriptVersion: fileName => String(ts.sys.getModifiedTime?.(fileName)?.valueOf() ?? 0),
    getScriptSnapshot: fileName => {
      const text = ts.sys.readFile(fileName)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => configDir,
    getCompilationSettings: () => parsedConfig.options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine
  }

  const baseLs = ts.createLanguageService(host, ts.createDocumentRegistry())
  const pluginModule = pluginInit({ typescript: ts })
  const proxiedLs = pluginModule.create({
    languageServiceHost: host,
    languageService: baseLs,
    project: {
      getCurrentDirectory: () => configDir,
      projectService: {
        logger: {
          info: () => {}
        }
      }
    },
    serverHost: ts.sys,
    config: pluginConfig
  })

  return { configErrors: parsedConfig.errors, parsedConfig, ls: proxiedLs }
}

export function collectDiagnostics (ts, ls, parsedConfig, selectedFiles) {
  const diagnostics = []
  const program = ls.getProgram?.()
  if (program) {
    diagnostics.push(...program.getOptionsDiagnostics())
    diagnostics.push(...program.getGlobalDiagnostics())
  }
  const filesToCheck = selectedFiles?.length ? selectedFiles : parsedConfig.fileNames
  for (const fileName of filesToCheck) {
    diagnostics.push(...ls.getSyntacticDiagnostics(fileName))
    diagnostics.push(...ls.getSemanticDiagnostics(fileName))
  }
  return diagnostics
}

export function uniqDiagnostics (ts, diagnostics) {
  const out = []
  const seen = new Set()
  for (const diag of diagnostics) {
    const key = [
      diag.file?.fileName ?? '',
      diag.start ?? '',
      diag.length ?? '',
      diag.code ?? '',
      ts.flattenDiagnosticMessageText(diag.messageText, '\n')
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(diag)
  }
  return out
}

function computeLineAndColumn (text, offset) {
  const safeOffset = Math.max(0, Math.min(offset, text.length))
  let line = 0
  let lineStart = 0
  for (let i = 0; i < safeOffset; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lineStart = i + 1
    }
  }
  return { line: line + 1, column: safeOffset - lineStart + 1 }
}

export function formatDiagnostic (ts, diag, cwd, fileTextCache) {
  const category = ts.DiagnosticCategory[diag.category]?.toLowerCase() ?? 'unknown'
  const code = `TS${diag.code}`
  const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n')

  if (!diag.file || diag.start === undefined) {
    return `${category} ${code}: ${message}`
  }

  const filePath = diag.file.fileName
  const file = path.relative(cwd, filePath) || filePath

  if (!fileTextCache.has(filePath)) {
    fileTextCache.set(filePath, ts.sys.readFile(filePath) ?? null)
  }
  const text = fileTextCache.get(filePath)
  if (typeof text === 'string') {
    const pos = computeLineAndColumn(text, diag.start)
    return `${file}:${pos.line}:${pos.column} - ${category} ${code}: ${message}`
  }

  const pos = diag.file.getLineAndCharacterOfPosition(diag.start)
  return `${file}:${pos.line + 1}:${pos.character + 1} - ${category} ${code}: ${message}`
}

export function formatDiagnosticOutput (line, pretty) {
  if (!pretty) return line
  return line
    .replace(/(^|\s)(error)(\s+TS\d+:)/, (_, prefix, word, suffix) => `${prefix}${formatWithPretty(word, '31;1')}${formatWithPretty(suffix.trimStart(), '36;1')}`)
    .replace(/^(.*?:\d+:\d+)/, match => formatWithPretty(match, '90'))
}

function normalizeFiles (cwd, configDir, filePaths) {
  return filePaths.map(filePath => {
    const resolved = path.resolve(cwd, filePath)
    const normalized = path.normalize(resolved)
    return path.isAbsolute(normalized) ? normalized : path.resolve(configDir, normalized)
  })
}

export async function checkTypes ({
  cwd = process.cwd(),
  projectDir = '.',
  projectPath,
  filePaths = [],
  tagFunction = 'pug',
  injectCssxjsTypes = 'auto',
  loadPluginModule,
  loadTypeScriptModule
} = {}) {
  const resolvedProjectDir = path.resolve(cwd, projectDir)
  const ts = loadTypeScriptModule ? await loadTypeScriptModule(resolvedProjectDir, cwd) : loadTypeScript(resolvedProjectDir, cwd)
  const pluginInit = loadPluginModule ? await loadPluginModule(resolvedProjectDir, cwd) : loadPlugin(resolvedProjectDir, cwd)
  const tsconfigPath = resolveTsconfigPath(ts, cwd, projectDir, projectPath)

  const { configErrors, parsedConfig, ls } = createLanguageServiceFromTsconfig({
    ts,
    tsconfigPath,
    pluginInit,
    pluginConfig: {
      enabled: true,
      diagnostics: { enabled: true },
      tagFunction,
      injectCssxjsTypes
    }
  })

  if (!parsedConfig || !ls) {
    const diagnostics = uniqDiagnostics(ts, configErrors)
    const fileTextCache = new Map()
    const formattedErrors = diagnostics.map(diag => formatDiagnostic(ts, diag, cwd, fileTextCache))
    return {
      ok: false,
      exitCode: 1,
      ts,
      parsedConfig: null,
      diagnostics,
      errors: diagnostics,
      formattedErrors,
      fileCount: 0,
      selectedFiles: [],
      errorFileCount: 0,
      tsconfigPath
    }
  }

  const configDir = path.dirname(tsconfigPath)
  const selectedFiles = filePaths.length ? normalizeFiles(cwd, configDir, filePaths) : []
  const projectFiles = new Set(parsedConfig.fileNames.map(fileName => path.normalize(fileName)))
  const missingFiles = selectedFiles.filter(fileName => !projectFiles.has(path.normalize(fileName)))

  const diagnostics = uniqDiagnostics(ts, [
    ...configErrors,
    ...collectDiagnostics(ts, ls, parsedConfig, selectedFiles)
  ]).sort((a, b) => {
    const af = a.file?.fileName ?? ''
    const bf = b.file?.fileName ?? ''
    if (af !== bf) return af.localeCompare(bf)
    const as = a.start ?? -1
    const bs = b.start ?? -1
    if (as !== bs) return as - bs
    return a.code - b.code
  })

  const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error)
  const fileTextCache = new Map()
  const formattedErrors = [
    ...errors.map(diag => formatDiagnostic(ts, diag, cwd, fileTextCache)),
    ...missingFiles.map(fileName => `error CHECK0001: File is not part of the resolved TypeScript project: ${path.relative(cwd, fileName) || fileName}`)
  ]
  const errorFileCount = new Set(errors.map(diag => diag.file?.fileName).filter(Boolean)).size

  return {
    ok: errors.length === 0 && missingFiles.length === 0,
    exitCode: errors.length === 0 && missingFiles.length === 0 ? 0 : 1,
    ts,
    parsedConfig,
    diagnostics,
    errors,
    formattedErrors,
    fileCount: selectedFiles.length || parsedConfig.fileNames.length,
    selectedFiles,
    missingFiles,
    errorFileCount,
    tsconfigPath
  }
}

export async function runCli (argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? console.log
  const stderr = io.stderr ?? console.error
  const cwd = io.cwd ?? process.cwd()
  const prettyIsTTY = io.stderrIsTTY ?? process.stderr.isTTY
  const loadPluginModule = io.loadPluginModule
  const loadTypeScriptModule = io.loadTypeScriptModule

  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    stderr(String(err))
    printUsage(stdout)
    return 1
  }

  if (parsed.help) {
    printUsage(stdout)
    return 0
  }

  try {
    const { projectDir, filePaths } = resolveCliTargets(cwd, parsed.positionals, parsed.projectPath)
    const result = await checkTypes({
      cwd,
      projectDir,
      filePaths,
      projectPath: parsed.projectPath,
      tagFunction: parsed.tagFunction,
      injectCssxjsTypes: parsed.injectCssxjsTypes,
      loadPluginModule,
      loadTypeScriptModule
    })
    const pretty = resolvePrettyOption(parsed.pretty, prettyIsTTY)
    if (result.ok) {
      const scope = result.selectedFiles.length ? 'selected ' : ''
      stdout(`No TypeScript errors (with pug plugin) in ${result.fileCount} ${scope}file${result.fileCount === 1 ? '' : 's'}.`)
      return 0
    }
    for (const line of result.formattedErrors) stderr(formatDiagnosticOutput(line, pretty))
    const totalErrorCount = result.errors.length + result.missingFiles.length
    stderr(`\n${formatSummary(totalErrorCount, result.errorFileCount)}`)
    return 1
  } catch (err) {
    stderr(err instanceof Error ? err.message : String(err))
    return 1
  }
}
