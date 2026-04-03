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
})
