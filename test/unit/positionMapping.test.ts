import { describe, it, expect } from 'vitest';
import { buildShadowDocument } from '../../packages/react-pug-core/src/language/shadowDocument';
import {
  originalToShadow,
  shadowToOriginal,
  findRegionAtOriginalOffset,
  findRegionAtShadowOffset,
} from '../../packages/react-pug-core/src/language/positionMapping';

// Helper to build a PugDocument from source text
function makeDoc(text: string) {
  return buildShadowDocument(text, 'test.tsx', 1);
}

// ── findRegionAtOriginalOffset ──────────────────────────────────

describe('findRegionAtOriginalOffset', () => {
  it('returns null when document has no regions', () => {
    const doc = makeDoc('const x = 1;');
    expect(findRegionAtOriginalOffset(doc, 0)).toBeNull();
    expect(findRegionAtOriginalOffset(doc, 5)).toBeNull();
  });

  it('returns null for offset before the first region', () => {
    const doc = makeDoc('const v = pug`div`;');
    // Position 0 is in 'const v = ', before 'pug`'
    expect(findRegionAtOriginalOffset(doc, 0)).toBeNull();
  });

  it('returns the region for offset inside pug`...`', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];
    // Any offset within [originalStart, originalEnd) should find the region
    expect(findRegionAtOriginalOffset(doc, region.originalStart)).toBe(region);
    expect(findRegionAtOriginalOffset(doc, region.originalStart + 5)).toBe(region);
  });

  it('returns null for offset at exact originalEnd boundary', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];
    // originalEnd is exclusive
    expect(findRegionAtOriginalOffset(doc, region.originalEnd)).toBeNull();
  });

  it('returns null for offset after all regions', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);
    const afterAll = text.indexOf('const end');
    expect(findRegionAtOriginalOffset(doc, afterAll)).toBeNull();
  });

  it('finds correct region among multiple regions', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;\nconst c = pug`Button`;';
    const doc = makeDoc(text);
    expect(doc.regions).toHaveLength(3);

    for (let i = 0; i < doc.regions.length; i++) {
      const r = doc.regions[i];
      const mid = r.originalStart + Math.floor((r.originalEnd - r.originalStart) / 2);
      expect(findRegionAtOriginalOffset(doc, mid)).toBe(r);
    }
  });

  it('returns null for offset between two regions', () => {
    const text = 'const a = pug`div`;\nconst mid = 1;\nconst b = pug`span`;';
    const doc = makeDoc(text);
    const midPos = text.indexOf('const mid');
    expect(findRegionAtOriginalOffset(doc, midPos)).toBeNull();
  });
});

// ── findRegionAtShadowOffset ────────────────────────────────────

describe('findRegionAtShadowOffset', () => {
  it('returns null when document has no regions', () => {
    const doc = makeDoc('const x = 1;');
    expect(findRegionAtShadowOffset(doc, 0)).toBeNull();
  });

  it('returns the region for offset inside shadow TSX span', () => {
    const doc = makeDoc('const v = pug`div`;');
    const region = doc.regions[0];
    expect(findRegionAtShadowOffset(doc, region.shadowStart)).toBe(region);
    expect(findRegionAtShadowOffset(doc, region.shadowStart + 1)).toBe(region);
  });

  it('returns null for offset at exact shadowEnd boundary', () => {
    const doc = makeDoc('const v = pug`div`;');
    const region = doc.regions[0];
    expect(findRegionAtShadowOffset(doc, region.shadowEnd)).toBeNull();
  });

  it('returns null for offset before shadow region', () => {
    const doc = makeDoc('const v = pug`div`;');
    expect(findRegionAtShadowOffset(doc, 0)).toBeNull();
  });

  it('returns null for offset after all shadow regions', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);
    const endInShadow = doc.shadowText.indexOf('const end');
    expect(findRegionAtShadowOffset(doc, endInShadow)).toBeNull();
  });

  it('finds correct region among multiple shadow regions', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;';
    const doc = makeDoc(text);

    for (const region of doc.regions) {
      const mid = region.shadowStart + Math.floor((region.shadowEnd - region.shadowStart) / 2);
      expect(findRegionAtShadowOffset(doc, mid)).toBe(region);
    }
  });
});

