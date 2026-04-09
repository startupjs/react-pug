import {
  buildExpressionBoundaryMap,
  type ClassAttributeOption,
  type ClassMergeOption,
  collectMappedInsertionRangesByKind,
  createFormattingWrapper,
  createLintTransform,
  extractFormattedExpressionFromWrapper,
  hasTagFunctionCall,
  type InsertionOffsetRange,
  lineColumnToOffset,
  mapGeneratedRangeToOriginal,
  offsetToLineColumn,
  rewriteSegmentedPugRegions,
  type BoundaryMappedExpression,
  type RewrittenPugRegionsResult,
  type RegionFormattingContext,
  type StartupjsCssxjsOption,
} from '@react-pug/react-pug-core';
import { parse } from '@babel/parser';
import { Linter, SourceCode } from 'eslint';
import stylisticPlugin from '@stylistic/eslint-plugin';
import prettier from '@prettier/sync';
const tsParser = require('@typescript-eslint/parser');

interface EslintReactPugProcessorOptions {
  tagFunction?: string;
  requirePugImport?: boolean;
  classShorthandProperty?: ClassAttributeOption;
  classShorthandMerge?: ClassMergeOption;
  startupjsCssxjs?: StartupjsCssxjsOption;
  componentPathFromUppercaseClassShorthand?: boolean;
  jsxInJsFiles?: 'auto' | 'always';
}

