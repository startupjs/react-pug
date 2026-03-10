import * as vscode from 'vscode';
import type { StyleTagLang } from '../../react-pug-core/src/language/mapping';
import { extractPugAnalysis } from '../../react-pug-core/src/language/extractRegions';
import { compilePugToTsx } from '../../react-pug-core/src/language/pugToTsx';
import { buildShadowDocument } from '../../react-pug-core/src/language/shadowDocument';

const SCHEME = 'pug-react-shadow';
const STYLE_SCHEME = 'pug-react-style';
const TS_PLUGIN_NAME = '@startupjs/typescript-plugin-react-pug';
const STARTUPJS_OR_CSSXJS_RE = /['"](?:startupjs|cssxjs)['"]/;
const STYLE_COMPLETION_TRIGGER_CHARS = ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-:@.#&$'.split('');

let outputChannel: vscode.OutputChannel;
let styleDocCounter = 0;

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
  const classShorthandPropertyRaw = config.get<string>('classShorthandProperty', 'auto');
  const classShorthandProperty: 'auto' | 'className' | 'class' | 'styleName' = (
    classShorthandPropertyRaw === 'auto'
    || classShorthandPropertyRaw === 'className'
    || classShorthandPropertyRaw === 'class'
    || classShorthandPropertyRaw === 'styleName'
  ) ? classShorthandPropertyRaw : 'auto';
  const classShorthandMergeRaw = config.get<string>('classShorthandMerge', 'auto');
  const classShorthandMerge: 'auto' | 'concatenate' | 'classnames' = (
    classShorthandMergeRaw === 'auto'
    || classShorthandMergeRaw === 'concatenate'
    || classShorthandMergeRaw === 'classnames'
  ) ? classShorthandMergeRaw : 'auto';
  const requirePugImport = config.get<boolean>('requirePugImport', false);
  const componentPathFromUppercaseClassShorthand = config.get<boolean>(
    'componentPathFromUppercaseClassShorthand',
    true,
  );

  return {
    enabled: config.get<boolean>('enabled', true),
    diagnostics: {
      enabled: config.get<boolean>('diagnostics.enabled', true),
    },
    tagFunction: config.get<string>('tagFunction', 'pug'),
    injectCssxjsTypes,
    classShorthandProperty,
    classShorthandMerge,
    requirePugImport,
    componentPathFromUppercaseClassShorthand,
  };
}

function resolveClassShorthandOptions(
  sourceText: string,
  config: ReturnType<typeof readPluginConfig>,
): { classAttribute: 'className' | 'class' | 'styleName'; classMerge: 'concatenate' | 'classnames' } {
  const startupDetected = STARTUPJS_OR_CSSXJS_RE.test(sourceText);
  const shouldUseStyleNameByAuto = config.injectCssxjsTypes === 'force'
    || (config.injectCssxjsTypes === 'auto' && startupDetected);

  const classAttribute: 'className' | 'class' | 'styleName' = (
    config.classShorthandProperty === 'className'
    || config.classShorthandProperty === 'class'
    || config.classShorthandProperty === 'styleName'
  ) ? config.classShorthandProperty : (shouldUseStyleNameByAuto ? 'styleName' : 'className');

  const classMerge: 'concatenate' | 'classnames' = (
    config.classShorthandMerge === 'concatenate'
    || config.classShorthandMerge === 'classnames'
  ) ? config.classShorthandMerge : (classAttribute === 'styleName' ? 'classnames' : 'concatenate');

  return { classAttribute, classMerge };
}

function rawToStrippedOffset(rawText: string, rawOffset: number, commonIndent: number): number | null {
  if (commonIndent === 0) return rawOffset;
  let stripped = 0;
  let raw = 0;
  const lines = rawText.split('\n');
  for (const line of lines) {
    const lineEnd = raw + line.length;
    if (rawOffset <= lineEnd) {
      const colInRaw = rawOffset - raw;
      const indentToRemove = line.trim().length === 0 ? line.length : commonIndent;
      if (indentToRemove > 0 && colInRaw < indentToRemove) return null;
      return stripped + Math.max(0, colInRaw - indentToRemove);
    }
    const indentToRemove = line.trim().length === 0 ? line.length : commonIndent;
    stripped += Math.max(0, line.length - indentToRemove) + 1;
    raw = lineEnd + 1;
  }
  return stripped;
}

