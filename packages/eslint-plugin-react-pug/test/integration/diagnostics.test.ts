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
          processor: 'react-pug/pug-react',
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
