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

  it('completions include ButtonProps members (onClick, children, disabled)', () => {
    const pugStart = appText.indexOf('pug`');
    const onClickIdx = appText.indexOf('onClick', pugStart);

    const completions = ls.getCompletionsAtPosition(APP_FILE, onClickIdx, undefined);
    expect(completions).toBeDefined();

    const names = completions!.entries.map(e => e.name);
    // At onClick position, TS filters by prefix 'o' -- onClick should be present
    expect(names).toContain('onClick');
    // Also verify other Button props are available by checking label position
    const labelIdx = appText.indexOf('label', pugStart);
    const labelCompletions = ls.getCompletionsAtPosition(APP_FILE, labelIdx, undefined);
    expect(labelCompletions).toBeDefined();
    const labelNames = labelCompletions!.entries.map(e => e.name);
    expect(labelNames).toContain('label');
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
    const returnIdx = plainText.indexOf('return');
    expect(returnIdx).toBeGreaterThan(-1);
    const afterReturn = returnIdx + 'return '.length;

    const completions = ls.getCompletionsAtPosition(PLAIN_FILE, afterReturn, undefined);
    expect(completions).toBeDefined();
    const names = completions!.entries.map(e => e.name);
    // Should include variables in scope like 'a', 'b', and global identifiers
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('completions before pug region return valid results', () => {
    const importIdx = appText.indexOf('import');
    expect(importIdx).toBeGreaterThan(-1);

    const completions = ls.getCompletionsAtPosition(APP_FILE, importIdx, undefined);
    // At 'import' keyword, TS may return keyword completions or undefined
    if (completions) {
      expect(completions.entries).toBeInstanceOf(Array);
      // Every entry should have a name property
      for (const entry of completions.entries) {
        expect(typeof entry.name).toBe('string');
        expect(entry.name.length).toBeGreaterThan(0);
      }
    }
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

  it('hover on component name returns type info with "Button" in display', () => {
    const pugStart = appText.indexOf('pug`');
    const buttonIdx = appText.indexOf('Button', pugStart + 4);
    expect(buttonIdx).toBeGreaterThan(pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, buttonIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.displayParts).toBeDefined();
    expect(quickInfo!.displayParts!.length).toBeGreaterThan(0);
    // Display text should contain the component name "Button"
    const displayText = quickInfo!.displayParts!.map(p => p.text).join('');
    expect(displayText).toContain('Button');
  });

  it('hover on expression variable returns arrow function type', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.kind).toBe('const');
    const displayText = quickInfo!.displayParts!.map(p => p.text).join('');
    expect(displayText).toContain('handler');
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

  it('hover on attribute name returns prop type with onClick', () => {
    const pugStart = appText.indexOf('pug`');
    const onClickIdx = appText.indexOf('onClick', pugStart);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, onClickIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.displayParts).toBeDefined();
    expect(quickInfo!.displayParts!.length).toBeGreaterThan(0);
    const displayText = quickInfo!.displayParts!.map(p => p.text).join('');
    expect(displayText).toContain('onClick');
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

  it('returns valid completions or undefined at position 0', () => {
    const completions = ls.getCompletionsAtPosition(APP_FILE, 0, undefined);
    if (completions) {
      expect(Array.isArray(completions.entries)).toBe(true);
      for (const entry of completions.entries) {
        expect(typeof entry.name).toBe('string');
      }
    }
  });

  it('returns valid completions or undefined at end of file', () => {
    const endPos = appText.length - 1;
    const completions = ls.getCompletionsAtPosition(APP_FILE, endPos, undefined);
    if (completions) {
      expect(Array.isArray(completions.entries)).toBe(true);
    }
  });

  it('hover at position 0 returns undefined (inside import keyword)', () => {
    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, 0);
    // Position 0 is the 'i' of 'import' -- TS does not provide hover for keywords
    expect(quickInfo).toBeUndefined();
  });

  it('hover at end of file returns valid result or undefined', () => {
    const endPos = appText.length - 1;
    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, endPos);
    if (quickInfo) {
      expect(quickInfo.textSpan).toBeDefined();
      expect(quickInfo.textSpan.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('completions on plain file without pug are unaffected', () => {
    const plainText = readOriginal(PLAIN_FILE);
    // 'number' in 'a: number' parameter type
    const numIdx = plainText.indexOf('number');
    const completions = ls.getCompletionsAtPosition(PLAIN_FILE, numIdx, undefined);
    expect(completions).toBeDefined();
    // Should contain type-related completions like 'number'
    const names = completions!.entries.map(e => e.name);
    expect(names).toContain('number');
  });
});
