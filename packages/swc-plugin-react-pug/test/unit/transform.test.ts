import { describe, expect, it } from 'vitest';
import {
  mapSwcGeneratedDiagnosticToOriginal,
  transformReactPugSourceForSwc,
  transformWithSwcReactPug,
} from '../../src/index';

describe('swc-plugin-react-pug transform', () => {
  it('pretransforms pug tagged template regions', () => {
    const result = transformReactPugSourceForSwc('const view = pug`Button(label="Save")`;', 'fixture.tsx');
    expect(result.code).not.toContain('pug`');
    expect(result.code).toContain('<Button');
  });

  it('supports nested pug inside interpolation', () => {
    const source = [
      'const view = pug`',
      '  Button(tooltip=${pug`',
      '    span Tooltip',
      '  `})',
      '`;',
    ].join('\n');

    const result = transformReactPugSourceForSwc(source, 'fixture.tsx');
    expect(result.code).toContain('<Button');
    expect(result.code).toContain('<span');
    expect(result.code).toContain('Tooltip');
  });

  it('emits runtime-safe while output', () => {
    const source = ['const view = pug`', '  while ready', '    span Ok', '`;'].join('\n');
    const result = transformReactPugSourceForSwc(source, 'fixture.tsx');
    expect(result.code).toContain('const __r = []');
    expect(result.code).not.toContain('JSX.Element[]');
  });

  it('compiles transformed code through @swc/core', () => {
    const source = [
      'const view = pug`',
      '  each todo in todos',
      '    span= todo.text',
      '`;',
    ].join('\n');

    const result = transformWithSwcReactPug(source, 'fixture.tsx', {
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'automatic' } },
      },
      module: { type: 'es6' },
      sourceMaps: true,
    });

    expect(result.swcCode).toContain('todo.text');
    expect(result.swcCode).not.toContain('pug`');
    expect(result.swcMap).toBeTypeOf('string');
  });
});

describe('swc-plugin-react-pug mapping helpers', () => {
  it('maps generated positions to original file locations', () => {
    const source = [
      'const title = "hello";',
      'const view = pug`span= title.toUpperCase()`;',
    ].join('\n');

    const transformed = transformReactPugSourceForSwc(source, 'fixture.tsx');
    const generatedOffset = transformed.code.indexOf('toUpperCase');
    const mapped = mapSwcGeneratedDiagnosticToOriginal(transformed.metadata, {
      start: generatedOffset,
      length: 'toUpperCase'.length,
    });

    expect(mapped).not.toBeNull();
    expect(mapped!.startLine).toBe(2);
    expect(source.slice(mapped!.start, mapped!.end)).toContain('toUpperCase');
  });
});
