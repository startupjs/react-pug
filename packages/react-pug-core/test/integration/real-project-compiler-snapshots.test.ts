import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { transformSync as babelTransformSync } from '@babel/core';
import { ESLint } from 'eslint';
import neostandard from 'neostandard';
import { TraceMap, eachMapping, originalPositionFor } from '@jridgewell/trace-mapping';
import { build as esbuildBuild } from 'esbuild';
import babelPluginReactPug from '../../../babel-plugin-react-pug/src/index';
import { transformReactPugSourceForSwc } from '../../../swc-plugin-react-pug/src/index';
import reactPugEslintPlugin, { createReactPugProcessor } from '../../../eslint-plugin-react-pug/src/index';
import { reactPugEsbuildPlugin } from '../../../esbuild-plugin-react-pug/src/index';
import { buildShadowDocument, createTransformSourceMap, transformSourceFile } from '../../src/index';
import { lineColumnToOffset } from '../../src/language/diagnosticMapping';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(THIS_FILE), '../../../..');
const FIXTURES_DIR = join(REPO_ROOT, 'test/fixtures/real-project');
const REGRESSION_FIXTURES_DIR = join(REPO_ROOT, 'test/fixtures/regression');
const SNAPSHOTS_DIR = join(FIXTURES_DIR, 'snapshots');

const FIXTURES = [
  'event-tabs-layout.js',
  'event-tabs-breed.js',
  'cat-profile-link.js',
  'CatCard.js',
  'event-tabs-layout.tsx',
  'event-tabs-breed.tsx',
  'cat-profile-link.tsx',
  'CatCard.tsx',
];

function isTypeScriptLikeFixture(fileName: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(fileName);
}

function parserPluginsForFixture(fileName: string): string[] {
  return isTypeScriptLikeFixture(fileName) ? ['jsx', 'typescript'] : ['jsx'];
}

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

function regressionFixturePath(fileName: string): string {
  return join(REGRESSION_FIXTURES_DIR, fileName);
}

function readRegressionFixture(fileName: string): string {
  return readFileSync(regressionFixturePath(fileName), 'utf8');
}

function createNeostandardEslint(): ESLint {
  return new ESLint({
    cwd: REPO_ROOT,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      ...neostandard({
        ts: true,
      }),
      {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        languageOptions: {
          parserOptions: {
            ecmaFeatures: { jsx: true },
            sourceType: 'module',
          },
        },
      },
      {
        plugins: {
          'react-pug': reactPugEslintPlugin as any,
        },
        processor: 'react-pug/pug-react',
      },
    ] as any,
  });
}

