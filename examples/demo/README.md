# Pug React Demo

A minimal React + TypeScript project demonstrating the `vscode-pug-react` extension.

## Features demonstrated

- **Typed props** -- `Button` and `Card` components with TypeScript interfaces
- **Event handlers** -- `onClick`, `onChange` with proper types
- **Conditional rendering** -- `if/else` blocks in pug
- **List rendering** -- `each` loops over arrays
- **Nested components** -- Components inside components
- **Interpolation** -- `#{expression}` for inline values

## Testing the extension

1. Open this folder in VS Code
2. Install the `vscode-pug-react` extension
3. Open `src/App.tsx`
4. Try:
   - **Hover** over `Button` or `Card` to see type info
   - **Ctrl+click** (or Cmd+click) on a component name to go to its definition
   - **Type a prop name** inside a component call to get autocomplete
   - **Rename** a variable (F2) used inside a pug template
   - **Run "Pug React: Show Shadow TSX"** from the command palette to see the generated JSX

## Setup (optional, for running the app)

```bash
npm install
npm run dev
```

Note: Running the app requires a bundler plugin that transforms `pug` tagged
templates at build time. The extension provides IntelliSense only -- it does
not transform code at runtime.
