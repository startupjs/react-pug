import { describe, it, expect } from 'vitest';
import { buildShadowDocument } from '../../src/language/shadowDocument';

describe('buildShadowDocument', () => {
  it('returns original text unchanged when no pug regions', () => {
    const text = 'const x = 10;\nexport default x;\n';
    const doc = buildShadowDocument(text, 'test.ts');
    expect(doc.shadowText).toBe(text);
    expect(doc.regions).toHaveLength(0);
    expect(doc.regionDeltas).toHaveLength(0);
    expect(doc.version).toBe(1);
    expect(doc.uri).toBe('test.ts');
    expect(doc.originalText).toBe(text);
  });

  it('replaces a single pug region with generated TSX', () => {
    const text = 'const view = pug`div`;\nexport default view;\n';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    expect(doc.shadowText).not.toContain('pug`');
    expect(doc.shadowText).toContain('<div');
    // Surrounding code should be preserved
    expect(doc.shadowText).toContain('const view = ');
    expect(doc.shadowText).toContain('export default view;');
  });

  it('populates region shadow fields correctly', () => {
    const text = 'const v = pug`div`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    const region = doc.regions[0];

    // shadowStart/End should point into the shadow text
    expect(region.shadowStart).toBeGreaterThanOrEqual(0);
    expect(region.shadowEnd).toBeGreaterThan(region.shadowStart);
    expect(doc.shadowText.slice(region.shadowStart, region.shadowEnd)).toBe(region.tsxText);
  });

  it('populates tsxText, mappings, and lexerTokens from compilation', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = buildShadowDocument(text, 'test.tsx');
    const region = doc.regions[0];

    expect(region.tsxText).toContain('<Button');
    expect(region.tsxText).toContain('onClick');
    expect(region.mappings.length).toBeGreaterThan(0);
    expect(region.lexerTokens.length).toBeGreaterThan(0);
    expect(region.parseError).toBeNull();
  });

  it('handles multiple pug regions', () => {
    const text = [
      'const a = pug`div`;',
      'const b = pug`span`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(2);
    expect(doc.shadowText).toContain('<div');
    expect(doc.shadowText).toContain('<span');
    expect(doc.shadowText).not.toContain('pug`');

    // Each region should have correct shadow positions
    for (const region of doc.regions) {
      expect(doc.shadowText.slice(region.shadowStart, region.shadowEnd)).toBe(region.tsxText);
    }
  });

  it('computes regionDeltas correctly', () => {
    const text = [
      'const a = pug`div`;',
      'const b = pug`span`;',
    ].join('\n');
    const doc = buildShadowDocument(text, 'test.tsx');

    // regionDeltas[0] should be 0 (no prior regions)
    expect(doc.regionDeltas[0]).toBe(0);

    // regionDeltas[1] should be the delta from region 0
    const region0 = doc.regions[0];
    const originalLen0 = region0.originalEnd - region0.originalStart;
    const expectedDelta = region0.tsxText.length - originalLen0;
    expect(doc.regionDeltas[1]).toBe(expectedDelta);
  });

  it('preserves text between regions', () => {
    const text = 'const a = pug`div`;\nconst middle = 42;\nconst b = pug`span`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.shadowText).toContain('const middle = 42;');
  });

  it('preserves text after last region', () => {
    const text = 'const a = pug`div`;\nconst tail = true;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.shadowText).toContain('const tail = true;');
  });

  it('handles pug region with parse error', () => {
    // ${} interpolation triggers an error in extractPugRegions
    const text = 'const v = pug`${bad}`;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.parseError).not.toBeNull();
    expect(region.tsxText).toContain('null');
    expect(region.tsxText).toContain('JSX.Element');
  });

  it('handles empty pug template', () => {
    const text = 'const v = pug``;';
    const doc = buildShadowDocument(text, 'test.tsx');

    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    // Empty pug compiles to null placeholder
    expect(region.tsxText).toContain('null');
  });

  it('uses provided version number', () => {
    const text = 'const v = pug`div`;';
    const doc = buildShadowDocument(text, 'test.tsx', 5);
    expect(doc.version).toBe(5);
  });

  it('handles multiline pug template', () => {
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
    expect(region.parseError).toBeNull();
  });

  it('shadow text is valid when regions grow or shrink', () => {
    // Short pug that expands to longer TSX
    const text = 'const v = pug`Button(onClick=handler, disabled, label="Hi")`;\nconst end = 1;';
    const doc = buildShadowDocument(text, 'test.tsx');

    // Verify shadow text integrity
    expect(doc.shadowText).toContain('const end = 1;');
    expect(doc.shadowText).not.toContain('pug`');

    // Verify region positions are consistent
    const region = doc.regions[0];
    const extracted = doc.shadowText.slice(region.shadowStart, region.shadowEnd);
    expect(extracted).toBe(region.tsxText);
  });
});
