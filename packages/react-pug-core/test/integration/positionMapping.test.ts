import { describe, it, expect } from 'vitest';
import { buildShadowDocument } from '../../src/language/shadowDocument';
import {
  originalToShadow,
  shadowToOriginal,
  findRegionAtOriginalOffset,
  findRegionAtShadowOffset,
} from '../../src/language/positionMapping';

// ── Helper ─────────────────────────────────────────────────────

function makeDoc(text: string) {
  return buildShadowDocument(text, 'test.tsx', 1);
}

// ── findRegionAtOriginalOffset ─────────────────────────────────

describe('findRegionAtOriginalOffset', () => {
  it('returns null for position before any region', () => {
    const doc = makeDoc('const x = 1;\nconst v = pug`div`;');
    expect(findRegionAtOriginalOffset(doc, 0)).toBeNull();
  });

  it('returns the region for position inside pug`...`', () => {
    const doc = makeDoc('const v = pug`div`;');
    const region = findRegionAtOriginalOffset(doc, 14); // inside 'div'
    expect(region).not.toBeNull();
    expect(region!.pugText).toContain('div');
  });

  it('returns null for position after all regions', () => {
    const doc = makeDoc('const v = pug`div`;\nconst end = 1;');
    const afterRegion = doc.regions[0].originalEnd + 5;
    expect(findRegionAtOriginalOffset(doc, afterRegion)).toBeNull();
  });

  it('returns correct region with multiple regions', () => {
    const doc = makeDoc('const a = pug`div`;\nconst b = pug`span`;');
    // Second region
    const r2 = doc.regions[1];
    const midOfR2 = r2.originalStart + Math.floor((r2.originalEnd - r2.originalStart) / 2);
    expect(findRegionAtOriginalOffset(doc, midOfR2)).toBe(r2);
  });

  it('returns null when no regions exist', () => {
    const doc = makeDoc('const x = 1;');
    expect(findRegionAtOriginalOffset(doc, 0)).toBeNull();
  });
});

// ── findRegionAtShadowOffset ───────────────────────────────────

describe('findRegionAtShadowOffset', () => {
  it('returns the region for position inside shadow TSX', () => {
    const doc = makeDoc('const v = pug`div`;');
    const region = doc.regions[0];
    const mid = region.shadowStart + Math.floor((region.shadowEnd - region.shadowStart) / 2);
    expect(findRegionAtShadowOffset(doc, mid)).toBe(region);
  });

  it('returns null for position outside shadow regions', () => {
    const doc = makeDoc('const v = pug`div`;\nconst end = 1;');
    // Position well past the shadow region
    const afterShadow = doc.regions[0].shadowEnd + 5;
    expect(findRegionAtShadowOffset(doc, afterShadow)).toBeNull();
  });
});

// ── originalToShadow ───────────────────────────────────────────

