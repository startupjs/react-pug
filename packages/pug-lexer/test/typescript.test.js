const lex = require('../');

function getAttributes(tokens) {
  return tokens.filter((token) => token.type === 'attribute');
}

test('keeps `as` casts inside attribute values', () => {
  const tokens = lex(`Button(title=myTitle as string, as='link')`, {
    filename: 'casts.pug',
  });
  const attributes = getAttributes(tokens);

  expect(attributes).toEqual([
    expect.objectContaining({
      name: 'title',
      val: 'myTitle as string',
    }),
    expect.objectContaining({
      name: 'as',
      val: "'link'",
    }),
  ]);
});

test('keeps `satisfies` inside attribute values', () => {
  const tokens = lex(`Button(config=cardConfig satisfies CardConfig, satisfies='ok')`, {
    filename: 'satisfies.pug',
  });
  const attributes = getAttributes(tokens);

  expect(attributes).toEqual([
    expect.objectContaining({
      name: 'config',
      val: 'cardConfig satisfies CardConfig',
    }),
    expect.objectContaining({
      name: 'satisfies',
      val: "'ok'",
    }),
  ]);
});

test('supports spread attributes with TypeScript casts', () => {
  const tokens = lex(`Button(...(props as CardProps), label='x')`, {
    filename: 'spread.pug',
  });
  const attributes = getAttributes(tokens);

  expect(attributes).toEqual([
    expect.objectContaining({
      name: '...(props as CardProps)',
      val: true,
    }),
    expect.objectContaining({
      name: 'label',
      val: "'x'",
    }),
  ]);
});

test('supports TypeScript syntax in conditionals, loops, interpolation, and handlers', () => {
  expect(
    lex(`if foo as boolean\n  p yes`, { filename: 'if.pug' })[0],
  ).toEqual(
    expect.objectContaining({
      type: 'if',
      val: 'foo as boolean',
    }),
  );

  expect(
    lex(`each item in (items as string[])\n  p= item`, { filename: 'each.pug' })[0],
  ).toEqual(
    expect.objectContaining({
      type: 'each',
      val: 'item',
      code: '(items as string[])',
    }),
  );

  expect(
    lex(`p #{value as string}`, { filename: 'interpolation.pug' })[1],
  ).toEqual(
    expect.objectContaining({
      type: 'interpolated-code',
      val: 'value as string',
    }),
  );

  expect(
    getAttributes(
      lex(`input(onChange=(event: PressEvent) => event.currentTarget)`, {
        filename: 'handler.pug',
      }),
    )[0],
  ).toEqual(
    expect.objectContaining({
      name: 'onChange',
      val: '(event: PressEvent) => event.currentTarget',
    }),
  );
});
