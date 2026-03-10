import type {
  CodeMapping,
  CodeInformation,
  ExtractedStyleBlock,
  PugParseError,
  PugToken,
  PugTransformError,
  StyleTagLang,
} from './mapping';
import { FULL_FEATURES, CSS_CLASS, SYNTHETIC, VERIFY_ONLY } from './mapping';
import { extractPugRegions } from './extractRegions';

// ── TsxEmitter ──────────────────────────────────────────────────

export class TsxEmitter {
  private tsx = '';
  private mappings: CodeMapping[] = [];
  private offset = 0;

  /** Emit text that maps 1:1 to pug source */
  emitMapped(text: string, pugOffset: number, info: CodeInformation): void {
    this.mappings.push({
      sourceOffsets: [pugOffset],
      generatedOffsets: [this.offset],
      lengths: [text.length],
      data: info,
    });
    this.tsx += text;
    this.offset += text.length;
  }

  /** Emit text that maps with different source/generated lengths */
  emitDerived(
    text: string,
    pugOffset: number,
    pugLength: number,
    info: CodeInformation,
  ): void {
    this.mappings.push({
      sourceOffsets: [pugOffset],
      generatedOffsets: [this.offset],
      lengths: [pugLength],
      generatedLengths: [text.length],
      data: info,
    });
    this.tsx += text;
    this.offset += text.length;
  }

  /** Emit structural TSX with no pug source (unmapped) */
  emitSynthetic(text: string): void {
    this.tsx += text;
    this.offset += text.length;
  }

  getResult(): { tsx: string; mappings: CodeMapping[] } {
    return { tsx: this.tsx, mappings: this.mappings };
  }
}

// ── Pug AST node types (minimal shapes from pug-parser) ─────────

interface PugBlock {
  type: 'Block';
  nodes: PugNode[];
}

interface PugTag {
  type: 'Tag';
  name: string;
  selfClosing: boolean;
  block: PugBlock;
  attrs: PugAttr[];
  attributeBlocks: string[];
  line: number;
  column: number;
}

interface PugAttr {
  name: string;
  val: string | boolean;
  line: number;
  column: number;
  mustEscape: boolean;
}

interface PugText {
  type: 'Text';
  val: string;
  line: number;
  column: number;
}

interface PugCode {
  type: 'Code';
  val: string;
  buffer: boolean;
  mustEscape: boolean;
  isInline: boolean;
  block?: PugBlock | null;
  line: number;
  column: number;
}

interface PugConditional {
  type: 'Conditional';
  test: string;
  consequent: PugBlock;
  alternate: PugBlock | PugConditional | null;
  line: number;
  column: number;
}

interface PugEach {
  type: 'Each';
  val: string;
  key: string | null;
  obj: string;
  block: PugBlock;
  alternate?: PugBlock | null;
  line: number;
  column: number;
}

interface PugWhile {
  type: 'While';
  test: string;
  block: PugBlock;
  line: number;
  column: number;
}

interface PugCase {
  type: 'Case';
  expr: string;
  block: PugBlock;
  line: number;
  column: number;
}

interface PugWhen {
  type: 'When';
  expr: string;
  block: PugBlock;
  line: number;
  column: number;
}

interface PugComment {
  type: 'Comment' | 'BlockComment';
  val: string;
  block?: PugBlock;
  line: number;
  column: number;
}

type PugNode =
  | PugTag
  | PugText
  | PugCode
  | PugConditional
  | PugEach
  | PugWhile
  | PugCase
  | PugWhen
  | PugComment;

// ── Helpers ─────────────────────────────────────────────────────

/** Create a parse-recovery variant of pug text for typing-in-progress scenarios. */
function buildTypingRecoveryText(text: string): string {
  const lines = text.split('\n');
  let changed = false;

  const recovered = lines.map((line) => {
    let next = line;

    // Keep unbuffered code lines parseable while user is still typing.
    if (/^\s*-\s*$/.test(next)) {
      next += ' undefined';
      changed = true;
    }

    // Keep `tag=` lines parseable while value is still empty.
    if (/^\s*[A-Za-z][\w:-]*(?:[.#][A-Za-z_][\w-]*)*\s*=\s*$/.test(next)) {
      next += ' undefined';
      changed = true;
    }

    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    let openParen = 0;
    let closeParen = 0;
    let openInterp = 0;
    let closeBrace = 0;

    for (let i = 0; i < next.length; i++) {
      const ch = next[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (!inDouble && ch === '\'') {
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && ch === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (inSingle || inDouble) continue;

      if (ch === '(') openParen++;
      else if (ch === ')') closeParen++;

      if ((ch === '#' || ch === '!') && next[i + 1] === '{') {
        openInterp++;
      } else if (ch === '}') {
        closeBrace++;
      }
    }

    const missingParens = Math.max(0, openParen - closeParen);
    if (missingParens > 0) {
      next += ')'.repeat(missingParens);
      changed = true;
    }

    const missingInterpBraces = Math.max(0, openInterp - closeBrace);
    if (missingInterpBraces > 0) {
      next += '}'.repeat(missingInterpBraces);
      changed = true;
    }

    return next;
  });

  return changed ? recovered.join('\n') : text;
}

/** Convert pug line/column (1-based) to offset in the pug text */
function lineColToOffset(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for \n
  }
  return offset + (column - 1);
}

/** Find a whole-word occurrence in `lineText` starting at `fromIndex` (0-based). */
function findWordIndex(lineText: string, word: string, fromIndex: number): number {
  if (!word) return -1;
  let searchFrom = Math.max(0, fromIndex);
  while (searchFrom < lineText.length) {
    const idx = lineText.indexOf(word, searchFrom);
    if (idx < 0) return -1;
    const before = idx > 0 ? lineText[idx - 1] : '';
    const after = idx + word.length < lineText.length ? lineText[idx + word.length] : '';
    const isWordChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
    if (!isWordChar(before) && !isWordChar(after)) return idx;
    searchFrom = idx + 1;
  }
  return -1;
}

/** Resolve an expression offset by searching for the expression value on its source line. */
function findValueOffsetOnLine(
  pugText: string,
  line: number,
  column: number,
  value: string,
  fallbackOffset: number,
): number {
  if (!value) return fallbackOffset;
  const lineText = pugText.split('\n')[line - 1] ?? '';
  const lineStart = lineColToOffset(pugText, line, 1);
  const fromIndex = Math.max(0, column - 1);
  const idx = lineText.indexOf(value, fromIndex);
  if (idx >= 0) return lineStart + idx;
  return fallbackOffset;
}

interface JsTemplateInterpolation {
  marker: string;
  start: number;
  end: number;
  exprStart: number;
  exprEnd: number;
  expression: string;
}

interface InterpolationContext {
  interpolations: JsTemplateInterpolation[];
}

const interpolationContextStack: InterpolationContext[] = [];
interface CompileContext {
  mode: CompileMode;
  classAttribute: ClassAttributeName;
  classMerge: ClassMergeMode;
  componentPathFromUppercaseClassShorthand: boolean;
}
const compileContextStack: CompileContext[] = [];

function currentInterpolationContext(): InterpolationContext | null {
  return interpolationContextStack.length > 0
    ? interpolationContextStack[interpolationContextStack.length - 1]
    : null;
}

function currentCompileMode(): CompileMode {
  return compileContextStack.length > 0
    ? compileContextStack[compileContextStack.length - 1].mode
    : 'languageService';
}

function currentClassAttribute(): ClassAttributeName {
  return compileContextStack.length > 0
    ? compileContextStack[compileContextStack.length - 1].classAttribute
    : 'className';
}

function currentClassMerge(): ClassMergeMode {
  return compileContextStack.length > 0
    ? compileContextStack[compileContextStack.length - 1].classMerge
    : 'concatenate';
}

function currentComponentPathFromUppercaseClassShorthand(): boolean {
  return compileContextStack.length > 0
    ? compileContextStack[compileContextStack.length - 1].componentPathFromUppercaseClassShorthand
    : true;
}

function createInterpolationMarker(index: number, length: number): string {
  const seed = `_${index.toString(36)}_`;
  if (seed.length === length) return seed;
  if (seed.length < length) return seed + '_'.repeat(length - seed.length);
  const middleLength = Math.max(1, length - 2);
  const middle = index.toString(36).slice(0, middleLength).padEnd(middleLength, '_');
  return (`_${middle}_`).slice(0, length);
}

function findInterpolationEnd(text: string, exprStart: number): number | null {
  let i = exprStart;
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '\'') {
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    }

    if (inTemplate) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '`') {
        inTemplate = false;
      } else if (ch === '$' && next === '{') {
        depth += 1;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '\'') {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
      continue;
    }
    i += 1;
  }

  return null;
}

