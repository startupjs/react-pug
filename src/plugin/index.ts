import type ts from 'typescript';
import type { PugDocument } from '../language/mapping';
import { buildShadowDocument } from '../language/shadowDocument';
import { originalToShadow, shadowToOriginal } from '../language/positionMapping';

function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
  const tsModule = modules.typescript;

  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      const host = info.languageServiceHost;
      const originalGetSnapshot = host.getScriptSnapshot.bind(host);
      const originalGetVersion = host.getScriptVersion.bind(host);

      // Per-instance cache: stores PugDocument per file
      const docCache = new Map<string, PugDocument>();

      host.getScriptSnapshot = (fileName: string) => {
        const original = originalGetSnapshot(fileName);
        if (!original) return original;

        const text = original.getText(0, original.getLength());
        const cached = docCache.get(fileName);

        // Return cached shadow if original text hasn't changed
        if (cached && cached.originalText === text) {
          return tsModule.ScriptSnapshot.fromString(cached.shadowText);
        }

        const doc = buildShadowDocument(text, fileName, (cached?.version ?? 0) + 1);

        if (doc.regions.length > 0) {
          docCache.set(fileName, doc);
          return tsModule.ScriptSnapshot.fromString(doc.shadowText);
        }

        // File has no pug templates -- clean up cache
        if (cached) docCache.delete(fileName);
        return original;
      };

      host.getScriptVersion = (fileName: string) => {
        const cached = docCache.get(fileName);
        if (cached) return String(cached.version);
        return originalGetVersion(fileName);
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

      // Helper: map an original position to shadow position for a cached file
      function mapToShadow(fileName: string, position: number): number | null | undefined {
        const doc = docCache.get(fileName);
        if (!doc) return undefined; // no pug regions, use position as-is
        return originalToShadow(doc, position);
      }

      // Override: getCompletionsAtPosition
      proxy.getCompletionsAtPosition = (fileName, position, ...rest) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getCompletionsAtPosition(fileName, position, ...rest);
        }
        if (mapped === null) return undefined; // unmapped/synthetic position
        return ls.getCompletionsAtPosition(fileName, mapped, ...rest);
      };

      // Override: getCompletionEntryDetails
      proxy.getCompletionEntryDetails = (fileName, position, ...rest) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getCompletionEntryDetails(fileName, position, ...rest);
        }
        if (mapped === null) return undefined;
        return ls.getCompletionEntryDetails(fileName, mapped, ...rest);
      };

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
      proxy.getDefinitionAtPosition = (fileName, position) => {
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
      };

      // Override: getDefinitionAndBoundSpan
      proxy.getDefinitionAndBoundSpan = (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getDefinitionAndBoundSpan(fileName, position);
        }
        if (mapped === null) return undefined;
        const result = ls.getDefinitionAndBoundSpan(fileName, mapped);
        if (!result) return result;
        // Map the bound span (the highlighted word in the source file)
        result.textSpan = mapTextSpanBack(fileName, result.textSpan);
        // Map each definition's textSpan
        if (result.definitions) {
          for (const def of result.definitions) {
            def.textSpan = mapTextSpanBack(def.fileName, def.textSpan);
          }
        }
        return result;
      };

      // Override: getTypeDefinitionAtPosition
      proxy.getTypeDefinitionAtPosition = (fileName, position) => {
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
      };

      // Override: getQuickInfoAtPosition (hover)
      proxy.getQuickInfoAtPosition = (fileName, position) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getQuickInfoAtPosition(fileName, position);
        }
        if (mapped === null) return undefined;

        const result = ls.getQuickInfoAtPosition(fileName, mapped);
        if (!result) return result;

        // Map textSpan back from shadow -> original
        result.textSpan = mapTextSpanBack(fileName, result.textSpan);

        return result;
      };

      // Override: getSignatureHelpItems (parameter hints)
      proxy.getSignatureHelpItems = (fileName, position, options) => {
        const mapped = mapToShadow(fileName, position);
        if (mapped === undefined) {
          return ls.getSignatureHelpItems(fileName, position, options);
        }
        if (mapped === null) return undefined;

        const result = ls.getSignatureHelpItems(fileName, mapped, options);
        if (!result) return result;

        // Map applicableSpan back from shadow -> original
        result.applicableSpan = mapTextSpanBack(fileName, result.applicableSpan);

        return result;
      };

      // Override: getRenameInfo
      proxy.getRenameInfo = (fileName, position, ...rest) => {
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
      };

      // Override: findRenameLocations
      proxy.findRenameLocations = (fileName, position, findInStrings, findInComments, preferences) => {
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
      };

      // Override: findReferences
      proxy.findReferences = (fileName, position) => {
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
      };

      // Override: getReferencesAtPosition
      proxy.getReferencesAtPosition = (fileName, position) => {
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
      };

      // Override: getDocumentHighlights
      proxy.getDocumentHighlights = (fileName, position, filesToSearch) => {
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
      };

      // Override: getImplementationAtPosition
      proxy.getImplementationAtPosition = (fileName, position) => {
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
      };

      // Helper: map diagnostics from shadow -> original, filtering unmapped ones
      function mapDiagnostics<T extends ts.Diagnostic>(fileName: string, diagnostics: T[]): T[] {
        const doc = docCache.get(fileName);
        if (!doc) return diagnostics;

        const mapped: T[] = [];
        for (const diag of diagnostics) {
          if (diag.start == null) {
            // Diagnostics without a position (e.g. global errors) -- pass through
            mapped.push(diag);
            continue;
          }
          const origStart = shadowToOriginal(doc, diag.start);
          if (origStart == null) continue; // falls in synthetic/unmapped region -- filter out
          const origEnd = diag.length != null ? shadowToOriginal(doc, diag.start + diag.length) : null;
          mapped.push({
            ...diag,
            start: origStart,
            length: origEnd != null ? origEnd - origStart : diag.length,
          });
        }

        // Add pug parse error diagnostics for regions with parseError
        for (const region of doc.regions) {
          if (region.parseError) {
            mapped.push({
              file: undefined,
              start: region.pugTextStart + region.parseError.offset,
              length: 1,
              messageText: `Pug parse error: ${region.parseError.message}`,
              category: tsModule.DiagnosticCategory.Error,
              code: 99001,
              source: 'pug-react',
            } as unknown as T);
          }
        }

        return mapped;
      }

      // Override: getSemanticDiagnostics
      proxy.getSemanticDiagnostics = (fileName) => {
        const diagnostics = ls.getSemanticDiagnostics(fileName);
        return mapDiagnostics(fileName, diagnostics);
      };

      // Override: getSyntacticDiagnostics
      proxy.getSyntacticDiagnostics = (fileName) => {
        const diagnostics = ls.getSyntacticDiagnostics(fileName);
        return mapDiagnostics(fileName, diagnostics as ts.Diagnostic[]) as ts.DiagnosticWithLocation[];
      };

      // Override: getSuggestionDiagnostics
      proxy.getSuggestionDiagnostics = (fileName) => {
        const diagnostics = ls.getSuggestionDiagnostics(fileName);
        return mapDiagnostics(fileName, diagnostics as ts.Diagnostic[]) as ts.DiagnosticWithLocation[];
      };

      return proxy;
    },
  };
}

export = init;
