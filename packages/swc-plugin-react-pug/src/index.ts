import {
  mapGeneratedDiagnosticToOriginal,
  mapGeneratedRangeToOriginal,
  transformSourceFile,
  type GeneratedDiagnosticLike,
  type OffsetRange,
  type OriginalDiagnosticLocation,
  type PugDocument,
  type PugRegion,
} from '@startupjs/react-pug-core';
import { transformSync, type Options as SwcOptions } from '@swc/core';

export type SwcPugCompileMode = 'runtime' | 'languageService';

export interface SwcReactPugOptions {
  tagFunction?: string;
  mode?: SwcPugCompileMode;
}

export interface SwcReactPugMetadata {
  document: PugDocument;
  regions: PugRegion[];
}

export interface SwcReactPugTransformResult {
  code: string;
  metadata: SwcReactPugMetadata;
}

export interface SwcReactPugCompileResult extends SwcReactPugTransformResult {
  swcCode: string;
  swcMap?: string;
}

export function transformReactPugSourceForSwc(
  sourceText: string,
  fileName: string,
  options: SwcReactPugOptions = {},
): SwcReactPugTransformResult {
  const transformed = transformSourceFile(sourceText, fileName, {
    tagFunction: options.tagFunction ?? 'pug',
    compileMode: options.mode ?? 'runtime',
  });

  return {
    code: transformed.code,
    metadata: {
      document: transformed.document,
      regions: transformed.regions,
    },
  };
}

export function mapSwcGeneratedDiagnosticToOriginal(
  metadata: SwcReactPugMetadata,
  diagnostic: GeneratedDiagnosticLike,
): OriginalDiagnosticLocation | null {
  return mapGeneratedDiagnosticToOriginal(metadata.document, diagnostic);
}

export function mapSwcGeneratedRangeToOriginal(
  metadata: SwcReactPugMetadata,
  generatedStart: number,
  generatedLength: number,
): OffsetRange | null {
  return mapGeneratedRangeToOriginal(metadata.document, generatedStart, generatedLength);
}

export function transformWithSwcReactPug(
  sourceText: string,
  fileName: string,
  swcOptions: SwcOptions = {},
  options: SwcReactPugOptions = {},
): SwcReactPugCompileResult {
  const transformed = transformReactPugSourceForSwc(sourceText, fileName, options);
  const swcResult = transformSync(transformed.code, {
    filename: fileName,
    sourceMaps: swcOptions.sourceMaps,
    ...swcOptions,
  });

  return {
    ...transformed,
    swcCode: swcResult.code,
    swcMap: swcResult.map,
  };
}
