import type { PugDocument, PugRegion, PugTransformError } from './mapping';
import { regionStrippedOffsetToOriginalOffset } from './regionOffsetMapping';

export type PugDocumentIssueKind = 'missing-tag-import' | 'parse-error' | 'transform-error';

export interface PugDocumentIssue {
  kind: PugDocumentIssueKind;
  start: number;
  length: number;
  message: string;
  transformCode?: PugTransformError['code'];
}

function clampDocumentOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  return offset;
}

function nextLineErrorAnchor(text: string, offset: number): number {
  let anchor = clampDocumentOffset(text, offset);
  let remaining = text.slice(anchor);

  if (!remaining.startsWith('\n')) return anchor;

  const nextLineStart = remaining.indexOf('\n') + 1;
  if (nextLineStart <= 0) return anchor;

  const nextLineText = remaining.slice(nextLineStart);
  const indentLength = nextLineText.match(/^\s*/)?.[0].length ?? 0;
  anchor += nextLineStart + indentLength;

  return clampDocumentOffset(text, anchor);
}

function lengthToLineEnd(text: string, offset: number, maxLength: number = 20): number {
  const safeOffset = clampDocumentOffset(text, offset);
  const rest = text.slice(safeOffset);
  const newlineIndex = rest.indexOf('\n');
  return Math.max(1, newlineIndex >= 0 ? newlineIndex : Math.min(rest.length, maxLength));
}

function createParseErrorIssue(doc: PugDocument, region: PugRegion): PugDocumentIssue | null {
  const error = region.parseError;
  if (!error) return null;

  const originalStart = regionStrippedOffsetToOriginalOffset(doc, region, error.offset);
  const anchoredStart = nextLineErrorAnchor(doc.originalText, originalStart);

  return {
    kind: 'parse-error',
    start: anchoredStart,
    length: lengthToLineEnd(doc.originalText, anchoredStart),
    message: error.message,
  };
}

function createTransformErrorIssue(doc: PugDocument, region: PugRegion): PugDocumentIssue | null {
  const error = region.transformError;
  if (!error) return null;

  const start = regionStrippedOffsetToOriginalOffset(doc, region, error.offset);
  const length = error.code === 'style-tag-must-be-last'
    ? 'style'.length
    : lengthToLineEnd(doc.originalText, start);

  return {
    kind: 'transform-error',
    start,
    length,
    message: error.message,
    transformCode: error.code,
  };
}

export function collectPugDocumentIssues(doc: PugDocument): PugDocumentIssue[] {
  const issues: PugDocumentIssue[] = [];

  if (doc.missingTagImport) {
    issues.push({
      kind: 'missing-tag-import',
      start: doc.missingTagImport.start,
      length: doc.missingTagImport.length,
      message: doc.missingTagImport.message,
    });
  }

  for (const region of doc.regions) {
    const parseIssue = createParseErrorIssue(doc, region);
    if (parseIssue) issues.push(parseIssue);

    const transformIssue = createTransformErrorIssue(doc, region);
    if (transformIssue) issues.push(transformIssue);
  }

  return issues;
}
