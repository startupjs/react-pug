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
  virtualFiles?: Map<string, string>,
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
      if (virtualFiles?.has(fileName)) {
        return ts.ScriptSnapshot.fromString(virtualFiles.get(fileName)!);
      }
      if (!fs.existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
    },
    getCurrentDirectory: () => fixturesDir,
    getCompilationSettings: () => parsedConfig.options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (f) => virtualFiles?.has(f) || ts.sys.fileExists(f),
    readFile: (f) => virtualFiles?.has(f) ? virtualFiles.get(f) : ts.sys.readFile(f),
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

  it('well-typed .jsx file produces zero semantic diagnostics', () => {
    const semanticDiags = ls.getSemanticDiagnostics(JSX_FILE);
    expect(semanticDiags).toHaveLength(0);

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

  it('rename works in .jsx file', () => {
    const handlerIdx = jsxText.indexOf('jsxHandler');

    const renameInfo = ls.getRenameInfo(JSX_FILE, handlerIdx, { allowRenameOfImportPath: false });
    expect(renameInfo.canRename).toBe(true);

    const renameLocations = ls.findRenameLocations(JSX_FILE, handlerIdx, false, false);
    expect(renameLocations).toBeDefined();
    expect(renameLocations!.length).toBeGreaterThan(0);
  });

  it('getDefinitionAndBoundSpan works in .jsx file', () => {
    const pugStart = jsxText.indexOf('pug`');
    const buttonIdx = jsxText.indexOf('Button', pugStart + 4);

    const result = ls.getDefinitionAndBoundSpan(JSX_FILE, buttonIdx);
    expect(result).toBeDefined();
    expect(result!.definitions).toBeDefined();
    expect(result!.definitions!.length).toBeGreaterThan(0);
    expect(result!.textSpan).toBeDefined();
  });
});

describe('Plain .js file support (no JSX extension)', () => {
  let ls: ts.LanguageService;
  let host: ts.LanguageServiceHost;
  let jsFile: string;
  const jsText = [
    'const handler = () => console.log("clicked");',
    '',
    'const view = pug`',
    '  div(onClick=handler) Hello',
    '`',
  ].join('\n');

  beforeAll(async () => {
    const init = await loadPlugin();
    jsFile = path.join(FIXTURES_DIR, 'app-plain.js');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(jsFile, jsText);
    const rootFiles = [jsFile];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR, virtualFiles);
    ls = result.ls;
    host = result.host;
  });

  it('shadow content replaces pug with JSX in .js file', () => {
    const snapshot = host.getScriptSnapshot!(jsFile);
    expect(snapshot).toBeDefined();
    const text = snapshot!.getText(0, snapshot!.getLength());
    expect(text).not.toContain('pug`');
    expect(text).toContain('<div');
  });

  it('completions work in .js file pug template', () => {
    const pugStart = jsText.indexOf('pug`');
    const handlerIdx = jsText.indexOf('handler', pugStart);

    const completions = ls.getCompletionsAtPosition(jsFile, handlerIdx, undefined);
    expect(completions).toBeDefined();
    const names = completions!.entries.map(e => e.name);
    expect(names).toContain('handler');
  });

  it('hover works in .js file pug template', () => {
    const pugStart = jsText.indexOf('pug`');
    const handlerIdx = jsText.indexOf('handler', pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(jsFile, handlerIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.displayParts).toBeDefined();
    expect(quickInfo!.displayParts!.length).toBeGreaterThan(0);
  });

  it('diagnostics do not crash for .js file', () => {
    const semanticDiags = ls.getSemanticDiagnostics(jsFile);
    expect(Array.isArray(semanticDiags)).toBe(true);

    const syntacticDiags = ls.getSyntacticDiagnostics(jsFile);
    expect(Array.isArray(syntacticDiags)).toBe(true);
  });
});