// ── originalToShadow: outside regions ───────────────────────────

describe('originalToShadow outside regions', () => {
  it('identity mapping when no regions exist', () => {
    const doc = makeDoc('const x = 1;');
    expect(originalToShadow(doc, 0)).toBe(0);
    expect(originalToShadow(doc, 6)).toBe(6);
    expect(originalToShadow(doc, 12)).toBe(12);
  });

  it('identity mapping for offset before the first region', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    // 'const v = ' is 10 chars, before pug starts
    expect(originalToShadow(doc, 0)).toBe(0);
    expect(originalToShadow(doc, 5)).toBe(5);
  });

  it('applies delta for offset after a single region', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);

    const origEndPos = text.indexOf('const end');
    const shadowPos = originalToShadow(doc, origEndPos);
    expect(shadowPos).not.toBeNull();

    // Verify the shadow position points to 'const end' in shadow text
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 9)).toBe('const end');
  });

  it('applies cumulative delta for offset between two regions', () => {
    const text = 'const a = pug`div`;\nconst mid = 1;\nconst b = pug`span`;';
    const doc = makeDoc(text);

    const midPos = text.indexOf('const mid');
    const shadowPos = originalToShadow(doc, midPos);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 9)).toBe('const mid');
  });

  it('applies cumulative delta for offset after two regions', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;\nconst end = 1;';
    const doc = makeDoc(text);

    const endPos = text.indexOf('const end');
    const shadowPos = originalToShadow(doc, endPos);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 9)).toBe('const end');
  });

  it('applies cumulative delta for offset after three regions', () => {
    const text = [
      'const a = pug`div`;',
      'const b = pug`span`;',
      'const c = pug`Button`;',
      'const end = 1;',
    ].join('\n');
    const doc = makeDoc(text);

    const endPos = text.indexOf('const end');
    const shadowPos = originalToShadow(doc, endPos);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 9)).toBe('const end');
  });
});

// ── originalToShadow: inside region (mapped) ────────────────────

describe('originalToShadow inside region (mapped spans)', () => {
  it('maps tag name to shadow position', () => {
    const text = 'const v = pug`Button`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // 'Button' starts at pugTextStart in the original
    const origOffset = region.pugTextStart;
    const shadowPos = originalToShadow(doc, origOffset);

    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 6)).toBe('Button');
  });

  it('maps attribute name to shadow position', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // 'onClick' is at pugTextStart + 'Button('.length
    const onClickOrigOffset = region.pugTextStart + 'Button('.length;
    const shadowPos = originalToShadow(doc, onClickOrigOffset);

    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 7)).toBe('onClick');
  });

  it('maps attribute value expression to shadow position', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // 'handler' is at pugTextStart + 'Button(onClick='.length
    const handlerOrigOffset = region.pugTextStart + 'Button(onClick='.length;
    const shadowPos = originalToShadow(doc, handlerOrigOffset);

    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 7)).toBe('handler');
  });

  it('maps tag name in second region', () => {
    const text = 'const a = pug`div`;\nconst b = pug`Button`;';
    const doc = makeDoc(text);
    const region = doc.regions[1];

    const origOffset = region.pugTextStart; // 'Button' start
    const shadowPos = originalToShadow(doc, origOffset);

    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 6)).toBe('Button');
  });
});

// ── originalToShadow: inside region (unmapped/synthetic) ────────

