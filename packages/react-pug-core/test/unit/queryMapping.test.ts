import { describe, expect, it } from 'vitest';
import { buildShadowDocument } from '../../src/language/shadowDocument';
import {
  originalOffsetToRegionStrippedOffset,
  rawToStrippedOffset,
  regionStrippedOffsetToOriginalOffset,
  strippedToRawOffset,
} from '../../src/language/regionOffsetMapping';
import {
  mapEncodedClassificationsToOriginal,
  mapOriginalOffsetToNearbyShadowOnSameLine,
  mapOriginalSpanToShadow,
  mapShadowSpanToOriginal,
} from '../../src/language/queryMapping';
import { originalToShadow } from '../../src/language/positionMapping';

function makeDoc(text: string) {
  return buildShadowDocument(text, 'test.tsx', 1);
}

describe('regionOffsetMapping helpers', () => {
  it('maps raw and stripped offsets across shared indent', () => {
    const rawText = ['  color red', '  border 1px solid black', ''].join('\n');
    const stripped = rawToStrippedOffset(rawText, rawText.indexOf('border'), 2);
    expect(stripped).toBe('color red\n'.length);
    expect(strippedToRawOffset(rawText, stripped!, 2)).toBe(rawText.indexOf('border'));
  });

  it('returns null when raw offset lands inside removed indent', () => {
    const rawText = '    div Hello';
    expect(rawToStrippedOffset(rawText, 1, 4)).toBeNull();
  });

  it('caps removed indent on dedented lines instead of collapsing later offsets', () => {
    const rawText = ['  Button(', 'Span.text= ${label+suffix}', ''].join('\n');
    const rawOffset = rawText.indexOf('label+suffix');
    const stripped = rawToStrippedOffset(rawText, rawOffset, 2);

    expect(stripped).not.toBeNull();
    expect(strippedToRawOffset(rawText, stripped!, 2)).toBe(rawOffset);
    expect(strippedToRawOffset(rawText, stripped! + 'label+suffix'.length, 2)).toBe(rawOffset + 'label+suffix'.length);
  });

  it('maps original file offsets to stripped region offsets and back', () => {
    const source = ['const view = pug`', '  Button(onClick=handler)', '`;'].join('\n');
    const doc = makeDoc(source);
    const region = doc.regions[0];
    const handlerOriginalOffset = source.indexOf('handler');
    const strippedOffset = originalOffsetToRegionStrippedOffset(doc, region, handlerOriginalOffset);

    expect(strippedOffset).not.toBeNull();
    expect(region.pugText.slice(strippedOffset!, strippedOffset! + 'handler'.length)).toBe('handler');
    expect(regionStrippedOffsetToOriginalOffset(doc, region, strippedOffset!)).toBe(handlerOriginalOffset);
  });
});

describe('queryMapping helpers', () => {
  it('maps original spans to shadow spans and back', () => {
    const source = ['const view = pug`', '  Button(onClick=handler)', '`;'].join('\n');
    const doc = makeDoc(source);
    const handlerOriginalOffset = source.indexOf('handler');

    const shadowSpan = mapOriginalSpanToShadow(doc, {
      start: handlerOriginalOffset,
      length: 'handler'.length,
    });

    expect(shadowSpan).not.toBeNull();
    expect(doc.shadowText.slice(shadowSpan!.start, shadowSpan!.end)).toBe('handler');

    const originalSpan = mapShadowSpanToOriginal(doc, {
      start: shadowSpan!.start,
      length: shadowSpan!.length,
    });

    expect(originalSpan).toEqual({
      start: handlerOriginalOffset,
      end: handlerOriginalOffset + 'handler'.length,
      length: 'handler'.length,
    });
  });

  it('maps shadow spans back when the trailing boundary is synthetic', () => {
    const source = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'const view = pug`',
      '  Button(o)',
      '`;',
    ].join('\n');
    const doc = makeDoc(source);
    const cursor = source.indexOf('Button(o') + 'Button(o'.length;
    const shadowStart = originalToShadow(doc, cursor);

    expect(shadowStart).not.toBeNull();
    expect(mapShadowSpanToOriginal(doc, { start: shadowStart!, length: 1 })).toEqual({
      start: cursor,
      end: cursor + 1,
      length: 1,
    });
  });

  it('returns null for unmapped original spans', () => {
    const source = 'const view = pug`div`;';
    const doc = makeDoc(source);
    const pugOffset = source.indexOf('pug`');

    expect(mapOriginalSpanToShadow(doc, { start: pugOffset, length: 3 })).toBeNull();
  });

  it('maps encoded classifications back to original offsets', () => {
    const source = ['const view = pug`', '  Button(onClick=handler)', '`;'].join('\n');
    const doc = makeDoc(source);
    const handlerOriginalOffset = source.indexOf('handler');
    const handlerShadowOffset = originalToShadow(doc, handlerOriginalOffset);
    expect(handlerShadowOffset).not.toBeNull();

    const mapped = mapEncodedClassificationsToOriginal(
      doc,
      { start: 0, length: source.length },
      { spans: [handlerShadowOffset!, 'handler'.length, 7], endOfLineState: 0 },
    );

    expect(mapped).toEqual({
      spans: [handlerOriginalOffset, 'handler'.length, 7],
      endOfLineState: 0,
    });
  });

  it('finds a nearby mapped shadow offset on the same line for typing positions', () => {
    const source = 'const view = pug`Button(onClick=handler, label="Hi")`;';
    const doc = makeDoc(source);
    const spaceAfterCommaOffset = source.indexOf(',') + 1;

    expect(originalToShadow(doc, spaceAfterCommaOffset)).toBeNull();
    expect(mapOriginalOffsetToNearbyShadowOnSameLine(doc, spaceAfterCommaOffset)).not.toBeNull();
  });
});
