export const COMPILER_NESTED_INTERPOLATION_SOURCE = [
  'const submitDescription = "send form";',
  'const view = pug`',
  '  Button(',
  '    label="Submit"',
  '    tooltip=${pug`',
  '      .tooltip',
  '        span.tooltip-text',
  '          | Click me!',
  '          = submitDescription',
  '        Button(label="info" onClick)',
  '          Icon(name="faCoffee")',
  '    `}',
  '  )',
  '`;',
].join('\n');

export const COMPILER_STRESS_SOURCE_TSX = [
  'const list = [{ id: 1, text: "one", done: false }, { id: 2, text: "two", done: true }];',
  'const tooltipText = "hello";',
  'const view = pug`',
  '  .app',
  '    if list.length > 0',
  '      each item in (list.filter(it => !it.done))',
  '        Button.primary(',
  '          key=item.id',
  '          onClick=() => alert(item.text)',
  '          tooltip=${pug`',
  '            .tip',
  '              span= tooltipText.toUpperCase()',
  '          `}',
  '        )',
  '          span.label= item.text',
  '      else',
  '        span.none No pending items',
  '    else',
  '      - const fallback = tooltipText + "!"',
  '      span.empty= fallback',
  '`;',
  'const secondary = pug`span.note= tooltipText.toLowerCase()`;',
].join('\n');

export const COMPILER_JS_RUNTIME_SOURCE = [
  'const view = pug`',
  '  while ready',
  '    span Ok',
  '`;',
].join('\n');

export const COMPILER_MULTI_REGION_SOURCE = [
  'const first = pug`span= one`;',
  'const second = pug`span= two.toUpperCase()`;',
].join('\n');

export function expectNoTsOnlyRuntimeSyntax(output: string): void {
  if (output.includes('JSX.Element')) {
    throw new Error('output contains JSX.Element type annotation');
  }
  if (output.includes(' as any ')) {
    throw new Error('output contains TypeScript-only "as any" cast');
  }
}
