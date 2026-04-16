import type { PugDocument, PugRegion } from './mapping';

export function rawToStrippedOffset(rawText: string, rawOffset: number, commonIndent: number): number | null {
  if (commonIndent === 0) return rawOffset;
  let stripped = 0;
  let raw = 0;
  const lines = rawText.split('\n');
  for (const line of lines) {
    const lineEnd = raw + line.length;
    const actualIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    const indentToRemove = line.trim().length === 0 ? line.length : Math.min(commonIndent, actualIndent);
    if (rawOffset <= lineEnd) {
      const colInRaw = rawOffset - raw;
      if (indentToRemove > 0 && colInRaw < indentToRemove) return null;
      return stripped + Math.max(0, colInRaw - indentToRemove);
    }
    stripped += Math.max(0, line.length - indentToRemove) + 1;
    raw = lineEnd + 1;
  }
  return stripped;
}

export function strippedToRawOffset(rawText: string, strippedOffset: number, commonIndent: number): number {
  if (commonIndent === 0) return strippedOffset;
  let stripped = 0;
  let raw = 0;
  const lines = rawText.split('\n');
  for (const line of lines) {
    const actualIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    const indentToRemove = line.trim().length === 0 ? line.length : Math.min(commonIndent, actualIndent);
    const strippedLineLength = Math.max(0, line.length - indentToRemove);
    if (strippedOffset <= stripped + strippedLineLength) {
      return raw + indentToRemove + (strippedOffset - stripped);
    }
    stripped += strippedLineLength + 1;
    raw += line.length + 1;
  }
  return raw;
}

export function originalOffsetToRegionStrippedOffset(
  doc: PugDocument,
  region: PugRegion,
  originalOffset: number,
): number | null {
  const rawOffset = originalOffset - region.pugTextStart;
  if (rawOffset < 0) return null;
  const rawText = doc.originalText.slice(region.pugTextStart, region.pugTextEnd);
  return rawToStrippedOffset(rawText, rawOffset, region.commonIndent);
}

export function regionStrippedOffsetToOriginalOffset(
  doc: PugDocument,
  region: PugRegion,
  strippedOffset: number,
): number {
  const rawText = doc.originalText.slice(region.pugTextStart, region.pugTextEnd);
  return region.pugTextStart + strippedToRawOffset(rawText, strippedOffset, region.commonIndent);
}
