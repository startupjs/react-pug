import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
const JSX_FILE = path.join(FIXTURES_DIR, 'app-jsx.jsx');
const BUTTON_FILE = path.join(FIXTURES_DIR, 'Button.tsx');

async function loadPlugin() {
  const mod = await import('../../src/plugin/index.ts');
  return mod.default ?? mod;
}

function createLanguageServiceWithPlugin(
  init: Function,
  rootFiles: string[],
  fixturesDir: string,
) {
  const configPath = path.join(fixturesDir, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fixturesDir,
  );

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootFiles,
    getScriptVersion: () => '0',
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
    },
    getCurrentDirectory: () => fixturesDir,
    getCompilationSettings: () => parsedConfig.options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

  const pluginModule = init({ typescript: ts });
  const pluginCreateInfo = {
    languageServiceHost: host,
    languageService: ls,
    project: {} as any,
    serverHost: {} as any,
    config: {},
  };

  const proxiedLs = pluginModule.create(pluginCreateInfo);
  return { ls: proxiedLs, host };
}

describe('JS/JSX file support', () => {
  let ls: ts.LanguageService;
  let host: ts.LanguageServiceHost;
  let jsxText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [JSX_FILE, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    host = result.host;
    jsxText = fs.readFileSync(JSX_FILE, 'utf-8');
  });

  it('shadow content replaces pug with JSX in .jsx file', () => {
    const snapshot = host.getScriptSnapshot!(JSX_FILE);
    expect(snapshot).toBeDefined();
    const text = snapshot!.getText(0, snapshot!.getLength());
    expect(text).not.toContain('pug`');
    expect(text).toContain('<Button');
  });

  it('completions at attribute name in .jsx file suggest typed props', () => {
    const pugStart = jsxText.indexOf('pug`');
    const onClickIdx = jsxText.indexOf('onClick', pugStart);
    expect(onClickIdx).toBeGreaterThan(pugStart);

    const completions = ls.getCompletionsAtPosition(JSX_FILE, onClickIdx, undefined);
    expect(completions).toBeDefined();
    expect(completions!.entries.length).toBeGreaterThan(0);

    const names = completions!.entries.map(e => e.name);
    expect(names).toContain('onClick');
  });

  it('hover on identifier in .jsx file returns type info', () => {
    const pugStart = jsxText.indexOf('pug`');
    const handlerIdx = jsxText.indexOf('jsxHandler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(JSX_FILE, handlerIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.displayParts).toBeDefined();
    expect(quickInfo!.displayParts!.length).toBeGreaterThan(0);
  });

  it('go-to-definition from .jsx file navigates to component source', () => {
    const pugStart = jsxText.indexOf('pug`');
    const buttonIdx = jsxText.indexOf('Button', pugStart + 4);
    expect(buttonIdx).toBeGreaterThan(pugStart);

    const defs = ls.getDefinitionAtPosition(JSX_FILE, buttonIdx);
    expect(defs).toBeDefined();
    expect(defs!.length).toBeGreaterThan(0);

    // At least one definition should point to Button.tsx
    const buttonDef = defs!.find(d => d.fileName.includes('Button'));
    expect(buttonDef).toBeDefined();
  });

  it('diagnostics work in .jsx file without crashing', () => {
    const semanticDiags = ls.getSemanticDiagnostics(JSX_FILE);
    // Should not crash -- may or may not have diagnostics
    expect(Array.isArray(semanticDiags)).toBe(true);

    const syntacticDiags = ls.getSyntacticDiagnostics(JSX_FILE);
    expect(Array.isArray(syntacticDiags)).toBe(true);
  });

  it('find references works in .jsx file', () => {
    const pugStart = jsxText.indexOf('pug`');
    const handlerIdx = jsxText.indexOf('jsxHandler', pugStart);

    const refs = ls.getReferencesAtPosition(JSX_FILE, handlerIdx);
    expect(refs).toBeDefined();
    expect(refs!.length).toBeGreaterThan(0);
  });
});
