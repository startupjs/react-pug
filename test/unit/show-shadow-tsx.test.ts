import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the callbacks registered during activate()
let registeredCommands: Map<string, Function>;
let registeredProviders: Map<string, any>;
let mockSubscriptions: any[];

// Spies for vscode API
const showWarningMessage = vi.fn();
const showInformationMessage = vi.fn();
const showTextDocument = vi.fn().mockResolvedValue(undefined);
const openTextDocument = vi.fn().mockResolvedValue({ uri: 'mock-doc' });
const getConfiguration = vi.fn();

// Default mock for activeTextEditor (can be overridden per test)
let mockActiveTextEditor: any = undefined;

vi.mock('vscode', () => ({
  ExtensionContext: class {},
  workspace: {
    registerTextDocumentContentProvider: (scheme: string, provider: any) => {
      registeredProviders.set(scheme, provider);
      return { dispose: () => {} };
    },
    openTextDocument: (...args: any[]) => openTextDocument(...args),
    getConfiguration: (...args: any[]) => getConfiguration(...args),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
  },
  window: {
    get activeTextEditor() {
      return mockActiveTextEditor;
    },
    showWarningMessage: (...args: any[]) => showWarningMessage(...args),
    showInformationMessage: (...args: any[]) => showInformationMessage(...args),
    showErrorMessage: vi.fn(),
    showTextDocument: (...args: any[]) => showTextDocument(...args),
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
  },
  commands: {
    registerCommand: (name: string, callback: Function) => {
      registeredCommands.set(name, callback);
      return { dispose: () => {} };
    },
  },
  Uri: {
    parse: (s: string) => ({ toString: () => s, scheme: s.split(':')[0] }),
  },
  ViewColumn: { Beside: 2 },
  languages: {
    createDiagnosticCollection: () => ({
      clear: () => {},
      set: () => {},
      dispose: () => {},
    }),
  },
}));

async function activateExtension() {
  // Clear module cache to get a fresh activation each time
  vi.resetModules();
  const ext = await import('../../src/extension/index.ts');
  const mockContext = {
    subscriptions: mockSubscriptions,
    extensionPath: '/mock/path',
    extensionUri: {},
    globalState: { get: () => {}, update: () => {} },
    workspaceState: { get: () => {}, update: () => {} },
  };
  ext.activate(mockContext as any);
  return ext;
}

