import type ts from 'typescript';
import {
  type PugDocument,
  buildShadowDocument,
  collectPugDocumentIssues,
  findRegionAtOriginalOffset,
  findRegionAtShadowOffset,
  hasTagFunctionCall,
  mapEncodedClassificationsToOriginal,
  mapGeneratedRangeToOriginal,
  mapOriginalOffsetToNearbyShadowOnSameLine,
  mapOriginalSpanToShadow,
  mapShadowSpanToOriginal,
  originalToShadow,
  shadowToOriginal,
} from '@react-pug/react-pug-core';

const EXTRA_REACT_ATTRIBUTES_MARKER = '/* [pug-react] startupjs/cssxjs extra react attributes */';
const STARTUPJS_OR_CSSXJS_RE = /['"](?:startupjs|cssxjs)['"]/;

const EXTRA_REACT_ATTRIBUTES_TEXT = `
${EXTRA_REACT_ATTRIBUTES_MARKER}
// extra props for cssxjs \`:part\` and \`styleName\` features
import 'react'

type __PugReactSimpleValue = string | number | boolean | null | undefined | bigint | symbol
type __PugReactFlagObject = Record<string, __PugReactSimpleValue>

// part: string OR array of (string | flag-object)
type __PugReactPartProp = string | Array<string | __PugReactFlagObject>

// styleName: classnames-compatible value (string/object or nested arrays)
type __PugReactStyleNameLeaf = undefined | string | __PugReactFlagObject
type __PugReactStyleNameProp = __PugReactStyleNameLeaf | Array<__PugReactStyleNameProp>

declare module 'react' {
  // For ANY React component (<MyComp ... />)
  // JSX.IntrinsicAttributes extends React.Attributes
  interface Attributes {
    /** [cssxjs] Name this element to be styleable from outside with \`:part(name)\` */
    part?: __PugReactPartProp
    /** [cssxjs] Class name(s) for styling the component. Supports classnames-like syntax */
    styleName?: __PugReactStyleNameProp
  }
}
`;

function withExtraReactAttributes(shadowText: string): string {
  if (shadowText.includes(EXTRA_REACT_ATTRIBUTES_MARKER)) return shadowText;
  return `${shadowText}\n${EXTRA_REACT_ATTRIBUTES_TEXT}`;
}

function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
  const tsModule = modules.typescript;

  function log(info: ts.server.PluginCreateInfo, msg: string): void {
    info.project.projectService.logger.info(`[pug-react] ${msg}`);
  }

  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      // Read configuration from info.config (passed by VS Code)
      const config = info.config ?? {};
      const enabled = config.enabled !== false;
      const diagnosticsEnabled = config.diagnostics?.enabled !== false;
      const tagFunction: string = config.tagFunction ?? 'pug';
      const injectModeRaw = config.injectCssxjsTypes;
      const injectCssxjsTypesMode: 'never' | 'auto' | 'force' = (
        injectModeRaw === 'never'
        || injectModeRaw === 'force'
        || injectModeRaw === 'auto'
      ) ? injectModeRaw : 'auto';
      const classTargetRaw = config.classShorthandProperty;
      const classShorthandProperty: 'auto' | 'className' | 'class' | 'styleName' = (
        classTargetRaw === 'auto'
        || classTargetRaw === 'className'
        || classTargetRaw === 'class'
        || classTargetRaw === 'styleName'
      ) ? classTargetRaw : 'auto';
      const classMergeRaw = config.classShorthandMerge;
      const classShorthandMerge: 'auto' | 'concatenate' | 'classnames' = (
        classMergeRaw === 'auto'
        || classMergeRaw === 'concatenate'
        || classMergeRaw === 'classnames'
      ) ? classMergeRaw : 'auto';
      const requirePugImport = config.requirePugImport === true;
      const componentPathFromUppercaseClassShorthand = config.componentPathFromUppercaseClassShorthand !== false;

      const host = info.languageServiceHost;
      const originalGetSnapshot = host.getScriptSnapshot.bind(host);
      const originalGetVersion = host.getScriptVersion.bind(host);

      // Per-instance cache: stores PugDocument per file
      const docCache = new Map<string, PugDocument>();
      const fileExtraTypesState = new Map<string, boolean>();
      const fileClassShorthandState = new Map<string, string>();

      function isTsOrTsxFile(fileName: string): boolean {
        const lower = fileName.toLowerCase();
        return lower.endsWith('.ts') || lower.endsWith('.tsx');
      }

      function shouldInjectExtraReactAttributes(fileName: string, text: string): boolean {
        if (!isTsOrTsxFile(fileName)) return false;
        if (injectCssxjsTypesMode === 'never') return false;
        if (injectCssxjsTypesMode === 'force') return true;
        return STARTUPJS_OR_CSSXJS_RE.test(text);
      }

      function resolveClassShorthandOptions(
        text: string,
      ): { classAttribute: 'className' | 'class' | 'styleName'; classMerge: 'concatenate' | 'classnames' } {
        const startupDetected = STARTUPJS_OR_CSSXJS_RE.test(text);
        const shouldUseStyleNameByAuto = injectCssxjsTypesMode === 'force'
          || (injectCssxjsTypesMode === 'auto' && startupDetected);

        const classAttribute: 'className' | 'class' | 'styleName' = (
          classShorthandProperty === 'className'
          || classShorthandProperty === 'class'
          || classShorthandProperty === 'styleName'
        ) ? classShorthandProperty : (shouldUseStyleNameByAuto ? 'styleName' : 'className');

        const classMerge: 'concatenate' | 'classnames' = (
          classShorthandMerge === 'concatenate' || classShorthandMerge === 'classnames'
        ) ? classShorthandMerge : (classAttribute === 'styleName' ? 'classnames' : 'concatenate');

        return { classAttribute, classMerge };
      }

      host.getScriptSnapshot = (fileName: string) => {
        const original = originalGetSnapshot(fileName);
        if (!original) return original;

        // When disabled, pass through original content
        if (!enabled) return original;

        try {
          const text = original.getText(0, original.getLength());
          if (!hasTagFunctionCall(text, tagFunction)) {
            if (docCache.has(fileName)) {
              docCache.delete(fileName);
              fileExtraTypesState.delete(fileName);
              fileClassShorthandState.delete(fileName);
            }
            return original;
          }

          const cached = docCache.get(fileName);
          const extraTypesEnabled = shouldInjectExtraReactAttributes(fileName, text);
          const classOptions = resolveClassShorthandOptions(text);
          const classState = `${classOptions.classAttribute}:${classOptions.classMerge}:${componentPathFromUppercaseClassShorthand ? '1' : '0'}:${requirePugImport ? '1' : '0'}`;

          // Return cached shadow if original text hasn't changed
          if (
            cached
            && cached.originalText === text
            && fileExtraTypesState.get(fileName) === extraTypesEnabled
            && fileClassShorthandState.get(fileName) === classState
          ) {
            return tsModule.ScriptSnapshot.fromString(cached.shadowText);
          }

          const doc = buildShadowDocument(
            text,
            fileName,
            (cached?.version ?? 0) + 1,
            tagFunction,
            {
              ...classOptions,
              componentPathFromUppercaseClassShorthand,
              requirePugImport,
            },
          );

          if (doc.regions.length > 0) {
            if (extraTypesEnabled) {
              doc.shadowText = withExtraReactAttributes(doc.shadowText);
            }
            docCache.set(fileName, doc);
            fileExtraTypesState.set(fileName, extraTypesEnabled);
            fileClassShorthandState.set(fileName, classState);
            return tsModule.ScriptSnapshot.fromString(doc.shadowText);
          }

          // File has no pug templates -- clean up cache
          if (cached) {
            docCache.delete(fileName);
            fileExtraTypesState.delete(fileName);
            fileClassShorthandState.delete(fileName);
          }
          return original;
        } catch (e) {
          log(info, `getScriptSnapshot error for ${fileName}: ${e}`);
          return original;
        }
      };

      host.getScriptVersion = (fileName: string) => {
        const hostVersion = originalGetVersion(fileName);
        const cached = docCache.get(fileName);
        if (cached) return `${hostVersion}:${cached.version}`;
        return hostVersion;
      };

      // Create proxy LanguageService that delegates all methods to the original
      const proxy = Object.create(null) as ts.LanguageService;
      const ls = info.languageService;
      for (const k of Object.keys(ls) as Array<keyof ts.LanguageService>) {
        const value = ls[k];
        if (typeof value === 'function') {
          (proxy as any)[k] = (...args: any[]) => (value as Function).apply(ls, args);
        }
      }

      // Wrap a proxy override so exceptions fall back to the original LS method
      function safeOverride<K extends keyof ts.LanguageService>(
        method: K,
        fn: ts.LanguageService[K],
      ): void {
        const original = ls[method];
        (proxy as any)[method] = (...args: any[]) => {
          try {
            return (fn as Function).apply(null, args);
          } catch (e) {
            log(info, `${String(method)} error: ${e}`);
            return (original as Function).apply(ls, args);
          }
        };
      }

      // Ensure docCache is populated for a file (triggers patched getScriptSnapshot)
      function ensureCached(fileName: string): void {
        if (!docCache.has(fileName)) {
          host.getScriptSnapshot(fileName);
        }
      }

      // Helper: map an original position to shadow position for a cached file
      function mapToShadow(fileName: string, position: number): number | null | undefined {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) return undefined; // no pug regions, use position as-is
        return originalToShadow(doc, position);
      }

      // Lenient mapping for typing-time completions: if exact position is unmapped,
      // try nearby mapped offsets on the same line and preserve relative cursor delta.
      function mapToShadowForTyping(fileName: string, position: number): number | null | undefined {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) return undefined;
        return mapOriginalOffsetToNearbyShadowOnSameLine(doc, position);
      }

      // Helper: map completion result spans back from shadow -> original.
      function mapCompletionInfoBack(
        fileName: string,
        infoResult: ts.WithMetadata<ts.CompletionInfo> | undefined,
      ): ts.WithMetadata<ts.CompletionInfo> | undefined {
        if (!infoResult) return infoResult;
        return {
          ...infoResult,
          optionalReplacementSpan: infoResult.optionalReplacementSpan
            ? mapTextSpanBack(fileName, infoResult.optionalReplacementSpan)
            : undefined,
          entries: infoResult.entries.map(entry => (
            entry.replacementSpan
              ? { ...entry, replacementSpan: mapTextSpanBack(fileName, entry.replacementSpan) }
              : entry
          )),
        };
      }

      // Helper: map completion detail code-action edits back from shadow -> original.
      function mapCompletionEntryDetailsBack(
        details: ts.CompletionEntryDetails | undefined,
      ): ts.CompletionEntryDetails | undefined {
        if (!details?.codeActions || details.codeActions.length === 0) return details;
        return {
          ...details,
          codeActions: details.codeActions.map(action => ({
            ...action,
            changes: mapFileTextChanges(action.changes),
          })),
        };
      }

      // Override: getCompletionsAtPosition
      safeOverride('getCompletionsAtPosition', (fileName, position, ...rest) => {
        const mapped = mapToShadowForTyping(fileName, position);
        if (mapped === undefined) {
          return mapCompletionInfoBack(
            fileName,
            ls.getCompletionsAtPosition(fileName, position, ...rest),
          );
        }
        if (mapped === null) return undefined; // unmapped/synthetic position
        return mapCompletionInfoBack(
          fileName,
          ls.getCompletionsAtPosition(fileName, mapped, ...rest),
        );
      });

      // Override: getCompletionEntryDetails
      safeOverride('getCompletionEntryDetails', (fileName, position, ...rest) => {
        const mapped = mapToShadowForTyping(fileName, position);
        if (mapped === undefined) {
          return mapCompletionEntryDetailsBack(
            ls.getCompletionEntryDetails(fileName, position, ...rest),
          );
        }
        if (mapped === null) return undefined;
        return mapCompletionEntryDetailsBack(
          ls.getCompletionEntryDetails(fileName, mapped, ...rest),
        );
      });

      // Helper: map a textSpan back from shadow -> original for a given file
      function mapTextSpanBack(fileName: string, textSpan: ts.TextSpan): ts.TextSpan {
        const doc = docCache.get(fileName);
        if (!doc) return textSpan;
        const mapped = mapShadowSpanToOriginal(doc, textSpan);
        if (!mapped) return textSpan;
        return { start: mapped.start, length: mapped.length };
      }

      // Override: getDefinitionAtPosition
      safeOverride('getDefinitionAtPosition', (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getDefinitionAtPosition(fileName, position);
        }
        if (mapped === null) return undefined;
        const results = ls.getDefinitionAtPosition(fileName, mapped);
        if (results) {
          for (const def of results) {
            def.textSpan = mapTextSpanBack(def.fileName, def.textSpan);
          }
        }
        return results;
      });

      // Override: getDefinitionAndBoundSpan
      safeOverride('getDefinitionAndBoundSpan', (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getDefinitionAndBoundSpan(fileName, position);
        }
        if (mapped === null) return undefined;
        const result = ls.getDefinitionAndBoundSpan(fileName, mapped);
        if (!result) return result;
        result.textSpan = mapTextSpanBack(fileName, result.textSpan);
        if (result.definitions) {
          for (const def of result.definitions) {
            def.textSpan = mapTextSpanBack(def.fileName, def.textSpan);
          }
        }
        return result;
      });

      // Override: getTypeDefinitionAtPosition
      safeOverride('getTypeDefinitionAtPosition', (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getTypeDefinitionAtPosition(fileName, position);
        }
        if (mapped === null) return undefined;
        const results = ls.getTypeDefinitionAtPosition(fileName, mapped);
        if (results) {
          for (const def of results) {
            def.textSpan = mapTextSpanBack(def.fileName, def.textSpan);
          }
        }
        return results;
      });

      // Override: getQuickInfoAtPosition (hover)
      safeOverride('getQuickInfoAtPosition', (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getQuickInfoAtPosition(fileName, position);
        }
        if (mapped === null) return undefined;
        const result = ls.getQuickInfoAtPosition(fileName, mapped);
        if (!result) return result;
        result.textSpan = mapTextSpanBack(fileName, result.textSpan);
        return result;
      });

      // Override: getSignatureHelpItems (parameter hints)
      safeOverride('getSignatureHelpItems', (fileName, position, options) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getSignatureHelpItems(fileName, position, options);
        }
        if (mapped === null) return undefined;
        const result = ls.getSignatureHelpItems(fileName, mapped, options);
        if (!result) return result;
        result.applicableSpan = mapTextSpanBack(fileName, result.applicableSpan);
        return result;
      });

      // Override: getRenameInfo
      safeOverride('getRenameInfo', (fileName, position, ...rest) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getRenameInfo(fileName, position, ...rest);
        }
        if (mapped === null) {
          return { canRename: false, localizedErrorMessage: 'Cannot rename at this position' };
        }
        const result = ls.getRenameInfo(fileName, mapped, ...rest);
        if (result.canRename && result.triggerSpan) {
          result.triggerSpan = mapTextSpanBack(fileName, result.triggerSpan);
        }
        return result;
      });

      // Override: findRenameLocations
      safeOverride('findRenameLocations', ((fileName: string, position: number, findInStrings: boolean, findInComments: boolean, preferences?: any) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.findRenameLocations(fileName, position, findInStrings, findInComments, preferences as any);
        }
        if (mapped === null) return undefined;
        const results = ls.findRenameLocations(fileName, mapped, findInStrings, findInComments, preferences as any);
        if (results) {
          for (const loc of results) {
            loc.textSpan = mapTextSpanBack(loc.fileName, loc.textSpan);
          }
        }
        return results;
      }) as any);

      // Override: findReferences
      safeOverride('findReferences', (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.findReferences(fileName, position);
        }
        if (mapped === null) return undefined;
        const results = ls.findReferences(fileName, mapped);
        if (results) {
          for (const group of results) {
            group.definition.textSpan = mapTextSpanBack(group.definition.fileName, group.definition.textSpan);
            for (const ref of group.references) {
              ref.textSpan = mapTextSpanBack(ref.fileName, ref.textSpan);
            }
          }
        }
        return results;
      });

      // Override: getReferencesAtPosition
      safeOverride('getReferencesAtPosition', (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getReferencesAtPosition(fileName, position);
        }
        if (mapped === null) return undefined;
        const results = ls.getReferencesAtPosition(fileName, mapped);
        if (results) {
          for (const ref of results) {
            ref.textSpan = mapTextSpanBack(ref.fileName, ref.textSpan);
          }
        }
        return results;
      });

      // Override: getDocumentHighlights
      safeOverride('getDocumentHighlights', (fileName, position, filesToSearch) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getDocumentHighlights(fileName, position, filesToSearch);
        }
        if (mapped === null) return undefined;
        const results = ls.getDocumentHighlights(fileName, mapped, filesToSearch);
        if (results) {
          for (const docHighlight of results) {
            for (const highlight of docHighlight.highlightSpans) {
              highlight.textSpan = mapTextSpanBack(docHighlight.fileName, highlight.textSpan);
            }
          }
        }
        return results;
      });

      // Override: getImplementationAtPosition
      safeOverride('getImplementationAtPosition', (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getImplementationAtPosition(fileName, position);
        }
        if (mapped === null) return undefined;
        const results = ls.getImplementationAtPosition(fileName, mapped);
        if (results) {
          for (const impl of results) {
            impl.textSpan = mapTextSpanBack(impl.fileName, impl.textSpan);
          }
        }
        return results;
      });

      // Helper: map FileTextChanges spans back from shadow -> original
      function mapFileTextChanges(changes: readonly ts.FileTextChanges[]): ts.FileTextChanges[] {
        return changes.map(ftc => ({
          ...ftc,
          textChanges: ftc.textChanges.map(tc => ({
            ...tc,
            span: mapTextSpanBack(ftc.fileName, tc.span),
          })),
        }));
      }

      // Override: getApplicableRefactors
      safeOverride('getApplicableRefactors', (fileName, positionOrRange, ...rest) => {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) {
          return ls.getApplicableRefactors(fileName, positionOrRange, ...rest);
        }
        if (typeof positionOrRange === 'number') {
          const mapped = originalToShadow(doc, positionOrRange);
          if (mapped == null) return [];
          return ls.getApplicableRefactors(fileName, mapped, ...rest);
        }
        const mappedSpan = mapOriginalSpanToShadow(doc, {
          start: positionOrRange.pos,
          length: positionOrRange.end - positionOrRange.pos,
        });
        if (!mappedSpan) return [];
        return ls.getApplicableRefactors(
          fileName,
          { pos: mappedSpan.start, end: mappedSpan.end },
          ...rest,
        );
      });

      // Override: getEditsForRefactor
      safeOverride('getEditsForRefactor', (fileName, formatOptions, positionOrRange, refactorName, actionName, preferences, interactiveRefactorArguments) => {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        let mappedRange: number | ts.TextRange = positionOrRange;
        if (doc) {
          if (typeof positionOrRange === 'number') {
            const mapped = originalToShadow(doc, positionOrRange);
            if (mapped == null) return undefined;
            mappedRange = mapped;
          } else {
            const mappedSpan = mapOriginalSpanToShadow(doc, {
              start: positionOrRange.pos,
              length: positionOrRange.end - positionOrRange.pos,
            });
            if (!mappedSpan) return undefined;
            mappedRange = { pos: mappedSpan.start, end: mappedSpan.end };
          }
        }
        const result = ls.getEditsForRefactor(fileName, formatOptions, mappedRange, refactorName, actionName, preferences, interactiveRefactorArguments);
        if (!result) return result;
        return {
          ...result,
          edits: mapFileTextChanges(result.edits),
          renameLocation: result.renameLocation != null
            ? (() => {
                const renameDoc = docCache.get(result.renameFilename ?? fileName);
                if (!renameDoc) return result.renameLocation;
                return shadowToOriginal(renameDoc, result.renameLocation!) ?? result.renameLocation;
              })()
            : undefined,
        };
      });

      // Override: getCodeFixesAtPosition
      safeOverride('getCodeFixesAtPosition', (fileName, start, end, errorCodes, formatOptions, preferences) => {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        let mappedStart = start;
        let mappedEnd = end;
        if (doc) {
          const mappedSpan = mapOriginalSpanToShadow(doc, {
            start,
            length: end - start,
          });
          if (!mappedSpan) return [];
          mappedStart = mappedSpan.start;
          mappedEnd = mappedSpan.end;
        }
        const results = ls.getCodeFixesAtPosition(fileName, mappedStart, mappedEnd, errorCodes, formatOptions, preferences);
        return results.map(fix => ({
          ...fix,
          changes: mapFileTextChanges(fix.changes),
        }));
      });

      // Override: getCombinedCodeFix
      safeOverride('getCombinedCodeFix', (scope, fixId, formatOptions, preferences) => {
        const result = ls.getCombinedCodeFix(scope, fixId, formatOptions, preferences);
        return {
          ...result,
          changes: mapFileTextChanges(result.changes),
        };
      });

      // Override: getEncodedSyntacticClassifications
      safeOverride('getEncodedSyntacticClassifications', (fileName, span) => {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) return ls.getEncodedSyntacticClassifications(fileName, span);

        const querySpan = mapOriginalSpanToShadow(doc, span)
          ?? { start: 0, end: doc.shadowText.length, length: doc.shadowText.length };
        const result = ls.getEncodedSyntacticClassifications(fileName, querySpan);
        return mapEncodedClassificationsToOriginal(doc, span, result);
      });

      // Override: getEncodedSemanticClassifications
      safeOverride('getEncodedSemanticClassifications', (fileName, span, format) => {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) return ls.getEncodedSemanticClassifications(fileName, span, format);

        const querySpan = mapOriginalSpanToShadow(doc, span)
          ?? { start: 0, end: doc.shadowText.length, length: doc.shadowText.length };
        const result = ls.getEncodedSemanticClassifications(fileName, querySpan, format);
        return mapEncodedClassificationsToOriginal(doc, span, result);
      });

      // Diagnostic codes to suppress in pug regions (false positives from generated TSX)
      const SUPPRESSED_DIAG_CODES = new Set([
        // "Cannot find namespace 'JSX'" -- from null placeholder in error recovery
        2503,
        // "Expression expected" -- from structural TSX brackets
        1109,
        // "This JSX tag requires the module path 'react/jsx-runtime' to exist"
        // -- shadow TSX infrastructure requirement, not an original-source issue
        2875,
      ]);

      // Helper: map diagnostics from shadow -> original, filtering unmapped ones
      function mapDiagnostics<T extends ts.Diagnostic>(fileName: string, diagnostics: T[]): T[] {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) return diagnostics;

        const mapped: T[] = [];
        for (const diag of diagnostics) {
          if (diag.start == null) {
            // Diagnostics without a position (e.g. global errors) -- pass through
            mapped.push(diag);
            continue;
          }

          const mappedRange = mapGeneratedRangeToOriginal(doc, diag.start, diag.length ?? 1);
          if (!mappedRange) {
            if (SUPPRESSED_DIAG_CODES.has(diag.code) && findRegionAtShadowOffset(doc, diag.start)) {
              continue;
            }
            continue; // falls in synthetic/unmapped region -- filter out
          }

          // Suppress known false-positive codes that ultimately map into pug regions.
          if (SUPPRESSED_DIAG_CODES.has(diag.code) && findRegionAtOriginalOffset(doc, mappedRange.start)) {
            continue;
          }

          mapped.push({
            ...diag,
            start: mappedRange.start,
            length: mappedRange.length,
          });
        }

        // Add pug parse error diagnostics for regions with parseError (if enabled)
        if (!diagnosticsEnabled) return mapped;
        for (const issue of collectPugDocumentIssues(doc)) {
          const code = issue.kind === 'missing-tag-import'
            ? 99002
            : issue.kind === 'parse-error'
              ? 99001
              : 99003;
          const messagePrefix = issue.kind === 'missing-tag-import'
            ? ''
            : issue.kind === 'parse-error'
              ? 'Pug parse error: '
              : 'Pug transform error: ';

          mapped.push({
            file: undefined,
            start: issue.start,
            length: issue.length,
            messageText: `${messagePrefix}${issue.message}`,
            category: tsModule.DiagnosticCategory.Error,
            code,
            source: 'pug-react',
          } as unknown as T);
        }

        return mapped;
      }

      // Override: getSemanticDiagnostics
      safeOverride('getSemanticDiagnostics', (fileName) => {
        const diagnostics = ls.getSemanticDiagnostics(fileName);
        return mapDiagnostics(fileName, diagnostics);
      });

      // Override: getSyntacticDiagnostics
      safeOverride('getSyntacticDiagnostics', (fileName) => {
        const diagnostics = ls.getSyntacticDiagnostics(fileName);
        return mapDiagnostics(fileName, diagnostics as ts.Diagnostic[]) as ts.DiagnosticWithLocation[];
      });

      // Override: getSuggestionDiagnostics
      safeOverride('getSuggestionDiagnostics', (fileName) => {
        const diagnostics = ls.getSuggestionDiagnostics(fileName);
        return mapDiagnostics(fileName, diagnostics as ts.Diagnostic[]) as ts.DiagnosticWithLocation[];
      });

      return proxy;
    },
  };
}

export = init;
