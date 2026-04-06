import { describe, expect, it } from 'vitest'
import {
  buildExpressionBoundaryMap,
  collectMappedInsertionRangesByKind,
  createLintTransform,
  createFormattingWrapper,
  extractFormattedExpressionFromWrapper,
  normalizePugExpressionForLint,
  rewriteSegmentedPugRegions,
} from '../../src/language/lintTransform'

function remapSnippet (source: string, generated: string, snippet: string, mapper: (offset: number) => number | null): string | null {
  const generatedOffset = generated.indexOf(snippet)
  expect(generatedOffset).toBeGreaterThanOrEqual(0)
  const originalOffset = mapper(generatedOffset)
  if (originalOffset == null) return null
  return source.slice(originalOffset, originalOffset + snippet.length)
}

describe('lintTransform', () => {
  it('normalizes attrless Fragment elements to JSX fragment shorthand', () => {
    const result = normalizePugExpressionForLint('<Fragment><span>Ok</span></Fragment>', 'file.jsx')

    expect(result.code).toBe('<><span>Ok</span></>')
    expect(result.boundaryMap).toHaveLength(result.code.length + 1)
  })

  it('normalizes repeated ternaries into logical fallback expressions when safe', () => {
    const result = normalizePugExpressionForLint('children ? children : <span>Fallback</span>', 'file.jsx')

    expect(result.code).toBe('children || <span>Fallback</span>')
    expect(result.boundaryMap).toHaveLength(result.code.length + 1)
  })

  it('keeps non-repeatable ternaries unchanged', () => {
    const result = normalizePugExpressionForLint('getValue() ? getValue() : fallback', 'file.jsx')

    expect(result.code).toBe('getValue() ? getValue() : fallback')
  })

  it('rewrites only pug regions and leaves plain JSX untouched', () => {
    const source = [
      "import { Fragment, pug } from 'startupjs'",
      'const plain = <Fragment><span>Plain</span></Fragment>',
      'const view = pug`',
      '  Fragment',
      '    span Pug',
      '`',
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')

    expect(result.code).toContain('const plain = <Fragment><span>Plain</span></Fragment>')
    expect(result.code).toContain('const view = <><span>Pug</span></>')
  })

  it('maps rewritten fragment output back to original pug source', () => {
    const source = [
      "import { Fragment, pug } from 'startupjs'",
      'const view = pug`',
      '  Fragment',
      '    Button Save',
      '`',
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')

    expect(remapSnippet(source, result.code, 'Button', result.mapGeneratedOffsetToOriginal)).toBe('Button')
    expect(remapSnippet(source, result.code, 'Save', result.mapGeneratedOffsetToOriginal)).toBe('Save')
  })

  it('maps rewritten logical fallback output back to original pug source', () => {
    const source = [
      "import { pug } from 'startupjs'",
      'function Demo ({ children }) {',
      '  return pug`',
      '    if children',
      '      = children',
      '    else',
      '      span Fallback',
      '  `',
      '}',
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')

    expect(result.code).toContain('children || <span>Fallback</span>')
    expect(remapSnippet(source, result.code, 'children', result.mapGeneratedOffsetToOriginal)).toBe('children')
    expect(remapSnippet(source, result.code, 'Fallback', result.mapGeneratedOffsetToOriginal)).toBe('Fallback')
  })

  it('classifies ternary branch formatting context structurally', () => {
    const source = [
      "import { pug } from 'startupjs'",
      'const view = condition',
      '  ? pug`',
      '      span Yes',
      '    `',
      "  : <span>No</span>",
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')
    expect(result.regionSegments).toHaveLength(1)
    expect(result.regionSegments[0].formattingContext).toEqual({ containerKind: 'conditional-branch' })
  })

  it('classifies object-property formatting context structurally', () => {
    const source = [
      "import { pug } from 'startupjs'",
      'const config = {',
      '  children: pug`',
      '    span Child',
      '  `',
      '}',
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')
    expect(result.regionSegments).toHaveLength(1)
    expect(result.regionSegments[0].formattingContext).toEqual({ containerKind: 'object-property-value' })
  })

  it('classifies return-value formatting context structurally', () => {
    const source = [
      "import { pug } from 'startupjs'",
      'function Demo () {',
      '  return pug`',
      '    span Demo',
      '  `',
      '}',
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')
    expect(result.regionSegments).toHaveLength(1)
    expect(result.regionSegments[0].formattingContext).toEqual({ containerKind: 'return-value' })
  })

  it('classifies call-argument formatting context structurally', () => {
    const source = [
      "import { pug } from 'startupjs'",
      'render(',
      '  pug`',
      '    span Demo',
      '  `',
      ')',
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')
    expect(result.regionSegments).toHaveLength(1)
    expect(result.regionSegments[0].formattingContext).toEqual({ containerKind: 'call-argument' })
  })

  it('builds a stable boundary map for equivalent expressions', () => {
    const boundaryMap = buildExpressionBoundaryMap('children ? children : <span>Fallback</span>', 'children || <span>Fallback</span>', 'file.jsx')
    expect(boundaryMap).toHaveLength('children || <span>Fallback</span>'.length + 1)
    expect(boundaryMap[0]).toBe(0)
    expect(boundaryMap[boundaryMap.length - 1]).toBe('children ? children : <span>Fallback</span>'.length)
  })

  it('extracts a multiline conditional branch expression from a formatting wrapper', () => {
    const wrapper = createFormattingWrapper('<Tag color=\'error\'>No photo</Tag>', 'conditional-branch')
    expect(wrapper).toContain('__cond ?')

    const extracted = extractFormattedExpressionFromWrapper(
      [
        'const __ctx = __cond ? (',
        '  <Tag color=\'error\'>No photo</Tag>',
        ') : __alt',
        '',
      ].join('\n'),
      'conditional-branch',
      'file.jsx',
    )

    expect(extracted).toEqual({
      code: "(\n  <Tag color='error'>No photo</Tag>\n)",
      wrapperLineIndentWidth: 0,
    })
  })

  it('extracts an object-property expression from a formatting wrapper', () => {
    const extracted = extractFormattedExpressionFromWrapper(
      [
        'const __ctx = {',
        '  value: (',
        '    <Prompt',
        '      title=\'Hello\'',
        '    />',
        '  )',
        '}',
        '',
      ].join('\n'),
      'object-property-value',
      'file.jsx',
    )

    expect(extracted).toEqual({
      code: "(\n    <Prompt\n      title='Hello'\n    />\n  )",
      wrapperLineIndentWidth: 2,
    })
  })

  it('can rewrite already-segmented pug regions again while preserving mapping to the previous transform', () => {
    const source = [
      "import { pug } from 'startupjs'",
      'const config = {',
      '  children: pug`',
      '    span Child',
      '  `',
      '}',
    ].join('\n')

    const linted = createLintTransform(source, 'file.jsx')
    const formatted = rewriteSegmentedPugRegions(linted, 'file.jsx', (expr) => {
      const code = `(\n  ${expr}\n)`
      return {
        code,
        boundaryMap: buildExpressionBoundaryMap(expr, code, 'file.jsx'),
      }
    })

    expect(formatted.code).toContain('(\n  <span>Child</span>\n)')

    const rewrittenOffset = formatted.code.indexOf('Child')
    expect(rewrittenOffset).toBeGreaterThanOrEqual(0)
    const baseOffset = formatted.mapRewrittenOffsetToBase(rewrittenOffset)
    expect(baseOffset).not.toBeNull()
    expect(linted.code.slice(baseOffset!, baseOffset! + 'Child'.length)).toBe('Child')
  })

  it('exposes mapped synthetic style-call insertion ranges generically', () => {
    const source = [
      "import { pug } from 'startupjs'",
      'export default function Demo () {',
      '  return pug`',
      '    Div Hello',
      "    style(lang='styl')",
      '      .root',
      '        color red',
      '  `',
      '}',
    ].join('\n')

    const result = createLintTransform(source, 'file.jsx')
    const styleCallRanges = collectMappedInsertionRangesByKind(result, 'style-call')

    expect(styleCallRanges).toHaveLength(1)
    const styleCallText = result.code.slice(styleCallRanges[0].start, styleCallRanges[0].end)
    expect(styleCallText).toContain('styl`')
    expect(styleCallText).toContain('.root')
  })
})
