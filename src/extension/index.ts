import * as vscode from 'vscode';
import { buildShadowDocument } from '../language/shadowDocument';

const SCHEME = 'pug-react-shadow';

export function activate(context: vscode.ExtensionContext): void {
  console.log('vscode-pug-react: activated');

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
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const doc = editor.document;
      const text = doc.getText();
      const config = vscode.workspace.getConfiguration('pugReact');
      const tagFunction = config.get<string>('tagFunction', 'pug');

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
    }),
  );
}

export function deactivate(): void {}