interface EslintLintMessage {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  fix?: {
    range: [number, number];
    text: string;
  };
  suggestions?: Array<{
    desc?: string;
    messageId?: string;
    fix?: {
      range: [number, number];
      text: string;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

type LintTransformState = ReturnType<typeof createLintTransform>;

interface CachedLintState {
  originalText: string;
  transformed: LintTransformState | null;
  formatted: RewrittenPugRegionsResult | null;
  legacyStyleStatementRanges: InsertionOffsetRange[];
  syntheticStyleCallRanges: InsertionOffsetRange[];
}

interface EslintProcessorLike {
  preprocess: (
    text: string,
    filename: string,
  ) => Array<string | { text: string; filename: string }>;
  postprocess: (messages: EslintLintMessage[][], filename: string) => EslintLintMessage[];
  supportsAutofix: boolean;
}

const FLAT_LINT_FILES = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
const LEGACY_STYLE_HELPERS = new Set(['styl', 'css', 'sass', 'scss']);
const LEGACY_STYLE_SUPPRESSED_RULES = new Set(['no-unused-expressions', 'no-unreachable']);
const FORMAT_RULE_CONFIG: any = {
  languageOptions: {
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const,
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
  plugins: {
    '@stylistic': stylisticPlugin,
  },
  rules: {
    '@stylistic/indent': ['error', 2, {
      SwitchCase: 1,
      VariableDeclarator: 1,
      outerIIFEBody: 1,
      MemberExpression: 1,
      FunctionDeclaration: {
        parameters: 1,
        body: 1,
      },
      FunctionExpression: {
        parameters: 1,
        body: 1,
      },
      CallExpression: {
        arguments: 1,
      },
      ArrayExpression: 1,
      ObjectExpression: 1,
      ImportDeclaration: 1,
      flatTernaryExpressions: false,
      ignoreComments: false,
      ignoredNodes: [
        'TemplateLiteral *',
        'JSXElement',
        'JSXElement > *',
        'JSXAttribute',
        'JSXIdentifier',
        'JSXNamespacedName',
        'JSXMemberExpression',
        'JSXSpreadAttribute',
        'JSXExpressionContainer',
        'JSXOpeningElement',
        'JSXClosingElement',
        'JSXFragment',
        'JSXOpeningFragment',
        'JSXClosingFragment',
        'JSXText',
        'JSXEmptyExpression',
        'JSXSpreadChild',
      ],
      offsetTernaryExpressions: true,
    }],
    '@stylistic/jsx-indent': ['error', 2],
    '@stylistic/jsx-indent-props': ['error', 2],
    '@stylistic/jsx-wrap-multilines': ['error', {
      declaration: 'parens-new-line',
      assignment: 'parens-new-line',
      return: 'parens-new-line',
      arrow: 'parens-new-line',
      condition: 'parens-new-line',
      logical: 'parens-new-line',
      prop: 'ignore',
    }],
    '@stylistic/jsx-first-prop-new-line': ['error', 'multiline-multiprop'],
    '@stylistic/jsx-closing-bracket-location': ['error', 'tag-aligned'],
    '@stylistic/jsx-closing-tag-location': 'error',
    '@stylistic/multiline-ternary': ['error', 'always-multiline'],
    '@stylistic/jsx-curly-newline': ['error', { multiline: 'consistent', singleline: 'consistent' }],
    '@stylistic/eol-last': ['error', 'always'],
  },
};

const formatLinter = new Linter({ configType: 'flat' });

// @stylistic still calls the pre-ESLint-10 SourceCode helper. Provide the alias
// so the latest published plugin remains usable under ESLint 10.
if (typeof (SourceCode as any).prototype.isSpaceBetweenTokens !== 'function') {
  (SourceCode as any).prototype.isSpaceBetweenTokens = function isSpaceBetweenTokens(left: unknown, right: unknown) {
    return this.isSpaceBetween(left, right);
  };
}

function isTypeScriptLikeFilename(filename: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/i.test(filename);
}

function isJavaScriptLikeFilename(filename: string): boolean {
  return /\.(?:js|jsx|mjs|cjs)$/i.test(filename);
}

function getVirtualLintFilename(filename: string): string {
  if (isTypeScriptLikeFilename(filename)) return '../../../pug-react.tsx';
  return '../../../pug-react.jsx';
}

function getFormatterLintFilename(filename: string): string {
  if (isTypeScriptLikeFilename(filename)) return 'pug-react.tsx';
  return 'pug-react.jsx';
}

function astContainsJsx(node: unknown): boolean {
  if (node == null) return false;
  if (Array.isArray(node)) return node.some(astContainsJsx);
  if (typeof node !== 'object') return false;

  const record = node as Record<string, unknown>;
  if (record.type === 'JSXElement' || record.type === 'JSXFragment') return true;

  for (const [key, value] of Object.entries(record)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    if (astContainsJsx(value)) return true;
  }

  return false;
}

function containsJsxSyntax(text: string, filename: string): boolean {
  try {
    const ast = parse(text, {
      sourceType: 'module',
      plugins: getExpressionParserPlugins(filename),
      errorRecovery: false,
    }) as any;
    return astContainsJsx(ast.program);
  } catch {
    return false;
  }
}

function unwrapRootExpression(node: any): any {
  let current = node;
  while (
    current
    && typeof current === 'object'
    && (
      current.type === 'ParenthesizedExpression'
      || current.type === 'TSAsExpression'
      || current.type === 'TSTypeAssertion'
      || current.type === 'TSNonNullExpression'
    )
  ) {
    current = current.expression;
  }
  return current;
}

function isRootJsxExpression(text: string, filename: string): boolean {
  try {
    const expr = parse(`const __pug = ${text}\n`, {
      sourceType: 'module',
      plugins: getExpressionParserPlugins(filename),
      createParenthesizedExpressions: true,
      errorRecovery: false,
    }) as any;
    const root = unwrapRootExpression(expr.program.body[0]?.declarations?.[0]?.init);
    return root?.type === 'JSXElement' || root?.type === 'JSXFragment';
  } catch {
    return false;
  }
}

function collectLegacyStyleStatementRanges(text: string, filename: string): InsertionOffsetRange[] {
  try {
    const ast = parse(text, {
      sourceType: 'module',
      plugins: getExpressionParserPlugins(filename),
      errorRecovery: false,
    }) as any;

    const ranges: InsertionOffsetRange[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }

      if (
        node.type === 'ExpressionStatement'
        && node.expression?.type === 'TaggedTemplateExpression'
        && node.expression.tag?.type === 'Identifier'
        && LEGACY_STYLE_HELPERS.has(node.expression.tag.name)
        && typeof node.start === 'number'
        && typeof node.end === 'number'
      ) {
        ranges.push({ start: node.start, end: node.end });
      }

      for (const value of Object.values(node)) {
        visit(value);
      }
    };

    visit(ast.program);
    return ranges;
  } catch {
    return [];
  }
}

function getLineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineText = text.slice(lineStart, text.indexOf('\n', lineStart) >= 0 ? text.indexOf('\n', lineStart) : text.length);
  return lineText.match(/^[ \t]*/)?.[0] ?? '';
}

function getExpressionParserPlugins(filename: string): any[] {
  return [
    'jsx',
    'decorators-legacy',
    ...(isTypeScriptLikeFilename(filename) ? ['typescript'] : []),
  ] as any;
}

function rebaseFormattedRegion(
  text: string,
  baseIndent: string,
  wrapperLineIndentWidth: number,
): string {
  if (text.length === 0) return text;
  const lines = text.split('\n');
  if (lines.length === 1) return text;

  return lines
    .map((line, index) => {
      if (index === 0) return line.trimStart();
      if (line.trim().length === 0) return '';

      const indentWidth = line.match(/^[ \t]*/)?.[0].length ?? 0;
      const relativeIndent = Math.max(0, indentWidth - wrapperLineIndentWidth);
      return `${baseIndent}${' '.repeat(relativeIndent)}${line.trimStart()}`;
    })
    .join('\n');
}

function normalizeJsxClosingBracketIndent(text: string): string {
  const lines = text.split('\n');
  const stack: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;

    if (/^<[^/!][^>]*$/.test(trimmed)) {
      stack.push(indent);
      continue;
    }

    if ((trimmed === '/>' || trimmed === '>') && stack.length > 0) {
      const openIndent = stack.pop()!;
      if (indent !== openIndent) {
        lines[i] = `${' '.repeat(openIndent)}${trimmed}`;
      }
    }
  }

  return lines.join('\n');
}

function normalizeSyntheticWrapperClosingIndent(
  text: string,
  containerKind: RegionFormattingContext['containerKind'],
): string {
  const lines = text.split('\n');
  if (lines.length < 3) return text;
  if (lines[0].trim() !== '(') return text;
  if (lines[lines.length - 1].trim() !== ')') return text;

  const firstContentLine = lines
    .slice(1, -1)
    .find(line => line.trim().length > 0);
  if (!firstContentLine) return text;

  const contentIndent = firstContentLine.match(/^[ \t]*/)?.[0] ?? '';
  const shouldAlignWithContent = (
    containerKind === 'conditional-branch'
    || containerKind === 'logical-operand'
  );
  lines[lines.length - 1] = `${shouldAlignWithContent ? contentIndent : ''})`;
  return lines.join('\n');
}

function applyFormatterLintPasses(text: string, filename: string): string {
  const lintConfig: any[] = [{
    files: FLAT_LINT_FILES,
    ...FORMAT_RULE_CONFIG,
    ...(isTypeScriptLikeFilename(filename)
      ? {
        languageOptions: {
          ...FORMAT_RULE_CONFIG.languageOptions,
          parser: tsParser as any,
        },
      }
      : {}),
  }];
  const pretty = prettier.format(text, {
    parser: isTypeScriptLikeFilename(filename) ? 'babel-ts' : 'babel',
    semi: false,
    singleQuote: true,
    jsxSingleQuote: true,
    trailingComma: 'none',
    bracketSameLine: false,
  });
  const fixed = formatLinter.verifyAndFix(pretty, lintConfig, getFormatterLintFilename(filename)).output;
  const normalized = normalizeJsxClosingBracketIndent(fixed);
  const refixed = formatLinter.verifyAndFix(
    normalized,
    lintConfig,
    getFormatterLintFilename(filename),
  ).output;

  return formatLinter.verifyAndFix(
    normalizeJsxClosingBracketIndent(refixed),
    lintConfig,
    getFormatterLintFilename(filename),
  ).output;
}

function normalizeFormattedExpressionForLint(
  text: string,
  wrapperLineIndentWidth: number,
  formattingContext: RegionFormattingContext,
  filename: string,
): {
  code: string;
  wrapperLineIndentWidth: number;
  hasSyntheticWrapperLines?: boolean;
} {
  if (
    formattingContext.containerKind !== 'standalone'
    && text.includes('\n')
    && isRootJsxExpression(text, filename)
  ) {
    const wrapped = applyFormatterLintPasses(`const __pug = (${text})\n`, filename);
    const extracted = extractFormattedExpressionFromWrapper(wrapped, 'variable-init', filename);
    if (extracted) {
      const normalizedCode = normalizeSyntheticWrapperClosingIndent(
        extracted.code,
        formattingContext.containerKind,
      );
      const lastNewline = extracted.code.lastIndexOf('\n');
      return {
        code: normalizedCode,
        wrapperLineIndentWidth: extracted.wrapperLineIndentWidth,
        hasSyntheticWrapperLines: lastNewline >= 0,
      };
    }
  }

  return {
    code: text,
    wrapperLineIndentWidth,
  };
}

function getSyntheticWrapperLineRanges(text: string): InsertionOffsetRange[] {
  const firstNewline = text.indexOf('\n');
  const lastNewline = text.lastIndexOf('\n');
  if (firstNewline < 0 || lastNewline < 0 || firstNewline === lastNewline) return [];

  return [
    { start: 0, end: firstNewline + 1 },
    { start: lastNewline + 1, end: text.length },
  ];
}

function formatPugRegionForLint(
  expr: string,
  baseIndent: string,
  formattingContext: RegionFormattingContext,
  filename: string,
): BoundaryMappedExpression {
  const wrapper = createFormattingWrapper(expr, formattingContext.containerKind);
  const finalWrapped = applyFormatterLintPasses(wrapper, filename);

  const extracted = extractFormattedExpressionFromWrapper(finalWrapped, formattingContext.containerKind, filename);
  const normalized = normalizeFormattedExpressionForLint(
    extracted?.code ?? expr,
    extracted?.wrapperLineIndentWidth ?? 0,
    formattingContext,
    filename,
  );
  const body = rebaseFormattedRegion(
    normalized.code,
    baseIndent,
    normalized.wrapperLineIndentWidth,
  );

  return {
    code: body,
    boundaryMap: buildExpressionBoundaryMap(expr, body, filename),
    syntheticRanges: normalized.hasSyntheticWrapperLines
      ? getSyntheticWrapperLineRanges(body)
      : undefined,
  };
}

function formatLintCode(transformed: LintTransformState, filename: string): RewrittenPugRegionsResult | null {
  if (transformed.regionSegments.length === 0) return null;

  return rewriteSegmentedPugRegions(transformed, filename, (expr, region, currentFilename) => {
    const baseIndent = getLineIndent(transformed.code, region.rewrittenStart);
    return formatPugRegionForLint(
      expr,
      baseIndent,
      region.formattingContext,
      currentFilename,
    );
  });
}

function intersectsTransformedPugRegion(
  transformed: LintTransformState | null,
  generatedStart: number,
  generatedEnd: number,
): boolean {
  if (!transformed) return false;
  const end = Math.max(generatedStart, generatedEnd);
  return transformed.regionSegments.some(region => (
    generatedStart < region.rewrittenEnd
    && end > region.rewrittenStart
  ));
}

function mapLintFix(
  fix: EslintLintMessage['fix'] | undefined,
  cached: CachedLintState,
): EslintLintMessage['fix'] | undefined {
  if (!fix) return undefined;
  if (!cached.transformed) return undefined;

  const generatedStart = cached.formatted
    ? cached.formatted.mapRewrittenOffsetToBase(fix.range[0])
    : fix.range[0];
  const generatedEnd = cached.formatted
    ? cached.formatted.mapRewrittenOffsetToBase(fix.range[1])
    : fix.range[1];

  if (generatedStart == null || generatedEnd == null) return undefined;
  if (intersectsTransformedPugRegion(cached.transformed, generatedStart, generatedEnd)) {
    return undefined;
  }

  const baseStart = cached.transformed.mapRewrittenOffsetToBase(generatedStart);
  const baseEnd = cached.transformed.mapRewrittenOffsetToBase(generatedEnd);
  if (baseStart == null || baseEnd == null) return undefined;

  const mapped = mapGeneratedRangeToOriginal(
    cached.transformed.baseTransform.document,
    baseStart,
    Math.max(0, baseEnd - baseStart),
  );
  if (!mapped) return undefined;

  return {
    ...fix,
    range: [mapped.start, mapped.end],
  };
}

function overlapsRangeList(
  ranges: InsertionOffsetRange[] | null | undefined,
  start: number,
  end: number,
): boolean {
  if (!ranges || ranges.length === 0) return false;
  return ranges.some(range => start < range.end && end > range.start);
}

function overlapsFormattedSyntheticRegion(
  formatted: RewrittenPugRegionsResult | null,
  start: number,
  end: number,
): boolean {
  if (!formatted) return false;
  return formatted.regionSegments.some(region => overlapsRangeList(region.syntheticRanges, start, end));
}

function shouldSuppressOriginalRangeMessage(
  cached: CachedLintState,
  message: EslintLintMessage,
  start: number,
  end: number,
): boolean {
  if (
    typeof message.ruleId === 'string'
    && LEGACY_STYLE_SUPPRESSED_RULES.has(message.ruleId)
    && overlapsRangeList(cached.legacyStyleStatementRanges, start, end)
  ) {
    return true;
  }

  return false;
}

function shouldSuppressGeneratedRangeMessage(
  cached: CachedLintState,
  message: EslintLintMessage,
  generatedStart: number,
  generatedEnd: number,
): boolean {
  if (overlapsRangeList(cached.syntheticStyleCallRanges, generatedStart, generatedEnd)) {
    return true;
  }
  return false;
}

function mapLintMessage(
  message: EslintLintMessage,
  cached: CachedLintState,
): EslintLintMessage | null {
  if (!cached.transformed) {
    if (message.line == null || message.column == null) return message;
    const start = lineColumnToOffset(cached.originalText, message.line, message.column);
    const end = (message.endLine != null && message.endColumn != null)
      ? lineColumnToOffset(cached.originalText, message.endLine, message.endColumn)
      : start + 1;
    return shouldSuppressOriginalRangeMessage(cached, message, start, Math.max(start + 1, end))
      ? null
      : message;
  }

  if (message.line == null || message.column == null) return message;

  const formattedStart = cached.formatted
    ? lineColumnToOffset(cached.formatted.code, message.line, message.column)
    : null;
  const formattedEnd = (
    cached.formatted
    && message.endLine != null
    && message.endColumn != null
  )
    ? lineColumnToOffset(cached.formatted.code, message.endLine, message.endColumn)
    : null;

  if (formattedStart != null && overlapsFormattedSyntheticRegion(
    cached.formatted,
    formattedStart,
    Math.max(formattedStart + 1, formattedEnd ?? (formattedStart + 1)),
  )) {
    return null;
  }

  const generatedStart = cached.formatted
    ? cached.formatted.mapRewrittenOffsetToBase(formattedStart!)
    : lineColumnToOffset(cached.transformed.code, message.line, message.column);
  if (generatedStart == null) return message;

  const generatedEnd = (message.endLine != null && message.endColumn != null)
    ? (
        cached.formatted
          ? cached.formatted.mapRewrittenOffsetToBase(formattedEnd!)
          : lineColumnToOffset(cached.transformed.code, message.endLine, message.endColumn)
      )
    : generatedStart + 1;
  if (generatedEnd == null) return message;

  if (shouldSuppressGeneratedRangeMessage(cached, message, generatedStart, generatedEnd)) {
    return null;
  }

  const baseStart = cached.transformed.mapRewrittenOffsetToBase(generatedStart);
  const baseEnd = cached.transformed.mapRewrittenOffsetToBase(generatedEnd);
  if (baseStart == null || baseEnd == null) return message;

  const mapped = mapGeneratedRangeToOriginal(
    cached.transformed.baseTransform.document,
    baseStart,
    Math.max(1, baseEnd - baseStart),
  );

  if (!mapped) return message;
  if (shouldSuppressOriginalRangeMessage(cached, message, mapped.start, mapped.end)) {
    return null;
  }

  const startLc = offsetToLineColumn(cached.originalText, mapped.start);
  const endLc = offsetToLineColumn(cached.originalText, mapped.end);
  const hasTransformedPug = cached.transformed.baseTransform.regions.length > 0;
  const mappedFix = hasTransformedPug ? undefined : mapLintFix(message.fix, cached);
  const mappedSuggestions = hasTransformedPug
    ? undefined
    : message.suggestions?.map((suggestion) => ({
        ...suggestion,
        fix: mapLintFix(suggestion.fix, cached),
      }));

  return {
    ...Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'fix' && key !== 'suggestions')),
    line: startLc.line,
    column: startLc.column,
    endLine: endLc.line,
    endColumn: endLc.column,
    ...(mappedFix ? { fix: mappedFix } : {}),
    ...(mappedSuggestions ? { suggestions: mappedSuggestions } : {}),
  };
}

