'use strict';

const lex = require('../');

function findToken(tokens, type) {
  return tokens.find(token => token.type === type);
}

test('supports multiline buffered pure-JS expressions on code lines', () => {
  const tokens = lex(
    [
      'p= ready',
      "  ? formatLabel('yes')",
      "  : formatLabel('no')",
    ].join('\n'),
    { filename: 'multiline-buffered-js.pug' },
  );

  expect(findToken(tokens, 'code')).toEqual(
    expect.objectContaining({
      val: [
        'ready',
        "  ? formatLabel('yes')",
        "  : formatLabel('no')",
      ].join('\n'),
    }),
  );
});

test('supports multiline buffered TypeScript expressions with continuation keywords', () => {
  const tokens = lex(
    [
      'p= ({',
      '  label: value,',
      '}) satisfies CardConfig',
    ].join('\n'),
    { filename: 'multiline-buffered-ts-keyword.pug' },
  );

  expect(findToken(tokens, 'code')).toEqual(
    expect.objectContaining({
      val: [
        '({',
        '  label: value,',
        '}) satisfies CardConfig',
      ].join('\n'),
    }),
  );
});

test('supports multiline buffered expressions continued by line-leading nullish operators', () => {
  const tokens = lex(
    [
      'p= maybeValue',
      '  ?? fallbackValue',
    ].join('\n'),
    { filename: 'multiline-buffered-nullish.pug' },
  );

  expect(findToken(tokens, 'code')).toEqual(
    expect.objectContaining({
      val: [
        'maybeValue',
        '  ?? fallbackValue',
      ].join('\n'),
    }),
  );
});

test('stops multiline buffered code collection before the next sibling tag once the expression is complete', () => {
  const tokens = lex(
    [
      'p= formatValue(',
      '  source,',
      ')',
      'span Done',
    ].join('\n'),
    { filename: 'multiline-buffered-stop-before-sibling.pug' },
  );

  expect(tokens).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'code',
        val: [
          'formatValue(',
          '  source,',
          ')',
        ].join('\n'),
      }),
      expect.objectContaining({
        type: 'tag',
        val: 'span',
      }),
      expect.objectContaining({
        type: 'text',
        val: 'Done',
      }),
    ]),
  );
});

test('supports multiline text interpolation with nested objects and trailing text', () => {
  const tokens = lex(
    [
      'p Hello #{(() => {',
      "  const value = { label: 'hi' }",
      '  return value.label',
      '})()} world',
    ].join('\n'),
    { filename: 'multiline-interpolation-js.pug' },
  );

  expect(tokens).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'interpolated-code',
        val: [
          '(() => {',
          "  const value = { label: 'hi' }",
          '  return value.label',
          '})()',
        ].join('\n'),
      }),
      expect.objectContaining({
        type: 'text',
        val: ' world',
      }),
    ]),
  );
});

test('supports multiline text interpolation with TypeScript syntax', () => {
  const tokens = lex(
    [
      'p Hello #{(() => {',
      '  const value = known as string',
      '  return value',
      '})()} world',
    ].join('\n'),
    { filename: 'multiline-interpolation-ts.pug' },
  );

  expect(findToken(tokens, 'interpolated-code')).toEqual(
    expect.objectContaining({
      val: [
        '(() => {',
        '  const value = known as string',
        '  return value',
        '})()',
      ].join('\n'),
    }),
  );
});

test('keeps existing unbuffered code-block semantics with nested pug children', () => {
  const tokens = lex(
    [
      '- if (ready) {',
      '  p yes',
      '- }',
    ].join('\n'),
    { filename: 'multiline-unbuffered-js.pug' },
  );

  expect(tokens).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'code',
        val: 'if (ready) {',
        buffer: false,
      }),
      expect.objectContaining({
        type: 'tag',
        val: 'p',
      }),
      expect.objectContaining({
        type: 'text',
        val: 'yes',
      }),
      expect.objectContaining({
        type: 'code',
        val: '}',
        buffer: false,
      }),
    ]),
  );
});
