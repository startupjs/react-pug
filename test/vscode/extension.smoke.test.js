const assert = require('node:assert');
const path = require('node:path');
const vscode = require('vscode');
const {
  captureTestStep,
  resetScreenshotCounter,
} = require('./screenshot');

suite('Extension Host Smoke', () => {
  suiteSetup(async () => {
    resetScreenshotCounter();
    await captureTestStep('smoke-suite-setup');
  });

  test('opens expected workspace folder for selected config', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Expected a workspace folder to be opened');

    const expected = process.env.TEST_WORKSPACE_NAME;
    if (expected) {
      assert.strictEqual(path.basename(folder.uri.fsPath), expected);
    }

    await captureTestStep('smoke-workspace-opened', {
      workspaceFolder: folder.uri.fsPath,
    });
  });

  test('extension can be discovered and activated', async () => {
    const ext = vscode.extensions.all.find(
      e => e.packageJSON?.name === 'vscode-pug-react',
    );

    assert.ok(ext, 'Extension "startupjs.vscode-pug-react" not found');
    await ext.activate();
    assert.ok(ext.isActive, 'Extension failed to activate');

    await captureTestStep('smoke-extension-activated', {
      extensionId: ext.id,
      active: ext.isActive,
    });
  });

  test('show shadow command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('pugReact.showShadowTsx'),
      'Expected command "pugReact.showShadowTsx" to be registered',
    );

    await captureTestStep('smoke-command-registered', {
      commandCount: commands.length,
      containsShowShadow: commands.includes('pugReact.showShadowTsx'),
    });
  });

  test('show shadow command executes on a TSX document', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescriptreact',
      content: 'const view = pug`\\n  div Hello\\n`;',
    });
    await vscode.window.showTextDocument(doc);

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('pugReact.showShadowTsx');
    });

    await captureTestStep('smoke-show-shadow-executed', {
      documentUri: doc.uri.toString(),
    });
  });
});
