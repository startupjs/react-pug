import { describe, it, expect } from 'vitest';
import { buildShadowDocument } from '../../../react-pug-core/src/language/shadowDocument';
import {
  originalToShadow,
  shadowToOriginal,
} from '../../../react-pug-core/src/language/positionMapping';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ── Helper ──────────────────────────────────────────────────────

function makeDoc(text: string) {
  return buildShadowDocument(text, 'test.tsx', 1);
}

// ── Finding 1: Source mapping with indented templates ────────────

describe('source mapping with indented templates (Finding 1)', () => {
  const source2sp = `function App() {
  return pug\`
    Button(onClick=handler)
    .container
      h1 Hello
  \`
}`;

  const source4sp = `function App() {
    return pug\`
        Button(onClick=handler)
        .container
            h1 Hello
    \`
}`;

  const source8sp = `function App() {
        return pug\`
                Button(onClick=handler)
                .container
                        h1 Hello
        \`
}`;

  const sourceTab = `function App() {
\treturn pug\`
\t\tButton(onClick=handler)
\t\t.container
\t\t\th1 Hello
\t\`
}`;

  it('onClick maps correctly with 2-space common indent', () => {
    const doc = makeDoc(source2sp);
    expect(doc.regions).toHaveLength(1);
    const region = doc.regions[0];
    expect(region.commonIndent).toBeGreaterThan(0);

    const onClickOrig = source2sp.indexOf('onClick');
    const shadowPos = originalToShadow(doc, onClickOrig);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 7)).toBe('onClick');
  });

  it('leading indentation inside pug content is unmapped (returns null)', () => {
    const source = 'const view = pug`\\n    Button(onClick=handler)\\n`;';
    const doc = makeDoc(source);
    const lineStart = source.indexOf('    Button');
    expect(lineStart).toBeGreaterThan(-1);

    for (let i = 0; i < 4; i++) {
      const pos = lineStart + i;
      expect(originalToShadow(doc, pos)).toBeNull();
    }
  });

  it('handler maps correctly with 2-space common indent', () => {
    const doc = makeDoc(source2sp);
    const handlerOrig = source2sp.indexOf('handler');
    const shadowPos = originalToShadow(doc, handlerOrig);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 7)).toBe('handler');
  });

  it('h1 maps correctly with 2-space common indent', () => {
    const doc = makeDoc(source2sp);
    const h1Orig = source2sp.indexOf('h1');
    const shadowPos = originalToShadow(doc, h1Orig);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 2)).toBe('h1');
  });

  it('round-trip: original -> shadow -> original for onClick (2-space indent)', () => {
    const doc = makeDoc(source2sp);
    const onClickOrig = source2sp.indexOf('onClick');
    const shadowPos = originalToShadow(doc, onClickOrig);
    expect(shadowPos).not.toBeNull();
    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(onClickOrig);
  });

  it('round-trip: original -> shadow -> original for handler (2-space indent)', () => {
    const doc = makeDoc(source2sp);
    const handlerOrig = source2sp.indexOf('handler');
    const shadowPos = originalToShadow(doc, handlerOrig);
    expect(shadowPos).not.toBeNull();
    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(handlerOrig);
  });

  it('round-trip: original -> shadow -> original for h1 (2-space indent)', () => {
    const doc = makeDoc(source2sp);
    const h1Orig = source2sp.indexOf('h1');
    const shadowPos = originalToShadow(doc, h1Orig);
    expect(shadowPos).not.toBeNull();
    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(h1Orig);
  });

  it('onClick maps correctly with 4-space common indent', () => {
    const doc = makeDoc(source4sp);
    const region = doc.regions[0];
    expect(region.commonIndent).toBeGreaterThan(0);

    const onClickOrig = source4sp.indexOf('onClick');
    const shadowPos = originalToShadow(doc, onClickOrig);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 7)).toBe('onClick');
  });

  it('round-trip for 4-space indent', () => {
    const doc = makeDoc(source4sp);
    const handlerOrig = source4sp.indexOf('handler');
    const shadowPos = originalToShadow(doc, handlerOrig);
    expect(shadowPos).not.toBeNull();
    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(handlerOrig);
  });

  it('onClick maps correctly with 8-space common indent', () => {
    const doc = makeDoc(source8sp);
    const region = doc.regions[0];
    expect(region.commonIndent).toBeGreaterThan(0);

    const onClickOrig = source8sp.indexOf('onClick');
    const shadowPos = originalToShadow(doc, onClickOrig);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 7)).toBe('onClick');
  });

  it('round-trip for 8-space indent', () => {
    const doc = makeDoc(source8sp);
    const handlerOrig = source8sp.indexOf('handler');
    const shadowPos = originalToShadow(doc, handlerOrig);
    expect(shadowPos).not.toBeNull();
    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(handlerOrig);
  });

  it('onClick maps correctly with tab indent', () => {
    const doc = makeDoc(sourceTab);
    const region = doc.regions[0];
    expect(region.commonIndent).toBeGreaterThan(0);

    const onClickOrig = sourceTab.indexOf('onClick');
    const shadowPos = originalToShadow(doc, onClickOrig);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 7)).toBe('onClick');
  });

  it('round-trip for tab indent', () => {
    const doc = makeDoc(sourceTab);
    const handlerOrig = sourceTab.indexOf('handler');
    const shadowPos = originalToShadow(doc, handlerOrig);
    expect(shadowPos).not.toBeNull();
    const backToOrig = shadowToOriginal(doc, shadowPos!);
    expect(backToOrig).toBe(handlerOrig);
  });

  it('all mapped spans round-trip in indented template', () => {
    const doc = makeDoc(source2sp);
    const region = doc.regions[0];

    for (const mapping of region.mappings) {
      for (let i = 0; i < mapping.sourceOffsets.length; i++) {
        const rawText = source2sp.slice(region.pugTextStart, region.pugTextEnd);
        // Convert stripped pugOffset to raw offset
        const pugOffset = mapping.sourceOffsets[i];
        // Map through the full pipeline
        // We need to find the original file offset for this stripped pug offset.
        // The stripped offset corresponds to a position in pugText (stripped).
        // We verify via shadow mapping that these positions map correctly.
        const tsxOffset = mapping.generatedOffsets[i];
        const shadowPos = region.shadowStart + tsxOffset;
        const origPos = shadowToOriginal(doc, shadowPos);
        if (origPos != null) {
          // Forward map should agree
          const forwardShadow = originalToShadow(doc, origPos);
          expect(forwardShadow).toBe(shadowPos);
        }
      }
    }
  });

  it('code outside indented pug template maps correctly', () => {
    const sourceWithSuffix = source2sp.replace('}', '}\nconst end = 1;');
    const doc = makeDoc(sourceWithSuffix);

    const endOrig = sourceWithSuffix.indexOf('const end');
    const shadowPos = originalToShadow(doc, endOrig);
    expect(shadowPos).not.toBeNull();
    expect(doc.shadowText.slice(shadowPos!, shadowPos! + 9)).toBe('const end');
  });
});

