import type { MissingTagImportDiagnostic, PugDocument, PugRegion, TagImportCleanup } from './mapping';
import { extractPugAnalysis } from './extractRegions';
import { compilePugToTsx, type CompileOptions } from './pugToTsx';
import { originalToShadow } from './positionMapping';

const STARTUPJS_OR_CSSXJS_RE = /['"](?:startupjs|cssxjs)['"]/;

function resolveCompileOptions(
  originalText: string,
  compileOptions: CompileOptions,
): CompileOptions {
  const startupDetected = STARTUPJS_OR_CSSXJS_RE.test(originalText);
  const classAttribute = compileOptions.classAttribute ?? (startupDetected ? 'styleName' : 'className');
  const classMerge = compileOptions.classMerge ?? (classAttribute === 'styleName' ? 'classnames' : 'concatenate');

  return {
    ...compileOptions,
    classAttribute,
    classMerge,
  };
}

/**
 * Build a shadow document from source text.
 *
 * 1. Extract pug regions using @babel/parser
 * 2. Compile each region's pug text to TSX
 * 3. Replace each pug`...` span in the original text with generated TSX
 * 4. Compute regionDeltas for O(log n) position mapping outside regions
 */
export function buildShadowDocument(
  originalText: string,
  uri: string,
  version: number = 1,
  tagName: string = 'pug',
  compileOptions: CompileOptions & { requirePugImport?: boolean; removeTagImport?: boolean } = {},
): PugDocument {
  const resolvedCompileOptions = resolveCompileOptions(originalText, compileOptions);
  const analysis = extractPugAnalysis(originalText, uri, tagName);
  const regions = analysis.regions;
  const removeTagImport = compileOptions.removeTagImport !== false;
  const importCleanups = removeTagImport ? analysis.importCleanups : [];
  const missingTagImport: MissingTagImportDiagnostic | null = (
    compileOptions.requirePugImport && analysis.usesTagFunction && !analysis.hasTagImport
  ) ? {
    message: `Missing import for tag function "${tagName}"`,
    start: analysis.regions[0]?.originalStart ?? 0,
    length: Math.max(1, tagName.length),
  } : null;

  if (regions.length === 0) {
    return {
      originalText,
      uri,
      regions: [],
      importCleanups: [],
      shadowText: originalText,
      version,
      regionDeltas: [],
      usesTagFunction: false,
      hasTagImport: analysis.hasTagImport,
      missingTagImport: null,
    };
  }

  // Compile each region and populate shadow fields
  for (const region of regions) {
    if (region.parseError != null) {
      // Region already has an extraction-time error -- use placeholder
      region.tsxText = resolvedCompileOptions.mode === 'runtime'
        ? 'null'
        : '(null as any as JSX.Element)';
      region.mappings = [];
      region.lexerTokens = [];
    } else {
      const compiled = compilePugToTsx(region.pugText, resolvedCompileOptions);
      region.tsxText = compiled.tsx;
      region.mappings = compiled.mappings;
      region.lexerTokens = compiled.lexerTokens;
      region.parseError = compiled.parseError;
    }
  }

  // Build shadow text by replacing each pug`...` span with TSX
  // Regions are sorted by originalStart (extractPugRegions guarantees this)
  let shadowText = '';
  let cursor = 0;
  let cumulativeDelta = 0;
  const regionDeltas: number[] = [];

  for (const region of regions) {
    // Copy text before this region unchanged
    shadowText += originalText.slice(cursor, region.originalStart);

    // Record cumulative delta BEFORE this region
    regionDeltas.push(cumulativeDelta);

    // Compute shadow position for this region
    region.shadowStart = region.originalStart + cumulativeDelta;
    shadowText += region.tsxText;
    region.shadowEnd = region.shadowStart + region.tsxText.length;

    // Update delta: difference between TSX length and original pug`...` length
    const originalLength = region.originalEnd - region.originalStart;
    cumulativeDelta += region.tsxText.length - originalLength;

    cursor = region.originalEnd;
  }

  // Copy remaining text after last region
  shadowText += originalText.slice(cursor);

  const document: PugDocument = {
    originalText,
    uri,
    regions,
    importCleanups,
    shadowText,
    version,
    regionDeltas,
    usesTagFunction: analysis.usesTagFunction,
    hasTagImport: analysis.hasTagImport,
    missingTagImport,
  };

  if (importCleanups.length > 0) {
    document.shadowText = applyImportCleanups(document, importCleanups);
  }

  return document;
}

function applyImportCleanups(doc: PugDocument, cleanups: TagImportCleanup[]): string {
  if (cleanups.length === 0) return doc.shadowText;
  const chars = doc.shadowText.split('');
  for (const cleanup of cleanups) {
    const shadowStart = originalToShadow(doc, cleanup.originalStart);
    if (shadowStart == null) continue;
    const shadowEnd = shadowStart + (cleanup.originalEnd - cleanup.originalStart);
    for (let i = shadowStart; i < shadowEnd; i += 1) {
      chars[i] = '';
    }
    chars[shadowStart] = cleanup.replacementText;
  }
  return chars.join('');
}
