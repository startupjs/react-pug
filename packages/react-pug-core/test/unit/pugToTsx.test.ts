import { describe, it, expect } from 'vitest';
import { compilePugToTsx, TsxEmitter } from '../../src/language/pugToTsx';
import { FULL_FEATURES, CSS_CLASS, SYNTHETIC, VERIFY_ONLY } from '../../src/language/mapping';

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
// [x] Conditionals: if/else -> ternary, if/else-if/else -> chained ternary
// [x] Each loops: each item in items -> for..of IIFE accumulator, with key/index
// [x] While loops: while condition -> IIFE with __r array
// [x] Case/When: case expr / when val -> chained ternaries
// [x] Code blocks: unbuffered code, IIFE wrapping when mixed with JSX
// [x] Control flow edge cases: empty blocks, nesting, root-level control flow

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

  it('does not treat capitalized components like Link as void html tags', () => {
    const result = compilePugToTsx("Link(href='/x')\n  Button(label='A')");
    expect(result.tsx).toContain('<Link');
    expect(result.tsx).toContain('</Link>');
    expect(result.tsx).toContain('<Button');
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

  it('supports ${} interpolation in attribute expressions', () => {
    const result = compilePugToTsx('Button(tooltip=${submitDescription})');
    expect(result.parseError).toBeNull();
    expect(result.tsx).toContain('tooltip=');
    expect(result.tsx).toContain('submitDescription');
    expect(result.tsx).not.toContain('${');
  });

  it('supports nested pug inside ${} interpolation', () => {
    const result = compilePugToTsx('Button(tooltip=${pug`span= submitDescription`})');
    expect(result.parseError).toBeNull();
    expect(result.tsx).toContain('<span');
    expect(result.tsx).toContain('submitDescription');
    expect(result.tsx).not.toContain('pug`span=');
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

  it('supports piped text nodes across multiple lines', () => {
    const pug = [
      'span',
      '  | Hello',
      '  | World',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.parseError).toBeNull();
    expect(result.tsx).toContain('<span>');
    expect(result.tsx).toContain('Hello');
    expect(result.tsx).toContain('World');
    expect(result.tsx).toContain('</span>');
  });

  it('supports piped text nodes with interpolation', () => {
    const pug = [
      'span',
      '  | Hello #{user.name}',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.parseError).toBeNull();
    expect(result.tsx).toContain('Hello');
    expect(result.tsx).toContain('{user.name}');
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

// ── Terminal style blocks ───────────────────────────────────────

describe('terminal style blocks', () => {
  it('extracts a terminal style block with default css lang', () => {
    const pug = [
      '.title Hello',
      'style',
      '  .title {',
      '    color: red;',
      '  }',
    ].join('\n');

    const result = compilePugToTsx(pug);

    expect(result.parseError).toBeNull();
    expect(result.transformError).toBeNull();
    expect(result.tsx).toContain('className="title"');
    expect(result.tsx).not.toContain('<style');
    expect(result.styleBlock).toEqual({
      lang: 'css',
      content: [
        '.title {',
        '  color: red;',
        '}',
      ].join('\n'),
      tagOffset: pug.indexOf('style'),
      contentStart: pug.indexOf('  .title {'),
      contentEnd: pug.length,
      commonIndent: 2,
      line: 2,
      column: 1,
    });
  });

  it('extracts styl lang and preserves ${} interpolation verbatim', () => {
    const pug = [
      '.title Hello',
      "style(lang='styl')",
      '  .title',
      '    color ${tone}',
      '    font monospace',
    ].join('\n');

    const result = compilePugToTsx(pug);

    expect(result.transformError).toBeNull();
    expect(result.styleBlock?.lang).toBe('styl');
    expect(result.styleBlock?.content).toBe([
      '.title',
      '  color ${tone}',
      '  font monospace',
    ].join('\n'));
  });

  it('returns transformError when style tag is not last', () => {
    const pug = [
      '.title Hello',
      'style',
      '  .title',
      '    color red',
      '.footer Bye',
    ].join('\n');

    const result = compilePugToTsx(pug);

    expect(result.transformError?.code).toBe('style-tag-must-be-last');
    expect(result.tsx).toContain('null');
    expect(result.styleBlock).toBeNull();
  });

  it('returns transformError for unsupported style lang', () => {
    const pug = [
      '.title Hello',
      "style(lang='less')",
      '  .title {}',
    ].join('\n');

    const result = compilePugToTsx(pug);

    expect(result.transformError?.code).toBe('unsupported-style-lang');
    expect(result.styleBlock).toBeNull();
  });
});

// ── Error handling ───────────────────────────────────────────────

describe('error handling', () => {
  it('lexer error returns parseError', () => {
    // This should cause a lexer error (invalid indentation)
    const result = compilePugToTsx('  div\n span');
    // Whether this causes an error depends on the lexer --
    // if it does, parseError should be set; if not, tsx should contain valid JSX
    expect(typeof result.tsx).toBe('string');
    expect(result.tsx.length).toBeGreaterThan(0);
    if (result.parseError) {
      expect(result.parseError.message).toBeDefined();
      expect(result.tsx).toContain('null');
    } else {
      expect(result.tsx).toContain('<');
    }
  });

  it('result always has tsx string even on error', () => {
    // Try to trigger a parse error with severely malformed pug
    const result = compilePugToTsx('div(\n  !!!invalid');
    expect(typeof result.tsx).toBe('string');
    expect(result.tsx.length).toBeGreaterThan(0);
    // On error, the tsx should be the null placeholder
    if (result.parseError) {
      expect(result.tsx).toContain('null');
      expect(result.tsx).toContain('JSX.Element');
    }
  });

  it('keeps generated TSX/mappings for typing-time incomplete attrs while preserving parseError', () => {
    const result = compilePugToTsx('Button(o');
    expect(result.parseError).not.toBeNull();
    expect(result.tsx).toContain('<Button');
    expect(result.tsx).not.toContain('(null as any as JSX.Element)');
    expect(result.mappings.length).toBeGreaterThan(0);
  });

  it('keeps generated TSX/mappings for unclosed interpolation while preserving parseError', () => {
    const result = compilePugToTsx('h3 #{activeTodo');
    expect(result.parseError).not.toBeNull();
    expect(result.tsx).toContain('{activeTodo');
    expect(result.tsx).not.toContain('(null as any as JSX.Element)');
    expect(result.mappings.length).toBeGreaterThan(0);
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

  it('tokens include tag and eos for simple input', () => {
    const result = compilePugToTsx('div');
    expect(Array.isArray(result.lexerTokens)).toBe(true);
    const types = result.lexerTokens.map(t => t.type);
    expect(types).toContain('tag');
    expect(types).toContain('eos');
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

  it('maps interpolation expression start exactly after "#{...}" prefix', () => {
    const pug = 'h3 Value #{interpVar.deep}';
    const result = compilePugToTsx(pug);
    const expr = 'interpVar.deep';
    const exprOffset = pug.indexOf(expr);
    expect(exprOffset).toBeGreaterThanOrEqual(0);

    const exactMapping = result.mappings.find(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === exprOffset
        && m.lengths[0] === expr.length,
    );
    expect(exactMapping).toBeDefined();
  });

  it('maps interpolation to the expression occurrence after "#{" when identifier appears earlier on line', () => {
    const pug = 'p interpVar #{interpVar + 1}';
    const result = compilePugToTsx(pug);
    const expr = 'interpVar + 1';
    const exprOffset = pug.indexOf(expr);
    expect(exprOffset).toBeGreaterThanOrEqual(0);

    const exactMapping = result.mappings.find(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === exprOffset
        && m.lengths[0] === expr.length,
    );
    expect(exactMapping).toBeDefined();
  });

  it('maps unbuffered "-" code expression start exactly after marker prefix', () => {
    const pug = '- const localTotal = missingCode + 1\nspan= localTotal';
    const result = compilePugToTsx(pug);
    const codeExpr = 'const localTotal = missingCode + 1';
    const exprOffset = pug.indexOf(codeExpr);
    expect(exprOffset).toBeGreaterThanOrEqual(0);

    const exactMapping = result.mappings.find(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === exprOffset
        && m.lengths[0] === codeExpr.length,
    );
    expect(exactMapping).toBeDefined();
  });

  it('maps each value/key/object spans to exact source offsets for complex object expression', () => {
    const pug = [
      'each todo, idx in (itemsA.length > 0 ? itemsA : itemsB)',
      '  span= todo.id',
    ].join('\n');
    const result = compilePugToTsx(pug);
    const val = 'todo';
    const key = 'idx';
    const obj = '(itemsA.length > 0 ? itemsA : itemsB)';

    const valOffset = pug.indexOf('each ') + 'each '.length;
    const keyOffset = pug.indexOf(', ') + 2;
    const objOffset = pug.indexOf(obj);

    expect(result.mappings.some(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === valOffset
        && m.lengths[0] === val.length,
    )).toBe(true);

    expect(result.mappings.some(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === keyOffset
        && m.lengths[0] === key.length,
    )).toBe(true);

    expect(result.mappings.some(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === objOffset
        && m.lengths[0] === obj.length,
    )).toBe(true);
  });

  it('maps ${} interpolation expression to exact source span', () => {
    const pug = 'span= ${missingName}';
    const result = compilePugToTsx(pug);
    const name = 'missingName';
    const nameOffset = pug.indexOf(name);
    expect(nameOffset).toBeGreaterThanOrEqual(0);

    expect(result.mappings.some(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === nameOffset
        && m.lengths[0] === name.length,
    )).toBe(true);
  });

  it('maps nested pug expression internals inside ${} to exact source span', () => {
    const pug = 'span= ${pug`span= nestedValue`}';
    const result = compilePugToTsx(pug);
    const name = 'nestedValue';
    const nameOffset = pug.indexOf(name);
    expect(nameOffset).toBeGreaterThanOrEqual(0);

    expect(result.mappings.some(
      m => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === nameOffset
        && m.lengths[0] === name.length,
    )).toBe(true);
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

// ── Conditionals ────────────────────────────────────────────────

describe('conditionals', () => {
  it('if without else -> condition ? <body> : null', () => {
    const pug = 'if show\n  span Hello';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('show');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain('<span');
    expect(result.tsx).toContain('Hello');
    // No else branch -> null
    expect(result.tsx).toContain(': null');
    expect(result.parseError).toBeNull();
  });

  it('if/else -> condition ? <consequent> : <alternate>', () => {
    const pug = 'if isLoggedIn\n  span Welcome\nelse\n  span Login';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('isLoggedIn');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain(':');
    expect(result.tsx).toContain('Welcome');
    expect(result.tsx).toContain('Login');
    expect(result.parseError).toBeNull();
  });

  it('if/else-if/else -> chained ternary', () => {
    const pug = 'if status === "active"\n  span Active\nelse if status === "pending"\n  span Pending\nelse\n  span Unknown';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('status === "active"');
    expect(result.tsx).toContain('status === "pending"');
    expect(result.tsx).toContain('Active');
    expect(result.tsx).toContain('Pending');
    expect(result.tsx).toContain('Unknown');
    // Should have at least two ternary operators for chained if/else-if/else
    const qmarks = result.tsx.match(/\?/g) ?? [];
    expect(qmarks.length).toBeGreaterThanOrEqual(2);
    expect(result.parseError).toBeNull();
  });

  it('condition expression is mapped with FULL_FEATURES', () => {
    const pug = 'if show\n  div';
    const result = compilePugToTsx(pug);
    const condMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'show'.length
    );
    expect(condMapping).toBeDefined();
  });

  it('if with empty consequent -> null placeholder', () => {
    // pug parser should handle "if cond" with no children
    // This may be a parser error or produce an empty block
    const pug = 'if show';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('show');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain('null');
  });

  it('nested conditional inside tag', () => {
    const pug = 'div\n  if visible\n    span Show\n  else\n    span Hide';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('<div>');
    expect(result.tsx).toContain('visible');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain('Show');
    expect(result.tsx).toContain('Hide');
    expect(result.tsx).toContain('</div>');
  });

  it('conditional as root node', () => {
    const pug = 'if active\n  div Hello';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('active');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('Hello');
    expect(result.tsx).not.toContain('{active ?');
    expect(result.parseError).toBeNull();
  });

  it('multiple else-if chains produce multiple ternaries', () => {
    const pug = [
      'if a',
      '  span A',
      'else if b',
      '  span B',
      'else if c',
      '  span C',
      'else',
      '  span D',
    ].join('\n');
    const result = compilePugToTsx(pug);
    const qmarks = result.tsx.match(/\?/g) ?? [];
    expect(qmarks.length).toBeGreaterThanOrEqual(3);
    expect(result.tsx).toContain('A');
    expect(result.tsx).toContain('B');
    expect(result.tsx).toContain('C');
    expect(result.tsx).toContain('D');
  });
});

// ── Each loops ──────────────────────────────────────────────────

describe('each loops', () => {
  it('basic each -> for..of accumulator IIFE', () => {
    const pug = 'each item in items\n  li= item';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('items');
    expect(result.tsx).toContain('for (const item of items)');
    expect(result.tsx).toContain('const __pugEachResult: JSX.Element[] = []');
    expect(result.tsx).toContain('item');
    expect(result.tsx).toContain('__pugEachResult.push(');
    expect(result.tsx).toContain('<li');
    expect(result.parseError).toBeNull();
  });

  it('each with key -> for..of plus index binding', () => {
    const pug = 'each item, i in items\n  li= item';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('items');
    expect(result.tsx).toContain('for (const item of items)');
    expect(result.tsx).toContain('item');
    expect(result.tsx).toContain('let __pugEachIndex = 0;');
    expect(result.tsx).toContain('const i = __pugEachIndex;');
    expect(result.tsx).toContain('__pugEachIndex++;');
  });

  it('obj expression is mapped with FULL_FEATURES', () => {
    const pug = 'each item in myArray\n  span= item';
    const result = compilePugToTsx(pug);
    const objMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'myArray'.length
    );
    expect(objMapping).toBeDefined();
  });

  it('val variable is mapped with FULL_FEATURES', () => {
    const pug = 'each item in items\n  span= item';
    const result = compilePugToTsx(pug);
    // The loop variable 'item' should be mapped (in the .map callback param)
    const valMappings = result.mappings.filter(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'item'.length
    );
    expect(valMappings.length).toBeGreaterThanOrEqual(1);
  });

  it('key variable is mapped with FULL_FEATURES', () => {
    const pug = 'each item, idx in items\n  span= item';
    const result = compilePugToTsx(pug);
    const keyMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'idx'.length
    );
    expect(keyMapping).toBeDefined();
  });

  it('each with nested body', () => {
    const pug = 'each user in users\n  .card\n    h2= user.name\n    p= user.email';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('users');
    expect(result.tsx).toContain('for (const user of users)');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('className="card"');
    expect(result.tsx).toContain('<h2');
    expect(result.tsx).toContain('user.name');
    expect(result.tsx).toContain('user.email');
    expect(result.tsx).toContain('</div>');
  });

  it('each with empty body -> parse error or null pushed', () => {
    // Bare each with no children may cause a parser error
    const pug = 'each item in items';
    const result = compilePugToTsx(pug);
    // Either parse error (null placeholder) or compiled with null body
    expect(result.tsx).toContain('null');
    expect(typeof result.tsx).toBe('string');
  });

  it('each as root node', () => {
    const pug = 'each item in list\n  div= item';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('list');
    expect(result.tsx).toContain('for (const item of list)');
    expect(result.tsx).not.toContain('.map(');
    expect(result.tsx).toContain('<div');
    expect(result.parseError).toBeNull();
  });

  it('each with else returns alternate block when list is empty', () => {
    const pug = [
      'each cat in cats',
      '  li= cat.name',
      'else',
      '  p.empty No cats',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('for (const cat of cats)');
    expect(result.tsx).toContain('return __pugEachResult.length ? __pugEachResult : ');
    expect(result.tsx).toContain('<p className="empty">No cats</p>');
    expect(result.parseError).toBeNull();
  });

  it('emits runtime-safe each loop output without TS annotations', () => {
    const result = compilePugToTsx('each item in list\n  span= item', { mode: 'runtime' });
    expect(result.tsx).toContain('const __pugEachResult = []');
    expect(result.tsx).not.toContain('JSX.Element[]');
  });
});

// ── While loops ─────────────────────────────────────────────────

describe('while loops', () => {
  it('while -> IIFE with __r array pattern', () => {
    const pug = 'while items.length\n  div= items.pop()';
    const result = compilePugToTsx(pug);
    // IIFE wrapper
    expect(result.tsx).toContain('(() => {');
    expect(result.tsx).toContain('const __r: JSX.Element[] = []');
    expect(result.tsx).toContain('while (');
    expect(result.tsx).toContain('items.length');
    expect(result.tsx).toContain(') {');
    expect(result.tsx).toContain('__r.push(');
    expect(result.tsx).toContain('return __r;');
    expect(result.parseError).toBeNull();
  });

  it('test expression is mapped with FULL_FEATURES', () => {
    const pug = 'while condition\n  div';
    const result = compilePugToTsx(pug);
    const testMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'condition'.length
    );
    expect(testMapping).toBeDefined();
  });

  it('while with empty body -> null pushed', () => {
    const pug = 'while running';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('while (');
    expect(result.tsx).toContain('running');
    expect(result.tsx).toContain('null');
  });

  it('while with nested children', () => {
    const pug = 'while hasMore()\n  .item\n    span Text';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('hasMore()');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('className="item"');
    expect(result.tsx).toContain('<span');
    expect(result.tsx).toContain('Text');
  });
});

// ── Case/When ───────────────────────────────────────────────────

describe('case/when', () => {
  it('case with when clauses -> chained ternaries', () => {
    const pug = [
      'case fruit',
      '  when "apple"',
      '    span Apple',
      '  when "banana"',
      '    span Banana',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('fruit');
    expect(result.tsx).toContain('===');
    expect(result.tsx).toContain('"apple"');
    expect(result.tsx).toContain('Apple');
    expect(result.tsx).toContain('"banana"');
    expect(result.tsx).toContain('Banana');
    expect(result.parseError).toBeNull();
  });

  it('case with default clause', () => {
    const pug = [
      'case color',
      '  when "red"',
      '    span Red',
      '  default',
      '    span Other',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('color');
    expect(result.tsx).toContain('===');
    expect(result.tsx).toContain('"red"');
    expect(result.tsx).toContain('Red');
    expect(result.tsx).toContain('Other');
    // Default should not have '==='
    // Count === occurrences -- should only be 1 (for "red")
    const eqs = result.tsx.match(/===/g) ?? [];
    expect(eqs.length).toBe(1);
  });

  it('case expression uses VERIFY_ONLY mapping', () => {
    const pug = [
      'case myVal',
      '  when "a"',
      '    span A',
    ].join('\n');
    const result = compilePugToTsx(pug);
    const verifyMapping = result.mappings.find(m => m.data === VERIFY_ONLY);
    expect(verifyMapping).toBeDefined();
  });

  it('when expression uses FULL_FEATURES mapping', () => {
    const pug = [
      'case x',
      '  when "hello"',
      '    span Hi',
    ].join('\n');
    const result = compilePugToTsx(pug);
    const whenMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === '"hello"'.length
    );
    expect(whenMapping).toBeDefined();
  });

  it('case with no when clauses -> parse error or null placeholder', () => {
    // Bare case with no when children may cause a parser error
    const pug = 'case empty';
    const result = compilePugToTsx(pug);
    // Either parse error (null placeholder) or compiled with {null}
    expect(result.tsx).toContain('null');
    expect(typeof result.tsx).toBe('string');
  });

  it('case with multiple when and default', () => {
    const pug = [
      'case size',
      '  when "sm"',
      '    span Small',
      '  when "md"',
      '    span Medium',
      '  when "lg"',
      '    span Large',
      '  default',
      '    span Normal',
    ].join('\n');
    const result = compilePugToTsx(pug);
    const eqs = result.tsx.match(/===/g) ?? [];
    expect(eqs.length).toBe(3);
    expect(result.tsx).toContain('Small');
    expect(result.tsx).toContain('Medium');
    expect(result.tsx).toContain('Large');
    expect(result.tsx).toContain('Normal');
  });

  it('case with empty when body -> null', () => {
    const pug = [
      'case val',
      '  when "a"',
      '  default',
      '    span Default',
    ].join('\n');
    const result = compilePugToTsx(pug);
    // "a" branch should produce null, default should produce span
    expect(result.tsx).toContain('null');
    expect(result.tsx).toContain('Default');
  });
});

// ── Code blocks ─────────────────────────────────────────────────

describe('code blocks', () => {
  it('unbuffered code: - const x = 10 -> statement with semicolon', () => {
    const pug = '- const x = 10\nspan= x';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('const x = 10');
    expect(result.tsx).toContain(';');
    expect(result.tsx).toContain('<span');
    expect(result.parseError).toBeNull();
  });

  it('unbuffered code mixed with JSX wraps in IIFE', () => {
    const pug = '- const name = "World"\nh1= name';
    const result = compilePugToTsx(pug);
    // Should use IIFE pattern
    expect(result.tsx).toContain('(() => {');
    expect(result.tsx).toContain('const name = "World"');
    expect(result.tsx).toContain(';');
    expect(result.tsx).toContain('return ');
    expect(result.tsx).toContain('<h1');
    expect(result.tsx).toContain('})()');
  });

  it('wraps mixed unbuffered children in JSX expression container', () => {
    const pug = [
      'Modal(title="Demo")',
      '  - const oppositeBreed = selectedBreed === "domestic" ? "wild" : "domestic"',
      '  span= oppositeBreed',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('<Modal');
    expect(result.tsx).toContain('{(() => {');
    expect(result.tsx).toContain('const oppositeBreed');
    expect(result.tsx).toContain('<span');
    expect(result.parseError).toBeNull();
  });

  it('code block expression is mapped with FULL_FEATURES', () => {
    const pug = '- const x = 10\nspan= x';
    const result = compilePugToTsx(pug);
    const codeMapping = result.mappings.find(
      m => m.data === FULL_FEATURES && m.lengths[0] === 'const x = 10'.length
    );
    expect(codeMapping).toBeDefined();
  });

  it('multiple code blocks before JSX', () => {
    const pug = '- const a = 1\n- const b = 2\nspan= a + b';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('const a = 1');
    expect(result.tsx).toContain('const b = 2');
    expect(result.tsx).toContain('<span');
    // IIFE wrapping
    expect(result.tsx).toContain('(() => {');
    expect(result.tsx).toContain('return ');
  });

  it('code-only block (no JSX) wraps in IIFE returning null', () => {
    const pug = '- console.log("hello")';
    const result = compilePugToTsx(pug);
    // Only code, no JSX -> IIFE returning null
    expect(result.tsx).toContain('(() => {');
    expect(result.tsx).toContain('console.log("hello")');
    expect(result.tsx).toContain('return null;');
    expect(result.tsx).toContain('})()');
  });

  it('code block as child of tag', () => {
    const pug = 'div\n  - const msg = "hi"\n  span= msg';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('<div>');
    expect(result.tsx).toContain('const msg = "hi"');
    expect(result.tsx).toContain('<span');
    expect(result.tsx).toContain('</div>');
  });

  it('IIFE returns fragment when multiple JSX siblings follow code', () => {
    const pug = '- const x = 1\nspan First\nspan Second';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('(() => {');
    expect(result.tsx).toContain('return (');
    expect(result.tsx).toContain('<>');
    expect(result.tsx).toContain('First');
    expect(result.tsx).toContain('Second');
    expect(result.tsx).toContain('</>');
  });
});

// ── Control flow edge cases ─────────────────────────────────────

describe('control flow edge cases', () => {
  it('conditional inside each loop', () => {
    const pug = [
      'each item in items',
      '  if item.active',
      '    span= item.name',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('items');
    expect(result.tsx).toContain('for (const item of items)');
    expect(result.tsx).toContain('item.active');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain('item.name');
  });

  it('each loop inside conditional', () => {
    const pug = [
      'if showList',
      '  each item in items',
      '    li= item',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('showList');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain('items');
    expect(result.tsx).toContain('for (const item of items)');
    expect(result.tsx).toContain('<li');
  });

  it('else branch with each emits loop expression (not object literal)', () => {
    const pug = [
      'if activeTodos.length === 0',
      '  p.empty All done!',
      'else',
      '  each todo in activeTodos',
      '    span= todo.text',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.parseError).toBeNull();
    expect(result.tsx).toContain('for (const todo of activeTodos)');
    expect(result.tsx).not.toMatch(/:\s*\{\s*for\s*\(/);
  });

  it('control flow with sibling tags uses fragment', () => {
    const pug = 'div\nif show\n  span Hello';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('<>');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('show');
    expect(result.tsx).toContain('</>');
  });

  it('deeply nested control flow', () => {
    const pug = [
      'div',
      '  if a',
      '    if b',
      '      span Both',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('<div>');
    const qmarks = result.tsx.match(/\?/g) ?? [];
    expect(qmarks.length).toBeGreaterThanOrEqual(2);
    expect(result.tsx).toContain('Both');
    expect(result.tsx).toContain('</div>');
  });

  it('while loop as root with sibling', () => {
    const pug = 'div\nwhile cond\n  span Item';
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('<>');
    expect(result.tsx).toContain('<div');
    expect(result.tsx).toContain('while (');
    expect(result.tsx).toContain('cond');
    expect(result.tsx).toContain('</>');
  });

  it('case/when inside tag children', () => {
    const pug = [
      'div',
      '  case mode',
      '    when "edit"',
      '      input(type="text")',
      '    when "view"',
      '      span Display',
      '    default',
      '      span Unknown',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('<div>');
    expect(result.tsx).toContain('mode');
    expect(result.tsx).toContain('===');
    expect(result.tsx).toContain('"edit"');
    expect(result.tsx).toContain('<input');
    expect(result.tsx).toContain('"view"');
    expect(result.tsx).toContain('Display');
    expect(result.tsx).toContain('Unknown');
    expect(result.tsx).toContain('</div>');
  });

  it('code block with conditional', () => {
    const pug = [
      '- const x = getVal()',
      'if x > 0',
      '  span Positive',
      'else',
      '  span Zero or negative',
    ].join('\n');
    const result = compilePugToTsx(pug);
    expect(result.tsx).toContain('const x = getVal()');
    expect(result.tsx).toContain('x > 0');
    expect(result.tsx).toContain('?');
    expect(result.tsx).toContain('Positive');
    expect(result.tsx).toContain('Zero or negative');
  });
});

// ── Runtime compile mode ────────────────────────────────────────

describe('runtime compile mode', () => {
  it('emits runtime-safe while loop output without TS annotations', () => {
    const result = compilePugToTsx('while ready\n  span Ok', { mode: 'runtime' });
    expect(result.tsx).toContain('const __r = []');
    expect(result.tsx).not.toContain('JSX.Element[]');
  });

  it('emits null placeholder in runtime mode for invalid pug', () => {
    const result = compilePugToTsx('div(\n  !!!invalid', { mode: 'runtime' });
    expect(result.tsx).toContain('null');
    expect(result.tsx).not.toContain('(null as any as JSX.Element)');
    expect(result.parseError).not.toBeNull();
  });

  it('preserves nested pug interpolation behavior in runtime mode', () => {
    const pug = [
      'Button(',
      '  tooltip=${pug`span= tooltipText`}',
      ')',
    ].join('\n');
    const result = compilePugToTsx(pug, { mode: 'runtime' });
    expect(result.tsx).toContain('<Button');
    expect(result.tsx).toContain('<span');
    expect(result.tsx).toContain('tooltipText');
  });
});

// ── Class shorthand strategy ────────────────────────────────────

describe('class shorthand strategy', () => {
  it('defaults to className with concatenation semantics', () => {
    const result = compilePugToTsx('span.title');
    expect(result.tsx).toContain('className="title"');
  });

  it('can target plain class attribute', () => {
    const result = compilePugToTsx('span.title', {
      classAttribute: 'class',
      classMerge: 'concatenate',
    });
    expect(result.tsx).toContain(' class="title"');
    expect(result.tsx).not.toContain('className=');
  });

  it('classnames mode for styleName emits array merge', () => {
    const result = compilePugToTsx('span.title(styleName=active)', {
      classAttribute: 'styleName',
      classMerge: 'classnames',
    });
    expect(result.tsx).toContain('styleName={["title", active]}');
  });

  it('concatenate mode for className merges into string expression', () => {
    const result = compilePugToTsx('span.title(className=activeClass)', {
      classAttribute: 'className',
      classMerge: 'concatenate',
    });
    expect(result.tsx).toContain('className={"title" + " " + (activeClass)}');
  });

  it('classnames mode can be used without explicit attribute', () => {
    const result = compilePugToTsx('span.title.bold', {
      classAttribute: 'styleName',
      classMerge: 'classnames',
    });
    expect(result.tsx).toContain('styleName={["title", "bold"]}');
  });

  it('keeps mapping for existing className attr when merged with shorthand class', () => {
    const pug = "h1.active(className='hello')";
    const result = compilePugToTsx(pug);
    const classNameOffset = pug.indexOf('className');
    expect(classNameOffset).toBeGreaterThanOrEqual(0);
    expect(result.mappings.some(
      (m) => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === classNameOffset
        && m.lengths[0] === 'className'.length,
    )).toBe(true);
  });

  it('keeps mapping for existing styleName attr when merged with shorthand class', () => {
    const pug = 'Button.active(styleName=active)';
    const result = compilePugToTsx(pug, {
      classAttribute: 'styleName',
      classMerge: 'classnames',
    });
    const styleNameOffset = pug.indexOf('styleName');
    expect(styleNameOffset).toBeGreaterThanOrEqual(0);
    expect(result.mappings.some(
      (m) => m.data === FULL_FEATURES
        && m.sourceOffsets[0] === styleNameOffset
        && m.lengths[0] === 'styleName'.length,
    )).toBe(true);
  });
});

describe('component path from uppercase shorthand', () => {
  it('treats leading uppercase shorthand segments as component path by default', () => {
    const result = compilePugToTsx('Modal.Header.Right.icons.active(onPress=() => {})');
    expect(result.tsx).toContain('<Modal.Header.Right');
    expect(result.tsx).toContain('className="icons active"');
    expect(result.tsx).toContain('onPress={() => {}}');
    expect(result.tsx).not.toContain('className="Header Right icons active"');
  });

  it('stops component-path expansion at first lowercase shorthand segment', () => {
    const result = compilePugToTsx('Modal.icons.active.Header.Right');
    expect(result.tsx).toContain('<Modal');
    expect(result.tsx).toContain('className="icons active Header Right"');
    expect(result.tsx).not.toContain('<Modal.icons');
  });

  it('can disable uppercase shorthand component-path behavior via option', () => {
    const result = compilePugToTsx('Modal.Header.Right.icons.active', {
      componentPathFromUppercaseClassShorthand: false,
    });
    expect(result.tsx).toContain('<Modal');
    expect(result.tsx).toContain('className="Header Right icons active"');
    expect(result.tsx).not.toContain('<Modal.Header.Right');
  });
});
