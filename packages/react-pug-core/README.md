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

## Intended Audience

Most users should use one of the higher-level packages instead of consuming this package directly.

Use this package directly if you are building:

- an editor integration
- a custom compiler adapter
- a lint/diagnostic pipeline that needs original Pug positions

## Notes

Published output is in `dist/`.
