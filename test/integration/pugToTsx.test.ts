import { describe, it, expect } from 'vitest';
import { compilePugToTsx, TsxEmitter } from '../../src/language/pugToTsx';
import { FULL_FEATURES, CSS_CLASS, SYNTHETIC, VERIFY_ONLY } from '../../src/language/mapping';

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
    expect(Array.isArray(result.lexerTokens)).toBe(true);
    if (result.parseError) {
      // During typing-time recovery we may still produce TSX/mappings while
      // preserving parseError for diagnostics.
      expect(typeof result.tsx).toBe('string');
      expect(result.tsx.length).toBeGreaterThan(0);
    } else {
      // If no parse error, we should have valid output with tokens
      expect(result.lexerTokens.length).toBeGreaterThan(0);
      expect(result.tsx).toContain('<');
    }
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

// ── Control flow tests ──────────────────────────────────────────

describe('compilePugToTsx - conditionals', () => {
  it('compiles if/else to ternary', () => {
    const result = compilePugToTsx('if show\n  div\nelse\n  span');
    expect(result.tsx).toContain('show ?');
    expect(result.tsx).toContain('<div />');
    expect(result.tsx).toContain('<span />');
    expect(result.parseError).toBeNull();
  });

  it('compiles if without else (null alternate)', () => {
    const result = compilePugToTsx('if visible\n  div');
    expect(result.tsx).toContain('visible ?');
    expect(result.tsx).toContain(': null');
  });

  it('compiles chained if/else if/else', () => {
    const result = compilePugToTsx('if a\n  div A\nelse if b\n  div B\nelse\n  div C');
    expect(result.tsx).toContain('a ?');
    expect(result.tsx).toContain('b ?');
    expect(result.tsx).toContain('<div>A</div>');
    expect(result.tsx).toContain('<div>B</div>');
    expect(result.tsx).toContain('<div>C</div>');
  });

  it('maps test expression with FULL_FEATURES', () => {
    const result = compilePugToTsx('if myCondition\n  div');
    const testMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'myCondition'.length,
    );
    expect(testMapping).toBeDefined();
  });
});

describe('compilePugToTsx - each loops', () => {
  it('compiles each with value and key', () => {
    const result = compilePugToTsx('each item, idx in items\n  div= item');
    expect(result.tsx).toContain('items.map((item, idx)');
    expect(result.tsx).toContain('{item}');
  });

  it('compiles each with value only', () => {
    const result = compilePugToTsx('each item in list\n  span');
    expect(result.tsx).toContain('list.map((item)');
    expect(result.tsx).toContain('<span />');
  });

  it('maps obj, val, and key with FULL_FEATURES', () => {
    const result = compilePugToTsx('each item, i in items\n  div');
    // Should have mappings for 'items', 'item', and 'i'
    const objMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'items'.length,
    );
    const valMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'item'.length,
    );
    const keyMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'i'.length,
    );
    expect(objMapping).toBeDefined();
    expect(valMapping).toBeDefined();
    expect(keyMapping).toBeDefined();
  });
});

describe('compilePugToTsx - while loops', () => {
  it('compiles while to IIFE with push pattern', () => {
    const result = compilePugToTsx('while n > 0\n  div');
    expect(result.tsx).toContain('while (n > 0)');
    expect(result.tsx).toContain('__r.push(');
    expect(result.tsx).toContain('JSX.Element[]');
  });

  it('maps test expression with FULL_FEATURES', () => {
    const result = compilePugToTsx('while running\n  div');
    const testMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'running'.length,
    );
    expect(testMapping).toBeDefined();
  });
});

describe('compilePugToTsx - case/when', () => {
  it('compiles case/when to chained ternaries', () => {
    const result = compilePugToTsx('case color\n  when "red"\n    div Red\n  when "blue"\n    div Blue\n  default\n    div Other');
    expect(result.tsx).toContain('color === "red"');
    expect(result.tsx).toContain('color === "blue"');
    expect(result.tsx).toContain('<div>Red</div>');
    expect(result.tsx).toContain('<div>Blue</div>');
    expect(result.tsx).toContain('<div>Other</div>');
  });

  it('compiles case without default', () => {
    const result = compilePugToTsx('case x\n  when "a"\n    div A');
    expect(result.tsx).toContain('x === "a"');
    // Should end with null for no default
    expect(result.tsx).toContain(': null');
  });

  it('maps case expr with VERIFY_ONLY', () => {
    const result = compilePugToTsx('case myVar\n  when "a"\n    div');
    const verifyMapping = result.mappings.find(
      m => m.data === VERIFY_ONLY && m.lengths[0] === 'myVar'.length,
    );
    expect(verifyMapping).toBeDefined();
  });
});

describe('compilePugToTsx - code blocks', () => {
  it('compiles unbuffered code with JSX in IIFE', () => {
    const result = compilePugToTsx('- const x = 10\ndiv= x');
    expect(result.tsx).toContain('(() => {');
    expect(result.tsx).toContain('const x = 10;');
    expect(result.tsx).toContain('return ');
    expect(result.tsx).toContain('{x}');
  });

  it('compiles code-only blocks in IIFE returning null', () => {
    const result = compilePugToTsx('- const x = 10\n- const y = 20');
    expect(result.tsx).toContain('(() => {');
    expect(result.tsx).toContain('const x = 10;');
    expect(result.tsx).toContain('const y = 20;');
    expect(result.tsx).toContain('return null;');
  });

  it('maps code expressions with FULL_FEATURES', () => {
    const result = compilePugToTsx('- const x = 10');
    const codeMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'const x = 10'.length,
    );
    expect(codeMapping).toBeDefined();
  });
});
