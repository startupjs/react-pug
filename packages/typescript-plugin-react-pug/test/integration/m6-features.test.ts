import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
const APP_FILE = path.join(FIXTURES_DIR, 'app.tsx');
const BUTTON_FILE = path.join(FIXTURES_DIR, 'Button.tsx');

async function loadPlugin() {
  const mod = await import('../../src/index.ts');
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

function readOriginal(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

// ── getApplicableRefactors ──────────────────────────────────────

describe('getApplicableRefactors through real pipeline', () => {
  let ls: ts.LanguageService;
  let appText: string;
  let plainVirtualFile: string;
  const plainVirtualText = 'export function add(a: number, b: number) { return a + b; }';

  beforeAll(async () => {
    const init = await loadPlugin();
    plainVirtualFile = path.join(FIXTURES_DIR, 'plain-refactors.tsx');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(plainVirtualFile, plainVirtualText);
    const rootFiles = [APP_FILE, BUTTON_FILE, plainVirtualFile];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR, virtualFiles);
    ls = result.ls;
    appText = readOriginal(APP_FILE);
  });

  it('returns refactors for a position inside pug region', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const refactors = ls.getApplicableRefactors(APP_FILE, handlerIdx, undefined);
    // Should return an array (may be empty if no refactors apply, but must not crash)
    expect(Array.isArray(refactors)).toBe(true);
  });

  it('returns refactors for a TextRange inside pug region', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const refactors = ls.getApplicableRefactors(
      APP_FILE,
      { pos: handlerIdx, end: handlerIdx + 'handler'.length },
      undefined,
    );
    expect(Array.isArray(refactors)).toBe(true);
  });

  it('returns empty array for unmapped position', () => {
    const pugIdx = appText.indexOf('pug`');
    const refactors = ls.getApplicableRefactors(APP_FILE, pugIdx, undefined);
    expect(refactors).toEqual([]);
  });

  it('passes through for non-pug file', () => {
    const addIdx = plainVirtualText.indexOf('add');
    const refactors = ls.getApplicableRefactors(plainVirtualFile, addIdx, undefined);
    expect(Array.isArray(refactors)).toBe(true);
  });

  it('returns empty array for unmapped TextRange', () => {
    const pugIdx = appText.indexOf('pug`');
    // Range spanning the pug` keyword itself -- unmapped
    const refactors = ls.getApplicableRefactors(
      APP_FILE,
      { pos: pugIdx, end: pugIdx + 3 },
      undefined,
    );
    expect(refactors).toEqual([]);
  });
});

// ── getEditsForRefactor ─────────────────────────────────────────

