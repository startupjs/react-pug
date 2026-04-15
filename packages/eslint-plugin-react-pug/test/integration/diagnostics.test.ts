import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import neostandard from 'neostandard'
import reactPugPlugin from '../../src/index'

const repoRoot = resolve(__dirname, '../../../..')

function offsetToLineColumn(text: string, offset: number) {
  const before = text.slice(0, offset).split('\n')
  return {
    line: before.length,
    column: before[before.length - 1].length + 1,
  }
}

function createProcessorEslint() {
  return new ESLint({
    cwd: repoRoot,
    fix: false,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      ...neostandard({
        ts: true,
      }),
      {
        plugins: {
          'react-pug': reactPugPlugin as any,
        },
        processor: 'react-pug/react-pug',
      },
    ] as any,
  })
}

function expectExactMappedMessage(
  input: string,
  messages: EslintLintMessage[],
  ruleId: string,
  snippet: string,
) {
  const matches = messages.filter((message) => (
    message.ruleId === ruleId
    && message.message.includes(snippet)
  ))

  expect(matches).toHaveLength(1)
  const expectedStart = input.indexOf(snippet)
  expect(expectedStart).toBeGreaterThanOrEqual(0)
  const expected = offsetToLineColumn(input, expectedStart)
  expect(matches[0].line).toBe(expected.line)
  expect(matches[0].column).toBe(expected.column)
  expect(matches[0].endLine).toBe(expected.line)
  expect(matches[0].endColumn).toBe(expected.column + snippet.length)
}

