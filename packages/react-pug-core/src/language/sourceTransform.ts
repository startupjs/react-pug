import type { PugDocument, PugRegion } from './mapping';
import { buildShadowDocument } from './shadowDocument';
import { originalToShadow, shadowToOriginal } from './positionMapping';
import type { ClassAttributeName, ClassMergeMode, CompileMode } from './pugToTsx';

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
