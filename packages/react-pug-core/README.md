# @startupjs/react-pug-core

Shared transformation and mapping engine for the `react-pug` toolchain.

This package is the low-level core used by:

- `@startupjs/typescript-plugin-react-pug`
- `@startupjs/babel-plugin-react-pug`
- `@startupjs/swc-plugin-react-pug`
- `@startupjs/esbuild-plugin-react-pug`
- `@startupjs/eslint-plugin-react-pug`

## Install

```bash
npm i @startupjs/react-pug-core
```

## What It Provides

- extraction of `pug\`...\`` template regions from JS/TS files
- compilation of Pug to JSX/TSX-compatible output
- shadow document generation for editor tooling
- source range and diagnostic remapping back to original Pug locations
- compiler-facing source map generation for downstream transforms

## Main Exports

- `transformSourceFile(...)`
- `buildShadowDocument(...)`
- `createTransformSourceMap(...)`
- mapping helpers from `mapping`, `positionMapping`, and `diagnosticMapping`

## Common Options

Core transforms expose:

- `tagFunction`: tagged template function name, default `pug`
- `requirePugImport`: boolean, default `false`
- `removeTagImport`: boolean, default `true`
- `classShorthandProperty`: `auto | className | class | styleName`
- `classShorthandMerge`: `auto | concatenate | classnames`
- `startupjsCssxjs`: `never | auto | force`
- `componentPathFromUppercaseClassShorthand`: boolean, default `true`

When `removeTagImport` is enabled, used `pug` imports are removed from transformed/shadow output. If the removed specifier was the only runtime import from that module, the declaration is rewritten to a side-effect import.

## Intended Audience

Most users should use one of the higher-level packages instead of consuming this package directly.

Use this package directly if you are building:

- an editor integration
- a custom compiler adapter
- a lint/diagnostic pipeline that needs original Pug positions

## Notes

Published output is in `dist/`.
