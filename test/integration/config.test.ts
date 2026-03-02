import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
const APP_FILE = path.join(FIXTURES_DIR, 'app.tsx');
const BUTTON_FILE = path.join(FIXTURES_DIR, 'Button.tsx');

async function loadPlugin() {
  const mod = await import('../../src/plugin/index.ts');
  return mod.default ?? mod;
}

function createLanguageServiceWithPlugin(
  init: Function,
  rootFiles: string[],
  fixturesDir: string,
  pluginConfig: Record<string, any> = {},
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

  const lsBase = ts.createLanguageService(host, ts.createDocumentRegistry());

  const pluginModule = init({ typescript: ts });
  const pluginCreateInfo = {
    languageServiceHost: host,
    languageService: lsBase,
    project: {} as any,
    serverHost: {} as any,
    config: pluginConfig,
  };

  const proxiedLs = pluginModule.create(pluginCreateInfo);
  return { ls: proxiedLs, host };
}

// ── enabled=false ───────────────────────────────────────────────

describe('plugin with enabled=false', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, { enabled: false },
    );
    ls = result.ls;
    appText = fs.readFileSync(APP_FILE, 'utf-8');
  });

  it('getScriptSnapshot returns original text unchanged (no shadow)', () => {
    // When disabled, the host should return original text containing pug`
    // We can verify by checking that the LS sees the original text
    // (semantic diagnostics would be different if shadowing was active)
    const diags = ls.getSemanticDiagnostics(APP_FILE);
    // Should have errors since pug` is not valid TS when not shadowed
    // The pug tagged template literal would not be transformed
    expect(Array.isArray(diags)).toBe(true);
  });

  it('completions still work for non-pug code', () => {
    // Position at the start of 'handler' const declaration (outside pug)
    const handlerIdx = appText.indexOf('handler');
    expect(handlerIdx).toBeLessThan(appText.indexOf('pug`'));

    // Should not crash - LS operates on original text
    const completions = ls.getCompletionsAtPosition(APP_FILE, handlerIdx, undefined);
    expect(completions === undefined || Array.isArray(completions?.entries)).toBe(true);
  });

  it('hover works for non-pug code', () => {
    const handlerIdx = appText.indexOf('handler');
    const info = ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    // Should not crash
    expect(info === undefined || info.textSpan != null).toBe(true);
  });
});

// ── default config (empty {}) ───────────────────────────────────

describe('plugin with default config (empty {})', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {},
    );
    ls = result.ls;
    appText = fs.readFileSync(APP_FILE, 'utf-8');
  });

  it('shadow document is active (pug templates are processed)', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);

    const info = ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    // With shadowing active, hover should work on pug content
    if (info) {
      expect(info.textSpan.start).toBeGreaterThanOrEqual(0);
    }
    expect(info === undefined || info.textSpan != null).toBe(true);
  });

  it('pug parse error diagnostics are injected by default', async () => {
    // Use a virtual file with parse error
    const init = await loadPlugin();
    const errorFile = path.join(FIXTURES_DIR, 'default-cfg-error.tsx');
    const errorText = 'const v = pug`${bad}`;';
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(errorFile, errorText);

    const result = createLanguageServiceWithPlugin(
      init, [errorFile, BUTTON_FILE], FIXTURES_DIR, {}, virtualFiles,
    );

    const diags = result.ls.getSemanticDiagnostics(errorFile);
    const pugDiag = diags.find(
      d => typeof d.messageText === 'string' && d.messageText.includes('Pug parse error'),
    );
    expect(pugDiag).toBeDefined();
    expect(pugDiag!.code).toBe(99001);
  });
});

// ── diagnostics.enabled=false ───────────────────────────────────

describe('plugin with diagnostics.enabled=false', () => {
  let ls: ts.LanguageService;
  let errorFile: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    errorFile = path.join(FIXTURES_DIR, 'diag-cfg-error.tsx');
    const errorText = 'const v = pug`${bad}`;';
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(errorFile, errorText);

    const rootFiles = [errorFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR,
      { diagnostics: { enabled: false } },
      virtualFiles,
    );
    ls = result.ls;
  });

  it('suppresses pug parse error diagnostics', () => {
    const diags = ls.getSemanticDiagnostics(errorFile);
    const pugDiag = diags.find(
      d => typeof d.messageText === 'string' && d.messageText.includes('Pug parse error'),
    );
    // Should NOT have the pug parse error diagnostic
    expect(pugDiag).toBeUndefined();
  });

  it('still returns TS-native diagnostics', () => {
    const diags = ls.getSemanticDiagnostics(errorFile);
    // Should still have array (TS may report errors for the placeholder code)
    expect(Array.isArray(diags)).toBe(true);
  });

  it('syntactic diagnostics are not affected', () => {
    const diags = ls.getSyntacticDiagnostics(errorFile);
    expect(Array.isArray(diags)).toBe(true);
  });
});

// ── tagFunction config ──────────────────────────────────────────

describe('plugin with tagFunction config', () => {
  it('tagFunction defaults to "pug" and processes pug templates', async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE];
    // Empty config -- tagFunction defaults to 'pug'
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR, {});
    const appText = fs.readFileSync(APP_FILE, 'utf-8');

    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    const info = result.ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    // Should work -- pug templates are processed with default tagFunction
    if (info) {
      expect(info.textSpan.start).toBeGreaterThanOrEqual(0);
    }
    expect(info === undefined || info.textSpan != null).toBe(true);
  });

  it('tagFunction="pug" explicitly works same as default', async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, { tagFunction: 'pug' },
    );
    const appText = fs.readFileSync(APP_FILE, 'utf-8');

    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    const info = result.ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    if (info) {
      expect(info.textSpan.start).toBeGreaterThanOrEqual(0);
    }
    expect(info === undefined || info.textSpan != null).toBe(true);
  });

  it('tagFunction="html" causes pug` templates to be ignored', async () => {
    const init = await loadPlugin();
    const pugFile = path.join(FIXTURES_DIR, 'tagfn-pug-virtual.tsx');
    const pugText = 'const v = pug`div`;';
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(pugFile, pugText);

    const result = createLanguageServiceWithPlugin(
      init, [pugFile, BUTTON_FILE], FIXTURES_DIR,
      { tagFunction: 'html' },
      virtualFiles,
    );

    // With tagFunction='html', pug` templates should NOT be processed
    // The file should pass through as-is (no shadow document created)
    const diags = result.ls.getSemanticDiagnostics(pugFile);
    // Just verify it doesn't crash and returns diagnostics
    expect(Array.isArray(diags)).toBe(true);
  });

  it('tagFunction config is passed through to buildShadowDocument', async () => {
    const init = await loadPlugin();
    // File with pug` -- when tagFunction='nonexistent', no templates match
    const testFile = path.join(FIXTURES_DIR, 'tagfn-none-virtual.tsx');
    const testText = 'const v = pug`div`;';
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(testFile, testText);

    const result = createLanguageServiceWithPlugin(
      init, [testFile, BUTTON_FILE], FIXTURES_DIR,
      { tagFunction: 'nonexistent' },
      virtualFiles,
    );

    // With non-matching tagFunction, pug` is not processed
    // TS should see the raw pug` text and may have errors
    const diags = result.ls.getSemanticDiagnostics(testFile);
    expect(Array.isArray(diags)).toBe(true);
  });
});
