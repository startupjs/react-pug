import { describe, it, expect } from 'vitest';
import { buildShadowDocument } from '../../src/language/shadowDocument';

// ── No pug regions (passthrough) ────────────────────────────────

describe('no pug regions', () => {
  it('returns original text as shadow text', () => {
    const text = 'const x = 10;\nexport default x;\n';
    const doc = buildShadowDocument(text, 'test.ts');
    expect(doc.shadowText).toBe(text);
  });

  it('returns empty regions array', () => {
    const text = 'import React from "react";\n';
    const doc = buildShadowDocument(text, 'app.tsx');
    expect(doc.regions).toHaveLength(0);
  });

  it('returns empty regionDeltas', () => {
    const text = 'function hello() { return 42; }';
    const doc = buildShadowDocument(text, 'test.ts');
    expect(doc.regionDeltas).toHaveLength(0);
  });

  it('preserves uri and version', () => {
    const text = 'const a = 1;';
    const doc = buildShadowDocument(text, 'my/file.tsx', 7);
    expect(doc.uri).toBe('my/file.tsx');
    expect(doc.version).toBe(7);
    expect(doc.originalText).toBe(text);
  });

  it('defaults version to 1', () => {
    const doc = buildShadowDocument('const x = 1;', 'test.ts');
    expect(doc.version).toBe(1);
  });

  it('handles empty file', () => {
    const doc = buildShadowDocument('', 'empty.ts');
    expect(doc.shadowText).toBe('');
    expect(doc.regions).toHaveLength(0);
    expect(doc.regionDeltas).toHaveLength(0);
  });
});

// ── Single pug region ───────────────────────────────────────────

describe('single pug region', () => {
  it('replaces pug`...` with generated TSX', () => {
    const text = 'const v = pug`div`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    expect(doc.shadowText).not.toContain('pug`');
    expect(doc.shadowText).toContain('<div');
  });

  it('preserves text before the pug region', () => {
    const text = 'const view = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.shadowText.startsWith('const view = ')).toBe(true);
  });

  it('preserves text after the pug region', () => {
    const text = 'const v = pug`div`;\nconst tail = true;';
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.shadowText).toContain('const tail = true;');
  });

  it('sets shadowStart/shadowEnd correctly', () => {
    const text = 'const v = pug`div`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    const region = doc.regions[0];

    // shadowStart should match the position of pug`...` in the original
    // but adjusted by cumulative delta (which is 0 for the first region)
    expect(region.shadowStart).toBe(region.originalStart);

    // Extracting from shadow text using shadow offsets should yield the TSX
    const extracted = doc.shadowText.slice(region.shadowStart, region.shadowEnd);
    expect(extracted).toBe(region.tsxText);
  });

  it('computes regionDeltas with first entry as 0', () => {
    const text = 'const v = pug`div`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.regionDeltas).toHaveLength(1);
    expect(doc.regionDeltas[0]).toBe(0);
  });

  it('populates tsxText from compilation', () => {
    const text = 'const v = pug`Button`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    const region = doc.regions[0];
    expect(region.tsxText).toContain('<Button');
    expect(region.tsxText).toContain('/>');
  });

  it('populates mappings from compilation', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    const region = doc.regions[0];
    expect(region.mappings.length).toBeGreaterThan(0);
    // Should have mappings for 'Button', 'onClick', 'handler'
    const allLengths = region.mappings.flatMap(m => m.lengths);
    expect(allLengths).toContain('Button'.length);
    expect(allLengths).toContain('onClick'.length);
    expect(allLengths).toContain('handler'.length);
  });

  it('populates lexerTokens from compilation', () => {
    const text = 'const v = pug`div.card`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    const region = doc.regions[0];
    expect(region.lexerTokens.length).toBeGreaterThan(0);
    // Should have a 'tag' token for 'div' and a 'class' token for '.card'
    const types = region.lexerTokens.map(t => t.type);
    expect(types).toContain('tag');
    expect(types).toContain('class');
  });

  it('sets parseError to null for valid pug', () => {
    const text = 'const v = pug`div`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.regions[0].parseError).toBeNull();
  });

  it('auto class strategy switches to styleName+classnames when startupjs marker is present', () => {
    const text = [
      'import { pug } from "startupjs";',
      'const active = { active: true };',
      'const v = pug`span.title(styleName=active)`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.shadowText).toContain('styleName={["title", active]}');
    expect(doc.shadowText).not.toContain('className="title"');
  });

  it('removes the pug import binding from shadow output', () => {
    const text = [
      'import { pug, observer } from "startupjs";',
      'const v = pug`span.title`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.shadowText).toContain('import { observer } from "startupjs";');
    expect(doc.shadowText).not.toContain('{ pug, observer }');
    expect(doc.importCleanups).toHaveLength(1);
  });

  it('reports a missing import diagnostic in shadow metadata when required', () => {
    const text = 'const v = pug`span.title`;';
    const doc = buildShadowDocument(text, 'test.tsx', 1, 'pug', { requirePugImport: true });
    expect(doc.missingTagImport).toEqual({
      message: 'Missing import for tag function "pug"',
      start: text.indexOf('pug`'),
      length: 'pug'.length,
    });
  });
});

