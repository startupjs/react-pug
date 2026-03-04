# Pug React IntelliSense

**JSX-grade IntelliSense for `pug` tagged template literals in React projects.**

Write Pug templates inside your TypeScript/JavaScript files and get the same editor experience as writing JSX directly — completions, hover, go-to-definition, rename, diagnostics, and more.

```tsx
import { Button } from './Button'

const App = () => {
  const handler = () => console.log('clicked')

  return pug`
    .container
      h1 Hello World
      Button(onClick=handler, label="Click me")
      if isLoggedIn
        p Welcome back!
      each item in items
        li(key=item.id)= item.name
  `
}
```

## Features

### Autocomplete

Type a component name or prop and get full IntelliSense — component names, typed props, event handlers, and intrinsic HTML attributes.

### Hover

Hover over any identifier inside a pug template to see its TypeScript type information, just like in JSX.

### Go to Definition

Ctrl+click (Cmd+click on macOS) on a component name, variable, or prop to navigate to its definition.

### Diagnostics

Type errors inside pug templates are reported at the correct position. Pug parse errors are shown inline with meaningful spans.

### Rename Symbol

Press F2 on a variable or prop used inside pug — all references across pug and TypeScript code are updated together.

### Find References

Right-click and "Find All References" works across pug/TypeScript boundaries.

### Signature Help

When calling a function inside a pug attribute, parameter hints appear automatically.

### Code Actions & Refactoring

Quick fixes and refactoring suggestions from TypeScript work through pug templates.

### Syntax Highlighting

Pug syntax inside tagged template literals is highlighted via TextMate grammar injection. Works in `.ts`, `.tsx`, `.js`, and `.jsx` files.

### Show Shadow TSX

Run **"Pug React: Show Shadow TSX"** from the command palette to see the generated JSX that powers IntelliSense. Useful for debugging.

## Requirements

- **VS Code** 1.85.0 or later
- **TypeScript** 5.x (workspace or bundled)
- A project using [`babel-plugin-transform-react-pug`](https://github.com/nicktomlin/babel-plugin-transform-react-pug) or [`@startupjs/babel-plugin-transform-react-pug`](https://github.com/nicktomlin/babel-plugin-transform-react-pug) for build-time pug-to-JSX transformation

The extension provides **editor IntelliSense only** — it does not transform code at build time. You still need the Babel plugin in your build pipeline.

## Installation

### From VS Code Marketplace

Search for **"Pug React IntelliSense"** in the Extensions view and install.

### From VSIX

```bash
# Build the extension
npm install
npm run build

# Package (requires @vscode/vsce)
npx @vscode/vsce package

# Install
code --install-extension vscode-react-pug-0.0.1.vsix
```

## Setup

**Zero configuration required.** The extension activates automatically for TypeScript, TypeScriptReact, JavaScript, and JavaScriptReact files.

For the best experience, add the TypeScript plugin to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@startupjs/typescript-plugin-react-pug" }
    ]
  }
}
```

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pugReact.enabled` | boolean | `true` | Enable/disable the extension |
| `pugReact.diagnostics.enabled` | boolean | `true` | Enable/disable pug parse error diagnostics |
| `pugReact.tagFunction` | string | `"pug"` | Tag function name to recognize (if you alias the import) |

### Custom tag function

If your project uses a different name for the pug tag function:

```ts
// In your code
const html = pug  // aliased
const view = html`div Hello`
```

```json
// In VS Code settings
{
  "pugReact.tagFunction": "html"
}
```

## Supported Pug Syntax

The extension supports the same Pug subset as `babel-plugin-transform-react-pug`:

| Construct | Example | Notes |
|-----------|---------|-------|
| Tags | `div`, `Button`, `MyComponent` | Intrinsic elements and components |
| Classes | `.card`, `.foo.bar` | Shorthand for `className` |
| IDs | `#main`, `div#app` | Shorthand for `id` |
| Attributes | `Button(onClick=handler, disabled)` | Expression and boolean attributes |
| Spread | `div(...props)` | JSX spread attributes |
| Text | `p Hello world` | Plain text content |
| Interpolation | `p Hello #{name}` | Pug-style expression interpolation |
| Buffered code | `span= expression` | Expression as text content |
| Conditionals | `if` / `else if` / `else` | Compiles to ternary expressions |
| Loops | `each item, i in items` | Compiles to `.map()` |
| While | `while condition` | IIFE-wrapped loop |
| Case/When | `case val` / `when "a"` / `default` | Chained ternaries |
| Code blocks | `- const x = 10` | Unbuffered JavaScript |
| Multiple roots | Two sibling root elements | Wrapped in `<>...</>` fragment |

