import { SourceMap } from '@volar/source-map';
import type { CodeInformation, CodeMapping, PugDocument, PugRegion } from './mapping';

// ── SourceMap cache ────────────────────────────────────────────

const sourceMapCache = new WeakMap<PugRegion, SourceMap<CodeInformation>>();

function getSourceMap(region: PugRegion): SourceMap<CodeInformation> {
  let sm = sourceMapCache.get(region);
  if (!sm) {
    sm = new SourceMap<CodeInformation>(region.mappings);
    sourceMapCache.set(region, sm);
  }
  return sm;
}

// ── Binary search helpers ──────────────────────────────────────

/** Find the region containing the given original file offset, or null. */
export function findRegionAtOriginalOffset(
  doc: PugDocument,
  offset: number,
): PugRegion | null {
  const { regions } = doc;
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const region = regions[mid];
    if (offset < region.originalStart) {
      hi = mid - 1;
    } else if (offset >= region.originalEnd) {
      lo = mid + 1;
    } else {
      return region;
    }
  }
  return null;
}

/** Find the region containing the given shadow file offset, or null. */
export function findRegionAtShadowOffset(
  doc: PugDocument,
  offset: number,
): PugRegion | null {
  const { regions } = doc;
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const region = regions[mid];
    if (offset < region.shadowStart) {
      hi = mid - 1;
    } else if (offset >= region.shadowEnd) {
      lo = mid + 1;
    } else {
      return region;
    }
  }
  return null;
}

/**
 * Find the index of the last region whose originalStart <= offset.
 * Returns -1 if offset is before all regions.
 */
function findPrecedingRegionIndex(
  regions: PugRegion[],
  offset: number,
  key: 'originalStart' | 'shadowStart',
): number {
  let lo = 0;
  let hi = regions.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (regions[mid][key] <= offset) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// ── Bidirectional mapping ──────────────────────────────────────

/**
 * Map an original file offset to a shadow TSX offset.
 *
 * - Outside all regions: applies cumulative delta from preceding regions.
 * - Inside a region: uses @volar/source-map for intra-region mapping.
 *   Returns null if the offset falls in an unmapped/synthetic part.
 */
export function originalToShadow(
  doc: PugDocument,
  originalOffset: number,
): number | null {
  const { regions, regionDeltas } = doc;

  // Find which region (if any) contains this offset
  const region = findRegionAtOriginalOffset(doc, originalOffset);

  if (region != null) {
    // Inside a pug region -- map through SourceMap
    // Convert original file offset to pug text offset
    const pugOffset = originalOffset - region.pugTextStart;
    if (pugOffset < 0) {
      // Offset is in the pug`...` tag/backtick, not in the pug content
      return null;
    }

    const sm = getSourceMap(region);
    // toGeneratedLocation maps source (pug) offset -> generated (TSX) offset
    for (const [tsxOffset] of sm.toGeneratedLocation(pugOffset)) {
      return region.shadowStart + tsxOffset;
    }
    // No mapping found -- unmapped/synthetic position
    return null;
  }

  // Outside all regions -- apply cumulative delta
  const idx = findPrecedingRegionIndex(regions, originalOffset, 'originalStart');
  if (idx < 0) {
    // Before all regions -- no delta
    return originalOffset;
  }

  // Check if we're actually inside this region (shouldn't happen since
  // findRegionAtOriginalOffset returned null, but be safe)
  const precedingRegion = regions[idx];
  if (originalOffset < precedingRegion.originalEnd) {
    return null;
  }

  // Apply cumulative delta: regionDeltas[idx] + delta from region idx itself
  const deltaBeforeIdx = regionDeltas[idx];
  const deltaOfIdx = precedingRegion.tsxText.length - (precedingRegion.originalEnd - precedingRegion.originalStart);
  return originalOffset + deltaBeforeIdx + deltaOfIdx;
}

/**
 * Map a shadow TSX offset to an original file offset.
 *
 * - Outside all regions: reverses cumulative delta from preceding regions.
 * - Inside a region: uses @volar/source-map for intra-region mapping.
 *   Returns null if the offset falls in an unmapped/synthetic part.
 */
export function shadowToOriginal(
  doc: PugDocument,
  shadowOffset: number,
): number | null {
  const { regions, regionDeltas } = doc;

  // Find which region (if any) contains this shadow offset
  const region = findRegionAtShadowOffset(doc, shadowOffset);

  if (region != null) {
    // Inside a pug region -- map through SourceMap
    // Convert shadow offset to TSX-local offset
    const tsxOffset = shadowOffset - region.shadowStart;

    const sm = getSourceMap(region);
    // toSourceLocation maps generated (TSX) offset -> source (pug) offset
    for (const [pugOffset] of sm.toSourceLocation(tsxOffset)) {
      return region.pugTextStart + pugOffset;
    }
    // No mapping found -- unmapped/synthetic position
    return null;
  }

  // Outside all regions -- reverse cumulative delta
  const idx = findPrecedingRegionIndex(regions, shadowOffset, 'shadowStart');
  if (idx < 0) {
    // Before all regions -- no delta
    return shadowOffset;
  }

  // Check if we're actually inside this region
  const precedingRegion = regions[idx];
  if (shadowOffset < precedingRegion.shadowEnd) {
    return null;
  }

  // Reverse cumulative delta
  const deltaBeforeIdx = regionDeltas[idx];
  const deltaOfIdx = precedingRegion.tsxText.length - (precedingRegion.originalEnd - precedingRegion.originalStart);
  return shadowOffset - deltaBeforeIdx - deltaOfIdx;
}
