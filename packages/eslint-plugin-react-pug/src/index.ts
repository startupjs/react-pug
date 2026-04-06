import {
  type ClassAttributeOption,
  type ClassMergeOption,
  hasTagFunctionCall,
  lineColumnToOffset,
  mapGeneratedRangeToOriginal,
  offsetToLineColumn,
  type StartupjsCssxjsOption,
  transformSourceFile,
} from '@react-pug/react-pug-core';
import generate from '@babel/generator';
import { parse, parseExpression } from '@babel/parser';
import * as t from '@babel/types';
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

interface OffsetRange {
  start: number;
  end: number;
}

interface CachedLintState {
  originalText: string;
  transformed: SourceTransformState | null;
  formatted: FormattedLintCode | null;
  legacyStyleStatementRanges: OffsetRange[];
  providerBooleanValueRanges: OffsetRange[];
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

function collectLegacyStyleStatementRanges(text: string, filename: string): OffsetRange[] {
  try {
    const ast = parse(text, {
      sourceType: 'module',
      plugins: getExpressionParserPlugins(filename),
      errorRecovery: false,
    }) as any;

    const ranges: OffsetRange[] = [];
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

function isProviderElementName(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'JSXIdentifier') return node.name === 'Provider';
  if (node.type === 'JSXMemberExpression') return isProviderElementName(node.property);
  return false;
}

function collectProviderBooleanValueRanges(text: string, filename: string): OffsetRange[] {
  try {
    const ast = parse(text, {
      sourceType: 'module',
      plugins: getExpressionParserPlugins(filename),
      errorRecovery: false,
    }) as any;

    const ranges: OffsetRange[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }

      if (
        node.type === 'JSXOpeningElement'
        && isProviderElementName(node.name)
        && Array.isArray(node.attributes)
      ) {
        for (const attribute of node.attributes) {
          if (
            attribute?.type === 'JSXAttribute'
            && attribute.name?.type === 'JSXIdentifier'
            && attribute.name.name === 'value'
            && attribute.value?.type === 'JSXExpressionContainer'
            && attribute.value.expression?.type === 'BooleanLiteral'
            && attribute.value.expression.value === true
            && typeof attribute.start === 'number'
            && typeof attribute.end === 'number'
          ) {
            ranges.push({ start: attribute.start, end: attribute.end });
          }
        }
      }

      for (const value of Object.values(node)) visit(value);
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

function unwrapLintComparableExpression(node: t.Expression): t.Expression {
  if (t.isParenthesizedExpression(node)) return unwrapLintComparableExpression(node.expression as t.Expression);
  if (t.isTSAsExpression(node)) return unwrapLintComparableExpression(node.expression as t.Expression);
  if (t.isTSTypeAssertion(node)) return unwrapLintComparableExpression(node.expression as t.Expression);
  if (t.isTSNonNullExpression(node)) return unwrapLintComparableExpression(node.expression as t.Expression);
  return node;
}

function isRepeatableTruthyExpression(node: t.Expression): boolean {
  const unwrapped = unwrapLintComparableExpression(node);
  return (
    t.isIdentifier(unwrapped)
    || t.isThisExpression(unwrapped)
    || t.isSuper(unwrapped)
    || t.isMemberExpression(unwrapped)
    || t.isOptionalMemberExpression(unwrapped)
  );
}

function areEquivalentRepeatableExpressions(left: t.Expression, right: t.Expression): boolean {
  const a = unwrapLintComparableExpression(left);
  const b = unwrapLintComparableExpression(right);

  if (a.type !== b.type) return false;
  if (t.isIdentifier(a) && t.isIdentifier(b)) return a.name === b.name;
  if (t.isThisExpression(a) && t.isThisExpression(b)) return true;
  if (t.isSuper(a) && t.isSuper(b)) return true;

  if (t.isMemberExpression(a) && t.isMemberExpression(b)) {
    return (
      a.computed === b.computed
      && areEquivalentRepeatableExpressions(a.object as t.Expression, b.object as t.Expression)
      && (
        a.computed
          ? (
              t.isExpression(a.property)
              && t.isExpression(b.property)
              && areEquivalentRepeatableExpressions(a.property, b.property)
            )
          : (
              t.isIdentifier(a.property)
              && t.isIdentifier(b.property)
              && a.property.name === b.property.name
            )
      )
    );
  }

  if (t.isOptionalMemberExpression(a) && t.isOptionalMemberExpression(b)) {
    return (
      a.computed === b.computed
      && a.optional === b.optional
      && areEquivalentRepeatableExpressions(a.object as t.Expression, b.object as t.Expression)
      && (
        a.computed
          ? areEquivalentRepeatableExpressions(a.property as t.Expression, b.property as t.Expression)
          : (
              t.isIdentifier(a.property)
              && t.isIdentifier(b.property)
              && a.property.name === b.property.name
            )
      )
    );
  }

  return false;
}

function isFragmentJsxName(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): boolean {
  return (
    (t.isJSXIdentifier(name) && name.name === 'Fragment')
    || (
      t.isJSXMemberExpression(name)
      && t.isJSXIdentifier(name.object)
      && name.object.name === 'React'
      && t.isJSXIdentifier(name.property)
      && name.property.name === 'Fragment'
    )
  );
}

function normalizeLintExpressionAst<T extends t.Node>(node: T): T {
  if (t.isConditionalExpression(node)) {
    node.test = normalizeLintExpressionAst(node.test);
    node.consequent = normalizeLintExpressionAst(node.consequent);
    node.alternate = normalizeLintExpressionAst(node.alternate);

    if (
      isRepeatableTruthyExpression(node.test)
      && areEquivalentRepeatableExpressions(node.test, node.consequent)
    ) {
      return t.logicalExpression('||', node.test, node.alternate) as T;
    }

    return node;
  }

  if (t.isJSXElement(node)) {
    node.children = node.children.map(child => normalizeLintExpressionAst(child));
    if (
      isFragmentJsxName(node.openingElement.name)
      && node.openingElement.attributes.length === 0
      && !node.openingElement.selfClosing
      && node.closingElement
    ) {
      return t.jsxFragment(
        t.jsxOpeningFragment(),
        t.jsxClosingFragment(),
        node.children,
      ) as T;
    }
    return node;
  }

  if (t.isJSXFragment(node)) {
    node.children = node.children.map(child => normalizeLintExpressionAst(child));
    return node;
  }

  if (t.isJSXExpressionContainer(node)) {
    node.expression = normalizeLintExpressionAst(node.expression);
    return node;
  }

  if (Array.isArray((node as any).children)) {
    (node as any).children = (node as any).children.map((child: any) => normalizeLintExpressionAst(child));
  }

  for (const [key, value] of Object.entries(node as any)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    if (Array.isArray(value)) {
      (node as any)[key] = value.map(item => {
        if (!item || typeof item !== 'object' || typeof (item as any).type !== 'string') return item;
        return normalizeLintExpressionAst(item as t.Node);
      });
      continue;
    }

    if (value && typeof value === 'object' && typeof (value as any).type === 'string') {
      (node as any)[key] = normalizeLintExpressionAst(value as t.Node);
    }
  }

  return node;
}

function normalizeLintExpression(expr: string, filename: string): string {
  try {
    const ast = parseExpression(expr, {
      plugins: getExpressionParserPlugins(filename),
      errorRecovery: false,
    }) as t.Expression;
    const normalized = normalizeLintExpressionAst(ast);
    return generate(normalized, {
      comments: true,
      jsescOption: {
        minimal: true,
      },
    }).code;
  } catch {
    return expr;
  }
}

function indentFormattedRegion(
  text: string,
  baseIndent: string,
  closingIndentOffset = 0,
  inlinePrefix = false,
): string {
  if (baseIndent.length === 0 || text.length === 0) return text;

  const lines = text.split('\n');
  if (lines.length === 1) return text;

  const firstTrimmed = lines[0].trim();
  const lastTrimmed = lines[lines.length - 1].trim();
  const isStructuredMultilineExpression = (
    (firstTrimmed === '(' && lastTrimmed === ')')
    || (firstTrimmed.startsWith('(() => {') && lastTrimmed.startsWith('})()'))
    || (firstTrimmed.startsWith('<') && (lastTrimmed.startsWith('</') || lastTrimmed === '/>' || lastTrimmed === '>'))
  );

  const structuredBodyIndent = isStructuredMultilineExpression
    ? Math.min(...lines
      .slice(1, -1)
      .filter(line => line.trim().length > 0)
      .map(line => line.match(/^[ \t]*/)?.[0].length ?? 0))
    : 0;

  return lines
    .map((line, index) => {
      if (index === 0) return inlinePrefix ? line.trimStart() : line;

      if (isStructuredMultilineExpression && index < lines.length - 1) {
        return `${baseIndent}  ${line.slice(structuredBodyIndent)}`;
      }

      if (isStructuredMultilineExpression) {
        return `${baseIndent}${' '.repeat(closingIndentOffset)}${line.trimStart()}`;
      }

      return `${baseIndent}${line}`;
    })
    .join('\n');
}

function normalizeTernaryBranchIndent(text: string): string {
  const lines = text.split('\n');
  const stack: Array<{
    branchIndent: number;
    iifeOpenIndex: number | null;
  }> = [];

  const getIndent = (line: string) => line.match(/^[ \t]*/)?.[0].length ?? 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = getIndent(line);

    if (/^[?:]\s*\($/.test(trimmed)) {
      stack.push({ branchIndent: indent, iifeOpenIndex: null });
      continue;
    }

    const current = stack[stack.length - 1];
    if (!current) continue;

    if (current.iifeOpenIndex == null && (trimmed === ')' || trimmed === ')}')) {
      lines[i] = `${' '.repeat(current.branchIndent + 2)}${trimmed}`;
      stack.pop();
      continue;
    }

    if (trimmed.startsWith('(() => {') || trimmed.startsWith('{(() => {')) {
      current.iifeOpenIndex = i;
      lines[i] = `${' '.repeat(current.branchIndent + 4)}${trimmed}`;
      continue;
    }

    if (current.iifeOpenIndex != null && trimmed.startsWith('})()')) {
      const bodyLines = lines
        .slice(current.iifeOpenIndex + 1, i)
        .filter(branchLine => branchLine.trim().length > 0);
      const bodyBaseIndent = bodyLines.length > 0
        ? Math.min(...bodyLines.map(getIndent))
        : current.branchIndent + 2;

      for (let bodyIndex = current.iifeOpenIndex + 1; bodyIndex < i; bodyIndex += 1) {
        const bodyLine = lines[bodyIndex];
        const bodyTrimmed = bodyLine.trim();
        if (bodyTrimmed.length === 0) continue;

        const relativeIndent = Math.max(0, getIndent(bodyLine) - bodyBaseIndent);
        lines[bodyIndex] = `${' '.repeat(current.branchIndent + 6 + relativeIndent)}${bodyTrimmed}`;
      }

      lines[i] = `${' '.repeat(current.branchIndent + 4)}${trimmed}`;
      current.iifeOpenIndex = null;
      continue;
    }

    if (current.iifeOpenIndex == null && trimmed.length > 0) {
      const expectedIndent = /^[<>{]/.test(trimmed)
        ? current.branchIndent + 2
        : current.branchIndent + 4;

      if (indent < expectedIndent) {
        lines[i] = `${' '.repeat(expectedIndent)}${trimmed}`;
      }
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
    .filter((token: any) => {
      if (token.start < prefixLength || token.end > endLimit) return false;
      const rawText = wrapped.slice(token.start, token.end);
      if (token.type?.label === 'jsxText' && rawText.trim().length === 0) return false;
      return true;
    })
    .map((token: any) => ({
      start: token.start - prefixLength,
      end: token.end - prefixLength,
      label: token.type?.label ?? token.type,
      value: token.value,
      raw: wrapped.slice(token.start, token.end),
    }));

  return tokens;
}

function tokenAlignmentKey(token: {
  label: string;
  value?: unknown;
  raw: string;
}): string {
  switch (token.label) {
    case 'name':
    case 'jsxName':
    case 'privateName':
      return `${token.label}:${token.raw}`;
    case 'string':
      return `${token.label}:${String(token.value ?? token.raw)}`;
    case 'num':
    case 'bigint':
    case 'decimal':
    case 'regexp':
      return `${token.label}:${token.raw}`;
    case 'jsxText':
      return `${token.label}:${token.raw.trim()}`;
    default:
      return token.label;
  }
}

function alignExpressionTokens(
  originalTokens: Array<{
    start: number;
    end: number;
    label: string;
    value?: unknown;
    raw: string;
  }>,
  formattedTokens: Array<{
    start: number;
    end: number;
    label: string;
    value?: unknown;
    raw: string;
  }>,
): Array<[number, number]> {
  const originalKeys = originalTokens.map(tokenAlignmentKey);
  const formattedKeys = formattedTokens.map(tokenAlignmentKey);
  const dp = Array.from({ length: originalKeys.length + 1 }, () => (
    new Array<number>(formattedKeys.length + 1).fill(0)
  ));

  for (let i = originalKeys.length - 1; i >= 0; i -= 1) {
    for (let j = formattedKeys.length - 1; j >= 0; j -= 1) {
      if (originalKeys[i] === formattedKeys[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < originalKeys.length && j < formattedKeys.length) {
    if (originalKeys[i] === formattedKeys[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return matches;
}

function buildBoundaryMap(
  originalExpr: string,
  formattedExpr: string,
  filename: string,
): number[] {
  try {
    const originalTokens = parseExpressionTokens(originalExpr, filename);
    const formattedTokens = parseExpressionTokens(formattedExpr, filename);
    const matchedTokens = alignExpressionTokens(originalTokens, formattedTokens);
    if (matchedTokens.length === 0) throw new Error('token-alignment-empty');

    const anchors = [{ formatted: 0, original: 0 }];
    for (const [originalIndex, formattedIndex] of matchedTokens) {
      const original = originalTokens[originalIndex];
      const formatted = formattedTokens[formattedIndex];
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
  closingIndentOffset: number,
  inlinePrefix: boolean,
  filename: string,
): { code: string; boundaryMap: number[] } {
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
  const normalizedExpr = normalizeLintExpression(expr, filename);
  const wrapped = `${FORMAT_WRAPPER_PREFIX}${normalizedExpr}\n`;
  const prettyWrapped = prettier.format(wrapped, {
    parser: isTypeScriptLikeFilename(filename) ? 'babel-ts' : 'babel',
    semi: false,
    singleQuote: true,
    jsxSingleQuote: true,
    trailingComma: 'none',
    bracketSameLine: false,
  });

  const fixedWrapped = formatLinter.verifyAndFix(prettyWrapped, lintConfig, getFormatterLintFilename(filename)).output;
  let body = fixedWrapped.slice(FORMAT_WRAPPER_PREFIX.length);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  body = normalizeTernaryBranchIndent(body);
  body = normalizeJsxClosingBracketIndent(body);
  const normalizedWrapped = `${FORMAT_WRAPPER_PREFIX}${body}\n`;
  const refixedWrapped = formatLinter.verifyAndFix(
    normalizedWrapped,
    lintConfig,
    getFormatterLintFilename(filename),
  ).output;
  body = refixedWrapped.slice(FORMAT_WRAPPER_PREFIX.length);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  body = normalizeTernaryBranchIndent(body);
  body = normalizeJsxClosingBracketIndent(body);
  const finalWrapped = formatLinter.verifyAndFix(
    `${FORMAT_WRAPPER_PREFIX}${body}\n`,
    lintConfig,
    getFormatterLintFilename(filename),
  ).output;
  body = finalWrapped.slice(FORMAT_WRAPPER_PREFIX.length);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  body = indentFormattedRegion(body, baseIndent, closingIndentOffset, inlinePrefix);

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
    const lineStart = transformed.code.lastIndexOf('\n', Math.max(0, region.shadowStart - 1)) + 1;
    const beforeRegionOnLine = transformed.code.slice(lineStart, region.shadowStart);
    const inlinePrefix = beforeRegionOnLine.trim().length > 0;
    const closingIndentOffset = (
      /[?:]\s*$/.test(beforeRegionOnLine)
      || /^\s*[?:].*=>\s*$/.test(beforeRegionOnLine)
    )
      ? 2
      : 0;
    const formattedRegion = formatPugRegionForLint(
      transformed.code.slice(region.shadowStart, region.shadowEnd),
      baseIndent,
      closingIndentOffset,
      inlinePrefix,
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

function intersectsTransformedPugRegion(
  transformed: SourceTransformState | null,
  generatedStart: number,
  generatedEnd: number,
): boolean {
  if (!transformed) return false;
  const end = Math.max(generatedStart, generatedEnd);
  return transformed.document.mappedRegions.some(region => (
    region.kind === 'pug'
    && generatedStart < region.shadowEnd
    && end > region.shadowStart
  ));
}

function mapLintFix(
  fix: EslintLintMessage['fix'] | undefined,
  cached: CachedLintState,
): EslintLintMessage['fix'] | undefined {
  if (!fix) return undefined;
  if (!cached.transformed) return undefined;

  const generatedStart = cached.formatted
    ? mapFormattedOffsetToTransformed(cached.formatted, fix.range[0])
    : fix.range[0];
  const generatedEnd = cached.formatted
    ? mapFormattedOffsetToTransformed(cached.formatted, fix.range[1])
    : fix.range[1];

  if (generatedStart == null || generatedEnd == null) return undefined;
  if (intersectsTransformedPugRegion(cached.transformed, generatedStart, generatedEnd)) {
    return undefined;
  }

  const mapped = mapGeneratedRangeToOriginal(
    cached.transformed.document,
    generatedStart,
    Math.max(0, generatedEnd - generatedStart),
  );
  if (!mapped) return undefined;

  return {
    ...fix,
    range: [mapped.start, mapped.end],
  };
}

function overlapsRangeList(ranges: OffsetRange[], start: number, end: number): boolean {
  return ranges.some(range => start < range.end && end > range.start);
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

function isSyntheticStyleCallRange(
  cached: CachedLintState,
  generatedStart: number,
  generatedEnd: number,
): boolean {
  if (!cached.transformed) return false;
  return cached.transformed.document.insertions.some(insertion => (
    insertion.kind === 'style-call'
    && generatedStart >= insertion.shadowStart
    && generatedEnd <= insertion.shadowEnd
  ));
}

function shouldSuppressGeneratedRangeMessage(
  cached: CachedLintState,
  message: EslintLintMessage,
  generatedStart: number,
  generatedEnd: number,
): boolean {
  if (
    message.ruleId === 'react/jsx-boolean-value'
    && overlapsRangeList(cached.providerBooleanValueRanges, generatedStart, generatedEnd)
  ) {
    return true;
  }
  if (isSyntheticStyleCallRange(cached, generatedStart, generatedEnd)) {
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

  if (shouldSuppressGeneratedRangeMessage(cached, message, generatedStart, generatedEnd)) {
    return null;
  }

  const mapped = mapGeneratedRangeToOriginal(
    cached.transformed.document,
    generatedStart,
    Math.max(1, generatedEnd - generatedStart),
  );

  if (!mapped) return message;
  if (shouldSuppressOriginalRangeMessage(cached, message, mapped.start, mapped.end)) {
    return null;
  }

  const startLc = offsetToLineColumn(cached.originalText, mapped.start);
  const endLc = offsetToLineColumn(cached.originalText, mapped.end);
  const hasTransformedPug = cached.transformed.regions.length > 0;
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
          providerBooleanValueRanges: [],
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

      const transformed = transformSourceFile(text, filename, {
        tagFunction: configuredTagFunction,
        compileMode: 'runtime',
        requirePugImport: options.requirePugImport ?? false,
        classAttribute: options.classShorthandProperty ?? 'auto',
        classMerge: options.classShorthandMerge ?? 'auto',
        startupjsCssxjs: options.startupjsCssxjs ?? 'auto',
        componentPathFromUppercaseClassShorthand: options.componentPathFromUppercaseClassShorthand ?? true,
      });
      const hasTransformedPug = transformed.regions.length > 0;
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
        providerBooleanValueRanges: collectProviderBooleanValueRanges(transformed.code, filename),
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
