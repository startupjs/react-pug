import { parse } from '@babel/parser';
import type {
  File,
  ArrowFunctionExpression,
  BlockStatement,
  ImportDeclaration,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  Node,
  Program,
  StringLiteral,
  TaggedTemplateExpression,
} from '@babel/types';
import type { PugRegion, StyleTagLang, TagImportCleanup } from './mapping';

/** Strip the common leading whitespace from all non-empty lines, returning the stripped text and indent amount */
function stripCommonIndent(text: string): { stripped: string; indent: number } {
  const lines = text.split('\n');
  let minIndent = Infinity;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }

  if (minIndent === Infinity || minIndent === 0) return { stripped: text, indent: 0 };

  const stripped = lines
    .map(line => (line.trim().length === 0 ? '' : line.slice(minIndent)))
    .join('\n');

  return { stripped, indent: minIndent };
}

/** Determine babel parser plugins based on filename */
function getPluginsForFile(filename: string): any[] {
  const isTS = /\.tsx?$/i.test(filename);
  const isJSX = /\.[jt]sx$/i.test(filename);

  const plugins: any[] = ['decorators-legacy'];
  if (isTS) plugins.push('typescript');
  if (isJSX || isTS) plugins.push('jsx');
  // For .js files, still try jsx since many React projects use JSX in .js
  if (!isTS && !isJSX) plugins.push('jsx');

  return plugins;
}

/** Walk the AST and collect TaggedTemplateExpression nodes where tag matches tagName */
export interface ExtractedImportData {
  declaration: ImportDeclaration;
  source: string;
  sourceText: string;
  cleanup: TagImportCleanup | null;
  hasMatchedTag: boolean;
  matchedSpecifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;
  helperImports: Set<StyleTagLang>;
}

export interface StyleScopeTarget {
  kind: 'program' | 'block' | 'arrow-expression' | 'statement-body';
  insertionOffset: number;
  statementIndent: string;
  closingIndent: string;
  expressionEnd?: number;
  statementEnd?: number;
}

interface ExtractedTemplateData {
  node: TaggedTemplateExpression;
  styleScopeTarget: StyleScopeTarget;
}

export interface ExtractPugAnalysisResult {
  regions: PugRegion[];
  importCleanups: TagImportCleanup[];
  tagImportEntries: ExtractedImportData[];
  usesTagFunction: boolean;
  hasTagImport: boolean;
  tagImportSource: string | null;
  tagImportSourceText: string | null;
  helperImportInsertionOffset: number | null;
  existingStyleImports: Set<StyleTagLang>;
  styleScopeTargets: StyleScopeTarget[];
}

function getNodeText(text: string, node: { start?: number | null; end?: number | null }): string {
  return text.slice(node.start ?? 0, node.end ?? 0);
}

function padToLength(text: string, targetLength: number): string {
  if (text.length >= targetLength) return text;
  return text + ' '.repeat(targetLength - text.length);
}

function buildImportCleanup(
  text: string,
  declaration: ImportDeclaration,
  matchedSpecifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>,
): TagImportCleanup {
  const originalStart = declaration.start ?? 0;
  const originalEnd = declaration.end ?? originalStart;
  const originalText = text.slice(originalStart, originalEnd);
  const sourceText = getNodeText(text, declaration.source as StringLiteral);
  const remaining = declaration.specifiers.filter(spec => !matchedSpecifiers.includes(spec as any));
  const hasSemicolon = originalText.trimEnd().endsWith(';');

  let replacement = '';
  if (remaining.length === 0) {
    replacement = declaration.importKind === 'type'
      ? ''
      : `import ${sourceText}${hasSemicolon ? ';' : ''}`;
  } else {
    const defaultSpecifier = remaining.find(spec => spec.type === 'ImportDefaultSpecifier') as ImportDefaultSpecifier | undefined;
    const namespaceSpecifier = remaining.find(spec => spec.type === 'ImportNamespaceSpecifier') as ImportNamespaceSpecifier | undefined;
    const namedSpecifiers = remaining.filter(spec => spec.type === 'ImportSpecifier') as ImportSpecifier[];
    const parts: string[] = [];

    if (defaultSpecifier) parts.push(getNodeText(text, defaultSpecifier));
    if (namespaceSpecifier) parts.push(getNodeText(text, namespaceSpecifier));
    if (namedSpecifiers.length > 0) {
      parts.push(`{ ${namedSpecifiers.map(spec => getNodeText(text, spec)).join(', ')} }`);
    }

    const importPrefix = declaration.importKind === 'type' ? 'import type ' : 'import ';
    replacement = `${importPrefix}${parts.join(', ')} from ${sourceText}${hasSemicolon ? ';' : ''}`;
  }

  return {
    originalStart,
    originalEnd,
    replacementText: padToLength(replacement, originalEnd - originalStart),
  };
}

