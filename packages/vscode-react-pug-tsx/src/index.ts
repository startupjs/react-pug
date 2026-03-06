import * as vscode from 'vscode';
import { buildShadowDocument } from '../../react-pug-core/src/language/shadowDocument';

const SCHEME = 'pug-react-shadow';
const TS_PLUGIN_NAME = '@startupjs/typescript-plugin-react-pug';

let outputChannel: vscode.OutputChannel;

function logError(msg: string, error: unknown): void {
  const text = `[pug-react] ${msg}: ${error}`;
  outputChannel?.appendLine(text);
}

function readPluginConfig() {
  const config = vscode.workspace.getConfiguration('pugReact');
  const injectRaw = config.get<string>('injectCssxjsTypes', 'auto');
  const injectCssxjsTypes: 'never' | 'auto' | 'force' = (
    injectRaw === 'never' || injectRaw === 'auto' || injectRaw === 'force'
  ) ? injectRaw : 'auto';

  return {
    enabled: config.get<boolean>('enabled', true),
    diagnostics: {
      enabled: config.get<boolean>('diagnostics.enabled', true),
    },
    tagFunction: config.get<string>('tagFunction', 'pug'),
    injectCssxjsTypes,
  };
}

async function configureTsPluginFromSettings(): Promise<void> {
  try {
    const tsExt = (vscode.extensions as any)?.getExtension?.('vscode.typescript-language-features');
    if (!tsExt) return;

    const exportsApi = tsExt.isActive ? tsExt.exports : await tsExt.activate();
    const api = exportsApi?.getAPI?.(0) ?? exportsApi?.getAPI?.(1);
    if (!api?.configurePlugin) return;

    api.configurePlugin(TS_PLUGIN_NAME, readPluginConfig());
  } catch (e) {
    logError('configureTsPluginFromSettings failed', e);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Pug React');
  context.subscriptions.push(outputChannel);

  void configureTsPluginFromSettings();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('pugReact')) {
        void configureTsPluginFromSettings();
      }
    }),
  );

  // Content provider for virtual shadow TSX documents
  const shadowDocs = new Map<string, string>();

  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return shadowDocs.get(uri.toString()) ?? '';
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pugReact.showShadowTsx', async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No active editor');
          return;
        }

        const doc = editor.document;
        const text = doc.getText();
        const tagFunction = readPluginConfig().tagFunction;

        const shadow = buildShadowDocument(text, doc.fileName, 1, tagFunction);

        if (shadow.regions.length === 0) {
          vscode.window.showInformationMessage('No pug templates found in the current file');
          return;
        }

        const uri = vscode.Uri.parse(
          `${SCHEME}:${doc.fileName}.shadow.tsx`,
        );
        shadowDocs.set(uri.toString(), shadow.shadowText);

        const shadowDoc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(shadowDoc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
          preserveFocus: true,
        });
      } catch (e) {
        logError('showShadowTsx command failed', e);
        vscode.window.showErrorMessage(`Pug React: Failed to show shadow TSX: ${e}`);
      }
    }),
  );
}

export function deactivate(): void {}