### Not supported

- `${}` template interpolation inside pug (use Pug's `#{}` syntax instead)
- Template literals nested inside pug expressions
- Pug includes, extends, and mixins (use React components instead)

## How It Works

The extension uses a **TypeScript plugin** that runs inside VS Code's built-in TypeScript server (tsserver). It works by:

1. **Detecting** `pug` tagged template literals in your source files using `@babel/parser`
2. **Compiling** each pug template to equivalent JSX/TSX with precise source mappings
3. **Serving** a "shadow" version of your file to TypeScript where pug regions are replaced with JSX
4. **Mapping** all IntelliSense responses (completions, hover, diagnostics, etc.) back to the original pug positions

This approach (inspired by [Vue's Volar](https://github.com/vuejs/language-tools)) means:
- No duplicate TypeScript language service — works within the existing tsserver
- No conflict with VS Code's built-in TypeScript features
- Module resolution, path aliases, and project references work automatically
- Zero-config for most projects

## Example Project

See [`examples/demo/`](examples/demo/) for a minimal React + TypeScript project demonstrating all extension features.

## Commands

| Command | Description |
|---------|-------------|
| `Pug React: Show Shadow TSX` | Opens the generated shadow TSX in a side-by-side editor |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run unit/integration tests (Vitest)
npm run test:unit

# Run all tests (unit + VS Code extension-host)
npm test

# Run extension-host tests in fresh VS Code
npm run test:vscode

# Run extension-host tests for a specific workspace
npm run test:vscode:demo

# Run extension-host tests with desktop screenshots captured at each step
npm run test:vscode:demo:screenshots

# Type check
npm run typecheck

# Watch mode
npm run watch
```

When screenshot capture is enabled, artifacts are written to `artifacts/vscode-screenshots/<workspace>/` with a `.png` image and matching `.json` state file per step.

### Project Structure

```
packages/
  react-pug-core/
    src/language/        Core logic (framework-agnostic)
      extractRegions.ts  Find pug tagged template literals via @babel/parser
      pugToTsx.ts        Pug-to-TSX compiler with source mappings
      shadowDocument.ts  Build shadow document (replace pug with JSX)
      positionMapping.ts Bidirectional offset mapping
      mapping.ts         Core types (PugRegion, PugDocument, CodeMapping)
    test/               Core unit/integration tests
  typescript-plugin-react-pug/
    src/index.ts         TypeScript plugin (host patching, LS method proxying)
    test/               Plugin unit/integration tests + fixtures
  vscode-react-pug/
    src/index.ts         VS Code extension (activation, commands)
    syntaxes/
      pug-template-literal.json
    test/
      unit/             Extension + grammar + build tests
      vscode/           Real VS Code extension-host tests + screenshot helper
examples/
  demo/                  Example React project
```

### Testing

The project has 560 tests across 25 test files covering:

- Region extraction with `@babel/parser` (edge cases, error recovery, custom tag names)
- Pug-to-TSX compilation (all constructs, source mappings, control flow)
- Shadow document generation (multi-region, offset deltas, parse errors)
- Position mapping (bidirectional, boundary conditions, binary search)
- All 20 TypeScript language service method overrides
- Diagnostics filtering (suppressed false positives, error spans, mapped lengths)
- Configuration settings (enabled, diagnostics, tagFunction)
- JS/JSX file support
- Error handling (graceful fallback on all failure modes)
- Extension commands (Show Shadow TSX)
- Build pipeline (output validity, source maps, externals)

## Known Limitations

- **No `${}` interpolation**: JavaScript template interpolation inside pug is not supported. Use Pug's `#{expression}` syntax. A diagnostic is shown if `${}` is detected.
- **No Pug mixins/includes**: Use React components instead. The extension supports the same Pug subset as the Babel plugin.
- **Attribute value offsets**: In rare cases with deeply nested multiline attribute expressions, the diagnostic underline may be slightly offset.
- **Performance on very large files**: Files with many pug templates (10+) may have slightly slower IntelliSense on first load. Subsequent edits use caching.

## License

MIT

## Credits

Built with:
- [TypeScript](https://www.typescriptlang.org/) language service plugin API
- [@babel/parser](https://babeljs.io/docs/babel-parser) for AST-based region extraction
- [@startupjs/pug-lexer](https://github.com/nicktomlin/babel-plugin-transform-react-pug) + [pug-parser](https://github.com/pugjs/pug) for Pug compilation
- [@volar/source-map](https://github.com/vuejs/language-tools) for bidirectional offset mapping
- Architectural pattern inspired by [Vue Language Tools (Volar)](https://github.com/vuejs/language-tools)
