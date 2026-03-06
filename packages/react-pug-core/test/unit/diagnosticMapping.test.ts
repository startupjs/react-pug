import { describe, expect, it } from 'vitest';
import {
  lineColumnToOffset,
  mapGeneratedDiagnosticToOriginal,
  mapGeneratedRangeToOriginal,
  offsetToLineColumn,
} from '../../src/language/diagnosticMapping';
import { transformSourceFile } from '../../src/language/sourceTransform';

describe('diagnosticMapping helpers', () => {
  it('round-trips line/column and offset', () => {
    const text = 'a\nbc\ndef\n';
    const offset = lineColumnToOffset(text, 3, 2);
    const lc = offsetToLineColumn(text, offset);
    expect(offset).toBe(6);
    expect(lc).toEqual({ line: 3, column: 2 });
  });

  it('maps generated ranges outside pug regions as identity', () => {
    const source = 'const alpha = 1;\nconst view = pug`span`;\n';
    const result = transformSourceFile(source, 'file.tsx');
    const idx = result.code.indexOf('alpha');
    const mapped = mapGeneratedRangeToOriginal(result.document, idx, 'alpha'.length);
    expect(mapped).not.toBeNull();
    expect(mapped?.start).toBe(source.indexOf('alpha'));
  });

  it('maps interpolation expression range back to original pug source', () => {
    const source = [
      'const view = pug`',
      '  h3 Active (#{activeTodos.length})',
      '`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx');
    const idx = result.code.indexOf('activeTodos.length');
    const mapped = mapGeneratedRangeToOriginal(result.document, idx, 'activeTodos.length'.length);
    expect(mapped).not.toBeNull();
    const originalSlice = source.slice(mapped!.start, mapped!.end);
    expect(originalSlice).toContain('activeTodos.length');
  });

  it('maps unbuffered code line expression range back to original pug source', () => {
    const source = [
      'const view = pug`',
      '  - const x = activeTodos[0]',
      '  span= x.text',
      '`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx');
    const idx = result.code.indexOf('activeTodos[0]');
    const mapped = mapGeneratedRangeToOriginal(result.document, idx, 'activeTodos[0]'.length);
    expect(mapped).not.toBeNull();
    const originalSlice = source.slice(mapped!.start, mapped!.end);
    expect(originalSlice).toContain('activeTodos[0]');
  });

  it('maps generated diagnostic metadata to original line/column', () => {
    const source = [
      'const first = pug`span= one`;',
      'const second = pug`span= two`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx');
    const idx = result.code.indexOf('two');
    const mapped = mapGeneratedDiagnosticToOriginal(result.document, {
      start: idx,
      length: 3,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.startLine).toBe(2);
    expect(source.slice(mapped!.start, mapped!.end)).toContain('two');
  });
});
