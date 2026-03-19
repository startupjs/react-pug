# @react-pug/is-expression

Validates a string as a JavaScript, TypeScript, or JSX expression.

[![Build Status](https://img.shields.io/github/workflow/status/pugjs/is-expression/Test/master)](https://github.com/pugjs/is-expression/actions?query=branch%3Amaster+workflow%3ATest)
[![Dependency Status](https://img.shields.io/david/pugjs/is-expression.svg)](https://david-dm.org/pugjs/is-expression)
[![Rolling Versions](https://img.shields.io/badge/Rolling%20Versions-Enabled-brightgreen)](https://rollingversions.com/pugjs/is-expression)
[![npm version](https://img.shields.io/npm/v/is-expression.svg)](https://www.npmjs.org/package/is-expression)

## Installation

    npm install @react-pug/is-expression

## Usage

### `isExpression(src[, options])`

Validates a string as a JavaScript, TypeScript, or JSX expression.

`src` contains the source.

`options` currently supports:

- `throw`: Throw the parser error if the string is not a valid expression.
  Defaults to `false`.

## Examples

```js
var isExpression = require('@react-pug/is-expression')

isExpression('myVar')
//=> true
isExpression('var')
//=> false
isExpression('["an", "array", "\'s"].indexOf("index")')
//=> true

isExpression('value as string')
//=> true

isExpression('<Button label="ok" />')
//=> true

isExpression('abc // my comment')
//=> true

isExpression('var', {throw: true})
// SyntaxError: Unexpected token (1:0)
```

## Notes

- This package is maintained in the `react-pug` monorepo.
- It intentionally validates modern JavaScript, TypeScript, and JSX expression syntax.
- This fork reset version numbering under the `@react-pug/*` namespace, so `0.1.6` is newer than the old upstream-style `4.x` line used before vendoring.

## Attribution

This package is derived from the original `pugjs/is-expression` project:

https://github.com/pugjs/is-expression

## License

MIT
