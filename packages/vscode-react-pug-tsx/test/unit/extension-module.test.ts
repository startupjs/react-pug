import { describe, it, expect } from 'vitest';

// Test checklist:
// [x] Extension module exports activate function
// [x] Extension module exports deactivate function
// [x] activate is a function that accepts ExtensionContext
// [x] deactivate is a function with no required arguments
// [x] activate does not throw with a mock context
// [x] deactivate does not throw

// We import the source directly for vitest TS processing.
// The extension depends on the 'vscode' module which is external.
// We mock it since we're testing the module shape, not VS Code integration.

// Mock vscode module before importing the extension
import { vi } from 'vitest';
vi.mock('vscode', () => ({
  ExtensionContext: class {},
  languages: {
    createDiagnosticCollection: () => ({
      clear: () => {},
      set: () => {},
      dispose: () => {},
    }),
    registerCompletionItemProvider: () => ({ dispose: () => {} }),
    setTextDocumentLanguage: async (doc: any) => doc,
  },
  workspace: {
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
    registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
    openTextDocument: async () => ({}),
    getConfiguration: () => ({ get: (_key: string, def: any) => def }),
  },
  extensions: {
    getExtension: () => undefined,
  },
  window: {
    showInformationMessage: () => {},
    showWarningMessage: () => {},
    showErrorMessage: () => {},
    showTextDocument: async () => {},
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
    activeTextEditor: undefined,
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
  },
  Uri: {
    parse: (s: string) => ({ toString: () => s }),
  },
  ViewColumn: { Beside: 2 },
}));

describe('extension module', () => {
  it('exports activate function', async () => {
    const ext = await import('../../src/index.ts');
    expect(typeof ext.activate).toBe('function');
  });

  it('exports deactivate function', async () => {
    const ext = await import('../../src/index.ts');
    expect(typeof ext.deactivate).toBe('function');
  });

  it('activate accepts a context argument', async () => {
    const ext = await import('../../src/index.ts');
    // activate should accept one argument (ExtensionContext)
    expect(ext.activate.length).toBeLessThanOrEqual(1);
  });

  it('deactivate has no required arguments', async () => {
    const ext = await import('../../src/index.ts');
    expect(ext.deactivate.length).toBe(0);
  });

  it('activate does not throw with a mock context', async () => {
    const ext = await import('../../src/index.ts');
    const mockContext = {
      subscriptions: [],
      extensionPath: '/mock/path',
      extensionUri: {},
      globalState: { get: () => {}, update: () => {} },
      workspaceState: { get: () => {}, update: () => {} },
    };
    expect(() => {
      ext.activate(mockContext as any);
    }).not.toThrow();
  });

  it('deactivate does not throw', async () => {
    const ext = await import('../../src/index.ts');
    expect(() => {
      ext.deactivate();
    }).not.toThrow();
  });
});
