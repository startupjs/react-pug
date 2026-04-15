import generate from '@babel/generator';
import { parse, parseExpression } from '@babel/parser';
import * as t from '@babel/types';
import type { EmbeddedJsLintSite, ShadowInsertion, ShadowMappedRegion } from './mapping';
import type { SourceTransformOptions, SourceTransformResult } from './sourceTransform';
import { transformSourceFile } from './sourceTransform';
import { regionStrippedOffsetToOriginalOffset, strippedToRawOffset } from './regionOffsetMapping';

export interface RewrittenCopySegment {
  rewrittenStart: number;
  rewrittenEnd: number;
  baseStart: number;
  baseEnd: number;
}

export interface RewrittenRegionSegment {
  rewrittenStart: number;
  rewrittenEnd: number;
  baseStart: number;
  baseEnd: number;
  boundaryMap: number[];
  syntheticRanges: InsertionOffsetRange[];
  region: ShadowMappedRegion;
  formattingContext: RegionFormattingContext;
}

export interface RewrittenPugRegionsResult {
  code: string;
  copySegments: RewrittenCopySegment[];
  regionSegments: RewrittenRegionSegment[];
  mapRewrittenOffsetToBase: (offset: number) => number | null;
  mapBaseOffsetToRewritten: (offset: number) => number | null;
}

export interface SegmentedPugRegionsInput {
  code: string;
  copySegments: RewrittenCopySegment[];
  regionSegments: RewrittenRegionSegment[];
}

export interface BoundaryMappedExpression {
  code: string;
  boundaryMap: number[];
  syntheticRanges?: InsertionOffsetRange[];
}

export interface LintTransformResult extends RewrittenPugRegionsResult {
  baseTransform: SourceTransformResult;
  embeddedJsLintSites: MappedEmbeddedJsLintSite[];
  mapGeneratedOffsetToOriginal: (offset: number) => number | null;
  mapBaseOffsetToOriginal: (offset: number) => number | null;
}

export interface MappedEmbeddedJsLintSite {
  kind: EmbeddedJsLintSite['kind'];
  originalStart: number;
  originalEnd: number;
  code: string;
  boundaryMap: number[];
}

export type RegionContainerKind =
  | 'standalone'
  | 'return-value'
  | 'variable-init'
  | 'assignment-value'
  | 'object-property-value'
  | 'call-argument'
  | 'arrow-body'
  | 'logical-operand'
  | 'conditional-branch'
  | 'other-expression';

export interface RegionFormattingContext {
  containerKind: RegionContainerKind;
}

export interface FormattingWrapperExtraction {
  code: string;
  wrapperLineIndentWidth: number;
}

export interface InsertionOffsetRange {
  start: number;
  end: number;
}

interface ExpressionToken {
  start: number;
  end: number;
  label: string;
  value?: unknown;
  raw: string;
}

const FORMAT_WRAPPER_PREFIX = 'const __pug = ';

function isTypeScriptLikeFilename(filename: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/i.test(filename);
}

function getExpressionParserPlugins(filename: string): any[] {
  return [
    'jsx',
    'decorators-legacy',
    ...(isTypeScriptLikeFilename(filename) ? ['typescript'] : []),
  ] as any;
}

function parseExpressionTokens(expr: string, filename: string): ExpressionToken[] {
  const wrapped = `${FORMAT_WRAPPER_PREFIX}${expr}\n`;
  const ast = parse(wrapped, {
    sourceType: 'module',
    plugins: getExpressionParserPlugins(filename),
    errorRecovery: false,
    tokens: true,
  }) as any;

  const prefixLength = FORMAT_WRAPPER_PREFIX.length;
  const endLimit = wrapped.length - 1;
  return (ast.tokens ?? [])
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
}

