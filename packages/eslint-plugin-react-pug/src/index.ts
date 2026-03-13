import {
  type ClassAttributeOption,
  type ClassMergeOption,
  lineColumnToOffset,
  mapGeneratedRangeToOriginal,
  offsetToLineColumn,
  type StartupjsCssxjsOption,
  transformSourceFile,
} from '@react-pug/react-pug-core';
import { parse } from '@babel/parser';
import { Linter } from 'eslint';
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
}

interface EslintLintMessage {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  [key: string]: unknown;
}

type SourceTransformState = ReturnType<typeof transformSourceFile>;

interface FormattedCopySegment {
  formattedStart: number;
  formattedEnd: number;
  transformedStart: number;
  transformedEnd: number;
}

interface FormattedRegionSegment {
  formattedStart: number;
  formattedEnd: number;
  transformedStart: number;
  transformedEnd: number;
  boundaryMap: number[];
}

interface FormattedLintCode {
  code: string;
  copySegments: FormattedCopySegment[];
  regionSegments: FormattedRegionSegment[];
}

interface CachedLintState {
  transformed: SourceTransformState;
  formatted: FormattedLintCode | null;
}

interface EslintProcessorLike {
  preprocess: (
    text: string,
    filename: string,
  ) => Array<string | { text: string; filename: string }>;
  postprocess: (messages: EslintLintMessage[][], filename: string) => EslintLintMessage[];
  supportsAutofix: boolean;
}

