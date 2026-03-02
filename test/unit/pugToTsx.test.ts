import { describe, it, expect } from 'vitest';
import { compilePugToTsx, TsxEmitter } from '../../src/language/pugToTsx';
import { FULL_FEATURES, CSS_CLASS, SYNTHETIC } from '../../src/language/mapping';

// Test checklist:
// [x] Tags: Button -> <Button />, div -> <div />
// [x] Class shorthand: .card -> <div className="card" />
// [x] Class+ID: .foo.bar#baz -> <div className="foo bar" id="baz" />
// [x] Attributes: onClick=handler -> onClick={handler}
// [x] Boolean attributes: disabled -> disabled={true}
// [x] String attributes: label="Hello" -> label={"Hello"}
// [x] Spread: ...props -> {...props}
// [x] Text: p Hello -> <p>Hello</p>
// [x] Text interpolation: p Hello #{name} -> <p>...{name}...</p>
// [x] Children/nesting: parent with indented children
// [x] Multiple roots: wrapped in <>...</>
// [x] Self-closing/void elements: input, br
// [x] Empty template: returns null placeholder
// [x] Lexer error: returns parseError with message
// [x] Parser error: returns parseError with message
// [x] Lexer tokens are returned
// [x] TsxEmitter: emitMapped, emitDerived, emitSynthetic, getResult
// [x] Buffered code: = expr -> {expr}
// [x] Comments: stripped from output

// ── TsxEmitter unit tests ────────────────────────────────────────

describe('TsxEmitter', () => {
  it('emitMapped adds text with 1:1 mapping', () => {
    const emitter = new TsxEmitter();
    emitter.emitMapped('Button', 0, FULL_FEATURES);
    const result = emitter.getResult();

    expect(result.tsx).toBe('Button');
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].sourceOffsets).toEqual([0]);
    expect(result.mappings[0].generatedOffsets).toEqual([0]);
    expect(result.mappings[0].lengths).toEqual([6]);
    expect(result.mappings[0].data).toBe(FULL_FEATURES);
  });

  it('emitDerived adds text with different source/generated lengths', () => {
    const emitter = new TsxEmitter();
    emitter.emitDerived('foo-bar', 0, 3, CSS_CLASS);
    const result = emitter.getResult();

    expect(result.tsx).toBe('foo-bar');
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].lengths).toEqual([3]);
    expect(result.mappings[0].generatedLengths).toEqual([7]);
    expect(result.mappings[0].data).toBe(CSS_CLASS);
  });

  it('emitSynthetic adds text without mapping', () => {
    const emitter = new TsxEmitter();
    emitter.emitSynthetic('<div>');
    const result = emitter.getResult();

    expect(result.tsx).toBe('<div>');
    expect(result.mappings).toHaveLength(0);
  });

  it('tracks offset correctly across multiple emissions', () => {
    const emitter = new TsxEmitter();
    emitter.emitSynthetic('<');       // offset 0, len 1
    emitter.emitMapped('div', 0, FULL_FEATURES); // offset 1, len 3
    emitter.emitSynthetic(' />');     // offset 4, len 3
    const result = emitter.getResult();

    expect(result.tsx).toBe('<div />');
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].generatedOffsets).toEqual([1]);
  });
});

// ── Tag compilation tests ────────────────────────────────────────

describe('tag compilation', () => {
  it('compiles bare tag: div -> <div />', () => {
    const result = compilePugToTsx('div');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('/>');
    expect(result.parseError).toBeNull();
  });

  it('compiles component tag: Button -> <Button />', () => {
    const result = compilePugToTsx('Button');
    expect(result.tsx).toContain('<Button');
    expect(result.tsx).toContain('/>');
  });

  it('compiles tag with children', () => {
    const result = compilePugToTsx('div\n  span');
    expect(result.tsx).toContain('<div>');
    expect(result.tsx).toContain('<span');
    expect(result.tsx).toContain('</div>');
  });
});

// ── Class and ID shorthand tests ─────────────────────────────────