function prepareTemplateInterpolations(text: string): {
  sanitizedText: string;
  context: InterpolationContext;
} {
  const interpolations: JsTemplateInterpolation[] = [];
  let out = '';
  let cursor = 0;
  let markerIndex = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '$' || text[i + 1] !== '{') continue;

    const start = i;
    const end = findInterpolationEnd(text, i + 2);
    if (end == null) continue;

    const exprStart = start + 2;
    const exprEnd = end;
    const totalLength = end - start + 1;
    const marker = createInterpolationMarker(markerIndex, totalLength);
    markerIndex += 1;

    interpolations.push({
      marker,
      start,
      end,
      exprStart,
      exprEnd,
      expression: text.slice(exprStart, exprEnd),
    });

    out += text.slice(cursor, start);
    out += marker;
    cursor = end + 1;
    i = end;
  }

  out += text.slice(cursor);
  return {
    sanitizedText: out,
    context: { interpolations },
  };
}

function findNextInterpolationOccurrence(
  text: string,
  from: number,
  context: InterpolationContext | null,
): { index: number; interpolation: JsTemplateInterpolation } | null {
  if (!context || context.interpolations.length === 0) return null;

  let bestIdx = -1;
  let bestInterpolation: JsTemplateInterpolation | null = null;
  for (const interpolation of context.interpolations) {
    const idx = text.indexOf(interpolation.marker, from);
    if (idx < 0) continue;
    if (bestIdx < 0 || idx < bestIdx) {
      bestIdx = idx;
      bestInterpolation = interpolation;
    }
  }

  if (bestIdx < 0 || bestInterpolation == null) return null;
  return { index: bestIdx, interpolation: bestInterpolation };
}

function strippedToRawOffset(rawText: string, strippedOffset: number, commonIndent: number): number {
  if (commonIndent === 0) return strippedOffset;
  let stripped = 0;
  let raw = 0;
  const lines = rawText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indentToRemove = line.trim().length === 0 ? line.length : commonIndent;
    const strippedLineLen = Math.max(0, line.length - indentToRemove);
    if (strippedOffset <= stripped + strippedLineLen) {
      const colInStripped = strippedOffset - stripped;
      return raw + indentToRemove + colInStripped;
    }
    stripped += strippedLineLen + 1;
    raw += line.length + 1;
  }
  return raw;
}

function countIndent(line: string): number {
  return line.match(/^(\s*)/)?.[1].length ?? 0;
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function stripCommonIndent(text: string): { stripped: string; indent: number } {
  const lines = text.split('\n');
  let minIndent = Infinity;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = countIndent(line);
    if (indent < minIndent) minIndent = indent;
  }

  if (minIndent === Infinity || minIndent === 0) {
    return { stripped: text, indent: 0 };
  }

  return {
    stripped: lines
      .map((line) => (line.trim().length === 0 ? '' : line.slice(minIndent)))
      .join('\n'),
    indent: minIndent,
  };
}

function matchStyleTagLine(line: string): { attrText: string | null } | null {
  const match = line.match(/^style(?:\((.*)\))?\s*$/);
  if (!match) return null;
  return { attrText: match[1] ?? null };
}

