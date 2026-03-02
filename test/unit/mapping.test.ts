import { describe, it, expect } from 'vitest';
import type { Mapping } from '@volar/source-map';
import {
  FULL_FEATURES,
  CSS_CLASS,
  SYNTHETIC,
  VERIFY_ONLY,
  type CodeInformation,
  type CodeMapping,
  type PugRegion,
  type PugDocument,
  type PugParseError,
  type PugToken,
} from '../../src/language/mapping';

// Test checklist:
// [x] FULL_FEATURES has all four flags true
// [x] CSS_CLASS has all four flags false
// [x] SYNTHETIC has all four flags false
// [x] VERIFY_ONLY has completion false, navigation/verification/semantic true
// [x] All presets have exactly the four required keys
// [x] CodeMapping type is compatible with @volar/source-map Mapping<CodeInformation>
// [x] Presets can be used as Mapping data (type compatibility)
// [x] PugRegion interface has all required fields (validated via satisfies)
// [x] PugDocument interface has all required fields (validated via satisfies)
// [x] PugParseError interface has all required fields
// [x] PugToken interface has all required fields
// [x] CSS_CLASS and SYNTHETIC have identical values but are distinct objects

const PRESET_KEYS = ['completion', 'navigation', 'verification', 'semantic'] as const;

// ── CodeInformation preset tests ─────────────────────────────────

describe('CodeInformation presets', () => {
  it('FULL_FEATURES has all four flags true', () => {
    expect(FULL_FEATURES.completion).toBe(true);
    expect(FULL_FEATURES.navigation).toBe(true);
    expect(FULL_FEATURES.verification).toBe(true);
    expect(FULL_FEATURES.semantic).toBe(true);
  });

  it('CSS_CLASS has all four flags false', () => {
    expect(CSS_CLASS.completion).toBe(false);
    expect(CSS_CLASS.navigation).toBe(false);
    expect(CSS_CLASS.verification).toBe(false);
    expect(CSS_CLASS.semantic).toBe(false);
  });

  it('SYNTHETIC has all four flags false', () => {
    expect(SYNTHETIC.completion).toBe(false);
    expect(SYNTHETIC.navigation).toBe(false);
    expect(SYNTHETIC.verification).toBe(false);
    expect(SYNTHETIC.semantic).toBe(false);
  });

  it('VERIFY_ONLY has completion false, navigation/verification/semantic true', () => {
    expect(VERIFY_ONLY.completion).toBe(false);
    expect(VERIFY_ONLY.navigation).toBe(true);
    expect(VERIFY_ONLY.verification).toBe(true);
    expect(VERIFY_ONLY.semantic).toBe(true);
  });

  it('all presets have exactly the four required keys', () => {
    for (const preset of [FULL_FEATURES, CSS_CLASS, SYNTHETIC, VERIFY_ONLY]) {
      const keys = Object.keys(preset).sort();
      expect(keys).toEqual([...PRESET_KEYS].sort());
    }
  });

  it('CSS_CLASS and SYNTHETIC have identical values but are distinct objects', () => {
    expect(CSS_CLASS).toEqual(SYNTHETIC);
    expect(CSS_CLASS).not.toBe(SYNTHETIC);
  });

  it('all preset values are booleans (not truthy/falsy)', () => {
    for (const preset of [FULL_FEATURES, CSS_CLASS, SYNTHETIC, VERIFY_ONLY]) {
      for (const key of PRESET_KEYS) {
        expect(typeof preset[key]).toBe('boolean');
      }
    }
  });
});

// ── Type compatibility tests ─────────────────────────────────────

describe('type compatibility', () => {
  it('CodeMapping is assignable to Mapping<CodeInformation>', () => {
    // This test validates at runtime that a CodeMapping-shaped object
    // conforms to Volar's Mapping<CodeInformation> structure.
    const mapping: CodeMapping = {
      sourceOffsets: [0],
      generatedOffsets: [10],
      lengths: [5],
      data: FULL_FEATURES,
    };

    // Verify the Volar Mapping fields are present
    expect(mapping.sourceOffsets).toEqual([0]);
    expect(mapping.generatedOffsets).toEqual([10]);
    expect(mapping.lengths).toEqual([5]);
    expect(mapping.data).toBe(FULL_FEATURES);
  });

  it('CodeMapping supports optional generatedLengths', () => {
    const mapping: CodeMapping = {
      sourceOffsets: [0, 10],
      generatedOffsets: [5, 20],
      lengths: [3, 7],
      generatedLengths: [4, 8],
      data: VERIFY_ONLY,
    };

    expect(mapping.generatedLengths).toEqual([4, 8]);
  });

  it('presets can be used as Mapping data field', () => {
    // Each preset should work as the data parameter in a Mapping
    for (const preset of [FULL_FEATURES, CSS_CLASS, SYNTHETIC, VERIFY_ONLY]) {
      const mapping: Mapping<CodeInformation> = {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [1],
        data: preset,
      };
      expect(mapping.data).toBe(preset);
    }
  });
});

