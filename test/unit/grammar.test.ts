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

  it('keeps class shorthand matching available before generic tag-line matching', () => {
    const rule = getRule();
    const includes = rule.patterns.map((p: any) => p.include);
    const tagLineIdx = includes.indexOf('#pug-tag-line');
    const classIdx = includes.indexOf('#pug-class-id-shorthand');
    expect(tagLineIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeLessThan(tagLineIdx);
  });
});

describe('highlighting regressions for tag/class/equals lines', () => {
  function getTagLineRule() {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    return grammar.repository?.['pug-tag-line'];
  }

  function getTagOutputRule() {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    return grammar.repository?.['pug-tag-output-expression'];
  }

  it('tag-line regex matches tags/components followed by class shorthand and "="', () => {
    const rule = getTagLineRule();
    expect(rule).toBeDefined();
    expect(Array.isArray(rule.patterns)).toBe(true);

    const componentRegex = new RegExp(rule.patterns[0].match);
    const htmlRegex = new RegExp(rule.patterns[1].match);

    expect('Button').toMatch(componentRegex);
    expect('Button.primary').toMatch(componentRegex);
    expect('Button=').toMatch(componentRegex);

    expect('span').toMatch(htmlRegex);
    expect('span.bold').toMatch(htmlRegex);
    expect('span=').toMatch(htmlRegex);
    expect('span.bold=').toMatch(htmlRegex);
  });

  it('tag output expression has specialized begin patterns for component/tag with optional class', () => {
    const rule = getTagOutputRule();
    expect(rule).toBeDefined();
    expect(Array.isArray(rule.patterns)).toBe(true);
    expect(rule.patterns.length).toBeGreaterThanOrEqual(3);

    const componentBegin = new RegExp(rule.patterns[0].begin);
    const tagBegin = new RegExp(rule.patterns[1].begin);

    expect('Button.primary= activeTodos.length').toMatch(componentBegin);
    expect('span.bold= activeTodos.length').toMatch(tagBegin);
    expect('if a = b').not.toMatch(tagBegin);
  });

  it('class shorthand regex captures both tag/component prefix and class suffix', () => {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    const classRule = grammar.repository?.['pug-class-id-shorthand'];
    expect(classRule).toBeDefined();
    expect(Array.isArray(classRule.patterns)).toBe(true);

    const componentWithClass = new RegExp(classRule.patterns[1].match);
    const tagWithClass = new RegExp(classRule.patterns[2].match);

    expect('Button.primary').toMatch(componentWithClass);
    expect('span.bold').toMatch(tagWithClass);
  });

  it('defines unbuffered "-" code rule with embedded TS/TSX patterns', () => {
    grammar = grammar ?? JSON.parse(readFileSync(grammarPath, 'utf-8'));
    const rule = grammar.repository?.['pug-unbuffered-code-expression'];
    expect(rule).toBeDefined();
    expect(typeof rule.begin).toBe('string');
    expect(rule.begin).toContain('(-)');
    expect(rule.name).toBe('meta.embedded.expression.pug.unbuffered');
    expect(Array.isArray(rule.patterns)).toBe(true);
    const includes = rule.patterns.map((p: any) => p.include);
    expect(includes).toContain('source.ts');
    expect(includes).toContain('source.tsx');
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
