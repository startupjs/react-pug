import { parse } from '@babel/parser';
import type {
  File,
  ImportDeclaration,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  Node,
  StringLiteral,
  TaggedTemplateExpression,
} from '@babel/types';
import type { PugRegion, TagImportCleanup } from './mapping';

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
interface ExtractedImportData {
  cleanup: TagImportCleanup;
}

export interface ExtractPugAnalysisResult {
  regions: PugRegion[];
  importCleanups: TagImportCleanup[];
  usesTagFunction: boolean;
  hasTagImport: boolean;
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

function collectPugAnalysis(
  node: Node,
  text: string,
  templates: TaggedTemplateExpression[],
  imports: ExtractedImportData[],
  tagName: string = 'pug',
): void {
  if (!node || typeof node !== 'object') return;

  if (
    node.type === 'TaggedTemplateExpression' &&
    node.tag.type === 'Identifier' &&
    node.tag.name === tagName
  ) {
    templates.push(node);
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

    if (matchedSpecifiers.length > 0) {
      imports.push({
        cleanup: buildImportCleanup(text, declaration, matchedSpecifiers),
      });
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          collectPugAnalysis(item, text, templates, imports, tagName);
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      collectPugAnalysis(child, text, templates, imports, tagName);
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
      usesTagFunction: false,
      hasTagImport: false,
    };
  }

  let templates: TaggedTemplateExpression[];
  let imports: ExtractedImportData[];
  try {
    const ast = parse(text, {
      sourceType: 'module',
      plugins: getPluginsForFile(filename),
      errorRecovery: true,
      ranges: true,
    }) as File;
    templates = [];
    imports = [];
    collectPugAnalysis(ast, text, templates, imports, tagName);
  } catch {
    // @babel/parser failed -- fall back to regex
    const regions = extractWithRegex(text, tagName);
    return {
      regions,
      importCleanups: [],
      usesTagFunction: regions.length > 0,
      hasTagImport: false,
    };
  }

  if (templates.length === 0) {
    return {
      regions: [],
      importCleanups: [],
      usesTagFunction: false,
      hasTagImport: imports.length > 0,
    };
  }

  // Sort by offset
  templates.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

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
    };

    regions.push(region);
  }

  return {
    regions,
    importCleanups: imports.map(entry => entry.cleanup),
    usesTagFunction: regions.length > 0,
    hasTagImport: imports.length > 0,
  };
}