function strippedToRawOffset(rawText: string, strippedOffset: number, commonIndent: number): number {
  if (commonIndent === 0) return strippedOffset;
  let stripped = 0;
  let raw = 0;
  const lines = rawText.split('\n');
  for (const line of lines) {
    const indentToRemove = line.trim().length === 0 ? line.length : commonIndent;
    const strippedLineLen = Math.max(0, line.length - indentToRemove);
    if (strippedOffset <= stripped + strippedLineLen) {
      return raw + indentToRemove + (strippedOffset - stripped);
    }
    stripped += strippedLineLen + 1;
    raw += line.length + 1;
  }
  return raw;
}

function languageIdForStyleLang(lang: StyleTagLang): 'css' | 'scss' | 'sass' | 'stylus' {
  switch (lang) {
    case 'scss': return 'scss';
    case 'sass': return 'sass';
    case 'styl': return 'stylus';
    default: return 'css';
  }
}

function cssLikeReplaceRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const line = document.lineAt(position.line).text;
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z-]/.test(line[start - 1])) start -= 1;
  while (end < line.length && /[A-Za-z-]/.test(line[end])) end += 1;
  return new vscode.Range(
    new vscode.Position(position.line, start),
    new vscode.Position(position.line, end),
  );
}

function labelText(label: vscode.CompletionItemLabel | string): string {
  return typeof label === 'string' ? label : label.label;
}

async function ensureStyleLanguageExtensionActive(lang: StyleTagLang): Promise<void> {
  const extensionId = lang === 'styl' ? 'sysoev.language-stylus' : 'vscode.css-language-features';
  const ext = vscode.extensions.getExtension(extensionId);
  if (ext && !ext.isActive) {
    await ext.activate();
  }
}

async function openStyleCompletionDocument(
  styleDocs: Map<string, string>,
  styleUriBase: string,
  lang: StyleTagLang,
  content: string,
): Promise<vscode.TextDocument> {
  styleDocCounter += 1;
  const suffix = lang === 'styl' ? 'styl' : lang;
  const uri = vscode.Uri.parse(`${STYLE_SCHEME}:${styleUriBase}-${styleDocCounter}.${suffix}`);
  styleDocs.set(uri.toString(), content);
  const rawDoc = await vscode.workspace.openTextDocument(uri);
  const targetLanguage = languageIdForStyleLang(lang);
  if (rawDoc.languageId === targetLanguage) return rawDoc;
  return vscode.languages.setTextDocumentLanguage(rawDoc, targetLanguage);
}

function isLikelyDeclarationValueBeforeSemicolon(content: string, offset: number): boolean {
  if (content[offset] !== ';') return false;
  const lineStart = content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const linePrefix = content.slice(lineStart, offset);
  const lastColon = linePrefix.lastIndexOf(':');
  if (lastColon < 0) return false;
  const afterColon = linePrefix.slice(lastColon + 1);
  if (/[;{}]/.test(afterColon)) return false;
  return afterColon.trim().length > 0;
}

async function requestEmbeddedStyleCompletions(
  styleDocs: Map<string, string>,
  styleUriBase: string,
  lang: StyleTagLang,
  content: string,
  strippedOffset: number,
  triggerCharacter: string | undefined,
): Promise<vscode.CompletionList | undefined> {
  const requestOnce = async (requestContent: string): Promise<vscode.CompletionList | undefined> => {
    const tempDoc = await openStyleCompletionDocument(
      styleDocs,
      styleUriBase,
      lang,
      requestContent,
    );
    const tempPos = tempDoc.positionAt(strippedOffset);
    return vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      tempDoc.uri,
      tempPos,
      triggerCharacter,
    );
  };

  const primary = await requestOnce(content);
  if (!isLikelyDeclarationValueBeforeSemicolon(content, strippedOffset)) {
    return primary;
  }

  const maskedContent = content.slice(0, strippedOffset) + ' ' + content.slice(strippedOffset + 1);
  const masked = await requestOnce(maskedContent);
  if (masked && Array.isArray(masked.items) && masked.items.length > 0) {
    return masked;
  }
  return primary;
}

