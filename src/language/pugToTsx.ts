import type { CodeMapping, CodeInformation, PugParseError, PugToken } from './mapping';
import { FULL_FEATURES, CSS_CLASS, SYNTHETIC } from './mapping';

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
  // Multiple sibling nodes that produce JSX need fragment wrapping
  const jsxNodes = nodes.filter(
    n => n.type === 'Tag' || n.type === 'Code' || n.type === 'Conditional'
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
    // Control flow: emit placeholders (handled in next task)
    case 'Conditional':
    case 'Each':
    case 'While':
    case 'Case':
    case 'When':
      emitSynthetic(node, emitter);
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
    // Placeholder for now (full support in next task)
    emitter.emitSynthetic('{null}');
  }
}

function emitChildren(
  nodes: PugNode[],
  emitter: TsxEmitter,
  pugText: string,
): void {
  // Separate text and inline code nodes from block nodes for proper text grouping
  for (const node of nodes) {
    emitNode(node, emitter, pugText);
  }
}

function emitSynthetic(
  _node: PugNode,
  emitter: TsxEmitter,
): void {
  // Placeholder for control flow nodes -- next task
  emitter.emitSynthetic('{null}');
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
