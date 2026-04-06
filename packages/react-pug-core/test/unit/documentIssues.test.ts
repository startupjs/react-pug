import { describe, expect, it } from 'vitest';
import type { PugDocument, PugRegion } from '../../src/language/mapping';
import { collectPugDocumentIssues } from '../../src/language/documentIssues';

function createRegion(overrides: Partial<PugRegion>): PugRegion {
  return {
    originalStart: 0,
    originalEnd: 0,
    pugTextStart: 0,
    pugTextEnd: 0,
    pugText: '',
    commonIndent: 0,
    shadowStart: 0,
    shadowEnd: 0,
    tsxText: '',
    mappings: [],
    lexerTokens: [],
    parseError: null,
    transformError: null,
    styleBlock: null,
    ...overrides,
  };
}

function createDoc(
  originalText: string,
  region: PugRegion,
  missingTagImport: PugDocument['missingTagImport'] = null,
): PugDocument {
  return {
    originalText,
    uri: 'test.tsx',
    regions: [region],
    importCleanups: [],
    copySegments: [],
    mappedRegions: [],
    insertions: [],
    shadowText: originalText,
    version: 1,
    regionDeltas: [],
    usesTagFunction: true,
    hasTagImport: !missingTagImport,
    missingTagImport,
  };
}

describe('collectPugDocumentIssues', () => {
  it('collects missing import issues directly from document metadata', () => {
    const source = 'const view = pug`div`;';
    const region = createRegion({
      originalStart: source.indexOf('pug`'),
      originalEnd: source.lastIndexOf('`') + 1,
      pugTextStart: source.indexOf('div'),
      pugTextEnd: source.indexOf('div') + 'div'.length,
      pugText: 'div',
      shadowStart: source.indexOf('pug`'),
      shadowEnd: source.indexOf('pug`') + '<div />'.length,
    });
    const issues = collectPugDocumentIssues(
      createDoc(source, region, {
        message: 'Missing import for tag function "pug"',
        start: source.indexOf('pug`'),
        length: 'pug'.length,
      }),
    );

    expect(issues).toEqual([{
      kind: 'missing-tag-import',
      start: source.indexOf('pug`'),
      length: 'pug'.length,
      message: 'Missing import for tag function "pug"',
    }]);
  });

  it('anchors parse errors that point at a newline to the next content line', () => {
    const source = [
      'const view = pug`',
      '  div(',
      '`;',
    ].join('\n');
    const pugTextStart = source.indexOf('`') + 1;
    const pugTextEnd = source.lastIndexOf('`');
    const region = createRegion({
      originalStart: source.indexOf('pug`'),
      originalEnd: source.lastIndexOf('`') + 1,
      pugTextStart,
      pugTextEnd,
      pugText: '\ndiv(\n',
      commonIndent: 2,
      parseError: {
        message: 'Unexpected end of input',
        line: 1,
        column: 1,
        offset: 0,
      },
    });

    const issues = collectPugDocumentIssues(createDoc(source, region));

    expect(issues).toEqual([{
      kind: 'parse-error',
      start: source.indexOf('div('),
      length: 'div('.length,
      message: 'Unexpected end of input',
    }]);
  });

  it('uses the style keyword length for style-tag-must-be-last transform errors', () => {
    const source = 'const view = pug`style\\n  .x\\nspan`;';
    const pugTextStart = source.indexOf('style');
    const pugTextEnd = source.lastIndexOf('`');
    const region = createRegion({
      originalStart: source.indexOf('pug`'),
      originalEnd: source.lastIndexOf('`') + 1,
      pugTextStart,
      pugTextEnd,
      pugText: 'style\\n  .x\\nspan',
      transformError: {
        code: 'style-tag-must-be-last',
        message: 'style tags must be the last top-level node',
        line: 1,
        column: 1,
        offset: 0,
      },
    });

    const issues = collectPugDocumentIssues(createDoc(source, region));

    expect(issues).toEqual([{
      kind: 'transform-error',
      start: source.indexOf('style'),
      length: 'style'.length,
      message: 'style tags must be the last top-level node',
      transformCode: 'style-tag-must-be-last',
    }]);
  });
});
