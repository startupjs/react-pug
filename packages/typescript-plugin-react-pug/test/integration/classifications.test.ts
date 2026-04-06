import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spike');
const APP_FILE = path.join(FIXTURES_DIR, 'app.tsx');
const BUTTON_FILE = path.join(FIXTURES_DIR, 'Button.tsx');

async function loadPlugin() {
  const mod = await import('../../src/index.ts');
  return mod.default ?? mod;
}

function createLanguageServiceWithPlugin(init: Function, rootFiles: string[], fixturesDir: string) {
  const configPath = path.join(fixturesDir, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, fixturesDir);

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
  const pluginModule = init({ typescript: ts });
  const pluginCreateInfo = {
    languageServiceHost: host,
    languageService: ls,
    project: {} as any,
    serverHost: {} as any,
    config: {},
  };

  return pluginModule.create(pluginCreateInfo);
}

describe('encoded classifications through real pipeline', () => {
  let ls: ts.LanguageService;
  let appText: string;

  beforeAll(async () => {
    const init = await loadPlugin();
    ls = createLanguageServiceWithPlugin(init, [APP_FILE, BUTTON_FILE], FIXTURES_DIR);
    appText = fs.readFileSync(APP_FILE, 'utf-8');
  });

  it('maps syntactic classifications back to original pug positions', () => {
    const handlerIdx = appText.indexOf('handler', appText.indexOf('pug`'));
    expect(handlerIdx).toBeGreaterThan(0);

    const result = ls.getEncodedSyntacticClassifications(APP_FILE, {
      start: 0,
      length: appText.length,
    });

    const spans = result.spans ?? [];
    const hasOriginalHit = spans.some((_, i) => (
      i % 3 === 0
      && spans[i] <= handlerIdx
      && handlerIdx < spans[i] + spans[i + 1]
    ));
    expect(hasOriginalHit).toBe(true);
  });

  it('maps semantic classifications back to original pug positions', () => {
    const handlerIdx = appText.indexOf('handler', appText.indexOf('pug`'));
    expect(handlerIdx).toBeGreaterThan(0);

    const result = ls.getEncodedSemanticClassifications(APP_FILE, {
      start: 0,
      length: appText.length,
    }, ts.SemanticClassificationFormat.TwentyTwenty);

    const spans = result.spans ?? [];
    const hasOriginalHit = spans.some((_, i) => (
      i % 3 === 0
      && spans[i] <= handlerIdx
      && handlerIdx < spans[i] + spans[i + 1]
    ));
    expect(hasOriginalHit).toBe(true);
  });
});
