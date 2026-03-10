import { SourceMap } from '@volar/source-map';
import type {
  CodeInformation,
  PugDocument,
  PugRegion,
  ShadowCopySegment,
  ShadowMappedRegion,
} from './mapping';

const sourceMapCache = new WeakMap<ShadowMappedRegion, SourceMap<CodeInformation>>();

function getSourceMap(region: ShadowMappedRegion): SourceMap<CodeInformation> {
  let sm = sourceMapCache.get(region);
  if (!sm) {
    sm = new SourceMap<CodeInformation>(region.mappings);
    sourceMapCache.set(region, sm);
  }
  return sm;
}

function rawToStrippedOffset(rawText: string, rawOffset: number, commonIndent: number): number | null {
  if (commonIndent === 0) return rawOffset;
  let stripped = 0;
  let raw = 0;
  const lines = rawText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = raw + line.length;
    if (rawOffset <= lineEnd) {
      const colInRaw = rawOffset - raw;
      const indentToRemove = line.trim().length === 0 ? line.length : commonIndent;
      if (indentToRemove > 0 && colInRaw < indentToRemove) return null;
      return stripped + Math.max(0, colInRaw - indentToRemove);
    }
    const indentToRemove = line.trim().length === 0 ? line.length : commonIndent;
    stripped += Math.max(0, line.length - indentToRemove) + 1;
    raw = lineEnd + 1;
  }
  return stripped;
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
      return raw + indentToRemove + (strippedOffset - stripped);
    }
    stripped += strippedLineLen + 1;
    raw += line.length + 1;
  }
  return raw;
}

function findSegmentAtOffset<T>(
  segments: T[],
  offset: number,
  getStart: (segment: T) => number,
  getEnd: (segment: T) => number,
): T | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const segment = segments[mid];
    if (offset < getStart(segment)) {
      hi = mid - 1;
    } else if (offset >= getEnd(segment)) {
      lo = mid + 1;
    } else {
      return segment;
    }
  }
  return null;
}

function getMappedRegionsForRegion(doc: PugDocument, regionIndex: number): ShadowMappedRegion[] {
  return doc.mappedRegions.filter(region => region.regionIndex === regionIndex);
}

export function findRegionAtOriginalOffset(
  doc: PugDocument,
  offset: number,
): PugRegion | null {
  return findSegmentAtOffset(doc.regions, offset, region => region.originalStart, region => region.originalEnd);
}

export function findRegionAtShadowOffset(
  doc: PugDocument,
  offset: number,
): PugRegion | null {
  return findSegmentAtOffset(doc.regions, offset, region => region.shadowStart, region => region.shadowEnd);
}

function findCopySegmentAtOriginalOffset(doc: PugDocument, offset: number): ShadowCopySegment | null {
  return findSegmentAtOffset(doc.copySegments, offset, segment => segment.originalStart, segment => segment.originalEnd);
}

function findCopySegmentAtShadowOffset(doc: PugDocument, offset: number): ShadowCopySegment | null {
  return findSegmentAtOffset(doc.copySegments, offset, segment => segment.shadowStart, segment => segment.shadowEnd);
}

export function originalToShadow(
  doc: PugDocument,
  originalOffset: number,
): number | null {
  if (originalOffset === doc.originalText.length) return doc.shadowText.length;

  const region = findRegionAtOriginalOffset(doc, originalOffset);
  if (region) {
    const regionIndex = doc.regions.indexOf(region);
    const rawOffset = originalOffset - region.pugTextStart;
    if (rawOffset < 0) return null;
    const rawText = doc.originalText.slice(region.pugTextStart, region.pugTextEnd);
    const strippedOffset = rawToStrippedOffset(rawText, rawOffset, region.commonIndent);
    if (strippedOffset == null) return null;

    for (const mappedRegion of getMappedRegionsForRegion(doc, regionIndex)) {
      if (strippedOffset < mappedRegion.sourceStart || strippedOffset >= mappedRegion.sourceEnd) continue;
      const sm = getSourceMap(mappedRegion);
      for (const [generatedOffset] of sm.toGeneratedLocation(strippedOffset)) {
        return mappedRegion.shadowStart + generatedOffset;
      }
    }
    return null;
  }

  const copySegment = findCopySegmentAtOriginalOffset(doc, originalOffset);
  if (!copySegment) return null;
  return copySegment.shadowStart + (originalOffset - copySegment.originalStart);
}

export function shadowToOriginal(
  doc: PugDocument,
  shadowOffset: number,
): number | null {
  if (shadowOffset === doc.shadowText.length) return doc.originalText.length;

  for (const mappedRegion of doc.mappedRegions) {
    if (shadowOffset < mappedRegion.shadowStart || shadowOffset >= mappedRegion.shadowEnd) continue;
    const localOffset = shadowOffset - mappedRegion.shadowStart;
    const sm = getSourceMap(mappedRegion);
    for (const [sourceOffset] of sm.toSourceLocation(localOffset)) {
      const region = doc.regions[mappedRegion.regionIndex];
      const rawText = doc.originalText.slice(region.pugTextStart, region.pugTextEnd);
      const rawOffset = strippedToRawOffset(rawText, sourceOffset, region.commonIndent);
      return region.pugTextStart + rawOffset;
    }
  }

  const copySegment = findCopySegmentAtShadowOffset(doc, shadowOffset);
  if (!copySegment) return null;
  return copySegment.originalStart + (shadowOffset - copySegment.shadowStart);
}