function tokenAlignmentKey(token: Pick<ExpressionToken, 'label' | 'value' | 'raw'>): string {
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

function alignExpressionTokens(originalTokens: ExpressionToken[], rewrittenTokens: ExpressionToken[]): Array<[number, number]> {
  const originalKeys = originalTokens.map(tokenAlignmentKey);
  const rewrittenKeys = rewrittenTokens.map(tokenAlignmentKey);
  const dp = Array.from({ length: originalKeys.length + 1 }, () => new Array<number>(rewrittenKeys.length + 1).fill(0));

  for (let i = originalKeys.length - 1; i >= 0; i -= 1) {
    for (let j = rewrittenKeys.length - 1; j >= 0; j -= 1) {
      if (originalKeys[i] === rewrittenKeys[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < originalKeys.length && j < rewrittenKeys.length) {
    if (originalKeys[i] === rewrittenKeys[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }

  return matches;
}

export function buildExpressionBoundaryMap(originalExpr: string, rewrittenExpr: string, filename: string): number[] {
  try {
    const originalTokens = parseExpressionTokens(originalExpr, filename);
    const rewrittenTokens = parseExpressionTokens(rewrittenExpr, filename);
    const matchedTokens = alignExpressionTokens(originalTokens, rewrittenTokens);
    if (matchedTokens.length === 0) throw new Error('token-alignment-empty');

    const anchors = [{ rewritten: 0, original: 0 }];
    for (const [originalIndex, rewrittenIndex] of matchedTokens) {
      const original = originalTokens[originalIndex];
      const rewritten = rewrittenTokens[rewrittenIndex];
      anchors.push({ rewritten: rewritten.start, original: original.start });
      anchors.push({ rewritten: rewritten.end, original: original.end });
    }
    anchors.push({ rewritten: rewrittenExpr.length, original: originalExpr.length });
    anchors.sort((a, b) => a.rewritten - b.rewritten || a.original - b.original);

    const deduped: Array<{ rewritten: number; original: number }> = [];
    for (const anchor of anchors) {
      const last = deduped[deduped.length - 1];
      if (!last || last.rewritten !== anchor.rewritten || last.original !== anchor.original) deduped.push(anchor);
    }

    const boundaryMap = new Array<number>(rewrittenExpr.length + 1);
    for (let i = 0; i < deduped.length - 1; i += 1) {
      const current = deduped[i];
      const next = deduped[i + 1];
      const rewrittenSpan = next.rewritten - current.rewritten;
      const originalSpan = next.original - current.original;
      if (rewrittenSpan <= 0) continue;

      for (let offset = current.rewritten; offset < next.rewritten; offset += 1) {
        const relative = offset - current.rewritten;
        boundaryMap[offset] = current.original + Math.round(relative * originalSpan / rewrittenSpan);
      }
    }

    boundaryMap[rewrittenExpr.length] = originalExpr.length;
    for (let i = 0; i < boundaryMap.length; i += 1) {
      if (boundaryMap[i] == null) boundaryMap[i] = i === 0 ? 0 : boundaryMap[i - 1];
    }

    return boundaryMap;
  } catch {
    return Array.from({ length: rewrittenExpr.length + 1 }, (_, index) => (
      Math.min(originalExpr.length, Math.round(index * originalExpr.length / Math.max(1, rewrittenExpr.length)))
    ));
  }
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

function isNode(value: unknown): value is t.Node {
  return !!value && typeof value === 'object' && typeof (value as any).type === 'string';
}

function isTransparentContainer(node: t.Node): boolean {
  return (
    t.isParenthesizedExpression(node)
    || t.isTSAsExpression(node)
    || t.isTSTypeAssertion(node)
    || t.isTSNonNullExpression(node)
  );
}

interface AstPathEntry {
  node: t.Node;
  parent: t.Node | null;
  key: string | number | null;
}

function findInnermostAstPathContainingRange(
  root: t.Node,
  start: number,
  end: number,
): AstPathEntry[] | null {
  let bestPath: AstPathEntry[] | null = null;

  const visit = (node: t.Node, parent: t.Node | null, key: string | number | null, path: AstPathEntry[]) => {
    if (typeof node.start !== 'number' || typeof node.end !== 'number') return;
    if (start < node.start || end > node.end) return;

    const nextPath = [...path, { node, parent, key }];
    if (
      !bestPath
      || (node.end - node.start) <= ((bestPath[bestPath.length - 1].node.end ?? 0) - (bestPath[bestPath.length - 1].node.start ?? 0))
    ) {
      bestPath = nextPath;
    }

    for (const [childKey, value] of Object.entries(node as any)) {
      if (childKey === 'loc' || childKey === 'start' || childKey === 'end' || childKey === 'extra') continue;
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (isNode(item)) visit(item, node, index, nextPath);
        });
        continue;
      }
      if (isNode(value)) visit(value, node, childKey, nextPath);
    }
  };

  visit(root, null, null, []);
  return bestPath;
}

function getInlinePrefix(baseCode: string, offset: number): boolean {
  const lineStart = baseCode.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return baseCode.slice(lineStart, offset).trim().length > 0;
}

function classifyRegionFormattingContextFromAst(
  baseCode: string,
  astRoot: t.Node | null,
  start: number,
  end: number,
): RegionFormattingContext {
  const inlinePrefix = getInlinePrefix(baseCode, start);

  try {
    const path = astRoot ? findInnermostAstPathContainingRange(astRoot, start, end) : null;
    if (!path || path.length === 0) {
      return {
        containerKind: inlinePrefix ? 'other-expression' : 'standalone',
      };
    }

    for (let index = path.length - 1; index >= 0; index -= 1) {
      const entry = path[index];
      const parent = entry.parent;
      if (!parent) continue;

      if (t.isConditionalExpression(parent) && (entry.key === 'consequent' || entry.key === 'alternate')) {
        return {
          containerKind: 'conditional-branch',
        };
      }
    }

    for (let index = path.length - 1; index >= 0; index -= 1) {
      const entry = path[index];
      const parent = entry.parent;
      if (!parent) continue;

      if (t.isReturnStatement(parent) && entry.key === 'argument') {
        return { containerKind: 'return-value' };
      }
      if (t.isVariableDeclarator(parent) && entry.key === 'init') {
        return { containerKind: 'variable-init' };
      }
      if (t.isAssignmentExpression(parent) && entry.key === 'right') {
        return { containerKind: 'assignment-value' };
      }
      if (
        (t.isObjectProperty(parent) || t.isObjectMethod(parent))
        && entry.key === 'value'
      ) {
        return { containerKind: 'object-property-value' };
      }
      if (
        (t.isCallExpression(parent) || t.isNewExpression(parent))
        && typeof entry.key === 'number'
      ) {
        return { containerKind: 'call-argument' };
      }
      if (t.isArrowFunctionExpression(parent) && entry.key === 'body') {
        return { containerKind: 'arrow-body' };
      }
      if (t.isLogicalExpression(parent) && (entry.key === 'left' || entry.key === 'right')) {
        return { containerKind: 'logical-operand' };
      }
    }

    return {
      containerKind: inlinePrefix ? 'other-expression' : 'standalone',
    };
  } catch {
    return {
      containerKind: inlinePrefix ? 'other-expression' : 'standalone',
    };
  }
}

function createRegionFormattingContextResolver(baseCode: string, filename: string) {
  let astRoot: t.Node | null = null;
  try {
    const ast = parse(baseCode, {
      sourceType: 'module',
      plugins: getExpressionParserPlugins(filename),
      createParenthesizedExpressions: true,
      errorRecovery: false,
    }) as any;
    astRoot = ast.program as t.Node;
  } catch {
    astRoot = null;
  }

  return (start: number, end: number) => classifyRegionFormattingContextFromAst(baseCode, astRoot, start, end);
}

function normalizeLintExpressionAst<T extends t.Node>(node: T): T {
  if (t.isConditionalExpression(node)) {
    node.test = normalizeLintExpressionAst(node.test);
    node.consequent = normalizeLintExpressionAst(node.consequent);
    node.alternate = normalizeLintExpressionAst(node.alternate);

    if (isRepeatableTruthyExpression(node.test) && areEquivalentRepeatableExpressions(node.test, node.consequent)) {
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
      return t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), node.children) as T;
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
      (node as any)[key] = value.map((item: any) => {
        if (!item || typeof item !== 'object' || typeof item.type !== 'string') return item;
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

export function normalizePugExpressionForLint(expr: string, filename: string): BoundaryMappedExpression {
  try {
    const ast = parseExpression(expr, {
      plugins: getExpressionParserPlugins(filename),
      errorRecovery: false,
    }) as t.Expression;
    const normalized = normalizeLintExpressionAst(ast);
    const code = generate(normalized, {
      comments: true,
      jsescOption: {
        minimal: true,
      },
    }).code;
    return {
      code,
      boundaryMap: buildExpressionBoundaryMap(expr, code, filename),
    };
  } catch {
    return {
      code: expr,
      boundaryMap: buildExpressionBoundaryMap(expr, expr, filename),
    };
  }
}

interface FormattingWrapperPlan {
  code: string;
  extract: (ast: any) => { start: number; end: number } | null;
}

function getFormattingWrapperPlan(expr: string, containerKind: RegionContainerKind): FormattingWrapperPlan {
  switch (containerKind) {
    case 'conditional-branch':
      return {
        code: `const __ctx = __cond ? ${expr} : __alt\n`,
        extract: (ast) => ast.program.body[0]?.declarations?.[0]?.init?.consequent ?? null,
      };
    case 'object-property-value':
      return {
        code: `const __ctx = {\n  value: ${expr}\n}\n`,
        extract: (ast) => ast.program.body[0]?.declarations?.[0]?.init?.properties?.[0]?.value ?? null,
      };
    case 'return-value':
      return {
        code: `function __ctx () {\n  return ${expr}\n}\n`,
        extract: (ast) => ast.program.body[0]?.body?.body?.[0]?.argument ?? null,
      };
    case 'assignment-value':
      return {
        code: `__reactPugFmt = ${expr}\n`,
        extract: (ast) => ast.program.body[0]?.expression?.right ?? null,
      };
    case 'call-argument':
      return {
        code: `__reactPugFmt(${expr})\n`,
        extract: (ast) => ast.program.body[0]?.expression?.arguments?.[0] ?? null,
      };
    case 'arrow-body':
      return {
        code: `const __ctx = () => ${expr}\n`,
        extract: (ast) => ast.program.body[0]?.declarations?.[0]?.init?.body ?? null,
      };
    case 'logical-operand':
      return {
        code: `const __ctx = __cond && ${expr}\n`,
        extract: (ast) => ast.program.body[0]?.declarations?.[0]?.init?.right ?? null,
      };
    case 'standalone':
      return {
        code: `${expr}\n`,
        extract: (ast) => ast.program.body[0]?.expression ?? null,
      };
    case 'variable-init':
    case 'other-expression':
    default:
      return {
        code: `const __pug = ${expr}\n`,
        extract: (ast) => ast.program.body[0]?.declarations?.[0]?.init ?? null,
      };
  }
}

export function createFormattingWrapper(expr: string, containerKind: RegionContainerKind): string {
  return getFormattingWrapperPlan(expr, containerKind).code;
}

function getLineIndentWidth(text: string, offset: number): number {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineEnd = text.indexOf('\n', lineStart) >= 0 ? text.indexOf('\n', lineStart) : text.length;
  const line = text.slice(lineStart, lineEnd);
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

export function extractFormattedExpressionFromWrapper(
  formattedWrapper: string,
  containerKind: RegionContainerKind,
  filename: string,
): FormattingWrapperExtraction | null {
  try {
    const ast = parse(formattedWrapper, {
      sourceType: 'module',
      plugins: getExpressionParserPlugins(filename),
      createParenthesizedExpressions: true,
      errorRecovery: false,
    }) as any;
    const wrapper = getFormattingWrapperPlan('', containerKind);
    const node = wrapper.extract(ast);
    if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return null;

    return {
      code: formattedWrapper.slice(node.start, node.end),
      wrapperLineIndentWidth: getLineIndentWidth(formattedWrapper, node.start),
    };
  } catch {
    return null;
  }
}

export function rewriteMappedPugRegions(
  baseTransform: SourceTransformResult,
  filename: string,
  rewriteRegion: (expr: string, region: ShadowMappedRegion, filename: string) => BoundaryMappedExpression,
): RewrittenPugRegionsResult {
  const pugRegions = baseTransform.document.mappedRegions
    .filter(region => region.kind === 'pug')
    .sort((a, b) => a.shadowStart - b.shadowStart);

  if (pugRegions.length === 0) {
    return {
      code: baseTransform.code,
      copySegments: [{
        rewrittenStart: 0,
        rewrittenEnd: baseTransform.code.length,
        baseStart: 0,
        baseEnd: baseTransform.code.length,
      }],
      regionSegments: [],
      mapRewrittenOffsetToBase: (offset: number) => (
        offset >= 0 && offset <= baseTransform.code.length ? offset : null
      ),
      mapBaseOffsetToRewritten: (offset: number) => (
        offset >= 0 && offset <= baseTransform.code.length ? offset : null
      ),
    };
  }

  let code = '';
  let cursor = 0;
  const copySegments: RewrittenCopySegment[] = [];
  const regionSegments: RewrittenRegionSegment[] = [];
  const resolveFormattingContext = createRegionFormattingContextResolver(baseTransform.code, filename);

  for (const region of pugRegions) {
    if (cursor < region.shadowStart) {
      const rewrittenStart = code.length;
      const copied = baseTransform.code.slice(cursor, region.shadowStart);
      code += copied;
      copySegments.push({
        rewrittenStart,
        rewrittenEnd: code.length,
        baseStart: cursor,
        baseEnd: region.shadowStart,
      });
    }

    const rewrittenStart = code.length;
    const originalExpr = baseTransform.code.slice(region.shadowStart, region.shadowEnd);
    const rewritten = rewriteRegion(originalExpr, region, filename);
    code += rewritten.code;
    regionSegments.push({
      rewrittenStart,
      rewrittenEnd: code.length,
      baseStart: region.shadowStart,
      baseEnd: region.shadowEnd,
      boundaryMap: rewritten.boundaryMap,
      syntheticRanges: (rewritten.syntheticRanges ?? []).map(range => ({
        start: rewrittenStart + range.start,
        end: rewrittenStart + range.end,
      })),
      region,
      formattingContext: resolveFormattingContext(region.shadowStart, region.shadowEnd),
    });
    cursor = region.shadowEnd;
  }

  if (cursor < baseTransform.code.length) {
    const rewrittenStart = code.length;
    const copied = baseTransform.code.slice(cursor);
    code += copied;
    copySegments.push({
      rewrittenStart,
      rewrittenEnd: code.length,
      baseStart: cursor,
      baseEnd: baseTransform.code.length,
    });
  }

  const mapRewrittenOffsetToBase = (offset: number): number | null => {
    const clamped = Math.max(0, Math.min(offset, code.length));

    for (const region of regionSegments) {
      if (clamped < region.rewrittenStart || clamped > region.rewrittenEnd) continue;
      const localOffset = clamped - region.rewrittenStart;
      const mappedLocal = region.boundaryMap[Math.min(localOffset, region.boundaryMap.length - 1)] ?? 0;
      return region.baseStart + mappedLocal;
    }

    for (const segment of copySegments) {
      if (clamped < segment.rewrittenStart || clamped > segment.rewrittenEnd) continue;
      return segment.baseStart + (clamped - segment.rewrittenStart);
    }

    return null;
  };

  const mapBaseOffsetToRewritten = (offset: number): number | null => {
    const clamped = Math.max(0, Math.min(offset, baseTransform.code.length));

    for (const region of regionSegments) {
      if (clamped < region.baseStart || clamped > region.baseEnd) continue;
      const localOffset = clamped - region.baseStart;

      for (let i = 0; i < region.boundaryMap.length; i += 1) {
        if (region.boundaryMap[i] >= localOffset) {
          return region.rewrittenStart + i;
        }
      }

      return region.rewrittenEnd;
    }

    for (const segment of copySegments) {
      if (clamped < segment.baseStart || clamped > segment.baseEnd) continue;
      return segment.rewrittenStart + (clamped - segment.baseStart);
    }

    return null;
  };

  return {
    code,
    copySegments,
    regionSegments,
    mapRewrittenOffsetToBase,
    mapBaseOffsetToRewritten,
  };
}

export function rewriteSegmentedPugRegions(
  input: SegmentedPugRegionsInput,
  filename: string,
  rewriteRegion: (expr: string, region: RewrittenRegionSegment, filename: string) => BoundaryMappedExpression,
): RewrittenPugRegionsResult {
  const pugRegions = input.regionSegments
    .slice()
    .sort((a, b) => a.rewrittenStart - b.rewrittenStart);

  if (pugRegions.length === 0) {
    return {
      code: input.code,
      copySegments: [{
        rewrittenStart: 0,
        rewrittenEnd: input.code.length,
        baseStart: 0,
        baseEnd: input.code.length,
      }],
      regionSegments: [],
      mapRewrittenOffsetToBase: (offset: number) => (
        offset >= 0 && offset <= input.code.length ? offset : null
      ),
      mapBaseOffsetToRewritten: (offset: number) => (
        offset >= 0 && offset <= input.code.length ? offset : null
      ),
    };
  }

  let code = '';
  let cursor = 0;
  const copySegments: RewrittenCopySegment[] = [];
  const regionSegments: RewrittenRegionSegment[] = [];

  for (const region of pugRegions) {
    if (cursor < region.rewrittenStart) {
      const rewrittenStart = code.length;
      const copied = input.code.slice(cursor, region.rewrittenStart);
      code += copied;
      copySegments.push({
        rewrittenStart,
        rewrittenEnd: code.length,
        baseStart: cursor,
        baseEnd: region.rewrittenStart,
      });
    }

    const rewrittenStart = code.length;
    const originalExpr = input.code.slice(region.rewrittenStart, region.rewrittenEnd);
    const rewritten = rewriteRegion(originalExpr, region, filename);
    code += rewritten.code;
    regionSegments.push({
      rewrittenStart,
      rewrittenEnd: code.length,
      baseStart: region.rewrittenStart,
      baseEnd: region.rewrittenEnd,
      boundaryMap: rewritten.boundaryMap,
      syntheticRanges: (rewritten.syntheticRanges ?? []).map(range => ({
        start: rewrittenStart + range.start,
        end: rewrittenStart + range.end,
      })),
      region: region.region,
      formattingContext: region.formattingContext,
    });
    cursor = region.rewrittenEnd;
  }

  if (cursor < input.code.length) {
    const rewrittenStart = code.length;
    const copied = input.code.slice(cursor);
    code += copied;
    copySegments.push({
      rewrittenStart,
      rewrittenEnd: code.length,
      baseStart: cursor,
      baseEnd: input.code.length,
    });
  }

  const mapRewrittenOffsetToBase = (offset: number): number | null => {
    const clamped = Math.max(0, Math.min(offset, code.length));

    for (const region of regionSegments) {
      if (clamped < region.rewrittenStart || clamped > region.rewrittenEnd) continue;
      const localOffset = clamped - region.rewrittenStart;
      const mappedLocal = region.boundaryMap[Math.min(localOffset, region.boundaryMap.length - 1)] ?? 0;
      return region.baseStart + mappedLocal;
    }

    for (const segment of copySegments) {
      if (clamped < segment.rewrittenStart || clamped > segment.rewrittenEnd) continue;
      return segment.baseStart + (clamped - segment.rewrittenStart);
    }

    return null;
  };

  const mapBaseOffsetToRewritten = (offset: number): number | null => {
    const clamped = Math.max(0, Math.min(offset, input.code.length));

    for (const region of regionSegments) {
      if (clamped < region.baseStart || clamped > region.baseEnd) continue;
      const localOffset = clamped - region.baseStart;

      for (let i = 0; i < region.boundaryMap.length; i += 1) {
        if (region.boundaryMap[i] >= localOffset) {
          return region.rewrittenStart + i;
        }
      }

      return region.rewrittenEnd;
    }

    for (const segment of copySegments) {
      if (clamped < segment.baseStart || clamped > segment.baseEnd) continue;
      return segment.rewrittenStart + (clamped - segment.baseStart);
    }

    return null;
  };

  return {
    code,
    copySegments,
    regionSegments,
    mapRewrittenOffsetToBase,
    mapBaseOffsetToRewritten,
  };
}

interface MappedInsertionRangesInput {
  baseTransform: SourceTransformResult;
  mapBaseOffsetToRewritten: (offset: number) => number | null;
}

export function collectMappedInsertionRangesByKind(
  input: MappedInsertionRangesInput,
  kind: ShadowInsertion['kind'],
): InsertionOffsetRange[] {
  const ranges: InsertionOffsetRange[] = [];

  for (const insertion of input.baseTransform.document.insertions) {
    if (insertion.kind !== kind) continue;
    const start = input.mapBaseOffsetToRewritten(insertion.shadowStart);
    const end = input.mapBaseOffsetToRewritten(insertion.shadowEnd);
    if (start == null || end == null) continue;
    ranges.push({ start, end });
  }

  return ranges;
}

function mapEmbeddedJsLintSitesToOriginal(baseTransform: SourceTransformResult): MappedEmbeddedJsLintSite[] {
  const sites: MappedEmbeddedJsLintSite[] = [];

  for (const region of baseTransform.regions) {
    for (const site of region.embeddedJsLintSites) {
      const boundaryMap = site.boundaryMap.map((offset) => (
        regionStrippedOffsetToOriginalOffset(baseTransform.document, region, offset)
      ));
      const originalStart = boundaryMap[0] ?? regionStrippedOffsetToOriginalOffset(
        baseTransform.document,
        region,
        site.sourceStart,
      );
      const originalEnd = boundaryMap[boundaryMap.length - 1] ?? regionStrippedOffsetToOriginalOffset(
        baseTransform.document,
        region,
        site.sourceEnd,
      );

      sites.push({
        kind: site.kind,
        originalStart,
        originalEnd,
        code: site.code,
        boundaryMap,
      });
    }
  }

  return sites;
}

export function createLintTransform(
  sourceText: string,
  fileName: string,
  options: SourceTransformOptions = {},
): LintTransformResult {
  const baseTransform = transformSourceFile(sourceText, fileName, {
    ...options,
    compileMode: 'runtime',
  });
  const rewritten = rewriteMappedPugRegions(baseTransform, fileName, (expr, _region, currentFileName) => (
    normalizePugExpressionForLint(expr, currentFileName)
  ));
  const embeddedJsLintSites = mapEmbeddedJsLintSitesToOriginal(baseTransform);

  return {
    ...rewritten,
    baseTransform,
    embeddedJsLintSites,
    mapGeneratedOffsetToOriginal: (offset: number) => {
      const baseOffset = rewritten.mapRewrittenOffsetToBase(offset);
      return baseOffset == null ? null : baseTransform.mapGeneratedOffsetToOriginal(baseOffset);
    },
    mapBaseOffsetToOriginal: (offset: number) => baseTransform.mapGeneratedOffsetToOriginal(offset),
  };
}
