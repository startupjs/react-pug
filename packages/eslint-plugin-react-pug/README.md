# @react-pug/eslint-plugin-react-pug

ESLint processor for linting files that contain `pug\`...\`` tagged template literals.

## Install

```bash
npm i -D @react-pug/eslint-plugin-react-pug eslint
```

## Usage

```js
import reactPugPlugin from '@react-pug/eslint-plugin-react-pug'

export default [
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-pug': reactPugPlugin },
    processor: 'react-pug/react-pug'
  }
]
```

## Options

Use `createReactPugProcessor(...)` when you need custom options:

- `tagFunction`
- `requirePugImport`
- `classShorthandProperty`
- `classShorthandMerge`
- `startupjsCssxjs`
- `componentPathFromUppercaseClassShorthand`
- `jsxInJsFiles`

`jsxInJsFiles: 'always'` forces `.js` / `.mjs` / `.cjs` files onto the
processor's virtual `.jsx` lint path. Use this if your ESLint config already
treats JS files as JSX-capable and you want to skip JSX auto-detection.

Used `pug` import bindings are removed from the processor's transformed view automatically.

## Linting Contract

The processor is designed to preserve useful JavaScript/TypeScript diagnostics inside Pug regions:

- real JS/TS rule violations inside `#{...}`, `${...}`, `tag= ...`, attribute expressions, and inline handler/function bodies are reported back at the original Pug location
- diagnostics caused only by synthetic generated helper code are filtered out
- the formatter tries to converge to the consuming project's own `@stylistic` setup when that package is available locally

Current limitation:

- purely formatting-only, auto-fixable source mistakes inside nested expression sites such as `${...}` can be normalized away by the processor's generated-JSX formatting pass instead of being reported back as original-source indent/style diagnostics
- autofixes and suggestions are currently not mapped back for files that contain transformed Pug regions, so transformed-region diagnostics are report-only today

That means semantic errors and real rule violations inside embedded JS should still surface, but some raw source-formatting mistakes inside embedded Pug expression blocks are not yet part of the processor's reported lint contract.

## Exports

- default ESLint plugin object
- `createReactPugProcessor(...)`

Published output is in `dist/`.
