import type { Mapping } from '@volar/source-map';

// ── CodeInformation ─────────────────────────────────────────────

/** Controls which IntelliSense features are enabled for a mapped span */
export interface CodeInformation {
  /** Enable auto-completion suggestions */
  completion: boolean;
  /** Enable go-to-definition, find-references, rename */
  navigation: boolean;
  /** Enable type-checking diagnostics */
  verification: boolean;
  /** Enable semantic highlighting and hover info */
  semantic: boolean;
}

/** Expressions, tag names, attribute names/values -- full IntelliSense */
export const FULL_FEATURES: CodeInformation = {
  completion: true,
  navigation: true,
  verification: true,
  semantic: true,
};

/** Class/ID shorthands -- CSS names, not TS identifiers */
export const CSS_CLASS: CodeInformation = {
  completion: false,
  navigation: false,
  verification: false,
  semantic: false,
};

/** Structural syntax (JSX brackets, keywords) -- no features */
export const SYNTHETIC: CodeInformation = {
  completion: false,
  navigation: false,
  verification: false,
  semantic: false,
};

/** Expressions that should show diagnostics but not completions */
export const VERIFY_ONLY: CodeInformation = {
  completion: false,
  navigation: true,
  verification: true,
  semantic: true,
};

// ── CodeMapping ─────────────────────────────────────────────────

/** Volar-compatible source mapping with CodeInformation feature flags */
export type CodeMapping = Mapping<CodeInformation>;

// ── PugParseError ───────────────────────────────────────────────

export interface PugParseError {
  /** Error message from pug-lexer or pug-parser */
  message: string;
  /** Line number (1-based) within the pug region text */
  line: number;
  /** Column number (1-based) within the pug region text */
  column: number;
  /** Byte offset within the pug region text */
  offset: number;
}

export type StyleTagLang = 'css' | 'styl' | 'sass' | 'scss';
export type PugTransformErrorCode =
  | 'style-tag-must-be-last'
  | 'unsupported-style-lang'
  | 'invalid-style-attrs'
  | 'missing-pug-import-for-style';

export interface PugTransformError {
  /** Stable machine-readable error code */
  code: PugTransformErrorCode;
  /** Error message from react-pug transform validation */
  message: string;
  /** Line number (1-based) within the pug region text */
  line: number;
  /** Column number (1-based) within the pug region text */
  column: number;
  /** Byte offset within the pug region text */
  offset: number;
}

export interface ExtractedStyleBlock {
  /** Helper function to call at the destination scope */
  lang: StyleTagLang;
  /** Style content with common body indentation removed */
  content: string;
  /** Offset of the style tag line within the pug region text */
  tagOffset: number;
  /** Offset of the style body start within the pug region text */
  contentStart: number;
  /** Offset of the style body end within the pug region text */
  contentEnd: number;
  /** Number of characters stripped from each non-empty style body line */
  commonIndent: number;
  /** Line number (1-based) of the style tag within the pug region text */
  line: number;
  /** Column number (1-based) of the style tag within the pug region text */
  column: number;
}

// ── PugToken ────────────────────────────────────────────────────

/** Minimal pug lexer token shape (retained for sub-expression position resolution) */
export interface PugToken {
  type: string;
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  val?: string;
}

export interface TagImportCleanup {
  /** Offset of the full import declaration in the original file */
  originalStart: number;
  originalEnd: number;
  /** Fixed-length replacement text for the shadow/transformed output */
  replacementText: string;
}

export interface MissingTagImportDiagnostic {
  /** Human-readable message for the missing import condition */
  message: string;
  /** Original-file offset where the missing import should be reported */
  start: number;
  /** Diagnostic length in original-file coordinates */
  length: number;
}

export interface ShadowCopySegment {
  /** Original-file slice copied through unchanged */
  originalStart: number;
  originalEnd: number;
  /** Corresponding shadow-file slice */
  shadowStart: number;
  shadowEnd: number;
}

export interface ShadowMappedRegion {
  /** Generated region kind */
  kind: 'pug' | 'style';
  /** Region index whose stripped pug text is used as the mapping source space */
  regionIndex: number;
  /** Source span in stripped pug-text coordinates */
  sourceStart: number;
  sourceEnd: number;
  /** Corresponding shadow-file generated span */
  shadowStart: number;
  shadowEnd: number;
  /** Volar-compatible source mappings for this generated span */
  mappings: CodeMapping[];
}

export interface ShadowInsertion {
  /** Inserted shadow text that has no direct original slice */
  kind: 'style-import' | 'style-call' | 'arrow-body-prefix' | 'arrow-body-suffix';
  /** Original-file offset where the insertion occurs */
  originalOffset: number;
  /** Generated shadow span occupied by the insertion */
  shadowStart: number;
  shadowEnd: number;
}

// ── PugRegion ───────────────────────────────────────────────────

export interface PugRegion {
  /** Offset of the entire tagged template expression (pug`...`) in the original file */
  originalStart: number;
  originalEnd: number;

  /** Offset of just the template content (inside backticks) */
  pugTextStart: number;
  pugTextEnd: number;

  /** Extracted pug source text (with common indent stripped for the pug parser) */
  pugText: string;

  /** Number of characters stripped from each line as common indent (0 if none) */
  commonIndent: number;

  /** Offset of the generated TSX expression in the shadow file */
  shadowStart: number;
  shadowEnd: number;

  /** Generated TSX expression text */
  tsxText: string;

  /** Source mappings for this region (Volar-compatible format) */
  mappings: CodeMapping[];

  /** Retained lexer tokens for sub-expression position resolution */
  lexerTokens: PugToken[];

  /** Pug parse error, if any (null = parsed successfully) */
  parseError: PugParseError | null;

  /** Transform validation error, if any */
  transformError: PugTransformError | null;

  /** Extracted terminal style block, if present */
  styleBlock: ExtractedStyleBlock | null;
}

// ── PugDocument ─────────────────────────────────────────────────

export interface PugDocument {
  /** Original file text as the user sees it */
  originalText: string;

  /** File URI / path */
  uri: string;

  /** Detected pug`` template literal regions */
  regions: PugRegion[];

  /** Fixed-length import cleanup edits applied outside pug regions */
  importCleanups: TagImportCleanup[];

  /** Original-text slices copied through unchanged */
  copySegments: ShadowCopySegment[];

  /** Generated shadow spans with custom source mappings */
  mappedRegions: ShadowMappedRegion[];

  /** Synthetic insertions applied outside copied source text */
  insertions: ShadowInsertion[];

  /** Shadow TSX text (original with pug regions replaced by generated TSX) */
  shadowText: string;

  /** Version counter, bumped on every edit */
  version: number;

  /** Cumulative offset deltas for mapping positions outside pug regions */
  regionDeltas: number[];

  /** Whether the configured tag function is used in this file */
  usesTagFunction: boolean;

  /** Whether the configured tag function is explicitly imported in this file */
  hasTagImport: boolean;

  /** Optional missing-import diagnostic metadata */
  missingTagImport: MissingTagImportDiagnostic | null;
}
