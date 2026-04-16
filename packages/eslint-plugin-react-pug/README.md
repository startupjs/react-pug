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
- formatting diagnostics for those embedded expression sites are linted against source-faithful JS wrappers rather than only against generated JSX
- autofixes and suggestions for those embedded expression sites are mapped back to the original Pug source
- diagnostics caused only by synthetic generated helper code are filtered out
- the formatter tries to converge to the consuming project's own `@stylistic` setup when that package is available locally

Current limitation:

- multiline unbuffered `- ...` statements that are authored across several Pug lines do not yet get the same source-faithful formatting-diagnostic surface as embedded expression sites
- diagnostics that arise only on the generated JSX surface of a transformed Pug region still do not map autofixes back; those remain report-only unless they come from an embedded source-faithful JS site
- the internal formatter still relies on deprecated `@stylistic/jsx-indent` / `@stylistic/jsx-indent-props` compatibility rules, so some dependency graphs may emit a one-time deprecation warning during an ESLint run

## Exports

- default ESLint plugin object
- `createReactPugProcessor(...)`

Published output is in `dist/`.
