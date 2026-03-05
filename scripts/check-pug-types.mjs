import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function printUsage() {
  console.log('Usage: node scripts/check-pug-types.mjs [project-dir] [--project <tsconfig-path>]');
  console.log('       [--tagFunction <name>] [--injectCssxjsTypes <none|auto|force>]');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/check-pug-types.mjs example');
  console.log('  node scripts/check-pug-types.mjs . --project tsconfig.json');
}

function parseArgs(argv) {
  let projectDir = '.';
  let projectPath;
  let tagFunction = 'pug';
  let injectCssxjsTypes = 'auto';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg === '--project' || arg === '-p') {
      projectPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--tagFunction') {
      tagFunction = argv[i + 1] ?? tagFunction;
      i += 1;
      continue;
    }
    if (arg === '--injectCssxjsTypes') {
      injectCssxjsTypes = argv[i + 1] ?? injectCssxjsTypes;
      i += 1;
      continue;
    }
    if (!arg.startsWith('-') && projectDir === '.') {
      projectDir = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['none', 'auto', 'force'].includes(injectCssxjsTypes)) {
    throw new Error(`Invalid --injectCssxjsTypes value: ${injectCssxjsTypes}`);
  }

  return {
    help: false,
    projectDir,
    projectPath,
    tagFunction,
    injectCssxjsTypes,
  };
}

function resolveTsconfigPath(cwd, projectDirArg, explicitProjectPath) {
  if (explicitProjectPath) return path.resolve(cwd, explicitProjectPath);
  return path.resolve(cwd, projectDirArg, 'tsconfig.json');
}

function loadPlugin(projectDir) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const probeLocations = [projectDir, process.cwd(), repoRoot];
  let lastError;

  for (const location of probeLocations) {
    try {
      const resolved = require.resolve('@startupjs/typescript-plugin-react-pug', {
        paths: [location],
      });
      const mod = require(resolved);
      return mod.default ?? mod;
    } catch (err) {
      lastError = err;
    }
  }

  const fallbackPath = path.join(
    repoRoot,
    'packages',
    'typescript-plugin-react-pug',
    'dist',
    'plugin.js',
  );
  try {
    const mod = require(fallbackPath);
    return mod.default ?? mod;
  } catch (err) {
    lastError = err;
  }

  throw new Error(
    `Cannot load @startupjs/typescript-plugin-react-pug. Ensure it is installed or built.\n${String(lastError)}`,
  );
}

function createLanguageServiceFromTsconfig({
  tsconfigPath,
  pluginInit,
  pluginConfig,
}) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return { configErrors: [configFile.error], parsedConfig: undefined, ls: undefined };
  }

  const configDir = path.dirname(tsconfigPath);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    configDir,
  );

  const host = {
    getScriptFileNames: () => parsedConfig.fileNames,
    getScriptVersion: (fileName) => String(ts.sys.getModifiedTime?.(fileName)?.valueOf() ?? 0),
    getScriptSnapshot: (fileName) => {
      const text = ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
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
    getNewLine: () => ts.sys.newLine,
  };

  const baseLs = ts.createLanguageService(host, ts.createDocumentRegistry());
  const pluginModule = pluginInit({ typescript: ts });
  const proxiedLs = pluginModule.create({
    languageServiceHost: host,
    languageService: baseLs,
    project: {
      getCurrentDirectory: () => configDir,
      projectService: {
        logger: {
          info: () => {},
        },
      },
    },
    serverHost: ts.sys,
    config: pluginConfig,
  });

  return { configErrors: parsedConfig.errors, parsedConfig, ls: proxiedLs };
}

function collectDiagnostics(ls, parsedConfig) {
  const diagnostics = [];
  const program = ls.getProgram?.();
  if (program) {
    diagnostics.push(...program.getOptionsDiagnostics());
    diagnostics.push(...program.getGlobalDiagnostics());
  }
  for (const fileName of parsedConfig.fileNames) {
    diagnostics.push(...ls.getSyntacticDiagnostics(fileName));
    diagnostics.push(...ls.getSemanticDiagnostics(fileName));
  }
  return diagnostics;
}

function uniqDiagnostics(diagnostics) {
  const out = [];
  const seen = new Set();
  for (const diag of diagnostics) {
    const key = [
      diag.file?.fileName ?? '',
      diag.start ?? '',
      diag.length ?? '',
      diag.code ?? '',
      ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diag);
  }
  return out;
}

function computeLineAndColumn(text, offset) {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < safeOffset; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line: line + 1, column: safeOffset - lineStart + 1 };
}

function formatDiagnostic(diag, cwd, fileTextCache) {
  const category = ts.DiagnosticCategory[diag.category]?.toLowerCase() ?? 'unknown';
  const code = `TS${diag.code}`;
  const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');

  if (!diag.file || diag.start === undefined) {
    return `${category} ${code}: ${message}`;
  }

  const filePath = diag.file.fileName;
  const file = path.relative(cwd, filePath) || filePath;

  if (!fileTextCache.has(filePath)) {
    fileTextCache.set(filePath, ts.sys.readFile(filePath) ?? null);
  }
  const text = fileTextCache.get(filePath);
  if (typeof text === 'string') {
    const pos = computeLineAndColumn(text, diag.start);
    return `${file}:${pos.line}:${pos.column} - ${category} ${code}: ${message}`;
  }

  const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
  return `${file}:${pos.line + 1}:${pos.character + 1} - ${category} ${code}: ${message}`;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err));
    printUsage();
    process.exit(1);
  }

  if (args.help) {
    printUsage();
    return;
  }

  const cwd = process.cwd();
  const projectDir = path.resolve(cwd, args.projectDir);
  const tsconfigPath = resolveTsconfigPath(cwd, args.projectDir, args.projectPath);
  const pluginInit = loadPlugin(projectDir);

  const { configErrors, parsedConfig, ls } = createLanguageServiceFromTsconfig({
    tsconfigPath,
    pluginInit,
    pluginConfig: {
      enabled: true,
      diagnostics: { enabled: true },
      tagFunction: args.tagFunction,
      injectCssxjsTypes: args.injectCssxjsTypes,
    },
  });

  if (!parsedConfig || !ls) {
    const errors = uniqDiagnostics(configErrors);
    const fileTextCache = new Map();
    errors.forEach((diag) => console.error(formatDiagnostic(diag, cwd, fileTextCache)));
    process.exit(1);
  }

  const diagnostics = uniqDiagnostics([
    ...configErrors,
    ...collectDiagnostics(ls, parsedConfig),
  ]);
  diagnostics.sort((a, b) => {
    const af = a.file?.fileName ?? '';
    const bf = b.file?.fileName ?? '';
    if (af !== bf) return af.localeCompare(bf);
    const as = a.start ?? -1;
    const bs = b.start ?? -1;
    if (as !== bs) return as - bs;
    return a.code - b.code;
  });

  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length === 0) {
    const count = parsedConfig.fileNames.length;
    console.log(`No TypeScript errors (with pug plugin) in ${count} file${count === 1 ? '' : 's'}.`);
    return;
  }

  const fileTextCache = new Map();
  for (const diag of errors) {
    console.error(formatDiagnostic(diag, cwd, fileTextCache));
  }
  console.error(`\nFound ${errors.length} TypeScript error${errors.length === 1 ? '' : 's'}.`);
  process.exit(1);
}

main();
