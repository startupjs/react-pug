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

/** Convert pug line/column (1-based) to offset in the pug text */
function lineColToOffset(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for \n
  }
  return offset + (column - 1);
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
  const offset = lineColToOffset(pugText, node.line, node.column);
  emitter.emitMapped(node.val, offset, SYNTHETIC);
}

function emitCode(
  node: PugCode,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const offset = lineColToOffset(pugText, node.line, node.column);

  if (node.buffer && node.isInline) {
    // Inline interpolation: #{expr} -> {expr}
    emitter.emitSynthetic('{');
    emitter.emitMapped(node.val, offset, FULL_FEATURES);
    emitter.emitSynthetic('}');
  } else if (node.buffer) {
    // Buffered code: = expr -> {expr}
    emitter.emitSynthetic('{');
    emitter.emitMapped(node.val, offset, FULL_FEATURES);
    emitter.emitSynthetic('}');
  } else {
    // Unbuffered code block: - const x = 10
    // Emitted as a statement; IIFE wrapping is handled by emitNodesWithCodeBlocks
    emitter.emitMapped(node.val, offset, FULL_FEATURES);
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

// ── Control flow emitters ──────────────────────────────────────

/** if show -> show ? <consequent> : <alternate> */
function emitConditional(
  node: PugConditional,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const testOffset = lineColToOffset(pugText, node.line, node.column);
  // 'if ' is 3 chars from the start of the line
  const exprOffset = testOffset + 3;

  emitter.emitSynthetic('{');
  emitter.emitMapped(node.test, exprOffset, FULL_FEATURES);
  emitter.emitSynthetic(' ? ');

  // Consequent block
  const consequentNodes = node.consequent?.nodes ?? [];
  if (consequentNodes.length === 0) {
    emitter.emitSynthetic('null');
  } else {
    emitBlockWithCodeSupport(consequentNodes, emitter, pugText);
  }

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
    if (altNodes.length === 0) {
      emitter.emitSynthetic('null');
    } else {
      emitBlockWithCodeSupport(altNodes, emitter, pugText);
    }
  }

  emitter.emitSynthetic('}');
}

/** Inner conditional for chained else-if (no wrapping {} braces) */
function emitConditionalInner(
  node: PugConditional,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const testOffset = lineColToOffset(pugText, node.line, node.column);
  // 'else if ' is 8 chars from start of line
  const exprOffset = testOffset + 8;

  emitter.emitMapped(node.test, exprOffset, FULL_FEATURES);
  emitter.emitSynthetic(' ? ');

  const consequentNodes = node.consequent?.nodes ?? [];
  if (consequentNodes.length === 0) {
    emitter.emitSynthetic('null');
  } else {
    emitBlockWithCodeSupport(consequentNodes, emitter, pugText);
  }

  emitter.emitSynthetic(' : ');

  if (node.alternate == null) {
    emitter.emitSynthetic('null');
  } else if (node.alternate.type === 'Conditional') {
    emitConditionalInner(node.alternate, emitter, pugText);
  } else {
    const altNodes = (node.alternate as PugBlock).nodes ?? [];
    if (altNodes.length === 0) {
      emitter.emitSynthetic('null');
    } else {
      emitBlockWithCodeSupport(altNodes, emitter, pugText);
    }
  }
}

/** each item, i in items -> {items.map((item, i) => (<body/>))} */
function emitEach(
  node: PugEach,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const lineOffset = lineColToOffset(pugText, node.line, node.column);
  // Parse: 'each val[, key] in obj'
  // 'each ' = 5 chars
  const pugLine = pugText.split('\n')[node.line - 1] ?? '';
  const inIndex = pugLine.indexOf(' in ');

  // Object expression offset: after ' in '
  const objOffset = lineOffset + inIndex + 4;
  // Value name offset: after 'each '
  const valOffset = lineOffset + 5;
  // Key offset: after 'each val, '
  const keyOffset = node.key != null
    ? lineOffset + 5 + node.val.length + 2  // +2 for ', '
    : -1;

  emitter.emitSynthetic('{');
  emitter.emitMapped(node.obj, objOffset, FULL_FEATURES);
  emitter.emitSynthetic('.map((');
  emitter.emitMapped(node.val, valOffset, FULL_FEATURES);
  if (node.key != null) {
    emitter.emitSynthetic(', ');
    emitter.emitMapped(node.key, keyOffset, FULL_FEATURES);
  }
  emitter.emitSynthetic(') => (');

  const bodyNodes = node.block?.nodes ?? [];
  if (bodyNodes.length === 0) {
    emitter.emitSynthetic('null');
  } else {
    emitBlockWithCodeSupport(bodyNodes, emitter, pugText);
  }

  emitter.emitSynthetic('))}');
}

/** while test -> {(() => { const __r: JSX.Element[] = []; while (test) { __r.push(<body/>); } return __r; })()} */
function emitWhile(
  node: PugWhile,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const testOffset = lineColToOffset(pugText, node.line, node.column);
  // 'while ' = 6 chars
  const exprOffset = testOffset + 6;

  emitter.emitSynthetic('{(() => {const __r: JSX.Element[] = [];while (');
  emitter.emitMapped(node.test, exprOffset, FULL_FEATURES);
  emitter.emitSynthetic(') {__r.push(');

  const bodyNodes = node.block?.nodes ?? [];
  if (bodyNodes.length === 0) {
    emitter.emitSynthetic('null');
  } else {
    emitBlockWithCodeSupport(bodyNodes, emitter, pugText);
  }

  emitter.emitSynthetic(');}return __r;})()}');
}

/** case expr / when val1 / default -> {expr === val1 ? <c1> : <default>} */
function emitCase(
  node: PugCase,
  emitter: TsxEmitter,
  pugText: string,
): void {
  const caseOffset = lineColToOffset(pugText, node.line, node.column);
  // 'case ' = 5 chars
  const exprOffset = caseOffset + 5;

  const whenNodes = (node.block?.nodes ?? []).filter(
    (n): n is PugWhen => n.type === 'When',
  );

  if (whenNodes.length === 0) {
    emitter.emitSynthetic('{null}');
    return;
  }

  emitter.emitSynthetic('{');
  emitWhenChain(whenNodes, 0, node.expr, exprOffset, emitter, pugText);
  emitter.emitSynthetic('}');
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
    if (bodyNodes.length === 0) {
      emitter.emitSynthetic('null');
    } else {
      emitBlockWithCodeSupport(bodyNodes, emitter, pugText);
    }
    return;
  }

  // 'when ' = 5 chars
  const whenExprOffset = whenOffset + 5;

  // Emit: caseExpr === whenExpr ? <body> : <next>
  emitter.emitMapped(caseExpr, caseExprOffset, VERIFY_ONLY);
  emitter.emitSynthetic(' === ');
  emitter.emitMapped(when.expr, whenExprOffset, FULL_FEATURES);
  emitter.emitSynthetic(' ? ');

  const bodyNodes = when.block?.nodes ?? [];
  if (bodyNodes.length === 0) {
    emitter.emitSynthetic('null');
  } else {
    emitBlockWithCodeSupport(bodyNodes, emitter, pugText);
  }

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
  try {
    tokens = lex(pugText, { filename: 'template.pug' });
  } catch (err: any) {
    return {
      tsx: '(null as any as JSX.Element)',
      mappings: [],
      lexerTokens: [],
      parseError: {
        message: err.message ?? 'Pug lexer error',
        line: err.line ?? 1,
        column: err.column ?? 1,
        offset: 0,
      },
    };
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
    return {
      tsx: '(null as any as JSX.Element)',
      mappings: [],
      lexerTokens,
      parseError: {
        message: err.message ?? 'Pug parser error',
        line: err.line ?? 1,
        column: err.column ?? 1,
        offset: 0,
      },
    };
  }

  const emitter = new TsxEmitter();

  if (ast.nodes.length === 0) {
    emitter.emitSynthetic('(null as any as JSX.Element)');
  } else {
    emitter.emitSynthetic('(');
    emitNodes(ast.nodes, emitter, pugText);
    emitter.emitSynthetic(')');
  }

  const result = emitter.getResult();
  return {
    tsx: result.tsx,
    mappings: result.mappings,
    lexerTokens,
    parseError: null,
  };
}
