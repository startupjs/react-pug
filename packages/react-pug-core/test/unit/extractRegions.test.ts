import { describe, it, expect } from 'vitest';
import { extractPugAnalysis, extractPugRegions } from '../../src/language/extractRegions';

// Test checklist:
// [x] Single pug template -- correct originalStart/End, pugTextStart/End, pugText
// [x] Multiple pug templates -- all found, sorted by offset
// [x] No pug templates -- returns empty array
// [x] Common indent stripping -- minimum indent removed from all lines
// [x] Template with ${} interpolation -- extracted without parseError
// [x] Nested in function/class -- correctly finds inside any TS construct
// [x] Decorators and generics -- @babel/parser handles them
// [x] File with syntax error -- error recovery (regex fallback)
// [x] Tag name 'pug' vs other tags (html, css) -- only matches 'pug'
// [x] Template with leading/trailing empty lines -- preserved in pugText
// [x] Single-line template -- works correctly
// [x] Whitespace-only template -- handled gracefully
// [x] JSX file (.jsx) -- works with JSX syntax
// [x] Multiple expressions in quasi -- preserved in pugText
// [x] Fast path: file without pug` string returns empty array immediately
// [x] pugText offsets allow slicing original text to get template content
// [x] Shadow fields initialized to defaults (shadowStart=0, shadowEnd=0, etc.)
// [x] Pug template with space before backtick: pug `...`

// ── Single template tests ────────────────────────────────────────

describe('single pug template', () => {
  it('extracts correct offsets for a simple template', () => {
    const text = 'const v = pug`\n  div Hello\n`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    const r = regions[0];

    // originalStart/End covers the entire pug`...` expression
    expect(r.originalStart).toBe(text.indexOf('pug`'));
    expect(r.originalEnd).toBe(text.length);

    // pugTextStart is after the opening backtick
    const openBacktick = text.indexOf('`');
    expect(r.pugTextStart).toBeGreaterThan(openBacktick);
    // pugTextEnd points at or just before the closing backtick
    expect(r.pugTextEnd).toBeLessThanOrEqual(text.lastIndexOf('`'));

    // The slice between pugTextStart and pugTextEnd should match the raw content
    const rawContent = text.slice(r.pugTextStart, r.pugTextEnd);
    expect(rawContent).toContain('div Hello');
  });

  it('pugText has common indent stripped', () => {
    const text = 'const v = pug`\n    div Hello\n    span World\n`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    // 4-space indent should be stripped from both lines
    expect(regions[0].pugText).toContain('div Hello');
    expect(regions[0].pugText).toContain('span World');
    expect(regions[0].pugText).not.toMatch(/^    div/m);
  });

  it('single-line template works correctly', () => {
    const text = 'const v = pug`div Hello`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('div Hello');
  });

  it('shadow fields are initialized to defaults', () => {
    const text = 'const v = pug`div`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    expect(regions[0].shadowStart).toBe(0);
    expect(regions[0].shadowEnd).toBe(0);
    expect(regions[0].tsxText).toBe('');
    expect(regions[0].mappings).toEqual([]);
    expect(regions[0].lexerTokens).toEqual([]);
    expect(regions[0].parseError).toBeNull();
  });
});

// ── Multiple templates ───────────────────────────────────────────

describe('multiple pug templates', () => {
  it('finds all templates in a file, sorted by offset', () => {
    const text = [
      'const a = pug`h1 Header`;',
      'const b = pug`p Body`;',
      'const c = pug`footer`;',
    ].join('\n');

    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(3);
    expect(regions[0].pugText).toBe('h1 Header');
    expect(regions[1].pugText).toBe('p Body');
    expect(regions[2].pugText).toBe('footer');

    // Sorted by offset
    expect(regions[0].originalStart).toBeLessThan(regions[1].originalStart);
    expect(regions[1].originalStart).toBeLessThan(regions[2].originalStart);
  });
});

// ── No templates ─────────────────────────────────────────────────

describe('no pug templates', () => {
  it('returns empty array for file without pug', () => {
    const text = 'const x = 42;\nexport default x;';
    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toEqual([]);
  });

  it('returns empty array for other tagged templates', () => {
    const text = 'const v = html`<div>hello</div>`;\nconst c = css`.foo {}`;';
    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toEqual([]);
  });

  it('fast path: skips parsing when no pug` in text', () => {
    // This should return immediately without calling @babel/parser
    const text = 'const x = 1; // no pug here';
    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toEqual([]);
  });
});