function parseStyleLang(
  attrText: string | null,
  line: number,
  column: number,
  offset: number,
): { lang: StyleTagLang | null; error: PugTransformError | null } {
  if (attrText == null || attrText.trim().length === 0) {
    return { lang: 'css', error: null };
  }

  const attrMatch = attrText.match(/^\s*lang\s*=\s*(['"])([^'"]+)\1\s*$/);
  if (!attrMatch) {
    return {
      lang: null,
      error: {
        code: 'invalid-style-attrs',
        message: 'style tag only supports a single lang attribute',
        line,
        column,
        offset,
      },
    };
  }

  const lang = attrMatch[2];
  if (lang === 'css' || lang === 'styl' || lang === 'sass' || lang === 'scss') {
    return { lang, error: null };
  }

  return {
    lang: null,
    error: {
      code: 'unsupported-style-lang',
      message: `Unsupported style lang "${lang}". Expected css, styl, sass, or scss`,
      line,
      column,
      offset,
    },
  };
}

function extractTerminalStyleBlock(pugText: string): {
  pugTextWithoutStyle: string;
  styleBlock: ExtractedStyleBlock | null;
  transformError: PugTransformError | null;
} {
  if (!pugText.includes('style')) {
    return {
      pugTextWithoutStyle: pugText,
      styleBlock: null,
      transformError: null,
    };
  }

  const lines = pugText.split('\n');
  const lineStarts: number[] = [];
  let runningOffset = 0;
  for (const line of lines) {
    lineStarts.push(runningOffset);
    runningOffset += line.length + 1;
  }

  const topLevelIndices: number[] = [];
  let styleIndex = -1;
  let styleAttrs: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isBlankLine(line)) continue;
    if (countIndent(line) !== 0) continue;
    topLevelIndices.push(i);

    const matched = matchStyleTagLine(line.trim());
    if (matched) {
      if (styleIndex >= 0) {
        return {
          pugTextWithoutStyle: pugText,
          styleBlock: null,
          transformError: {
            code: 'style-tag-must-be-last',
            message: 'style tag may appear at most once and must be the last top-level node',
            line: i + 1,
            column: 1,
            offset: lineStarts[i],
          },
        };
      }
      styleIndex = i;
      styleAttrs = matched.attrText;
    }
  }

  if (styleIndex < 0) {
    return {
      pugTextWithoutStyle: pugText,
      styleBlock: null,
      transformError: null,
    };
  }

  const lastTopLevelIndex = topLevelIndices[topLevelIndices.length - 1] ?? -1;
  if (styleIndex !== lastTopLevelIndex) {
    return {
      pugTextWithoutStyle: pugText,
      styleBlock: null,
      transformError: {
        code: 'style-tag-must-be-last',
        message: 'style tag must be the last top-level node in a pug template',
        line: styleIndex + 1,
        column: 1,
        offset: lineStarts[styleIndex],
      },
    };
  }

  const line = lines[styleIndex];
  const styleColumn = countIndent(line) + 1;
  const styleOffset = lineStarts[styleIndex] + countIndent(line);
  const parsedLang = parseStyleLang(styleAttrs, styleIndex + 1, styleColumn, styleOffset);
  if (parsedLang.error) {
    return {
      pugTextWithoutStyle: pugText,
      styleBlock: null,
      transformError: parsedLang.error,
    };
  }

  const bodyLines = lines.slice(styleIndex + 1);
  const bodyText = bodyLines.join('\n');
  const strippedBody = stripCommonIndent(bodyText);
  const bodyOffset = styleIndex + 1 < lineStarts.length ? lineStarts[styleIndex + 1] : lineStarts[styleIndex] + line.length;
  const bodyEndOffset = pugText.length;

  const prefixLines = lines.slice(0, styleIndex);
  let pugTextWithoutStyle = prefixLines.join('\n');
  if (pugTextWithoutStyle.length > 0 && pugText.endsWith('\n')) {
    pugTextWithoutStyle += '\n';
  }

  return {
    pugTextWithoutStyle,
    styleBlock: {
      lang: parsedLang.lang!,
      content: strippedBody.stripped,
      tagOffset: styleOffset,
      contentStart: bodyOffset,
      contentEnd: bodyEndOffset,
      commonIndent: strippedBody.indent,
      line: styleIndex + 1,
      column: styleColumn,
    },
    transformError: null,
  };
}

function emitCompiledPugRegionInExpression(
  expression: string,
  expressionOffset: number,
  region: {
    originalStart: number;
    originalEnd: number;
    pugTextStart: number;
    pugTextEnd: number;
    commonIndent: number;
  },
  compiled: CompileResult,
  emitter: TsxEmitter,
): void {
  if (compiled.mappings.length === 0) {
    emitter.emitSynthetic(compiled.tsx);
    return;
  }

  const rawText = expression.slice(region.pugTextStart, region.pugTextEnd);
  const segments: Array<{
    generatedStart: number;
    generatedLength: number;
    sourceStart: number;
    sourceLength: number;
    info: CodeInformation;
  }> = [];

  for (const mapping of compiled.mappings) {
    const sourceOffsets = mapping.sourceOffsets ?? [];
    const generatedOffsets = mapping.generatedOffsets ?? [];
    const lengths = mapping.lengths ?? [];
    const generatedLengths = mapping.generatedLengths ?? [];
    const segmentCount = Math.min(sourceOffsets.length, generatedOffsets.length, lengths.length);
    for (let i = 0; i < segmentCount; i += 1) {
      segments.push({
        generatedStart: generatedOffsets[i],
        generatedLength: generatedLengths[i] ?? lengths[i],
        sourceStart: sourceOffsets[i],
        sourceLength: lengths[i],
        info: mapping.data,
      });
    }
  }

  segments.sort((a, b) => a.generatedStart - b.generatedStart);

  let cursor = 0;
  for (const segment of segments) {
    if (segment.generatedStart > cursor) {
      emitter.emitSynthetic(compiled.tsx.slice(cursor, segment.generatedStart));
    }

    const chunk = compiled.tsx.slice(
      segment.generatedStart,
      segment.generatedStart + segment.generatedLength,
    );
    const rawOffset = strippedToRawOffset(rawText, segment.sourceStart, region.commonIndent);
    const sourceOffset = expressionOffset + region.pugTextStart + rawOffset;
    if (segment.generatedLength === segment.sourceLength) {
      emitter.emitMapped(chunk, sourceOffset, segment.info);
    } else {
      emitter.emitDerived(chunk, sourceOffset, segment.sourceLength, segment.info);
    }
    cursor = segment.generatedStart + segment.generatedLength;
  }

  if (cursor < compiled.tsx.length) {
    emitter.emitSynthetic(compiled.tsx.slice(cursor));
  }
}

function emitJsExpressionWithNestedPug(
  expression: string,
  expressionOffset: number,
  emitter: TsxEmitter,
  info: CodeInformation = FULL_FEATURES,
): void {
  if (!expression.includes('pug`') && !expression.includes('pug `')) {
    emitter.emitMapped(expression, expressionOffset, info);
    return;
  }

  const regions = extractPugRegions(expression, 'inline-expression.tsx', 'pug');
  if (regions.length === 0) {
    emitter.emitMapped(expression, expressionOffset, info);
    return;
  }

  let cursor = 0;
  for (const region of regions) {
    if (region.originalStart > cursor) {
      const plain = expression.slice(cursor, region.originalStart);
      emitJsExpressionWithNestedPug(plain, expressionOffset + cursor, emitter, info);
    }

    const compiled = compilePugToTsx(region.pugText, {
      mode: currentCompileMode(),
      classAttribute: currentClassAttribute(),
      classMerge: currentClassMerge(),
    });
    emitCompiledPugRegionInExpression(expression, expressionOffset, region, compiled, emitter);
    cursor = region.originalEnd;
  }

  if (cursor < expression.length) {
    const tail = expression.slice(cursor);
    emitJsExpressionWithNestedPug(tail, expressionOffset + cursor, emitter, info);
  }
}

function emitExpressionWithTemplateInterpolations(
  expression: string,
  expressionOffset: number,
  emitter: TsxEmitter,
  info: CodeInformation = FULL_FEATURES,
): void {
  const context = currentInterpolationContext();
  let cursor = 0;

  while (cursor < expression.length) {
    const hit = findNextInterpolationOccurrence(expression, cursor, context);
    if (!hit) {
      emitJsExpressionWithNestedPug(
        expression.slice(cursor),
        expressionOffset + cursor,
        emitter,
        info,
      );
      break;
    }

    if (hit.index > cursor) {
      emitJsExpressionWithNestedPug(
        expression.slice(cursor, hit.index),
        expressionOffset + cursor,
        emitter,
        info,
      );
    }

    const interpolation = hit.interpolation;
    if (interpolation.expression.trim().length === 0) {
      emitter.emitSynthetic('undefined');
    } else {
      emitJsExpressionWithNestedPug(interpolation.expression, interpolation.exprStart, emitter, info);
    }
    cursor = hit.index + interpolation.marker.length;
  }
}

/** HTML void elements that should self-close */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ── AST Walking ─────────────────────────────────────────────────

function emitNodes(
  nodes: PugNode[],
  emitter: TsxEmitter,
  pugText: string,
): void {
  // If there are unbuffered code blocks mixed with JSX, use IIFE
  const hasUnbufferedCode = nodes.some(isUnbufferedCode);
  if (hasUnbufferedCode) {
    emitBlockWithCodeSupport(nodes, emitter, pugText);
    return;
  }

  // Multiple sibling nodes that produce JSX need fragment wrapping
  const jsxNodes = nodes.filter(
    n => n.type === 'Tag' || (n.type === 'Code' && n.buffer) || n.type === 'Conditional'
      || n.type === 'Each' || n.type === 'While' || n.type === 'Case',
  );
  const needsFragment = jsxNodes.length > 1;

  if (needsFragment) emitter.emitSynthetic('<>');

  for (const node of nodes) {
    emitNode(node, emitter, pugText);
  }

  if (needsFragment) emitter.emitSynthetic('</>');
}

function emitNode(
  node: PugNode,
  emitter: TsxEmitter,
  pugText: string,
): void {
  switch (node.type) {
    case 'Tag':
      emitTag(node, emitter, pugText);
      break;
    case 'Text':
      emitText(node, emitter, pugText);
      break;
    case 'Code':
      emitCode(node, emitter, pugText);
      break;
    case 'Conditional':
      emitConditional(node, emitter, pugText);
      break;
    case 'Each':
      emitEach(node, emitter, pugText);
      break;
    case 'While':
      emitWhile(node, emitter, pugText);
      break;
    case 'Case':
      emitCase(node, emitter, pugText);
      break;
    case 'When':
      // When nodes are handled inside emitCase
      break;
    case 'Comment':
    case 'BlockComment':
      // Skip comments in TSX output
      break;
  }
}

interface StaticClassShorthand {
  name: string;
  offset: number;
  sourceLength: number;
  nameOffset: number;
}

function emitAttributeValueAsExpression(
  attr: PugAttr,
  emitter: TsxEmitter,
  pugText: string,
): void {
  if (attr.val === true) {
    emitter.emitSynthetic('true');
    return;
  }

  if (typeof attr.val !== 'string') {
    emitter.emitSynthetic('undefined');
    return;
  }

  const attrOffset = lineColToOffset(pugText, attr.line, attr.column);
  const valOffset = attrOffset + attr.name.length + 1;
  const val = attr.val;

  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
    emitter.emitMapped(val, valOffset, FULL_FEATURES);
    return;
  }

  emitExpressionWithTemplateInterpolations(val, valOffset, emitter, FULL_FEATURES);
}

