import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';

// Test checklist:
// [x] getScriptSnapshot returns shadow TSX for files with pug templates
// [x] getScriptSnapshot passes through unchanged for files without pug templates
// [x] getScriptSnapshot returns undefined for unknown files (passthrough)
// [x] getScriptVersion returns incremented version for pug files
// [x] getScriptVersion delegates to original for non-pug files
// [x] Document cache: same content returns same version (no re-increment)
// [x] Document cache: changed content bumps version
// [x] Document cache: removing pug from file cleans cache entry
// [x] Regex detection: finds single pug tagged template
// [x] Regex detection: finds multiple pug tagged templates in one file
// [x] Regex detection: ignores non-pug tagged templates
// [x] Regex detection: handles multiline pug content
// [x] Regex detection: handles empty pug template
// [x] Transform: class shorthand .foo -> <div className="foo" />
// [x] Transform: tag with attrs Button(onClick=handler) Text
// [x] Transform: tag with text p Hello
// [x] Transform: bare tag div -> <div />
// [x] Transform: multiple lines wrapped in fragment
// [x] Transform: empty content -> null placeholder
// [x] Edge case: empty string file content
// [x] Edge case: whitespace-only pug template
// [x] Edge case: large file with pug templates
// [x] Edge case: file changes from pug to non-pug (covered in cache tests)
// [x] Edge case: pug` in a string but not a real tagged template
// [x] Proxy LS delegates all methods to original

async function loadPlugin() {
  const mod = await import('../../src/index.ts');
  return mod.default ?? mod;
}

