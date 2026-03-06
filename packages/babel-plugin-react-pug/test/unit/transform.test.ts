import { describe, expect, it } from 'vitest';
import { transformSync } from '@babel/core';
import babelPluginReactPug, {
  mapBabelGeneratedDiagnosticToOriginal,
  transformReactPugSourceForBabel,
} from '../../src/index';

function transform(code: string, options: Record<string, unknown> = {}): string {
  const result = transformSync(code, {
    filename: 'fixture.tsx',
    configFile: false,
    babelrc: false,
    parserOpts: {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    },
    generatorOpts: {
      compact: false,
      comments: false,
    },
    plugins: [[babelPluginReactPug, { mode: 'runtime', ...options }]],
  });

  if (!result?.code) throw new Error('Babel transform returned empty code');
  return result.code;
}

describe('babel-plugin-react-pug transform', () => {
  it('replaces pug tagged template with JSX expression', () => {
    const out = transform('const view = pug`Button(label=\"Save\")`;');
    expect(out).not.toContain('pug`');
    expect(out).toContain('<Button');
    expect(out).toContain('label');
  });

  it('supports interpolated expressions in attributes', () => {
    const out = transform([
      'const activeTodos = [1, 2, 3];',
      'const view = pug`Button(count=${activeTodos.length})`;',
    ].join('\n'));
    expect(out).toContain('activeTodos.length');
    expect(out).toContain('count');
  });

  it('supports conditional and each control flow', () => {
    const out = transform([
      'const view = pug`',
      '  if show',
      '    each todo in todos',
      '      span= todo.text',
      '`;',
    ].join('\n'));
    expect(out).toContain('show');
    expect(out).toContain('todos');
    expect(out).toContain('.map(');
    expect(out).toContain('todo.text');
  });

  it('supports while loops in runtime mode without TS-only syntax', () => {
    const out = transform([
      'const view = pug`',
      '  while ready',
      '    span Ok',
      '`;',
    ].join('\n'));
    expect(out).toContain('while (ready)');
    expect(out).toContain('const __r = []');
    expect(out).not.toContain('JSX.Element[]');
  });

  it('supports unbuffered code lines', () => {
    const out = transform([
      'const view = pug`',
      '  - const value = getValue()',
      '  span= value',
      '`;',
    ].join('\n'));
    expect(out).toContain('const value = getValue()');
    expect(out).toContain('value');
  });

  it('supports nested pug templates inside ${} interpolation', () => {
    const out = transform([
      'const view = pug`',
      '  Button(',
      '    tooltip=${pug`',
      '      span Tooltip',
      '    `}',
      '  )',
      '`;',
    ].join('\n'));
    expect(out).toContain('<Button');
    expect(out).toContain('<span');
    expect(out).toContain('Tooltip');
  });

  it('supports text nodes piped with |', () => {
    const out = transform([
      'const view = pug`',
      '  span',
      '    | Hello',
      '    | World',
      '`;',
    ].join('\n'));
    expect(out).toContain('Hello');
    expect(out).toContain('World');
  });

  it('transforms multiple pug templates in one file', () => {
    const out = transform([
      'const a = pug`span One`;',
      'const b = pug`Button(label=\"Two\")`;',
    ].join('\n'));
    expect(out).toContain('<span');
    expect(out).toContain('<Button');
    expect(out).not.toContain('pug`');
  });

  it('respects custom tagFunction option', () => {
    const out = transform('const view = html`span One`;', { tagFunction: 'html' });
    expect(out).toContain('<span');
    expect(out).not.toContain('html`');
  });

  it('stores transform metadata on babel file for downstream remapping', () => {
    const input = 'const view = pug`span= title`;';
    const result = transformSync(input, {
      filename: 'fixture.tsx',
      configFile: false,
      babelrc: false,
      parserOpts: {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      },
      plugins: [[babelPluginReactPug, { mode: 'runtime' }]],
    });

    const metadata = (result?.metadata as any)?.reactPug;
    expect(metadata).toBeTruthy();
    expect(metadata.regions.length).toBe(1);
  });
});

describe('babel-plugin-react-pug mapping helpers', () => {
  it('maps generated diagnostic position back to original pug location', () => {
    const input = [
      'const title = \"hello\";',
      'const view = pug`span= title.toUpperCase()`;',
    ].join('\n');

    const transformed = transformReactPugSourceForBabel(input, 'fixture.tsx', { mode: 'runtime' });
    const generatedOffset = transformed.code.indexOf('toUpperCase');
    const mapped = mapBabelGeneratedDiagnosticToOriginal(transformed.metadata, {
      start: generatedOffset,
      length: 'toUpperCase'.length,
    });

    expect(mapped).not.toBeNull();
    expect(mapped!.startLine).toBe(2);
    expect(input.slice(mapped!.start, mapped!.end)).toContain('toUpperCase');
  });

  it('maps nested interpolation diagnostics back to outer source', () => {
    const input = [
      'const view = pug`',
      '  Button(tooltip=${pug`',
      '    span= submitDescription',
      '  `})',
      '`;',
    ].join('\n');

    const transformed = transformReactPugSourceForBabel(input, 'fixture.tsx', { mode: 'runtime' });
    const generatedOffset = transformed.code.indexOf('submitDescription');
    const mapped = mapBabelGeneratedDiagnosticToOriginal(transformed.metadata, {
      start: generatedOffset,
      length: 'submitDescription'.length,
    });

    expect(mapped).not.toBeNull();
    expect(input.slice(mapped!.start, mapped!.end)).toContain('submitDescription');
  });
});