// ── Multiple regions ────────────────────────────────────────────

describe('multiple pug regions', () => {
  it('handles two pug regions', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(2);
    expect(doc.shadowText).toContain('<div');
    expect(doc.shadowText).toContain('<span');
    expect(doc.shadowText).not.toContain('pug`');
  });

  it('shadow offsets are correct for each region', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    for (const region of doc.regions) {
      const extracted = doc.shadowText.slice(region.shadowStart, region.shadowEnd);
      expect(extracted).toBe(region.tsxText);
    }
  });

  it('second region shadowStart accounts for first region delta', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    const r0 = doc.regions[0];
    const r1 = doc.regions[1];

    // Delta from first region
    const origLen0 = r0.originalEnd - r0.originalStart;
    const delta0 = r0.tsxText.length - origLen0;

    // Second region's shadowStart = originalStart + cumulative delta
    expect(r1.shadowStart).toBe(r1.originalStart + delta0);
  });

  it('regionDeltas accumulates correctly for two regions', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regionDeltas).toHaveLength(2);
    expect(doc.regionDeltas[0]).toBe(0);

    const r0 = doc.regions[0];
    const origLen0 = r0.originalEnd - r0.originalStart;
    const delta0 = r0.tsxText.length - origLen0;
    expect(doc.regionDeltas[1]).toBe(delta0);
  });

  it('handles three pug regions with correct cumulative deltas', () => {
    const text = [
      'const a = pug`div`;',
      'const b = pug`span`;',
      'const c = pug`Button`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(3);
    expect(doc.regionDeltas).toHaveLength(3);
    expect(doc.regionDeltas[0]).toBe(0);

    // Verify cumulative deltas
    let cumDelta = 0;
    for (let i = 0; i < doc.regions.length; i++) {
      expect(doc.regionDeltas[i]).toBe(cumDelta);

      const region = doc.regions[i];
      const origLen = region.originalEnd - region.originalStart;
      cumDelta += region.tsxText.length - origLen;

      // Verify shadow extraction
      const extracted = doc.shadowText.slice(region.shadowStart, region.shadowEnd);
      expect(extracted).toBe(region.tsxText);
    }
  });

  it('preserves text between regions', () => {
    const text = 'const a = pug`div`;\nconst middle = 42;\nconst b = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.shadowText).toContain('const middle = 42;');
  });
});

// ── Region offset accuracy ──────────────────────────────────────