// ── Finding 2: Version incorporates host version ─────────────────

describe('version incorporates host version (Finding 2)', () => {
  function mockScriptSnapshot(text: string) {
    return {
      getText: (start: number, end: number) => text.slice(start, end),
      getLength: () => text.length,
      getChangeRange: () => undefined,
    };
  }

  function createMockTsModule() {
    return {
      ScriptSnapshot: {
        fromString(text: string) {
          return mockScriptSnapshot(text);
        },
      },
    };
  }

  async function loadPlugin() {
    const mod = await import('../../src/index.ts');
    return mod.default ?? mod;
  }

  it('cached doc version format is hostVersion:docVersion', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const files: Record<string, string> = {
      'app.tsx': 'const v = pug`\n  div\n`',
    };
    const versions: Record<string, number> = { 'app.tsx': 1 };

    const host = {
      getScriptSnapshot(fileName: string) {
        const c = files[fileName];
        return c !== undefined ? mockScriptSnapshot(c) : undefined;
      },
      getScriptVersion(fileName: string) {
        return String(versions[fileName] ?? 0);
      },
    };

    const ls: Record<string, Function> = {
      getCompletionsAtPosition: () => null,
      getSemanticDiagnostics: () => [],
      getSyntacticDiagnostics: () => [],
      dispose: () => {},
    };

    const pluginModule = init({ typescript: tsModule });
    pluginModule.create({
      languageServiceHost: host,
      languageService: ls,
      project: {},
      config: {},
    } as any);

    // Trigger cache population
    host.getScriptSnapshot('app.tsx');
    const version = host.getScriptVersion('app.tsx');
    // Format should be "hostVersion:docVersion"
    expect(version).toBe('1:1');
    expect(version).toMatch(/^\d+:\d+$/);
  });

  it('host version change reflects in getScriptVersion without new snapshot', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const files: Record<string, string> = {
      'app.tsx': 'const v = pug`\n  div\n`',
    };
    const versions: Record<string, number> = { 'app.tsx': 1 };

    const host = {
      getScriptSnapshot(fileName: string) {
        const c = files[fileName];
        return c !== undefined ? mockScriptSnapshot(c) : undefined;
      },
      getScriptVersion(fileName: string) {
        return String(versions[fileName] ?? 0);
      },
    };

    const ls: Record<string, Function> = {
      getCompletionsAtPosition: () => null,
      getSemanticDiagnostics: () => [],
      getSyntacticDiagnostics: () => [],
      dispose: () => {},
    };

    const pluginModule = init({ typescript: tsModule });
    pluginModule.create({
      languageServiceHost: host,
      languageService: ls,
      project: {},
      config: {},
    } as any);

    // Populate cache
    host.getScriptSnapshot('app.tsx');
    const v1 = host.getScriptVersion('app.tsx');
    expect(v1).toBe('1:1');

    // Change host version WITHOUT calling getScriptSnapshot again
    versions['app.tsx'] = 5;
    const v2 = host.getScriptVersion('app.tsx');
    // The host version should change, doc version stays
    expect(v2).toBe('5:1');
    expect(v2).not.toBe(v1);
  });

  it('no cache returns plain host version', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const files: Record<string, string> = {
      'plain.ts': 'const x = 1;',
    };
    const versions: Record<string, number> = { 'plain.ts': 3 };

    const host = {
      getScriptSnapshot(fileName: string) {
        const c = files[fileName];
        return c !== undefined ? mockScriptSnapshot(c) : undefined;
      },
      getScriptVersion(fileName: string) {
        return String(versions[fileName] ?? 0);
      },
    };

    const ls: Record<string, Function> = {
      getCompletionsAtPosition: () => null,
      getSemanticDiagnostics: () => [],
      getSyntacticDiagnostics: () => [],
      dispose: () => {},
    };

    const pluginModule = init({ typescript: tsModule });
    pluginModule.create({
      languageServiceHost: host,
      languageService: ls,
      project: {},
      config: {},
    } as any);

    // Access the file (no pug, so no cache entry)
    host.getScriptSnapshot('plain.ts');
    const version = host.getScriptVersion('plain.ts');
    // Should return plain host version (no colon format)
    expect(version).toBe('3');
    expect(version).not.toContain(':');
  });
});

