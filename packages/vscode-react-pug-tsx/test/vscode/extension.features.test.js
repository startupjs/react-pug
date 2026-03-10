const assert = require('node:assert');
const path = require('node:path');
const vscode = require('vscode');
const {
  captureTestStep,
  resetScreenshotCounter,
} = require('./screenshot');

function labelText(label) {
  if (typeof label === 'string') return label.replace(/\?$/, '');
  if (label && typeof label === 'object' && typeof label.label === 'string') {
    return label.label.replace(/\?$/, '');
  }
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

suite('Extension Host Features (example workspace)', () => {
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
    if (process.env.TEST_WORKSPACE_NAME !== 'example') {
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

  test('show shadow tsx removes explicit pug import but keeps transformed App usable', async function () {
    this.timeout(60000);
    await vscode.window.showTextDocument(appDoc);

    await captureTestStep('features-before-show-shadow-import-cleanup', {
      file: appDoc.uri.fsPath,
    });

    await vscode.commands.executeCommand('pugReact.showShadowTsx');

    const shadowDoc = await retry(async () => {
      const doc = vscode.workspace.textDocuments.find((candidate) =>
        candidate.uri.scheme === 'pug-react-shadow'
        && candidate.uri.path.endsWith(`${appDoc.fileName}.shadow.tsx`),
      );
      return doc ?? null;
    }, 30000, 250);

    const shadowText = shadowDoc.getText();
    assert.ok(
      shadowText.includes('import React, { useState } from \'react\';'),
      'Expected shadow TSX to keep normal TSX imports',
    );
    assert.ok(
      shadowText.includes('import { Button } from \'./Button\';'),
      'Expected shadow TSX to keep component imports used by generated JSX',
    );
    assert.ok(
      !shadowText.includes('import { pug } from \'./helpers\';'),
      'Expected shadow TSX to remove the explicit pug binding import',
    );
    assert.ok(
      shadowText.includes('import \'./helpers\';'),
      'Expected shadow TSX to preserve helper-module side effects after removing pug binding',
    );
    assert.ok(
      !shadowText.includes('return pug`'),
      'Expected shadow TSX to contain transformed JSX instead of pug template literals',
    );
    assert.ok(
      shadowText.includes('<Card'),
      'Expected shadow TSX to contain transformed App JSX component output',
    );
    assert.ok(
      shadowText.includes('label={"Reset"}'),
      'Expected shadow TSX to contain transformed App JSX props',
    );

    await captureTestStep('features-after-show-shadow-import-cleanup', {
      shadowUri: shadowDoc.uri.toString(),
      removedPugImport: !shadowText.includes('import { pug } from \'./helpers\';'),
      preservedHelperSideEffectImport: shadowText.includes('import \'./helpers\';'),
      containsCardJsx: shadowText.includes('<Card'),
      containsResetProp: shadowText.includes('label={"Reset"}'),
    });
  });

  test('hover on merged className/styleName attrs still shows type info', async function () {
    const hoverDoc = await createTempDoc(
      '__vscode_test_hover_merged_class_attrs.tsx',
      [
        "import React from 'react';",
        'const startupMarker = "startupjs";',
        'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
        'const active = { active: true };',
        'const view = pug`',
        "  h1.active(className='hello')",
        '  h1.active(styleName=active)',
        '`;',
        'export { view };',
      ].join('\n'),
    );

    const text = hoverDoc.getText();
    const classNameIdx = text.indexOf('className');
    const styleNameIdx = text.indexOf('styleName');
    assert.ok(classNameIdx > 0, 'Could not find className in merged shorthand fixture');
    assert.ok(styleNameIdx > 0, 'Could not find styleName in merged shorthand fixture');

    const classNamePos = hoverDoc.positionAt(classNameIdx + 1);
    const styleNamePos = hoverDoc.positionAt(styleNameIdx + 1);

    const classNameHover = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        hoverDoc.uri,
        classNamePos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    });
    const classNameText = classNameHover.map(hoverText).join('\n');
    assert.ok(/className/i.test(classNameText), 'Expected hover to include className type info');

    const styleNameHover = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        hoverDoc.uri,
        styleNamePos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    });
    const styleNameText = styleNameHover.map(hoverText).join('\n');
    assert.ok(/styleName/i.test(styleNameText), 'Expected hover to include styleName type info');
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
    const hasSecondaryProp = ['variant', 'disabled', 'children', 'key']
      .some((name) => labels.includes(name));
    assert.ok(labels.includes('label'), 'Expected completion suggestions to include "label" prop');
    assert.ok(
      hasSecondaryProp,
      `Expected completion suggestions to include at least one secondary Button prop. Top labels: ${labels.slice(0, 20).join(', ')}`,
    );
    await captureTestStep('features-after-completion', {
      completionCount: completions.items.length,
      containsLabel: labels.includes('label'),
      containsVariant: labels.includes('variant'),
      containsDisabled: labels.includes('disabled'),
      containsChildren: labels.includes('children'),
      topLabels: labels.slice(0, 20),
    });
  });

  test('emmet suggestions are not shown inside pug template regions', async function () {
    const completionDoc = await createTempDoc(
      '__vscode_test_no_emmet.tsx',
      [
        'import { Button } from "./Button";',
        'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
        'const view = pug`',
        '  B',
        '`;',
        'export { view };',
      ].join('\n'),
    );

    const text = completionDoc.getText();
    const idx = text.indexOf('\n  B\n');
    assert.ok(idx > 0, 'Could not find pug completion target for no-emmet test');
    const pos = completionDoc.positionAt(idx + '\n  B'.length);
    const editor = await vscode.window.showTextDocument(completionDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    await captureTestStep('features-before-no-emmet-completion', {
      file: completionDoc.uri.fsPath,
      position: { line: pos.line + 1, character: pos.character + 1 },
    });
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await wait(800);
    await captureTestStep('features-ui-no-emmet-suggest-visible', {
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
    const emmetLikeItems = completions.items.filter((item) => {
      const detail = typeof item.detail === 'string' ? item.detail : '';
      return /Emmet Abbreviation/i.test(detail);
    });
    const emmetLikePreview = emmetLikeItems
      .slice(0, 12)
      .map((item) => `${labelText(item.label)} :: ${typeof item.detail === 'string' ? item.detail : ''}`);

    assert.strictEqual(
      emmetLikeItems.length,
      0,
      `Expected no Emmet completion items inside pug. Top labels: ${labels.slice(0, 20).join(', ')}. Emmet-like: ${emmetLikePreview.join(' | ')}`,
    );
    await captureTestStep('features-after-no-emmet-completion', {
      completionCount: completions.items.length,
      emmetLikeCount: emmetLikeItems.length,
      topLabels: labels.slice(0, 20),
      topDetails: completions.items.slice(0, 20).map((item) => (typeof item.detail === 'string' ? item.detail : '')),
    });
  });

  test('indented whitespace-only lines inside pug do not break IntelliSense mapping', async function () {
    const mappingDoc = await createTempDoc(
      '__vscode_test_blank_whitespace_line.tsx',
      [
        'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
        'const activeTodos = [{ id: 1, text: "One" }];',
        'const view = pug`',
        '  h3 Active (#{activeTodos.length})',
        '    ',
        '  if act',
        '    span None',
        '`;',
        'export { view };',
      ].join('\n'),
    );

    const text = mappingDoc.getText();
    const idx = text.indexOf('if act');
    assert.ok(idx > 0, 'Could not find "if act" completion target');
    const pos = mappingDoc.positionAt(idx + 'if act'.length);
    const hoverIdx = text.indexOf('activeTodos.length');
    assert.ok(hoverIdx > 0, 'Could not find hover target after blank line');
    const hoverPos = mappingDoc.positionAt(hoverIdx + 1);

    const editor = await vscode.window.showTextDocument(mappingDoc);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    await captureTestStep('features-before-blank-whitespace-line-check', {
      file: mappingDoc.uri.fsPath,
      completionPosition: { line: pos.line + 1, character: pos.character + 1 },
      hoverPosition: { line: hoverPos.line + 1, character: hoverPos.character + 1 },
    });

    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await wait(700);
    const completions = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        mappingDoc.uri,
        pos,
      );
      return result && Array.isArray(result.items) && result.items.length > 0 ? result : null;
    });
    const labels = completions.items.map((item) => labelText(item.label));
    assert.ok(labels.includes('activeTodos'), 'Expected completion to include "activeTodos" after blank whitespace-only line');

    const hovers = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        mappingDoc.uri,
        hoverPos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    });
    const hover = hovers.map(hoverText).join('\n');
    assert.ok(/activeTodos/.test(hover), 'Expected hover to resolve "activeTodos" after blank whitespace-only line');

    // Give diagnostics pipeline a moment to settle and ensure no parse-error regression.
    await wait(500);
    const diagnostics = vscode.languages.getDiagnostics(mappingDoc.uri);
    const pugParseDiagnostics = diagnostics.filter((d) => /Pug parse error/i.test(d.message));
    assert.strictEqual(pugParseDiagnostics.length, 0, 'Expected no pug parse error due to indented whitespace-only line');

    await captureTestStep('features-after-blank-whitespace-line-check', {
      completionCount: completions.items.length,
      containsActiveTodos: labels.includes('activeTodos'),
      hoverContainsActiveTodos: /activeTodos/.test(hover),
      diagnosticCount: diagnostics.length,
      pugParseDiagnosticCount: pugParseDiagnostics.length,
      topLabels: labels.slice(0, 20),
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

  test('textmate highlighting keeps tag/component scopes with class shorthand and "=" output', async function () {
    this.timeout(60000);
    const content = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'const activeTodos = [1, 2, 3];',
      'const view = pug`',
      '  span One',
      '  span.classOnly Two',
      '  span= activeTodos.length',
      '  span.classEq= activeTodos.length',
      '  Button',
      '  Button.primary',
      '  Button= activeTodos.length',
      '`;',
      'export { view };',
    ].join('\n');
    const doc = await createTempDoc('__vscode_test_highlight_tag_class.tsx', content);
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();

    const idx = text.indexOf('span.classOnly');
    assert.ok(idx > 0, 'Could not find span.classOnly in highlight regression fixture');
    const pos = doc.positionAt(idx);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
    await captureTestStep('features-before-highlight-tag-class-capture', {
      file: doc.uri.fsPath,
      position: { line: pos.line + 1, character: pos.character + 1 },
    });

    const syntaxTokens = await retry(async () => {
      const result = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', doc.uri);
      return Array.isArray(result) && result.length > 0 ? result : null;
    }, 45000, 500);

    const tokenEntries = syntaxTokens
      .map((token) => ({
        text: typeof token?.c === 'string' ? token.c : '',
        scopes: typeof token?.t === 'string' ? token.t : '',
      }))
      .filter((entry) => entry.text.length > 0);

    const scopeHas = (fragment, scopeRegex) => tokenEntries.some((entry) =>
      entry.text.includes(fragment) && scopeRegex.test(entry.scopes)
    );

    const spanTagScopeCount = tokenEntries.filter((entry) =>
      entry.text.includes('span') && /entity\.name\.tag\.(html|pug)/.test(entry.scopes)
    ).length;

    const buttonComponentScopeCount = tokenEntries.filter((entry) =>
      entry.text.includes('Button') && /support\.class\.component\.tsx/.test(entry.scopes)
    ).length;

    const classScopeRegex = /entity\.other\.attribute-name\.class\.css/;
    const hasClassOnlyScope = scopeHas('.classOnly', classScopeRegex);
    const hasClassEqScope = scopeHas('.classEq', classScopeRegex);
    const hasPrimaryScope = scopeHas('.primary', classScopeRegex);

    assert.ok(
      spanTagScopeCount >= 4,
      `Expected span tags to keep tag scope across plain/class/= lines, got ${spanTagScopeCount}`,
    );
    assert.ok(
      buttonComponentScopeCount >= 3,
      `Expected Button components to keep component scope across plain/class/= lines, got ${buttonComponentScopeCount}`,
    );
    assert.ok(hasClassOnlyScope, 'Expected .classOnly to have class shorthand scope');
    assert.ok(hasClassEqScope, 'Expected .classEq to have class shorthand scope in span.classEq=');
    assert.ok(hasPrimaryScope, 'Expected .primary to have class shorthand scope in Button.primary');

    await captureTestStep('features-after-highlight-tag-class-capture', {
      spanTagScopeCount,
      buttonComponentScopeCount,
      hasClassOnlyScope,
      hasClassEqScope,
      hasPrimaryScope,
      tokenSamples: tokenEntries
        .filter((entry) => /(span|Button|classOnly|classEq|primary)/.test(entry.text))
        .slice(0, 20)
        .map((entry) => ({
          text: entry.text,
          scopes: stringifySmall(entry.scopes, 240),
        })),
    });
  });

  test('textmate highlighting switches pug style blocks into embedded css scopes', async function () {
    this.timeout(60000);
    const doc = await createTempDoc(
      '__vscode_test_style_block_highlight.tsx',
      [
        'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
        'const tone = "red";',
        'const view = pug`',
        '  .title Hello',
        '  style',
        '    .title {',
        '      color: ${tone};',
        '    }',
        '`;',
        'export { view };',
      ].join('\n'),
    );
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();
    const idx = text.indexOf('color:');
    assert.ok(idx > 0, 'Could not find color declaration inside style block');
    const pos = doc.positionAt(idx);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    const syntaxTokens = await retry(async () => {
      const result = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', doc.uri);
      return Array.isArray(result) && result.length > 0 ? result : null;
    }, 45000, 500);

    const colorToken = syntaxTokens.find((token) => typeof token?.c === 'string' && token.c.includes('color'));
    const interpolationBeginToken = syntaxTokens.find((token) => typeof token?.c === 'string' && token.c.includes('${'));
    const interpolationEndToken = syntaxTokens.find((token) => typeof token?.c === 'string' && token.c.includes('}'));
    const colorScopes = typeof colorToken?.t === 'string' ? colorToken.t : '';
    const interpolationBeginScopes = typeof interpolationBeginToken?.t === 'string' ? interpolationBeginToken.t : '';
    const interpolationEndScopes = typeof interpolationEndToken?.t === 'string' ? interpolationEndToken.t : '';

    assert.ok(
      /source\.css/.test(colorScopes),
      `Expected style block token to carry CSS scope, got ${stringifySmall(colorScopes, 240)}`,
    );
    assert.ok(
      /meta\.var\.expr\.tsx/.test(`${interpolationBeginScopes} ${interpolationEndScopes}`),
      `Expected \${} interpolation inside style block to keep embedded TS expression scopes, got ${stringifySmall({ interpolationBeginScopes, interpolationEndScopes }, 240)}`,
    );
  });

  test('completion inside pug style block includes CSS language suggestions', async function () {
    this.timeout(60000);
    const doc = await createTempDoc(
      '__vscode_test_style_block_completion.tsx',
      [
        'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
        'const view = pug`',
        '  .title Hello',
        '  style',
        '    .title {',
        '      col',
        '    }',
        '`;',
        'export { view };',
      ].join('\n'),
    );
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();
    const idx = text.indexOf('col');
    assert.ok(idx > 0, 'Could not find CSS completion anchor inside style block');
    const pos = doc.positionAt(idx + 'col'.length);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));

    const completions = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        doc.uri,
        pos,
      );
      return result && Array.isArray(result.items) && result.items.length > 0 ? result : null;
    });

    const labels = completions.items.map((item) => labelText(item.label));
    assert.ok(
      labels.includes('color'),
      `Expected CSS completion inside pug style block to include color. Top labels: ${labels.slice(0, 30).join(', ')}`,
    );
  });

  test('show shadow tsx moves pug style blocks into helper calls', async function () {
    this.timeout(60000);
    const helperUri = vscode.Uri.file(path.join(workspaceRoot, 'src', '__vscode_style_helpers.ts'));
    await vscode.workspace.fs.writeFile(helperUri, Buffer.from([
      'export function pug(strings: TemplateStringsArray, ...values: any[]): any {',
      '  return { strings, values };',
      '}',
      'export function css(strings: TemplateStringsArray, ...values: any[]): any {',
      '  return { strings, values };',
      '}',
    ].join('\n'), 'utf8'));
    tempUris.push(helperUri);

    const doc = await createTempDoc(
      '__vscode_test_style_block_shadow.tsx',
      [
        "import { pug } from './__vscode_style_helpers';",
        'function App() {',
        '  return pug`',
        '    .title Hello',
        '    style',
        '      .title {',
        '        color: red;',
        '      }',
        '  `;',
        '}',
        'export { App };',
      ].join('\n'),
    );

    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('pugReact.showShadowTsx');

    const shadowDoc = await retry(async () => {
      const candidate = vscode.workspace.textDocuments.find((openDoc) =>
        openDoc.uri.scheme === 'pug-react-shadow'
        && openDoc.uri.path.endsWith(`${doc.fileName}.shadow.tsx`),
      );
      return candidate ?? null;
    }, 30000, 250);

    const shadowText = shadowDoc.getText();
    const hasCssImport = /import\s*\{\s*css\s*\}\s*from\s*['"]\.\/__vscode_style_helpers['"]/.test(shadowText);
    assert.ok(
      hasCssImport || shadowText.includes('import "./__vscode_style_helpers";'),
      `Expected shadow document to preserve helper-module imports for style block, got ${stringifySmall(shadowText, 500)}`,
    );
    assert.ok(
      shadowText.includes('  css`'),
      'Expected shadow document to move style block into css helper call at function top',
    );
    assert.ok(
      shadowText.indexOf('  css`') < shadowText.indexOf('return '),
      'Expected moved style helper call to appear before the return statement',
    );
    assert.ok(
      !shadowText.includes('<style'),
      'Expected shadow document to strip the original style tag from generated JSX',
    );
  });

  test('uppercase shorthand segments can form component path with class tail for highlight + IntelliSense', async function () {
    this.timeout(60000);
    const content = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'type HeaderProps = { onPress: () => void; title?: string };',
      'const Modal: { Header: (props: HeaderProps) => any } = {',
      '  Header: (_props: HeaderProps) => null,',
      '};',
      'const view = pug`',
      '  Modal.Header.active(',
      '`;',
      'export { view };',
    ].join('\n');
    const doc = await createTempDoc('__vscode_test_component_path_uppercase_shorthand.tsx', content);
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();

    const completionIdx = text.indexOf('Modal.Header.active(');
    assert.ok(completionIdx > 0, 'Could not find Modal.Header.active( completion marker');
    const completionPos = doc.positionAt(completionIdx + 'Modal.Header.active('.length);
    editor.selection = new vscode.Selection(completionPos, completionPos);
    editor.revealRange(new vscode.Range(completionPos, completionPos));

    const completions = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        doc.uri,
        completionPos,
      );
      return result && Array.isArray(result.items) && result.items.length > 0 ? result : null;
    });
    const labels = completions.items.map((item) => labelText(item.label));
    assert.ok(
      labels.includes('onPress'),
      `Expected completion to include onPress for Modal.Header props. Top labels: ${labels.slice(0, 30).join(', ')}`,
    );

    const headerIdx = text.indexOf('Header');
    assert.ok(headerIdx > 0, 'Could not find Header segment in Modal.Header.active');
    const hoverPos = doc.positionAt(headerIdx + 1);
    const hovers = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        doc.uri,
        hoverPos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    });
    const hover = hovers.map(hoverText).join('\n');
    assert.ok(/HeaderProps|onPress/i.test(hover), 'Expected hover to resolve Modal.Header component type');

    const syntaxTokens = await retry(async () => {
      const result = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', doc.uri);
      return Array.isArray(result) && result.length > 0 ? result : null;
    }, 45000, 500);
    const tokenEntries = syntaxTokens
      .map((token) => ({
        text: typeof token?.c === 'string' ? token.c : '',
        scopes: typeof token?.t === 'string' ? token.t : '',
      }))
      .filter((entry) => entry.text.length > 0);

    const hasModalScope = tokenEntries.some((entry) =>
      entry.text.includes('Modal') && /support\.class\.component\.tsx/.test(entry.scopes));
    const hasHeaderScope = tokenEntries.some((entry) =>
      entry.text.includes('Header') && /support\.class\.component\.tsx/.test(entry.scopes));
    const hasActiveClassScope = tokenEntries.some((entry) =>
      entry.text.includes('.active') && /entity\.other\.attribute-name\.class\.css/.test(entry.scopes));

    assert.ok(hasModalScope, 'Expected Modal segment to keep component scope');
    assert.ok(hasHeaderScope, 'Expected Header segment to keep component scope');
    assert.ok(hasActiveClassScope, 'Expected .active segment to keep class shorthand scope');
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
      '  span= ${missingTemplate}',
      '  span= ${pug`span= missingNestedTemplate`}',
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
          && (/missingInterp|missingCode|missingEach|missingTemplate|missingNestedTemplate/.test(msg));
      });
      return missing.length >= 5 ? missing : null;
    }, 45000, 500);
    const allDiagnostics = vscode.languages.getDiagnostics(doc.uri);
    const problematicSyntactic = allDiagnostics.filter((d) => d.code === 1136 || d.code === 1109);
    assert.strictEqual(
      problematicSyntactic.length,
      0,
      `Unexpected parser-like diagnostic codes: ${JSON.stringify(problematicSyntactic.map((d) => d.code))}`,
    );

    const text = doc.getText();
    const expected = ['missingInterp', 'missingCode', 'missingEach', 'missingTemplate', 'missingNestedTemplate'].map((name) => ({
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

  test('else+each and piped text nodes show no false diagnostics', async function () {
    this.timeout(60000);
    const content = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'type Todo = { id: number; text: string; done: boolean };',
      'const activeTodos: Todo[] = [{ id: 1, text: "A", done: false }];',
      'const view = pug`',
      '  if activeTodos.length === 0',
      '    span',
      '      | Hello',
      '      | World',
      '  else',
      '    each todo in activeTodos',
      '      span= todo.text',
      '`;',
      'export { view };',
    ].join('\n');
    const doc = await createTempDoc('__vscode_test_else_each_pipe.tsx', content);
    const editor = await vscode.window.showTextDocument(doc);

    const eachIdx = content.indexOf('each todo in activeTodos');
    assert.ok(eachIdx > 0, 'Could not find each todo in activeTodos in test document');
    const eachPos = doc.positionAt(eachIdx + 'each todo in '.length);
    editor.selection = new vscode.Selection(eachPos, eachPos);
    editor.revealRange(new vscode.Range(eachPos, eachPos));

    await captureTestStep('features-before-else-each-pipe-diagnostics', {
      file: doc.uri.fsPath,
      position: { line: eachPos.line + 1, character: eachPos.character + 1 },
    });

    const diagnostics = await retry(async () => {
      const result = vscode.languages.getDiagnostics(doc.uri);
      const parserLike = result.filter((d) => d.code === 1136 || d.code === 1109 || d.code === 1005);
      const falseType = result.filter((d) => d.code === 2322);
      const pugParse = result.filter((d) => d.code === 99001);
      const errors = result.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);

      return parserLike.length === 0 && falseType.length === 0 && pugParse.length === 0
        ? { all: result, errors, parserLike, falseType, pugParse }
        : null;
    }, 45000, 500);

    assert.strictEqual(
      diagnostics.parserLike.length,
      0,
      `Unexpected parser-like diagnostics: ${JSON.stringify(diagnostics.parserLike.map((d) => d.code))}`,
    );
    assert.strictEqual(
      diagnostics.falseType.length,
      0,
      `Unexpected TS2322 diagnostics: ${JSON.stringify(diagnostics.falseType.map((d) => d.message))}`,
    );
    assert.strictEqual(
      diagnostics.pugParse.length,
      0,
      'Unexpected pug parse diagnostics for piped text nodes',
    );

    await captureTestStep('features-after-else-each-pipe-diagnostics', {
      diagnosticsCount: diagnostics.all.length,
      errorCount: diagnostics.errors.length,
      parserLikeCount: diagnostics.parserLike.length,
      falseTypeCount: diagnostics.falseType.length,
      pugParseCount: diagnostics.pugParse.length,
      codes: diagnostics.all.map((d) => d.code ?? null),
    });
  });

  test('unbuffered "-" code lines support diagnostics, hover, completion, and highlighting', async function () {
    this.timeout(60000);
    const content = [
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'const todos = [1, 2, 3];',
      'const format = (n: number) => String(n);',
      'const view = pug`',
      '  - const total = todos.length + missingTotal',
      '  - const label = format(total)',
      '  - missingFn(total + missingArg)',
      '  - const alias = form',
      '  span= label',
      '`;',
      'export { view };',
    ].join('\n');

    const doc = await createTempDoc('__vscode_test_unbuffered_code.tsx', content);
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();

    const missIdx = text.indexOf('missingFn');
    assert.ok(missIdx > 0, 'Could not find missingFn in unbuffered code fixture');
    const missPos = doc.positionAt(missIdx);
    editor.selection = new vscode.Selection(missPos, missPos);
    editor.revealRange(new vscode.Range(missPos, missPos));
    await captureTestStep('features-before-unbuffered-code-checks', {
      file: doc.uri.fsPath,
      position: { line: missPos.line + 1, character: missPos.character + 1 },
    });

    const diagnostics = await retry(async () => {
      const result = vscode.languages.getDiagnostics(doc.uri);
      const missing = result.filter((d) => {
        const msg = typeof d.message === 'string' ? d.message : '';
        return d.code === 2304
          && (/missingTotal|missingFn|missingArg/.test(msg));
      });
      return missing.length >= 3 ? result : null;
    }, 45000, 500);

    const findDiag = (name) => diagnostics.find((d) => {
      const msg = typeof d.message === 'string' ? d.message : '';
      return d.code === 2304 && msg.includes(name);
    });

    for (const name of ['missingTotal', 'missingFn', 'missingArg']) {
      const diag = findDiag(name);
      assert.ok(diag, `Expected TS2304 diagnostic for ${name}`);
      const expectedStart = text.indexOf(name);
      const actualStart = doc.offsetAt(diag.range.start);
      const actualLength = doc.offsetAt(diag.range.end) - actualStart;
      assert.strictEqual(actualStart, expectedStart, `Unexpected mapped start for ${name}`);
      assert.strictEqual(actualLength, name.length, `Unexpected mapped length for ${name}`);
    }

    const formatIdx = text.indexOf('format(total)');
    assert.ok(formatIdx > 0, 'Could not find format(total) in unbuffered code fixture');
    const formatPos = doc.positionAt(formatIdx);
    const hovers = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        doc.uri,
        formatPos,
      );
      return Array.isArray(result) && result.length > 0 ? result : null;
    }, 30000, 300);
    const hoverCombined = hovers.map(hoverText).join('\n');
    assert.ok(/format/.test(hoverCombined), 'Expected hover over unbuffered code symbol to include format');

    const completionIdx = text.indexOf('= form');
    assert.ok(completionIdx > 0, 'Could not find completion anchor "= form" in unbuffered code fixture');
    const completionPos = doc.positionAt(completionIdx + '= '.length + 'form'.length);
    const completions = await retry(async () => {
      const result = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        doc.uri,
        completionPos,
      );
      return result && Array.isArray(result.items) && result.items.length > 0 ? result : null;
    }, 30000, 300);
    const completionLabels = completions.items.map((item) => labelText(item.label));
    assert.ok(
      completionLabels.includes('format'),
      'Expected completion suggestions in unbuffered code to include format',
    );

    const syntaxTokens = await retry(async () => {
      const result = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', doc.uri);
      return Array.isArray(result) && result.length > 0 ? result : null;
    }, 45000, 500);
    const tokenEntries = syntaxTokens.map((token) => ({
      text: typeof token?.c === 'string' ? token.c : '',
      scopes: typeof token?.t === 'string' ? token.t : '',
    }));
    const hasUnbufferedScope = tokenEntries.some((entry) =>
      /(const|missingFn|missingArg|format)/.test(entry.text)
      && /meta\.embedded\.expression\.pug\.unbuffered/.test(entry.scopes)
    );
    assert.ok(
      hasUnbufferedScope,
      'Expected "-" lines to carry unbuffered embedded-expression scope for TS highlighting',
    );

    await captureTestStep('features-after-unbuffered-code-checks', {
      diagnosticsCount: diagnostics.length,
      hasHoverForFormat: /format/.test(hoverCombined),
      completionContainsFormat: completionLabels.includes('format'),
      hasUnbufferedScope,
    });
  });

  test('typing-time completions work across major pug expression contexts', async function () {
    this.timeout(90000);
    const content = [
      'import { Button } from "./Button";',
      'const handler = () => {};',
      'const showCompleted = true;',
      'const items = [1, 2, 3];',
      'const activeTodos = [1, 2, 3];',
      'declare function pug(strings: TemplateStringsArray, ...values: any[]): any;',
      'const view = pug`',
      '  But',
      '  Button(o',
      '  Button(onClick=han',
      '  span= act',
      '  span= ${act}',
      '  h3 #{act',
      '  span= ${pug`span= act`}',
      '  if sho',
      '    span ok',
      '  each todo in ite',
      '    span= todo',
      '  - const local = han',
      '`;',
      'export { view };',
    ].join('\n');
    const doc = await createTempDoc('__vscode_test_typing_completions.tsx', content);
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();

    const cases = [
      { id: 'component', marker: 'But', expected: 'Button' },
      { id: 'attr-name', marker: 'Button(o', expected: 'onClick' },
      { id: 'attr-value', marker: 'Button(onClick=han', expected: 'handler' },
      { id: 'line-eq', marker: 'span= act', expected: 'activeTodos' },
      { id: 'template-interp', marker: 'span= ${act', expected: 'activeTodos' },
      { id: 'interp', marker: 'h3 #{act', expected: 'activeTodos' },
      { id: 'nested-template-interp', marker: 'pug`span= act', expected: 'activeTodos' },
      { id: 'if-test', marker: 'if sho', expected: 'showCompleted' },
      { id: 'each-in', marker: 'each todo in ite', expected: 'items' },
      { id: 'unbuffered', marker: '- const local = han', expected: 'handler' },
    ];

    const results = [];
    for (const c of cases) {
      const markerIndex = text.indexOf(c.marker);
      assert.ok(markerIndex > 0, `Could not find marker "${c.marker}"`);
      const pos = doc.positionAt(markerIndex + c.marker.length);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));

      await captureTestStep(`features-before-typing-completion-${c.id}`, {
        file: doc.uri.fsPath,
        marker: c.marker,
        expected: c.expected,
        position: { line: pos.line + 1, character: pos.character + 1 },
      });

      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await wait(450);
      const completions = await retry(async () => {
        const result = await vscode.commands.executeCommand(
          'vscode.executeCompletionItemProvider',
          doc.uri,
          pos,
        );
        return result && Array.isArray(result.items) && result.items.length > 0 ? result : null;
      }, 30000, 300);

      const labels = completions.items.map((item) => labelText(item.label));
      const hasExpected = labels.includes(c.expected);
      assert.ok(
        hasExpected,
        `Expected "${c.expected}" completion at marker "${c.marker}", got ${labels.slice(0, 40).join(', ')}`,
      );

      results.push({
        id: c.id,
        marker: c.marker,
        expected: c.expected,
        completionCount: labels.length,
        hasExpected,
      });

      await captureTestStep(`features-after-typing-completion-${c.id}`, {
        marker: c.marker,
        expected: c.expected,
        completionCount: labels.length,
        hasExpected,
      });
    }

    await captureTestStep('features-after-typing-completion-summary', {
      cases: results,
      passedCount: results.filter((r) => r.hasExpected).length,
      totalCount: results.length,
    });
  });
});
