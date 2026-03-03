const assert = require('node:assert');
const path = require('node:path');
const vscode = require('vscode');
const {
  captureTestStep,
  resetScreenshotCounter,
} = require('./screenshot');

function labelText(label) {
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object' && typeof label.label === 'string') return label.label;
  return '';
}

function hoverText(hover) {
  return hover.contents.map((c) => {
    if (typeof c === 'string') return c;
    if (c && typeof c.value === 'string') return c.value;
    return '';
  }).join('\n');
}

async function retry(fn, timeoutMs = 30000, intervalMs = 300) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (lastError) throw lastError;
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifySmall(value, maxLen = 300) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

suite('Extension Host Features (demo workspace)', () => {
  let appDoc;
  let appText;
  let workspaceRoot;
  const tempUris = [];

  async function createTempDoc(name, content) {
    const tempPath = path.join(workspaceRoot, 'src', name);
    const uri = vscode.Uri.file(tempPath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    tempUris.push(uri);
    return vscode.workspace.openTextDocument(uri);
  }

  suiteSetup(async function () {
    if (process.env.TEST_WORKSPACE_NAME !== 'demo') {
      this.skip();
      return;
    }

    // Ensure built-in TS extension is active.
    const tsExt = vscode.extensions.getExtension('vscode.typescript-language-features');
    if (tsExt && !tsExt.isActive) {
      await tsExt.activate();
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Expected workspace folder');
    workspaceRoot = folder.uri.fsPath;

    await vscode.commands.executeCommand('workbench.action.joinAllGroups');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    const appPath = path.join(workspaceRoot, 'src', 'App.tsx');
    appDoc = await vscode.workspace.openTextDocument(appPath);
    appText = appDoc.getText();
    await vscode.window.showTextDocument(appDoc);
    resetScreenshotCounter();
    await captureTestStep('features-suite-setup-app-open', { appPath });
  });

  suiteTeardown(async () => {
    for (const uri of tempUris) {
      try {
        await vscode.workspace.fs.delete(uri, { useTrash: false });
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  test('find references inside pug returns results', async function () {
    const idx = appText.indexOf('handleReset');
    assert.ok(idx > 0, 'Could not find handleReset in App.tsx');
    const pos = appDoc.positionAt(idx);
    const editor = await vscode.window.showTextDocument(appDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await captureTestStep('features-before-references', {
      symbol: 'handleReset',
      position: { line: pos.line + 1, character: pos.character + 1 },
    });

    const refs = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeReferenceProvider',
        appDoc.uri,
        pos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    });

    assert.ok(refs.length > 0, 'Expected references for handleReset');
    await captureTestStep('features-after-references', { referenceCount: refs.length });
  });

  test('hover inside pug returns type information', async () => {
    const idx = appText.indexOf('Button(');
    assert.ok(idx > 0, 'Could not find Button( in App.tsx');
    const pos = appDoc.positionAt(idx);
    const editor = await vscode.window.showTextDocument(appDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await captureTestStep('features-before-hover', {
      symbol: 'Button',
      position: { line: pos.line + 1, character: pos.character + 1 },
    });
    await vscode.commands.executeCommand('editor.action.showHover');
    await wait(500);
    await captureTestStep('features-ui-hover-visible', {
      command: 'editor.action.showHover',
    });

    const hovers = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        appDoc.uri,
        pos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    });

    const text = hovers.map(hoverText).join('\n');
    assert.ok(/Button/.test(text), 'Expected hover text to include Button');
    await captureTestStep('features-after-hover', {
      hoverCount: hovers.length,
      containsButton: /Button/.test(text),
    });
  });

  test('completion inside pug includes typed component props', async function () {
    const completionDoc = await createTempDoc(
      '__vscode_test_completion.tsx',
      [
        'import { Button } from "./Button";',
        'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
        'const handleReset = () => {};',
        'const view = pug`',
        '  Button(onClick=handleReset )',
        '`;',
        'export { view };',
      ].join('\n'),
    );

    const text = completionDoc.getText();
    const idx = text.indexOf('onClick=handleReset ');
    assert.ok(idx > 0, 'Could not find completion target in temp document');
    const pos = completionDoc.positionAt(idx + 'onClick=handleReset '.length);
    const editor = await vscode.window.showTextDocument(completionDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    await captureTestStep('features-before-completion', {
      file: completionDoc.uri.fsPath,
      position: { line: pos.line + 1, character: pos.character + 1 },
    });
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await wait(600);
    await captureTestStep('features-ui-suggest-visible', {
      command: 'editor.action.triggerSuggest',
    });

    const completions = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        completionDoc.uri,
        pos,
      );
      return result && Array.isArray(result.items) && result.items.length > 0 ? result : null;
    });

    const labels = completions.items.map((item) => labelText(item.label));
    assert.ok(labels.includes('label'), 'Expected completion suggestions to include "label" prop');
    assert.ok(labels.includes('variant'), 'Expected completion suggestions to include "variant" prop');
    await captureTestStep('features-after-completion', {
      completionCount: completions.items.length,
      containsLabel: labels.includes('label'),
      containsVariant: labels.includes('variant'),
    });
  });

  test('signature help inside pug call expression includes function shape', async function () {
    const idx = appText.indexOf('handleToggle(todo.id)');
    assert.ok(idx > 0, 'Could not find handleToggle(todo.id) in App.tsx');
    const pos = appDoc.positionAt(idx + 'handleToggle('.length);
    const editor = await vscode.window.showTextDocument(appDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    await captureTestStep('features-before-signature-help', {
      symbol: 'handleToggle',
      position: { line: pos.line + 1, character: pos.character + 1 },
    });
    await vscode.commands.executeCommand('editor.action.triggerParameterHints');
    await wait(600);
    await captureTestStep('features-ui-signature-help-visible', {
      command: 'editor.action.triggerParameterHints',
    });

    const signatureHelp = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeSignatureHelpProvider',
        appDoc.uri,
        pos,
      );
      return result && Array.isArray(result.signatures) && result.signatures.length > 0 ? result : null;
    });

    const signatureText = signatureHelp.signatures.map((s) => s.label).join('\n');
    assert.ok(
      /handleToggle|id\s*:\s*number/i.test(signatureText),
      'Expected signature help to include handleToggle parameter details',
    );
    await captureTestStep('features-after-signature-help', {
      signatureCount: signatureHelp.signatures.length,
    });
  });

  test('go to definition command from pug navigates to component source', async function () {
    const idx = appText.indexOf('Button(onClick=handleReset');
    assert.ok(idx > 0, 'Could not find Button usage inside pug template');
    const pos = appDoc.positionAt(idx);
    const editor = await vscode.window.showTextDocument(appDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    await captureTestStep('features-before-ui-definition', {
      symbol: 'Button',
      position: { line: pos.line + 1, character: pos.character + 1 },
    });
    let definitionEditor;
    let usedProviderFallback = false;

    try {
      await vscode.commands.executeCommand('editor.action.revealDefinition');
      definitionEditor = await retry(async () => {
        const active = vscode.window.activeTextEditor;
        if (!active) return null;
        return path.basename(active.document.uri.fsPath) === 'Button.tsx' ? active : null;
      }, 20000, 250);
    } catch {
      usedProviderFallback = true;
      const defs = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        appDoc.uri,
        pos,
      );
      assert.ok(Array.isArray(defs) && defs.length > 0, 'Expected definition provider results for Button');
      const target = defs.find((d) => {
        const uri = d.uri ?? d.targetUri;
        return uri && path.basename(uri.fsPath) === 'Button.tsx';
      });
      assert.ok(target, 'Expected definition provider to include Button.tsx');

      const targetUri = target.uri ?? target.targetUri;
      definitionEditor = await vscode.window.showTextDocument(targetUri);
      await captureTestStep('features-ui-definition-fallback-provider', {
        targetFile: targetUri.fsPath,
      });
    }

    assert.strictEqual(
      path.basename(definitionEditor.document.uri.fsPath),
      'Button.tsx',
      'Expected go to definition command to navigate to Button.tsx',
    );
    await captureTestStep('features-after-ui-definition', {
      targetFile: definitionEditor.document.uri.fsPath,
      usedProviderFallback,
    });

    await vscode.window.showTextDocument(appDoc);
  });

  test('textmate highlighting is injected for pug template literal', async function () {
    this.timeout(60000);
    const editor = await vscode.window.showTextDocument(appDoc);

    const idx = appText.indexOf('Button(onClick=handleReset');
    assert.ok(idx > 0, 'Could not find Button(...) inside pug template');
    const pos = appDoc.positionAt(idx);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await captureTestStep('features-before-highlight-capture', {
      symbol: 'Button',
      position: { line: pos.line + 1, character: pos.character + 1 },
    });

    const syntaxTokens = await retry(async () => {
      const result = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', appDoc.uri);
      return Array.isArray(result) && result.length > 0 ? result : null;
    }, 45000, 500);

    const tokenTexts = syntaxTokens
      .map((token) => (typeof token?.c === 'string' ? token.c : ''))
      .filter(Boolean);
    const serialized = JSON.stringify(syntaxTokens);
    const hasPugScope = /(text|source)\.pug/i.test(serialized);
    const importToken = syntaxTokens.find((token) => typeof token?.c === 'string' && token.c.includes("import React"));
    const importTokenScopes = typeof importToken?.t === 'string' ? importToken.t : '';
    const hasLeakIntoTopLevelTsx = /meta\\.embedded\\.inline\\.pug/.test(importTokenScopes);
    const pugishTokenEntries = syntaxTokens.filter((token) => {
      const text = typeof token?.c === 'string' ? token.c : '';
      return /(onClick|variant|label|todo-item|Button\(onClick=handleReset)/.test(text);
    });
    const propertyAccessMisTokenization = syntaxTokens.filter((token) => {
      const text = typeof token?.c === 'string' ? token.c : '';
      const scopes = typeof token?.t === 'string' ? token.t : '';
      return text === '.id' && /entity\.other\.attribute-name\.class\.css/.test(scopes);
    });
    const hasH3TagScope = syntaxTokens.some((token) => {
      const text = typeof token?.c === 'string' ? token.c : '';
      const scopes = typeof token?.t === 'string' ? token.t : '';
      return /\bh3\b/.test(text) && /entity\.name\.tag\.(html|pug)/.test(scopes);
    });
    const hasEmptyClassScope = syntaxTokens.some((token) => {
      const text = typeof token?.c === 'string' ? token.c : '';
      const scopes = typeof token?.t === 'string' ? token.t : '';
      return /\.empty\b/.test(text) && /entity\.other\.attribute-name\.class\.css/.test(scopes);
    });
    const emptyTokenCandidates = syntaxTokens
      .filter((token) => {
        const text = typeof token?.c === 'string' ? token.c : '';
        return /empty/i.test(text);
      })
      .slice(0, 8)
      .map((token) => ({
        c: token?.c,
        t: stringifySmall(token?.t),
      }));
    const hasInterpolationExprScope = syntaxTokens.some((token) => {
      const text = typeof token?.c === 'string' ? token.c : '';
      const scopes = typeof token?.t === 'string' ? token.t : '';
      return text === 'activeTodos' && /meta\.embedded\.expression\.pug/.test(scopes);
    });
    const activeTodosTokenCandidates = syntaxTokens
      .filter((token) => {
        const text = typeof token?.c === 'string' ? token.c : '';
        return /activeTodos/.test(text);
      })
      .slice(0, 10)
      .map((token) => ({
        c: token?.c,
        t: stringifySmall(token?.t),
      }));
    const hasEachExprScope = syntaxTokens.some((token) => {
      const text = typeof token?.c === 'string' ? token.c : '';
      const scopes = typeof token?.t === 'string' ? token.t : '';
      return text === 'activeTodos' && /meta\.control\.each\.expression\.pug/.test(scopes);
    });
    const hasLineEqExprScope = syntaxTokens.some((token) => {
      const text = typeof token?.c === 'string' ? token.c : '';
      const scopes = typeof token?.t === 'string' ? token.t : '';
      return /\btodo\b/.test(text) && /meta\.embedded\.expression\.pug\.line/.test(scopes);
    });
    const hasPugLikeTokenization = pugishTokenEntries.length > 0
      || tokenTexts.some((text) => /(onClick|todo-item|Button\(onClick=handleReset)/.test(text));

    await captureTestStep('features-after-highlight-capture', {
      tokenLines: syntaxTokens.length,
      hasPugScope,
      hasPugLikeTokenization,
      hasLeakIntoTopLevelTsx,
      propertyAccessMisTokenizationCount: propertyAccessMisTokenization.length,
      hasH3TagScope,
      hasEmptyClassScope,
      emptyTokenCandidates,
      hasInterpolationExprScope,
      activeTodosTokenCandidates,
      hasEachExprScope,
      hasLineEqExprScope,
      pugishTokenCount: pugishTokenEntries.length,
      pugishTokenSamples: pugishTokenEntries.slice(0, 6).map((entry) => ({
        c: entry.c,
        t: stringifySmall(entry.t),
      })),
      propertyAccessMisTokenizationSamples: propertyAccessMisTokenization.slice(0, 6).map((entry) => ({
        c: entry.c,
        t: stringifySmall(entry.t),
      })),
      sampleFirst: stringifySmall(syntaxTokens[0], 1200),
      sampleAroundButton: stringifySmall(
        syntaxTokens.find((line) => /Button|handleReset|pug/i.test(JSON.stringify(line))) ?? syntaxTokens[0],
        1200,
      ),
    });
    assert.ok(hasPugLikeTokenization, 'Expected tokenization to include pug template content');
    assert.ok(!hasLeakIntoTopLevelTsx, 'Pug scope leaked into top-level TSX tokenization');
    assert.ok(hasH3TagScope, 'Expected h3 tag token to carry Pug tag scope');
    assert.ok(
      hasEmptyClassScope,
      `Expected .empty shorthand to carry class scope. candidates=${stringifySmall(emptyTokenCandidates, 1200)}`,
    );
    assert.ok(
      hasInterpolationExprScope,
      `Expected #{...} interpolation to carry embedded expression scope. activeTodosCandidates=${stringifySmall(activeTodosTokenCandidates, 1200)}`,
    );
    assert.ok(hasEachExprScope, 'Expected each ... in expression to carry embedded expression scope');
    assert.ok(hasLineEqExprScope, 'Expected tag= expression line to carry embedded expression scope');
    assert.strictEqual(
      propertyAccessMisTokenization.length,
      0,
      'Property access token (e.g. todo.id) was mis-tokenized as a Pug class shorthand',
    );

    await vscode.commands.executeCommand('editor.action.inspectTMScopes');
    await wait(700);
    await captureTestStep('features-ui-tm-scopes-visible', {
      tokenLines: syntaxTokens.length,
      hasPugScope,
      hasPugLikeTokenization,
      hasLeakIntoTopLevelTsx,
      sample: stringifySmall(syntaxTokens[0]),
    });
    await vscode.commands.executeCommand('editor.action.inspectTMScopes');
  });

  test('go to definition inside pug resolves in-scope symbol', async () => {
    const idx = appText.indexOf('handleReset');
    assert.ok(idx > 0, 'Could not find handleReset in App.tsx');
    const pos = appDoc.positionAt(idx);
    const editor = await vscode.window.showTextDocument(appDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await captureTestStep('features-before-definition', {
      symbol: 'handleReset',
      position: { line: pos.line + 1, character: pos.character + 1 },
    });

    const defs = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        appDoc.uri,
        pos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    });

    const found = defs.some((d) => {
      const uri = d.uri ?? d.targetUri;
      return uri?.fsPath === appDoc.uri.fsPath;
    });
    assert.ok(found, 'Expected definition to resolve to App.tsx symbol declaration');
    await captureTestStep('features-after-definition', {
      definitionCount: defs.length,
      resolvedInApp: found,
    });
  });

  test('rename inside pug returns workspace edits', async () => {
    const idx = appText.indexOf('handleReset');
    assert.ok(idx > 0, 'Could not find handleReset in App.tsx');
    const pos = appDoc.positionAt(idx);
    const editor = await vscode.window.showTextDocument(appDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await captureTestStep('features-before-rename', {
      symbol: 'handleReset',
      renameTo: 'handleResetRenamed',
    });

    const edit = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeDocumentRenameProvider',
        appDoc.uri,
        pos,
        'handleResetRenamed',
      );
      if (!result || typeof result.entries !== 'function') return null;
      return result.entries().length > 0 ? result : null;
    });

    assert.ok(edit.entries().length > 0, 'Expected rename edits to be returned');
    await captureTestStep('features-after-rename', {
      workspaceEditEntries: edit.entries().length,
    });
  });

  test('type diagnostics in pug are surfaced', async function () {
    this.timeout(60000);
    const badText = [
      'import { Button } from "./Button";',
      'const view = pug`',
      '  Button(onClick="bad", label="Demo")',
      '`;',
      'export { view };',
    ].join('\n');

    const badDoc = await createTempDoc('__vscode_test_bad.tsx', badText);
    await vscode.window.showTextDocument(badDoc);
    await captureTestStep('features-before-diagnostics', {
      file: badDoc.uri.fsPath,
    });

    const diagnostics = await retry(async () => {
      const result = vscode.languages.getDiagnostics(badDoc.uri);
      return Array.isArray(result) && result.length > 0 ? result : null;
    }, 45000, 500);

    const hasTypeError = diagnostics.some((d) => {
      const text = typeof d.message === 'string' ? d.message : '';
      return d.severity === vscode.DiagnosticSeverity.Error
        && (/assignable|type/i.test(text) || d.code === 2322);
    });

    assert.ok(hasTypeError, 'Expected a type error diagnostic for invalid onClick type');
    await captureTestStep('features-after-diagnostics', {
      diagnosticCount: diagnostics.length,
      hasTypeError,
    });
  });

  test('complex pug expression diagnostics map to exact symbol ranges', async function () {
    this.timeout(60000);
    const content = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'type Row = { id: number };',
      'const rowsA: Row[] = [];',
      'const rowsB: Row[] = [];',
      'const view = pug`',
      '  h3 Value #{missingInterp + 1}',
      '  - const localValue = missingCode + 1',
      '  each row in (missingEach ? rowsA : rowsB)',
      '    span= row.id',
      '`;',
      'export { view };',
    ].join('\n');
    const doc = await createTempDoc('__vscode_test_complex_ranges.tsx', content);
    await vscode.window.showTextDocument(doc);
    await captureTestStep('features-before-complex-range-diagnostics', {
      file: doc.uri.fsPath,
    });

    const diagnostics = await retry(async () => {
      const result = vscode.languages.getDiagnostics(doc.uri);
      const missing = result.filter((d) => {
        const msg = typeof d.message === 'string' ? d.message : '';
        return d.code === 2304
          && (/missingInterp|missingCode|missingEach/.test(msg));
      });
      return missing.length >= 3 ? missing : null;
    }, 45000, 500);
    const allDiagnostics = vscode.languages.getDiagnostics(doc.uri);
    const problematicSyntactic = allDiagnostics.filter((d) => d.code === 1136 || d.code === 1109);
    assert.strictEqual(
      problematicSyntactic.length,
      0,
      `Unexpected parser-like diagnostic codes: ${JSON.stringify(problematicSyntactic.map((d) => d.code))}`,
    );

    const text = doc.getText();
    const expected = ['missingInterp', 'missingCode', 'missingEach'].map((name) => ({
      name,
      start: text.indexOf(name),
      length: name.length,
    }));

    const mapped = expected.map((e) => {
      const diag = diagnostics.find((d) => {
        const msg = typeof d.message === 'string' ? d.message : '';
        return d.code === 2304 && msg.includes(e.name);
      });
      return {
        name: e.name,
        expectedStart: e.start,
        expectedLength: e.length,
        actualStart: diag ? doc.offsetAt(diag.range.start) : -1,
        actualLength: diag ? doc.offsetAt(diag.range.end) - doc.offsetAt(diag.range.start) : -1,
        message: diag?.message ?? null,
      };
    });

    for (const item of mapped) {
      assert.ok(item.expectedStart >= 0, `Expected token not found in source: ${item.name}`);
      assert.ok(item.actualStart >= 0, `Missing diagnostic for ${item.name}`);
      assert.strictEqual(
        item.actualStart,
        item.expectedStart,
        `Mapped start offset mismatch for ${item.name}`,
      );
      assert.strictEqual(
        item.actualLength,
        item.expectedLength,
        `Mapped length mismatch for ${item.name}`,
      );
    }

    await captureTestStep('features-after-complex-range-diagnostics', {
      mapped,
      diagnosticsCount: diagnostics.length,
      problematicSyntacticCount: problematicSyntactic.length,
    });
  });
});