function findLineIndex(lines: string[], snippet: string, fromIndex = 0) {
  const index = lines.findIndex((line, lineIndex) => lineIndex >= fromIndex && line === snippet)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

type EslintLintMessage = Awaited<ReturnType<ESLint['lintText']>>[number]['messages'][number]

describe('eslint processor diagnostic mapping', () => {
  it('suppresses legacy styl tagged-template statement warnings', async () => {
    const filePath = resolve(repoRoot, 'legacy-styl.js')
    const input = [
      "import { pug, styl } from 'startupjs'",
      '',
      'export default function Demo () {',
      '  return pug`',
      '    div Hello',
      '  `',
      '  styl`',
      '    .root',
      '      color red',
      '  `',
      '}',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()

    const [result] = await eslint.lintText(input, { filePath })
    expect(result.messages.some(message => message.ruleId === 'no-unused-expressions')).toBe(false)
    expect(result.messages.some(message => message.ruleId === 'no-unreachable')).toBe(false)
  })

  it('formats transformed pug control flow without stylistic indent diagnostics', async () => {
    const filePath = resolve(repoRoot, 'indent-artifact.js')
    const input = [
      "import { pug, observer, styl } from 'startupjs'",
      "import { Button, Tag } from 'startupjs-ui'",
      '',
      'const providers = [\'github\']',
      '',
      'export default observer(function Demo () {',
      '  const auth = { github: { scopes: { get: () => [\'read:user\'] } } }',
      '  return pug`',
      '    each provider in providers',
      '      Button(',
      '        key=provider',
      '      ) Press',
      "      if provider === 'github'",
      "        if auth.github.scopes.get()?.includes('read:user')",
      "          Tag(color='success') ok",
      '        else',
      '          Button(',
      "            key=provider + '_grant'",
      "            onPress=() => provider",
      '          ) Grant',
      '  `',
      '  styl`',
      '    .button',
      '      width 30u',
      '  `',
      '})',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()

    const [result] = await eslint.lintText(input, { filePath })
    expect(result.messages.some(message => message.ruleId === '@stylistic/indent')).toBe(false)
  })

  it('maps no-unused-vars in the real example App inline handler block to the exact pug location', async () => {
    const filePath = resolve(repoRoot, 'example/src/App.tsx')
    const input = readFileSync(filePath, 'utf8').replace(
      "input(type='checkbox', checked=todo.done, onChange=() => handleToggle(todo.id))",
      [
        "input(type='checkbox', checked=todo.done, onChange=() => {",
        '                const myValue = 5',
        '                return handleToggle(todo.id)',
        '              })',
      ].join('\n'),
    )

    const eslint = createProcessorEslint()

    const [result] = await eslint.lintText(input, { filePath })
    const unused = result.messages.find((message) => (
      message.ruleId === '@typescript-eslint/no-unused-vars'
      && message.message.includes('myValue')
    ))

    expect(unused).toBeTruthy()
    const expectedStart = input.indexOf('myValue')
    const expected = offsetToLineColumn(input, expectedStart)
    expect(unused?.line).toBe(expected.line)
    expect(unused?.column).toBe(expected.column)
    expect(unused?.endLine).toBe(expected.line)
    expect(unused?.endColumn).toBe(expected.column + 'myValue'.length)
  })

  it('does not report false indent diagnostics for nested multiline ternaries inside ${} interpolations', async () => {
    const filePath = resolve(repoRoot, 'nested-template-ternary-indent.js')
    const input = [
      "import { pug } from 'startupjs'",
      'const monthAmount = 10',
      'const yearAmount = 100',
      '',
      'const view = pug`',
      '  Span.text= ${monthAmount != null && yearAmount != null',
      "    ? t(msg`Each business you add is {monthAmount}/month or {yearAmount}/year.`, { monthAmount: '$' + monthAmount, yearAmount: '$' + yearAmount })",
      '    : monthAmount != null',
      "      ? t(msg`Each business you add is {amount}/month.`, { amount: '$' + monthAmount })",
      "      : t(msg`Each business you add is {amount}/year.`, { amount: '$' + yearAmount })",
      '  }',
      '`',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()

    const [result] = await eslint.lintText(input, { filePath })
    expect(result.messages.filter(message => message.ruleId === '@stylistic/indent')).toEqual([])
  })

  it('maps real no-undef inside ${} interpolations to the exact original symbol', async () => {
    const filePath = resolve(repoRoot, 'nested-template-real-error.js')
    const input = [
      "import { pug } from 'startupjs'",
      'const Span = "span"',
      'const t = (value) => value',
      'const msg = (strings) => strings[0]',
      'const monthAmount = 10',
      'const yearAmount = 100',
      '',
      'const view = pug`',
      '  Span.text= ${monthAmount != null && yearAmount != null',
      "    ? t(msg`Each business you add is {monthAmount}/month or {yearAmount}/year.`, { monthAmount: '$' + monthAmount, yearAmount: '$' + yearAmount + unknownSuffix })",
      '    : monthAmount != null',
      "      ? t(msg`Each business you add is {amount}/month.`, { amount: '$' + monthAmount })",
      "      : t(msg`Each business you add is {amount}/year.`, { amount: '$' + yearAmount })",
      '  }',
      '`',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()

    const [result] = await eslint.lintText(input, { filePath })
    const unknown = result.messages.find((message) => (
      message.ruleId === 'no-undef'
      && message.message.includes('unknownSuffix')
    ))

    expect(unknown).toBeTruthy()
    const expectedStart = input.indexOf('unknownSuffix')
    const expected = offsetToLineColumn(input, expectedStart)
    expect(unknown?.line).toBe(expected.line)
    expect(unknown?.column).toBe(expected.column)
    expect(unknown?.endLine).toBe(expected.line)
    expect(unknown?.endColumn).toBe(expected.column + 'unknownSuffix'.length)
  })

  it('reports original indent diagnostics inside ${} interpolations', async () => {
    const filePath = resolve(repoRoot, 'nested-template-source-indent-gap.js')
    const input = [
      "import { pug } from 'startupjs'",
      'const Span = "span"',
      'const t = (value) => value',
      'const msg = (strings) => strings[0]',
      'const monthAmount = 10',
      'const yearAmount = 100',
      '',
      'const view = pug`',
      '  Span.text= ${monthAmount != null && yearAmount != null',
      "          ? t(msg`Each business you add is {monthAmount}/month or {yearAmount}/year.`, { monthAmount: '$' + monthAmount, yearAmount: '$' + yearAmount })",
      '      : monthAmount != null',
      "                  ? t(msg`Each business you add is {amount}/month.`, { amount: '$' + monthAmount })",
      "        : t(msg`Each business you add is {amount}/year.`, { amount: '$' + yearAmount })",
      '  }',
      '`',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()

    const [result] = await eslint.lintText(input, { filePath })
    const indentMessages = result.messages.filter(message => message.ruleId === '@stylistic/indent')
    expect(indentMessages.length).toBeGreaterThan(0)
    expect(indentMessages.every(message => (message.line ?? 0) >= 10 && (message.line ?? 0) <= 13)).toBe(true)
  })

  it('reports original indent diagnostics inside inline handler bodies', async () => {
    const filePath = resolve(repoRoot, 'embedded-handler-indent.js')
    const input = [
      "import { pug } from 'startupjs'",
      'const ready = true',
      'const run = () => {}',
      '',
      'const view = pug`',
      '  Button(',
      '    onClick=() => {',
      '      if (ready) {',
      '            run()',
      '      }',
      '    }',
      '  ) Save',
      '`',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()

    const [result] = await eslint.lintText(input, { filePath })
    const indentMessages = result.messages.filter(message => message.ruleId === '@stylistic/indent')
    expect(indentMessages.length).toBeGreaterThan(0)
    expect(indentMessages.some(message => (message.line ?? 0) >= 8 && (message.line ?? 0) <= 10)).toBe(true)
  })

  it('maps exact no-undef ranges across the embedded JS site matrix, including unbuffered statement lines', async () => {
    const filePath = resolve(repoRoot, 'embedded-site-matrix.js')
    const input = [
      "import { pug } from 'startupjs'",
      "const knownAttr = 'attr'",
      "const knownBuffered = 'buffered'",
      "const knownInterpolation = 'interp'",
      'const knownTemplate = 1',
      'const knownStatement = 2',
      'const ready = true',
      '',
      'export default pug`',
      '  Button(',
      '    label=knownAttr + missingAttrValue',
      '    onClick=() => {',
      '      if (ready) {',
      '        return missingHandlerValue',
      '      }',
      '      return knownAttr',
      '    }',
      '  ) Save',
      '  p= knownBuffered + missingBufferedValue',
      '  p Hello #{knownInterpolation + missingInterpolationValue}',
      '  Span.text= ${knownTemplate + missingTemplateValue}',
      '  - const local = knownStatement + missingStatementValue',
      '  if local',
      '    p Visible',
      '`',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()
    const [result] = await eslint.lintText(input, { filePath })

    expectExactMappedMessage(input, result.messages, 'no-undef', 'missingAttrValue')
    expectExactMappedMessage(input, result.messages, 'no-undef', 'missingHandlerValue')
    expectExactMappedMessage(input, result.messages, 'no-undef', 'missingBufferedValue')
    expectExactMappedMessage(input, result.messages, 'no-undef', 'missingInterpolationValue')
    expectExactMappedMessage(input, result.messages, 'no-undef', 'missingTemplateValue')
    expectExactMappedMessage(input, result.messages, 'no-undef', 'missingStatementValue')
  })

  it.fails('maps exact @typescript-eslint/no-unused-vars ranges across complex embedded TS expression sites', async () => {
    const filePath = resolve(repoRoot, 'embedded-ts-site-matrix.tsx')
    const input = [
      "import { pug } from 'startupjs'",
      "const known = 'ok'",
      "const item = { id: '1' }",
      '',
      'export default pug`',
      '  Button(',
      '    label=((value: string) => {',
      '      const unusedAttrValue = value',
      '      return value',
      '    })(known)',
      '    onClick=() => {',
      '      const unusedHandlerValue = item.id',
      '      return item.id',
      '    }',
      '  ) Save',
      '  p= (() => {',
      '    const unusedBufferedValue = known',
      '    return known',
      '  })()',
      '  p Hello #{(() => {',
      '    const unusedInterpolationValue = known',
      '    return known',
      '  })()}',
      '  Span.text= ${(() => {',
      '    const unusedTemplateValue = known',
      '    return known',
      '  })()}',
      '`',
      '',
    ].join('\n')

    const eslint = createProcessorEslint()
    const [result] = await eslint.lintText(input, { filePath })

    expectExactMappedMessage(input, result.messages, '@typescript-eslint/no-unused-vars', 'unusedAttrValue')
    expectExactMappedMessage(input, result.messages, '@typescript-eslint/no-unused-vars', 'unusedHandlerValue')
    expectExactMappedMessage(input, result.messages, '@typescript-eslint/no-unused-vars', 'unusedBufferedValue')
    expectExactMappedMessage(input, result.messages, '@typescript-eslint/no-unused-vars', 'unusedInterpolationValue')
    expectExactMappedMessage(input, result.messages, '@typescript-eslint/no-unused-vars', 'unusedTemplateValue')
  })

  it.fails('reports source-faithful indent diagnostics across the embedded expression-site matrix without synthetic noise', async () => {
    const filePath = resolve(repoRoot, 'embedded-style-matrix.js')
    const lines = [
      "import { pug } from 'startupjs'",
      'const ready = true',
      'const formatLabel = (value) => value',
      "const fallbackLabel = 'fallback'",
      'const runHandler = () => {}',
      'const runBuffered = () => {}',
      'const runInterpolation = () => {}',
      "const label = 'label'",
      "const suffix = 'suffix'",
      'const count = 1',
      '',
      'export default pug`',
      '  Button(',
      '    label=(',
      '      ready',
      '            ? formatLabel(label)',
      '      : fallbackLabel',
      '    )',
      '    onClick=() => {',
      '      if (ready) {',
      '            runHandler()',
      '      }',
      '      return label',
      '    }',
      '  ) Save',
      '  p= (() => {',
      '    if (ready) {',
      '          runBuffered()',
      '    }',
      '    return label',
      '  })()',
      '  p Hello #{(() => {',
      '    if (ready) {',
      '          runInterpolation()',
      '    }',
      '    return suffix',
      '  })()}',
      '  Span.text= ${count',
      '          ? label',
      '    : suffix',
      '  }',
      '`',
      '',
    ]
    const input = lines.join('\n')
    const eslint = createProcessorEslint()
    const [result] = await eslint.lintText(input, { filePath })
    const indentMessages = result.messages.filter(message => message.ruleId === '@stylistic/indent')

    expect(indentMessages.length).toBeGreaterThan(0)

    const attrStart = findLineIndex(lines, '    label=(') + 1
    const attrEnd = findLineIndex(lines, '    )', attrStart) + 1
    const handlerStart = findLineIndex(lines, '    onClick=() => {') + 1
    const handlerEnd = findLineIndex(lines, '    }', handlerStart) + 1
    const bufferedStart = findLineIndex(lines, '  p= (() => {') + 1
    const bufferedEnd = findLineIndex(lines, '  })()', bufferedStart) + 1
    const interpolationStart = findLineIndex(lines, '  p Hello #{(() => {') + 1
    const interpolationEnd = findLineIndex(lines, '  })()}', interpolationStart) + 1
    const templateStart = findLineIndex(lines, '  Span.text= ${count') + 1
    const templateEnd = findLineIndex(lines, '  }', templateStart) + 1

    const expectedRanges = [
      { start: attrStart, end: attrEnd },
      { start: handlerStart, end: handlerEnd },
      { start: bufferedStart, end: bufferedEnd },
      { start: interpolationStart, end: interpolationEnd },
      { start: templateStart, end: templateEnd },
    ]

    for (const range of expectedRanges) {
      expect(indentMessages.some((message) => (
        (message.line ?? 0) >= range.start
        && (message.line ?? 0) <= range.end
      ))).toBe(true)
    }

    expect(indentMessages.every((message) => (
      expectedRanges.some((range) => (
        (message.line ?? 0) >= range.start
        && (message.line ?? 0) <= range.end
      ))
    ))).toBe(true)
  })
})
