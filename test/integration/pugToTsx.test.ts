import { describe, it, expect } from 'vitest';
import { compilePugToTsx, TsxEmitter } from '../../src/language/pugToTsx';
import { FULL_FEATURES, CSS_CLASS, SYNTHETIC } from '../../src/language/mapping';

describe('TsxEmitter', () => {
  it('emitMapped tracks offset and creates mapping', () => {
    const emitter = new TsxEmitter();
    emitter.emitMapped('Button', 0, FULL_FEATURES);
    const result = emitter.getResult();
    expect(result.tsx).toBe('Button');
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].sourceOffsets).toEqual([0]);
    expect(result.mappings[0].generatedOffsets).toEqual([0]);
    expect(result.mappings[0].lengths).toEqual([6]);
  });

  it('emitSynthetic advances offset but creates no mapping', () => {
    const emitter = new TsxEmitter();
    emitter.emitSynthetic('<');
    emitter.emitMapped('div', 5, FULL_FEATURES);
    const result = emitter.getResult();
    expect(result.tsx).toBe('<div');
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].generatedOffsets).toEqual([1]); // after '<'
  });

  it('emitDerived handles different source/generated lengths', () => {
    const emitter = new TsxEmitter();
    emitter.emitDerived('className="foo bar"', 0, 9, CSS_CLASS);
    const result = emitter.getResult();
    expect(result.mappings[0].lengths).toEqual([9]);
    expect(result.mappings[0].generatedLengths).toEqual([19]);
  });
});

describe('compilePugToTsx - tags', () => {
  it('compiles a bare tag', () => {
    const result = compilePugToTsx('div');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('/>');
    expect(result.parseError).toBeNull();
  });

  it('compiles a named component tag', () => {
    const result = compilePugToTsx('Button');
    expect(result.tsx).toContain('<Button');
    expect(result.tsx).toContain('/>');
  });

  it('compiles a self-closing void element', () => {
    const result = compilePugToTsx('br');
    expect(result.tsx).toContain('<br');
    expect(result.tsx).toContain('/>');
  });

  it('compiles class shorthand to div with className', () => {
    const result = compilePugToTsx('.card');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('className="card"');
  });

  it('compiles multiple class shorthands', () => {
    const result = compilePugToTsx('.foo.bar');
    expect(result.tsx).toContain('className="foo bar"');
  });

  it('compiles id shorthand', () => {
    const result = compilePugToTsx('.foo#baz');
    expect(result.tsx).toContain('className="foo"');
    expect(result.tsx).toContain('id="baz"');
  });
});

describe('compilePugToTsx - attributes', () => {
  it('compiles expression attribute', () => {
    const result = compilePugToTsx('Button(onClick=handler)');
    expect(result.tsx).toContain('onClick={handler}');
  });

  it('compiles string attribute', () => {
    const result = compilePugToTsx('Button(label="Hello")');
    expect(result.tsx).toContain('label={"Hello"}');
  });

  it('compiles boolean attribute', () => {
    const result = compilePugToTsx('input(disabled)');
    expect(result.tsx).toContain('disabled={true}');
  });

  it('compiles spread attribute', () => {
    const result = compilePugToTsx('div(...props)');
    expect(result.tsx).toContain('{...props}');
  });

  it('compiles multiple attributes', () => {
    const result = compilePugToTsx('Button(onClick=handler, label="Hi")');
    expect(result.tsx).toContain('onClick={handler}');
    expect(result.tsx).toContain('label={"Hi"}');
  });
});

describe('compilePugToTsx - text', () => {
  it('compiles tag with inline text', () => {
    const result = compilePugToTsx('p Hello world');
    expect(result.tsx).toContain('<p>');
    expect(result.tsx).toContain('Hello world');
    expect(result.tsx).toContain('</p>');
  });

  it('compiles text with interpolation', () => {
    const result = compilePugToTsx('p Hello #{name}');
    expect(result.tsx).toContain('{name}');
    expect(result.tsx).toContain('Hello ');
  });

  it('compiles buffered code (= expr)', () => {
    const result = compilePugToTsx('div= someVar');
    expect(result.tsx).toContain('{someVar}');
  });
});

describe('compilePugToTsx - nesting', () => {
  it('compiles parent with children', () => {
    const result = compilePugToTsx('.card\n  p Hello\n  span World');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('<p>Hello</p>');
    expect(result.tsx).toContain('<span>World</span>');
    expect(result.tsx).toContain('</div>');
  });

  it('compiles deeply nested structure', () => {
    const result = compilePugToTsx('.outer\n  .inner\n    p Text');
    expect(result.tsx).toContain('className="outer"');
    expect(result.tsx).toContain('className="inner"');
    expect(result.tsx).toContain('<p>Text</p>');
  });
});

describe('compilePugToTsx - multiple roots', () => {
  it('wraps multiple root nodes in fragment', () => {
    const result = compilePugToTsx('div\nspan');
    expect(result.tsx).toContain('<>');
    expect(result.tsx).toContain('</>');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('<span');
  });

  it('does not wrap single root in fragment', () => {
    const result = compilePugToTsx('div');
    expect(result.tsx).not.toContain('<>');
  });
});

describe('compilePugToTsx - error handling', () => {
  it('returns parseError for invalid pug syntax', () => {
    const result = compilePugToTsx('(((invalid');
    expect(result.parseError).not.toBeNull();
    expect(result.tsx).toContain('null');
  });

  it('returns empty template as null', () => {
    const result = compilePugToTsx('');
    expect(result.tsx).toContain('null');
  });

  it('preserves lexer tokens even on parser error', () => {
    const result = compilePugToTsx('div\n  invalid(((');
    // Should still have tokens from the lexer phase even if parse fails
    // (may or may not fail depending on pug-parser tolerance)
    expect(result.lexerTokens).toBeDefined();
  });
});

describe('compilePugToTsx - mappings', () => {
  it('creates mappings for tag names', () => {
    const result = compilePugToTsx('Button');
    expect(result.mappings.length).toBeGreaterThan(0);
    // Should have a mapping for "Button"
    const tagMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 6,
    );
    expect(tagMapping).toBeDefined();
  });

  it('creates mappings for attribute names', () => {
    const result = compilePugToTsx('div(onClick=handler)');
    const attrMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'onClick'.length,
    );
    expect(attrMapping).toBeDefined();
  });
});