describe('originalToShadow inside region (synthetic/unmapped)', () => {
  it('returns null for offset at pug` tag itself', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // 'pug`' is at originalStart; the 'p' of 'pug' is not mapped pug content
    expect(originalToShadow(doc, region.originalStart)).toBeNull();
  });

  it('returns null for offset at backtick', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // The backtick is at pugTextStart - 1
    const backtickOffset = region.pugTextStart - 1;
    if (backtickOffset >= region.originalStart) {
      expect(originalToShadow(doc, backtickOffset)).toBeNull();
    }
  });

  it('returns null for position in whitespace-only pug area (if unmapped)', () => {
    // In multiline pug, leading newlines/spaces before content may not be mapped
    const text = 'const v = pug`\n  div\n`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // The newline after the backtick is at pugTextStart offset 0
    // which is a '\n' character -- may or may not be mapped
    const nlOffset = region.pugTextStart;
    const result = originalToShadow(doc, nlOffset);
    // Result is either null (unmapped) or a valid offset -- just verify it doesn't crash
    expect(result === null || typeof result === 'number').toBe(true);
  });

  it('keeps mapping stable after indented whitespace-only lines inside pug', () => {
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
    expect(shadowToOriginal(doc, condShadow!)).toBe(condOrig);

    const valueOrig = text.indexOf('value');
    const valueShadow = originalToShadow(doc, valueOrig);
    expect(valueShadow).not.toBeNull();
    expect(doc.shadowText.slice(valueShadow!, valueShadow! + 5)).toBe('value');
    expect(shadowToOriginal(doc, valueShadow!)).toBe(valueOrig);
  });

  it('treats offsets inside whitespace-only indentation as unmapped', () => {
    const text = [
      'const view = pug`',
      '  h3 Title',
      '    ',
      '  if cond',
      '`;',
    ].join('\n');
    const doc = makeDoc(text);
    const blankLineStart = text.indexOf('\n    \n') + 1;
    expect(blankLineStart).toBeGreaterThan(0);

    // Inside removed whitespace on a blank line should be unmapped.
    expect(originalToShadow(doc, blankLineStart + 1)).toBeNull();
  });
});

// ── shadowToOriginal: outside regions ───────────────────────────

describe('shadowToOriginal outside regions', () => {
  it('identity mapping when no regions exist', () => {
    const doc = makeDoc('const x = 1;');
    expect(shadowToOriginal(doc, 0)).toBe(0);
    expect(shadowToOriginal(doc, 6)).toBe(6);
  });

  it('identity mapping for position before the first region', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    expect(shadowToOriginal(doc, 0)).toBe(0);
    expect(shadowToOriginal(doc, 5)).toBe(5);
  });

  it('reverses delta for position after a single region', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);

    const shadowEndPos = doc.shadowText.indexOf('const end');
    const origPos = shadowToOriginal(doc, shadowEndPos);
    expect(origPos).not.toBeNull();
    expect(text.slice(origPos!, origPos! + 9)).toBe('const end');
  });

  it('reverses cumulative delta for position after two regions', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;\nconst end = 1;';
    const doc = makeDoc(text);

    const shadowEndPos = doc.shadowText.indexOf('const end');
    const origPos = shadowToOriginal(doc, shadowEndPos);
    expect(origPos).not.toBeNull();
    expect(text.slice(origPos!, origPos! + 9)).toBe('const end');
  });

  it('reverses cumulative delta for position between two regions', () => {
    const text = 'const a = pug`div`;\nconst mid = 1;\nconst b = pug`span`;';
    const doc = makeDoc(text);

    const shadowMidPos = doc.shadowText.indexOf('const mid');
    const origPos = shadowToOriginal(doc, shadowMidPos);
    expect(origPos).not.toBeNull();
    expect(text.slice(origPos!, origPos! + 9)).toBe('const mid');
  });
});

// ── shadowToOriginal: inside region (mapped) ────────────────────

