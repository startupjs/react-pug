import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import {
  mapEsbuildGeneratedDiagnosticToOriginal,
  reactPugEsbuildPlugin,
  transformReactPugSourceForEsbuild,
} from '../../src/index';

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

    expect(transformed.code).not.toContain('pug`');
    expect(transformed.code).toContain('<Button');
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
});
