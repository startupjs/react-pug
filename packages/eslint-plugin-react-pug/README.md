# @startupjs/eslint-plugin-react-pug

ESLint processor for linting files that contain `pug\`...\`` tagged template literals.

## Install

```bash
npm i -D @startupjs/eslint-plugin-react-pug eslint
```

## Usage

```js
import reactPugPlugin from '@startupjs/eslint-plugin-react-pug'

export default [
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-pug': reactPugPlugin },
    processor: 'react-pug/pug-react'
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

Used `pug` import bindings are removed from the processor's transformed view automatically.

## Exports

- default ESLint plugin object
- `createReactPugProcessor(...)`

Published output is in `dist/`.