describe('shadowToOriginal inside region (mapped spans)', () => {
  it('maps tag name in shadow back to original', () => {
    const text = 'const v = pug`Button`;';
    const doc = makeDoc(text);

    // Find 'Button' in shadow text within the TSX (after '<')
    const buttonInShadow = doc.shadowText.indexOf('Button');
    const origPos = shadowToOriginal(doc, buttonInShadow);

    expect(origPos).not.toBeNull();
    expect(text.slice(origPos!, origPos! + 6)).toBe('Button');
  });

  it('maps attribute name in shadow back to original', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = makeDoc(text);

    const onClickInShadow = doc.shadowText.indexOf('onClick');
    const origPos = shadowToOriginal(doc, onClickInShadow);

    expect(origPos).not.toBeNull();
    expect(text.slice(origPos!, origPos! + 7)).toBe('onClick');
  });

  it('maps attribute value in shadow back to original', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = makeDoc(text);

    const handlerInShadow = doc.shadowText.indexOf('handler');
    const origPos = shadowToOriginal(doc, handlerInShadow);

    expect(origPos).not.toBeNull();
    expect(text.slice(origPos!, origPos! + 7)).toBe('handler');
  });
});

// ── shadowToOriginal: inside region (synthetic/unmapped) ────────

describe('shadowToOriginal inside region (synthetic/unmapped)', () => {
  it('returns null for synthetic < bracket in shadow', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // The '(' wrapping is synthetic, and '<' in '<div' is synthetic
    expect(shadowToOriginal(doc, region.shadowStart)).toBeNull();
  });

  it('returns null for synthetic /> in shadow', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);

    const closingSlash = doc.shadowText.indexOf('/>');
    if (closingSlash >= 0) {
      const region = findRegionAtShadowOffset(doc, closingSlash);
      if (region) {
        expect(shadowToOriginal(doc, closingSlash)).toBeNull();
      }
    }
  });

  it('returns null for synthetic closing tag in shadow', () => {
    const text = 'const v = pug`div\n  span`;';
    const doc = makeDoc(text);

    const closingDiv = doc.shadowText.indexOf('</div>');
    if (closingDiv >= 0) {
      expect(shadowToOriginal(doc, closingDiv)).toBeNull();
    }
  });
});

// ── Roundtrip tests ─────────────────────────────────────────────

describe('roundtrip: originalToShadow -> shadowToOriginal', () => {
  it('roundtrips tag name', () => {
    const text = 'const v = pug`Button`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    const origOffset = region.pugTextStart; // 'B' of 'Button'
    const shadowPos = originalToShadow(doc, origOffset);
    expect(shadowPos).not.toBeNull();

    const back = shadowToOriginal(doc, shadowPos!);
    expect(back).toBe(origOffset);
  });

  it('roundtrips attribute name', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    const origOffset = region.pugTextStart + 'Button('.length;
    const shadowPos = originalToShadow(doc, origOffset);
    expect(shadowPos).not.toBeNull();

    const back = shadowToOriginal(doc, shadowPos!);
    expect(back).toBe(origOffset);
  });

  it('roundtrips attribute value expression', () => {
    const text = 'const v = pug`Button(onClick=handler)`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    const origOffset = region.pugTextStart + 'Button(onClick='.length;
    const shadowPos = originalToShadow(doc, origOffset);
    expect(shadowPos).not.toBeNull();

    const back = shadowToOriginal(doc, shadowPos!);
    expect(back).toBe(origOffset);
  });

  it('roundtrips position outside regions', () => {
    const text = 'const v = pug`div`;\nconst end = 1;';
    const doc = makeDoc(text);

    const origPos = text.indexOf('const end');
    const shadowPos = originalToShadow(doc, origPos);
    expect(shadowPos).not.toBeNull();

    const back = shadowToOriginal(doc, shadowPos!);
    expect(back).toBe(origPos);
  });

  it('roundtrips position before all regions', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);

    const origPos = 0;
    const shadowPos = originalToShadow(doc, origPos);
    expect(shadowPos).toBe(0);

    const back = shadowToOriginal(doc, shadowPos!);
    expect(back).toBe(0);
  });

  it('roundtrips in second region', () => {
    const text = 'const a = pug`div`;\nconst b = pug`Button`;';
    const doc = makeDoc(text);
    const region = doc.regions[1];

    const origOffset = region.pugTextStart; // 'B' of 'Button'
    const shadowPos = originalToShadow(doc, origOffset);
    expect(shadowPos).not.toBeNull();

    const back = shadowToOriginal(doc, shadowPos!);
    expect(back).toBe(origOffset);
  });

  it('roundtrips after multiple regions', () => {
    const text = [
      'const a = pug`div`;',
      'const b = pug`span`;',
      'const c = pug`Button`;',
      'const end = true;',
    ].join('\n');
    const doc = makeDoc(text);

    const origPos = text.indexOf('const end');
    const shadowPos = originalToShadow(doc, origPos);
    expect(shadowPos).not.toBeNull();

    const back = shadowToOriginal(doc, shadowPos!);
    expect(back).toBe(origPos);
  });
});

