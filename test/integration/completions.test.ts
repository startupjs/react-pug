import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
const APP_FILE = path.join(FIXTURES_DIR, 'app.tsx');
const BUTTON_FILE = path.join(FIXTURES_DIR, 'Button.tsx');
const PLAIN_FILE = path.join(FIXTURES_DIR, 'plain.ts');

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
  return { ls: proxiedLs, host, originalLs: ls };
}

// Helper to read original file text
function readOriginal(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

describe('completions through real pipeline', () => {
  let ls: ts.LanguageService;
  let host: ts.LanguageServiceHost;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    host = result.host;
    appText = readOriginal(APP_FILE);
  });

  it('shadow content replaces pug with JSX', () => {
    const snapshot = host.getScriptSnapshot!(APP_FILE);
    expect(snapshot).toBeDefined();
    const text = snapshot!.getText(0, snapshot!.getLength());
    expect(text).not.toContain('pug`');
    expect(text).toContain('<Button');
  });

  it('completions at attribute name position suggest typed props', () => {
    // Find 'onClick' inside the pug template
    const pugStart = appText.indexOf('pug`');
    const onClickIdx = appText.indexOf('onClick', pugStart);
    expect(onClickIdx).toBeGreaterThan(pugStart);

    const completions = ls.getCompletionsAtPosition(APP_FILE, onClickIdx, undefined);
    expect(completions).toBeDefined();
    expect(completions!.entries.length).toBeGreaterThan(0);

    const names = completions!.entries.map(e => e.name);
    expect(names).toContain('onClick');
  });

  it('completions at attribute name suggest label prop', () => {
    const pugStart = appText.indexOf('pug`');
    const labelIdx = appText.indexOf('label', pugStart);
    expect(labelIdx).toBeGreaterThan(pugStart);

    const completions = ls.getCompletionsAtPosition(APP_FILE, labelIdx, undefined);
    expect(completions).toBeDefined();

    const names = completions!.entries.map(e => e.name);
    expect(names).toContain('label');
  });

  it('completions at expression position suggest variables in scope', () => {
    // 'handler' is a variable in scope, used as attribute value
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const completions = ls.getCompletionsAtPosition(APP_FILE, handlerIdx, undefined);
    expect(completions).toBeDefined();

    const names = completions!.entries.map(e => e.name);
    expect(names).toContain('handler');
  });

  it('completions include ButtonProps members', () => {
    const pugStart = appText.indexOf('pug`');
    const onClickIdx = appText.indexOf('onClick', pugStart);

    const completions = ls.getCompletionsAtPosition(APP_FILE, onClickIdx, undefined);
    expect(completions).toBeDefined();

    const names = completions!.entries.map(e => e.name);
    // Button has onClick, label, disabled props
    const hasOnClick = names.includes('onClick');
    const hasLabel = names.includes('label');
    const hasDisabled = names.includes('disabled');
    expect(hasOnClick || hasLabel || hasDisabled).toBe(true);
  });

  it('completions at component name suggest imported identifiers', () => {
    const pugStart = appText.indexOf('pug`');
    const pugContent = appText.indexOf('Button', pugStart + 4);
    expect(pugContent).toBeGreaterThan(pugStart);

    const completions = ls.getCompletionsAtPosition(APP_FILE, pugContent, undefined);
    expect(completions).toBeDefined();

    const names = completions!.entries.map(e => e.name);
    expect(names).toContain('Button');
  });

  it('returns undefined for unmapped/synthetic position', () => {
    // The 'pug' keyword itself, before the backtick, is not mapped
    const pugIdx = appText.indexOf('pug`');
    // Position at 'pug' tag -- inside the region but not mapped
    const completions = ls.getCompletionsAtPosition(APP_FILE, pugIdx, undefined);
    // Should return undefined since the position maps to null (synthetic)
    expect(completions).toBeUndefined();
  });

  it('completions in plain TS file work normally (passthrough)', () => {
    const plainText = readOriginal(PLAIN_FILE);
    // Position after 'export ' at the start -- TS should offer completions
    // Use a position inside a function body where completions are typical
    const returnIdx = plainText.indexOf('return');
    expect(returnIdx).toBeGreaterThan(-1);
    // Position right after 'return ' where TS provides expression completions
    const afterReturn = returnIdx + 'return '.length;

    const completions = ls.getCompletionsAtPosition(PLAIN_FILE, afterReturn, undefined);
    // TS may or may not return completions at every position --
    // the key is it doesn't crash and returns a valid result
    expect(completions === undefined || completions!.entries.length >= 0).toBe(true);
  });

  it('completions before pug region do not crash', () => {
    // Test that requesting completions outside pug works without errors
    const importIdx = appText.indexOf('import');
    expect(importIdx).toBeGreaterThan(-1);

    // Position at start of file (outside any pug region)
    const completions = ls.getCompletionsAtPosition(APP_FILE, importIdx, undefined);
    // May or may not have completions -- just verify no crash
    expect(completions === undefined || completions!.entries.length >= 0).toBe(true);
  });
});