function getLineStartOffset(text: string, offset: number): number {
  const lineBreak = text.lastIndexOf('\n', Math.max(0, offset - 1));
  return lineBreak < 0 ? 0 : lineBreak + 1;
}

function getLineIndent(text: string, offset: number): string {
  const lineStart = getLineStartOffset(text, offset);
  const line = text.slice(lineStart, text.indexOf('\n', lineStart) >= 0 ? text.indexOf('\n', lineStart) : text.length);
  return line.match(/^[ \t]*/) ? line.match(/^[ \t]*/)![0] : '';
}

function getOffsetAfterTrailingLineBreak(text: string, offset: number): number {
  if (text[offset] === '\r' && text[offset + 1] === '\n') return offset + 2;
  if (text[offset] === '\n' || text[offset] === '\r') return offset + 1;
  return offset;
}

function isDirectiveStatement(node: Node): boolean {
  return node.type === 'ExpressionStatement' && typeof (node as any).directive === 'string';
}

function findProgramInsertionOffset(text: string, program: Program): number {
  const body = program.body;
  let lastLeading: Node | null = null;
  for (const statement of body) {
    if (statement.type === 'ImportDeclaration' || isDirectiveStatement(statement)) {
      lastLeading = statement;
      continue;
    }
    return statement.start ?? 0;
  }
  return lastLeading ? getOffsetAfterTrailingLineBreak(text, lastLeading.end ?? 0) : 0;
}

function findBlockInsertionOffset(text: string, block: BlockStatement): number {
  const firstNonDirective = block.body.find(statement => !isDirectiveStatement(statement));
  if (firstNonDirective) return getLineStartOffset(text, firstNonDirective.start ?? ((block.start ?? 0) + 1));
  return Math.max(0, (block.end ?? 0) - 1);
}

function buildArrowExpressionScopeTarget(text: string, node: ArrowFunctionExpression): StyleScopeTarget {
  if (node.body.type !== 'BlockStatement') {
    const closingIndent = getLineIndent(text, node.start ?? node.body.start ?? 0);
    return {
      kind: 'arrow-expression',
      insertionOffset: node.body.start ?? 0,
      statementIndent: `${closingIndent}  `,
      closingIndent,
      expressionEnd: node.body.end ?? 0,
    };
  }

  throw new Error('Arrow expression scope target requires a non-block arrow body');
}

function buildBlockScopeTarget(text: string, block: BlockStatement): StyleScopeTarget {
  const blockIndent = getLineIndent(text, block.start ?? 0);
  return {
    kind: 'block',
    insertionOffset: findBlockInsertionOffset(text, block),
    statementIndent: `${blockIndent}  `,
    closingIndent: blockIndent,
  };
}

function buildStatementBodyScopeTarget(text: string, statement: Node, parent: Node): StyleScopeTarget {
  const closingIndent = getLineIndent(text, parent.start ?? statement.start ?? 0);
  return {
    kind: 'statement-body',
    insertionOffset: statement.start ?? 0,
    statementIndent: `${closingIndent}  `,
    closingIndent,
    statementEnd: statement.end ?? statement.start ?? 0,
  };
}

function shouldWrapStatementBody(parent: Node, key: string, child: Node): boolean {
  if (child.type === 'BlockStatement') return false;

  if (parent.type === 'IfStatement' && (key === 'consequent' || key === 'alternate')) return true;
  if (
    (parent.type === 'WhileStatement'
      || parent.type === 'DoWhileStatement'
      || parent.type === 'ForStatement'
      || parent.type === 'ForInStatement'
      || parent.type === 'ForOfStatement'
      || parent.type === 'WithStatement'
      || parent.type === 'LabeledStatement')
    && key === 'body'
  ) {
    return true;
  }

  return false;
}

