import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { Loader, OnLoadArgs, OnLoadResult, Plugin } from 'esbuild';
import {
  createTransformSourceMap,
  type ClassAttributeOption,
  type ClassMergeOption,
  lineColumnToOffset,
  mapGeneratedDiagnosticToOriginal,
  mapGeneratedRangeToOriginal,
  type StartupjsCssxjsOption,
  transformSourceFile,
  type GeneratedDiagnosticLike,
  type OffsetRange,
  type OriginalDiagnosticLocation,
  type PugDocument,
  type PugRegion,
  type TransformSourceMap,
} from '@startupjs/react-pug-core';

export interface EsbuildReactPugOptions {
  tagFunction?: string;
  include?: RegExp;
  exclude?: RegExp;
  classShorthandProperty?: ClassAttributeOption;
  classShorthandMerge?: ClassMergeOption;
  startupjsCssxjs?: StartupjsCssxjsOption;
  componentPathFromUppercaseClassShorthand?: boolean;
}

export interface EsbuildReactPugMetadata {
  document: PugDocument;
  regions: PugRegion[];
}

export interface EsbuildReactPugTransformResult {
  code: string;
  metadata: EsbuildReactPugMetadata;
  sourceMap: TransformSourceMap;
}

export interface EsbuildGeneratedDiagnosticLike {
  line: number;
  column: number; // esbuild columns are 0-based
  length?: number;
}

export interface EsbuildGeneratedRangeLike {
  line: number;
  column: number; // esbuild columns are 0-based
  length: number;
}

const DEFAULT_FILTER = /\.[cm]?[jt]sx?$/;

function inferLoader(filePath: string): Loader | null {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.ts') return 'ts';
  if (ext === '.tsx') return 'tsx';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
  if (ext === '.jsx') return 'jsx';
  return null;
}

export function transformReactPugSourceForEsbuild(
  sourceText: string,
  fileName: string,
  options: EsbuildReactPugOptions = {},
): EsbuildReactPugTransformResult {
  const transformed = transformSourceFile(sourceText, fileName, {
    tagFunction: options.tagFunction ?? 'pug',
    compileMode: 'runtime',
    classAttribute: options.classShorthandProperty ?? 'auto',
    classMerge: options.classShorthandMerge ?? 'auto',
    startupjsCssxjs: options.startupjsCssxjs ?? 'auto',
    componentPathFromUppercaseClassShorthand: options.componentPathFromUppercaseClassShorthand ?? true,
  });

  return {
    code: transformed.code,
    metadata: {
      document: transformed.document,
      regions: transformed.regions,
    },
    sourceMap: createTransformSourceMap(transformed, fileName),
  };
}

export function mapEsbuildGeneratedDiagnosticToOriginal(
  transformedCode: string,
  metadata: EsbuildReactPugMetadata,
  diagnostic: EsbuildGeneratedDiagnosticLike,
): OriginalDiagnosticLocation | null {
  const startOffset = lineColumnToOffset(transformedCode, diagnostic.line, diagnostic.column + 1);
  const generatedDiagnostic: GeneratedDiagnosticLike = {
    start: startOffset,
    length: Math.max(1, diagnostic.length ?? 1),
  };
  return mapGeneratedDiagnosticToOriginal(metadata.document, generatedDiagnostic);
}

export function mapEsbuildGeneratedRangeToOriginal(
  transformedCode: string,
  metadata: EsbuildReactPugMetadata,
  range: EsbuildGeneratedRangeLike,
): OffsetRange | null {
  const startOffset = lineColumnToOffset(transformedCode, range.line, range.column + 1);
  return mapGeneratedRangeToOriginal(metadata.document, startOffset, Math.max(1, range.length));
}

async function loadAndTransform(
  args: OnLoadArgs,
  options: EsbuildReactPugOptions,
): Promise<OnLoadResult | null> {
  if (options.exclude?.test(args.path)) return null;

  const loader = inferLoader(args.path);
  if (!loader) return null;

  const sourceText = await readFile(args.path, 'utf8');
  const transformed = transformReactPugSourceForEsbuild(sourceText, args.path, options);
  if (transformed.metadata.regions.length === 0) return null;
  const transformedLoader: Loader = loader === 'js'
    ? 'jsx'
    : loader === 'ts'
      ? 'tsx'
      : loader;
  const inlineSourceMap = Buffer.from(JSON.stringify(transformed.sourceMap), 'utf8').toString('base64');
  const contentsWithMap = `${transformed.code}\n//# sourceMappingURL=data:application/json;base64,${inlineSourceMap}`;

  return {
    contents: contentsWithMap,
    loader: transformedLoader,
  };
}

export function reactPugEsbuildPlugin(options: EsbuildReactPugOptions = {}): Plugin {
  const filter = options.include ?? DEFAULT_FILTER;

  return {
    name: 'react-pug',
    setup(build) {
      build.onLoad({ filter }, (args) => loadAndTransform(args, options));
    },
  };
}
