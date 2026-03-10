import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import plugin, { createReactPugProcessor } from '../../src/index';
import {
  COMPILER_JS_RUNTIME_SOURCE,
  COMPILER_STRESS_SOURCE_TSX,
  expectNoTsOnlyRuntimeSyntax,
} from '../../../react-pug-core/test/fixtures/compiler-fixtures';

describe('eslint-plugin-react-pug processor', () => {
  it('preprocess transforms pug templates into lintable JSX/JS', () => {
    const processor = createReactPugProcessor();
    const input = 'const view = pug`Button(label="Save")`;';
    const blocks = processor.preprocess(input, 'file.jsx');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchInlineSnapshot(`"const view = (<Button label={"Save"} />);"`);
  });

  it('auto class strategy switches to styleName+classnames for startupjs marker', () => {
    const processor = createReactPugProcessor();
    const input = [
      'import { pug } from "startupjs";',
      'const active = { active: true };',
      'const view = pug`span.title(styleName=active)`;',
    ].join('\n');
    const [code] = processor.preprocess(input, 'file.jsx');
    expect(code).toMatchInlineSnapshot(`
      "import "startupjs";             
      const active = { active: true };
      const view = (<span styleName={["title", active]} />);"
    `);
  });

  it('supports forcing class shorthand property and merge strategy', () => {
    const processor = createReactPugProcessor({
      classShorthandProperty: 'class',
      classShorthandMerge: 'concatenate',
    });
    const [code] = processor.preprocess('const view = pug`span.title(class=isActive)`;', 'file.jsx');
    expect(code).toMatchInlineSnapshot(`"const view = (<span class={"title" + " " + (isActive)} />);"`);
  });

  it('preprocess output for JS/JSX is runtime-safe and TS-free', () => {
    const processor = createReactPugProcessor();
    const [code] = processor.preprocess(COMPILER_JS_RUNTIME_SOURCE, 'file.jsx');
    expect(code).toMatchInlineSnapshot(`"const view = ((() => {const __r = [];while (ready) {__r.push(<span>Ok</span>);}return __r;})());"`);
    expectNoTsOnlyRuntimeSyntax(code);
  });

  it('postprocess remaps locations to original source', () => {
    const processor = createReactPugProcessor();
    const input = ['const x = 1;', 'const view = pug`span= missingName`;'].join('\n');
    const [code] = processor.preprocess(input, 'file.jsx');

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

    const [code] = processor.preprocess(input, 'file.jsx');

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
  });

  it('handles shared stress fixture and remaps no-undef from nested interpolation', () => {
    const processor = createReactPugProcessor();
    const input = COMPILER_STRESS_SOURCE_TSX.replace(
      'tooltipText.toUpperCase()',
      'tooltipText.toUpperCase() + notDefinedInsideNestedPug',
    );
    const [code] = processor.preprocess(input, 'file.tsx');

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
});