function emitStaticClassLiteral(
  classNames: StaticClassShorthand[],
  emitter: TsxEmitter,
): void {
  const combinedClass = classNames.map((c) => c.name).join(' ');
  if (combinedClass.length === 0) return;
  const first = classNames[0];
  emitter.emitDerived(combinedClass, first.offset, Math.max(1, first.sourceLength), CSS_CLASS);
}

function emitMergedClassShorthandAttribute(
  targetAttr: ClassAttributeName,
  mergeMode: ClassMergeMode,
  classNames: StaticClassShorthand[],
  existingAttr: PugAttr | null,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const emitTargetAttrName = () => {
    emitter.emitSynthetic(' ');
    if (existingAttr) {
      emitter.emitMapped(
        existingAttr.name,
        lineColToOffset(pugText, existingAttr.line, existingAttr.column),
        FULL_FEATURES,
      );
    } else {
      emitter.emitSynthetic(targetAttr);
    }
  };

  if (mergeMode === 'classnames') {
    emitTargetAttrName();
    emitter.emitSynthetic('={[');
    for (let i = 0; i < classNames.length; i += 1) {
      if (i > 0) emitter.emitSynthetic(', ');
      emitter.emitSynthetic('"');
      emitter.emitDerived(
        classNames[i].name,
        classNames[i].offset,
        Math.max(1, classNames[i].sourceLength),
        CSS_CLASS,
      );
      emitter.emitSynthetic('"');
    }

    if (existingAttr) {
      if (classNames.length > 0) emitter.emitSynthetic(', ');
      emitAttributeValueAsExpression(existingAttr, emitter, pugText);
    }
    emitter.emitSynthetic(']}');
    return;
  }

  if (existingAttr) {
    emitTargetAttrName();
    emitter.emitSynthetic('={');
    emitter.emitSynthetic('"');
    emitStaticClassLiteral(classNames, emitter);
    emitter.emitSynthetic('" + " " + (');
    emitAttributeValueAsExpression(existingAttr, emitter, pugText);
    emitter.emitSynthetic(')}');
    return;
  }

  emitTargetAttrName();
  emitter.emitSynthetic('="');
  emitStaticClassLiteral(classNames, emitter);
  emitter.emitSynthetic('"');
}

