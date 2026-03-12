# @react-pug/esbuild-plugin-react-pug

esbuild plugin for transforming `pug\`...\`` tagged template literals in React code.

## Install

```bash
npm i -D @react-pug/esbuild-plugin-react-pug esbuild
```

## Usage

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

## Options

- `tagFunction`: tagged template function name, default `pug`
- `include`: file filter regexp
- `exclude`: file exclusion regexp
- `requirePugImport`: boolean, default `false`
- `classShorthandProperty`: `auto | className | class | styleName`
- `classShorthandMerge`: `auto | concatenate | classnames`
- `startupjsCssxjs`: `never | auto | force`
- `componentPathFromUppercaseClassShorthand`: boolean, default `true`

Used `pug` import bindings are removed from transformed output automatically.

## Exports

- `reactPugEsbuildPlugin(...)`
- `transformReactPugSourceForEsbuild(...)`
- diagnostic/range remapping helpers

Published output is in `dist/`.
