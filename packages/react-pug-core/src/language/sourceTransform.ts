import type { PugDocument, PugRegion } from './mapping';
import { buildShadowDocument } from './shadowDocument';
import { originalToShadow, shadowToOriginal } from './positionMapping';

export interface SourceTransformOptions {
  /**
   * Tagged template function name to match.
   * Defaults to `pug`.
   */
  tagFunction?: string;
}

export interface SourceTransformResult {
  /**
   * Transformed source text where matched pug tagged templates are replaced by compiled output.
   */
  code: string;

  /**
   * Full transform document with all region metadata.
   */
  document: PugDocument;

  /**
   * Convenience alias for `document.regions`.
   */
  regions: PugRegion[];

  /**
   * Map offset in transformed code back to offset in original source.
   * Returns null when the offset points to a synthetic unmapped span.
   */
  mapGeneratedOffsetToOriginal: (offset: number) => number | null;

  /**
   * Map offset in original source to transformed code offset.
   * Returns null when the offset points to an unmapped span.
   */
  mapOriginalOffsetToGenerated: (offset: number) => number | null;
}

export function transformSourceFile(
  sourceText: string,
  fileName: string,
  options: SourceTransformOptions = {},
): SourceTransformResult {
  const tagFunction = options.tagFunction ?? 'pug';
  const document = buildShadowDocument(sourceText, fileName, 1, tagFunction);

  return {
    code: document.shadowText,
    document,
    regions: document.regions,
    mapGeneratedOffsetToOriginal: (offset: number) => shadowToOriginal(document, offset),
    mapOriginalOffsetToGenerated: (offset: number) => originalToShadow(document, offset),
  };
}
