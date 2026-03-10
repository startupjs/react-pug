import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { SourceMap, type Mapping } from '@volar/source-map';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
const APP_FILE = path.join(FIXTURES_DIR, 'app.tsx');
const PLAIN_FILE = path.join(FIXTURES_DIR, 'plain.ts');

async function loadPlugin() {
  const mod = await import('../../src/index.ts');
  return mod.default ?? mod;
}

/**
 * Create a LanguageService with our plugin's host patching applied.
 * This simulates what tsserver does when it loads our plugin.
 */
function createLanguageServiceWithPlugin(
  init: Function,
  rootFiles: string[],
  fixturesDir: string,
) {
  const configPath = path.join(fixturesDir, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fixturesDir,
  );

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootFiles,
    getScriptVersion: () => '0',
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
    },
    getCurrentDirectory: () => fixturesDir,
    getCompilationSettings: () => parsedConfig.options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

  // Apply our plugin
  const pluginModule = init({ typescript: ts });
  const pluginCreateInfo = {
    languageServiceHost: host,
    languageService: ls,
    project: {} as any,
    serverHost: {} as any,
    config: {},
  };

  const proxiedLs = pluginModule.create(pluginCreateInfo);

  return { ls: proxiedLs, host };
}

describe('Spike: TS plugin host patching', () => {
  let ls: ts.LanguageService;
  let host: ts.LanguageServiceHost;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    host = result.host;
  });

  it('serves shadow content for files with pug templates', () => {
    const snapshot = host.getScriptSnapshot!(APP_FILE);
    expect(snapshot).toBeDefined();
    const text = snapshot!.getText(0, snapshot!.getLength());

    expect(text).toMatchInlineSnapshot(`
      "import { Button } from './Button';

      const handler = () => console.log('clicked');

      const view = (<Button onClick={handler} label={"Hello"}>Click me</Button>)
      "
    `);
  });

  it('passes through files without pug templates unmodified', () => {
    const snapshot = host.getScriptSnapshot!(PLAIN_FILE);
    expect(snapshot).toBeDefined();
    const text = snapshot!.getText(0, snapshot!.getLength());

    const original = fs.readFileSync(PLAIN_FILE, 'utf-8');
    expect(text).toBe(original);
  });

  it('returns completions at a position inside the shadow JSX', () => {
    // Read original file to find the position of 'onClick' inside pug template
    const originalText = fs.readFileSync(APP_FILE, 'utf-8');

    // Find position of 'onClick' in the original pug content
    // The proxy will map this original offset -> shadow offset automatically
    const onClickIdx = originalText.indexOf('onClick');
    expect(onClickIdx).toBeGreaterThan(-1);

    // Position at 'onClick' should trigger attribute completions on Button
    const completions = ls.getCompletionsAtPosition(APP_FILE, onClickIdx, undefined);
    expect(completions).toBeDefined();
    expect(completions!.entries.length).toBeGreaterThan(0);

    const entryNames = completions!.entries.map(e => e.name);
    // Should include ButtonProps member 'onClick' specifically
    expect(entryNames).toContain('onClick');
  });

  it('returns hover info for identifiers in shadow content', () => {
    // Use original-file position -- the proxy maps original -> shadow
    const originalText = fs.readFileSync(APP_FILE, 'utf-8');

    // Find "handler" in the original pug content (inside pug`...`)
    const handlerIdx = originalText.indexOf('handler', originalText.indexOf('pug`'));
    expect(handlerIdx).toBeGreaterThan(-1);

    const quickInfo = ls.getQuickInfoAtPosition(APP_FILE, handlerIdx);
    expect(quickInfo).toBeDefined();
    expect(quickInfo!.kind).toBe(ts.ScriptElementKind.constElement);
  });

  it('returns no semantic diagnostics for well-typed plain files', () => {
    const diags = ls.getSemanticDiagnostics(PLAIN_FILE);
    expect(diags).toHaveLength(0);
  });
});

describe('Spike: @volar/source-map bidirectional mapping', () => {
  it('maps source offsets to generated offsets and back', () => {
    const mappings: Mapping[] = [
      {
        sourceOffsets: [10],
        generatedOffsets: [20],
        lengths: [6],
        data: {},
      },
    ];

    const sourceMap = new SourceMap(mappings);

    // Source -> Generated
    const genResults = [...sourceMap.toGeneratedLocation(10)];
    expect(genResults.length).toBeGreaterThan(0);
    expect(genResults[0][0]).toBe(20);

    // Generated -> Source (roundtrip)
    const srcResults = [...sourceMap.toSourceLocation(20)];
    expect(srcResults.length).toBeGreaterThan(0);
    expect(srcResults[0][0]).toBe(10);
  });

  it('maps interior offsets within a span', () => {
    const mappings: Mapping[] = [
      {
        sourceOffsets: [5],
        generatedOffsets: [15],
        lengths: [7],
        data: {},
      },
    ];

    const sourceMap = new SourceMap(mappings);

    // Offset 3 into the span: source 8 -> generated 18
    const genResults = [...sourceMap.toGeneratedLocation(8)];
    expect(genResults.length).toBeGreaterThan(0);
    expect(genResults[0][0]).toBe(18);

    // Roundtrip: generated 18 -> source 8
    const srcResults = [...sourceMap.toSourceLocation(18)];
    expect(srcResults.length).toBeGreaterThan(0);
    expect(srcResults[0][0]).toBe(8);
  });

  it('returns empty for offsets outside all mapped spans', () => {
    const mappings: Mapping[] = [
      {
        sourceOffsets: [10],
        generatedOffsets: [20],
        lengths: [5],
        data: {},
      },
    ];

    const sourceMap = new SourceMap(mappings);

    const before = [...sourceMap.toGeneratedLocation(0)];
    expect(before).toHaveLength(0);

    const after = [...sourceMap.toGeneratedLocation(100)];
    expect(after).toHaveLength(0);
  });

  it('handles multiple mapping segments in a single Mapping entry', () => {
    const mappings: Mapping[] = [
      {
        sourceOffsets: [0, 20],
        generatedOffsets: [10, 40],
        lengths: [5, 8],
        data: {},
      },
    ];

    const sourceMap = new SourceMap(mappings);

    // First segment: source 2 -> generated 12
    const gen1 = [...sourceMap.toGeneratedLocation(2)];
    expect(gen1.length).toBeGreaterThan(0);
    expect(gen1[0][0]).toBe(12);

    // Second segment: source 23 -> generated 43
    const gen2 = [...sourceMap.toGeneratedLocation(23)];
    expect(gen2.length).toBeGreaterThan(0);
    expect(gen2[0][0]).toBe(43);
  });

  it('handles different source and generated lengths', () => {
    const mappings: Mapping[] = [
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [5],
        generatedLengths: [16],
        data: {},
      },
    ];

    const sourceMap = new SourceMap(mappings);

    // Start of span: source 0 -> generated 0
    const gen = [...sourceMap.toGeneratedLocation(0)];
    expect(gen.length).toBeGreaterThan(0);
    expect(gen[0][0]).toBe(0);
  });
});