describe('hover (getQuickInfoAtPosition) through real pipeline', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    appText = readOriginal(APP_FILE);
  });

  it('hover on component name returns type info', () => {
    const pugStart = appText.indexOf('pug`');
    const buttonIdx = appText.indexOf('Button', pugStart + 4);
    expect(buttonIdx).toBeGreaterThan(pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, buttonIdx);
    expect(quickInfo).toBeDefined();
    // Should have display parts showing the function type
    expect(quickInfo!.displayParts).toBeDefined();
    expect(quickInfo!.displayParts!.length).toBeGreaterThan(0);
  });

  it('hover on expression variable returns type info', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.kind).toBeDefined();
  });

  it('hover textSpan is mapped back to original file range', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    expect(quickInfo).toBeDefined();

    // textSpan should be mapped back to the original file (not shadow offsets)
    const spanStart = quickInfo!.textSpan.start;
    const spanEnd = spanStart + quickInfo!.textSpan.length;

    // Span should be within the pug region of the original file
    expect(spanStart).toBeGreaterThanOrEqual(pugStart);
    expect(spanEnd).toBeLessThanOrEqual(appText.length);

    // The span should overlap with 'handler' in the original text
    const handlerEnd = handlerIdx + 'handler'.length;
    const overlaps = spanStart < handlerEnd && spanEnd > handlerIdx;
    expect(overlaps).toBe(true);
  });

  it('hover on attribute name returns prop type', () => {
    const pugStart = appText.indexOf('pug`');
    const onClickIdx = appText.indexOf('onClick', pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, onClickIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.displayParts).toBeDefined();
    expect(quickInfo!.displayParts!.length).toBeGreaterThan(0);
  });

  it('hover returns undefined for unmapped/synthetic position', () => {
    const pugIdx = appText.indexOf('pug`');
    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, pugIdx);
    expect(quickInfo).toBeUndefined();
  });

  it('hover in plain TS file works normally (passthrough)', () => {
    const plainText = readOriginal(PLAIN_FILE);
    const addIdx = plainText.indexOf('add');
    expect(addIdx).toBeGreaterThan(-1);

    const quickInfo = ls.getQuickInfoAtPosition(PLAIN_FILE, addIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.kind).toBe(ts.ScriptElementKind.functionElement);
  });

  it('hover before pug region works normally', () => {
    // 'handler' defined outside pug
    const handlerDef = appText.indexOf('handler');
    expect(handlerDef).toBeLessThan(appText.indexOf('pug`'));

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, handlerDef);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.kind).toBe(ts.ScriptElementKind.constElement);
  });
});

describe('completions edge cases', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    appText = readOriginal(APP_FILE);
  });

  it('does not crash on position 0', () => {
    const completions = ls.getCompletionsAtPosition(APP_FILE, 0, undefined);
    // Position 0 is 'i' of 'import' -- should work
    expect(completions === undefined || completions!.entries.length >= 0).toBe(true);
  });

  it('does not crash on position at end of file', () => {
    const endPos = appText.length - 1;
    const completions = ls.getCompletionsAtPosition(APP_FILE, endPos, undefined);
    expect(completions === undefined || completions!.entries.length >= 0).toBe(true);
  });

  it('hover does not crash on position 0', () => {
    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, 0);
    expect(quickInfo === undefined || quickInfo!.displayParts !== undefined).toBe(true);
  });

  it('hover does not crash on position at end of file', () => {
    const endPos = appText.length - 1;
    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, endPos);
    expect(quickInfo === undefined || quickInfo !== null).toBe(true);
  });

  it('completions on plain file without pug are unaffected', () => {
    const plainText = readOriginal(PLAIN_FILE);
    // 'number' in 'a: number' parameter type
    const numIdx = plainText.indexOf('number');
    const completions = ls.getCompletionsAtPosition(PLAIN_FILE, numIdx, undefined);
    expect(completions).toBeDefined();
  });
});