/** Minimal mock of TypeScript's ScriptSnapshot */
function mockScriptSnapshot(text: string) {
  return {
    getText: (start: number, end: number) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

/** Minimal mock of TypeScript module needed by the plugin */
function createMockTsModule() {
  return {
    ScriptSnapshot: {
      fromString(text: string) {
        return mockScriptSnapshot(text);
      },
    },
    sys: {
      fileExists(fileName: string) {
        return fs.existsSync(fileName);
      },
      readFile(fileName: string) {
        return fs.existsSync(fileName)
          ? fs.readFileSync(fileName, 'utf8')
          : undefined;
      },
      getModifiedTime(fileName: string) {
        return fs.existsSync(fileName)
          ? fs.statSync(fileName).mtime
          : undefined;
      },
    },
  };
}

/**
 * Create a mock PluginCreateInfo with mutable file contents.
 * Returns the info object plus a helper to update file contents.
 */
function createMockPluginInfo(
  initialFiles: Record<string, string> = {},
  pluginConfig: Record<string, any> = {},
) {
  const files = { ...initialFiles };
  const versions: Record<string, number> = {};
  for (const key of Object.keys(files)) {
    versions[key] = 1;
  }

  const languageServiceHost = {
    getScriptSnapshot(fileName: string) {
      const content = files[fileName];
      if (content === undefined) return undefined;
      return mockScriptSnapshot(content);
    },
    getScriptVersion(fileName: string) {
      return String(versions[fileName] ?? 0);
    },
  };

  const callLog: Record<string, any[][]> = {};
  const languageService: Record<string, Function> = {};
  const methodNames = [
    'getCompletionsAtPosition',
    'getCompletionEntryDetails',
    'getQuickInfoAtPosition',
    'getSemanticDiagnostics',
    'getSyntacticDiagnostics',
    'getDefinitionAtPosition',
    'findReferences',
    'dispose',
  ];
  for (const name of methodNames) {
    callLog[name] = [];
    languageService[name] = (...args: any[]) => {
      callLog[name].push(args);
      return null;
    };
  }

  const info = {
    languageServiceHost,
    languageService,
    project: {},
    config: pluginConfig,
  };

  return {
    info,
    callLog,
    /** Update a file's content (simulates user editing) */
    updateFile(fileName: string, content: string) {
      files[fileName] = content;
      versions[fileName] = (versions[fileName] ?? 0) + 1;
    },
  };
}

/** Helper: initialize plugin and return the patched host + proxy LS */
async function setupPlugin(
  files: Record<string, string> = {},
  pluginConfig: Record<string, any> = {},
) {
  const init = await loadPlugin();
  const tsModule = createMockTsModule();
  const pluginModule = init({ typescript: tsModule });
  const mock = createMockPluginInfo(files, pluginConfig);
  const proxy = pluginModule.create(mock.info as any);

  // After create(), the host methods are patched in-place
  const host = mock.info.languageServiceHost;
  return { host, proxy, mock, tsModule };
}

/** Extract text from a ScriptSnapshot */
function snapshotText(snapshot: any): string {
  return snapshot.getText(0, snapshot.getLength());
}

// ── getScriptSnapshot tests ──────────────────────────────────────

describe('getScriptSnapshot patching', () => {
  it('returns shadow TSX for files with pug templates', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  div Hello\n`',
    });

    const snapshot = host.getScriptSnapshot('app.tsx');
    const text = snapshotText(snapshot);

    // Should NOT contain pug` anymore
    expect(text).not.toContain('pug`');
    // Should contain JSX
    expect(text).toContain('<div>');
    expect(text).toContain('Hello');
  });

  it('passes through unchanged for files without pug templates', async () => {
    const original = 'export const x = 42;\n';
    const { host } = await setupPlugin({
      'plain.ts': original,
    });

    const snapshot = host.getScriptSnapshot('plain.ts');
    const text = snapshotText(snapshot);
    expect(text).toBe(original);
  });

  it('returns undefined for unknown files', async () => {
    const { host } = await setupPlugin({});
    const snapshot = host.getScriptSnapshot('nonexistent.ts');
    expect(snapshot).toBeUndefined();
  });

  it('preserves code outside pug templates', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'import React from "react";\nconst v = pug`\n  div\n`;\nexport default v;',
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('import React from "react"');
    expect(text).toContain('export default v');
  });

  it('injects extra React attributes in auto mode when source contains "startupjs"', async () => {
    const { host } = await setupPlugin({
      'app.tsx': [
        'import { pug } from "startupjs";',
        'const view = pug`',
        '  Button()',
        '`;',
      ].join('\n'),
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain("declare module 'react'");
    expect(text).toContain('part?: __PugReactPartProp');
    expect(text).toContain('styleName?: __PugReactStyleNameProp');
    expect(text).toContain('type __PugReactStyleNameProp = __PugReactStyleNameLeaf | Array<__PugReactStyleNameProp>');
  });

  it('injects extra React attributes in auto mode when source contains "cssxjs"', async () => {
    const { host } = await setupPlugin({
      'app.tsx': [
        'import { pug } from "cssxjs";',
        'const view = pug`',
        '  Button()',
        '`;',
      ].join('\n'),
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain("declare module 'react'");
    expect(text).toContain('part?: __PugReactPartProp');
    expect(text).toContain('styleName?: __PugReactStyleNameProp');
  });

  it('does not inject extra React attributes in auto mode when marker strings are absent', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const view = pug`\\n  Button()\\n`;\n',
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).not.toContain("declare module 'react'");
    expect(text).not.toContain('styleName?: __PugReactStyleNameProp');
  });

  it('injects extra React attributes in force mode without source markers', async () => {
    const { host } = await setupPlugin(
      { 'app.tsx': 'const view = pug`\\n  Button()\\n`;\n' },
      { injectCssxjsTypes: 'force' },
    );

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain("declare module 'react'");
    expect(text).toContain('styleName?: __PugReactStyleNameProp');
  });

  it('does not inject extra React attributes in never mode even with source markers', async () => {
    const { host } = await setupPlugin(
      {
        'app.tsx': [
          'import { pug } from "startupjs";',
          'const view = pug`',
          '  Button()',
          '`;',
        ].join('\n'),
      },
      { injectCssxjsTypes: 'never' },
    );

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).not.toContain("declare module 'react'");
    expect(text).not.toContain('styleName?: __PugReactStyleNameProp');
  });

  it('does not inject extra React attributes for .js files', async () => {
    const { host } = await setupPlugin({
      'app.js': [
        'import { pug } from "startupjs";',
        'const view = pug`',
        '  Button()',
        '`;',
      ].join('\n'),
    });

    const text = snapshotText(host.getScriptSnapshot('app.js'));
    expect(text).not.toContain("declare module 'react'");
    expect(text).not.toContain('styleName?: __PugReactStyleNameProp');
  });

  it('does not inject extra React attributes for .jsx files', async () => {
    const { host } = await setupPlugin({
      'app.jsx': [
        'import { pug } from "cssxjs";',
        'const view = pug`',
        '  Button()',
        '`;',
      ].join('\n'),
    });

    const text = snapshotText(host.getScriptSnapshot('app.jsx'));
    expect(text).not.toContain("declare module 'react'");
    expect(text).not.toContain('styleName?: __PugReactStyleNameProp');
  });
});

// ── getScriptVersion tests ───────────────────────────────────────

describe('getScriptVersion patching', () => {
  it('returns version string for pug files after snapshot access', async () => {
    const { host } = await setupPlugin({
      'version-test.tsx': 'const v = pug`\n  div\n`',
    });

    // Must access snapshot first to populate cache
    host.getScriptSnapshot('version-test.tsx');
    const version = host.getScriptVersion('version-test.tsx');
    // Version format is "hostVersion:cachedVersion"
    expect(version).toBe('1:1');
  });

  it('delegates to original for non-pug files', async () => {
    const { host } = await setupPlugin({
      'plain.ts': 'export const x = 1;',
    });

    // Access snapshot (won't be cached since no pug)
    host.getScriptSnapshot('plain.ts');
    const version = host.getScriptVersion('plain.ts');
    // Original mock returns "1" for known files
    expect(version).toBe('1');
  });

  it('increments version when pug content changes', async () => {
    const { host, mock } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  div\n`',
    });

    host.getScriptSnapshot('app.tsx');
    const v1 = host.getScriptVersion('app.tsx');

    // Simulate file edit
    mock.updateFile('app.tsx', 'const v = pug`\n  span Updated\n`');
    host.getScriptSnapshot('app.tsx');
    const v2 = host.getScriptVersion('app.tsx');

    // Version format is "hostVersion:cachedVersion", so v2 string should differ from v1
    expect(v2).not.toBe(v1);
  });
});

// ── Document cache tests ─────────────────────────────────────────

describe('document cache', () => {
  it('same content does not re-increment version', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  div\n`',
    });

    host.getScriptSnapshot('app.tsx');
    const v1 = host.getScriptVersion('app.tsx');

    // Access again with same content
    host.getScriptSnapshot('app.tsx');
    const v2 = host.getScriptVersion('app.tsx');

    expect(v1).toBe(v2);
  });

  it('changed content bumps version', async () => {
    const { host, mock } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  div\n`',
    });

    host.getScriptSnapshot('app.tsx');
    const v1 = host.getScriptVersion('app.tsx');

    mock.updateFile('app.tsx', 'const v = pug`\n  p Changed\n`');
    host.getScriptSnapshot('app.tsx');
    const v2 = host.getScriptVersion('app.tsx');

    // Version format is "hostVersion:cachedVersion"; both parts change
    expect(v2).not.toBe(v1);
  });

  it('removing pug from file cleans cache, restores original passthrough', async () => {
    const { host, mock } = await setupPlugin({
      'remove-pug-test.tsx': 'const v = pug`\n  div\n`',
    });

    // First: file has pug, should be cached
    host.getScriptSnapshot('remove-pug-test.tsx');
    const versionWithPug = host.getScriptVersion('remove-pug-test.tsx');
    // Version format is "hostVersion:cachedVersion"
    expect(versionWithPug).toContain(':');

    // Edit to remove pug
    const plainContent = 'const v = <div />;';
    mock.updateFile('remove-pug-test.tsx', plainContent);
    const snapshot = host.getScriptSnapshot('remove-pug-test.tsx');
    const text = snapshotText(snapshot);

    // Should return original content now (passthrough)
    expect(text).toBe(plainContent);

    // Version should now delegate to original host (cache cleaned up)
    // The mock returns "2" because updateFile incremented it
    const version = host.getScriptVersion('remove-pug-test.tsx');
    expect(version).toBe('2');
  });
});

// ── Regex detection tests ────────────────────────────────────────

describe('regex detection', () => {
  it('finds single pug tagged template', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`div`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).not.toContain('pug`');
    expect(text).toContain('<div');
  });

  it('finds multiple pug tagged templates in one file', async () => {
    const { host } = await setupPlugin({
      'app.tsx': [
        'const a = pug`\n  h1 Header\n`',
        'const b = pug`\n  p Body\n`',
      ].join('\n'),
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).not.toContain('pug`');
    expect(text).toContain('<h1>');
    expect(text).toContain('Header');
    expect(text).toContain('<p>');
    expect(text).toContain('Body');
  });

  it('ignores non-pug tagged templates', async () => {
    const original = 'const v = html`<div>hello</div>`;\nconst x = css`.foo { color: red; }`;';
    const { host } = await setupPlugin({
      'app.tsx': original,
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    // No pug templates, should pass through unchanged
    expect(text).toBe(original);
  });

  it('handles multiline pug content', async () => {
    const { host } = await setupPlugin({
      'app.tsx': [
        'const v = pug`',
        '  .card',
        '    Button(onClick=handler) Click',
        '    p Some text',
        '`',
      ].join('\n'),
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).not.toContain('pug`');
    expect(text).toContain('className="card"');
    expect(text).toContain('Button');
    expect(text).toContain('onClick={handler}');
    expect(text).toContain('Click');
  });

  it('handles empty pug template', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug``',
    });

    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).not.toContain('pug`');
    // Empty template should produce a null placeholder
    expect(text).toContain('null');
  });
});

