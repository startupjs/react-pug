import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { transformSync as babelTransformSync } from '@babel/core';
import { build as esbuildBuild } from 'esbuild';
import babelPluginReactPug from '../../../babel-plugin-react-pug/src/index';
import { transformReactPugSourceForSwc } from '../../../swc-plugin-react-pug/src/index';
import { createReactPugProcessor } from '../../../eslint-plugin-react-pug/src/index';
import { reactPugEsbuildPlugin } from '../../../esbuild-plugin-react-pug/src/index';
import { buildShadowDocument, createTransformSourceMap, transformSourceFile } from '../../src/index';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(THIS_FILE), '../../../..');
const FIXTURES_DIR = join(REPO_ROOT, 'test/fixtures/real-project');
const SNAPSHOTS_DIR = join(FIXTURES_DIR, 'snapshots');

const FIXTURES = [
  'event-tabs-layout.js',
  'event-tabs-breed.js',
  'cat-profile-link.js',
  'CatCard.js',
];

function fixturePath(fileName: string): string {
  return join(FIXTURES_DIR, fileName);
}

function snapshotPath(compiler: string, fileName: string, suffix: string): string {
  const compilerDir = join(SNAPSHOTS_DIR, compiler);
  mkdirSync(compilerDir, { recursive: true });
  return join(compilerDir, `${fileName}.${suffix}`);
}

function readFixture(fileName: string): string {
  return readFileSync(fixturePath(fileName), 'utf8');
}

function normalizeMapSources(map: any): any {
  if (!map || !Array.isArray(map.sources)) return map;
  return {
    ...map,
    sources: map.sources.map((source: string) => (
      source.startsWith(REPO_ROOT)
        ? relative(REPO_ROOT, source).replaceAll('\\', '/')
        : source
    )),
  };
}

describe('real project fixtures compiler snapshots', () => {
  it('matches output snapshots for Babel, SWC, esbuild, ESLint preprocess, and shadow TSX', async () => {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });

    for (const fileName of FIXTURES) {
      const source = readFixture(fileName);
      const relativeFixture = relative(REPO_ROOT, fixturePath(fileName)).replaceAll('\\', '/');

      const babelResult = babelTransformSync(source, {
        filename: relativeFixture,
        sourceFileName: relativeFixture,
        configFile: false,
        babelrc: false,
        sourceMaps: true,
        parserOpts: {
          sourceType: 'module',
          plugins: ['jsx'],
        },
        generatorOpts: {
          compact: false,
          comments: false,
        },
        plugins: [[babelPluginReactPug, { mode: 'runtime' }]],
      });
      expect(babelResult?.code).toBeTruthy();
      await expect(babelResult?.code ?? '').toMatchFileSnapshot(snapshotPath('babel', fileName, 'output.jsx'));
      await expect(JSON.stringify(normalizeMapSources(babelResult?.map), null, 2))
        .toMatchFileSnapshot(snapshotPath('babel', fileName, 'output.sourcemap.json'));

      const swcPreTransform = transformReactPugSourceForSwc(source, relativeFixture);
      const swcCoreTransform = transformSourceFile(source, relativeFixture, { compileMode: 'runtime' });
      expect(swcPreTransform.code).toBe(swcCoreTransform.code);
      await expect(swcPreTransform.code).toMatchFileSnapshot(snapshotPath('swc', fileName, 'output.jsx'));
      const swcMap = createTransformSourceMap(swcCoreTransform, relativeFixture);
      await expect(JSON.stringify(normalizeMapSources(swcMap), null, 2))
        .toMatchFileSnapshot(snapshotPath('swc', fileName, 'output.sourcemap.json'));

      const transformedByEsbuildPlugin = await esbuildBuild({
        absWorkingDir: REPO_ROOT,
        entryPoints: [relativeFixture],
        write: false,
        bundle: false,
        format: 'esm',
        jsx: 'preserve',
        loader: {
          '.js': 'jsx',
        },
        target: 'esnext',
        sourcemap: 'external',
        outfile: `.tmp/esbuild-snapshot/${fileName}`,
        plugins: [reactPugEsbuildPlugin()],
      });

      const esbuildJs = transformedByEsbuildPlugin.outputFiles?.find((f) => f.path.endsWith('.js'))?.text ?? '';
      const esbuildMapRaw = transformedByEsbuildPlugin.outputFiles?.find((f) => f.path.endsWith('.js.map'))?.text ?? 'null';
      const esbuildMap = JSON.parse(esbuildMapRaw);
      await expect(esbuildJs).toMatchFileSnapshot(snapshotPath('esbuild', fileName, 'output.jsx'));
      await expect(JSON.stringify(normalizeMapSources(esbuildMap), null, 2))
        .toMatchFileSnapshot(snapshotPath('esbuild', fileName, 'output.sourcemap.json'));

      const eslintProcessor = createReactPugProcessor();
      const [eslintOutput] = eslintProcessor.preprocess(source, relativeFixture);
      await expect(eslintOutput).toMatchFileSnapshot(snapshotPath('eslint', fileName, 'output.jsx'));

      const shadowDoc = buildShadowDocument(source, relativeFixture, 1, 'pug');
      await expect(shadowDoc.shadowText).toMatchFileSnapshot(snapshotPath('shadow', fileName, 'output.tsx'));

      const shadowTransform = transformSourceFile(source, relativeFixture, {
        compileMode: 'languageService',
      });
      expect(shadowTransform.code).toBe(shadowDoc.shadowText);
      const shadowMap = createTransformSourceMap(shadowTransform, relativeFixture);
      await expect(JSON.stringify(normalizeMapSources(shadowMap), null, 2))
        .toMatchFileSnapshot(snapshotPath('shadow', fileName, 'output.sourcemap.json'));
    }
  });
});
