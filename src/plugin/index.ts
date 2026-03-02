import type ts from 'typescript';

/** Regex to match pug`...` tagged template literals (non-greedy, handles multiline) */
const PUG_TAG_RE = /pug`([\s\S]*?)`/g;

/**
 * Simple spike-only transformation: replace each pug`...` with a JSX expression.
 * Converts basic pug lines like "  .card\n    Button(onClick=onClick) Click"
 * into a parenthesized JSX expression.
 *
 * For the spike this uses naive line-by-line conversion -- real parsing comes later.
 */
function transformPugToJsx(pugContent: string): string {
  const lines = pugContent.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return '(null as any as JSX.Element)';

  const jsxParts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();

    // Class shorthand: .foo -> <div className="foo" />
    const classMatch = trimmed.match(/^\.(\w[\w-]*)$/);
    if (classMatch) {
      jsxParts.push(`<div className="${classMatch[1]}" />`);
      continue;
    }

    // Tag with attributes and text: Button(onClick=handler) Text
    const tagAttrTextMatch = trimmed.match(/^(\w+)\(([^)]*)\)\s*(.*)$/);
    if (tagAttrTextMatch) {
      const [, tag, rawAttrs, text] = tagAttrTextMatch;
      const attrs = rawAttrs.split(',').map(a => {
        const [name, val] = a.trim().split('=');
        return val ? `${name}={${val}}` : name;
      }).join(' ');
      if (text) {
        jsxParts.push(`<${tag} ${attrs}>${text}</${tag}>`);
      } else {
        jsxParts.push(`<${tag} ${attrs} />`);
      }
      continue;
    }

    // Tag with text: p Hello world
    const tagTextMatch = trimmed.match(/^(\w+)\s+(.+)$/);
    if (tagTextMatch) {
      const [, tag, text] = tagTextMatch;
      jsxParts.push(`<${tag}>${text}</${tag}>`);
      continue;
    }

    // Bare tag: div
    const bareTagMatch = trimmed.match(/^(\w+)$/);
    if (bareTagMatch) {
      jsxParts.push(`<${bareTagMatch[1]} />`);
      continue;
    }

    // Fallback: emit as-is in a JSX expression container
    jsxParts.push(`{/* ${trimmed} */}`);
  }

  if (jsxParts.length === 1) return `(${jsxParts[0]})`;
  return `(<>${jsxParts.join('')}</>)`;
}

/** Replace all pug`...` occurrences in source text with JSX equivalents */
function buildShadowText(originalText: string): string | undefined {
  if (!originalText.includes('pug`')) return undefined;

  PUG_TAG_RE.lastIndex = 0;
  let hasMatch = false;
  const result = originalText.replace(PUG_TAG_RE, (_match, pugContent: string) => {
    hasMatch = true;
    return transformPugToJsx(pugContent);
  });

  return hasMatch ? result : undefined;
}

function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
  const tsModule = modules.typescript;

  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      const host = info.languageServiceHost;
      const originalGetSnapshot = host.getScriptSnapshot.bind(host);
      const originalGetVersion = host.getScriptVersion.bind(host);

      // Per-instance cache: tracks original text, shadow text, and version per file
      const docCache = new Map<string, { originalText: string; shadowText: string; version: number }>();

      host.getScriptSnapshot = (fileName: string) => {
        const original = originalGetSnapshot(fileName);
        if (!original) return original;

        const text = original.getText(0, original.getLength());
        const cached = docCache.get(fileName);

        // Return cached shadow if original text hasn't changed
        if (cached && cached.originalText === text) {
          return tsModule.ScriptSnapshot.fromString(cached.shadowText);
        }

        const shadow = buildShadowText(text);
        if (shadow) {
          docCache.set(fileName, {
            originalText: text,
            shadowText: shadow,
            version: (cached?.version ?? 0) + 1,
          });
          return tsModule.ScriptSnapshot.fromString(shadow);
        }

        // File no longer has pug templates -- clean up cache
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

      return proxy;
    },
  };
}

export = init;