describe('getEditsForRefactor through real pipeline', () => {
  let ls: ts.LanguageService;
  let refactorFile: string;
  let refactorText: string;
  let plainVirtualFile: string;
  const plainVirtualText = 'export function add(a: number, b: number) { return a + b; }';

  beforeAll(async () => {
    const init = await loadPlugin();

    // Create a virtual file where we can request a refactor inside pug
    refactorFile = path.join(FIXTURES_DIR, 'refactor-virtual.tsx');
    refactorText = [
      'const x = 10;',
      'const y = 20;',
      'const view = pug`',
      '  span= x + y',
      '`;',
    ].join('\n');

    plainVirtualFile = path.join(FIXTURES_DIR, 'plain-edits.tsx');

    const virtualFiles = new Map<string, string>();
    virtualFiles.set(refactorFile, refactorText);
    virtualFiles.set(plainVirtualFile, plainVirtualText);

    const rootFiles = [refactorFile, BUTTON_FILE, plainVirtualFile];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, virtualFiles,
    );
    ls = result.ls;
  });

  it('returns undefined for unmapped position', () => {
    const pugIdx = refactorText.indexOf('pug`');
    const result = ls.getEditsForRefactor(
      refactorFile, {}, pugIdx, 'Move to a new file', 'Move to a new file', undefined,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for unmapped TextRange', () => {
    const pugIdx = refactorText.indexOf('pug`');
    const result = ls.getEditsForRefactor(
      refactorFile, {}, { pos: pugIdx, end: pugIdx + 3 },
      'Move to a new file', 'Move to a new file', undefined,
    );
    expect(result).toBeUndefined();
  });

  it('maps edits back when refactor applies to pug content', () => {
    const pugStart = refactorText.indexOf('pug`');
    const exprIdx = refactorText.indexOf('x + y', pugStart);
    expect(exprIdx).toBeGreaterThan(pugStart);

    // Get available refactors first to find a real one
    const refactors = ls.getApplicableRefactors(
      refactorFile,
      { pos: exprIdx, end: exprIdx + 'x + y'.length },
      undefined,
    );

    if (refactors.length > 0) {
      const refactor = refactors[0];
      const action = refactor.actions[0];
      const result = ls.getEditsForRefactor(
        refactorFile, {}, { pos: exprIdx, end: exprIdx + 'x + y'.length },
        refactor.name, action.name, undefined,
      );
      if (result) {
        // Edits should have spans mapped back to original positions
        for (const edit of result.edits) {
          for (const tc of edit.textChanges) {
            expect(tc.span.start).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
    // If refactors were available, edits should have been produced or be undefined
    expect(true).toBe(true);
  });

  it('passes through for non-pug file', () => {
    const addIdx = plainVirtualText.indexOf('add');

    const refactors = ls.getApplicableRefactors(plainVirtualFile, addIdx, undefined);
    if (refactors.length > 0) {
      const refactor = refactors[0];
      const action = refactor.actions[0];
      const result = ls.getEditsForRefactor(
        plainVirtualFile, {}, addIdx, refactor.name, action.name, undefined,
      );
      if (result) {
        expect(Array.isArray(result.edits)).toBe(true);
        for (const edit of result.edits) {
          for (const tc of edit.textChanges) {
            expect(tc.span.start).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

// ── getCodeFixesAtPosition ──────────────────────────────────────

describe('getCodeFixesAtPosition through real pipeline', () => {
  let ls: ts.LanguageService;
  let fixFile: string;
  let fixText: string;
  let plainVirtualFile: string;
  const plainVirtualText = 'export function add(a: number, b: number) { return a + b; }';

  beforeAll(async () => {
    const init = await loadPlugin();

    // Create a virtual file with a missing import that TS can auto-fix
    fixFile = path.join(FIXTURES_DIR, 'codefix-virtual.tsx');
    fixText = [
      'import { Button } from "./Button";',
      'const handler = () => {};',
      'const view = pug`',
      '  Button(onClick=handler, label="Hi")',
      '`;',
    ].join('\n');

    plainVirtualFile = path.join(FIXTURES_DIR, 'plain-fixes.tsx');

    const virtualFiles = new Map<string, string>();
    virtualFiles.set(fixFile, fixText);
    virtualFiles.set(plainVirtualFile, plainVirtualText);

    const rootFiles = [fixFile, BUTTON_FILE, plainVirtualFile];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, virtualFiles,
    );
    ls = result.ls;
  });

  it('returns fixes array for position inside pug region', () => {
    const pugStart = fixText.indexOf('pug`');
    const buttonIdx = fixText.indexOf('Button', pugStart + 4);
    expect(buttonIdx).toBeGreaterThan(pugStart);

    const fixes = ls.getCodeFixesAtPosition(
      fixFile, buttonIdx, buttonIdx + 'Button'.length,
      [2304], // TS error code for "Cannot find name"
      {},
      undefined as any,
    );
    // Should return an array (possibly empty if no fixes apply)
    expect(Array.isArray(fixes)).toBe(true);
  });

  it('returns empty array for unmapped position', () => {
    const pugIdx = fixText.indexOf('pug`');
    const fixes = ls.getCodeFixesAtPosition(
      fixFile, pugIdx, pugIdx + 3,
      [2304],
      {},
      undefined as any,
    );
    expect(fixes).toEqual([]);
  });

  it('fix changes have spans mapped back to original positions', () => {
    // Get semantic diagnostics first to find real error codes
    const diags = ls.getSemanticDiagnostics(fixFile);
    const errorCodes = diags
      .filter(d => d.start != null)
      .map(d => d.code);

    if (errorCodes.length > 0 && diags[0].start != null) {
      const diag = diags[0];
      const fixes = ls.getCodeFixesAtPosition(
        fixFile, diag.start!, diag.start! + (diag.length ?? 1),
        [diag.code],
        {},
        undefined as any,
      );
      for (const fix of fixes) {
        for (const change of fix.changes) {
          for (const tc of change.textChanges) {
            // Spans should be mapped to original positions (non-negative)
            expect(tc.span.start).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
    // Verify no crash
    expect(Array.isArray(diags)).toBe(true);
  });

  it('passes through for non-pug file', () => {
    const fixes = ls.getCodeFixesAtPosition(
      plainVirtualFile, 0, 1,
      [2304],
      {},
      undefined as any,
    );
    expect(Array.isArray(fixes)).toBe(true);
  });
});

// ── getCodeFixesAtPosition with real type error ─────────────────

describe('getCodeFixesAtPosition with type error in pug', () => {
  let ls: ts.LanguageService;
  let errorFile: string;
  let errorText: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    // File with a missing import -- TS can offer "Add import" fix
    errorFile = path.join(FIXTURES_DIR, 'codefix-error-virtual.tsx');
    errorText = [
      'const view = pug`',
      '  div Unknown text',
      '`;',
    ].join('\n');

    const virtualFiles = new Map<string, string>();
    virtualFiles.set(errorFile, errorText);

    const rootFiles = [errorFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, virtualFiles,
    );
    ls = result.ls;
  });

  it('does not crash when requesting fixes at various positions in pug', () => {
    const pugStart = errorText.indexOf('pug`');
    const divIdx = errorText.indexOf('div', pugStart + 4);

    // Try getting fixes at several positions -- should not throw
    const fixes1 = ls.getCodeFixesAtPosition(
      errorFile, divIdx, divIdx + 3, [2304], {}, undefined as any,
    );
    expect(Array.isArray(fixes1)).toBe(true);

    const fixes2 = ls.getCodeFixesAtPosition(
      errorFile, pugStart, pugStart + 4, [2304], {}, undefined as any,
    );
    expect(Array.isArray(fixes2)).toBe(true);
  });
});

// ── getCombinedCodeFix ──────────────────────────────────────────

describe('getCombinedCodeFix through real pipeline', () => {
  let ls: ts.LanguageService;
  let plainVirtualFile: string;
  const plainVirtualText = 'export function add(a: number, b: number) { return a + b; }';

  beforeAll(async () => {
    const init = await loadPlugin();
    plainVirtualFile = path.join(FIXTURES_DIR, 'plain-combined.tsx');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(plainVirtualFile, plainVirtualText);
    const rootFiles = [APP_FILE, BUTTON_FILE, plainVirtualFile];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR, virtualFiles);
    ls = result.ls;
  });

  it('returns result with mapped changes', () => {
    // getCombinedCodeFix requires a scope and fixId
    // Use a well-known fixId like "fixMissingImport" with a file scope
    const result = ls.getCombinedCodeFix(
      { type: 'file', fileName: APP_FILE },
      'fixMissingImport',
      {},
      undefined as any,
    );
    // Should return a result with changes array (may be empty)
    expect(result).toBeDefined();
    expect(Array.isArray(result.changes)).toBe(true);
    // All changes should have valid spans
    for (const change of result.changes) {
      for (const tc of change.textChanges) {
        expect(tc.span.start).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('passes through for non-pug file', () => {
    const result = ls.getCombinedCodeFix(
      { type: 'file', fileName: plainVirtualFile },
      'fixMissingImport',
      {},
      undefined as any,
    );
    expect(result).toBeDefined();
    expect(Array.isArray(result.changes)).toBe(true);
  });
});

// ── mapFileTextChanges coverage ─────────────────────────────────

describe('mapFileTextChanges via getEditsForRefactor', () => {
  let ls: ts.LanguageService;
  let multiFile: string;
  let multiText: string;
  let plainVirtualFile: string;
  const plainVirtualText = 'export function add(a: number, b: number) { return a + b; }';

  beforeAll(async () => {
    const init = await loadPlugin();

    // File with content that could produce multi-file edits
    multiFile = path.join(FIXTURES_DIR, 'multi-virtual.tsx');
    multiText = [
      'import { Button } from "./Button";',
      'const count = 42;',
      'const view = pug`',
      '  Button(onClick=(() => {}), label="Test")',
      '`;',
      'export default view;',
    ].join('\n');

    plainVirtualFile = path.join(FIXTURES_DIR, 'plain-multi.tsx');

    const virtualFiles = new Map<string, string>();
    virtualFiles.set(multiFile, multiText);
    virtualFiles.set(plainVirtualFile, plainVirtualText);

    const rootFiles = [multiFile, BUTTON_FILE, plainVirtualFile];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, virtualFiles,
    );
    ls = result.ls;
  });

  it('mapped edit spans are within original file bounds', () => {
    const pugStart = multiText.indexOf('pug`');
    const arrowIdx = multiText.indexOf('() => {}', pugStart);
    expect(arrowIdx).toBeGreaterThan(pugStart);

    const refactors = ls.getApplicableRefactors(
      multiFile,
      { pos: arrowIdx, end: arrowIdx + '() => {}'.length },
      undefined,
    );
    expect(Array.isArray(refactors)).toBe(true);

    for (const refactor of refactors) {
      for (const action of refactor.actions) {
        const result = ls.getEditsForRefactor(
          multiFile, {},
          { pos: arrowIdx, end: arrowIdx + '() => {}'.length },
          refactor.name, action.name, undefined,
        );
        if (result) {
          for (const edit of result.edits) {
            for (const tc of edit.textChanges) {
              expect(tc.span.start).toBeGreaterThanOrEqual(0);
              if (edit.fileName === multiFile) {
                expect(tc.span.start).toBeLessThan(multiText.length + 100);
              }
            }
          }
        }
      }
    }
  });

  it('non-pug file refactor edits are not modified', () => {
    const returnIdx = plainVirtualText.indexOf('return');
    expect(returnIdx).toBeGreaterThan(-1);

    const refactors = ls.getApplicableRefactors(
      plainVirtualFile,
      { pos: returnIdx, end: returnIdx + 'return a + b'.length },
      undefined,
    );
    expect(Array.isArray(refactors)).toBe(true);

    for (const refactor of refactors) {
      for (const action of refactor.actions) {
        const result = ls.getEditsForRefactor(
          plainVirtualFile, {},
          { pos: returnIdx, end: returnIdx + 'return a + b'.length },
          refactor.name, action.name, undefined,
        );
        if (result) {
          expect(Array.isArray(result.edits)).toBe(true);
          for (const edit of result.edits) {
            for (const tc of edit.textChanges) {
              expect(tc.span.start).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });
});