function collectPugAnalysis(
  node: Node,
  text: string,
  templates: ExtractedTemplateData[],
  imports: ExtractedImportData[],
  scopeStack: StyleScopeTarget[],
  ancestors: Node[] = [],
  tagName: string = 'pug',
): void {
  if (!node || typeof node !== 'object') return;

  if (
    node.type === 'TaggedTemplateExpression' &&
    node.tag.type === 'Identifier' &&
    node.tag.name === tagName
  ) {
    templates.push({
      node,
      styleScopeTarget: scopeStack[scopeStack.length - 1],
    });
    // Do not recurse into this tagged template. Nested pug tags (e.g. inside ${...})
    // are handled by the parent pug region compiler to avoid overlapping regions.
    return;
  }

  if (node.type === 'ImportDeclaration') {
    const declaration = node as ImportDeclaration;
    const matchedSpecifiers = declaration.specifiers.filter((specifier) => {
      if (specifier.type === 'ImportSpecifier') {
        return specifier.local.name === tagName && specifier.imported.type === 'Identifier' && specifier.imported.name === 'pug';
      }
      if (specifier.type === 'ImportDefaultSpecifier') {
        return specifier.local.name === tagName;
      }
      return false;
    }) as Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;

    const helperImports = new Set<StyleTagLang>();
    for (const specifier of declaration.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') continue;
      if (specifier.local.name !== specifier.imported.name) continue;
      if (specifier.imported.name === 'css'
        || specifier.imported.name === 'styl'
        || specifier.imported.name === 'sass'
        || specifier.imported.name === 'scss'
      ) {
        helperImports.add(specifier.imported.name);
      }
    }

    imports.push({
      declaration,
      source: String(declaration.source.value),
      sourceText: getNodeText(text, declaration.source as StringLiteral),
      cleanup: matchedSpecifiers.length > 0 ? buildImportCleanup(text, declaration, matchedSpecifiers) : null,
      hasMatchedTag: matchedSpecifiers.length > 0,
      matchedSpecifiers,
      helperImports,
    });
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          const nextScopeStack = item.type === 'BlockStatement'
            ? [...scopeStack, buildBlockScopeTarget(text, item)]
            : scopeStack;
          collectPugAnalysis(item, text, templates, imports, nextScopeStack, [...ancestors, node], tagName);
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      const nextScopeStack = (
        node.type === 'ArrowFunctionExpression'
        && key === 'body'
        && child.type !== 'BlockStatement'
      )
        ? [...scopeStack, buildArrowExpressionScopeTarget(text, node)]
        : shouldWrapStatementBody(node, key, child)
          ? [...scopeStack, buildStatementBodyScopeTarget(text, child, node)]
        : (child.type === 'BlockStatement'
          ? [...scopeStack, buildBlockScopeTarget(text, child)]
          : scopeStack);
      collectPugAnalysis(child, text, templates, imports, nextScopeStack, [...ancestors, node], tagName);
    }
  }
}

/** Escape special regex characters in a string */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex fallback for when @babel/parser fails */
function extractWithRegex(text: string, tagName: string = 'pug'): PugRegion[] {
  const re = new RegExp(`\\b${escapeRegExp(tagName)}\\s*\`([\\s\\S]*?)\``, 'g');
  const regions: PugRegion[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const fullMatchStart = match.index;
    const fullMatchEnd = fullMatchStart + match[0].length;
    const rawContent = match[1];

    // Offsets of the content inside backticks
    const backtickStart = text.indexOf('`', fullMatchStart);
    const pugTextStart = backtickStart + 1;
    const pugTextEnd = pugTextStart + rawContent.length;

    const { stripped, indent } = stripCommonIndent(rawContent);

    regions.push({
      originalStart: fullMatchStart,
      originalEnd: fullMatchEnd,
      pugTextStart,
      pugTextEnd,
      pugText: stripped,
      commonIndent: indent,
      // Shadow fields populated later by the generator
      shadowStart: 0,
      shadowEnd: 0,
      tsxText: '',
      mappings: [],
      lexerTokens: [],
      parseError: null,
      transformError: null,
      styleBlock: null,
    });
  }

  return regions;
}

/**
 * Extract all pug tagged template literal regions from a source file.
 * Uses @babel/parser for accurate AST-based extraction, with regex fallback.
 */
export function extractPugRegions(text: string, filename: string, tagName: string = 'pug'): PugRegion[] {
  return extractPugAnalysis(text, filename, tagName).regions;
}