function formatEslintResults(results: Awaited<ReturnType<ESLint['lintText']>>): string {
  const lines: string[] = [];
  let totalErrors = 0;
  let fileCount = 0;

  for (const result of results) {
    if (result.messages.length === 0) continue;
    fileCount += 1;
    lines.push(result.filePath.replaceAll('\\', '/'));
    for (const message of result.messages) {
      totalErrors += message.severity === 2 ? 1 : 0;
      const severity = message.severity === 2 ? 'error' : 'warning';
      const location = `${message.line ?? 0}:${message.column ?? 0}`;
      const rule = message.ruleId ?? '(no-rule)';
      lines.push(`  ${location}  ${severity}  ${message.message}  ${rule}`);
    }
    lines.push('');
  }

  if (lines.length === 0) return 'Found 0 errors.';

  lines.push(`Found ${totalErrors} errors in ${fileCount} files.`);
  return lines.join('\n');
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

function isGeneratedOffsetInsideMappedPugSpan(
  transformed: ReturnType<typeof transformSourceFile>,
  generatedOffset: number,
): boolean {
  return transformed.document.mappedRegions.some(
    region => generatedOffset >= region.shadowStart && generatedOffset < region.shadowEnd,
  );
}

function assertEncodedPugMappingsMatch(
  generatedCode: string,
  sourceMap: any,
  expectedOriginalOffsetForMapping: (mapping: { generatedLine: number; generatedColumn: number; originalLine: number; originalColumn: number }) => number | null,
  referenceMap: any = sourceMap,
): void {
  const traceMap = new TraceMap(sourceMap);
  const referenceTraceMap = new TraceMap(referenceMap);
  const sourceTexts = new Map<string, string>();

  for (let i = 0; i < (sourceMap.sources?.length ?? 0); i += 1) {
    const sourceName = sourceMap.sources[i];
    const sourceText = sourceMap.sourcesContent?.[i];
    if (typeof sourceName === 'string' && typeof sourceText === 'string') {
      sourceTexts.set(sourceName, sourceText);
    }
  }
  let validatedMappingCount = 0;

  eachMapping(referenceTraceMap, (mapping) => {
    if (mapping.generatedLine == null || mapping.generatedColumn == null) return;
    if (mapping.originalLine == null || mapping.originalColumn == null) return;

    const generatedOffset = lineColumnToOffset(generatedCode, mapping.generatedLine, mapping.generatedColumn + 1);
    const expectedOriginalOffset = expectedOriginalOffsetForMapping({
      generatedLine: mapping.generatedLine,
      generatedColumn: mapping.generatedColumn,
      originalLine: mapping.originalLine,
      originalColumn: mapping.originalColumn,
    });
    if (expectedOriginalOffset == null) return;

    const original = originalPositionFor(traceMap, {
      line: mapping.generatedLine,
      column: mapping.generatedColumn,
    });

    if (original.source == null || original.line == null || original.column == null) {
      throw new Error(`Missing original position for generated offset ${generatedOffset}`);
    }

    const sourceText = sourceTexts.get(original.source);
    if (sourceText == null) {
      throw new Error(`Missing source text for ${original.source}`);
    }

    const actualOriginalOffset = lineColumnToOffset(sourceText, original.line, original.column + 1);
    expect(actualOriginalOffset).toBe(expectedOriginalOffset);
    validatedMappingCount += 1;
  });

  expect(validatedMappingCount).toBeGreaterThan(0);
}

function countMappingsInsidePugRegions(
  sourceMap: any,
  sourceText: string,
  transformed: ReturnType<typeof transformSourceFile>,
): number {
  let count = 0;
  eachMapping(new TraceMap(sourceMap), (mapping) => {
    if (mapping.originalLine == null || mapping.originalColumn == null) return;
    const originalOffset = lineColumnToOffset(sourceText, mapping.originalLine, mapping.originalColumn + 1);
    const inPugRegion = transformed.regions.some(
      region => originalOffset >= region.pugTextStart && originalOffset < region.pugTextEnd,
    );
    if (inPugRegion) count += 1;
  });
  return count;
}

describe('real project fixtures compiler snapshots', () => {
  it('matches output snapshots for Babel, SWC, esbuild, ESLint preprocess, and shadow TSX', async () => {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    const eslintForNeostandard = createNeostandardEslint();

    for (const fileName of FIXTURES) {
      const source = readFixture(fileName);
      const relativeFixture = relative(REPO_ROOT, fixturePath(fileName)).replaceAll('\\', '/');
      const runtimeTransform = transformSourceFile(source, relativeFixture, { compileMode: 'runtime' });

      const babelResult = babelTransformSync(source, {
        filename: relativeFixture,
        sourceFileName: relativeFixture,
        configFile: false,
        babelrc: false,
        sourceMaps: true,
        parserOpts: {
          sourceType: 'module',
          plugins: parserPluginsForFixture(fileName),
        },
        generatorOpts: {
          compact: false,
          comments: false,
        },
        plugins: [[babelPluginReactPug, { mode: 'runtime', sourceMaps: 'detailed' }]],
      });
      expect(babelResult?.code).toBeTruthy();
      await expect(babelResult?.code ?? '').toMatchFileSnapshot(snapshotPath('babel', fileName, 'output.jsx'));
      await expect(JSON.stringify(normalizeMapSources(babelResult?.map), null, 2))
        .toMatchFileSnapshot(snapshotPath('babel', fileName, 'output.sourcemap.json'));
      expect(countMappingsInsidePugRegions(babelResult?.map, source, runtimeTransform)).toBeGreaterThan(0);

      const babelBasicResult = babelTransformSync(source, {
        filename: relativeFixture,
        sourceFileName: relativeFixture,
        configFile: false,
        babelrc: false,
        sourceMaps: true,
        parserOpts: {
          sourceType: 'module',
          plugins: parserPluginsForFixture(fileName),
        },
        generatorOpts: {
          compact: false,
          comments: false,
        },
        plugins: [[babelPluginReactPug, { mode: 'runtime', sourceMaps: 'basic' }]],
      });
      expect(babelBasicResult?.code).toBeTruthy();
      await expect(babelBasicResult?.code ?? '').toMatchFileSnapshot(snapshotPath('babel-basic', fileName, 'output.jsx'));
      await expect(JSON.stringify(normalizeMapSources(babelBasicResult?.map), null, 2))
        .toMatchFileSnapshot(snapshotPath('babel-basic', fileName, 'output.sourcemap.json'));

      const swcPreTransform = transformReactPugSourceForSwc(source, relativeFixture);
      expect(swcPreTransform.code).toBe(runtimeTransform.code);
      await expect(swcPreTransform.code).toMatchFileSnapshot(snapshotPath('swc', fileName, 'output.jsx'));
      const swcMap = createTransformSourceMap(runtimeTransform, relativeFixture);
      await expect(JSON.stringify(normalizeMapSources(swcMap), null, 2))
        .toMatchFileSnapshot(snapshotPath('swc', fileName, 'output.sourcemap.json'));
      assertEncodedPugMappingsMatch(
        swcPreTransform.code,
        swcMap,
        mapping => {
          const generatedOffset = lineColumnToOffset(swcPreTransform.code, mapping.generatedLine, mapping.generatedColumn + 1);
          return (
          isGeneratedOffsetInsideMappedPugSpan(runtimeTransform, generatedOffset)
            ? runtimeTransform.mapGeneratedOffsetToOriginal(generatedOffset)
            : null
          );
        },
      );

      const transformedByEsbuildPlugin = await esbuildBuild({
        absWorkingDir: REPO_ROOT,
        entryPoints: [relativeFixture],
        write: false,
        bundle: false,
        format: 'esm',
        jsx: 'preserve',
        loader: {
          '.js': 'jsx',
          '.ts': 'ts',
          '.tsx': 'tsx',
        },
        target: 'esnext',
        sourcemap: 'external',
        outfile: `.tmp/esbuild-snapshot/${fileName}`,
        plugins: [reactPugEsbuildPlugin()],
      });

      const esbuildCodeFile = transformedByEsbuildPlugin.outputFiles?.find((f) => !f.path.endsWith('.map'));
      const esbuildMapFile = transformedByEsbuildPlugin.outputFiles?.find((f) => f.path.endsWith('.map'));
      const esbuildJs = esbuildCodeFile?.text ?? '';
      const esbuildMapRaw = esbuildMapFile?.text ?? 'null';
      const esbuildMap = JSON.parse(esbuildMapRaw);
      await expect(esbuildJs).toMatchFileSnapshot(snapshotPath('esbuild', fileName, 'output.jsx'));
      await expect(JSON.stringify(normalizeMapSources(esbuildMap), null, 2))
        .toMatchFileSnapshot(snapshotPath('esbuild', fileName, 'output.sourcemap.json'));
      expect(countMappingsInsidePugRegions(esbuildMap, source, runtimeTransform)).toBeGreaterThan(0);

      const eslintProcessor = createReactPugProcessor();
      const [eslintOutput] = eslintProcessor.preprocess(source, relativeFixture);
      const eslintOutputText = typeof eslintOutput === 'string' ? eslintOutput : eslintOutput.text;
      await expect(eslintOutputText).toMatchFileSnapshot(snapshotPath('eslint', fileName, 'output.jsx'));

      const eslintNeostandardResults = await eslintForNeostandard.lintText(source, {
        filePath: fixturePath(fileName),
      });
      await expect(formatEslintResults(eslintNeostandardResults))
        .toMatchFileSnapshot(snapshotPath('eslint-neostandard', fileName, 'diagnostics.txt'));

      const shadowDoc = buildShadowDocument(source, relativeFixture, 1, 'pug');
      await expect(shadowDoc.shadowText).toMatchFileSnapshot(snapshotPath('shadow', fileName, 'output.tsx'));

      const shadowTransform = transformSourceFile(source, relativeFixture, {
        compileMode: 'languageService',
      });
      expect(shadowTransform.code).toBe(shadowDoc.shadowText);
      const shadowMap = createTransformSourceMap(shadowTransform, relativeFixture);
      await expect(JSON.stringify(normalizeMapSources(shadowMap), null, 2))
        .toMatchFileSnapshot(snapshotPath('shadow', fileName, 'output.sourcemap.json'));
      assertEncodedPugMappingsMatch(
        shadowTransform.code,
        shadowMap,
        mapping => {
          const generatedOffset = lineColumnToOffset(shadowTransform.code, mapping.generatedLine, mapping.generatedColumn + 1);
          return (
          isGeneratedOffsetInsideMappedPugSpan(shadowTransform, generatedOffset)
            ? shadowTransform.mapGeneratedOffsetToOriginal(generatedOffset)
            : null
          );
        },
      );
    }
  });

  it('keeps JSX imports marked as used in plain .js files under the neostandard processor config', async () => {
    const eslintForNeostandard = createNeostandardEslint();
    const fileName = 'domestic.js';
    const source = readRegressionFixture(fileName);
    const results = await eslintForNeostandard.lintText(source, {
      filePath: regressionFixturePath(fileName),
    });

    expect(formatEslintResults(results)).toMatchInlineSnapshot(`"Found 0 errors."`);
  });
});