const FORMAT_WRAPPER_PREFIX = 'const __pug = ';
const FORMAT_RULE_CONFIG: Linter.LegacyConfig = {
  parserOptions: {
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const,
    ecmaFeatures: {
      jsx: true,
    },
  },
  rules: {
    '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
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

const formatLinter = new Linter({ configType: 'eslintrc' });
for (const [ruleName, rule] of Object.entries(stylisticPlugin.rules)) {
  formatLinter.defineRule(`@stylistic/${ruleName}`, rule as any);
}
formatLinter.defineParser('react-pug-typescript-parser', tsParser as any);

function isTypeScriptLikeFilename(filename: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/i.test(filename);
}

function getVirtualLintFilename(filename: string): string {
  if (isTypeScriptLikeFilename(filename)) return '../../../pug-react.tsx';
  return '../../../pug-react.jsx';
}

function getLineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineText = text.slice(lineStart, text.indexOf('\n', lineStart) >= 0 ? text.indexOf('\n', lineStart) : text.length);
  return lineText.match(/^[ \t]*/)?.[0] ?? '';
}

function indentFormattedRegion(text: string, baseIndent: string): string {
  if (baseIndent.length === 0) return text;
  return text.replace(/\n/g, `\n${baseIndent}`);
}

function normalizeTernaryBranchIndent(text: string): string {
  const lines = text.split('\n');
  const stack: Array<{
    baseIndent: number;
    closeIndent: number;
    jsxIndent: number;
    valueIndent: number;
  }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;

    while (stack.length > 0 && indent < stack[stack.length - 1].baseIndent) {
      stack.pop();
    }

    if (/^[?:]\s*\($/.test(trimmed)) {
      stack.push({
        baseIndent: indent,
        closeIndent: indent + 2,
        jsxIndent: indent + 2,
        valueIndent: indent + 4,
      });
      continue;
    }

    const current = stack[stack.length - 1];
    if (!current) continue;

    if (trimmed === ')' || trimmed === ')}') {
      if (indent < current.closeIndent) {
        lines[i] = `${' '.repeat(current.closeIndent)}${trimmed}`;
      }
      stack.pop();
      continue;
    }

    const expectedIndent = /^[<{}]/.test(trimmed)
      ? current.jsxIndent
      : current.valueIndent;
    if (trimmed.length > 0 && indent < expectedIndent) {
      lines[i] = `${' '.repeat(expectedIndent)}${trimmed}`;
    }
  }

  return lines.join('\n');
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

function parseExpressionTokens(expr: string, filename: string) {
  const wrapped = `${FORMAT_WRAPPER_PREFIX}${expr}\n`;
  const ast = parse(wrapped, {
    sourceType: 'module',
    plugins: [
      'jsx',
      'decorators-legacy',
      ...(isTypeScriptLikeFilename(filename) ? ['typescript'] : []),
    ] as any,
    errorRecovery: false,
    tokens: true,
  }) as any;

  const prefixLength = FORMAT_WRAPPER_PREFIX.length;
  const endLimit = wrapped.length - 1;
  const tokens = (ast.tokens ?? [])
    .filter((token: any) => token.start >= prefixLength && token.end <= endLimit)
    .map((token: any) => ({
      start: token.start - prefixLength,
      end: token.end - prefixLength,
      label: token.type?.label ?? token.type,
      value: token.value,
    }));

  return tokens;
}

function buildBoundaryMap(
  originalExpr: string,
  formattedExpr: string,
  filename: string,
): number[] {
  try {
    const originalTokens = parseExpressionTokens(originalExpr, filename);
    const formattedTokens = parseExpressionTokens(formattedExpr, filename);

    if (originalTokens.length !== formattedTokens.length) {
      throw new Error('token-count-mismatch');
    }

    const anchors = [{ formatted: 0, original: 0 }];
    for (let i = 0; i < originalTokens.length; i += 1) {
      const original = originalTokens[i];
      const formatted = formattedTokens[i];
      if (original.label !== formatted.label) throw new Error('token-label-mismatch');

      anchors.push({ formatted: formatted.start, original: original.start });
      anchors.push({ formatted: formatted.end, original: original.end });
    }
    anchors.push({ formatted: formattedExpr.length, original: originalExpr.length });

    anchors.sort((a, b) => a.formatted - b.formatted || a.original - b.original);

    const deduped: Array<{ formatted: number; original: number }> = [];
    for (const anchor of anchors) {
      const last = deduped[deduped.length - 1];
      if (!last || last.formatted !== anchor.formatted || last.original !== anchor.original) {
        deduped.push(anchor);
      }
    }

    const boundaryMap = new Array<number>(formattedExpr.length + 1);
    for (let i = 0; i < deduped.length - 1; i += 1) {
      const current = deduped[i];
      const next = deduped[i + 1];
      const formattedSpan = next.formatted - current.formatted;
      const originalSpan = next.original - current.original;

      if (formattedSpan <= 0) continue;

      for (let offset = current.formatted; offset < next.formatted; offset += 1) {
        const relative = offset - current.formatted;
        boundaryMap[offset] = current.original + Math.round(relative * originalSpan / formattedSpan);
      }
    }

    boundaryMap[formattedExpr.length] = originalExpr.length;
    for (let i = 0; i < boundaryMap.length; i += 1) {
      if (boundaryMap[i] == null) {
        boundaryMap[i] = i === 0 ? 0 : boundaryMap[i - 1];
      }
    }
    return boundaryMap;
  } catch {
    return Array.from({ length: formattedExpr.length + 1 }, (_, index) => (
      Math.min(originalExpr.length, Math.round(index * originalExpr.length / Math.max(1, formattedExpr.length)))
    ));
  }
}

function formatPugRegionForLint(
  expr: string,
  baseIndent: string,
  filename: string,
): { code: string; boundaryMap: number[] } {
  const wrapped = `${FORMAT_WRAPPER_PREFIX}${expr}\n`;
  const prettyWrapped = prettier.format(wrapped, {
    parser: isTypeScriptLikeFilename(filename) ? 'babel-ts' : 'babel',
    semi: false,
    singleQuote: true,
    jsxSingleQuote: true,
    trailingComma: 'none',
    bracketSameLine: false,
  });

  const fixedWrapped = formatLinter.verifyAndFix(prettyWrapped, {
    ...FORMAT_RULE_CONFIG,
    ...(isTypeScriptLikeFilename(filename)
      ? { parser: 'react-pug-typescript-parser' }
      : {}),
  }, 'pug-react.jsx').output;
  let body = fixedWrapped.slice(FORMAT_WRAPPER_PREFIX.length);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  body = indentFormattedRegion(body, baseIndent);
  body = normalizeTernaryBranchIndent(body);
  body = normalizeJsxClosingBracketIndent(body);

  return {
    code: body,
    boundaryMap: buildBoundaryMap(expr, body, filename),
  };
}

function formatLintCode(transformed: SourceTransformState, filename: string): FormattedLintCode | null {
  const pugRegions = transformed.document.mappedRegions
    .filter(region => region.kind === 'pug')
    .sort((a, b) => a.shadowStart - b.shadowStart);

  if (pugRegions.length === 0) return null;

  let code = '';
  let cursor = 0;
  const copySegments: FormattedCopySegment[] = [];
  const regionSegments: FormattedRegionSegment[] = [];

  for (const region of pugRegions) {
    if (cursor < region.shadowStart) {
      const formattedStart = code.length;
      const copied = transformed.code.slice(cursor, region.shadowStart);
      code += copied;
      copySegments.push({
        formattedStart,
        formattedEnd: code.length,
        transformedStart: cursor,
        transformedEnd: region.shadowStart,
      });
    }

    const formattedStart = code.length;
    const baseIndent = getLineIndent(transformed.code, region.shadowStart);
    const formattedRegion = formatPugRegionForLint(
      transformed.code.slice(region.shadowStart, region.shadowEnd),
      baseIndent,
      filename,
    );
    code += formattedRegion.code;
    regionSegments.push({
      formattedStart,
      formattedEnd: code.length,
      transformedStart: region.shadowStart,
      transformedEnd: region.shadowEnd,
      boundaryMap: formattedRegion.boundaryMap,
    });
    cursor = region.shadowEnd;
  }

  if (cursor < transformed.code.length) {
    const formattedStart = code.length;
    code += transformed.code.slice(cursor);
    copySegments.push({
      formattedStart,
      formattedEnd: code.length,
      transformedStart: cursor,
      transformedEnd: transformed.code.length,
    });
  }

  return { code, copySegments, regionSegments };
}

function mapFormattedOffsetToTransformed(
  formatted: FormattedLintCode,
  formattedOffset: number,
): number | null {
  const clamped = Math.max(0, Math.min(formattedOffset, formatted.code.length));

  for (const region of formatted.regionSegments) {
    if (clamped < region.formattedStart || clamped > region.formattedEnd) continue;
    const localOffset = clamped - region.formattedStart;
    const mappedLocal = region.boundaryMap[Math.min(localOffset, region.boundaryMap.length - 1)] ?? 0;
    return region.transformedStart + mappedLocal;
  }

  for (const segment of formatted.copySegments) {
    if (clamped < segment.formattedStart || clamped > segment.formattedEnd) continue;
    return segment.transformedStart + (clamped - segment.formattedStart);
  }

  return null;
}

function mapLintMessage(
  message: EslintLintMessage,
  cached: CachedLintState,
): EslintLintMessage {
  if (message.line == null || message.column == null) return message;

  const generatedStart = cached.formatted
    ? mapFormattedOffsetToTransformed(
      cached.formatted,
      lineColumnToOffset(cached.formatted.code, message.line, message.column),
    )
    : lineColumnToOffset(cached.transformed.code, message.line, message.column);
  if (generatedStart == null) return message;

  const generatedEnd = (message.endLine != null && message.endColumn != null)
    ? (
        cached.formatted
          ? mapFormattedOffsetToTransformed(
            cached.formatted,
            lineColumnToOffset(cached.formatted.code, message.endLine, message.endColumn),
          )
          : lineColumnToOffset(cached.transformed.code, message.endLine, message.endColumn)
      )
    : generatedStart + 1;
  if (generatedEnd == null) return message;

  const mapped = mapGeneratedRangeToOriginal(
    cached.transformed.document,
    generatedStart,
    Math.max(1, generatedEnd - generatedStart),
  );

  if (!mapped) return message;

  const startLc = offsetToLineColumn(cached.transformed.document.originalText, mapped.start);
  const endLc = offsetToLineColumn(cached.transformed.document.originalText, mapped.end);

  return {
    ...message,
    line: startLc.line,
    column: startLc.column,
    endLine: endLc.line,
    endColumn: endLc.column,
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
      const transformed = transformSourceFile(text, filename, {
        tagFunction: options.tagFunction ?? 'pug',
        compileMode: 'runtime',
        requirePugImport: options.requirePugImport ?? false,
        classAttribute: options.classShorthandProperty ?? 'auto',
        classMerge: options.classShorthandMerge ?? 'auto',
        startupjsCssxjs: options.startupjsCssxjs ?? 'auto',
        componentPathFromUppercaseClassShorthand: options.componentPathFromUppercaseClassShorthand ?? true,
      });
      const formatted = formatLintCode(transformed, filename);
      cache.set(filename, { transformed, formatted });
      if (transformed.regions.length === 0) return [transformed.code];
      return [{
        text: formatted?.code ?? transformed.code,
        filename: getVirtualLintFilename(filename),
      }];
    },

    postprocess(messages: EslintLintMessage[][], filename: string): EslintLintMessage[] {
      const cached = cache.get(filename);
      cache.delete(filename);

      const flat = messages.flat();
      if (!cached) return flat;
      if (cached.transformed.regions.length === 0) return flat;

      return flat.map((msg) => mapLintMessage(msg, cached));
    },

    supportsAutofix: true,
  };
}

const defaultProcessor = createReactPugProcessor();

const plugin = {
  processors: {
    'pug-react': defaultProcessor,
  },
  createReactPugProcessor,
};

export = plugin;