function createReactPugProcessor(
  options: EslintReactPugProcessorOptions = {},
): EslintProcessorLike {
  const cache = new Map<string, CachedLintState>();

  return {
    preprocess(
      text: string,
      filename: string,
    ): Array<string | { text: string; filename: string }> {
      const configuredTagFunction = options.tagFunction ?? 'pug';
      const legacyStyleStatementRanges = collectLegacyStyleStatementRanges(text, filename);
      if (!hasTagFunctionCall(text, configuredTagFunction)) {
        const jsLikeFilename = isJavaScriptLikeFilename(filename);
        const shouldAlwaysVirtualizeJs = (
          options.jsxInJsFiles === 'always'
          && jsLikeFilename
          && !isTypeScriptLikeFilename(filename)
        );
        const shouldUseVirtualJsxFilename = (
          shouldAlwaysVirtualizeJs
          || containsJsxSyntax(text, filename)
        );
      if (legacyStyleStatementRanges.length > 0) {
        cache.set(filename, {
          originalText: text,
          transformed: null,
          formatted: null,
          legacyStyleStatementRanges,
          syntheticStyleCallRanges: [],
        });
      } else {
        cache.delete(filename);
        }
        if (!shouldUseVirtualJsxFilename) return [text];
        return [{
          text,
          filename: getVirtualLintFilename(filename),
        }];
      }

      const transformed = createLintTransform(text, filename, {
        tagFunction: configuredTagFunction,
        requirePugImport: options.requirePugImport ?? false,
        classAttribute: options.classShorthandProperty ?? 'auto',
        classMerge: options.classShorthandMerge ?? 'auto',
        startupjsCssxjs: options.startupjsCssxjs ?? 'auto',
        componentPathFromUppercaseClassShorthand: options.componentPathFromUppercaseClassShorthand ?? true,
      });
      const hasTransformedPug = transformed.baseTransform.regions.length > 0;
      const jsLikeFilename = isJavaScriptLikeFilename(filename);
      const shouldAlwaysVirtualizeJs = (
        options.jsxInJsFiles === 'always'
        && jsLikeFilename
        && !isTypeScriptLikeFilename(filename)
      );
      const shouldUseVirtualJsxFilename = (
        hasTransformedPug
        || shouldAlwaysVirtualizeJs
        || containsJsxSyntax(text, filename)
      );
      const formatted = hasTransformedPug ? formatLintCode(transformed, filename) : null;
      cache.set(filename, {
        originalText: text,
        transformed,
        formatted,
        legacyStyleStatementRanges,
        syntheticStyleCallRanges: collectMappedInsertionRangesByKind(transformed, 'style-call'),
      });
      if (!shouldUseVirtualJsxFilename) return [transformed.code];
      return [{
        text: hasTransformedPug ? (formatted?.code ?? transformed.code) : transformed.code,
        filename: getVirtualLintFilename(filename),
      }];
    },

    postprocess(messages: EslintLintMessage[][], filename: string): EslintLintMessage[] {
      const cached = cache.get(filename);
      cache.delete(filename);

      const flat = messages.flat();
      if (!cached) return flat;

      return flat
        .map((msg) => mapLintMessage(msg, cached))
        .filter((msg): msg is EslintLintMessage => msg != null);
    },

    supportsAutofix: true,
  };
}

const defaultProcessor = createReactPugProcessor();

const plugin = {
  processors: {
    'react-pug': defaultProcessor,
  },
  createReactPugProcessor,
};

export = plugin;
