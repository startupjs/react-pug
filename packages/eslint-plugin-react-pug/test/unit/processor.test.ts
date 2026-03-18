import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../../src/index';
import {
  COMPILER_JS_RUNTIME_SOURCE,
  COMPILER_STRESS_SOURCE_TSX,
  expectNoTsOnlyRuntimeSyntax,
} from '../../../react-pug-core/test/fixtures/compiler-fixtures';

const { createReactPugProcessor } = plugin;

describe('eslint-plugin-react-pug processor', () => {
  it('preprocess transforms pug templates into lintable JSX/JS', () => {
    const processor = createReactPugProcessor();
    const input = 'const view = pug`Button(label="Save")`;';
    const blocks = processor.preprocess(input, 'file.jsx');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchInlineSnapshot(`
      {
        "filename": "../../../pug-react.jsx",
        "text": "const view = <Button label='Save' />;",
      }
    `);
  });

  it('auto class strategy switches to styleName+classnames for startupjs marker', () => {
    const processor = createReactPugProcessor();
    const input = [
      'import { pug } from "startupjs";',
      'const active = { active: true };',
      'const view = pug`span.title(styleName=active)`;',
    ].join('\n');
    const [block] = processor.preprocess(input, 'file.jsx');
    const code = typeof block === 'string' ? block : block.text;
    expect(code).toMatchInlineSnapshot(`
      "import "startupjs";
      const active = { active: true };
      const view = <span styleName={['title', active]} />;"
    `);
  });

  it('supports forcing class shorthand property and merge strategy', () => {
    const processor = createReactPugProcessor({
      classShorthandProperty: 'class',
      classShorthandMerge: 'concatenate',
    });
    const [block] = processor.preprocess('const view = pug`span.title(class=isActive)`;', 'file.jsx');
    const code = typeof block === 'string' ? block : block.text;
    expect(code).toMatchInlineSnapshot(`"const view = <span class={'title' + ' ' + isActive} />;"`);
  });

  it('preprocess output for JS/JSX is runtime-safe and TS-free', () => {
    const processor = createReactPugProcessor();
    const [block] = processor.preprocess(COMPILER_JS_RUNTIME_SOURCE, 'file.jsx');
    const code = typeof block === 'string' ? block : block.text;
    expect(code).toMatchInlineSnapshot(`
      "const view = (() => {
        const __r = []
        while (ready) {
          __r.push(<span>Ok</span>)
        }
        return __r
      })();"
    `);
    expectNoTsOnlyRuntimeSyntax(code);
  });

  it('keeps non-pug files on the original lint path', () => {
    const processor = createReactPugProcessor();
    const blocks = processor.preprocess('const answer = 42;', 'file.js');
    expect(blocks).toMatchInlineSnapshot(`
      [
        "const answer = 42;",
      ]
    `);
  });

  it('uses a JSX virtual filename for plain .js files that already contain JSX', () => {
    const processor = createReactPugProcessor();
    const [block] = processor.preprocess(
      "import BreedPage from './-breed'\n\nexport default function Domestic () { return <BreedPage breed='domestic' /> }\n",
      'file.js',
    );
    expect(block).toMatchInlineSnapshot(`
      {
        "filename": "../../../pug-react.jsx",
        "text": "import BreedPage from './-breed'

      export default function Domestic () { return <BreedPage breed='domestic' /> }
      ",
      }
    `);
  });

  it('can always virtualize .js files to JSX when jsxInJsFiles is forced', () => {
    const processor = createReactPugProcessor({ jsxInJsFiles: 'always' });
    const [block] = processor.preprocess('const answer = 42;\n', 'file.js');
    expect(block).toMatchInlineSnapshot(`
      {
        "filename": "../../../pug-react.jsx",
        "text": "const answer = 42;
      ",
      }
    `);
  });

  it('preserves surrounding JS formatting while reformatting only pug output', () => {
    const processor = createReactPugProcessor();
    const input = [
      'function renderTitle () {',
      '  return pug`',
      '    Card(',
      "      title='Hello'",
      '      subtitle=condition ? value : fallback',
      '    )',
      '  `',
      '}',
    ].join('\n');

    const [block] = processor.preprocess(input, 'file.jsx');
    const code = typeof block === 'string' ? block : block.text;
    expect(code).toMatchInlineSnapshot(`
      "function renderTitle () {
        return <Card title='Hello' subtitle={condition ? value : fallback} />
      }"
    `);
  });

  it('uses a TSX virtual filename for transformed TypeScript files', () => {
    const processor = createReactPugProcessor();
    const [block] = processor.preprocess('const view = pug`Button(label="Save")`;', 'file.ts');
    expect(block).toMatchInlineSnapshot(`
      {
        "filename": "../../../pug-react.tsx",
        "text": "const view = <Button label='Save' />;",
      }
    `);
  });

  it('formats transformed pug regions in tsx files with TypeScript syntax', () => {
    const processor = createReactPugProcessor();
    const input = [
      "const variant = 'text' as const;",
      "const view = pug`Button(variant=(variant as 'text' | 'solid'))`;",
    ].join('\n');

    const [block] = processor.preprocess(input, 'file.tsx');
    expect(block).toMatchInlineSnapshot(`
      {
        "filename": "../../../pug-react.tsx",
        "text": "const variant = 'text' as const;
      const view = <Button variant={variant as 'text' | 'solid'} />;",
      }
    `);
  });

  it('postprocess remaps locations to original source', () => {
    const processor = createReactPugProcessor();
    const input = ['const x = 1;', 'const view = pug`span= missingName`;'].join('\n');
    const [block] = processor.preprocess(input, 'file.jsx');
    const code = typeof block === 'string' ? block : block.text;

    const generatedLine = code.slice(0, code.indexOf('missingName')).split('\n').length;
    const mapped = processor.postprocess([
      [{ line: generatedLine, column: 10, endLine: generatedLine, endColumn: 21, ruleId: 'no-undef' } as any],
    ], 'file.jsx');

    expect(mapped).toHaveLength(1);
    expect(mapped[0].line).toBe(2);
    expect(mapped[0].ruleId).toBe('no-undef');
  });

  it('runs eslint rule no-undef on pug expressions and maps result', () => {
    const processor = createReactPugProcessor();
    const input = [
      'const view = pug`',
      '  span= missingValue',
      '`;',
    ].join('\n');

    const [block] = processor.preprocess(input, 'file.jsx');
    const code = typeof block === 'string' ? block : block.text;

    const linter = new Linter({ configType: 'eslintrc' });
    const lintMessages = linter.verify(
      code,
      {
        parserOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          ecmaFeatures: {
            jsx: true,
          },
        },
        env: {
          es2022: true,
        },
        rules: {
          'no-undef': 'error',
        },
      },
      'file.jsx',
    );

    const mapped = processor.postprocess([lintMessages as any], 'file.jsx');
    const noUndef = mapped.find((m) => m.ruleId === 'no-undef');

    expect(noUndef).toBeTruthy();
    expect(noUndef?.line).toBe(2);
    expect(noUndef?.column).toBeGreaterThan(1);
    expect(noUndef?.message).toContain('missingValue');
  });

  it('exports plugin with default processor', () => {
    expect(plugin).toBeTruthy();
    expect(plugin.processors).toBeTruthy();
    expect(plugin.processors['pug-react']).toBeTruthy();
    expect(plugin.createReactPugProcessor).toBe(createReactPugProcessor);
  });

  it('handles shared stress fixture and remaps no-undef from nested interpolation', () => {
    const processor = createReactPugProcessor();
    const input = COMPILER_STRESS_SOURCE_TSX.replace(
      'tooltipText.toUpperCase()',
      'tooltipText.toUpperCase() + notDefinedInsideNestedPug',
    );
    const [block] = processor.preprocess(input, 'file.tsx');
    const code = typeof block === 'string' ? block : block.text;

    const linter = new Linter({ configType: 'eslintrc' });
    const lintMessages = linter.verify(
      code,
      {
        parserOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          ecmaFeatures: {
            jsx: true,
          },
        },
        env: {
          es2022: true,
        },
        rules: {
          'no-undef': 'error',
        },
      },
      'file.tsx',
    );

    const mapped = processor.postprocess([lintMessages as any], 'file.tsx');
    const noUndef = mapped.find((m) => m.ruleId === 'no-undef' && m.message.includes('notDefinedInsideNestedPug'));
    expect(noUndef).toBeTruthy();
    expect(noUndef?.line).toBeGreaterThan(1);
  });

  it('maps exact lint ranges for identifiers inside several pug expression contexts', () => {
    const processor = createReactPugProcessor();
    const input = [
      'const view = pug`',
      '  Button(label=missingLabel onClick=() => missingHandler())',
      '  p= missingText',
      '  if missingCondition',
      '    span= missingInsideIf',
      '  each item in missingItems',
      '    span= item.name + missingSuffix',
      '`;',
    ].join('\n');

    const [block] = processor.preprocess(input, 'file.tsx');
    const code = typeof block === 'string' ? block : block.text;

    const identifiers = [
      'missingLabel',
      'missingHandler',
      'missingText',
      'missingCondition',
      'missingInsideIf',
      'missingItems',
      'missingSuffix',
    ];

    const generatedMessages = identifiers.map((identifier) => {
      const start = code.indexOf(identifier);
      const before = code.slice(0, start).split('\n');
      const line = before.length;
      const column = before[before.length - 1].length + 1;
      const endColumn = column + identifier.length;
      return {
        ruleId: 'no-undef',
        message: `'${identifier}' is not defined.`,
        line,
        column,
        endLine: line,
        endColumn,
      };
    });

    const mapped = processor.postprocess([generatedMessages as any], 'file.tsx');
    expect(mapped).toMatchInlineSnapshot(`
      [
        {
          "column": 19,
          "endColumn": 29,
          "endLine": 2,
          "line": 2,
          "message": "'missingLabel' is not defined.",
          "ruleId": "no-undef",
        },
        {
          "column": 41,
          "endColumn": 53,
          "endLine": 2,
          "line": 2,
          "message": "'missingHandler' is not defined.",
          "ruleId": "no-undef",
        },
        {
          "column": 4,
          "endColumn": 13,
          "endLine": 3,
          "line": 3,
          "message": "'missingText' is not defined.",
          "ruleId": "no-undef",
        },
        {
          "column": 6,
          "endColumn": 19,
          "endLine": 4,
          "line": 4,
          "message": "'missingCondition' is not defined.",
          "ruleId": "no-undef",
        },
        {
          "column": 6,
          "endColumn": 18,
          "endLine": 5,
          "line": 5,
          "message": "'missingInsideIf' is not defined.",
          "ruleId": "no-undef",
        },
        {
          "column": 11,
          "endColumn": 21,
          "endLine": 6,
          "line": 6,
          "message": "'missingItems' is not defined.",
          "ruleId": "no-undef",
        },
        {
          "column": 15,
          "endColumn": 26,
          "endLine": 7,
          "line": 7,
          "message": "'missingSuffix' is not defined.",
          "ruleId": "no-undef",
        },
      ]
    `);
  });

  it('drops autofix edits for files that contain transformed pug regions', () => {
    const processor = createReactPugProcessor();
    const input = [
      'const  answer = 1;',
      'const view = pug`Button(label="Save")`;',
    ].join('\n');

    const [block] = processor.preprocess(input, 'file.tsx');
    const code = typeof block === 'string' ? block : block.text;
    const pugFixStart = code.indexOf("label='Save'");
    const outsideFixStart = code.indexOf('const  answer');

    const mapped = processor.postprocess([[
      {
        ruleId: '@stylistic/quotes',
        message: 'Use single quotes.',
        line: 2,
        column: 28,
        endLine: 2,
        endColumn: 40,
        fix: {
          range: [pugFixStart, pugFixStart + "label='Save'".length],
          text: "label='Save'",
        },
      },
      {
        ruleId: '@stylistic/no-multi-spaces',
        message: 'Multiple spaces found before \'answer\'.',
        line: 1,
        column: 6,
        endLine: 1,
        endColumn: 8,
        fix: {
          range: [outsideFixStart + 5, outsideFixStart + 7],
          text: ' ',
        },
      },
    ] as any], 'file.tsx');

    expect(mapped).toMatchInlineSnapshot(`
      [
        {
          "column": 31,
          "endColumn": 40,
          "endLine": 2,
          "fix": {
            "range": [
              40,
              52,
            ],
            "text": "label='Save'",
          },
          "line": 2,
          "message": "Use single quotes.",
          "ruleId": "@stylistic/quotes",
        },
        {
          "column": 6,
          "endColumn": 8,
          "endLine": 1,
          "fix": {
            "range": [
              5,
              7,
            ],
            "text": " ",
          },
          "line": 1,
          "message": "Multiple spaces found before 'answer'.",
          "ruleId": "@stylistic/no-multi-spaces",
        },
      ]
    `);
  });

  it('preserves autofix edits for plain files without pug transforms', () => {
    const processor = createReactPugProcessor();
    const mapped = processor.postprocess([[
      {
        ruleId: '@stylistic/no-multi-spaces',
        message: 'Multiple spaces found before \'answer\'.',
        line: 1,
        column: 6,
        endLine: 1,
        endColumn: 8,
        fix: {
          range: [5, 7],
          text: ' ',
        },
      },
    ] as any], 'file.tsx');

    expect(mapped).toMatchInlineSnapshot(`
      [
        {
          "column": 6,
          "endColumn": 8,
          "endLine": 1,
          "fix": {
            "range": [
              5,
              7,
            ],
            "text": " ",
          },
          "line": 1,
          "message": "Multiple spaces found before 'answer'.",
          "ruleId": "@stylistic/no-multi-spaces",
        },
      ]
    `);
  });
});