describe('originalToShadow', () => {
  it('maps position before all regions (identity)', () => {
    const doc = makeDoc('const x = 1;\nconst v = pug`div`;');
    // "const x = 1;" is before the pug region, should map 1:1
    expect(originalToShadow(doc, 0)).toBe(0);
    expect(originalToShadow(doc, 5)).toBe(5);
  });

  it('maps position after a region with delta', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);

    // Find position of 'end' in original
    const endPos = text.indexOf('const end');
    const shadowPos = originalToShadow(doc, endPos);

    expect(shadowPos).not.toBeNull();
    // The shadow position should point to 'const end' in the shadow text
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 9)).toBe('const end');
  });

  it('maps a mapped position inside a pug region', () => {
    // 'Button' tag name should be mapped with FULL_FEATURES
    const text = 'const v = pug`Button`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // 'Button' in original is at pugTextStart (the content inside backticks)
    const buttonOrigOffset = region.pugTextStart; // start of 'Button'
    const shadowPos = originalToShadow(doc, buttonOrigOffset);

    expect(shadowPos).not.toBeNull();
    // In the shadow, it should point to 'Button' inside '<Button />'
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 6)).toBe('Button');
  });

  it('returns null for unmapped position inside a pug region', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // The 'pug' tag identifier or backtick is part of the region but not mapped
    const pugTagOffset = region.originalStart; // 'p' in 'pug`...'
    expect(originalToShadow(doc, pugTagOffset)).toBeNull();
  });

  it('handles no-region documents', () => {
    const doc = makeDoc('const x = 1;');
    expect(originalToShadow(doc, 0)).toBe(0);
    expect(originalToShadow(doc, 5)).toBe(5);
  });

  it('maps position between two regions correctly', () => {
    const text = 'const a = pug`div`;\nconst mid = 42;\nconst b = pug`span`;';
    const doc = makeDoc(text);

    const midPos = text.indexOf('const mid');
    const shadowPos = originalToShadow(doc, midPos);

    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 9)).toBe('const mid');
  });

  it('maps expressions after whitespace-only indented pug lines without shifting', () => {
    const text = [
      'const view = pug`',
      '  h3 Title',
      '    ',
      '  if cond',
      '    span= value',
      '`;',
    ].join('\n');
    const doc = makeDoc(text);

    const condOrig = text.indexOf('cond');
    const condShadow = originalToShadow(doc, condOrig);
    expect(condShadow).not.toBeNull();
    expect(doc.shadowText.slice(condShadow!, condShadow! + 4)).toBe('cond');

    const valueOrig = text.indexOf('value');
    const valueShadow = originalToShadow(doc, valueOrig);
    expect(valueShadow).not.toBeNull();
    expect(doc.shadowText.slice(valueShadow!, valueShadow! + 5)).toBe('value');
  });
});

// ── shadowToOriginal ───────────────────────────────────────────

describe('shadowToOriginal', () => {
  it('maps position before all regions (identity)', () => {
    const doc = makeDoc('const x = 1;\nconst v = pug`div`;');
    expect(shadowToOriginal(doc, 0)).toBe(0);
    expect(shadowToOriginal(doc, 5)).toBe(5);
  });

  it('maps position after a region back to original', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);

    // Find 'const end' in shadow text
    const shadowEndPos = doc.shadowText.indexOf('const end');
    const originalPos = shadowToOriginal(doc, shadowEndPos);

    expect(originalPos).not.toBeNull();
    expect(text.slice(originalPos!, originalPos! + 9)).toBe('const end');
  });

  it('maps a mapped position inside a shadow region back to original', () => {
    const text = 'const v = pug`Button`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // Find 'Button' in the shadow text within the region
    const buttonShadowOffset = doc.shadowText.indexOf('<Button') + 1; // skip '<'
    const originalPos = shadowToOriginal(doc, buttonShadowOffset);

    expect(originalPos).not.toBeNull();
    // Should map back to 'Button' in the original pug content
    expect(text.slice(originalPos!, originalPos! + 6)).toBe('Button');
  });

  it('returns null for unmapped position inside shadow region', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // The '<' in '<div />' is synthetic, not mapped
    expect(shadowToOriginal(doc, region.shadowStart)).toBeNull();
  });

  it('handles no-region documents', () => {
    const doc = makeDoc('const x = 1;');
    expect(shadowToOriginal(doc, 0)).toBe(0);
    expect(shadowToOriginal(doc, 5)).toBe(5);
  });

  it('roundtrips: originalToShadow then shadowToOriginal', () => {
    const text = 'const v = pug`Button(onClick=handler)`;\nconst end = 1;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // Map 'Button' in original -> shadow -> back to original
    const origOffset = region.pugTextStart; // 'B' in 'Button'
    const shadowPos = originalToShadow(doc, origOffset);
    expect(shadowPos).not.toBeNull();

    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(origOffset);
  });

  it('roundtrips for positions outside regions', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);

    const origOffset = text.indexOf('const end');
    const shadowPos = originalToShadow(doc, origOffset);
    expect(shadowPos).not.toBeNull();

    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(origOffset);
  });
});