// ── Finding 3: Plugin module resolvability ───────────────────────

describe('plugin module resolvability (Finding 3)', () => {
  const root = resolve(__dirname, '../../../..');
  const extensionPkgPath = resolve(root, 'packages/vscode-react-pug/package.json');
  const depPkgPath = resolve(root, 'node_modules/@startupjs/typescript-plugin-react-pug/package.json');
  const distPluginPath = resolve(root, 'packages/typescript-plugin-react-pug/dist/plugin.js');

  it('extension package declares @startupjs/typescript-plugin-react-pug dependency', () => {
    const pkg = JSON.parse(readFileSync(extensionPkgPath, 'utf-8'));
    expect(pkg.dependencies?.['@startupjs/typescript-plugin-react-pug'])
      .toBe('^0.0.1');
  });

  it('node_modules/@startupjs/typescript-plugin-react-pug/package.json exists', () => {
    expect(existsSync(depPkgPath)).toBe(true);
  });

  it('dependency package.json points to package-local dist/plugin.js', () => {
    const content = JSON.parse(readFileSync(depPkgPath, 'utf-8'));
    expect(content.main).toBe('./dist/plugin.js');
  });

  it('the resolved dist/plugin.js file actually exists', () => {
    const depDir = resolve(root, 'node_modules/@startupjs/typescript-plugin-react-pug');
    const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf-8'));
    const resolvedPath = resolve(depDir, depPkg.main);
    expect(existsSync(resolvedPath)).toBe(true);
  });

  it('resolved path matches packages/typescript-plugin-react-pug/dist/plugin.js', () => {
    const depDir = resolve(root, 'node_modules/@startupjs/typescript-plugin-react-pug');
    const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf-8'));
    const resolvedPath = resolve(depDir, depPkg.main);
    const fs = require('fs') as typeof import('fs');
    expect(fs.realpathSync(resolvedPath)).toBe(fs.realpathSync(distPluginPath));
  });

  it('typescriptServerPlugins contribution uses @startupjs/typescript-plugin-react-pug', () => {
    const pkg = JSON.parse(readFileSync(extensionPkgPath, 'utf-8'));
    const tsPlugins = pkg.contributes?.typescriptServerPlugins ?? [];
    expect(tsPlugins[0]?.name).toBe('@startupjs/typescript-plugin-react-pug');
  });
});