function emitTag(
  node: PugTag,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const tagOffset = lineColToOffset(pugText, node.line, node.column);

  // Collect class names and id from shorthand attrs
  const classNames: StaticClassShorthand[] = [];
  let idValue: string | null = null;
  const regularAttrs: PugAttr[] = [];

  for (const attr of node.attrs) {
    if (attr.name === 'class' && typeof attr.val === 'string') {
      // Shorthand class: val is like "'card'" (with quotes)
      const raw = attr.val;
      if (raw.startsWith("'") && raw.endsWith("'")) {
        const classOffset = lineColToOffset(pugText, attr.line, attr.column);
        classNames.push({
          name: raw.slice(1, -1),
          offset: classOffset,
          sourceLength: Math.max(1, raw.length),
          nameOffset: classOffset + 1,
        });
      } else if (raw.startsWith('"') && raw.endsWith('"')) {
        const classOffset = lineColToOffset(pugText, attr.line, attr.column);
        classNames.push({
          name: raw.slice(1, -1),
          offset: classOffset,
          sourceLength: Math.max(1, raw.length),
          nameOffset: classOffset + 1,
        });
      } else {
        // Dynamic class expression
        regularAttrs.push(attr);
      }
    } else if (attr.name === 'id' && typeof attr.val === 'string') {
      const raw = attr.val;
      if (raw.startsWith("'") && raw.endsWith("'")) {
        idValue = raw.slice(1, -1);
      } else if (raw.startsWith('"') && raw.endsWith('"')) {
        idValue = raw.slice(1, -1);
      } else {
        regularAttrs.push(attr);
      }
    } else {
      regularAttrs.push(attr);
    }
  }

  const componentPathFromUppercaseClassShorthand = currentComponentPathFromUppercaseClassShorthand();
  const componentPathSegments: StaticClassShorthand[] = [];
  if (componentPathFromUppercaseClassShorthand && /^[A-Z]/.test(node.name)) {
    for (const classShorthand of classNames) {
      if (!/^[A-Z]/.test(classShorthand.name)) break;
      componentPathSegments.push(classShorthand);
    }
    if (componentPathSegments.length > 0) {
      classNames.splice(0, componentPathSegments.length);
    }
  }

  const resolvedTagName = componentPathSegments.length > 0
    ? `${node.name}.${componentPathSegments.map((segment) => segment.name).join('.')}`
    : node.name;

  // Check if tag name is synthetic (implicit div from shorthand)
  const isSyntheticDiv = node.name === 'div' && (classNames.length > 0 || idValue !== null)
    && node.column === (pugText.split('\n')[node.line - 1]?.indexOf('.') ?? -1) + 1;

  // Emit opening tag
  emitter.emitSynthetic('<');
  if (isSyntheticDiv) {
    emitter.emitSynthetic(node.name);
  } else {
    emitter.emitMapped(node.name, tagOffset, FULL_FEATURES);
    for (const segment of componentPathSegments) {
      emitter.emitSynthetic('.');
      emitter.emitDerived(
        segment.name,
        segment.nameOffset,
        Math.max(1, segment.name.length),
        FULL_FEATURES,
      );
    }
  }

  // Emit shorthand classes according to current class strategy.
  if (classNames.length > 0) {
    const targetAttr = currentClassAttribute();
    const mergeMode = currentClassMerge();
    const existingIndex = regularAttrs.findIndex((a) => a.name === targetAttr);
    const existingAttr = existingIndex >= 0 ? regularAttrs.splice(existingIndex, 1)[0] : null;
    emitMergedClassShorthandAttribute(
      targetAttr,
      mergeMode,
      classNames,
      existingAttr,
      emitter,
      pugText,
    );
  }

  // Emit id from shorthand
  if (idValue !== null) {
    emitter.emitSynthetic(' id="');
    emitter.emitSynthetic(idValue);
    emitter.emitSynthetic('"');
  }

  // Emit regular attributes
  for (const attr of regularAttrs) {
    emitAttribute(attr, emitter, pugText);
  }

  // Determine if tag has children
  const children = node.block?.nodes ?? [];
  const hasChildren = children.length > 0;
  const isComponentTag = /^[A-Z]/.test(resolvedTagName);
  const isVoid = !isComponentTag && VOID_ELEMENTS.has(node.name.toLowerCase());

  if (!hasChildren || isVoid) {
    emitter.emitSynthetic(' />');
  } else {
    emitter.emitSynthetic('>');
    emitChildren(children, emitter, pugText);
    emitter.emitSynthetic('</');
    if (isSyntheticDiv) {
      emitter.emitSynthetic(node.name);
    } else {
      emitter.emitSynthetic(resolvedTagName);
    }
    emitter.emitSynthetic('>');
  }
}

function emitAttribute(
  attr: PugAttr,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const attrOffset = lineColToOffset(pugText, attr.line, attr.column);

  // Spread attribute: ...props
  if (attr.name.startsWith('...')) {
    const varName = attr.name.slice(3);
    emitter.emitSynthetic(' {');
    emitter.emitSynthetic('...');
    emitter.emitMapped(varName, attrOffset + 3, FULL_FEATURES);
    emitter.emitSynthetic('}');
    return;
  }

  emitter.emitSynthetic(' ');
  emitter.emitMapped(attr.name, attrOffset, FULL_FEATURES);

  // Boolean attribute: disabled -> disabled={true}
  if (attr.val === true) {
    emitter.emitSynthetic('={true}');
    return;
  }

  // Value attribute: onClick=handler -> onClick={handler}
  if (typeof attr.val === 'string') {
    const val = attr.val;

    // Check if value is a quoted string: "hello" or 'hello'
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      emitter.emitSynthetic('={');
      // Find the value offset: after "name=" in the source
      const valOffset = attrOffset + attr.name.length + 1; // +1 for '='
      emitter.emitMapped(val, valOffset, FULL_FEATURES);
      emitter.emitSynthetic('}');
    } else {
      // Expression value
      emitter.emitSynthetic('={');
      const valOffset = attrOffset + attr.name.length + 1;
      emitExpressionWithTemplateInterpolations(val, valOffset, emitter, FULL_FEATURES);
      emitter.emitSynthetic('}');
    }
  }
}

function emitText(
  node: PugText,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const lineText = pugText.split('\n')[node.line - 1] ?? '';
  const lineStart = lineColToOffset(pugText, node.line, 1);
  const markerIndex = Math.max(0, node.column - 1);
  const valueIndex = lineText.indexOf(node.val, markerIndex);
  const offset = valueIndex >= 0
    ? lineStart + valueIndex
    : lineColToOffset(pugText, node.line, node.column);

  const context = currentInterpolationContext();
  let cursor = 0;
  while (cursor < node.val.length) {
    const hit = findNextInterpolationOccurrence(node.val, cursor, context);
    if (!hit) {
      if (cursor < node.val.length) {
        emitter.emitMapped(node.val.slice(cursor), offset + cursor, SYNTHETIC);
      }
      break;
    }

    if (hit.index > cursor) {
      emitter.emitMapped(node.val.slice(cursor, hit.index), offset + cursor, SYNTHETIC);
    }

    const interpolation = hit.interpolation;
    emitter.emitSynthetic('{');
    if (interpolation.expression.trim().length === 0) {
      emitter.emitSynthetic('undefined');
    } else {
      emitJsExpressionWithNestedPug(interpolation.expression, interpolation.exprStart, emitter);
    }
    emitter.emitSynthetic('}');
    cursor = hit.index + interpolation.marker.length;
  }
}

function emitCode(
  node: PugCode,
  emitter: TsxEmitter,
  pugText: string,
  wrapInJsxBraces: boolean = true,
): void {
  const markerOffset = lineColToOffset(pugText, node.line, node.column);
  const lineText = pugText.split('\n')[node.line - 1] ?? '';
  const markerIndex = Math.max(0, node.column - 1);
  const valueIndex = lineText.indexOf(node.val, markerIndex);
  const fallbackShift = node.buffer ? 2 : 1;
  const valueOffset = valueIndex >= 0
    ? lineColToOffset(pugText, node.line, 1) + valueIndex
    : markerOffset + fallbackShift;

  if (node.buffer && node.isInline) {
    // Inline interpolation: #{expr} -> {expr} in JSX child context, bare expr in JS expression context
    if (wrapInJsxBraces) emitter.emitSynthetic('{');
    emitExpressionWithTemplateInterpolations(node.val, valueOffset, emitter, FULL_FEATURES);
    if (wrapInJsxBraces) emitter.emitSynthetic('}');
  } else if (node.buffer) {
    // Buffered code: = expr -> {expr} in JSX child context, bare expr in JS expression context
    if (wrapInJsxBraces) emitter.emitSynthetic('{');
    emitExpressionWithTemplateInterpolations(node.val, valueOffset, emitter, FULL_FEATURES);
    if (wrapInJsxBraces) emitter.emitSynthetic('}');
  } else {
    // Unbuffered code block: - const x = 10
    // Emitted as a statement; IIFE wrapping is handled by emitNodesWithCodeBlocks
    emitExpressionWithTemplateInterpolations(node.val, valueOffset, emitter, FULL_FEATURES);
    emitter.emitSynthetic(';');
  }
}

