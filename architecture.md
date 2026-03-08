# Architecture: `react-pug`

## 1. Scope

`react-pug` is a workspace monorepo that provides:

- editor IntelliSense for `pug\`...\`` in VS Code
- source transforms for build/lint pipelines (Babel, SWC, esbuild, ESLint)
- shared source mapping utilities so diagnostics map back to original Pug text

Supported source file kinds:

- `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`

---

## 2. Workspace Layout

```
packages/
  react-pug-core/
  typescript-plugin-react-pug/
  vscode-react-pug-tsx/
  babel-plugin-react-pug/
  swc-plugin-react-pug/
  esbuild-plugin-react-pug/
  eslint-plugin-react-pug/
```

Top-level orchestration files:

- `esbuild.config.mjs` build pipeline (extension + ts plugin bundles)
- `package.json` workspace scripts
- `vitest.config.ts` test discovery
- `.github/workflows/ci.yml` CI jobs
- `scripts/check-pug-types.mjs` project-level pug-aware checker

---

## 3. Package Responsibilities

### 3.1 `@startupjs/react-pug-core`

Shared language/compiler core:

- extract tagged template regions
- compile Pug AST into JSX/TSX fragments
- assemble transformed file output
- produce mapping metadata for offset/range remapping
- expose helpers for line/column conversions

Core entry points used across packages:

- `extractPugRegions(...)`
- `compilePugToTsx(...)`
- `buildShadowDocument(...)`
- `transformSourceFile(...)`
- `mapGeneratedRangeToOriginal(...)`
- `mapGeneratedDiagnosticToOriginal(...)`

### 3.2 `@startupjs/typescript-plugin-react-pug`

TypeScript language-service plugin:

- patches `LanguageServiceHost` snapshots/versions
- serves shadow documents to tsserver
- remaps all returned positions/spans/edits to original Pug source
- injects optional cssxjs/startupjs React attribute types in TS/TSX mode

### 3.3 `vscode-react-pug-tsx`

VS Code extension host package:

- contributes tsserver plugin registration
- contributes grammar injection for Pug template literals
- contributes `pugReact.*` settings
- provides `Pug React: Show Shadow TSX` command for debugging

### 3.4 `@startupjs/babel-plugin-react-pug`

Babel transform adapter:

- rewrites `pug\`...\`` via `react-pug-core` runtime mode
- supports `sourceMaps: 'basic' | 'detailed'`
- `basic` mode parses region-level replacement expressions and swaps only matched `pug` tagged-template expressions during `Program` traversal
- `detailed` mode uses `parserOverride` plus an inline input source map so later Babel transforms can compose mappings back to original Pug offsets
- stores transform metadata on Babel file for downstream remapping

### 3.5 `@startupjs/swc-plugin-react-pug`

SWC adapter utilities:

- pretransform with `react-pug-core`
- optional convenience wrapper around `@swc/core.transformSync`
- generated->original mapping helpers

### 3.6 `@startupjs/esbuild-plugin-react-pug`

esbuild plugin:

- `onLoad` interception for JS/TS sources
- runtime-safe source transform
- loader inference by extension
- diagnostic/range remapping helpers using esbuild-style line/column inputs

### 3.7 `@startupjs/eslint-plugin-react-pug`

ESLint processor:

- preprocess transform before linting
- postprocess location remap back to original files
- supports autofix message flow

---

## 4. Core Compilation Pipeline

### 4.1 Region Extraction

`extractRegions.ts` parses source with Babel parser and finds `TaggedTemplateExpression` nodes whose tag matches configured `tagFunction` (default: `pug`).

Fallback regex extraction is used when AST parse fails.

### 4.2 Pug Parsing and Emission

`pugToTsx.ts` pipeline:

1. lex (`@startupjs/pug-lexer`)
2. strip comments
3. parse Pug AST
4. emit JSX/TSX text and mapping segments

Supported constructs include:

- tags/components
- attributes/spreads
- class/id shorthand
- `#{}`, `!{}`, and `${}` interpolation
- nested `pug` inside `${...}`
- `if/else`, `each`, `while`, `case/when`
- `-` code lines and `tag= expr`
- text nodes and `|` lines

### 4.3 Compile Modes

- `languageService`: TS-oriented output for editor tooling
- `runtime`: JS/JSX-safe output for compilers/linters

Runtime mode is required for Babel/SWC/esbuild/ESLint adapters and must not emit TS-only syntax.

### 4.4 Source Transform API

