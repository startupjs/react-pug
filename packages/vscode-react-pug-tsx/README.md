# vscode-react-pug-tsx

VS Code extension that provides JSX-grade IntelliSense for `pug\`...\`` tagged template literals in React projects.

## Install

Use the VS Code Marketplace build when available, or package/install from the repo:

```bash
npm ci
npm run package:vsix
code --install-extension packages/vscode-react-pug-tsx/*.vsix
```

Extension id:

```text
startupjs.vscode-react-pug-tsx
```

## Features

- completions, hover, diagnostics, and go-to-definition inside Pug sections
- syntax highlighting for embedded Pug regions
- shadow TSX view for debugging mappings
- automatic wiring of `@startupjs/typescript-plugin-react-pug` into the VS Code TypeScript host

## Settings

- `pugReact.enabled`
- `pugReact.diagnostics.enabled`
- `pugReact.tagFunction`
- `pugReact.injectCssxjsTypes`
- `pugReact.classShorthandProperty`
- `pugReact.classShorthandMerge`
- `pugReact.componentPathFromUppercaseClassShorthand`

This npm package is the extension source/bundle package. End users normally install the VS Code extension, not the npm tarball directly.
