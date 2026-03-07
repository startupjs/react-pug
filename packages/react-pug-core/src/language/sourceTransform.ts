import type { PugDocument, PugRegion } from './mapping';
import { buildShadowDocument } from './shadowDocument';
import { originalToShadow, shadowToOriginal } from './positionMapping';
import type { ClassAttributeName, ClassMergeMode, CompileMode } from './pugToTsx';
import { offsetToLineColumn } from './diagnosticMapping';
import {
  addSegment,
  GenMapping,
  setSourceContent,
  toEncodedMap,
  type EncodedSourceMap,
} from '@jridgewell/gen-mapping';

const STARTUPJS_OR_CSSXJS_RE = /['"](?:startupjs|cssxjs)['"]/;

export type ClassAttributeOption = 'auto' | ClassAttributeName;
export type ClassMergeOption = 'auto' | ClassMergeMode;
export type StartupjsCssxjsOption = boolean | 'auto';

export interface SourceTransformOptions {
  /**
   * Tagged template function name to match.
   * Defaults to `pug`.
   */
  tagFunction?: string;

  /**
   * Output mode used by pug compiler.
   * - `languageService`: TS-oriented output for editor/type-service usage.
   * - `runtime`: JS/JSX-safe output for build tools.
   */
  compileMode?: CompileMode;

  /**
   * Which attribute receives shorthand classes.
   * - `auto`: defaults to `className`, but may switch to `styleName` when startupjs/cssxjs is detected.
   */
  classAttribute?: ClassAttributeOption;

  /**
   * How shorthand classes merge with an existing explicit attribute value.
   * - `concatenate`: string concatenation
   * - `classnames`: classnames-compatible array composition
   * - `auto`: `classnames` when target attr is `styleName`, otherwise `concatenate`
   */
  classMerge?: ClassMergeOption;

  /**
   * startupjs/cssxjs detection mode used by `auto` class strategy.
   */
  startupjsCssxjs?: StartupjsCssxjsOption;

  /**
   * When true, uppercase dot segments after a component name are treated as component path
   * segments instead of shorthand classes.
   *
   * Example:
   * - `Modal.Header.active` -> component `Modal.Header` + class `.active`
   * - `Modal.icons.Header` -> component `Modal` + classes `.icons.Header`
   *
   * Defaults to true.
   */
  componentPathFromUppercaseClassShorthand?: boolean;
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

export type TransformSourceMap = EncodedSourceMap;

export function transformSourceFile(
  sourceText: string,
  fileName: string,
  options: SourceTransformOptions = {},
): SourceTransformResult {
  const tagFunction = options.tagFunction ?? 'pug';
  const startupjsCssxjs = options.startupjsCssxjs === true
    || (options.startupjsCssxjs !== false && STARTUPJS_OR_CSSXJS_RE.test(sourceText));
  const classAttribute: ClassAttributeName = (
    options.classAttribute === 'className'
    || options.classAttribute === 'class'
    || options.classAttribute === 'styleName'
  ) ? options.classAttribute : (startupjsCssxjs ? 'styleName' : 'className');
  const classMerge: ClassMergeMode = (
    options.classMerge === 'concatenate'
    || options.classMerge === 'classnames'
  ) ? options.classMerge : (classAttribute === 'styleName' ? 'classnames' : 'concatenate');

  const document = buildShadowDocument(
    sourceText,
    fileName,
    1,
    tagFunction,
    {
      mode: options.compileMode ?? 'languageService',
      classAttribute,
      classMerge,
      componentPathFromUppercaseClassShorthand: options.componentPathFromUppercaseClassShorthand ?? true,
    },
  );

  return {
    code: document.shadowText,
    document,
    regions: document.regions,
    mapGeneratedOffsetToOriginal: (offset: number) => shadowToOriginal(document, offset),
    mapOriginalOffsetToGenerated: (offset: number) => originalToShadow(document, offset),
  };
}

/**
 * Build a standard VLQ source map from transformed code back to original source.
 * This is intended to be used as an input source map for downstream compilers.
 */
export function createTransformSourceMap(
  transformed: Pick<SourceTransformResult, 'code' | 'document' | 'mapGeneratedOffsetToOriginal'>,
  fileName: string = transformed.document.uri,
): TransformSourceMap {
  const sourceName = fileName;
  const map = new GenMapping({ file: fileName });
  setSourceContent(map, sourceName, transformed.document.originalText);

  let generatedLine = 0;
  let generatedColumn = 0;
  let lastMappedOriginalOffset: number | null = null;

  for (let i = 0; i < transformed.code.length; i += 1) {
    const mappedOriginalOffset = transformed.mapGeneratedOffsetToOriginal(i);
    if (mappedOriginalOffset != null) {
      const shouldEmitSegment = (
        generatedColumn === 0
        || lastMappedOriginalOffset == null
        || mappedOriginalOffset !== lastMappedOriginalOffset + 1
      );

      if (shouldEmitSegment) {
        const original = offsetToLineColumn(transformed.document.originalText, mappedOriginalOffset);
        addSegment(
          map,
          generatedLine,
          generatedColumn,
          sourceName,
          Math.max(0, original.line - 1),
          Math.max(0, original.column - 1),
        );
      }
      lastMappedOriginalOffset = mappedOriginalOffset;
    } else {
      lastMappedOriginalOffset = null;
    }

    if (transformed.code.charCodeAt(i) === 10) {
      generatedLine += 1;
      generatedColumn = 0;
      lastMappedOriginalOffset = null;
    } else {
      generatedColumn += 1;
    }
  }

  return toEncodedMap(map);
}
