import { describe, it, expect } from 'vitest';

// Test checklist:
// [x] Plugin module exports an init function
// [x] init function accepts { typescript } modules object
// [x] init function returns a PluginModule with create() method
// [x] create() returns a LanguageService proxy object
// [x] Proxy delegates methods to underlying LanguageService
// [x] Plugin does not throw during initialization

// We import the source directly rather than the bundled dist,
// so that vitest can process TypeScript and we get source-level coverage.
// The plugin uses `export = init` (CJS), so we need dynamic import.

async function loadPlugin() {
  // vitest handles TS transpilation; use dynamic import for `export =` module
  const mod = await import('../../src/index.ts');
  return mod.default ?? mod;
}

/** Minimal mock of TypeScript module needed by the plugin */
function createMockTsModule() {
  return {
    ScriptSnapshot: {
      fromString(text: string) {
        return {
          getText: (start: number, end: number) => text.slice(start, end),
          getLength: () => text.length,
          getChangeRange: () => undefined,
        };
      },
    },
  };
}

/** Minimal mock of PluginCreateInfo */
function createMockPluginInfo(fileContents: Record<string, string> = {}) {
  const versions: Record<string, number> = {};
  for (const key of Object.keys(fileContents)) {
    versions[key] = 1;
  }

  const languageServiceHost = {
    getScriptSnapshot(fileName: string) {
      const content = fileContents[fileName];
      if (content === undefined) return undefined;
      return createMockTsModule().ScriptSnapshot.fromString(content);
    },
    getScriptVersion(fileName: string) {
      return String(versions[fileName] ?? 0);
    },
  };

  // Create a mock LanguageService with some methods
  const languageService: Record<string, Function> = {
    getCompletionsAtPosition: () => ({ entries: [] }),
    getQuickInfoAtPosition: () => undefined,
    getSemanticDiagnostics: () => [],
    getSyntacticDiagnostics: () => [],
    dispose: () => {},
  };

  return {
    languageServiceHost,
    languageService,
    project: {},
    config: {},
  };
}

describe('plugin module', () => {
  it('exports an init function', async () => {
    const init = await loadPlugin();
    expect(typeof init).toBe('function');
  });

  it('init returns a PluginModule with create()', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });
    expect(pluginModule).toBeDefined();
    expect(typeof pluginModule.create).toBe('function');
  });

  it('create() returns a proxy LanguageService', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });
    const info = createMockPluginInfo();
    const proxy = pluginModule.create(info as any);
    expect(proxy).toBeDefined();
    expect(typeof proxy.getCompletionsAtPosition).toBe('function');
    expect(typeof proxy.getQuickInfoAtPosition).toBe('function');
  });

  it('proxy delegates methods to underlying LanguageService', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });

    let called = false;
    const info = createMockPluginInfo();
    info.languageService.getCompletionsAtPosition = () => {
      called = true;
      return { entries: [{ name: 'test' }] };
    };

    const proxy = pluginModule.create(info as any);
    const result = proxy.getCompletionsAtPosition('file.ts', 0, undefined as any);
    expect(called).toBe(true);
    expect(result).toEqual({ entries: [{ name: 'test' }] });
  });

  it('proxy includes all methods from the underlying LanguageService', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });
    const info = createMockPluginInfo();
    const proxy = pluginModule.create(info as any);

    // All original LS methods should be present on the proxy
    for (const key of Object.keys(info.languageService)) {
      expect(typeof (proxy as any)[key]).toBe('function');
    }
  });

  it('does not throw during initialization', async () => {
    const init = await loadPlugin();
    const tsModule = createMockTsModule();
    const pluginModule = init({ typescript: tsModule });
    const info = createMockPluginInfo();

    expect(() => {
      pluginModule.create(info as any);
    }).not.toThrow();
  });
});
