import type ts from 'typescript';
import type { PugDocument } from '../../react-pug-core/src/language/mapping';
import { buildShadowDocument } from '../../react-pug-core/src/language/shadowDocument';
import { findRegionAtOriginalOffset, originalToShadow, shadowToOriginal } from '../../react-pug-core/src/language/positionMapping';

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

// styleName: string OR flag-object OR array of (undefined | string | flag-object)
type __PugReactStyleNameProp = string | __PugReactFlagObject | Array<undefined | string | __PugReactFlagObject>

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

      const host = info.languageServiceHost;
      const originalGetSnapshot = host.getScriptSnapshot.bind(host);
      const originalGetVersion = host.getScriptVersion.bind(host);

      // Per-instance cache: stores PugDocument per file
      const docCache = new Map<string, PugDocument>();
      const fileExtraTypesState = new Map<string, boolean>();

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

      host.getScriptSnapshot = (fileName: string) => {
        const original = originalGetSnapshot(fileName);
        if (!original) return original;

        // When disabled, pass through original content
        if (!enabled) return original;

        try {
          const text = original.getText(0, original.getLength());
          const cached = docCache.get(fileName);
          const extraTypesEnabled = shouldInjectExtraReactAttributes(fileName, text);

          // Return cached shadow if original text hasn't changed
          if (
            cached
            && cached.originalText === text
            && fileExtraTypesState.get(fileName) === extraTypesEnabled
          ) {
            return tsModule.ScriptSnapshot.fromString(cached.shadowText);
          }

          const doc = buildShadowDocument(text, fileName, (cached?.version ?? 0) + 1, tagFunction);

          if (doc.regions.length > 0) {
            if (extraTypesEnabled) {
              doc.shadowText = withExtraReactAttributes(doc.shadowText);
            }
            docCache.set(fileName, doc);
            fileExtraTypesState.set(fileName, extraTypesEnabled);
            return tsModule.ScriptSnapshot.fromString(doc.shadowText);
          }

          // File has no pug templates -- clean up cache
          if (cached) {
            docCache.delete(fileName);
            fileExtraTypesState.delete(fileName);
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
        const mapped = mapToShadow(fileName, position);
        if (mapped !== null) return mapped;

        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) return undefined;

        const region = findRegionAtOriginalOffset(doc, position);
        if (!region) return null;
        if (position < region.pugTextStart || position > region.pugTextEnd) return null;

        const lineStart = doc.originalText.lastIndexOf('\n', position - 1) + 1;
        const lineEndIdx = doc.originalText.indexOf('\n', position);
        const lineEnd = lineEndIdx >= 0 ? lineEndIdx : doc.originalText.length;
        const maxRadius = 3;

        for (let radius = 1; radius <= maxRadius; radius++) {
          const left = position - radius;
          if (left >= lineStart) {
            const leftMapped = originalToShadow(doc, left);
            if (leftMapped != null) {
              if (left === position - 1) {
                const ch = doc.originalText[position] ?? '';
                if (/\s|[),]/.test(ch)) {
                  return Math.min(leftMapped + 1, doc.shadowText.length);
                }
              }
              return leftMapped;
            }
          }

          const right = position + radius;
          if (right <= lineEnd) {
            const rightMapped = originalToShadow(doc, right);
            if (rightMapped != null) {
              return rightMapped;
            }
          }
        }

        return null;
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
        const origStart = shadowToOriginal(doc, textSpan.start);
        if (origStart == null) return textSpan;
        const origEnd = shadowToOriginal(doc, textSpan.start + textSpan.length);
        return {
          start: origStart,
          length: origEnd != null ? origEnd - origStart : textSpan.length,
        };
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

      // Helper: map a requested original span to shadow span for classification queries.
      // Returns null when a clean range mapping is not possible.
      function mapQuerySpanToShadow(doc: PugDocument, span: ts.TextSpan): ts.TextSpan | null {
        const shadowStart = originalToShadow(doc, span.start);
        const shadowEnd = originalToShadow(doc, span.start + span.length);
        if (shadowStart == null || shadowEnd == null || shadowEnd < shadowStart) {
          return null;
        }
        return { start: shadowStart, length: shadowEnd - shadowStart };
      }

      // Helper: map encoded classifications (triples: start,length,class) back to original file.
      function mapEncodedClassifications(
        fileName: string,
        requestedOriginalSpan: ts.TextSpan,
        classifications: ts.Classifications,
      ): ts.Classifications {
        const doc = docCache.get(fileName);
        if (!doc) return classifications;

        const originalStart = requestedOriginalSpan.start;
        const originalEnd = requestedOriginalSpan.start + requestedOriginalSpan.length;
        const maxOriginal = doc.originalText.length;
        const mappedSpans: number[] = [];
        const encoded = classifications.spans ?? [];

        for (let i = 0; i + 2 < encoded.length; i += 3) {
          const shadowStart = encoded[i];
          const shadowLength = encoded[i + 1];
          const classification = encoded[i + 2];
          if (!Number.isFinite(shadowStart) || !Number.isFinite(shadowLength) || shadowLength <= 0) continue;

          const mappedStart = shadowToOriginal(doc, shadowStart);
          const mappedEnd = shadowToOriginal(doc, shadowStart + shadowLength);
          if (mappedStart == null || mappedEnd == null) continue;

          let start = mappedStart;
          let end = mappedEnd;
          if (end <= start) continue;

          if (end <= originalStart || start >= originalEnd) continue;
          if (start < originalStart) start = originalStart;
          if (end > originalEnd) end = originalEnd;

          if (start < 0) start = 0;
          if (end > maxOriginal) end = maxOriginal;
          const length = end - start;
          if (length <= 0) continue;

          mappedSpans.push(start, length, classification);
        }

        return {
          spans: mappedSpans,
          endOfLineState: classifications.endOfLineState,
        };
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
        const mappedPos = originalToShadow(doc, positionOrRange.pos);
        const mappedEnd = originalToShadow(doc, positionOrRange.end);
        if (mappedPos == null || mappedEnd == null) return [];
        return ls.getApplicableRefactors(fileName, { pos: mappedPos, end: mappedEnd }, ...rest);
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
            const mappedPos = originalToShadow(doc, positionOrRange.pos);
            const mappedEnd = originalToShadow(doc, positionOrRange.end);
            if (mappedPos == null || mappedEnd == null) return undefined;
            mappedRange = { pos: mappedPos, end: mappedEnd };
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
          const ms = originalToShadow(doc, start);
          const me = originalToShadow(doc, end);
          if (ms == null || me == null) return [];
          mappedStart = ms;
          mappedEnd = me;
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

        const querySpan = mapQuerySpanToShadow(doc, span)
          ?? { start: 0, length: doc.shadowText.length };
        const result = ls.getEncodedSyntacticClassifications(fileName, querySpan);
        return mapEncodedClassifications(fileName, span, result);
      });

      // Override: getEncodedSemanticClassifications
      safeOverride('getEncodedSemanticClassifications', (fileName, span, format) => {
        ensureCached(fileName);
        const doc = docCache.get(fileName);
        if (!doc) return ls.getEncodedSemanticClassifications(fileName, span, format);

        const querySpan = mapQuerySpanToShadow(doc, span)
          ?? { start: 0, length: doc.shadowText.length };
        const result = ls.getEncodedSemanticClassifications(fileName, querySpan, format);
        return mapEncodedClassifications(fileName, span, result);
      });

      // Diagnostic codes to suppress in pug regions (false positives from generated TSX)
      const SUPPRESSED_DIAG_CODES = new Set([
        // "Cannot find namespace 'JSX'" -- from null placeholder in error recovery
        2503,
        // "Expression expected" -- from structural TSX brackets
        1109,
      ]);

      // Helper: check if a shadow offset falls inside any pug region
      function isInsidePugRegion(doc: PugDocument, shadowOffset: number): boolean {
        for (const region of doc.regions) {
          if (shadowOffset >= region.shadowStart && shadowOffset < region.shadowEnd) {
            return true;
          }
        }
        return false;
      }

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

          // Suppress known false-positive codes inside pug regions
          if (SUPPRESSED_DIAG_CODES.has(diag.code) && isInsidePugRegion(doc, diag.start)) {
            continue;
          }

          const origStart = shadowToOriginal(doc, diag.start);
          if (origStart == null) continue; // falls in synthetic/unmapped region -- filter out

          const origEnd = diag.length != null ? shadowToOriginal(doc, diag.start + diag.length) : null;
          // Ensure length is at least 1 for mapped diagnostics
          const length = origEnd != null ? Math.max(1, origEnd - origStart) : diag.length;
          mapped.push({
            ...diag,
            start: origStart,
            length,
          });
        }

        // Add pug parse error diagnostics for regions with parseError (if enabled)
        if (!diagnosticsEnabled) return mapped;
        for (const region of doc.regions) {
          if (region.parseError) {
            const err = region.parseError;
            // Compute a meaningful error span length
            let errorStart = region.pugTextStart + err.offset;
            let textAfterError = doc.originalText.slice(errorStart);

            // If error points at a newline, advance to the next non-empty line
            if (textAfterError.startsWith('\n')) {
              const nextLineStart = textAfterError.indexOf('\n') + 1;
              const trimmedNext = textAfterError.slice(nextLineStart);
              const indentLen = trimmedNext.match(/^\s*/)?.[0].length ?? 0;
              errorStart += nextLineStart + indentLen;
              textAfterError = doc.originalText.slice(errorStart);
            }

            const nlIdx = textAfterError.indexOf('\n');
            const errorLength = Math.max(1, nlIdx >= 0 ? nlIdx : Math.min(textAfterError.length, 20));

            mapped.push({
              file: undefined,
              start: errorStart,
              length: errorLength,
              messageText: `Pug parse error: ${err.message}`,
              category: tsModule.DiagnosticCategory.Error,
              code: 99001,
              source: 'pug-react',
            } as unknown as T);
          }
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
