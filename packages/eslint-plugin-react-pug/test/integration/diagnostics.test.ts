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

    const eslint = new ESLint({
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

    const eslint = new ESLint({
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

    const eslint = new ESLint({
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

    const eslint = new ESLint({
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

    const eslint = new ESLint({
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

    const eslint = new ESLint({
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

    const eslint = new ESLint({
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

    const [result] = await eslint.lintText(input, { filePath })
    const indentMessages = result.messages.filter(message => message.ruleId === '@stylistic/indent')
    expect(indentMessages.length).toBeGreaterThan(0)
    expect(indentMessages.some(message => (message.line ?? 0) >= 8 && (message.line ?? 0) <= 10)).toBe(true)
  })
})
