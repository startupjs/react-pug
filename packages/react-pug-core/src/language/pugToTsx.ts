import type { CodeMapping, CodeInformation, PugParseError, PugToken } from './mapping';
import { FULL_FEATURES, CSS_CLASS, SYNTHETIC, VERIFY_ONLY } from './mapping';

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

function emitTag(
  node: PugTag,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const tagOffset = lineColToOffset(pugText, node.line, node.column);

  // Collect class names and id from shorthand attrs
  const classNames: string[] = [];
  let idValue: string | null = null;
  const regularAttrs: PugAttr[] = [];

  for (const attr of node.attrs) {
    if (attr.name === 'class' && typeof attr.val === 'string') {
      // Shorthand class: val is like "'card'" (with quotes)
      const raw = attr.val;
      if (raw.startsWith("'") && raw.endsWith("'")) {
        classNames.push(raw.slice(1, -1));
      } else if (raw.startsWith('"') && raw.endsWith('"')) {
        classNames.push(raw.slice(1, -1));
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

  // Check if tag name is synthetic (implicit div from shorthand)
  const isSyntheticDiv = node.name === 'div' && (classNames.length > 0 || idValue !== null)
    && node.column === (pugText.split('\n')[node.line - 1]?.indexOf('.') ?? -1) + 1;

  // Emit opening tag
  emitter.emitSynthetic('<');
  if (isSyntheticDiv) {
    emitter.emitSynthetic(node.name);
  } else {
    emitter.emitMapped(node.name, tagOffset, FULL_FEATURES);
  }

  // Emit className from shorthands
  if (classNames.length > 0) {
    const combinedClass = classNames.join(' ');
    emitter.emitSynthetic(' className="');
    const classOffset = lineColToOffset(pugText, node.line, node.column);
    emitter.emitDerived(combinedClass, classOffset, 1, CSS_CLASS);
    emitter.emitSynthetic('"');
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
  const isVoid = VOID_ELEMENTS.has(node.name.toLowerCase());

  if (!hasChildren || isVoid) {
    emitter.emitSynthetic(' />');
  } else {
    emitter.emitSynthetic('>');
    emitChildren(children, emitter, pugText);
    emitter.emitSynthetic('</');
    if (isSyntheticDiv) {
      emitter.emitSynthetic(node.name);
    } else {
      emitter.emitSynthetic(node.name);
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
      emitter.emitMapped(val, valOffset, FULL_FEATURES);
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
  emitter.emitMapped(node.val, offset, SYNTHETIC);
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
    emitter.emitMapped(node.val, valueOffset, FULL_FEATURES);
    if (wrapInJsxBraces) emitter.emitSynthetic('}');
  } else if (node.buffer) {
    // Buffered code: = expr -> {expr} in JSX child context, bare expr in JS expression context
    if (wrapInJsxBraces) emitter.emitSynthetic('{');
    emitter.emitMapped(node.val, valueOffset, FULL_FEATURES);
    if (wrapInJsxBraces) emitter.emitSynthetic('}');
  } else {
    // Unbuffered code block: - const x = 10
    // Emitted as a statement; IIFE wrapping is handled by emitNodesWithCodeBlocks
    emitter.emitMapped(node.val, valueOffset, FULL_FEATURES);
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
    emitBlockWithCodeSupport(nodes, emitter, pugText);
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
  emitter.emitMapped(node.test, exprOffset, FULL_FEATURES);
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

  emitter.emitMapped(node.test, exprOffset, FULL_FEATURES);
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

/** each item, i in items -> {items.map((item, i) => (<body/>))} */
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
  const keyOffset = keyIndex >= 0 ? lineStart + keyIndex : -1;

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

  if (wrapInJsxBraces) emitter.emitSynthetic('{');
  emitter.emitMapped(node.obj, objOffset, FULL_FEATURES);
  emitter.emitSynthetic('.map((');
  emitter.emitMapped(node.val, valOffset, FULL_FEATURES);
  if (node.key != null) {
    emitter.emitSynthetic(', ');
    emitter.emitMapped(node.key, keyOffset, FULL_FEATURES);
  }
  emitter.emitSynthetic(') => (');

  const bodyNodes = node.block?.nodes ?? [];
  emitBlockAsExpression(bodyNodes, emitter, pugText);

  emitter.emitSynthetic('))');
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
  emitter.emitSynthetic('(() => {const __r: JSX.Element[] = [];while (');
  emitter.emitMapped(node.test, exprOffset, FULL_FEATURES);
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
  emitter.emitMapped(caseExpr, caseExprOffset, VERIFY_ONLY);
  emitter.emitSynthetic(' === ');
  emitter.emitMapped(when.expr, whenExprOffset, FULL_FEATURES);
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
}

/**
 * Compile pug text to TSX with source mappings.
 * Pipeline: pug-lexer -> pug-strip-comments -> pug-parser -> TsxEmitter
 */
export function compilePugToTsx(pugText: string): CompileResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lex = require('@startupjs/pug-lexer');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const parse = require('pug-parser');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const stripComments = require('pug-strip-comments');

  let tokens: any[];
  let parseError: PugParseError | null = null;
  try {
    tokens = lex(pugText, { filename: 'template.pug' });
  } catch (err: any) {
    parseError = {
      message: err.message ?? 'Pug lexer error',
      line: err.line ?? 1,
      column: err.column ?? 1,
      offset: 0,
    };

    const recoveredText = buildTypingRecoveryText(pugText);
    if (recoveredText !== pugText) {
      try {
        tokens = lex(recoveredText, { filename: 'template.pug' });
      } catch {
        return {
          tsx: '(null as any as JSX.Element)',
          mappings: [],
          lexerTokens: [],
          parseError,
        };
      }
    } else {
      return {
        tsx: '(null as any as JSX.Element)',
        mappings: [],
        lexerTokens: [],
        parseError,
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
    const recoveredText = buildTypingRecoveryText(pugText);
    if (recoveredText !== pugText) {
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
        tsx: '(null as any as JSX.Element)',
        mappings: [],
        lexerTokens,
        parseError,
      };
    }
  }

  const emitter = new TsxEmitter();

  if (ast.nodes.length === 0) {
    emitter.emitSynthetic('(null as any as JSX.Element)');
  } else {
    emitter.emitSynthetic('(');
    emitBlockAsExpression(ast.nodes, emitter, pugText);
    emitter.emitSynthetic(')');
  }

  const result = emitter.getResult();
  return {
    tsx: result.tsx,
    mappings: result.mappings,
    lexerTokens,
    parseError,
  };
}
