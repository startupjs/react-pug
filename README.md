# react-pug

Pug support for React in two parts:

- VS Code IntelliSense inside `pug\`...\`` templates
- Build/lint transforms for Babel, SWC, esbuild, and ESLint

## Install

### VS Code extension (from this repo)

```bash
npm ci
npm run package:vsix
code --install-extension packages/vscode-react-pug-tsx/*.vsix
```

Extension id:

```bash
code --install-extension startupjs.vscode-react-pug-tsx
```

## Runtime/Build Packages

Published package names:

- `@startupjs/react-pug-core`
- `@startupjs/typescript-plugin-react-pug`
- `vscode-react-pug-tsx`
- `@startupjs/babel-plugin-react-pug`
- `@startupjs/swc-plugin-react-pug`
- `@startupjs/esbuild-plugin-react-pug`
- `@startupjs/eslint-plugin-react-pug`

### Babel

```js
// babel.config.js
module.exports = {
  plugins: [
    ['@startupjs/babel-plugin-react-pug', {
      tagFunction: 'pug',
      sourceMaps: 'basic',
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
import { transformWithSwcReactPug } from '@startupjs/swc-plugin-react-pug'

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
import { reactPugEsbuildPlugin } from '@startupjs/esbuild-plugin-react-pug'

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
import reactPugPlugin from '@startupjs/eslint-plugin-react-pug'

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
- `pugReact.injectCssxjsTypes`: `never | auto | force`
- `pugReact.classShorthandProperty`: `auto | className | class | styleName`
- `pugReact.classShorthandMerge`: `auto | concatenate | classnames`
- `pugReact.componentPathFromUppercaseClassShorthand`: `boolean` (default `true`)

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

1. `@startupjs/react-pug-core` finds tagged templates and compiles Pug regions.
2. For editor tooling, the TS plugin builds a shadow document and remaps LS results.
3. For build/lint tooling, compiler adapters transform source and remap diagnostics to original Pug ranges.

## Supported

- tags/components
- attrs and spread attrs
- class/id shorthand
- interpolation: `#{}`, `!{}`, and `${}` (including nested `pug`)
- line expressions: `tag= expression`
- control flow: `if`, `else if`, `else`, `each`, `while`, `case/when`
- unbuffered code: `- ...`
- text nodes and `|` piped text

## Known Limitations

- VS Code extension currently targets desktop extension host (not web extension host).
- During heavily malformed in-progress edits, temporary mapping can be approximate until syntax stabilizes.
- Babel `sourceMaps: 'basic'` is compatibility-first and does not preserve fine-grained mappings within a transformed Pug region. Surrounding non-Pug JS/TS code keeps normal Babel mappings. Use `sourceMaps: 'detailed'` when you need granular Babel source maps inside Pug.

## Architecture

Detailed design and package internals:

- [architecture.md](architecture.md)