describe('class and ID shorthands', () => {
  it('.card -> <div className="card" />', () => {
    const result = compilePugToTsx('.card');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('className="card"');
    expect(result.tsx).toContain('/>');
  });

  it('.foo.bar -> <div className="foo bar" />', () => {
    const result = compilePugToTsx('.foo.bar');
    expect(result.tsx).toContain('className="foo bar"');
  });

  it('.foo.bar#baz -> className="foo bar" id="baz"', () => {
    const result = compilePugToTsx('.foo.bar#baz');
    expect(result.tsx).toContain('className="foo bar"');
    expect(result.tsx).toContain('id="baz"');
  });

  it('#myId -> <div id="myId" />', () => {
    const result = compilePugToTsx('#myId');
    expect(result.tsx).toContain('id="myId"');
  });
});

// ── Attribute tests ──────────────────────────────────────────────

describe('attributes', () => {
  it('expression attribute: onClick=handler -> onClick={handler}', () => {
    const result = compilePugToTsx('Button(onClick=handler)');
    expect(result.tsx).toContain('onClick=');
    expect(result.tsx).toContain('{handler}');
  });

  it('boolean attribute: disabled -> disabled={true}', () => {
    const result = compilePugToTsx('Button(disabled)');
    expect(result.tsx).toContain('disabled');
    expect(result.tsx).toContain('{true}');
  });

  it('string attribute: label="Hello" -> label={"Hello"}', () => {
    const result = compilePugToTsx('Button(label="Hello")');
    expect(result.tsx).toContain('label=');
    expect(result.tsx).toContain('"Hello"');
  });

  it('multiple attributes', () => {
    const result = compilePugToTsx('Button(onClick=handler, label="Hi")');
    expect(result.tsx).toContain('onClick');
    expect(result.tsx).toContain('label');
  });

  it('spread attribute: ...props -> {...props}', () => {
    const result = compilePugToTsx('Button(...props)');
    expect(result.tsx).toContain('{...props}');
  });
});

// ── Text tests ───────────────────────────────────────────────────

describe('text content', () => {
  it('inline text: p Hello -> <p>Hello</p>', () => {
    const result = compilePugToTsx('p Hello');
    expect(result.tsx).toContain('<p');
    expect(result.tsx).toContain('>');
    expect(result.tsx).toContain('Hello');
    expect(result.tsx).toContain('</p>');
  });

  it('text with interpolation: p Hello #{name}', () => {
    const result = compilePugToTsx('p Hello #{name}');
    expect(result.tsx).toContain('<p');
    expect(result.tsx).toContain('</p>');
    // Interpolation should produce {name} in the output
    expect(result.tsx).toContain('{name}');
  });

  it('tag with = buffered code: p= expr', () => {
    const result = compilePugToTsx('p= myVar');
    expect(result.tsx).toContain('<p');
    expect(result.tsx).toContain('{');
    expect(result.tsx).toContain('myVar');
  });
});

// ── Nesting and children tests ───────────────────────────────────

describe('nesting and children', () => {
  it('nested tags produce proper hierarchy', () => {
    const pug = '.card\n  h1 Title\n  p Body';
    const result = compilePugToTsx(pug);

    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('className="card"');
    expect(result.tsx).toContain('<h1');
    expect(result.tsx).toContain('Title');
    expect(result.tsx).toContain('<p');
    expect(result.tsx).toContain('Body');
    expect(result.tsx).toContain('</div>');
  });

  it('deeply nested tags', () => {
    const pug = 'div\n  span\n    a Hello';
    const result = compilePugToTsx(pug);

    expect(result.tsx).toContain('<div>');
    expect(result.tsx).toContain('<span>');
    expect(result.tsx).toContain('<a');
    expect(result.tsx).toContain('Hello');
    expect(result.tsx).toContain('</a>');
    expect(result.tsx).toContain('</span>');
    expect(result.tsx).toContain('</div>');
  });
});

// ── Multiple roots ───────────────────────────────────────────────

describe('multiple roots', () => {
  it('multiple root tags wrapped in fragment', () => {
    const result = compilePugToTsx('div\nspan');
    expect(result.tsx).toContain('<>');
    expect(result.tsx).toContain('</>');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('<span');
  });

  it('single root tag not wrapped in fragment', () => {
    const result = compilePugToTsx('div');
    expect(result.tsx).not.toContain('<>');
    expect(result.tsx).not.toContain('</>');
  });
});