// ── Interface structure tests ────────────────────────────────────

describe('interface structures', () => {
  it('PugRegion has all required fields', () => {
    // Construct a minimal valid PugRegion to verify the interface shape
    const region: PugRegion = {
      originalStart: 0,
      originalEnd: 50,
      pugTextStart: 4,
      pugTextEnd: 49,
      pugText: '  div Hello',
      shadowStart: 0,
      shadowEnd: 30,
      tsxText: '(<div>Hello</div>)',
      mappings: [],
      lexerTokens: [],
      parseError: null,
    };

    expect(region.originalStart).toBe(0);
    expect(region.originalEnd).toBe(50);
    expect(region.pugTextStart).toBe(4);
    expect(region.pugTextEnd).toBe(49);
    expect(region.pugText).toBe('  div Hello');
    expect(region.shadowStart).toBe(0);
    expect(region.shadowEnd).toBe(30);
    expect(region.tsxText).toBe('(<div>Hello</div>)');
    expect(region.mappings).toEqual([]);
    expect(region.lexerTokens).toEqual([]);
    expect(region.parseError).toBeNull();
  });

  it('PugRegion accepts a PugParseError', () => {
    const error: PugParseError = {
      message: 'Unexpected token',
      line: 2,
      column: 5,
      offset: 15,
    };

    const region: PugRegion = {
      originalStart: 0,
      originalEnd: 50,
      pugTextStart: 4,
      pugTextEnd: 49,
      pugText: '  div\n  !!!',
      shadowStart: 0,
      shadowEnd: 0,
      tsxText: '',
      mappings: [],
      lexerTokens: [],
      parseError: error,
    };

    expect(region.parseError).toBe(error);
    expect(region.parseError!.message).toBe('Unexpected token');
    expect(region.parseError!.line).toBe(2);
    expect(region.parseError!.column).toBe(5);
    expect(region.parseError!.offset).toBe(15);
  });

  it('PugRegion accepts PugToken array', () => {
    const token: PugToken = {
      type: 'tag',
      loc: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 4 },
      },
      val: 'div',
    };

    const region: PugRegion = {
      originalStart: 0,
      originalEnd: 10,
      pugTextStart: 4,
      pugTextEnd: 9,
      pugText: 'div',
      shadowStart: 0,
      shadowEnd: 8,
      tsxText: '<div />',
      mappings: [],
      lexerTokens: [token],
      parseError: null,
    };

    expect(region.lexerTokens).toHaveLength(1);
    expect(region.lexerTokens[0].type).toBe('tag');
    expect(region.lexerTokens[0].val).toBe('div');
    expect(region.lexerTokens[0].loc.start.line).toBe(1);
  });

  it('PugToken val field is optional', () => {
    const token: PugToken = {
      type: 'newline',
      loc: {
        start: { line: 1, column: 4 },
        end: { line: 2, column: 1 },
      },
    };

    expect(token.val).toBeUndefined();
    expect(token.type).toBe('newline');
  });

  it('PugDocument has all required fields', () => {
    const doc: PugDocument = {
      originalText: 'const v = pug`\n  div\n`',
      uri: 'file:///app.tsx',
      regions: [],
      shadowText: 'const v = (<div />)',
      version: 1,
      regionDeltas: [],
    };

    expect(doc.originalText).toContain('pug`');
    expect(doc.uri).toBe('file:///app.tsx');
    expect(doc.regions).toEqual([]);
    expect(doc.shadowText).toContain('<div');
    expect(doc.version).toBe(1);
    expect(doc.regionDeltas).toEqual([]);
  });

  it('PugDocument regions contains PugRegion array', () => {
    const region: PugRegion = {
      originalStart: 10,
      originalEnd: 25,
      pugTextStart: 14,
      pugTextEnd: 24,
      pugText: 'div Hello',
      shadowStart: 10,
      shadowEnd: 28,
      tsxText: '(<div>Hello</div>)',
      mappings: [{
        sourceOffsets: [0],
        generatedOffsets: [1],
        lengths: [3],
        data: FULL_FEATURES,
      }],
      lexerTokens: [],
      parseError: null,
    };

    const doc: PugDocument = {
      originalText: 'const v = pug`div Hello`',
      uri: 'file:///test.tsx',
      regions: [region],
      shadowText: 'const v = (<div>Hello</div>)',
      version: 1,
      regionDeltas: [0],
    };

    expect(doc.regions).toHaveLength(1);
    expect(doc.regions[0].mappings).toHaveLength(1);
    expect(doc.regions[0].mappings[0].data).toBe(FULL_FEATURES);
    expect(doc.regionDeltas).toEqual([0]);
  });
});
