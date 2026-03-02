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

// ── PugRegion ───────────────────────────────────────────────────

export interface PugRegion {
  /** Offset of the entire tagged template expression (pug`...`) in the original file */
  originalStart: number;
  originalEnd: number;

  /** Offset of just the template content (inside backticks) */
  pugTextStart: number;
  pugTextEnd: number;

  /** Extracted pug source text (with common indent stripped) */
  pugText: string;

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
}

// ── PugDocument ─────────────────────────────────────────────────

export interface PugDocument {
  /** Original file text as the user sees it */
  originalText: string;

  /** File URI / path */
  uri: string;

  /** Detected pug`` template literal regions */
  regions: PugRegion[];

  /** Shadow TSX text (original with pug regions replaced by generated TSX) */
  shadowText: string;

  /** Version counter, bumped on every edit */
  version: number;

  /** Cumulative offset deltas for mapping positions outside pug regions */
  regionDeltas: number[];
}
