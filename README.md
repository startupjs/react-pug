# react-pug

Pug IntelliSense for React inside `pug\`...\`` tagged templates in VS Code.

You get JSX-like editor features inside Pug regions:

- completions
- hover
- go-to-definition
- rename/references
- diagnostics/code actions
- syntax highlighting

## Install

### Option 1: Install from VSIX (from this repo)

```bash
npm ci
npm run package
(cd packages/vscode-react-pug && npx @vscode/vsce package)
code --install-extension packages/vscode-react-pug/*.vsix
```

### Option 2: Install from Marketplace

If published in your environment, install extension id:

```bash
code --install-extension startupjs.vscode-react-pug
```

## Quick Setup

Extension activates automatically for:

- TypeScript / TSX
- JavaScript / JSX

Recommended `tsconfig.json` plugin config:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@startupjs/typescript-plugin-react-pug" }
    ]
  }
}
```

## Usage

```tsx
import { Button } from './Button'

const view = pug`
  .app
    Button(onClick=handleClick label="Click")
    if show
      p Hello #{user.name}
`
```

Command palette command:

- `Pug React: Show Shadow TSX` (opens generated shadow TSX)

Main settings:

- `pugReact.enabled` (default `true`)
- `pugReact.diagnostics.enabled` (default `true`)
- `pugReact.tagFunction` (default `"pug"`)

## Requirements

- VS Code `^1.85.0`
- TypeScript project using a runtime/build transform such as:
  - `babel-plugin-transform-react-pug`
  - `@startupjs/babel-plugin-transform-react-pug`

This extension provides editor tooling only. It does not perform runtime/build transforms.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm run test:unit
npm run test:vscode
npm test
```

Useful extras:

```bash
npm run test:vscode:demo:screenshots
npm run vscode:fresh:demo
```

## Architecture

For the detailed technical design, data flow, mappings, plugin interception strategy, and test architecture, see:

- [architecture.md](architecture.md)

## How It Works (High Level)

1. The TypeScript plugin finds `pug\`...\`` regions in your file.
2. Each Pug region is compiled into a shadow TSX representation.
3. TypeScript language service runs against that shadow text.
4. Results (completions, diagnostics, definitions, etc.) are mapped back to original Pug positions.

This keeps native TS/VS Code behavior while giving JSX-like tooling inside Pug templates.

## Supported

High-level supported Pug features:

- tags/components
- attributes and spread attributes
- class/id shorthand
- interpolation (`#{}` / `!{}`)
- line expressions (`tag= expression`)
- conditionals (`if / else if / else`)
- loops (`each`, `while`)
- code lines (`- ...`)
- text nodes and piped text (`|`)

## Known Limitations

- JavaScript `${}` interpolation inside `pug\`...\`` is not supported; use Pug `#{}`.
- This extension provides editor tooling only (not runtime/build-time transform).
- In heavily malformed in-progress edits, temporary IntelliSense mapping may be approximate until syntax stabilizes.