// ── Finding 4: Grammar word boundary ─────────────────────────────

describe('grammar regex word boundary (Finding 4)', () => {
  const grammarPath = resolve(__dirname, '../../../vscode-react-pug/syntaxes/pug-template-literal.json');
  let beginPattern: string;

  function getBeginRegex(): RegExp {
    if (!beginPattern) {
      const grammar = JSON.parse(readFileSync(grammarPath, 'utf-8'));
      beginPattern = grammar.repository['pug-tagged-template'].begin;
    }
    return new RegExp(beginPattern);
  }

  // Should match: pug`, (pug`, ` pug`, =pug`
  it('matches pug` standalone', () => {
    expect('pug`').toMatch(getBeginRegex());
  });

  it('matches pug` preceded by opening paren', () => {
    expect('(pug`').toMatch(getBeginRegex());
  });

  it('matches pug` preceded by space', () => {
    expect(' pug`').toMatch(getBeginRegex());
  });

  it('matches pug` preceded by equals', () => {
    expect('=pug`').toMatch(getBeginRegex());
  });

  it('matches pug` preceded by newline', () => {
    expect('\npug`').toMatch(getBeginRegex());
  });

  // Should NOT match: notpug`, my_pug`, $pug`, _pug`
  it('does NOT match notpug`', () => {
    expect('notpug`').not.toMatch(getBeginRegex());
  });

  it('does NOT match my_pug`', () => {
    expect('my_pug`').not.toMatch(getBeginRegex());
  });

  it('does NOT match $pug`', () => {
    expect('$pug`').not.toMatch(getBeginRegex());
  });

  it('does NOT match _pug`', () => {
    expect('_pug`').not.toMatch(getBeginRegex());
  });

  it('does NOT match apug`', () => {
    expect('apug`').not.toMatch(getBeginRegex());
  });

  it('does NOT match 0pug`', () => {
    // digit before pug should be treated as part of an identifier
    expect('0pug`').not.toMatch(getBeginRegex());
  });
});