// ── Edge cases ──────────────────────────────────────────────────

describe('edge cases', () => {
  it('offset at exact region originalStart boundary', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // originalStart is the start of 'pug`div`'
    const r = findRegionAtOriginalOffset(doc, region.originalStart);
    expect(r).toBe(region);
    // This is the 'p' of 'pug', not mapped pug content
    expect(originalToShadow(doc, region.originalStart)).toBeNull();
  });

  it('offset at exact region originalEnd boundary (exclusive)', () => {
    const text = 'const v = pug`div`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // originalEnd is exclusive -- should NOT be in the region
    expect(findRegionAtOriginalOffset(doc, region.originalEnd)).toBeNull();
  });

  it('offset at exact region shadowStart boundary', () => {
    const doc = makeDoc('const v = pug`div`;');
    const region = doc.regions[0];

    expect(findRegionAtShadowOffset(doc, region.shadowStart)).toBe(region);
  });

  it('offset at exact region shadowEnd boundary (exclusive)', () => {
    const doc = makeDoc('const v = pug`div`;');
    const region = doc.regions[0];

    expect(findRegionAtShadowOffset(doc, region.shadowEnd)).toBeNull();
  });

  it('handles file with pug at very start', () => {
    const text = 'pug`div`';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    expect(region.originalStart).toBe(0);
    expect(findRegionAtOriginalOffset(doc, 0)).toBe(region);
  });

  it('handles file with pug at very end', () => {
    const text = 'const v = pug`div`';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    expect(region.originalEnd).toBe(text.length);
    expect(findRegionAtOriginalOffset(doc, text.length)).toBeNull();
  });

  it('handles adjacent pug templates', () => {
    const text = 'const a = pug`div`;\nconst b = pug`span`;';
    const doc = makeDoc(text);

    // Offset right after first region's closing backtick/semicolon
    const betweenPos = text.indexOf(';\nconst b') + 1;
    expect(findRegionAtOriginalOffset(doc, betweenPos)).toBeNull();
    const shadowPos = originalToShadow(doc, betweenPos);
    expect(shadowPos).not.toBeNull();
  });

  it('all mapped positions in a complex template roundtrip correctly', () => {
    const text = 'const v = pug`Button(onClick=handler, disabled, label="Hi")`;';
    const doc = makeDoc(text);
    const region = doc.regions[0];

    // Test that every mapped span roundtrips
    for (const mapping of region.mappings) {
      const pugOffset = mapping.sourceOffsets[0];
      const origOffset = region.pugTextStart + pugOffset;

      const shadowPos = originalToShadow(doc, origOffset);
      if (shadowPos != null) {
        const back = shadowToOriginal(doc, shadowPos);
        expect(back).toBe(origOffset);
      }
    }
  });
});
