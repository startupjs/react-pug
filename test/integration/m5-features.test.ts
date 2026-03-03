import { describe, it, expect, beforeAll } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
const APP_FILE = path.join(FIXTURES_DIR, 'app.tsx');
const BUTTON_FILE = path.join(FIXTURES_DIR, 'Button.tsx');
const PLAIN_FILE = path.join(FIXTURES_DIR, 'plain.ts');

async function loadPlugin() {
  const mod = await import('../../src/plugin/index.ts');
  return mod.default ?? mod;
}

function createLanguageServiceWithPlugin(
  init: Function,
  rootFiles: string[],
  fixturesDir: string,
  virtualFiles?: Map<string, string>,
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
      if (virtualFiles?.has(fileName)) {
        return ts.ScriptSnapshot.fromString(virtualFiles.get(fileName)!);
      }
      if (!fs.existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
    },
    getCurrentDirectory: () => fixturesDir,
    getCompilationSettings: () => parsedConfig.options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (f) => virtualFiles?.has(f) || ts.sys.fileExists(f),
    readFile: (f) => virtualFiles?.has(f) ? virtualFiles.get(f) : ts.sys.readFile(f),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

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

function readOriginal(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

// ── Rename ──────────────────────────────────────────────────────

describe('rename through real pipeline', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    appText = readOriginal(APP_FILE);
  });

  it('getRenameInfo on variable used in pug returns canRename with mapped triggerSpan', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const renameInfo = ls.getRenameInfo(APP_FILE, handlerIdx, { allowRenameOfImportPath: false });
    expect(renameInfo.canRename).toBe(true);
    if (renameInfo.canRename) {
      // triggerSpan should be mapped back to original file range
      expect(renameInfo.triggerSpan.start).toBeGreaterThanOrEqual(0);
      expect(renameInfo.triggerSpan.start).toBeLessThan(appText.length);
    }
  });

  it('findRenameLocations on variable in pug returns locations with mapped textSpans', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);

    const locations = ls.findRenameLocations(APP_FILE, handlerIdx, false, false, undefined as any);
    expect(locations).toBeDefined();
    expect(locations!.length).toBeGreaterThan(0);
    for (const loc of locations!) {
      expect(loc.textSpan.start).toBeGreaterThanOrEqual(0);
      expect(loc.textSpan.length).toBe('handler'.length);
      if (loc.fileName === APP_FILE) {
        expect(loc.textSpan.start).toBeLessThan(appText.length);
        // The text at this span should be 'handler'
        const spanText = appText.slice(loc.textSpan.start, loc.textSpan.start + loc.textSpan.length);
        expect(spanText).toBe('handler');
      }
    }
  });

  it('getRenameInfo on unmapped position returns canRename: false', () => {
    const pugIdx = appText.indexOf('pug`');
    const renameInfo = ls.getRenameInfo(APP_FILE, pugIdx, { allowRenameOfImportPath: false });
    expect(renameInfo.canRename).toBe(false);
  });

  it('getRenameInfo works for non-pug positions', () => {
    // 'handler' const declaration outside pug
    const handlerDef = appText.indexOf('handler');
    expect(handlerDef).toBeLessThan(appText.indexOf('pug`'));

    const renameInfo = ls.getRenameInfo(APP_FILE, handlerDef, { allowRenameOfImportPath: false });
    // At the variable declaration, rename should be possible
    expect(renameInfo.canRename).toBe(true);
    if (renameInfo.canRename) {
      expect(renameInfo.triggerSpan.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('findRenameLocations for non-pug variable finds both declaration and pug usage', () => {
    const handlerDef = appText.indexOf('handler');
    expect(handlerDef).toBeLessThan(appText.indexOf('pug`'));

    const locations = ls.findRenameLocations(APP_FILE, handlerDef, false, false, undefined as any);
    expect(locations).toBeDefined();
    // Should find at least 2 locations: declaration + usage in pug
    expect(locations!.length).toBeGreaterThanOrEqual(2);
    // All locations should reference 'handler' text
    for (const loc of locations!) {
      expect(loc.textSpan.start).toBeGreaterThanOrEqual(0);
      expect(loc.textSpan.length).toBe('handler'.length);
      if (loc.fileName === APP_FILE) {
        const spanText = appText.slice(loc.textSpan.start, loc.textSpan.start + loc.textSpan.length);
        expect(spanText).toBe('handler');
      }
    }
  });

  it('getRenameInfo in plain file works normally', () => {
    const plainText = readOriginal(PLAIN_FILE);
    const addIdx = plainText.indexOf('add');

    const renameInfo = ls.getRenameInfo(PLAIN_FILE, addIdx, { allowRenameOfImportPath: false });
    expect(renameInfo.canRename).toBe(true);
    if (renameInfo.canRename) {
      expect(renameInfo.triggerSpan.start).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── References ──────────────────────────────────────────────────

describe('references through real pipeline', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    appText = readOriginal(APP_FILE);
  });

  it('findReferences on component name returns references with mapped textSpans', () => {
    const pugStart = appText.indexOf('pug`');
    const buttonIdx = appText.indexOf('Button', pugStart + 4);
    expect(buttonIdx).toBeGreaterThan(pugStart);

    const refs = ls.findReferences(APP_FILE, buttonIdx);
    expect(refs).toBeDefined();
    expect(refs!.length).toBeGreaterThan(0);
    for (const group of refs!) {
      expect(group.definition.textSpan.start).toBeGreaterThanOrEqual(0);
      // Definition should reference Button
      expect(group.definition.name).toContain('Button');
      for (const ref of group.references) {
        expect(ref.textSpan.start).toBeGreaterThanOrEqual(0);
        expect(ref.textSpan.length).toBe('Button'.length);
      }
    }
  });

  it('getReferencesAtPosition on variable in pug returns references', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const refs = ls.getReferencesAtPosition(APP_FILE, handlerIdx);
    expect(refs).toBeDefined();
    // Should find at least 2 references: declaration + usage in pug
    expect(refs!.length).toBeGreaterThanOrEqual(2);
    for (const ref of refs!) {
      expect(ref.textSpan.start).toBeGreaterThanOrEqual(0);
      expect(ref.textSpan.length).toBe('handler'.length);
      if (ref.fileName === APP_FILE) {
        expect(ref.textSpan.start).toBeLessThan(appText.length);
        const spanText = appText.slice(ref.textSpan.start, ref.textSpan.start + ref.textSpan.length);
        expect(spanText).toBe('handler');
      }
    }
  });

  it('findReferences on unmapped position returns undefined', () => {
    const pugIdx = appText.indexOf('pug`');
    const refs = ls.findReferences(APP_FILE, pugIdx);
    expect(refs).toBeUndefined();
  });

  it('getReferencesAtPosition on unmapped position returns undefined', () => {
    const pugIdx = appText.indexOf('pug`');
    const refs = ls.getReferencesAtPosition(APP_FILE, pugIdx);
    expect(refs).toBeUndefined();
  });

  it('findReferences for non-pug positions works normally', () => {
    const handlerDef = appText.indexOf('handler');
    expect(handlerDef).toBeLessThan(appText.indexOf('pug`'));

    const refs = ls.findReferences(APP_FILE, handlerDef);
    expect(refs).toBeDefined();
    expect(refs!.length).toBeGreaterThan(0);
    for (const group of refs!) {
      expect(group.definition.textSpan.start).toBeGreaterThanOrEqual(0);
      // Should find references across declaration and pug usage
      expect(group.references.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('getReferencesAtPosition in plain file works normally', () => {
    const plainText = readOriginal(PLAIN_FILE);
    const addIdx = plainText.indexOf('add');

    const refs = ls.getReferencesAtPosition(PLAIN_FILE, addIdx);
    expect(refs).toBeDefined();
    expect(refs!.length).toBeGreaterThan(0);
    expect(refs![0].textSpan.start).toBeGreaterThanOrEqual(0);
  });
});

// ── Document highlights ─────────────────────────────────────────

describe('document highlights through real pipeline', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    appText = readOriginal(APP_FILE);
  });

  it('getDocumentHighlights on identifier in pug returns highlights with mapped textSpans', () => {
    const pugStart = appText.indexOf('pug`');
    const handlerIdx = appText.indexOf('handler', pugStart);
    expect(handlerIdx).toBeGreaterThan(pugStart);

    const highlights = ls.getDocumentHighlights(APP_FILE, handlerIdx, [APP_FILE]);
    expect(highlights).toBeDefined();
    expect(highlights!.length).toBeGreaterThan(0);
    for (const docHighlight of highlights!) {
      // Should have at least 2 highlights (declaration + usage in pug)
      expect(docHighlight.highlightSpans.length).toBeGreaterThanOrEqual(2);
      for (const span of docHighlight.highlightSpans) {
        expect(span.textSpan.start).toBeGreaterThanOrEqual(0);
        expect(span.textSpan.length).toBe('handler'.length);
        if (docHighlight.fileName === APP_FILE) {
          expect(span.textSpan.start).toBeLessThan(appText.length);
          const spanText = appText.slice(span.textSpan.start, span.textSpan.start + span.textSpan.length);
          expect(spanText).toBe('handler');
        }
      }
    }
  });

  it('getDocumentHighlights on unmapped position returns undefined', () => {
    const pugIdx = appText.indexOf('pug`');
    const highlights = ls.getDocumentHighlights(APP_FILE, pugIdx, [APP_FILE]);
    expect(highlights).toBeUndefined();
  });

  it('getDocumentHighlights for non-pug positions works normally', () => {
    const handlerDef = appText.indexOf('handler');
    expect(handlerDef).toBeLessThan(appText.indexOf('pug`'));

    const highlights = ls.getDocumentHighlights(APP_FILE, handlerDef, [APP_FILE]);
    expect(highlights).toBeDefined();
    expect(highlights!.length).toBeGreaterThan(0);
    for (const docHighlight of highlights!) {
      expect(docHighlight.highlightSpans.length).toBeGreaterThanOrEqual(2);
      for (const span of docHighlight.highlightSpans) {
        expect(span.textSpan.start).toBeGreaterThanOrEqual(0);
        expect(span.textSpan.length).toBe('handler'.length);
      }
    }
  });

  it('getDocumentHighlights in plain file works normally', () => {
    const plainText = readOriginal(PLAIN_FILE);
    const addIdx = plainText.indexOf('add');

    const highlights = ls.getDocumentHighlights(PLAIN_FILE, addIdx, [PLAIN_FILE]);
    expect(highlights).toBeDefined();
    expect(highlights!.length).toBeGreaterThan(0);
    expect(highlights![0].highlightSpans.length).toBeGreaterThan(0);
  });
});

// ── Implementation ──────────────────────────────────────────────

describe('implementation through real pipeline', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    const rootFiles = [APP_FILE, BUTTON_FILE, PLAIN_FILE];
    const result = createLanguageServiceWithPlugin(init, rootFiles, FIXTURES_DIR);
    ls = result.ls;
    appText = readOriginal(APP_FILE);
  });

  it('getImplementationAtPosition on component in pug returns Button.tsx', () => {
    const pugStart = appText.indexOf('pug`');
    const buttonIdx = appText.indexOf('Button', pugStart + 4);
    expect(buttonIdx).toBeGreaterThan(pugStart);

    const impls = ls.getImplementationAtPosition(APP_FILE, buttonIdx);
    expect(impls).toBeDefined();
    expect(impls!.length).toBeGreaterThan(0);
    // Should find Button implementation in Button.tsx
    const buttonImpl = impls!.find(i => i.fileName.includes('Button'));
    expect(buttonImpl).toBeDefined();
    expect(buttonImpl!.textSpan.start).toBeGreaterThanOrEqual(0);
    expect(buttonImpl!.fileName).toContain('Button.tsx');
  });

  it('getImplementationAtPosition on unmapped position returns undefined', () => {
    const pugIdx = appText.indexOf('pug`');
    const impls = ls.getImplementationAtPosition(APP_FILE, pugIdx);
    expect(impls).toBeUndefined();
  });

  it('getImplementationAtPosition for non-pug positions works normally', () => {
    const handlerDef = appText.indexOf('handler');
    expect(handlerDef).toBeLessThan(appText.indexOf('pug`'));

    const impls = ls.getImplementationAtPosition(APP_FILE, handlerDef);
    // At const declaration, should return the declaration itself
    if (impls) {
      expect(impls.length).toBeGreaterThan(0);
      expect(impls[0].fileName).toBe(APP_FILE);
      expect(impls[0].textSpan.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('getImplementationAtPosition in plain file works normally', () => {
    const plainText = readOriginal(PLAIN_FILE);
    const addIdx = plainText.indexOf('add');

    const impls = ls.getImplementationAtPosition(PLAIN_FILE, addIdx);
    expect(impls).toBeDefined();
    expect(impls!.length).toBeGreaterThan(0);
    expect(impls![0].fileName).toBe(PLAIN_FILE);
  });
});