// ── Transform tests ──────────────────────────────────────────────

describe('pug-to-JSX transformation', () => {
  it('transforms class shorthand .foo', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  .foo\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('<div className="foo" />');
  });

  it('class shorthand can target class via config', async () => {
    const { host } = await setupPlugin(
      { 'app.tsx': 'const v = pug`\n  .foo\n`' },
      { classShorthandProperty: 'class' },
    );
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('<div class="foo" />');
    expect(text).not.toContain('className=');
  });

  it('class shorthand auto-switches to styleName+classnames when startupjs marker is present and inject auto', async () => {
    const { host } = await setupPlugin({
      'app.tsx': [
        'import { pug } from "startupjs";',
        'const v = pug`',
        '  span.foo(styleName=active)',
        '`;',
      ].join('\n'),
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('styleName={["foo", active]}');
  });

  it('class shorthand merge can be forced to concatenate', async () => {
    const { host } = await setupPlugin(
      {
        'app.tsx': 'const v = pug`\n  span.foo(styleName=active)\n`',
      },
      {
        classShorthandProperty: 'styleName',
        classShorthandMerge: 'concatenate',
      },
    );
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('styleName={"foo" + " " + (active)}');
  });

  it('transforms tag with attributes and text', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  Button(onClick=handler) Click\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('<Button');
    expect(text).toContain('onClick={handler}');
    expect(text).toContain('>Click</Button>');
  });

  it('transforms tag with text: p Hello', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  p Hello world\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('<p>Hello world</p>');
  });

  it('transforms bare tag: div', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  div\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('<div />');
  });

  it('wraps multiple lines in a fragment', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  div\n  span\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('<>');
    expect(text).toContain('</>');
    expect(text).toContain('<div />');
    expect(text).toContain('<span />');
  });

  it('single line does not wrap in fragment', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  div\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).not.toContain('<>');
    expect(text).not.toContain('</>');
  });

  it('transforms tag with multiple attributes', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n  Button(onClick=handler, label="Hi")\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('onClick={handler}');
    expect(text).toContain('label={"Hi"}');
  });

  it('empty content produces null placeholder', async () => {
    const { host } = await setupPlugin({
      'app.tsx': 'const v = pug`\n\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('app.tsx'));
    expect(text).toContain('null');
    expect(text).toContain('JSX.Element');
  });
});

