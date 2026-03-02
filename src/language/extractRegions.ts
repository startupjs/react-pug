import { parse } from '@babel/parser';
import type { Node, TaggedTemplateExpression } from '@babel/types';
import type { PugRegion } from './mapping';

/** Strip the common leading whitespace from all non-empty lines */
function stripCommonIndent(text: string): string {
  const lines = text.split('\n');
  let minIndent = Infinity;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }

  if (minIndent === Infinity || minIndent === 0) return text;

  return lines
    .map(line => (line.trim().length === 0 ? '' : line.slice(minIndent)))
    .join('\n');
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

/** Walk the AST and collect TaggedTemplateExpression nodes where tag is 'pug' */
function findPugTemplates(node: Node, results: TaggedTemplateExpression[]): void {
  if (!node || typeof node !== 'object') return;

  if (
    node.type === 'TaggedTemplateExpression' &&
    node.tag.type === 'Identifier' &&
    node.tag.name === 'pug'
  ) {
    results.push(node);
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          findPugTemplates(item, results);
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      findPugTemplates(child, results);
    }
  }
}

/** Regex fallback for when @babel/parser fails */
function extractWithRegex(text: string): PugRegion[] {
  const re = /\bpug\s*`([\s\S]*?)`/g;
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

    regions.push({
      originalStart: fullMatchStart,
      originalEnd: fullMatchEnd,
      pugTextStart,
      pugTextEnd,
      pugText: stripCommonIndent(rawContent),
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
export function extractPugRegions(text: string, filename: string): PugRegion[] {
  // Fast path: skip parsing if no pug templates
  if (!text.includes('pug`') && !text.includes('pug `')) return [];

  let templates: TaggedTemplateExpression[];
  try {
    const ast = parse(text, {
      sourceType: 'module',
      plugins: getPluginsForFile(filename),
      errorRecovery: true,
      ranges: true,
    });
    templates = [];
    findPugTemplates(ast, templates);
  } catch {
    // @babel/parser failed -- fall back to regex
    return extractWithRegex(text);
  }

  if (templates.length === 0) return [];

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

    // Check for ${} interpolations
    const hasInterpolations = quasi.expressions.length > 0;

    const region: PugRegion = {
      originalStart,
      originalEnd,
      pugTextStart,
      pugTextEnd,
      pugText: stripCommonIndent(rawContent),
      // Shadow fields populated later by the generator
      shadowStart: 0,
      shadowEnd: 0,
      tsxText: '',
      mappings: [],
      lexerTokens: [],
      parseError: hasInterpolations
        ? {
            message:
              'JS template interpolation ${} not supported inside pug; use Pug\'s #{} interpolation',
            line: 1,
            column: 1,
            offset: 0,
          }
        : null,
    };

    regions.push(region);
  }

  return regions;
}