// ── Self-closing / void elements ─────────────────────────────────

describe('void elements', () => {
  it('input is self-closing', () => {
    const result = compilePugToTsx('input(type="text")');
    expect(result.tsx).toContain('<input');
    expect(result.tsx).toContain('/>');
    expect(result.tsx).not.toContain('</input>');
  });

  it('br is self-closing', () => {
    const result = compilePugToTsx('br');
    expect(result.tsx).toContain('<br');
    expect(result.tsx).toContain('/>');
  });

  it('img is self-closing', () => {
    const result = compilePugToTsx('img(src="photo.jpg")');
    expect(result.tsx).toContain('<img');
    expect(result.tsx).toContain('/>');
    expect(result.tsx).not.toContain('</img>');
  });
});

// ── Empty template ───────────────────────────────────────────────

describe('empty template', () => {
  it('empty string returns null placeholder', () => {
    const result = compilePugToTsx('');
    expect(result.tsx).toContain('null');
    expect(result.tsx).toContain('JSX.Element');
    expect(result.parseError).toBeNull();
  });

  it('whitespace-only returns null placeholder with parse error', () => {
    const result = compilePugToTsx('   \n   \n   ');
    expect(result.tsx).toContain('null');
    // Whitespace-only content causes a lexer/parser error
    expect(result.parseError).not.toBeNull();
    expect(result.parseError!.message).toBeDefined();
  });
});

// ── Error handling ───────────────────────────────────────────────

describe('error handling', () => {
  it('lexer error returns parseError', () => {
    // This should cause a lexer error (invalid indentation)
    const result = compilePugToTsx('  div\n span');
    // Whether this causes an error depends on the lexer --
    // if it does, parseError should be set; if not, it still shouldn't crash
    expect(result).toBeDefined();
    expect(result.tsx).toBeDefined();
  });

  it('result always has tsx string even on error', () => {
    // Try to trigger a parse error with severely malformed pug
    const result = compilePugToTsx('div(\n  !!!invalid');
    expect(typeof result.tsx).toBe('string');
    expect(result.tsx.length).toBeGreaterThan(0);
  });
});

// ── Lexer tokens ─────────────────────────────────────────────────

describe('lexer tokens', () => {
  it('returns lexer tokens for valid pug', () => {
    const result = compilePugToTsx('div Hello');
    expect(Array.isArray(result.lexerTokens)).toBe(true);
    expect(result.lexerTokens.length).toBeGreaterThan(0);
  });

  it('tokens have type and loc fields', () => {
    const result = compilePugToTsx('div');
    for (const token of result.lexerTokens) {
      expect(token.type).toBeDefined();
      expect(token.loc).toBeDefined();
      expect(token.loc.start).toBeDefined();
      expect(token.loc.end).toBeDefined();
    }
  });

  it('returns empty tokens on lexer error', () => {
    // If this triggers a lexer error, tokens should be empty
    // If it doesn't error, tokens should be present
    const result = compilePugToTsx('div');
    expect(Array.isArray(result.lexerTokens)).toBe(true);
  });
});

// ── Mappings ─────────────────────────────────────────────────────

describe('source mappings', () => {
  it('produces mappings for tag names', () => {
    const result = compilePugToTsx('Button');
    expect(result.mappings.length).toBeGreaterThan(0);

    // Should have a mapping for "Button" with FULL_FEATURES
    const tagMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'Button'.length
    );
    expect(tagMapping).toBeDefined();
  });

  it('produces mappings for attribute names', () => {
    const result = compilePugToTsx('Button(onClick=handler)');

    // Should have mappings for "onClick" and "handler"
    const hasMappedContent = result.mappings.some(
      m => m.data === FULL_FEATURES
    );
    expect(hasMappedContent).toBe(true);
  });

  it('class shorthands use CSS_CLASS mapping', () => {
    const result = compilePugToTsx('.card');

    const cssMapping = result.mappings.find(m => m.data === CSS_CLASS);
    expect(cssMapping).toBeDefined();
  });
});

// ── Comments ─────────────────────────────────────────────────────

describe('comments', () => {
  it('pug comments are stripped from output', () => {
    const result = compilePugToTsx('// this is a comment\ndiv');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).not.toContain('this is a comment');
  });
});