describe('region offset accuracy', () => {
  it('shadowEnd = shadowStart + tsxText.length', () => {
    const text = 'const v = pug`div.card`;\nexport default v;';
    const doc = buildShadowDocument(text, 'test.tsx');
    const region = doc.regions[0];
    expect(region.shadowEnd).toBe(region.shadowStart + region.tsxText.length);
  });

  it('shadow text length accounts for all deltas', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    let totalDelta = 0;
    for (const region of doc.regions) {
      const origLen = region.originalEnd - region.originalStart;
      totalDelta += region.tsxText.length - origLen;
    }
    expect(doc.shadowText.length).toBe(text.length + totalDelta);
  });

  it('no pug` substring remains in shadow text', () => {
    const text = [
      'const x = pug`div`;',
      'const y = pug`span.hello`;',
      'const z = pug`Button(onClick=handler)`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');
    expect(doc.shadowText).not.toContain('pug`');
  });

  it('shadow text starts and ends the same as original when pug is in the middle', () => {
    const text = 'import React from "react";\nconst v = pug`div`;\nexport default v;\n';
    const doc = buildShadowDocument(text, 'test.tsx');

    // Text before first region should be identical
    const r0 = doc.regions[0];
    expect(doc.shadowText.slice(0, r0.shadowStart)).toBe(text.slice(0, r0.originalStart));

    // Text after last region should be identical
    expect(doc.shadowText.slice(r0.shadowEnd)).toBe(text.slice(r0.originalEnd));
  });
});

// ── Template interpolation support ──────────────────────────────

describe('template interpolation support', () => {
  it('${} interpolation compiles and keeps mappings', () => {
    const text = 'const v = pug`span= ${badName}`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.parseError).toBeNull();
    expect(region.tsxText).toContain('badName');
    expect(region.mappings.length).toBeGreaterThan(0);
  });

  it('nested pug inside ${} is compiled (no raw inner pug remains)', () => {
    const text = [
      'const v = pug`',
      '  div',
      '    span= ${pug`Button(label="x")`}',
      '`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.parseError).toBeNull();
    expect(region.tsxText).toContain('<Button');
    expect(region.tsxText).not.toContain('pug`Button');
  });
});

// ── Empty pug template ──────────────────────────────────────────

describe('empty pug template', () => {
  it('empty pug`` uses null placeholder', () => {
    const text = 'const v = pug``;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.tsxText).toContain('null');
    expect(region.tsxText).toContain('JSX.Element');
  });

  it('empty pug with correct shadow offsets', () => {
    const text = 'const v = pug``;\nconst end = 1;';
    const doc = buildShadowDocument(text, 'test.tsx');

    const region = doc.regions[0];
    const extracted = doc.shadowText.slice(region.shadowStart, region.shadowEnd);
    expect(extracted).toBe(region.tsxText);
    expect(doc.shadowText).toContain('const end = 1;');
  });
});

// ── Edge cases: pug at start/end of file ────────────────────────

describe('pug at file boundaries', () => {
  it('pug at the very start of the file', () => {
    const text = 'pug`div`';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    // shadowStart should be 0 (at beginning of file)
    expect(region.shadowStart).toBe(0);
    expect(doc.shadowText).toContain('<div');
    expect(doc.shadowText).not.toContain('pug`');
  });

  it('pug at the very end of the file', () => {
    const text = 'const v = pug`span`';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.shadowEnd).toBe(doc.shadowText.length);
    expect(doc.shadowText).toContain('<span');
  });

  it('pug is the entire file content', () => {
    const text = 'pug`div.card`';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.shadowStart).toBe(0);
    expect(region.shadowEnd).toBe(doc.shadowText.length);
    expect(doc.shadowText).toBe(region.tsxText);
  });
});

// ── Complex file ────────────────────────────────────────────────

