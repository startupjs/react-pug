# @react-pug/babel-plugin-react-pug

Babel plugin for transforming `pug\`...\`` tagged template literals in React code.

## Install

```bash
npm i -D @react-pug/babel-plugin-react-pug
```

## Usage

```js
module.exports = {
  plugins: [
    ['@react-pug/babel-plugin-react-pug', {
      tagFunction: 'pug',
      sourceMaps: 'detailed',
      requirePugImport: false,
      classShorthandProperty: 'auto',
      classShorthandMerge: 'auto',
      startupjsCssxjs: 'auto',
      componentPathFromUppercaseClassShorthand: true
    }]
  ]
}
```

## Options

- `tagFunction`: tagged template function name, default `pug`
- `mode`: `runtime | languageService`, default `runtime`
- `sourceMaps`: `basic | detailed`, default `basic`
- `requirePugImport`: boolean, default `false`
- `classShorthandProperty`: `auto | className | class | styleName`
- `classShorthandMerge`: `auto | concatenate | classnames`
- `startupjsCssxjs`: `never | auto | force`
- `componentPathFromUppercaseClassShorthand`: boolean, default `true`

When a `pug` import is present and used only for tagged templates, the plugin removes that binding from transformed output. If it was the only specifier in the declaration, the import is rewritten to a side-effect import to preserve module evaluation.

## Exports

- default Babel plugin
- `transformReactPugSourceForBabel(...)`
- `mapBabelGeneratedDiagnosticToOriginal(...)`

Published output is in `dist/`.
