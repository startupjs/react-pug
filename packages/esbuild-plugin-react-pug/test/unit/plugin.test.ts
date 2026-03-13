import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import {
  mapEsbuildGeneratedDiagnosticToOriginal,
  mapEsbuildGeneratedRangeToOriginal,
  reactPugEsbuildPlugin,
  transformReactPugSourceForEsbuild,
} from '../../src/index';
import {
  COMPILER_JS_RUNTIME_SOURCE,
  COMPILER_MULTI_REGION_SOURCE,
  COMPILER_STRESS_SOURCE_TSX,
  expectNoTsOnlyRuntimeSyntax,
} from '../../../react-pug-core/test/fixtures/compiler-fixtures';

describe('esbuild-plugin-react-pug', () => {
  it('creates an esbuild plugin object', () => {
    const plugin = reactPugEsbuildPlugin();
    expect(plugin.name).toBe('react-pug');
    expect(typeof plugin.setup).toBe('function');
  });

  it('pretransforms pug templates before esbuild parses source', () => {
    const transformed = transformReactPugSourceForEsbuild(
      'const view = pug`Button(label="Save")`;',
      'fixture.tsx',
    );

    expect(transformed.code).toMatchInlineSnapshot(`"const view = (<Button label="Save" />);"`);
  });

  it('auto class strategy switches to styleName+classnames for startupjs marker', () => {
    const transformed = transformReactPugSourceForEsbuild([
      'import { pug } from "startupjs";',
      'const active = { active: true };',
      'const view = pug`span.title(styleName=active)`;',
    ].join('\n'), 'fixture.tsx');
    expect(transformed.code).toMatchInlineSnapshot(`
      "import "startupjs";
      const active = { active: true };
      const view = (<span styleName={['title', active]} />);"
    `);
  });

  it('allows forcing class shorthand property and merge strategy', () => {
    const transformed = transformReactPugSourceForEsbuild(
      'const view = pug`span.title(class=isActive)`;',
      'fixture.tsx',
      { classShorthandProperty: 'class', classShorthandMerge: 'concatenate' },
    );
    expect(transformed.code).toMatchInlineSnapshot(`"const view = (<span class={"title" + " " + (isActive)} />);"`);
  });

  it('keeps JS/JSX runtime output free of TS-only syntax', () => {
    const transformed = transformReactPugSourceForEsbuild(COMPILER_JS_RUNTIME_SOURCE, 'fixture.jsx');
    expect(transformed.code).toMatchInlineSnapshot(`"const view = ((() => {const __r = [];while (ready) {__r.push(<span>Ok</span>);}return __r;})());"`);
    expectNoTsOnlyRuntimeSyntax(transformed.code);
  });

  it('compiles through esbuild with pug syntax in source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'esbuild-react-pug-'));
    const entry = join(dir, 'entry.tsx');

    try {
      await writeFile(entry, [
        'const todos = [{ text: "one" }];',
        'const view = pug`',
        '  each todo in todos',
        '    span= todo.text',
        '`;',
        'export { view };',
      ].join('\n'));

      const result = await build({
        entryPoints: [entry],
        bundle: false,
        write: false,
        format: 'esm',
        jsx: 'transform',
        plugins: [reactPugEsbuildPlugin()],
      });

      const out = result.outputFiles?.[0]?.text ?? '';
      expect(out).not.toContain('pug`');
      expect(out).toContain('todo.text');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('compiles .js sources by switching transformed loader to jsx', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'esbuild-react-pug-js-'));
    const entry = join(dir, 'entry.js');

    try {
      await writeFile(entry, [
        'const view = pug`',
        '  span Hello',
        '`;',
        'export { view };',
      ].join('\n'));

      const result = await build({
        entryPoints: [entry],
        bundle: false,
        write: false,
        format: 'esm',
        jsx: 'transform',
        plugins: [reactPugEsbuildPlugin()],
      });

      const out = result.outputFiles?.[0]?.text ?? '';
      expect(out).toContain('createElement');
      expect(out).not.toContain('pug`');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('maps esbuild-style line/column diagnostics back to original source', () => {
    const source = [
      'const view = pug`',
      '  span= missingValue',
      '`;',
    ].join('\n');

    const transformed = transformReactPugSourceForEsbuild(source, 'fixture.tsx');
    const index = transformed.code.indexOf('missingValue');
    const prefix = transformed.code.slice(0, index);
    const line = prefix.split('\n').length;
    const column = index - prefix.lastIndexOf('\n') - 1;

    const mapped = mapEsbuildGeneratedDiagnosticToOriginal(
      transformed.code,
      transformed.metadata,
      { line, column, length: 'missingValue'.length },
    );

    expect(mapped).not.toBeNull();
    expect(mapped!.startLine).toBe(2);
    expect(source.slice(mapped!.start, mapped!.end)).toContain('missingValue');
  });

  it('emits sourcemap output via esbuild build pipeline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'esbuild-react-pug-map-'));
    const entry = join(dir, 'entry.tsx');

    try {
      await writeFile(entry, 'const view = pug`span= title`; export { view };');
      const result = await build({
        entryPoints: [entry],
        bundle: false,
        write: false,
        format: 'esm',
        jsx: 'transform',
        sourcemap: 'inline',
        plugins: [reactPugEsbuildPlugin()],
      });
      const jsFile = result.outputFiles?.find((f) => !f.path.endsWith('.map'));
      expect(jsFile).toBeTruthy();
      const match = jsFile!.text.match(/sourceMappingURL=data:application\/json(?:;charset=[^;]+)?;base64,([A-Za-z0-9+/=]+)/);
      expect(match).toBeTruthy();
      const decoded = Buffer.from(match![1], 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      expect(Array.isArray(parsed.sources)).toBe(true);
      expect(parsed.sources.join('\n')).toContain('entry.tsx');
      expect(Array.isArray(parsed.sourcesContent)).toBe(true);
      expect(parsed.sourcesContent[0]).toContain('pug`span= title`');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('maps diagnostics correctly when multiple pug regions are present', () => {
    const source = COMPILER_MULTI_REGION_SOURCE;
    const transformed = transformReactPugSourceForEsbuild(source, 'fixture.tsx');
    const index = transformed.code.indexOf('two.toUpperCase');
    const prefix = transformed.code.slice(0, index);
    const line = prefix.split('\n').length;
    const column = index - prefix.lastIndexOf('\n') - 1;

    const mapped = mapEsbuildGeneratedDiagnosticToOriginal(
      transformed.code,
      transformed.metadata,
      { line, column, length: 'two.toUpperCase'.length },
    );

    expect(mapped).not.toBeNull();
    expect(mapped!.startLine).toBe(2);
    expect(source.slice(mapped!.start, mapped!.end)).toContain('two.toUpperCase');
  });

  it('maps esbuild-style ranges back to original source', () => {
    const source = 'const view = pug`span= valueMissing`;\n';
    const transformed = transformReactPugSourceForEsbuild(source, 'fixture.tsx');
    const index = transformed.code.indexOf('valueMissing');
    const prefix = transformed.code.slice(0, index);
    const line = prefix.split('\n').length;
    const column = index - prefix.lastIndexOf('\n') - 1;

    const mapped = mapEsbuildGeneratedRangeToOriginal(
      transformed.code,
      transformed.metadata,
      { line, column, length: 'valueMissing'.length },
    );

    expect(mapped).not.toBeNull();
    expect(source.slice(mapped!.start, mapped!.end)).toContain('valueMissing');
  });

  it('maps diagnostics for shared stress fixture back to original nested interpolation', () => {
    const source = COMPILER_STRESS_SOURCE_TSX;
    const transformed = transformReactPugSourceForEsbuild(source, 'fixture.tsx');
    const index = transformed.code.indexOf('tooltipText.toUpperCase');
    const prefix = transformed.code.slice(0, index);
    const line = prefix.split('\n').length;
    const column = index - prefix.lastIndexOf('\n') - 1;

    const mapped = mapEsbuildGeneratedDiagnosticToOriginal(
      transformed.code,
      transformed.metadata,
      { line, column, length: 'tooltipText.toUpperCase'.length },
    );

    expect(mapped).not.toBeNull();
    expect(source.slice(mapped!.start, mapped!.end)).toContain('tooltipText.toUpperCase');
  });
});
