# @startupjs/babel-plugin-react-pug

Babel plugin for transforming `pug\`...\`` tagged template literals in React code.

## Install

```bash
npm i -D @startupjs/babel-plugin-react-pug
```

## Usage

```js
module.exports = {
  plugins: [
    ['@startupjs/babel-plugin-react-pug', {
      tagFunction: 'pug',
      sourceMaps: 'detailed',
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
- `classShorthandProperty`: `auto | className | class | styleName`
- `classShorthandMerge`: `auto | concatenate | classnames`
- `startupjsCssxjs`: `never | auto | force`
- `componentPathFromUppercaseClassShorthand`: boolean, default `true`

## Exports

- default Babel plugin
- `transformReactPugSourceForBabel(...)`
- `mapBabelGeneratedDiagnosticToOriginal(...)`

Published output is in `dist/`.
