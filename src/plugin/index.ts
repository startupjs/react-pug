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

      return proxy;
    },
  };
}

export = init;
