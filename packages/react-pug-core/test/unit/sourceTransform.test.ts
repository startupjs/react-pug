import { describe, expect, it } from 'vitest';
import { transformSourceFile } from '../../src/language/sourceTransform';

describe('transformSourceFile', () => {
  it('returns passthrough when no pug templates exist', () => {
    const source = 'const answer = 42;\nexport default answer;\n';
    const result = transformSourceFile(source, 'file.tsx');

    expect(result.code).toBe(source);
    expect(result.regions).toHaveLength(0);
    expect(result.mapGeneratedOffsetToOriginal(5)).toBe(5);
    expect(result.mapOriginalOffsetToGenerated(5)).toBe(5);
  });

  it('transforms a single pug template region', () => {
    const source = 'const view = pug`Button(label=\"Save\")`;\n';
    const result = transformSourceFile(source, 'file.tsx');

    expect(result.regions).toHaveLength(1);
    expect(result.code).toMatchInlineSnapshot(`
      "const view = (<Button label="Save" />);
      "
    `);
  });

  it('transforms multiple regions in one file', () => {
    const source = [
      'const first = pug`span One`;',
      'const second = pug`Button(label=\"Two\")`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx');

    expect(result.regions).toHaveLength(2);
    expect(result.code).toMatchInlineSnapshot(`
      "const first = (<span>One</span>);
      const second = (<Button label="Two" />);"
    `);
  });

  it('supports nested pug templates inside ${} interpolation', () => {
    const source = [
      'const view = pug`',
      '  Button(',
      '    tooltip=${pug`',
      '      span Tooltip',
      '    `}',
      '  )',
      '`;',
    ].join('\n');

    const result = transformSourceFile(source, 'nested.tsx');

    expect(result.regions).toHaveLength(1);
    expect(result.code).toMatchInlineSnapshot(`"const view = (<Button tooltip={(<span>Tooltip</span>)} />);"`);
  });

  it('maps offsets inside transformed region back to original positions', () => {
    const source = 'const view = pug`Button(label=\"Save\")`;\n';
    const result = transformSourceFile(source, 'file.tsx');

    const generatedOffset = result.code.indexOf('Button');
    expect(generatedOffset).toBeGreaterThan(-1);

    const originalOffset = result.mapGeneratedOffsetToOriginal(generatedOffset);
    expect(originalOffset).not.toBeNull();
    expect(source.slice(originalOffset!, originalOffset! + 'Button'.length)).toBe('Button');
  });

  it('maps non-region offsets as identity', () => {
    const source = 'const prefix = 1;\nconst view = pug`span`;';
    const result = transformSourceFile(source, 'file.tsx');

    const originalOffset = source.indexOf('prefix');
    const generatedOffset = result.mapOriginalOffsetToGenerated(originalOffset);
    expect(generatedOffset).toBe(originalOffset);
  });

  it('supports runtime compile mode for build-tool output', () => {
    const source = [
      'const view = pug`',
      '  while ready',
      '    span Done',
      '`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });
    expect(result.code).toMatchInlineSnapshot(`"const view = ((() => {const __r = [];while (ready) {__r.push(<span>Done</span>);}return __r;})());"`);
  });

  it('auto class strategy defaults to className without startupjs/cssxjs marker', () => {
    const source = 'const view = pug`span.title`;';
    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });
    expect(result.code).toMatchInlineSnapshot(`"const view = (<span className="title" />);"`);
  });

  it('auto class strategy switches to styleName+classnames with startupjs/cssxjs marker', () => {
    const source = [
      "import { pug } from 'startupjs';",
      'const active = { active: true };',
      'const view = pug`span.title(styleName=active)`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });
    expect(result.code).toMatchInlineSnapshot(`
      "import 'startupjs';             
      const active = { active: true };
      const view = (<span styleName={["title", active]} />);"
    `);
  });

  it('can force class target and merge strategy explicitly', () => {
    const source = 'const view = pug`span.title(styleName=active)`;';
    const result = transformSourceFile(source, 'file.tsx', {
      compileMode: 'runtime',
      classAttribute: 'class',
      classMerge: 'concatenate',
      startupjsCssxjs: true,
    });
    expect(result.code).toMatchInlineSnapshot(`"const view = (<span class="title" styleName={active} />);"`);
  });

  it('treats leading uppercase shorthand segments as component path by default', () => {
    const source = 'const view = pug`Modal.Header.active(onPress=handlePress)`;';
    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });
    expect(result.code).toMatchInlineSnapshot(`"const view = (<Modal.Header className="active" onPress={handlePress} />);"`);
  });

  it('can disable uppercase shorthand component-path behavior', () => {
    const source = 'const view = pug`Modal.Header.active(onPress=handlePress)`;';
    const result = transformSourceFile(source, 'file.tsx', {
      compileMode: 'runtime',
      componentPathFromUppercaseClassShorthand: false,
    });
    expect(result.code).toMatchInlineSnapshot(`"const view = (<Modal className="Header active" onPress={handlePress} />);"`);
  });

  it('removes a pug import binding and preserves side effects', () => {
    const source = [
      "import { pug } from 'startupjs';",
      'const view = pug`span.title`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });
    expect(result.code).toMatchInlineSnapshot(`
      "import 'startupjs';             
      const view = (<span styleName={["title"]} />);"
    `);
  });

  it('removes only the pug specifier from a mixed import', () => {
    const source = [
      "import { pug, observer } from 'startupjs';",
      'const view = pug`span.title`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });
    expect(result.code).toMatchInlineSnapshot(`
      "import { observer } from 'startupjs';     
      const view = (<span styleName={["title"]} />);"
    `);
  });

  it('can preserve the pug import when requested', () => {
    const source = [
      "import { pug } from 'startupjs';",
      'const view = pug`span.title`;',
    ].join('\n');
    const result = transformSourceFile(source, 'file.tsx', {
      compileMode: 'runtime',
      removeTagImport: false,
    });
    expect(result.code).toMatchInlineSnapshot(`
      "import { pug } from 'startupjs';
      const view = (<span styleName={["title"]} />);"
    `);
  });

  it('throws when requirePugImport is enabled and no import exists', () => {
    expect(() => transformSourceFile('const view = pug`span.title`;', 'file.tsx', {
      compileMode: 'runtime',
      requirePugImport: true,
    })).toThrow('Missing import for tag function "pug"');
  });

  it('moves a style block into the target scope and merges the matching helper into the existing import', () => {
    const source = [
      "import { pug, observer } from 'startupjs';",
      'function App() {',
      '  return pug`',
      '    .title Hello',
      "    style(lang='styl')",
      '      .title',
      '        color red',
      '  `;',
      '}',
    ].join('\n');

    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });

    expect(result.code).toMatchInlineSnapshot(`
      "import {observer,styl} from 'startupjs';  
      function App() {
        
        styl\`
          .title
            color red

        \`;
      return (<div styleName={["title"]}>Hello</div>);
      }"
    `);
  });

  it('normalizes single-line if/else return bodies into blocks before inserting styles', () => {
    const source = [
      "import { pug } from 'startupjs';",
      'function App () {',
      '  if (x) return pug`',
      '    .title One',
      '    style',
      '      .one { color: red; }',
      '  `',
      '  else return pug`',
      '    .title Two',
      '    style',
      '      .two { color: blue; }',
      '  `',
      '}',
    ].join('\n');

    const result = transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' });

    expect(result.code).toMatchInlineSnapshot(`
      "import { css } from 'startupjs';
      function App () {
        if (x) {
          css\`
            .one { color: red; }

          \`;
          return (<div styleName={["title"]}>One</div>)
        }
        else {
          css\`
            .two { color: blue; }

          \`;
          return (<div styleName={["title"]}>Two</div>)
        }
      }"
    `);
  });

  it('throws for style blocks when pug is not imported', () => {
    const source = [
      'const view = pug`',
      '  .title Hello',
      '  style',
      '    .title { color: red; }',
      '`;',
    ].join('\n');

    expect(() => transformSourceFile(source, 'file.tsx', { compileMode: 'runtime' }))
      .toThrow('style blocks require importing pug');
  });
});
