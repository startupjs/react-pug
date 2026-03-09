# @startupjs/typescript-plugin-react-pug

TypeScript language-service plugin for `pug\`...\`` tagged template literals in React files.

## Install

```bash
npm i -D @startupjs/typescript-plugin-react-pug
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@startupjs/typescript-plugin-react-pug" }
    ]
  }
}
```

## Important

This is a TypeScript language-service plugin. It is used by editor hosts such as VS Code TypeScript support. Plain `tsc` does not execute language-service plugins during a normal CLI build.

For VS Code users, the `vscode-react-pug-tsx` extension already wires this plugin into the editor host.

## Config Options

The plugin accepts the same core options exposed by the VS Code extension:

- `enabled`
- `diagnostics.enabled`
- `tagFunction`
- `injectCssxjsTypes`: `never | auto | force`
- `classShorthandProperty`: `auto | className | class | styleName`
- `classShorthandMerge`: `auto | concatenate | classnames`
- `componentPathFromUppercaseClassShorthand`: boolean

Published output is in `dist/`.