describe('.jsx file without pug templates', () => {
  let ls: ts.LanguageService;
  let host: ts.LanguageServiceHost;
  let noPugFile: string;
  const noPugText = [
    'const greeting = "hello";',
    'export function greet() { return greeting; }',
  ].join('\n');

  beforeAll(async () => {
    const init = await loadPlugin();
    noPugFile = path.join(FIXTURES_DIR, 'no-pug.jsx');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(noPugFile, noPugText);
    const rootFiles = [noPugFile];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR, virtualFiles);
    ls = result.ls;
    host = result.host;
  });

  it('returns original content when no pug templates exist', () => {
    const snapshot = host.getScriptSnapshot!(noPugFile);
    expect(snapshot).toBeDefined();
    const text = snapshot!.getText(0, snapshot!.getLength());
    expect(text).toBe(noPugText);
  });

  it('completions still work in non-pug .jsx file', () => {
    // Query at 'return greeting' -- inside the function body where completions are available
    const returnIdx = noPugText.indexOf('return greeting');
    const greetingInBody = noPugText.indexOf('greeting', returnIdx);
    const completions = ls.getCompletionsAtPosition(noPugFile, greetingInBody, undefined);
    expect(completions).toBeDefined();
    expect(completions!.entries.length).toBeGreaterThan(0);
    expect(completions!.entries.map(e => e.name)).toContain('greeting');
  });

  it('diagnostics work for non-pug .jsx file', () => {
    const diags = ls.getSemanticDiagnostics(noPugFile);
    expect(Array.isArray(diags)).toBe(true);
  });
});

describe('Multiple pug templates in a single .jsx file', () => {
  let ls: ts.LanguageService;
  let host: ts.LanguageServiceHost;
  let multiFile: string;
  const multiText = [
    'import { Button } from "./Button";',
    '',
    'const handler1 = () => {};',
    'const handler2 = () => {};',
    '',
    'const view1 = pug`',
    '  Button(onClick=handler1, label="First")',
    '`',
    '',
    'const view2 = pug`',
    '  Button(onClick=handler2, label="Second")',
    '`',
  ].join('\n');

  beforeAll(async () => {
    const init = await loadPlugin();
    multiFile = path.join(FIXTURES_DIR, 'multi-pug.jsx');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(multiFile, multiText);
    const rootFiles = [multiFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR, virtualFiles);
    ls = result.ls;
    host = result.host;
  });

  it('shadow replaces both pug templates', () => {
    const snapshot = host.getScriptSnapshot!(multiFile);
    expect(snapshot).toBeDefined();
    const text = snapshot!.getText(0, snapshot!.getLength());
    expect(text).not.toContain('pug`');
    // Both templates should generate <Button
    const matches = text.match(/<Button/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBe(2);
  });

  it('completions work in both templates', () => {
    const firstPug = multiText.indexOf('pug`');
    const secondPug = multiText.indexOf('pug`', firstPug + 1);

    const handler1Idx = multiText.indexOf('handler1', firstPug);
    const handler2Idx = multiText.indexOf('handler2', secondPug);

    const c1 = ls.getCompletionsAtPosition(multiFile, handler1Idx, undefined);
    expect(c1).toBeDefined();
    expect(c1!.entries.map(e => e.name)).toContain('handler1');

    const c2 = ls.getCompletionsAtPosition(multiFile, handler2Idx, undefined);
    expect(c2).toBeDefined();
    expect(c2!.entries.map(e => e.name)).toContain('handler2');
  });

  it('zero semantic diagnostics for well-typed multi-template .jsx file', () => {
    const diags = ls.getSemanticDiagnostics(multiFile);
    expect(diags).toHaveLength(0);
  });
});

describe('Pug parse error in .jsx file', () => {
  let ls: ts.LanguageService;
  let errorFile: string;
  const errorText = [
    'const view = pug`',
    '  div(',
    '`',
  ].join('\n');

  beforeAll(async () => {
    const init = await loadPlugin();
    errorFile = path.join(FIXTURES_DIR, 'error-jsx.jsx');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(errorFile, errorText);
    const rootFiles = [errorFile];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR, virtualFiles);
    ls = result.ls;
  });

  it('injects pug parse error diagnostic in .jsx file', () => {
    const diags = ls.getSemanticDiagnostics(errorFile);
    const pugErrors = diags.filter(d => d.code === 99001);
    expect(pugErrors.length).toBeGreaterThan(0);
    expect(
      pugErrors.some(d =>
        typeof d.messageText === 'string' && d.messageText.includes('Pug parse error'),
      ),
    ).toBe(true);
  });

  it('pug parse error span is within file bounds', () => {
    const diags = ls.getSemanticDiagnostics(errorFile);
    const pugErrors = diags.filter(d => d.code === 99001);
    for (const d of pugErrors) {
      expect(d.start).toBeDefined();
      expect(d.start).toBeGreaterThanOrEqual(0);
      expect(d.start! + d.length!).toBeLessThanOrEqual(errorText.length);
      expect(d.length).toBeGreaterThanOrEqual(1);
    }
  });
});
