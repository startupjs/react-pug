import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
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

// ── Pug parse error diagnostic spans ────────────────────────────

describe('pug parse error diagnostic spans', () => {
  let ls: ts.LanguageService;
  let errorFile: string;
  let errorText: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    // File with ${} interpolation to trigger parseError
    errorFile = path.join(FIXTURES_DIR, 'diag-span-error.tsx');
    errorText = 'const v = pug`${bad}`;';
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(errorFile, errorText);

    const rootFiles = [errorFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('pug parse error diagnostic has length > 1', () => {
    const diags = ls.getSemanticDiagnostics(errorFile);
    const pugDiag = diags.find(
      d => typeof d.messageText === 'string' && d.messageText.includes('Pug parse error'),
    );
    expect(pugDiag).toBeDefined();
    expect(pugDiag!.length).toBeGreaterThan(1);
  });

  it('pug parse error span starts at pugTextStart + offset', () => {
    const diags = ls.getSemanticDiagnostics(errorFile);
    const pugDiag = diags.find(
      d => typeof d.messageText === 'string' && d.messageText.includes('Pug parse error'),
    );
    expect(pugDiag).toBeDefined();
    // pugTextStart is right after the opening backtick
    const pugTextStart = errorText.indexOf('`') + 1;
    // The error start should be >= pugTextStart (pugTextStart + err.offset)
    expect(pugDiag!.start).toBeGreaterThanOrEqual(pugTextStart);
    // And within the original file bounds
    expect(pugDiag!.start! + pugDiag!.length!).toBeLessThanOrEqual(errorText.length);
  });

  it('pug parse error span extends to end of line or reasonable length', async () => {
    const initFn = await loadPlugin();

    // Single-line pug with ${} interpolation error
    // Here the error offset will point at the pug content after the backtick,
    // and the span should extend up to the closing backtick (end of content).
    const singleFile = path.join(FIXTURES_DIR, 'diag-span-single.tsx');
    const singleText = 'const v = pug`${bad} more text`;';
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(singleFile, singleText);

    const result = createLanguageServiceWithPlugin(
      initFn, [singleFile, BUTTON_FILE], FIXTURES_DIR, {}, virtualFiles,
    );

    const diags = result.ls.getSemanticDiagnostics(singleFile);
    const pugDiag = diags.find(
      d => typeof d.messageText === 'string' && d.messageText.includes('Pug parse error'),
    );
    expect(pugDiag).toBeDefined();

    // The error length should be > 1 (highlights a meaningful span, not just 1 char)
    // For single-line content without a newline, it uses Math.min(textAfterError.length, 20)
    expect(pugDiag!.length).toBeGreaterThan(1);

    // The span should not extend beyond the original file
    const errorEnd = pugDiag!.start! + pugDiag!.length!;
    expect(errorEnd).toBeLessThanOrEqual(singleText.length);
  });

  it('pug parse error has code 99001 and source pug-react', () => {
    const diags = ls.getSemanticDiagnostics(errorFile);
    const pugDiag = diags.find(
      d => typeof d.messageText === 'string' && d.messageText.includes('Pug parse error'),
    );
    expect(pugDiag).toBeDefined();
    expect(pugDiag!.code).toBe(99001);
    expect(pugDiag!.source).toBe('pug-react');
    expect(pugDiag!.category).toBe(ts.DiagnosticCategory.Error);
  });
});

// ── SUPPRESSED_DIAG_CODES filtering ──────────────────────────────

describe('suppressed diagnostic codes inside pug regions', () => {
  // The plugin suppresses codes 2503 ("Cannot find namespace 'JSX'") and
  // 1109 ("Expression expected") when they occur inside pug regions, since
  // these are false positives from the generated TSX shadow code.

  let ls: ts.LanguageService;
  let wellTypedFile: string;
  let wellTypedText: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    // A well-typed file with pug that should produce zero semantic errors
    // after suppression filtering. The import and component usage are valid.
    // Note: no inline text after Button() -- ButtonProps doesn't have children.
    wellTypedFile = path.join(FIXTURES_DIR, 'diag-suppress-welltyped.tsx');
    wellTypedText = [
      'import { Button } from "./Button";',
      'const handler = () => {};',
      'const view = pug`',
      '  Button(onClick=handler, label="Test")',
      '`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(wellTypedFile, wellTypedText);

    const rootFiles = [wellTypedFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('well-typed pug file produces zero semantic diagnostics', () => {
    const diags = ls.getSemanticDiagnostics(wellTypedFile);
    // All diagnostics should be filtered: suppressed codes (2503, 1109) inside
    // pug regions get removed, and unmapped synthetic positions get filtered.
    expect(diags).toHaveLength(0);
  });

  it('no diagnostics with code 2503 appear for pug files', () => {
    const diags = ls.getSemanticDiagnostics(wellTypedFile);
    const jsxNamespaceDiags = diags.filter(d => d.code === 2503);
    expect(jsxNamespaceDiags).toHaveLength(0);
  });

  it('no diagnostics with code 1109 appear for pug files', () => {
    // Check both semantic and syntactic diagnostics for code 1109
    const semanticDiags = ls.getSemanticDiagnostics(wellTypedFile);
    const syntacticDiags = ls.getSyntacticDiagnostics(wellTypedFile);
    const allDiags = [...semanticDiags, ...syntacticDiags];
    const expressionExpected = allDiags.filter(d => d.code === 1109);
    expect(expressionExpected).toHaveLength(0);
  });

  it('suppressed codes outside pug regions are NOT filtered', async () => {
    const init = await loadPlugin();

    // A file where code 1109 would appear OUTSIDE a pug region
    // should NOT be suppressed. We create a file with a syntax error
    // outside pug to verify non-pug diagnostics pass through.
    const outsideFile = path.join(FIXTURES_DIR, 'diag-suppress-outside.tsx');
    const outsideText = [
      'const x = ;',  // Expression expected (code 1109) outside pug
      'const view = pug`div`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(outsideFile, outsideText);

    const rootFiles = [outsideFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );

    const syntacticDiags = result.ls.getSyntacticDiagnostics(outsideFile);
    // The "Expression expected" error at "const x = ;" is OUTSIDE the pug region
    // so it should NOT be suppressed
    const expressionExpected = syntacticDiags.filter(d => d.code === 1109);
    expect(expressionExpected.length).toBeGreaterThan(0);

    // And the diagnostic position should be in the original file area (before pug)
    for (const diag of expressionExpected) {
      expect(diag.start).toBeDefined();
      expect(diag.start!).toBeLessThan(outsideText.indexOf('pug`'));
    }
  });
});

// ── Non-suppressed diagnostic codes pass through ─────────────────

describe('non-suppressed diagnostics pass through when mappable', () => {
  let ls: ts.LanguageService;
  let typeErrorFile: string;
  let typeErrorText: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    // A file with a real type error inside pug -- onClick expects () => void
    // but we pass a string. This should produce a diagnostic that is NOT
    // in the suppressed set (2503, 1109), so it should pass through.
    typeErrorFile = path.join(FIXTURES_DIR, 'diag-nonsuppressed.tsx');
    typeErrorText = [
      'import { Button } from "./Button";',
      'const view = pug`',
      '  Button(onClick="not-a-function", label="Test")',
      '`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(typeErrorFile, typeErrorText);

    const rootFiles = [typeErrorFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('type errors inside pug are not filtered when code is not suppressed', () => {
    const diags = ls.getSemanticDiagnostics(typeErrorFile);
    // Should have at least one type error (onClick type mismatch)
    // Filter to only non-suppressed, non-pug-parse-error diagnostics
    const realErrors = diags.filter(
      d => d.code !== 2503 && d.code !== 1109 && d.code !== 99001,
    );
    expect(realErrors.length).toBeGreaterThan(0);
  });

  it('mapped diagnostic positions are within original file bounds', () => {
    const diags = ls.getSemanticDiagnostics(typeErrorFile);
    for (const diag of diags) {
      if (diag.start != null) {
        expect(diag.start).toBeGreaterThanOrEqual(0);
        expect(diag.start).toBeLessThan(typeErrorText.length);
      }
    }
  });
});

// ── Mapped diagnostic length >= 1 ───────────────────────────────

describe('mapped diagnostic length guarantee', () => {
  let ls: ts.LanguageService;
  let file: string;
  let text: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    // A file with a type error where the mapped length should be >= 1
    file = path.join(FIXTURES_DIR, 'diag-length.tsx');
    text = [
      'import { Button } from "./Button";',
      'const view = pug`',
      '  Button(onClick="bad")',
      '`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(file, text);

    const rootFiles = [file, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('all mapped diagnostics have length >= 1', () => {
    const semanticDiags = ls.getSemanticDiagnostics(file);
    const syntacticDiags = ls.getSyntacticDiagnostics(file);
    const suggestionDiags = ls.getSuggestionDiagnostics(file);
    const allDiags = [...semanticDiags, ...syntacticDiags, ...suggestionDiags];

    for (const diag of allDiags) {
      if (diag.start != null && diag.length != null) {
        expect(diag.length, `diagnostic code ${diag.code} should have length >= 1`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('pug parse error diagnostics have length >= 1', async () => {
    const init = await loadPlugin();
    const errorFile = path.join(FIXTURES_DIR, 'diag-length-error.tsx');
    const errorText = 'const v = pug`${x}`;';
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
    expect(pugDiag!.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Diagnostics without position pass through ────────────────────

describe('diagnostics without position pass through', () => {
  it('global diagnostics (no start) are preserved', async () => {
    const init = await loadPlugin();

    // A file with pug that may produce global diagnostics
    const file = path.join(FIXTURES_DIR, 'diag-global.tsx');
    const text = [
      'import { Button } from "./Button";',
      'const v = pug`Button(onClick=() => {}, label="Hi")`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(file, text);

    const rootFiles = [file, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );

    const diags = result.ls.getSemanticDiagnostics(file);
    expect(Array.isArray(diags)).toBe(true);

    // Every returned diagnostic should have valid structure
    for (const diag of diags) {
      expect(diag).toBeDefined();
      expect(typeof diag.code).toBe('number');
      expect(typeof diag.messageText === 'string' || typeof diag.messageText === 'object').toBe(true);
      expect(diag.category).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Diagnostics in synthetic regions are filtered ────────────────

describe('diagnostics in synthetic/unmapped regions', () => {
  let ls: ts.LanguageService;
  let file: string;
  let text: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    // A file with pug -- the generated TSX has synthetic brackets and fragments
    // that don't map back to original positions. Diagnostics at those positions
    // should be filtered out (shadowToOriginal returns null for them).
    file = path.join(FIXTURES_DIR, 'diag-synthetic.tsx');
    text = [
      'import { Button } from "./Button";',
      'const handler = () => {};',
      'const view = pug`',
      '  Button(onClick=handler, label="Test") Click',
      '`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(file, text);

    const rootFiles = [file, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('no diagnostics have positions outside original file bounds', () => {
    const allDiags = [
      ...ls.getSemanticDiagnostics(file),
      ...ls.getSyntacticDiagnostics(file),
      ...ls.getSuggestionDiagnostics(file),
    ];

    for (const diag of allDiags) {
      if (diag.start != null) {
        expect(diag.start).toBeGreaterThanOrEqual(0);
        expect(diag.start).toBeLessThan(text.length);
        if (diag.length != null) {
          expect(diag.start + diag.length).toBeLessThanOrEqual(text.length);
        }
      }
    }
  });
});

// ── All three diagnostic methods apply filtering ─────────────────

describe('all diagnostic methods apply filtering consistently', () => {
  let ls: ts.LanguageService;
  let file: string;
  let text: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    file = path.join(FIXTURES_DIR, 'diag-consistent.tsx');
    text = [
      'import { Button } from "./Button";',
      'const handler = () => {};',
      'const view = pug`',
      '  Button(onClick=handler, label="Test")',
      '`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(file, text);

    const rootFiles = [file, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('getSemanticDiagnostics applies mapping and filtering', () => {
    const diags = ls.getSemanticDiagnostics(file);
    expect(Array.isArray(diags)).toBe(true);
    // No suppressed codes should appear
    for (const d of diags) {
      if (d.start != null) {
        expect(d.start).toBeGreaterThanOrEqual(0);
        expect(d.start).toBeLessThan(text.length);
      }
    }
  });

  it('getSyntacticDiagnostics applies mapping and filtering', () => {
    const diags = ls.getSyntacticDiagnostics(file);
    expect(Array.isArray(diags)).toBe(true);
    for (const d of diags) {
      if (d.start != null) {
        expect(d.start).toBeGreaterThanOrEqual(0);
        expect(d.start).toBeLessThan(text.length);
      }
    }
  });

  it('getSuggestionDiagnostics applies mapping and filtering', () => {
    const diags = ls.getSuggestionDiagnostics(file);
    expect(Array.isArray(diags)).toBe(true);
    for (const d of diags) {
      if (d.start != null) {
        expect(d.start).toBeGreaterThanOrEqual(0);
        expect(d.start).toBeLessThan(text.length);
      }
    }
  });
});

// ── Non-pug file diagnostics pass through unchanged ──────────────

describe('non-pug file diagnostics are unaffected', () => {
  let ls: ts.LanguageService;
  let plainFile: string;
  let plainText: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    plainFile = path.join(FIXTURES_DIR, 'diag-plain.tsx');
    plainText = [
      'function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      'add(1, "two");', // Type error: string not assignable to number
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(plainFile, plainText);

    const rootFiles = [plainFile, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('type error in plain tsx file is reported unchanged', () => {
    const diags = ls.getSemanticDiagnostics(plainFile);
    // Should have at least one error for add(1, "two")
    expect(diags.length).toBeGreaterThan(0);

    // Error should point to the "two" argument
    const typeError = diags.find(d => d.code === 2345); // Argument not assignable
    expect(typeError).toBeDefined();
    expect(typeError!.start).toBeDefined();
    // Position should be at or near "two" in the original text
    const twoIdx = plainText.indexOf('"two"');
    expect(typeError!.start).toBe(twoIdx);
  });

  it('non-pug file diagnostics are not filtered or modified', () => {
    const diags = ls.getSemanticDiagnostics(plainFile);
    // No diagnostics should be filtered -- all should pass through
    for (const diag of diags) {
      if (diag.start != null) {
        expect(diag.start).toBeGreaterThanOrEqual(0);
        expect(diag.start).toBeLessThan(plainText.length);
      }
    }
  });
});

// ── Complex pug expression range mapping precision ──────────────

describe('complex pug expression diagnostics map to exact symbol ranges', () => {
  let ls: ts.LanguageService;
  let file: string;
  let text: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    file = path.join(FIXTURES_DIR, 'diag-complex-ranges.tsx');
    text = [
      'type Row = { id: number };',
      'const rowsA: Row[] = [];',
      'const rowsB: Row[] = [];',
      'const view = pug`',
      '  h3 Value #{missingInterp + 1}',
      '  - const localValue = missingCode + 1',
      '  each row in (missingEach ? rowsA : rowsB)',
      '    span= row.id',
      '`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(file, text);

    const rootFiles = [file, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('maps missing names in interpolation, "-" code line, and each object expression exactly', () => {
    const diags = ls.getSemanticDiagnostics(file);

    const expected = [
      'missingInterp',
      'missingCode',
      'missingEach',
    ];

    for (const name of expected) {
      const expectedStart = text.indexOf(name);
      expect(expectedStart).toBeGreaterThanOrEqual(0);

      const diag = diags.find((d) => {
        const msg = typeof d.messageText === 'string' ? d.messageText : '';
        return d.code === 2304 && msg.includes(name);
      });

      expect(diag, `Expected TS2304 diagnostic for ${name}`).toBeDefined();
      expect(diag!.start, `Unexpected mapped start for ${name}`).toBe(expectedStart);
      expect(diag!.length, `Unexpected mapped length for ${name}`).toBe(name.length);
    }
  });

  it('does not report parser-like syntax errors for valid each/object and code block expressions', () => {
    const syntactic = ls.getSyntacticDiagnostics(file);
    const problematic = syntactic.filter((d) => d.code === 1136 || d.code === 1109);
    expect(problematic).toHaveLength(0);
  });
});

// ── else + each and pipe text regressions ──────────────────────

describe('else branch each and piped text are compiled without false diagnostics', () => {
  let ls: ts.LanguageService;
  let file: string;
  let text: string;

  beforeAll(async () => {
    const init = await loadPlugin();

    file = path.join(FIXTURES_DIR, 'diag-else-each-pipe.tsx');
    text = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'type Todo = { id: number; text: string; done: boolean };',
      'const activeTodos: Todo[] = [{ id: 1, text: "A", done: false }];',
      'const view = pug`',
      '  if activeTodos.length === 0',
      '    span',
      '      | Hello',
      '      | World',
      '  else',
      '    each todo in activeTodos',
      '      span= todo.text',
      '`;',
    ].join('\n');
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(file, text);

    const rootFiles = [file, BUTTON_FILE];
    const result = createLanguageServiceWithPlugin(
      init, rootFiles, FIXTURES_DIR, {}, virtualFiles,
    );
    ls = result.ls;
  });

  it('does not report parser-like syntax diagnostics for else+each', () => {
    const syntactic = ls.getSyntacticDiagnostics(file);
    const problematic = syntactic.filter((d) => d.code === 1136 || d.code === 1109 || d.code === 1005);
    expect(problematic).toHaveLength(0);
  });

  it('does not report false ReactNode assignment errors for else+each branch', () => {
    const semantic = ls.getSemanticDiagnostics(file);
    const falsePositive = semantic.filter((d) => d.code === 2322);
    expect(falsePositive).toHaveLength(0);
  });

  it('does not report pug parse errors for piped text nodes', () => {
    const semantic = ls.getSemanticDiagnostics(file);
    const pugParseErrors = semantic.filter((d) => d.code === 99001);
    expect(pugParseErrors).toHaveLength(0);
  });
});