function emitChildren(
  nodes: PugNode[],
  emitter: TsxEmitter,
  pugText: string,
): void {
  const hasUnbufferedCode = nodes.some(isUnbufferedCode);
  if (hasUnbufferedCode) {
    emitter.emitSynthetic('{');
    emitBlockWithCodeSupport(nodes, emitter, pugText);
    emitter.emitSynthetic('}');
  } else {
    for (const node of nodes) {
      emitNode(node, emitter, pugText);
    }
  }
}

/** Check if a node is an unbuffered code block */
function isUnbufferedCode(node: PugNode): node is PugCode {
  return node.type === 'Code' && !node.buffer;
}

/** Check if a node produces JSX output */
function isJsxProducing(node: PugNode): boolean {
  return node.type === 'Tag' || node.type === 'Conditional'
    || node.type === 'Each' || node.type === 'While' || node.type === 'Case'
    || (node.type === 'Code' && node.buffer);
}

/**
 * Emit a block of nodes that may contain unbuffered code mixed with JSX.
 * When code blocks are mixed with JSX-producing nodes, wraps in an IIFE:
 *   (() => { code; return (<jsx/>); })()
 */
function emitBlockWithCodeSupport(
  nodes: PugNode[],
  emitter: TsxEmitter,
  pugText: string,
): void {
  const hasUnbufferedCode = nodes.some(isUnbufferedCode);
  const hasJsx = nodes.some(isJsxProducing);

  if (hasUnbufferedCode && hasJsx) {
    // IIFE wrapping: (() => { code; return (<jsx/>); })()
    emitter.emitSynthetic('(() => {');

    // Emit all unbuffered code as statements
    for (const node of nodes) {
      if (isUnbufferedCode(node)) {
        emitNode(node, emitter, pugText);
      }
    }

    // Emit JSX-producing nodes as the return value
    const jsxNodes = nodes.filter(n => !isUnbufferedCode(n));
    emitter.emitSynthetic('return (');
    if (jsxNodes.length === 0) {
      emitter.emitSynthetic('null');
    } else if (jsxNodes.length === 1) {
      emitNode(jsxNodes[0], emitter, pugText);
    } else {
      emitter.emitSynthetic('<>');
      for (const node of jsxNodes) {
        emitNode(node, emitter, pugText);
      }
      emitter.emitSynthetic('</>');
    }
    emitter.emitSynthetic(');})()');
  } else if (hasUnbufferedCode) {
    // Only code, no JSX -- emit as IIFE returning null
    emitter.emitSynthetic('(() => {');
    for (const node of nodes) {
      emitNode(node, emitter, pugText);
    }
    emitter.emitSynthetic('return null;})()');
  } else {
    // No unbuffered code -- emit normally
    emitNodes(nodes, emitter, pugText);
  }
}

/** Emit a single node as a JS expression (no JSX-child wrapping braces). */
function emitNodeAsExpression(
  node: PugNode,
  emitter: TsxEmitter,
  pugText: string,
): void {
  switch (node.type) {
    case 'Tag':
      emitTag(node, emitter, pugText);
      break;
    case 'Text':
      emitter.emitSynthetic(JSON.stringify(node.val));
      break;
    case 'Code':
      emitCode(node, emitter, pugText, false);
      break;
    case 'Conditional':
      emitConditional(node, emitter, pugText, false);
      break;
    case 'Each':
      emitEach(node, emitter, pugText, false);
      break;
    case 'While':
      emitWhile(node, emitter, pugText, false);
      break;
    case 'Case':
      emitCase(node, emitter, pugText, false);
      break;
    case 'When':
    case 'Comment':
    case 'BlockComment':
      emitter.emitSynthetic('null');
      break;
  }
}

/** Emit a block where the caller expects a JS expression result. */
function emitBlockAsExpression(
  nodes: PugNode[],
  emitter: TsxEmitter,
  pugText: string,
): void {
  const hasUnbufferedCode = nodes.some(isUnbufferedCode);

  if (hasUnbufferedCode) {
    emitter.emitSynthetic('(() => {');
    for (const node of nodes) {
      if (isUnbufferedCode(node)) emitNode(node, emitter, pugText);
    }

    const exprNodes = nodes.filter((n) => !isUnbufferedCode(n));
    emitter.emitSynthetic('return ');
    if (exprNodes.length === 0) {
      emitter.emitSynthetic('null');
    } else if (exprNodes.length === 1) {
      emitNodeAsExpression(exprNodes[0], emitter, pugText);
    } else {
      emitter.emitSynthetic('(<>' );
      for (const node of exprNodes) {
        emitNode(node, emitter, pugText);
      }
      emitter.emitSynthetic('</>)');
    }
    emitter.emitSynthetic(';})()');
    return;
  }

  if (nodes.length === 0) {
    emitter.emitSynthetic('null');
  } else if (nodes.length === 1) {
    emitNodeAsExpression(nodes[0], emitter, pugText);
  } else {
    emitter.emitSynthetic('<>');
    for (const node of nodes) emitNode(node, emitter, pugText);
    emitter.emitSynthetic('</>');
  }
}

// ── Control flow emitters ──────────────────────────────────────

/** if show -> show ? <consequent> : <alternate> */
function emitConditional(
  node: PugConditional,
  emitter: TsxEmitter,
  pugText: string,
  wrapInJsxBraces: boolean = true,
): void {
  const testOffset = lineColToOffset(pugText, node.line, node.column);
  const exprOffset = findValueOffsetOnLine(
    pugText,
    node.line,
    node.column,
    node.test,
    testOffset + 3,
  );

  if (wrapInJsxBraces) emitter.emitSynthetic('{');
  emitExpressionWithTemplateInterpolations(node.test, exprOffset, emitter, FULL_FEATURES);
  emitter.emitSynthetic(' ? ');

  // Consequent block
  const consequentNodes = node.consequent?.nodes ?? [];
  emitBlockAsExpression(consequentNodes, emitter, pugText);

  emitter.emitSynthetic(' : ');

  // Alternate: can be another Conditional (else if) or a Block (else) or null
  if (node.alternate == null) {
    emitter.emitSynthetic('null');
  } else if (node.alternate.type === 'Conditional') {
    // Chained: else if -> nested ternary (without wrapping braces)
    emitConditionalInner(node.alternate, emitter, pugText);
  } else {
    // else block
    const altNodes = (node.alternate as PugBlock).nodes ?? [];
    emitBlockAsExpression(altNodes, emitter, pugText);
  }

  if (wrapInJsxBraces) emitter.emitSynthetic('}');
}

