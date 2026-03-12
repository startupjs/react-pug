# react-pug

Pug support for React in two parts:

- VS Code IntelliSense inside `pug\`...\`` templates
- Build/lint transforms for Babel, SWC, esbuild, and ESLint

## Install

### VS Code extension (build from this repo for now)

For now, clone the monorepo and run the following commands from the repository root:

```bash
npm ci
npm run package:vsix
code --install-extension .tmp/vsix/vscode-react-pug-tsx.vsix
```

Or, to build and install in one step:

```bash
npm ci
npm run install:vsix
```

This builds the VSIX from the monorepo into `.tmp/vsix/`, keeps a stable install path at `.tmp/vsix/vscode-react-pug-tsx.vsix`, and installs it locally into VS Code.

For embedded editor support inside `style(...)` blocks:

- `css` and `scss` work with built-in VS Code support
- `styl` requires the VS Code extension `sysoev.language-stylus`
- `sass` requires the VS Code extension `Syler.sass-indented`, since built-in VS Code CSS support does not handle indented Sass syntax

### VS Code Marketplace

TODO: publish `startupjs.vscode-react-pug-tsx` to the VS Code Marketplace.

After that, installation by extension id will also work:

```bash
code --install-extension startupjs.vscode-react-pug-tsx
```

## Runtime/Build Packages

Published package names:

- `@react-pug/react-pug-core`
- `@react-pug/typescript-plugin-react-pug`
- `vscode-react-pug-tsx`
- `@react-pug/babel-plugin-react-pug`
- `@react-pug/swc-plugin-react-pug`
- `@react-pug/esbuild-plugin-react-pug`
- `@react-pug/eslint-plugin-react-pug`

### Babel

```js
// babel.config.js
module.exports = {
  plugins: [
    ['@react-pug/babel-plugin-react-pug', {
      tagFunction: 'pug',
      sourceMaps: 'basic',
      requirePugImport: false,
      classShorthandProperty: 'auto',
      classShorthandMerge: 'auto',
      startupjsCssxjs: 'auto',
      componentPathFromUppercaseClassShorthand: true
    }]
  ]
}
```

Babel source map modes:

- `sourceMaps: 'basic'` (default) keeps Babel on the simple AST replacement path, replaces only matched `pug` tagged-template expressions during `Program` traversal, and produces coarse mappings for transformed Pug regions while leaving surrounding JS/TS mappings Babel-native.
- `sourceMaps: 'detailed'` enables granular mappings back into Pug content by using Babel `parserOverride` plus an inline input source map. Use this when you care about devtools/debugger fidelity through later Babel transforms.

### SWC (programmatic)

```ts
import { transformWithSwcReactPug } from '@react-pug/swc-plugin-react-pug'

const result = transformWithSwcReactPug(sourceCode, fileName, {
  jsc: {
    parser: { syntax: 'typescript', tsx: true },
    transform: { react: { runtime: 'automatic' } }
  },
  sourceMaps: true
})
```

### esbuild

```ts
import { build } from 'esbuild'
import { reactPugEsbuildPlugin } from '@react-pug/esbuild-plugin-react-pug'

await build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  plugins: [reactPugEsbuildPlugin()],
  sourcemap: true
})
```

### ESLint processor

```js
// eslint.config.js (flat config)
import reactPugPlugin from '@react-pug/eslint-plugin-react-pug'

export default [
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-pug': reactPugPlugin },
    processor: 'react-pug/pug-react'
  }
]
```

## VS Code Settings

- `pugReact.enabled`
- `pugReact.diagnostics.enabled`
- `pugReact.tagFunction`
- `pugReact.requirePugImport`: `boolean` (default `false`)
- `pugReact.injectCssxjsTypes`: `never | auto | force`
- `pugReact.classShorthandProperty`: `auto | className | class | styleName`
- `pugReact.classShorthandMerge`: `auto | concatenate | classnames`
- `pugReact.componentPathFromUppercaseClassShorthand`: `boolean` (default `true`)

Import handling:

- used `pug` imports are removed automatically from transformed output and shadow documents
- when `requirePugImport` is enabled, using the configured tag without an explicit import is treated as an error
- when a terminal `style` block is used, `pug` must be imported so the matching `css`/`styl`/`sass`/`scss` helper can be resolved from the same module

Class shorthand behavior:

- default auto: `className` + string concatenation
- auto with `startupjs`/`cssxjs` marker: `styleName` + classnames-style array merge

## Development

```bash
npm ci
npm run typecheck
npm run build
npm run test:core
npm run test:ts-plugin
npm run test:vscode
npm test
```

If you are working in an environment with `NODE_ENV=production`, install dev dependencies explicitly:

```bash
npm ci --include=dev
```

Useful:

```bash
npm run test:vscode:example:screenshots
npm run vscode:fresh:example
npm run check:pug:example
```

Pug-aware CI type check for a target project (without VS Code UI):

```bash
node scripts/check-pug-types.mjs <project-dir>
```

## How It Works (High Level)

1. `@react-pug/react-pug-core` finds tagged templates and compiles Pug regions.
2. For editor tooling, the TS plugin builds a shadow document and remaps LS results.
3. For build/lint tooling, compiler adapters transform source and remap diagnostics to original Pug ranges.

## Embedded Style Blocks

Terminal `style` blocks can be embedded at the end of a `pug` template:

```pug
pug`
  .title Hello
  style(lang='styl')
    .title
      color red
`
```

Behavior:

- `style` defaults to `css`
- supported langs: `css`, `styl`, `sass`, `scss`
- the `style` block must be the last top-level node in the template
- its content is moved to the top of the immediate enclosing scope as `css```, `styl```, `sass``` or `scss``` and keeps `${...}` interpolations intact
- target scope selection:
  - nearest enclosing block scope
  - expression-bodied arrow functions are rewritten so the helper call can be inserted before the returned expression
  - single-line `if` / `else` / loop statement bodies are normalized into blocks when needed so the helper call can be inserted before the original statement
  - `Program` scope inserts right after the last import or directive
- the helper import is added from the same module as the file's `pug` import unless it already exists

## Supported

- tags/components
- attrs and spread attrs
- class/id shorthand
- interpolation: `#{}`, `!{}`, and `${}` (including nested `pug`)
- line expressions: `tag= expression`
- control flow: `if`, `else if`, `else`, `each`, `while`, `case/when`
- unbuffered code: `- ...`
- text nodes and `|` piped text
- terminal `style` blocks with embedded CSS/SCSS editor support, plus Stylus/Sass when the corresponding VS Code language extension is installed

## Known Limitations

- VS Code extension currently targets desktop extension host (not web extension host).
- During heavily malformed in-progress edits, temporary mapping can be approximate until syntax stabilizes.
- Babel `sourceMaps: 'basic'` is compatibility-first and does not preserve fine-grained mappings within a transformed Pug region. Surrounding non-Pug JS/TS code keeps normal Babel mappings. Use `sourceMaps: 'detailed'` when you need granular Babel source maps inside Pug.
- Embedded Stylus editor IntelliSense depends on the external VS Code Stylus extension being installed.
- Embedded Sass editor IntelliSense/highlighting depends on the VS Code extension `Syler.sass-indented` being installed. Built-in VS Code CSS support handles `css` and `scss`, but not indented `sass`.

## Architecture

Detailed design and package internals:

- [architecture.md](architecture.md)