// ── Indent stripping ─────────────────────────────────────────────

describe('common indent stripping', () => {
  it('strips minimum indent from all non-empty lines', () => {
    const text = 'const v = pug`\n    .card\n      p Hello\n`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    // 4-space base indent stripped; p Hello retains 2 extra spaces
    const lines = regions[0].pugText.split('\n').filter(l => l.trim());
    expect(lines[0]).toBe('.card');
    expect(lines[1]).toBe('  p Hello');
  });

  it('does not strip when no common indent', () => {
    const text = 'const v = pug`\ndiv\n  span\n`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toContain('div');
    expect(regions[0].pugText).toContain('  span');
  });

  it('preserves leading/trailing empty lines in pugText', () => {
    const text = 'const v = pug`\n\n  div\n\n`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    // Empty lines are preserved but trimmed to ''
    const lines = regions[0].pugText.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Interpolation detection ──────────────────────────────────────

describe('template interpolation', () => {
  it('extracts template with ${} interpolation without parseError', () => {
    const text = 'const v = pug`div ${name}`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    expect(regions[0].parseError).toBeNull();
    expect(regions[0].pugText).toContain('${name}');
  });

  it('no parseError for template without interpolation', () => {
    const text = 'const v = pug`div Hello`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    expect(regions[0].parseError).toBeNull();
  });

  it('preserves multiple ${} expressions', () => {
    const text = 'const v = pug`div ${a} and ${b}`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    expect(regions[0].parseError).toBeNull();
    expect(regions[0].pugText).toContain('${a}');
    expect(regions[0].pugText).toContain('${b}');
  });

  it('does not create overlapping nested regions for pug inside ${}', () => {
    const text = [
      'const v = pug`',
      '  div',
      '    span= ${pug`span Nested`}',
      '`;',
    ].join('\n');
    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toContain('${pug`span Nested`}');
  });
});

// ── Nested in TS constructs ──────────────────────────────────────

describe('nested in TS constructs', () => {
  it('finds template inside a function', () => {
    const text = [
      'function render() {',
      '  return pug`div Hello`;',
      '}',
    ].join('\n');

    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('div Hello');
  });

  it('finds template inside a class method', () => {
    const text = [
      'class App {',
      '  render() {',
      '    return pug`span World`;',
      '  }',
      '}',
    ].join('\n');

    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('span World');
  });

  it('finds template inside arrow function', () => {
    const text = 'const App = () => pug`div`;';
    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('div');
  });

  it('handles decorators and generics', () => {
    const text = [
      'import { Component } from "react";',
      '',
      '@observer',
      'class App extends Component<Props, State> {',
      '  render() {',
      '    return pug`div Hello`;',
      '  }',
      '}',
    ].join('\n');

    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('div Hello');
  });
});

// ── Style scope/import analysis ────────────────────────────────

describe('style scope and import analysis', () => {
  it('targets the immediate enclosing arrow-expression scope', () => {
    const text = [
      "import { pug } from 'startupjs';",
      'function App() {',
      '  const renderItem = () => pug`',
      '    .title Hello',
      '    style',
      '      .title { color: red; }',
      '  `;',
      '}',
    ].join('\n');

    const analysis = extractPugAnalysis(text, 'app.tsx');

    expect(analysis.styleScopeTargets).toHaveLength(1);
    expect(analysis.styleScopeTargets[0].kind).toBe('arrow-expression');
    expect(analysis.styleScopeTargets[0].insertionOffset).toBe(text.indexOf('pug`'));
  });

  it('targets the immediate enclosing block scope', () => {
    const text = [
      "import { pug } from 'startupjs';",
      'function renderPage() {',
      '  if (visible) {',
      '    const view = pug`',
      '      .title Hello',
      "      style(lang='styl')",
      '        .title',
      '          color red',
      '    `;',
      '  }',
      '}',
    ].join('\n');

    const analysis = extractPugAnalysis(text, 'app.tsx');

    expect(analysis.styleScopeTargets).toHaveLength(1);
    expect(analysis.styleScopeTargets[0].kind).toBe('block');
    expect(analysis.styleScopeTargets[0].insertionOffset).toBe(text.indexOf('const view'));
  });

  it('targets single-line statement bodies so they can be normalized into blocks', () => {
    const text = [
      "import { pug } from 'startupjs';",
      'function App () {',
      '  if (x) return pug`',
      '    .title One',
      '    style',
      '      .one { color: red; }',
      '  `',
      '}',
    ].join('\n');

    const analysis = extractPugAnalysis(text, 'app.tsx');

    expect(analysis.styleScopeTargets).toHaveLength(1);
    expect(analysis.styleScopeTargets[0].kind).toBe('statement-body');
    expect(analysis.styleScopeTargets[0].insertionOffset).toBe(text.indexOf('return pug`'));
  });

  it('tracks helper import source metadata from the pug import module', () => {
    const text = [
      "import { css, pug } from 'startupjs';",
      'const view = pug`',
      '  .title Hello',
      '  style',
      '    .title { color: red; }',
      '`;',
    ].join('\n');

    const analysis = extractPugAnalysis(text, 'app.tsx');

    expect(analysis.tagImportSource).toBe('startupjs');
    expect(analysis.tagImportSourceText).toBe("'startupjs'");
    expect(analysis.existingStyleImports.has('css')).toBe(true);
    expect(analysis.helperImportInsertionOffset).toBeGreaterThan(0);
  });
});

// ── Error recovery ───────────────────────────────────────────────

describe('error recovery', () => {
  it('falls back to regex for files with syntax errors', () => {
    // Severely malformed TS that @babel/parser cannot handle
    const text = 'const {{{ = pug`div Hello`';
    const regions = extractPugRegions(text, 'app.tsx');

    // Regex fallback should still find the pug template
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('div Hello');
  });
});

// ── Tag name filtering ───────────────────────────────────────────

describe('tag name filtering', () => {
  it('only matches pug tag, not html/css/graphql', () => {
    const text = [
      'const a = pug`div`;',
      'const b = html`<div>`;',
      'const c = css`.foo {}`;',
      'const d = graphql`{ query }`;',
    ].join('\n');

    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('div');
  });
});

// ── Whitespace-only template ─────────────────────────────────────

describe('whitespace-only template', () => {
  it('handles template with only whitespace', () => {
    const text = 'const v = pug`   \n   \n   `';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    // Should not crash, pugText may be whitespace or empty after stripping
    expect(regions[0]).toBeDefined();
    expect(regions[0].parseError).toBeNull();
  });

  it('handles empty template', () => {
    const text = 'const v = pug``';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('');
    expect(regions[0].parseError).toBeNull();
  });
});

// ── File type handling ───────────────────────────────────────────

describe('file type handling', () => {
  it('works with .tsx files', () => {
    const text = 'const v = pug`div`;\nconst jsx = <span />;';
    const regions = extractPugRegions(text, 'app.tsx');
    expect(regions).toHaveLength(1);
  });

  it('works with .ts files', () => {
    const text = 'const v: string = pug`div` as any;';
    const regions = extractPugRegions(text, 'app.ts');
    expect(regions).toHaveLength(1);
  });

  it('works with .jsx files', () => {
    const text = 'const v = pug`div`;\nconst jsx = <span />;';
    const regions = extractPugRegions(text, 'app.jsx');
    expect(regions).toHaveLength(1);
  });

  it('works with .js files', () => {
    const text = 'const v = pug`div`;';
    const regions = extractPugRegions(text, 'app.js');
    expect(regions).toHaveLength(1);
  });
});

// ── Edge case: pug with space before backtick ────────────────────

describe('edge cases', () => {
  it('handles pug with space before backtick via fast path', () => {
    // The fast path checks for both 'pug`' and 'pug `'
    const text = 'const v = pug `div`';
    const regions = extractPugRegions(text, 'app.tsx');
    // @babel/parser should parse this as a tagged template
    expect(regions).toHaveLength(1);
    expect(regions[0].pugText).toBe('div');
  });

  it('pugTextStart/End allow correct slicing of original text', () => {
    const text = 'const v = pug`\n  div Hello\n`';
    const regions = extractPugRegions(text, 'app.tsx');

    expect(regions).toHaveLength(1);
    const r = regions[0];
    const sliced = text.slice(r.pugTextStart, r.pugTextEnd);
    expect(sliced).toBe('\n  div Hello\n');
  });
});
