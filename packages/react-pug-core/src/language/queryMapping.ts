import type { PugDocument } from './mapping';
import type { OffsetRange } from './diagnosticMapping';
import { findRegionAtOriginalOffset, originalToShadow, shadowToOriginal } from './positionMapping';

export interface OffsetSpan {
  start: number;
  length: number;
}

export interface EncodedClassificationsLike {
  spans: number[];
  endOfLineState: number;
}

export function mapOriginalSpanToShadow(doc: PugDocument, span: OffsetSpan): OffsetRange | null {
  const shadowStart = originalToShadow(doc, span.start);
  const shadowEnd = originalToShadow(doc, span.start + span.length);
  if (shadowStart == null || shadowEnd == null || shadowEnd < shadowStart) return null;
  return {
    start: shadowStart,
    end: shadowEnd,
    length: shadowEnd - shadowStart,
  };
}

export function mapShadowSpanToOriginal(doc: PugDocument, span: OffsetSpan): OffsetRange | null {
  const originalStart = shadowToOriginal(doc, span.start);
  if (originalStart == null) return null;

  const originalEnd = shadowToOriginal(doc, span.start + span.length);
  const mappedLength = (
    originalEnd != null && originalEnd >= originalStart
      ? originalEnd - originalStart
      : span.length
  );

  return {
    start: originalStart,
    end: originalStart + mappedLength,
    length: mappedLength,
  };
}

export function mapEncodedClassificationsToOriginal(
  doc: PugDocument,
  requestedOriginalSpan: OffsetSpan,
  classifications: EncodedClassificationsLike,
): EncodedClassificationsLike {
  const originalStart = requestedOriginalSpan.start;
  const originalEnd = requestedOriginalSpan.start + requestedOriginalSpan.length;
  const maxOriginal = doc.originalText.length;
  const mappedSpans: number[] = [];
  const encoded = classifications.spans ?? [];

  for (let i = 0; i + 2 < encoded.length; i += 3) {
    const shadowStart = encoded[i];
    const shadowLength = encoded[i + 1];
    const classification = encoded[i + 2];
    if (!Number.isFinite(shadowStart) || !Number.isFinite(shadowLength) || shadowLength <= 0) continue;

    const mappedStart = shadowToOriginal(doc, shadowStart);
    const mappedEnd = shadowToOriginal(doc, shadowStart + shadowLength);
    if (mappedStart == null || mappedEnd == null) continue;

    let start = mappedStart;
    let end = mappedEnd;
    if (end <= start) continue;

    if (end <= originalStart || start >= originalEnd) continue;
    if (start < originalStart) start = originalStart;
    if (end > originalEnd) end = originalEnd;
    if (start < 0) start = 0;
    if (end > maxOriginal) end = maxOriginal;

    const length = end - start;
    if (length <= 0) continue;

    mappedSpans.push(start, length, classification);
  }

  return {
    spans: mappedSpans,
    endOfLineState: classifications.endOfLineState,
  };
}

export function mapOriginalOffsetToNearbyShadowOnSameLine(
  doc: PugDocument,
  position: number,
  maxRadius: number = 3,
): number | null {
  const mapped = originalToShadow(doc, position);
  if (mapped != null) return mapped;

  const region = findRegionAtOriginalOffset(doc, position);
  if (!region) return null;
  if (position < region.pugTextStart || position > region.pugTextEnd) return null;

  const lineStart = doc.originalText.lastIndexOf('\n', position - 1) + 1;
  const lineEndIdx = doc.originalText.indexOf('\n', position);
  const lineEnd = lineEndIdx >= 0 ? lineEndIdx : doc.originalText.length;

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    const left = position - radius;
    if (left >= lineStart) {
      const leftMapped = originalToShadow(doc, left);
      if (leftMapped != null) {
        if (left === position - 1) {
          const ch = doc.originalText[position] ?? '';
          if (/\s|[),]/.test(ch)) {
            return Math.min(leftMapped + 1, doc.shadowText.length);
          }
        }
        return leftMapped;
      }
    }

    const right = position + radius;
    if (right <= lineEnd) {
      const rightMapped = originalToShadow(doc, right);
      if (rightMapped != null) return rightMapped;
    }
  }

  return null;
}
