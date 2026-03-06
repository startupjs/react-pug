import { describe, expect, it } from 'vitest';
import {
  mapSwcGeneratedDiagnosticToOriginal,
  mapSwcGeneratedRangeToOriginal,
  transformReactPugSourceForSwc,
  transformWithSwcReactPug,
} from '../../src/index';
import {
  COMPILER_JS_RUNTIME_SOURCE,
  COMPILER_MULTI_REGION_SOURCE,
  COMPILER_NESTED_INTERPOLATION_SOURCE,
  COMPILER_STRESS_SOURCE_TSX,
  expectNoTsOnlyRuntimeSyntax,
} from '../../../react-pug-core/test/fixtures/compiler-fixtures';

describe('swc-plugin-react-pug transform', () => {
  it('pretransforms pug tagged template regions', () => {
    const result = transformReactPugSourceForSwc('const view = pug`Button(label="Save")`;', 'fixture.tsx');
    expect(result.code).not.toContain('pug`');
    expect(result.code).toContain('<Button');
  });

  it('supports nested pug inside interpolation', () => {
    const result = transformReactPugSourceForSwc(COMPILER_NESTED_INTERPOLATION_SOURCE, 'fixture.tsx');
    expect(result.code).toContain('<Button');
    expect(result.code).toContain('<span');
    expect(result.code).toContain('submitDescription');
  });

  it('auto class strategy switches to styleName+classnames for startupjs marker', () => {
    const source = [
      'import { pug } from "startupjs";',
      'const active = { active: true };',
      'const view = pug`span.title(styleName=active)`;',
    ].join('\n');
    const result = transformReactPugSourceForSwc(source, 'fixture.tsx');
    expect(result.code).toContain('styleName={["title", active]}');
  });

  it('allows forcing class shorthand property and merge strategy', () => {
    const source = 'const view = pug`span.title(class=isActive)`;';
    const result = transformReactPugSourceForSwc(source, 'fixture.tsx', {
      classShorthandProperty: 'class',
      classShorthandMerge: 'concatenate',
    });
    expect(result.code).toContain('class={"title" + " " + (isActive)}');
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
    const parsedMap = JSON.parse(result.swcMap!);
    expect(Array.isArray(parsedMap.sources)).toBe(true);
    expect(parsedMap.sources.join('\n')).toContain('fixture.tsx');
  });

  it('keeps JS/JSX runtime output free of TS-only syntax', () => {
    const result = transformReactPugSourceForSwc(COMPILER_JS_RUNTIME_SOURCE, 'fixture.jsx');
    expect(result.code).toContain('const __r = []');
    expectNoTsOnlyRuntimeSyntax(result.code);
  });

  it('transforms shared stress fixture with nested + multi-region coverage', () => {
    const result = transformReactPugSourceForSwc(COMPILER_STRESS_SOURCE_TSX, 'fixture.tsx');
    expect(result.code).not.toContain('pug`');
    expect(result.code).toContain('tooltipText.toUpperCase');
    expect(result.code).toContain('tooltipText.toLowerCase');
    expect(result.code).toContain('.map(');
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

  it('maps generated ranges when file has multiple pug regions', () => {
    const transformed = transformReactPugSourceForSwc(COMPILER_MULTI_REGION_SOURCE, 'fixture.tsx');
    const generatedOffset = transformed.code.indexOf('two.toUpperCase');
    const mapped = mapSwcGeneratedRangeToOriginal(
      transformed.metadata,
      generatedOffset,
      'two.toUpperCase'.length,
    );

    expect(mapped).not.toBeNull();
    expect(COMPILER_MULTI_REGION_SOURCE.slice(mapped!.start, mapped!.end)).toContain('two.toUpperCase');
  });

  it('maps generated ranges for nested pug interpolation', () => {
    const transformed = transformReactPugSourceForSwc(COMPILER_STRESS_SOURCE_TSX, 'fixture.tsx');
    const generatedOffset = transformed.code.indexOf('tooltipText.toUpperCase');
    const mapped = mapSwcGeneratedRangeToOriginal(
      transformed.metadata,
      generatedOffset,
      'tooltipText.toUpperCase'.length,
    );

    expect(mapped).not.toBeNull();
    expect(COMPILER_STRESS_SOURCE_TSX.slice(mapped!.start, mapped!.end)).toContain('tooltipText.toUpperCase');
  });
});
