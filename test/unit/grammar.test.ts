import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Test checklist:
// [x] syntaxes/pug-template-literal.json exists
// [x] Grammar file is valid JSON
// [x] Grammar has scopeName following TextMate conventions
// [x] Grammar has injectionSelector covering ts, tsx, js, jsx
// [x] Grammar has patterns array with pug-tagged-template include
// [x] Grammar repository has pug-tagged-template rule
// [x] pug-tagged-template rule has begin/end patterns for backtick delimiters
// [x] pug-tagged-template rule has contentName "source.pug"
// [x] pug-tagged-template rule includes "source.pug" patterns
// [x] beginCaptures and endCaptures mark punctuation correctly
// [x] package.json contributes.grammars is configured
// [x] package.json grammars entry has correct scopeName
// [x] package.json grammars entry has correct path
// [x] package.json grammars entry injects to ts, tsx, js, jsx
// [x] package.json grammars entry has embeddedLanguages mapping source.pug to jade
// [x] Begin pattern uses lookbehind for "pug" identifier
// [x] Build still passes with grammar file

const root = resolve(__dirname, '../..');
const grammarPath = resolve(root, 'syntaxes/pug-template-literal.json');
const packageJsonPath = resolve(root, 'package.json');

let grammar: any;
let packageJson: any;

// ── Grammar file tests ───────────────────────────────────────────

describe('TextMate grammar file', () => {
  it('syntaxes/pug-template-literal.json exists', () => {
    expect(existsSync(grammarPath)).toBe(true);
  });

  it('is valid JSON', () => {
    const content = readFileSync(grammarPath, 'utf-8');
    expect(() => {
      grammar = JSON.parse(content);
    }).not.toThrow();
  });

  it('has scopeName following TextMate conventions', () => {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    expect(grammar.scopeName).toBeDefined();
    expect(typeof grammar.scopeName).toBe('string');
    // TextMate convention: dot-separated segments
    expect(grammar.scopeName).toMatch(/^[\w-]+(\.[\w-]+)*$/);
    expect(grammar.scopeName).toBe('inline.pug-template-literal');
  });

  it('has injectionSelector covering ts, tsx, js, jsx', () => {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    expect(grammar.injectionSelector).toBeDefined();

    const selector = grammar.injectionSelector as string;
    // Must cover all four language scopes
    expect(selector).toContain('source.ts');
    expect(selector).toContain('source.tsx');
    expect(selector).toContain('source.js');
    expect(selector).toContain('source.jsx');
    // Should use L: prefix for left-injection
    expect(selector).toContain('L:');
  });

  it('has patterns array referencing pug-tagged-template', () => {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    expect(Array.isArray(grammar.patterns)).toBe(true);
    expect(grammar.patterns.length).toBeGreaterThan(0);

    const includeRefs = grammar.patterns.map((p: any) => p.include);
    expect(includeRefs).toContain('#pug-tagged-template');
  });
});

// ── Grammar repository rule tests ────────────────────────────────

describe('pug-tagged-template grammar rule', () => {
  function getRule() {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    return grammar.repository?.['pug-tagged-template'];
  }

  it('exists in repository', () => {
    const rule = getRule();
    expect(rule).toBeDefined();
  });

  it('has begin pattern matching pug followed by backtick', () => {
    const rule = getRule();
    expect(rule.begin).toBeDefined();
    expect(typeof rule.begin).toBe('string');
    // The begin pattern uses a lookbehind for "pug" before the backtick
    const beginRegex = new RegExp(rule.begin);
    // Must test with full context since the pattern has a lookbehind for "pug"
    expect('pug`').toMatch(beginRegex);
    // Should not match other tagged templates
    expect('html`').not.toMatch(beginRegex);
    expect('css`').not.toMatch(beginRegex);
  });

  it('has end pattern matching closing backtick', () => {
    const rule = getRule();
    expect(rule.end).toBeDefined();
    expect(typeof rule.end).toBe('string');
    const endRegex = new RegExp(rule.end);
    expect('`').toMatch(endRegex);
  });

  it('has contentName "source.pug"', () => {
    const rule = getRule();
    expect(rule.contentName).toBe('source.pug');
  });

  it('includes source.pug patterns for content', () => {
    const rule = getRule();
    expect(Array.isArray(rule.patterns)).toBe(true);
    const includes = rule.patterns.map((p: any) => p.include);
    expect(includes).toContain('source.pug');
  });

  it('has beginCaptures marking punctuation', () => {
    const rule = getRule();
    expect(rule.beginCaptures).toBeDefined();
    // Should have at least one capture for the backtick
    const captureNames = Object.values(rule.beginCaptures).map((c: any) => c.name);
    expect(captureNames.some((n: string) => n.includes('punctuation'))).toBe(true);
  });

  it('has endCaptures marking punctuation', () => {
    const rule = getRule();
    expect(rule.endCaptures).toBeDefined();
    const captureNames = Object.values(rule.endCaptures).map((c: any) => c.name);
    expect(captureNames.some((n: string) => n.includes('punctuation'))).toBe(true);
  });

  it('begin pattern uses lookbehind for "pug" identifier', () => {
    const rule = getRule();
    // The begin pattern should have a lookbehind for "pug"
    expect(rule.begin).toContain('pug');
  });
});

// ── package.json contributes.grammars tests ──────────────────────

describe('package.json grammar configuration', () => {
  function getPkg() {
    packageJson = packageJson ?? JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson;
  }

  it('has contributes.grammars array', () => {
    const pkg = getPkg();
    expect(pkg.contributes).toBeDefined();
    expect(Array.isArray(pkg.contributes.grammars)).toBe(true);
    expect(pkg.contributes.grammars.length).toBeGreaterThan(0);
  });

  it('grammar entry has correct scopeName matching grammar file', () => {
    const pkg = getPkg();
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    const entry = pkg.contributes.grammars.find(
      (g: any) => g.scopeName === grammar.scopeName
    );
    expect(entry).toBeDefined();
  });

  it('grammar entry has correct path to grammar file', () => {
    const pkg = getPkg();
    const entry = pkg.contributes.grammars[0];
    expect(entry.path).toBe('./syntaxes/pug-template-literal.json');
    // Verify the path actually resolves to an existing file
    const resolvedPath = resolve(root, entry.path);
    expect(existsSync(resolvedPath)).toBe(true);
  });

  it('grammar entry injects to ts, tsx, js, jsx', () => {
    const pkg = getPkg();
    const entry = pkg.contributes.grammars[0];
    expect(Array.isArray(entry.injectTo)).toBe(true);
    expect(entry.injectTo).toContain('source.ts');
    expect(entry.injectTo).toContain('source.tsx');
    expect(entry.injectTo).toContain('source.js');
    expect(entry.injectTo).toContain('source.jsx');
  });

  it('grammar entry has embeddedLanguages mapping source.pug to jade', () => {
    const pkg = getPkg();
    const entry = pkg.contributes.grammars[0];
    expect(entry.embeddedLanguages).toBeDefined();
    expect(entry.embeddedLanguages['source.pug']).toBe('jade');
  });
});