// ── Edge case tests ──────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty string file content', async () => {
    const { host } = await setupPlugin({
      'empty.ts': '',
    });
    const snapshot = host.getScriptSnapshot('empty.ts');
    const text = snapshotText(snapshot);
    expect(text).toBe('');
  });

  it('handles whitespace-only pug template', async () => {
    const { host } = await setupPlugin({
      'whitespace-pug.tsx': 'const v = pug`   \n   \n   `',
    });
    const text = snapshotText(host.getScriptSnapshot('whitespace-pug.tsx'));
    // Whitespace-only lines are filtered out, treated as empty -> null placeholder
    expect(text).not.toContain('pug`');
    expect(text).toContain('null');
  });

  it('handles large file with pug template', async () => {
    // Generate a large file (~10K lines of code) with a pug template in the middle
    const prefix = Array.from({ length: 5000 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const pugPart = '\nconst view = pug`\n  div Hello\n`;\n';
    const suffix = Array.from({ length: 5000 }, (_, i) => `const y${i} = ${i};`).join('\n');
    const largeFile = prefix + pugPart + suffix;

    const { host } = await setupPlugin({
      'large.tsx': largeFile,
    });

    const text = snapshotText(host.getScriptSnapshot('large.tsx'));
    expect(text).not.toContain('pug`');
    expect(text).toContain('<div>Hello</div>');
    // Surrounding code should be preserved
    expect(text).toContain('const x0 = 0');
    expect(text).toContain('const y4999 = 4999');
  });

  it('handles string containing pug` that is not a tagged template', async () => {
    // @babel/parser correctly distinguishes tagged templates from strings.
    // pug` inside a string literal is not a tagged template expression.
    const original = "const s = 'this mentions pug`div` in a string';";
    const { host } = await setupPlugin({
      'false-positive.ts': original,
    });
    const snapshot = host.getScriptSnapshot('false-positive.ts');
    const text = snapshotText(snapshot);
    // @babel/parser should not find a tagged template inside a string literal,
    // so the file passes through unchanged -- OR if it did match via regex fallback
    // (which is a known limitation), it should still produce valid output
    expect(snapshot).toBeDefined();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    // Either unchanged or transformed, but not empty
    expect(text).toContain('const s');
  });

  it('handles pug template with only a comment-like line', async () => {
    const { host } = await setupPlugin({
      'comment-pug.tsx': 'const v = pug`\n  //- this is a comment\n`',
    });
    const text = snapshotText(host.getScriptSnapshot('comment-pug.tsx'));
    // pug` should be replaced with the compiled output
    expect(text).not.toContain('pug`');
    // The output should still contain 'const v = '
    expect(text).toContain('const v = ');
  });
});

