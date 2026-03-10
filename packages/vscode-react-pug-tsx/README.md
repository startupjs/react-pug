# vscode-react-pug-tsx

VS Code extension that provides JSX-grade IntelliSense for `pug\`...\`` tagged template literals in React projects.

## Install

Use the VS Code Marketplace build when available, or package/install from the repo:

```bash
npm ci
npm run package:vsix
code --install-extension packages/vscode-react-pug-tsx/*.vsix
```

Embedded `style(...)` editor support notes:

- `css` and `scss` work with built-in VS Code support
- `styl` requires `sysoev.language-stylus`
- `sass` requires `Syler.sass-indented` because built-in VS Code CSS support does not handle indented Sass syntax

Extension id:

```text
startupjs.vscode-react-pug-tsx
```

## Features

- completions, hover, diagnostics, and go-to-definition inside Pug sections
- syntax highlighting for embedded Pug regions
- embedded `style(lang='css' | 'scss' | 'styl' | 'sass')` blocks
- shadow TSX view for debugging mappings
- automatic wiring of `@startupjs/typescript-plugin-react-pug` into the VS Code TypeScript host

## Settings

- `pugReact.enabled`
- `pugReact.diagnostics.enabled`
- `pugReact.tagFunction`
- `pugReact.requirePugImport`
- `pugReact.injectCssxjsTypes`
- `pugReact.classShorthandProperty`
- `pugReact.classShorthandMerge`
- `pugReact.componentPathFromUppercaseClassShorthand`

The extension removes used `pug` imports from its shadow TSX view automatically, so importing `pug` from `startupjs`/`cssxjs` does not produce a false unused-import diagnostic. Enable `pugReact.requirePugImport` if you want explicit imports enforced in the editor.

This npm package is the extension source/bundle package. End users normally install the VS Code extension, not the npm tarball directly.