describe('complex file with mixed content', () => {
  it('handles imports, functions, pug templates, and exports', () => {
    const text = [
      'import React from "react";',
      'import { useState } from "react";',
      '',
      'function Header() {',
      '  return pug`',
      '    .header',
      '      h1 My App',
      '  `;',
      '}',
      '',
      'function Footer() {',
      '  return pug`',
      '    .footer',
      '      p Copyright 2024',
      '  `;',
      '}',
      '',
      'export { Header, Footer };',
    ].join('\n');
    const doc = buildShadowDocument(text, 'components.tsx');

    expect(doc.regions).toHaveLength(2);

    // Imports preserved
    expect(doc.shadowText).toContain('import React from "react"');
    expect(doc.shadowText).toContain('import { useState }');

    // Function structures preserved
    expect(doc.shadowText).toContain('function Header()');
    expect(doc.shadowText).toContain('function Footer()');

    // Pug replaced with TSX
    expect(doc.shadowText).not.toContain('pug`');
    expect(doc.shadowText).toContain('className="header"');
    expect(doc.shadowText).toContain('My App');
    expect(doc.shadowText).toContain('className="footer"');
    expect(doc.shadowText).toContain('Copyright 2024');

    // Exports preserved
    expect(doc.shadowText).toContain('export { Header, Footer }');

    // Shadow positions consistent
    for (const region of doc.regions) {
      const extracted = doc.shadowText.slice(region.shadowStart, region.shadowEnd);
      expect(extracted).toBe(region.tsxText);
    }
  });

  it('handles class component with pug', () => {
    const text = [
      'import React from "react";',
      'class MyComponent extends React.Component {',
      '  render() {',
      '    return pug`',
      '      .wrapper',
      '        h2 Hello',
      '    `;',
      '  }',
      '}',
      'export default MyComponent;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'comp.tsx');

    expect(doc.regions).toHaveLength(1);
    expect(doc.shadowText).toContain('class MyComponent');
    expect(doc.shadowText).toContain('render()');
    expect(doc.shadowText).toContain('className="wrapper"');
    expect(doc.shadowText).toContain('Hello');
    expect(doc.shadowText).toContain('export default MyComponent;');
    expect(doc.shadowText).not.toContain('pug`');
  });

  it('handles arrow function with pug', () => {
    const text = 'const App = () => pug`div Hello`;\nexport default App;';
    const doc = buildShadowDocument(text, 'app.tsx');

    expect(doc.regions).toHaveLength(1);
    expect(doc.shadowText).toContain('const App = () => ');
    expect(doc.shadowText).toContain('<div');
    expect(doc.shadowText).toContain('Hello');
    expect(doc.shadowText).toContain('export default App;');
  });
});

// ── Multiline pug templates ─────────────────────────────────────

describe('multiline pug templates', () => {
  it('compiles multiline template correctly', () => {
    const text = [
      'const v = pug`',
      '  .card',
      '    h1 Title',
      '    p Body',
      '`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.tsxText).toContain('className="card"');
    expect(region.tsxText).toContain('<h1');
    expect(region.tsxText).toContain('Title');
    expect(region.tsxText).toContain('<p');
    expect(region.tsxText).toContain('Body');
    expect(region.parseError).toBeNull();
  });

  it('multiline template shadow offsets are correct', () => {
    const text = 'const v = pug`\n  div\n  span\n`;\nconst end = 1;';
    const doc = buildShadowDocument(text, 'test.tsx');

    const region = doc.regions[0];
    const extracted = doc.shadowText.slice(region.shadowStart, region.shadowEnd);
    expect(extracted).toBe(region.tsxText);
    expect(doc.shadowText).toContain('const end = 1;');
  });
});

// ── Version parameter ───────────────────────────────────────────

describe('version parameter', () => {
  it('uses provided version', () => {
    const doc = buildShadowDocument('const v = pug`div`;', 'test.tsx', 42);
    expect(doc.version).toBe(42);
  });

  it('defaults to 1 when not provided', () => {
    const doc = buildShadowDocument('const v = pug`div`;', 'test.tsx');
    expect(doc.version).toBe(1);
  });
});

// ── Control flow in shadow document ─────────────────────────────

describe('pug with control flow in shadow document', () => {
  it('compiles pug with if/else in shadow', () => {
    const text = [
      'const v = pug`',
      '  if show',
      '    span Visible',
      '  else',
      '    span Hidden',
      '`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.tsxText).toContain('show');
    expect(region.tsxText).toContain('?');
    expect(region.tsxText).toContain('Visible');
    expect(region.tsxText).toContain('Hidden');
    expect(region.parseError).toBeNull();
  });

  it('compiles pug with each loop in shadow', () => {
    const text = [
      'const v = pug`',
      '  each item in items',
      '    li= item',
      '`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');

    const region = doc.regions[0];
    expect(region.tsxText).toContain('items');
    expect(region.tsxText).toContain('for (const item of items)');
    expect(region.tsxText).toContain('<li');
  });
});
