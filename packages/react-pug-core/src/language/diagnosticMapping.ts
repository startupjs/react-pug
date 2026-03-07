import type { PugDocument } from './mapping';
import { shadowToOriginal } from './positionMapping';

export interface LineColumn {
  line: number;
  column: number;
}

export interface OffsetRange {
  start: number;
  end: number;
  length: number;
}

export interface GeneratedDiagnosticLike {
  start: number;
  length: number;
}

export interface OriginalDiagnosticLocation extends OffsetRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

function clampOffset(offset: number, length: number): number {
  if (offset <= 0) return 0;
  if (offset >= length) return length;
  return offset;
}

export function offsetToLineColumn(text: string, offset: number): LineColumn {
  const safeOffset = clampOffset(offset, text.length);
  let line = 1;
  let column = 1;

  for (let i = 0; i < safeOffset; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

export function lineColumnToOffset(text: string, line: number, column: number): number {
  if (line <= 1) return Math.max(0, column - 1);

  let currentLine = 1;
  let offset = 0;
  while (offset < text.length && currentLine < line) {
    if (text.charCodeAt(offset) === 10) currentLine += 1;
    offset += 1;
  }

  return Math.min(text.length, offset + Math.max(0, column - 1));
}

function findMappedForward(doc: PugDocument, start: number, endExclusive: number): number | null {
  for (let i = start; i < endExclusive; i += 1) {
    const mapped = shadowToOriginal(doc, i);
    if (mapped != null) return mapped;
  }
  return null;
}

function findMappedBackward(doc: PugDocument, startInclusive: number, endInclusive: number): number | null {
  for (let i = startInclusive; i >= endInclusive; i -= 1) {
    const mapped = shadowToOriginal(doc, i);
    if (mapped != null) return mapped;
  }
  return null;
}

export function mapGeneratedRangeToOriginal(
  doc: PugDocument,
  generatedStart: number,
  generatedLength: number,
): OffsetRange | null {
  const safeStart = clampOffset(generatedStart, doc.shadowText.length);
  const safeEnd = clampOffset(
    safeStart + Math.max(1, generatedLength),
    doc.shadowText.length,
  );

  const directStart = shadowToOriginal(doc, safeStart);
  const directEnd = shadowToOriginal(doc, Math.max(safeStart, safeEnd - 1));

  const mappedStart = directStart ?? findMappedForward(doc, safeStart, safeEnd);
  const mappedEndInclusive = directEnd ?? findMappedBackward(doc, safeEnd - 1, safeStart);

  if (mappedStart == null && mappedEndInclusive == null) return null;

  const start = mappedStart ?? mappedEndInclusive!;
  const end = (mappedEndInclusive ?? mappedStart!) + 1;

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    length: Math.max(1, Math.abs(end - start)),
  };
}

export function mapGeneratedDiagnosticToOriginal(
  doc: PugDocument,
  diagnostic: GeneratedDiagnosticLike,
): OriginalDiagnosticLocation | null {
  const range = mapGeneratedRangeToOriginal(doc, diagnostic.start, diagnostic.length);
  if (!range) return null;

  const startLc = offsetToLineColumn(doc.originalText, range.start);
  const endLc = offsetToLineColumn(doc.originalText, range.end);

  return {
    ...range,
    startLine: startLc.line,
    startColumn: startLc.column,
    endLine: endLc.line,
    endColumn: endLc.column,
  };
}
