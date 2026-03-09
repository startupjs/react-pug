# @startupjs/swc-plugin-react-pug

Programmatic SWC helper for transforming `pug\`...\`` tagged template literals before passing code to SWC.

## Install

```bash
npm i -D @startupjs/swc-plugin-react-pug @swc/core
```

## Usage

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

## Options

- `tagFunction`: tagged template function name, default `pug`
- `mode`: `runtime | languageService`, default `runtime`
- `requirePugImport`: boolean, default `false`
- `classShorthandProperty`: `auto | className | class | styleName`
- `classShorthandMerge`: `auto | concatenate | classnames`
- `startupjsCssxjs`: `never | auto | force`
- `componentPathFromUppercaseClassShorthand`: boolean, default `true`

Used `pug` import bindings are removed from transformed output automatically.

## Exports

- `transformWithSwcReactPug(...)`
- `transformReactPugSourceForSwc(...)`
- diagnostic/range remapping helpers

Published output is in `dist/`.
