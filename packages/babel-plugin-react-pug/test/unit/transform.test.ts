import { describe, expect, it } from 'vitest';
import { transformSync } from '@babel/core';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import babelPluginTransformReactJsx from '@babel/plugin-transform-react-jsx';
import babelPluginReactPug, {
  mapBabelGeneratedDiagnosticToOriginal,
  transformReactPugSourceForBabel,
} from '../../src/index';
import {
  COMPILER_JS_RUNTIME_SOURCE,
  COMPILER_MULTI_REGION_SOURCE,
  COMPILER_NESTED_INTERPOLATION_SOURCE,
  COMPILER_STRESS_SOURCE_TSX,
  expectNoTsOnlyRuntimeSyntax,
} from '../../../react-pug-core/test/fixtures/compiler-fixtures';
import { lineColumnToOffset, offsetToLineColumn } from '../../../react-pug-core/src/language/diagnosticMapping';

function transform(
  code: string,
  options: Record<string, unknown> = {},
  filename: string = 'fixture.tsx',
): string {
  const result = transformSync(code, {
    filename,
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

function expectSourceMapPointsToOriginal(
  source: string,
  generatedCode: string,
  sourceMap: any,
  generatedSnippet: string,
  originalSnippet: string = generatedSnippet,
): void {
  const generatedOffset = generatedCode.indexOf(generatedSnippet);
  expect(generatedOffset).toBeGreaterThanOrEqual(0);

  const expectedOriginalOffset = source.indexOf(originalSnippet);
  expect(expectedOriginalOffset).toBeGreaterThanOrEqual(0);

  const generatedLc = offsetToLineColumn(generatedCode, generatedOffset);
  const original = originalPositionFor(new TraceMap(sourceMap), {
    line: generatedLc.line,
    column: generatedLc.column - 1,
  });

  expect(original.source).toBeTruthy();
  expect(original.line).not.toBeNull();
  expect(original.column).not.toBeNull();

  const actualOriginalOffset = lineColumnToOffset(source, original.line!, original.column! + 1);
  expect(actualOriginalOffset).toBe(expectedOriginalOffset);
}

function getOriginalOffsetFromSourceMap(
  source: string,
  generatedCode: string,
  sourceMap: any,
  generatedSnippet: string,
): number {
  const generatedOffset = generatedCode.indexOf(generatedSnippet);
  expect(generatedOffset).toBeGreaterThanOrEqual(0);

  const generatedLc = offsetToLineColumn(generatedCode, generatedOffset);
  const original = originalPositionFor(new TraceMap(sourceMap), {
    line: generatedLc.line,
    column: generatedLc.column - 1,
  });

  expect(original.line).not.toBeNull();
  expect(original.column).not.toBeNull();

  return lineColumnToOffset(source, original.line!, original.column! + 1);
}

describe('babel-plugin-react-pug transform', () => {
  it('replaces pug tagged template with JSX expression', () => {
    const out = transform('const view = pug`Button(label=\"Save\")`;');
    expect(out).toMatchInlineSnapshot(`"const view = <Button label={"Save"} />;"`);
  });

  it('supports interpolated expressions in attributes', () => {
    const out = transform([
      'const activeTodos = [1, 2, 3];',
      'const view = pug`Button(count=${activeTodos.length})`;',
    ].join('\n'));
    expect(out).toMatchInlineSnapshot(`
      "const activeTodos = [1, 2, 3];
      const view = <Button count={activeTodos.length} />;"
    `);
  });

  it('supports conditional and each control flow', () => {
    const out = transform([
      'const view = pug`',
      '  if show',
      '    each todo in todos',
      '      span= todo.text',
      '`;',
    ].join('\n'));
    expect(out).toMatchInlineSnapshot(`
      "const view = show ? (() => {
        const __pugEachResult = [];
        for (const todo of todos) {
          __pugEachResult.push(<span>{todo.text}</span>);
        }
        return __pugEachResult;
      })() : null;"
    `);
  });

  it('supports while loops in runtime mode without TS-only syntax', () => {
    const out = transform([
      'const view = pug`',
      '  while ready',
      '    span Ok',
      '`;',
    ].join('\n'));
    expect(out).toMatchInlineSnapshot(`
      "const view = (() => {
        const __r = [];
        while (ready) {
          __r.push(<span>Ok</span>);
        }
        return __r;
      })();"
    `);
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
    const out = transform(COMPILER_NESTED_INTERPOLATION_SOURCE);
    expect(out).toMatchInlineSnapshot(`
      "const submitDescription = "send form";
      const view = <Button label={"Submit"} tooltip={<div className="tooltip"><span className="tooltip-text">Click me!{submitDescription}</span><Button label={"info"} onClick><Icon name={"faCoffee"} /></Button></div>} />;"
    `);
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
    expect(out).toMatchInlineSnapshot(`
      "const a = <span>One</span>;
      const b = <Button label={"Two"} />;"
    `);
  });

  it('respects custom tagFunction option', () => {
    const out = transform('const view = html`span One`;', { tagFunction: 'html' });
    expect(out).toMatchInlineSnapshot(`"const view = <span>One</span>;"`);
  });

  it('auto class strategy switches to styleName+classnames for startupjs marker', () => {
    const out = transform([
      'import { pug } from "startupjs";',
      'const active = { active: true };',
      'const view = pug`span.title(styleName=active)`;',
    ].join('\n'));
    expect(out).toMatchInlineSnapshot(`
      "import "startupjs";
      const active = {
        active: true
      };
      const view = <span styleName={["title", active]} />;"
    `);
  });

  it('allows forcing class shorthand property and merge strategy', () => {
    const transformed = transformReactPugSourceForBabel(
      'const view = pug`span.title(class=isActive)`;',
      'fixture.tsx',
      { classShorthandProperty: 'class', classShorthandMerge: 'concatenate', mode: 'runtime' },
    );
    expect(transformed.code).toMatchInlineSnapshot(`"const view = (<span class={"title" + " " + (isActive)} />);"`);
  });

  it('removes a used pug import in basic mode and preserves side effects', () => {
    const out = transform([
      'import { pug } from "startupjs";',
      'const view = pug`span.title`;',
    ].join('\n'));
    expect(out).toMatchInlineSnapshot(`
      "import "startupjs";
      const view = <span styleName={["title"]} />;"
    `);
  });

  it('removes only the pug specifier from mixed imports in basic mode', () => {
    const out = transform([
      'import { pug, observer } from "startupjs";',
      'const view = pug`span.title`;',
    ].join('\n'));
    expect(out).toMatchInlineSnapshot(`
      "import { observer } from "startupjs";
      const view = <span styleName={["title"]} />;"
    `);
  });

  it('throws when requirePugImport is enabled and the tag is not imported', () => {
    expect(() => transform('const view = pug`span.title`;', {
      requirePugImport: true,
    })).toThrow('Missing import for tag function "pug"');
  });

  it('keeps JS/JSX runtime output free of TS-only syntax', () => {
    const out = transform(COMPILER_JS_RUNTIME_SOURCE, {}, 'fixture.jsx');
    expect(out).toContain('const __r = []');
    expectNoTsOnlyRuntimeSyntax(out);
  });

  it('produces babel sourcemaps when enabled', () => {
    const result = transformSync('const view = pug`span= title`;', {
      filename: 'sourcemap-fixture.tsx',
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      parserOpts: {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      },
      plugins: [[babelPluginReactPug, { mode: 'runtime' }]],
    });
    expect(result?.map).toBeTruthy();
    expect(result?.map?.sources.some((source: string) => source.endsWith('sourcemap-fixture.tsx'))).toBe(true);
  });

  it('uses basic sourcemap mode by default and preserves exact mappings outside pug', () => {
    const input = [
      'const title = "Hello";',
      'const view = pug`span= title.toUpperCase()`;',
      'const afterValue = title.trim();',
    ].join('\n');
    const result = transformSync(input, {
      filename: 'basic-sourcemap-fixture.tsx',
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      parserOpts: {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      },
      generatorOpts: {
        compact: false,
        comments: false,
      },
      plugins: [[babelPluginReactPug, { mode: 'runtime' }]],
    });

    const mappedOffset = getOriginalOffsetFromSourceMap(
      input,
      result?.code ?? '',
      result?.map,
      'title.toUpperCase',
    );
    const exactPugOffset = input.indexOf('title.toUpperCase');
    const afterOffset = getOriginalOffsetFromSourceMap(
      input,
      result?.code ?? '',
      result?.map,
      'title.trim',
    );
    const exactAfterOffset = input.indexOf('title.trim');

    expect(mappedOffset).not.toBe(exactPugOffset);
    expect(mappedOffset).toBeLessThan(exactPugOffset);
    expect(afterOffset).toBe(exactAfterOffset);
  });

  it('maps final babel output positions back to exact pug source offsets', () => {
    const input = 'const view = pug`span= title.toUpperCase()`;';
    const result = transformSync(input, {
      filename: 'sourcemap-fixture.tsx',
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      parserOpts: {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      },
      generatorOpts: {
        compact: false,
        comments: false,
      },
      plugins: [[babelPluginReactPug, { mode: 'runtime', sourceMaps: 'detailed' }]],
    });

    expect(result?.code).toBeTruthy();
    expect(result?.map).toBeTruthy();
    expectSourceMapPointsToOriginal(
      input,
      result?.code ?? '',
      result?.map,
      'title.toUpperCase',
    );
  });

  it('removes the pug import in detailed sourcemap mode too', () => {
    const out = transform([
      'import { pug } from "startupjs";',
      'const view = pug`span.title`;',
    ].join('\n'), { sourceMaps: 'detailed' });
    expect(out).toContain('import "startupjs";');
    expect(out).not.toContain('{ pug }');
  });

  it('preserves mappings through a downstream JSX transform after react-pug', () => {
    const input = [
      'const title = "Hello";',
      'const view = pug`',
      '  if visible',
      '    span= title.toUpperCase()',
      '`;',
    ].join('\n');

    const result = transformSync(input, {
      filename: 'chained-sourcemap-fixture.tsx',
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      parserOpts: {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      },
      generatorOpts: {
        compact: false,
        comments: false,
      },
      plugins: [
        [babelPluginReactPug, { mode: 'runtime', sourceMaps: 'detailed' }],
        [babelPluginTransformReactJsx, { runtime: 'classic' }],
      ],
    });

    expect(result?.code).toContain('React.createElement');
    expect(result?.map).toBeTruthy();
    expectSourceMapPointsToOriginal(
      input,
      result?.code ?? '',
      result?.map,
      'title.toUpperCase',
    );
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

  it('transforms shared stress fixture with multi-region + nested interpolation', () => {
    const out = transform(COMPILER_STRESS_SOURCE_TSX);
    expect(out).not.toContain('pug`');
    expect(out).toContain('tooltipText.toUpperCase');
    expect(out).toContain('tooltipText.toLowerCase');
    expect(out).toContain('for (const item of list.filter(it => !it.done))');
    expect(out).toContain('No pending items');
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
    const input = COMPILER_NESTED_INTERPOLATION_SOURCE;

    const transformed = transformReactPugSourceForBabel(input, 'fixture.tsx', { mode: 'runtime' });
    const generatedOffset = transformed.code.indexOf('submitDescription');
    const mapped = mapBabelGeneratedDiagnosticToOriginal(transformed.metadata, {
      start: generatedOffset,
      length: 'submitDescription'.length,
    });

    expect(mapped).not.toBeNull();
    expect(input.slice(mapped!.start, mapped!.end)).toContain('submitDescription');
  });

  it('maps diagnostics for stress fixture back to original source across regions', () => {
    const input = COMPILER_STRESS_SOURCE_TSX;
    const transformed = transformReactPugSourceForBabel(input, 'fixture.tsx', { mode: 'runtime' });
    const generatedOffset = transformed.code.indexOf('tooltipText.toLowerCase');
    const mapped = mapBabelGeneratedDiagnosticToOriginal(transformed.metadata, {
      start: generatedOffset,
      length: 'tooltipText.toLowerCase'.length,
    });

    expect(mapped).not.toBeNull();
    expect(input.slice(mapped!.start, mapped!.end)).toContain('tooltipText.toLowerCase');
  });

  it('maps diagnostics when source has multiple simple pug regions', () => {
    const input = COMPILER_MULTI_REGION_SOURCE;
    const transformed = transformReactPugSourceForBabel(input, 'fixture.tsx', { mode: 'runtime' });
    const generatedOffset = transformed.code.indexOf('two.toUpperCase');
    const mapped = mapBabelGeneratedDiagnosticToOriginal(transformed.metadata, {
      start: generatedOffset,
      length: 'two.toUpperCase'.length,
    });

    expect(mapped).not.toBeNull();
    expect(input.slice(mapped!.start, mapped!.end)).toContain('two.toUpperCase');
  });
});