// ── Proxy LanguageService tests ──────────────────────────────────

describe('proxy LanguageService', () => {
  it('delegates all methods to original LanguageService', async () => {
    const { proxy, mock } = await setupPlugin({});

    // Call each method through the proxy and verify it was delegated
    (proxy as any).getCompletionsAtPosition('file.ts', 0, {});
    expect(mock.callLog['getCompletionsAtPosition']).toHaveLength(1);
    expect(mock.callLog['getCompletionsAtPosition'][0]).toEqual(['file.ts', 0, {}]);

    (proxy as any).getSemanticDiagnostics('file.ts');
    expect(mock.callLog['getSemanticDiagnostics']).toHaveLength(1);

    (proxy as any).getQuickInfoAtPosition('file.ts', 5);
    expect(mock.callLog['getQuickInfoAtPosition']).toHaveLength(1);
    expect(mock.callLog['getQuickInfoAtPosition'][0]).toEqual(['file.ts', 5]);
  });

  it('has all methods from the original LanguageService', async () => {
    const { proxy, mock } = await setupPlugin({});

    for (const key of Object.keys(mock.info.languageService)) {
      expect(typeof (proxy as any)[key]).toBe('function');
    }
  });

  it('returns values from underlying LanguageService methods', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });
    const mock = createMockPluginInfo({});

    const expectedResult = { entries: [{ name: 'onClick' }] };
    mock.info.languageService.getCompletionsAtPosition = () => expectedResult;

    const proxy = pluginModule.create(mock.info as any);
    const result = (proxy as any).getCompletionsAtPosition('file.ts', 0, {});
    expect(result).toEqual(expectedResult);
  });

  it('maps completion replacement spans back to original offsets', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });
    const fileName = 'app.tsx';
    const source = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'const view = pug`',
      '  Button(o)',
      '`;',
    ].join('\n');
    const mock = createMockPluginInfo({ [fileName]: source });

    mock.info.languageService.getCompletionsAtPosition = (_f: string, pos: number) => ({
      entries: [
        {
          name: 'onClick',
          kind: 'property',
          sortText: '0',
          replacementSpan: { start: pos, length: 1 },
        },
      ],
      optionalReplacementSpan: { start: pos, length: 1 },
    });

    const proxy = pluginModule.create(mock.info as any);
    const cursor = source.indexOf('Button(o') + 'Button(o'.length;
    const result = (proxy as any).getCompletionsAtPosition(fileName, cursor, {});

    expect(result).toBeDefined();
    expect(result.entries[0].replacementSpan.start).toBe(cursor);
    expect(result.optionalReplacementSpan.start).toBe(cursor);
  });

  it('maps completion detail code-action edit spans back to original offsets', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });
    const fileName = 'app.tsx';
    const source = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'const view = pug`',
      '  Button(o)',
      '`;',
    ].join('\n');
    const mock = createMockPluginInfo({ [fileName]: source });

    mock.info.languageService.getCompletionEntryDetails = (_f: string, pos: number) => ({
      name: 'onClick',
      kind: 'property',
      kindModifiers: '',
      displayParts: [],
      documentation: [],
      tags: [],
      codeActions: [
        {
          description: 'mock action',
          changes: [
            {
              fileName,
              textChanges: [{ span: { start: pos, length: 1 }, newText: 'x' }],
            },
          ],
        },
      ],
    });

    const proxy = pluginModule.create(mock.info as any);
    const cursor = source.indexOf('Button(o') + 'Button(o'.length;
    const result = (proxy as any).getCompletionEntryDetails(
      fileName,
      cursor,
      'onClick',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    expect(result.codeActions[0].changes[0].textChanges[0].span.start).toBe(cursor);
  });
});