export function extractPugAnalysis(
  text: string,
  filename: string,
  tagName: string = 'pug',
): ExtractPugAnalysisResult {
  // Fast path: skip parsing if no pug templates
  if (!text.includes(tagName + '`') && !text.includes(tagName + ' `')) {
    return {
      regions: [],
      importCleanups: [],
      tagImportEntries: [],
      usesTagFunction: false,
      hasTagImport: false,
      tagImportSource: null,
      tagImportSourceText: null,
      helperImportInsertionOffset: null,
      existingStyleImports: new Set(),
      styleScopeTargets: [],
    };
  }

  let templates: TaggedTemplateExpression[];
  let imports: ExtractedImportData[];
  let templateData: ExtractedTemplateData[];
  try {
    const ast = parse(text, {
      sourceType: 'module',
      plugins: getPluginsForFile(filename),
      errorRecovery: true,
      ranges: true,
    }) as File;
    templates = [];
    templateData = [];
    imports = [];
    const programTarget: StyleScopeTarget = {
      kind: 'program',
      insertionOffset: findProgramInsertionOffset(text, ast.program),
      statementIndent: '',
      closingIndent: '',
    };
    collectPugAnalysis(ast, text, templateData, imports, [programTarget], [], tagName);
    templateData.sort((a, b) => (a.node.start ?? 0) - (b.node.start ?? 0));
    templates = templateData.map(entry => entry.node);
  } catch {
    // @babel/parser failed -- fall back to regex
    const regions = extractWithRegex(text, tagName);
    return {
      regions,
      importCleanups: [],
      tagImportEntries: [],
      usesTagFunction: regions.length > 0,
      hasTagImport: false,
      tagImportSource: null,
      tagImportSourceText: null,
      helperImportInsertionOffset: null,
      existingStyleImports: new Set(),
      styleScopeTargets: regions.map(() => ({
        kind: 'program',
        insertionOffset: 0,
        statementIndent: '',
        closingIndent: '',
      })),
    };
  }

  if (templates.length === 0) {
    const tagImportEntries = imports.filter(entry => entry.hasMatchedTag);
    return {
      regions: [],
      importCleanups: [],
      tagImportEntries,
      usesTagFunction: false,
      hasTagImport: tagImportEntries.length > 0,
      tagImportSource: null,
      tagImportSourceText: null,
      helperImportInsertionOffset: null,
      existingStyleImports: new Set(),
      styleScopeTargets: [],
    };
  }

  const regions: PugRegion[] = [];

  for (const node of templates) {
    const originalStart = node.start ?? 0;
    const originalEnd = node.end ?? 0;
    const quasi = node.quasi;
    const quasis = quasi.quasis;

    // Offsets of the template content (inside backticks)
    const pugTextStart = quasis[0].start ?? ((quasi.start ?? 0) + 1);
    const pugTextEnd = quasis[quasis.length - 1].end ?? ((quasi.end ?? 0) - 1);
    const rawContent = text.slice(pugTextStart, pugTextEnd);

    const { stripped, indent } = stripCommonIndent(rawContent);

    const region: PugRegion = {
      originalStart,
      originalEnd,
      pugTextStart,
      pugTextEnd,
      pugText: stripped,
      commonIndent: indent,
      // Shadow fields populated later by the generator
      shadowStart: 0,
      shadowEnd: 0,
      tsxText: '',
      mappings: [],
      lexerTokens: [],
      parseError: null,
      transformError: null,
      styleBlock: null,
    };

    regions.push(region);
  }

  const tagImportEntries = imports.filter(entry => entry.hasMatchedTag);
  const tagImportSource = tagImportEntries[0]?.source ?? null;
  const tagImportSourceText = tagImportEntries[0]?.sourceText ?? null;
  const sameSourceImports = tagImportSource == null
    ? []
    : imports.filter(entry => entry.source === tagImportSource);
  const existingStyleImports = new Set<StyleTagLang>();
  for (const entry of sameSourceImports) {
    for (const helper of entry.helperImports) existingStyleImports.add(helper);
  }
  const helperImportInsertionOffset = sameSourceImports.length > 0
    ? getOffsetAfterTrailingLineBreak(text, sameSourceImports[sameSourceImports.length - 1].declaration.end ?? 0)
    : null;

  return {
    regions,
    importCleanups: tagImportEntries.flatMap(entry => entry.cleanup ? [entry.cleanup] : []),
    tagImportEntries,
    usesTagFunction: regions.length > 0,
    hasTagImport: tagImportEntries.length > 0,
    tagImportSource,
    tagImportSourceText,
    helperImportInsertionOffset,
    existingStyleImports,
    styleScopeTargets: templateData.map(entry => entry.styleScopeTarget),
  };
}