`transformSourceFile(...)` replaces all Pug regions in a source file and returns:

- transformed `code`
- `document` (original/shadow model)
- `regions`
- generated->original offset mapping helpers

All compiler adapters are thin wrappers around this API.

---

## 5. Mapping Model

Each region stores Volar-compatible mappings and `CodeInformation` feature flags. Mapping utilities support:

- original -> generated offsets
- generated -> original offsets
- generated diagnostic range -> original range

This model is shared by:

- tsserver plugin remapping
- Babel/SWC/esbuild diagnostic remap helpers
- ESLint processor postprocess remapping

---

## 6. Class Shorthand Strategy

Core compile options:

- `classAttribute`: `auto | className | class | styleName`
- `classMerge`: `auto | concatenate | classnames`
- `startupjsCssxjs`: `auto | true | false`
- `componentPathFromUppercaseClassShorthand`: `boolean` (default `true`)

Default behavior:

- `auto` => `className + concatenate`
- if startupjs/cssxjs marker is detected and auto mode is active:
  - `styleName + classnames`
- if `componentPathFromUppercaseClassShorthand` is enabled:
  - leading uppercase dot-segments after a component are treated as component path
  - first lowercase segment starts class shorthand mode for the rest of the chain

`styleName + classnames` emit supports nested array/object forms.

VS Code settings pass these options to the TS plugin:

- `pugReact.classShorthandProperty`
- `pugReact.classShorthandMerge`
- `pugReact.injectCssxjsTypes`

---

## 7. TypeScript Plugin Flow

High-level request path:

1. tsserver requests snapshot/version
2. plugin returns shadow snapshot if Pug regions exist
3. TS language service computes diagnostics/completions/etc on shadow text
4. plugin remaps outputs back to original source ranges

Intercepted API families include completions, quick-info/navigation, references/rename, diagnostics, classifications, and code-fix/refactor edits.

Plugin behavior is fail-soft: on internal errors it falls back to base TS behavior.

---

## 8. VS Code Extension Flow

Extension contributes:

- tsserver plugin activation for TS/JS files
- Pug template literal grammar injection
- configuration schema
- shadow document debug command

Grammar is focused on rich highlighting while semantic correctness remains TS-plugin-driven.

---

## 9. Compiler Adapter Flows

### Babel

- `basic` mode:
  - transform source text with core runtime mode
  - parse each transformed Pug region as a replacement expression
  - replace only the matched `pug` tagged-template expressions during `Program` traversal
  - preserve normal Babel locations for surrounding non-Pug AST
- `detailed` mode:
  - transform source text with core runtime mode
  - attach the core source map as an inline input map
  - parse transformed result via Babel `parserOverride`
  - let later Babel plugins operate on the transformed AST while Babel composes the final source map chain

### SWC

- pretransform text via core
- run `@swc/core` on transformed text (optional helper)

### esbuild

- plugin `onLoad` reads source and transforms before parse stage
- returns transformed contents with original loader type

### ESLint

- processor preprocess transforms source before lint
- postprocess remaps lint message coordinates back to originals

---

## 10. Testing Strategy

Test layers:

- core unit/integration tests
- TS plugin unit/integration tests
- VS Code extension unit + extension-host tests
- compiler adapter unit tests for Babel/SWC/esbuild/ESLint
- shared compiler fixture matrix for parity/stress coverage

Important coverage themes:

- nested `${pug\`...\`}` transforms
- multi-region files
- runtime TS-syntax safety for JS/JSX
- source map generation in compiler flows
- Babel source-map chaining through a downstream JSX transform
- generated->original diagnostic mapping fidelity

---

## 11. Scripts and CI

Key scripts:

- `npm run test:core`
- `npm run test:ts-plugin`
- `npm run test:vscode:unit`
- `npm run test:vscode`
- `npm test` (unit + VS Code)

CI jobs:

- `quality-gates`: typecheck, build, and full test flow (with xvfb for VS Code tests)

---

## 12. Current Boundaries

- VS Code extension targets desktop extension host (no web extension host build).
- Runtime transform equivalence is behavior-oriented, not intended to be byte-identical to legacy Babel plugins.
- Babel `sourceMaps: 'basic'` is the compatibility-first default and only provides coarse source maps within transformed Pug regions.
- Babel `sourceMaps: 'detailed'` provides granular maps, but does so by taking ownership of parsing via `parserOverride`, which is less composable with other parse-owning Babel plugins.
- During very incomplete edits, temporary IntelliSense mapping may be approximate until syntax stabilizes.
