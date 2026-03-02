import type ts from 'typescript';
import type { PugDocument } from '../language/mapping';
import { buildShadowDocument } from '../language/shadowDocument';
import { originalToShadow, shadowToOriginal, findRegionAtShadowOffset } from '../language/positionMapping';

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
        const doc = docCache.get(fileName);
        if (doc) {
          const origStart = shadowToOriginal(doc, result.textSpan.start);
          if (origStart != null) {
            const origEnd = shadowToOriginal(doc, result.textSpan.start + result.textSpan.length);
            result.textSpan = {
              start: origStart,
              length: origEnd != null ? origEnd - origStart : result.textSpan.length,
            };
          }
        }

        return result;
      };

      return proxy;
    },
  };
}

export = init;