describe('pugReact.showShadowTsx command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredCommands = new Map();
    registeredProviders = new Map();
    mockSubscriptions = [];
    mockActiveTextEditor = undefined;

    // Default config mock
    getConfiguration.mockReturnValue({
      get: (_key: string, def: any) => def,
    });
  });

  it('registers the command during activation', async () => {
    await activateExtension();
    expect(registeredCommands.has('pugReact.showShadowTsx')).toBe(true);
  });

  it('registers content provider with pug-react-shadow scheme', async () => {
    await activateExtension();
    expect(registeredProviders.has('pug-react-shadow')).toBe(true);
  });

  it('pushes subscriptions to context', async () => {
    await activateExtension();
    // Should push both the content provider and the command registration
    expect(mockSubscriptions.length).toBeGreaterThanOrEqual(2);
  });

  it('shows warning when no active editor', async () => {
    await activateExtension();
    mockActiveTextEditor = undefined;

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    expect(showWarningMessage).toHaveBeenCalledWith('No active editor');
    expect(openTextDocument).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('shows info message when file has no pug templates', async () => {
    await activateExtension();
    mockActiveTextEditor = {
      document: {
        getText: () => 'const x = 1;\nexport default x;',
        fileName: '/test/plain.ts',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    expect(showInformationMessage).toHaveBeenCalledWith(
      'No pug templates found in the current file',
    );
    expect(openTextDocument).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('calls buildShadowDocument with correct args for pug file', async () => {
    await activateExtension();
    const fileContent = 'const view = pug`\n  div Hello\n`\n';
    mockActiveTextEditor = {
      document: {
        getText: () => fileContent,
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    // Should open the shadow document (buildShadowDocument found pug regions)
    expect(openTextDocument).toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalled();
    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('opens shadow document with correct URI scheme', async () => {
    await activateExtension();
    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = pug`\n  div Hello\n`\n',
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    const uriArg = openTextDocument.mock.calls[0][0];
    const uriStr = uriArg.toString();
    expect(uriStr).toContain('pug-react-shadow:');
    expect(uriStr).toContain('/test/app.tsx');
    expect(uriStr).toContain('.shadow.tsx');
  });

  it('opens document in side-by-side preview with preserved focus', async () => {
    await activateExtension();
    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = pug`\n  div Hello\n`\n',
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    expect(showTextDocument).toHaveBeenCalledTimes(1);
    const [, options] = showTextDocument.mock.calls[0];
    expect(options.viewColumn).toBe(2); // ViewColumn.Beside
    expect(options.preview).toBe(true);
    expect(options.preserveFocus).toBe(true);
  });

  it('content provider returns shadow text for registered URI', async () => {
    await activateExtension();
    const fileContent = 'const view = pug`\n  div Hello\n`\n';
    mockActiveTextEditor = {
      document: {
        getText: () => fileContent,
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    // Get the provider and the URI that was used
    const provider = registeredProviders.get('pug-react-shadow');
    expect(provider).toBeDefined();

    const uriArg = openTextDocument.mock.calls[0][0];
    const content = provider.provideTextDocumentContent(uriArg);

    // Shadow text should contain JSX, not pug
    expect(content).not.toContain('pug`');
    expect(content).toContain('<div');
  });

  it('content provider returns empty string for unknown URI', async () => {
    await activateExtension();

    const provider = registeredProviders.get('pug-react-shadow');
    const unknownUri = { toString: () => 'pug-react-shadow:/unknown/file.tsx' };
    const content = provider.provideTextDocumentContent(unknownUri);

    expect(content).toBe('');
  });

  it('reads tagFunction from pugReact configuration', async () => {
    await activateExtension();

    getConfiguration.mockReturnValue({
      get: (key: string, def: any) => (key === 'tagFunction' ? 'html' : def),
    });

    // File uses html`` instead of pug``
    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = html`\n  div Hello\n`\n',
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    // getConfiguration should be called with 'pugReact'
    expect(getConfiguration).toHaveBeenCalledWith('pugReact');

    // Should find the html`` template and open shadow doc
    expect(openTextDocument).toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalled();
  });

  it('tagFunction default is pug when config returns default', async () => {
    await activateExtension();

    // Config returns default value (simulates no user override)
    getConfiguration.mockReturnValue({
      get: (_key: string, def: any) => def,
    });

    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = pug`\n  div Hello\n`\n',
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    // Should find pug`` template with default tagFunction
    expect(openTextDocument).toHaveBeenCalled();
  });

  it('tagFunction mismatch means no templates found', async () => {
    await activateExtension();

    getConfiguration.mockReturnValue({
      get: (key: string, def: any) => (key === 'tagFunction' ? 'html' : def),
    });

    // File uses pug`` but config says html
    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = pug`\n  div Hello\n`\n',
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    // Should show info message since html`` is not found
    expect(showInformationMessage).toHaveBeenCalledWith(
      'No pug templates found in the current file',
    );
    expect(openTextDocument).not.toHaveBeenCalled();
  });

  it('handles .jsx file correctly', async () => {
    await activateExtension();
    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = pug`\n  span Click\n`\n',
        fileName: '/test/app.jsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    expect(openTextDocument).toHaveBeenCalled();
    expect(showTextDocument).toHaveBeenCalled();

    const provider = registeredProviders.get('pug-react-shadow');
    const uriArg = openTextDocument.mock.calls[0][0];
    const content = provider.provideTextDocumentContent(uriArg);
    expect(content).toContain('<span');
  });

  it('shadow content updates on repeated invocations', async () => {
    await activateExtension();

    // First invocation
    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = pug`\n  div First\n`\n',
        fileName: '/test/app.tsx',
      },
    };

    const handler = registeredCommands.get('pugReact.showShadowTsx')!;
    await handler();

    const provider = registeredProviders.get('pug-react-shadow');
    const uriArg1 = openTextDocument.mock.calls[0][0];
    const content1 = provider.provideTextDocumentContent(uriArg1);
    expect(content1).toContain('First');

    // Second invocation with different content but same file
    mockActiveTextEditor = {
      document: {
        getText: () => 'const view = pug`\n  div Second\n`\n',
        fileName: '/test/app.tsx',
      },
    };

    await handler();

    const uriArg2 = openTextDocument.mock.calls[1][0];
    const content2 = provider.provideTextDocumentContent(uriArg2);
    expect(content2).toContain('Second');
  });
});
