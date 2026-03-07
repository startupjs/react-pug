import type { PugDocument, PugRegion } from './mapping';
import { extractPugRegions } from './extractRegions';
import { compilePugToTsx, type CompileOptions } from './pugToTsx';

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
  compileOptions: CompileOptions = {},
): PugDocument {
  const resolvedCompileOptions = resolveCompileOptions(originalText, compileOptions);
  const regions = extractPugRegions(originalText, uri, tagName);

  if (regions.length === 0) {
    return {
      originalText,
      uri,
      regions: [],
      shadowText: originalText,
      version,
      regionDeltas: [],
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

  return {
    originalText,
    uri,
    regions,
    shadowText,
    version,
    regionDeltas,
  };
}