/** Inner conditional for chained else-if (no wrapping {} braces) */
function emitConditionalInner(
  node: PugConditional,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const testOffset = lineColToOffset(pugText, node.line, node.column);
  const exprOffset = findValueOffsetOnLine(
    pugText,
    node.line,
    node.column,
    node.test,
    testOffset + 8,
  );

  emitExpressionWithTemplateInterpolations(node.test, exprOffset, emitter, FULL_FEATURES);
  emitter.emitSynthetic(' ? ');

  const consequentNodes = node.consequent?.nodes ?? [];
  emitBlockAsExpression(consequentNodes, emitter, pugText);

  emitter.emitSynthetic(' : ');

  if (node.alternate == null) {
    emitter.emitSynthetic('null');
  } else if (node.alternate.type === 'Conditional') {
    emitConditionalInner(node.alternate, emitter, pugText);
  } else {
    const altNodes = (node.alternate as PugBlock).nodes ?? [];
    emitBlockAsExpression(altNodes, emitter, pugText);
  }
}

function createNonConflictingName(base: string, disallowed: Set<string>): string {
  if (!disallowed.has(base)) return base;
  let suffix = 1;
  while (disallowed.has(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

/** each item, i in items -> {(() => { const __r = []; ... for (const item of items) ... })()} */
function emitEach(
  node: PugEach,
  emitter: TsxEmitter,
  pugText: string,
  wrapInJsxBraces: boolean = true,
): void {
  const pugLine = pugText.split('\n')[node.line - 1] ?? '';
  const lineStart = lineColToOffset(pugText, node.line, 1);
  const nodeStart = Math.max(0, node.column - 1);
  const valIndex = pugLine.indexOf(node.val, nodeStart);
  const valOffset = valIndex >= 0
    ? lineStart + valIndex
    : lineColToOffset(pugText, node.line, node.column) + 5;

  const keyIndex = node.key != null && valIndex >= 0
    ? pugLine.indexOf(node.key, valIndex + node.val.length)
    : -1;
  const keyOffset = keyIndex >= 0
    ? lineStart + keyIndex
    : (node.key != null
      ? findValueOffsetOnLine(
        pugText,
        node.line,
        node.column,
        node.key,
        lineStart + Math.max(0, pugLine.indexOf(node.key)),
      )
      : -1);

  const inSearchStart = keyIndex >= 0
    ? keyIndex + (node.key?.length ?? 0)
    : (valIndex >= 0 ? valIndex + node.val.length : nodeStart);
  const inIndex = findWordIndex(pugLine, 'in', inSearchStart);
  const objIndex = inIndex >= 0
    ? pugLine.indexOf(node.obj, inIndex + 2)
    : -1;
  const objOffset = objIndex >= 0
    ? lineStart + objIndex
    : findValueOffsetOnLine(
      pugText,
      node.line,
      node.column,
      node.obj,
      lineStart + Math.max(0, pugLine.indexOf(node.obj)),
    );

  const bodyNodes = node.block?.nodes ?? [];
  const elseNodes = node.alternate?.nodes ?? null;

  const disallowedNames = new Set<string>([node.val]);
  if (node.key != null) disallowedNames.add(node.key);
  const resultVar = createNonConflictingName('__pugEachResult', disallowedNames);
  disallowedNames.add(resultVar);
  const indexVar = node.key != null
    ? createNonConflictingName('__pugEachIndex', disallowedNames)
    : null;

  if (wrapInJsxBraces) emitter.emitSynthetic('{');
  emitter.emitSynthetic('(() => {');
  if (currentCompileMode() === 'runtime') {
    emitter.emitSynthetic(`const ${resultVar} = [];`);
  } else {
    emitter.emitSynthetic(`const ${resultVar}: JSX.Element[] = [];`);
  }
  if (indexVar != null) emitter.emitSynthetic(`let ${indexVar} = 0;`);
  emitter.emitSynthetic('for (const ');
  emitExpressionWithTemplateInterpolations(node.val, valOffset, emitter, FULL_FEATURES);
  emitter.emitSynthetic(' of ');
  emitExpressionWithTemplateInterpolations(node.obj, objOffset, emitter, FULL_FEATURES);
  emitter.emitSynthetic(') {');
  if (node.key != null && indexVar != null) {
    emitter.emitSynthetic('const ');
    emitExpressionWithTemplateInterpolations(node.key, keyOffset, emitter, FULL_FEATURES);
    emitter.emitSynthetic(` = ${indexVar};`);
  }
  emitter.emitSynthetic(`${resultVar}.push(`);

  emitBlockAsExpression(bodyNodes, emitter, pugText);

  emitter.emitSynthetic(');');
  if (indexVar != null) emitter.emitSynthetic(`${indexVar}++;`);
  emitter.emitSynthetic('}');
  if (elseNodes != null) {
    emitter.emitSynthetic(`return ${resultVar}.length ? ${resultVar} : `);
    emitBlockAsExpression(elseNodes, emitter, pugText);
    emitter.emitSynthetic(';');
  } else {
    emitter.emitSynthetic(`return ${resultVar};`);
  }
  emitter.emitSynthetic('})()');
  if (wrapInJsxBraces) emitter.emitSynthetic('}');
}

/** while test -> {(() => { const __r: JSX.Element[] = []; while (test) { __r.push(<body/>); } return __r; })()} */
function emitWhile(
  node: PugWhile,
  emitter: TsxEmitter,
  pugText: string,
  wrapInJsxBraces: boolean = true,
): void {
  const testOffset = lineColToOffset(pugText, node.line, node.column);
  const exprOffset = findValueOffsetOnLine(
    pugText,
    node.line,
    node.column,
    node.test,
    testOffset + 6,
  );

  if (wrapInJsxBraces) emitter.emitSynthetic('{');
  if (currentCompileMode() === 'runtime') {
    emitter.emitSynthetic('(() => {const __r = [];while (');
  } else {
    emitter.emitSynthetic('(() => {const __r: JSX.Element[] = [];while (');
  }
  emitExpressionWithTemplateInterpolations(node.test, exprOffset, emitter, FULL_FEATURES);
  emitter.emitSynthetic(') {__r.push(');

  const bodyNodes = node.block?.nodes ?? [];
  emitBlockAsExpression(bodyNodes, emitter, pugText);

  emitter.emitSynthetic(');}return __r;})()');
  if (wrapInJsxBraces) emitter.emitSynthetic('}');
}

/** case expr / when val1 / default -> {expr === val1 ? <c1> : <default>} */
function emitCase(
  node: PugCase,
  emitter: TsxEmitter,
  pugText: string,
  wrapInJsxBraces: boolean = true,
): void {
  const caseOffset = lineColToOffset(pugText, node.line, node.column);
  const exprOffset = findValueOffsetOnLine(
    pugText,
    node.line,
    node.column,
    node.expr,
    caseOffset + 5,
  );

  const whenNodes = (node.block?.nodes ?? []).filter(
    (n): n is PugWhen => n.type === 'When',
  );

  if (whenNodes.length === 0) {
    if (wrapInJsxBraces) emitter.emitSynthetic('{');
    emitter.emitSynthetic('null');
    if (wrapInJsxBraces) emitter.emitSynthetic('}');
    return;
  }

  if (wrapInJsxBraces) emitter.emitSynthetic('{');
  emitWhenChain(whenNodes, 0, node.expr, exprOffset, emitter, pugText);
  if (wrapInJsxBraces) emitter.emitSynthetic('}');
}

/** Recursively emit chained ternaries for when nodes */
function emitWhenChain(
  whens: PugWhen[],
  index: number,
  caseExpr: string,
  caseExprOffset: number,
  emitter: TsxEmitter,
  pugText: string,
): void {
  if (index >= whens.length) {
    emitter.emitSynthetic('null');
    return;
  }

  const when = whens[index];
  const whenOffset = lineColToOffset(pugText, when.line, when.column);

  if (when.expr === 'default') {
    // Default case: just emit the body
    const bodyNodes = when.block?.nodes ?? [];
    emitBlockAsExpression(bodyNodes, emitter, pugText);
    return;
  }

  const whenExprOffset = findValueOffsetOnLine(
    pugText,
    when.line,
    when.column,
    when.expr,
    whenOffset + 5,
  );

  // Emit: caseExpr === whenExpr ? <body> : <next>
  emitExpressionWithTemplateInterpolations(caseExpr, caseExprOffset, emitter, VERIFY_ONLY);
  emitter.emitSynthetic(' === ');
  emitExpressionWithTemplateInterpolations(when.expr, whenExprOffset, emitter, FULL_FEATURES);
  emitter.emitSynthetic(' ? ');

  const bodyNodes = when.block?.nodes ?? [];
  emitBlockAsExpression(bodyNodes, emitter, pugText);

  emitter.emitSynthetic(' : ');
  emitWhenChain(whens, index + 1, caseExpr, caseExprOffset, emitter, pugText);
}

// ── Public API ──────────────────────────────────────────────────

export interface CompileResult {
  tsx: string;
  mappings: CodeMapping[];
  lexerTokens: PugToken[];
  parseError: PugParseError | null;
  styleBlock: ExtractedStyleBlock | null;
  transformError: PugTransformError | null;
}

export type CompileMode = 'languageService' | 'runtime';
export type ClassAttributeName = 'className' | 'class' | 'styleName';
export type ClassMergeMode = 'concatenate' | 'classnames';

export interface CompileOptions {
  mode?: CompileMode;
  classAttribute?: ClassAttributeName;
  classMerge?: ClassMergeMode;
  componentPathFromUppercaseClassShorthand?: boolean;
}

function fallbackNullExpression(mode: CompileMode): string {
  return mode === 'runtime' ? 'null' : '(null as any as JSX.Element)';
}

/**
 * Compile pug text to TSX with source mappings.
 * Pipeline: pug-lexer -> pug-strip-comments -> pug-parser -> TsxEmitter
 */
export function compilePugToTsx(pugText: string, options: CompileOptions = {}): CompileResult {
  const mode = options.mode ?? 'languageService';
  const classAttribute = options.classAttribute ?? 'className';
  const classMerge = options.classMerge ?? 'concatenate';
  const componentPathFromUppercaseClassShorthand = options.componentPathFromUppercaseClassShorthand ?? true;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lex = require('@startupjs/pug-lexer');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const parse = require('pug-parser');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const stripComments = require('pug-strip-comments');
  const extractedStyle = extractTerminalStyleBlock(pugText);
  const prepared = prepareTemplateInterpolations(extractedStyle.pugTextWithoutStyle);
  const pugTextForParse = prepared.sanitizedText;
  interpolationContextStack.push(prepared.context);
  compileContextStack.push({
    mode,
    classAttribute,
    classMerge,
    componentPathFromUppercaseClassShorthand,
  });

  try {
    if (extractedStyle.transformError) {
      return {
        tsx: fallbackNullExpression(mode),
        mappings: [],
        lexerTokens: [],
        parseError: null,
        styleBlock: null,
        transformError: extractedStyle.transformError,
      };
    }

    let tokens: any[];
    let parseError: PugParseError | null = null;
    try {
      tokens = lex(pugTextForParse, { filename: 'template.pug' });
    } catch (err: any) {
      parseError = {
        message: err.message ?? 'Pug lexer error',
        line: err.line ?? 1,
        column: err.column ?? 1,
        offset: 0,
      };

      const recoveredText = buildTypingRecoveryText(pugTextForParse);
      if (recoveredText !== pugTextForParse) {
        try {
          tokens = lex(recoveredText, { filename: 'template.pug' });
        } catch {
          return {
            tsx: fallbackNullExpression(mode),
            mappings: [],
            lexerTokens: [],
            parseError,
            styleBlock: extractedStyle.styleBlock,
            transformError: null,
          };
        }
      } else {
        return {
          tsx: fallbackNullExpression(mode),
          mappings: [],
          lexerTokens: [],
          parseError,
          styleBlock: extractedStyle.styleBlock,
          transformError: null,
        };
      }
    }

    const lexerTokens: PugToken[] = tokens
      .filter((t: any) => t.loc)
      .map((t: any) => ({
        type: t.type,
        loc: t.loc,
        val: t.val != null ? String(t.val) : undefined,
      }));

    let ast: any;
    try {
      const stripped = stripComments(tokens, { filename: 'template.pug' });
      ast = parse(stripped, { filename: 'template.pug' });
    } catch (err: any) {
      if (parseError == null) {
        parseError = {
          message: err.message ?? 'Pug parser error',
          line: err.line ?? 1,
          column: err.column ?? 1,
          offset: 0,
        };
      }

      // Recovery parse: keep IntelliSense usable while template is temporarily incomplete.
      const recoveredText = buildTypingRecoveryText(pugTextForParse);
      if (recoveredText !== pugTextForParse) {
        try {
          const recoveredTokens = lex(recoveredText, { filename: 'template.pug' });
          const recoveredStripped = stripComments(recoveredTokens, { filename: 'template.pug' });
          ast = parse(recoveredStripped, { filename: 'template.pug' });
        } catch {
          // Fall through to placeholder.
        }
      }

      if (!ast) {
        return {
          tsx: fallbackNullExpression(mode),
          mappings: [],
          lexerTokens,
          parseError,
          styleBlock: extractedStyle.styleBlock,
          transformError: null,
        };
      }
    }

    const emitter = new TsxEmitter();

    if (ast.nodes.length === 0) {
      emitter.emitSynthetic(fallbackNullExpression(mode));
    } else {
      emitter.emitSynthetic('(');
      emitBlockAsExpression(ast.nodes, emitter, pugTextForParse);
      emitter.emitSynthetic(')');
    }

    const result = emitter.getResult();
    return {
      tsx: result.tsx,
      mappings: result.mappings,
      lexerTokens,
      parseError,
      styleBlock: extractedStyle.styleBlock,
      transformError: null,
    };
  } finally {
    compileContextStack.pop();
    interpolationContextStack.pop();
  }
}