function createMappedCompletionItem(
  item: vscode.CompletionItem | any,
  range: vscode.Range,
): vscode.CompletionItem {
  const mapped = new vscode.CompletionItem(item.label, item.kind);
  mapped.detail = item.detail;
  mapped.documentation = item.documentation;
  mapped.sortText = item.sortText;
  mapped.filterText = item.filterText;
  mapped.preselect = item.preselect;
  mapped.tags = item.tags;
  mapped.commitCharacters = item.commitCharacters;
  mapped.keepWhitespace = item.keepWhitespace;
  mapped.command = item.command;
  mapped.range = range;

  const textEdit = item.textEdit;
  if (textEdit && 'newText' in textEdit && typeof textEdit.newText === 'string') {
    mapped.insertText = textEdit.newText.includes('$')
      ? new vscode.SnippetString(textEdit.newText)
      : textEdit.newText;
  } else if (item.insertText instanceof vscode.SnippetString) {
    mapped.insertText = item.insertText;
  } else if (item.insertText && typeof item.insertText === 'object' && typeof item.insertText.value === 'string') {
    mapped.insertText = new vscode.SnippetString(item.insertText.value);
  } else if (typeof item.insertText === 'string') {
    mapped.insertText = item.insertText;
  } else {
    mapped.insertText = labelText(item.label);
  }

  return mapped;
}

function findEmbeddedStyleContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  tagFunction: string,
): { lang: StyleTagLang; content: string; strippedOffset: number } | null {
  const text = document.getText();
  const analysis = extractPugAnalysis(text, document.fileName, tagFunction);
  const offset = document.offsetAt(position);

  for (const region of analysis.regions) {
    if (offset < region.pugTextStart || offset > region.pugTextEnd) continue;

    const compiled = compilePugToTsx(region.pugText);
    const styleBlock = compiled.styleBlock;
    if (!styleBlock) continue;

    const rawPugText = text.slice(region.pugTextStart, region.pugTextEnd);
    const rawOffsetInRegion = offset - region.pugTextStart;
    const regionOffset = rawToStrippedOffset(rawPugText, rawOffsetInRegion, region.commonIndent);
    if (regionOffset == null) continue;
    if (regionOffset < styleBlock.contentStart || regionOffset > styleBlock.contentEnd) continue;

    const styleTextInRegion = region.pugText.slice(styleBlock.contentStart, styleBlock.contentEnd);
    const rawOffsetInStyle = regionOffset - styleBlock.contentStart;
    const strippedOffset = rawToStrippedOffset(styleTextInRegion, rawOffsetInStyle, styleBlock.commonIndent);
    if (strippedOffset == null) return null;

    return {
      lang: styleBlock.lang,
      content: styleBlock.content,
      strippedOffset,
    };
  }

  return null;
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
  const styleDocs = new Map<string, string>();

  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return shadowDocs.get(uri.toString()) ?? '';
    },
  };

  const styleProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return styleDocs.get(uri.toString()) ?? '';
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(STYLE_SCHEME, styleProvider),
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [
        { language: 'typescript', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
      ],
      {
        async provideCompletionItems(document, position, _token, context) {
          try {
            const tagFunction = readPluginConfig().tagFunction;
            const styleContext = findEmbeddedStyleContext(document, position, tagFunction);
            if (!styleContext) return undefined;
            const triggerCharacter = context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter
              ? context.triggerCharacter
              : undefined;

            await ensureStyleLanguageExtensionActive(styleContext.lang);
            const result = await requestEmbeddedStyleCompletions(
              styleDocs,
              encodeURIComponent(document.uri.toString()),
              styleContext.lang,
              styleContext.content,
              styleContext.strippedOffset,
              triggerCharacter,
            );
            if (!result || !Array.isArray(result.items) || result.items.length === 0) {
              return undefined;
            }

            const replaceRange = cssLikeReplaceRange(document, position);
            return new vscode.CompletionList(
              result.items.map(item => createMappedCompletionItem(item, replaceRange)),
              result.isIncomplete,
            );
          } catch (e) {
            logError('embedded style completion failed', e);
            return undefined;
          }
        },
      },
      ...STYLE_COMPLETION_TRIGGER_CHARS,
    ),
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
        const pluginConfig = readPluginConfig();
        const tagFunction = pluginConfig.tagFunction;
        const classOptions = resolveClassShorthandOptions(text, pluginConfig);

        const shadow = buildShadowDocument(text, doc.fileName, 1, tagFunction, {
          ...classOptions,
          requirePugImport: pluginConfig.requirePugImport,
          componentPathFromUppercaseClassShorthand: pluginConfig.componentPathFromUppercaseClassShorthand,
        });

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
