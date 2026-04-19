# Architecture: `react-pug`

## 1. Purpose

`react-pug` is a monorepo for treating `pug\`...\`` as first-class code in JavaScript and TypeScript projects.

The repo provides:

- shared Pug parsing and code generation
- runtime/build transforms for Babel, SWC, and esbuild
- a TypeScript language-service plugin for editor tooling
- a VS Code extension for activation, grammar injection, and debugging commands
- an ESLint processor that reports diagnostics and autofixes back on original Pug source

Supported source file kinds:

- `.js`, `.jsx`, `.mjs`, `.cjs`
- `.ts`, `.tsx`, `.mts`, `.cts`

The main design goal is not just "compile Pug". It is:

- transform Pug correctly
- map diagnostics, ranges, and edits back to original source correctly
- keep the user-facing experience stable across editor, compiler, and lint flows

## 2. Workspace Layout

```text
packages/
  react-pug-core/
  pug-lexer/
  is-expression/
  check-types/
  typescript-plugin-react-pug/
  vscode-react-pug-tsx/
  babel-plugin-react-pug/
  swc-plugin-react-pug/
  esbuild-plugin-react-pug/
  eslint-plugin-react-pug/
```

High-level roles:

- `react-pug-core`: shared transform, mapping, shadow-document, lint-transform logic
- `pug-lexer`: vendored lexer with repo-specific JS/TS expression support
- `is-expression`: expression validator used by the lexer
- `check-types`: CLI wrapper over the TS plugin for typechecking Pug-enabled projects from the command line
- `typescript-plugin-react-pug`: tsserver adapter over the core shadow model
- `vscode-react-pug-tsx`: VS Code extension and TextMate grammar package
- `babel-plugin-react-pug`, `swc-plugin-react-pug`, `esbuild-plugin-react-pug`: build/runtime adapters around core
- `eslint-plugin-react-pug`: ESLint processor with source-faithful diagnostics and autofix

## 3. Core Architectural Principles

### 3.1 Hybrid text-and-mapping model

The repo intentionally does **not** use a whole-file AST reprint pipeline as the main architecture.

Instead it uses:

- original file text
- extracted Pug regions
- transformed replacement text for those regions
- copied original-text segments around them
- explicit synthetic insertions when needed
- mapping utilities between original, shadow, and generated outputs

Why:

- whole-file AST reprint would make untouched code unstable
- node locations are not rich enough to replace our mapping metadata
- editor/lint workflows need precise range remapping, not just emitted code

### 3.2 Shared core, thin adapters

The intended layering is:

- `react-pug-core` owns parsing, compilation, mapping, and shared query helpers
- adapters own environment-specific wiring only

That means:

- compilers are thin wrappers over `transformSourceFile(...)`
- the TS plugin is an adapter over the shadow-document and query helpers
- the ESLint processor is an adapter over the lint transform and remapping model

### 3.3 Correctness first, suppression last

The repo tries hard to fix false positives and broken autofix by improving transform or mapping logic, not by suppressing rules broadly.

Narrow filtering exists only where the code is fundamentally synthetic and cannot be interpreted as user-authored logic.

## 4. Core Pipeline

### 4.1 Region extraction

`react-pug-core/src/language/extractRegions.ts` parses the host file with Babel and finds tagged templates matching the configured `tagFunction`.

It also computes:

- the original source spans of Pug regions
- import information needed for `requirePugImport`
- terminal `style(...)` block insertion targets
- class shorthand settings
- region metadata needed for later shadow/generated mapping

Fallback regex extraction exists only for parse-failure recovery.

### 4.2 Pug lexing and parsing

`react-pug-core/src/language/pugToTsx.ts` compiles region content through:

1. `@react-pug/pug-lexer`
2. comment stripping / preprocessing
3. Pug AST parsing
4. JSX/TSX emission plus mapping metadata

Supported constructs include:

- tags/components
- attrs/spreads
- class/id shorthand
- `#{...}`, `!{...}`, `${...}` interpolation
- `tag= expr`
- `-` code lines
- `if/else`, `each`, `while`, `case/when`
- terminal `style` blocks

Recent important contract details:

- valid multiline `p= ...` is supported in the vendored lexer
- valid multiline `#{...}` interpolation is supported in the vendored lexer
- multiline `${...}` is handled in core preprocessing
- attr expressions are classified structurally, not by raw quote heuristics

### 4.3 Source transform

`transformSourceFile(...)` is the main shared entry point for runtime/compiler flows.

It returns:

- transformed `code`
- the `document` model
- mapped `regions`
- generated-to-original mapping helpers

All compiler wrappers depend on this path.

### 4.4 Shadow document

`buildShadowDocument(...)` creates the TS/VS Code shadow representation.

The shadow document consists of:

- copied original-text segments
- mapped generated Pug replacement regions
- mapped style-helper insertions
- synthetic import/wrapper insertions where required

This model is used by:

- the TypeScript plugin
- core mapping/query helpers
- diagnostic span remapping

### 4.5 Lint transform

`react-pug-core/src/language/lintTransform.ts` is the lint-oriented layer on top of the runtime transform.

It owns:

- lint-only semantic normalization of generated Pug JSX
- mapped region rewriting
- boundary maps for rewritten regions
- region formatting context metadata
- shared segmented-region rewrite plumbing
- shared insertion-range helpers

This is intentionally separate from runtime transforms because runtime-correct JSX is not always lint-correct JSX.

Examples of lint-only normalization:

- attrless `Fragment` -> fragment shorthand
- safe repeated ternary simplification

## 5. Mapping Model

There are several mapping surfaces in the repo.

### 5.1 Original <-> shadow

Used by the TypeScript plugin and VS Code tooling.

Current shared helpers in core cover:

- original offset -> shadow offset
- shadow offset -> original offset
- region raw offset <-> stripped offset
- original span -> shadow span
- shadow span -> original span
- encoded classification remapping
- nearby same-line fallback for typing-time editor requests

These now live in core so the TS plugin and VS Code extension do not each own their own offset math.

### 5.2 Generated <-> original

Used by:

- Babel/SWC/esbuild diagnostics and source maps
- ESLint main transformed-surface diagnostics

### 5.3 Embedded-site mapping

Used only by the ESLint processor.

When user-authored JS exists inside Pug sites like:

- attrs
- `#{...}`
- `${...}`
- `tag= expr`
- inline handler bodies

ESLint can lint that JS through a source-faithful embedded block and map results back to the original site.

## 6. Package Responsibilities

### 6.1 `@react-pug/react-pug-core`

Owns:

- region extraction
- Pug compilation
- source transforms
- shadow documents
- mapping/query helpers
- lint-oriented core transform
- document issue shaping

It is the shared source of truth for transform and mapping behavior.

### 6.2 `@react-pug/typescript-plugin-react-pug`

Owns only TS-specific adaptation:

- patching `LanguageServiceHost`
- serving shadow snapshots
- delegating to TS on shadow text
- remapping TS results back to original source
- injecting core-owned document issues into TS diagnostics
- narrow TS-specific filtering where generated shadow TSX would otherwise create false positives

It should stay adapter-like.

### 6.3 `@react-pug/check-types`

Owns:

- CLI entry point for typechecking files/projects that contain `pug\`...\``
- wiring to the TS plugin in non-editor workflows

It should remain thin. If a typechecking behavior bug appears here, it is usually really in:

- the TS plugin
- shared shadow/mapping logic in core
- or the caller's TypeScript project configuration

### 6.4 `vscode-react-pug-tsx`

Owns:

- extension activation
- TS plugin registration
- settings surface
- `Show Shadow TSX` command
- TextMate grammar injection
- embedded style completion integration via VS Code APIs

Important boundary:

- TextMate highlighting is separate from the shadow-document path
- it should share assumptions where useful, but it is not part of the same mapping architecture

### 6.5 `@react-pug/babel-plugin-react-pug`

Owns Babel integration only.

Modes:

- `sourceMaps: 'basic'`
  - replace matched tagged templates during traversal
  - coarse mapping inside transformed Pug
  - compatibility-first
- `sourceMaps: 'detailed'`
  - pretransform full source through core
  - inject inline input map
  - parse through `parserOverride`
  - preserve detailed mapping through downstream Babel transforms

Basic mode is intentionally simpler and does not promise detailed original-Pug mapping.

### 6.6 `@react-pug/swc-plugin-react-pug`

Thin wrapper over core runtime transform plus SWC invocation and remap helpers.

### 6.7 `@react-pug/esbuild-plugin-react-pug`

Thin wrapper over core runtime transform inside esbuild `onLoad`.

### 6.8 `@react-pug/eslint-plugin-react-pug`

The ESLint plugin is the most structurally specialized adapter.

It owns:

- preprocess transform before lint
- postprocess remap back to original source
- dual lint surfaces
- embedded-site autofix reconstruction
- final stylistic shaping for the lint surface

It intentionally does **not** own semantic lint normalization anymore. That is in core.

## 7. ESLint Architecture

### 7.1 Two lint surfaces

The processor uses two different lint surfaces.

#### Main transformed surface

This is lint-oriented JSX/TSX produced from the core lint transform.

Used for:

- JSX/React/semantic rules that need the whole transformed file
- broader AST-aware rules over generated structure

#### Embedded source-faithful surface

This is used only for embedded JS sites inside Pug.

Used for:

- source-faithful stylistic diagnostics
- source-faithful embedded autofix
- a narrow set of safe expression-local rules

This split is deliberate. It improves UX because transformed JSX indentation often does not correspond to what the user actually typed inside an embedded JS site.

### 7.2 Why embedded rule allowlisting exists

Embedded blocks are isolated snippets. They do not always preserve real outer scope.

So the processor intentionally does **not** trust every ESLint rule on that surface.

Current rule of thumb:

- stylistic embedded diagnostics are allowed
- only a narrow set of safe non-stylistic rules are allowed on embedded expression sites
- broader scope-sensitive rules still come from the main transformed surface

This is a correctness decision, not a convenience suppression.

### 7.3 Embedded autofix model

Embedded autofix is now stable because fixes are reconstructed at the correct structural layer.

There are two cases:

#### Single embedded site replacement

- fix the normalized embedded JS site
- stabilize it through formatting
- restore the surrounding Pug indentation baseline
- replace the whole original site once

#### Multiline attr-container replacement

If a multiline embedded fix occurs inside an inline attr container with sibling attrs, the processor does **not** try to rewrite each site independently.

Instead it:

- aggregates fixes at the attr-container level
- rebuilds the whole attr list once
- uses the vendored Pug lexer to split attrs correctly
- converges the container to multiline when that is the stable shape

This prevents corruption in cases like inline handlers expanding to multiline JS.

### 7.4 Current ESLint limitations

Still true today:

- generated-JSX-surface fixes are not mapped back generically the same way embedded-source fixes are
- multiline unbuffered `- ...` statements across several lines are not covered by the same source-faithful embedded formatting contract
- the internal formatter still depends on deprecated `@stylistic/jsx-indent` / `@stylistic/jsx-indent-props` compatibility rules for convergence

These are known limitations and should be treated as explicit contract boundaries.

## 8. VS Code and TS Plugin Flow

### 8.1 TypeScript request flow

High-level:

1. TS asks for snapshot/version
2. plugin serves shadow text if Pug exists
3. TS computes diagnostics/completions/etc on shadow text
4. plugin remaps results back to original Pug source

The plugin currently covers:

- completions
- hover / quick info
- navigation / references / rename
- semantic diagnostics
- classifications
- code-fix / refactor span remapping

### 8.2 VS Code highlighting and style support

The extension contributes:

- TextMate grammar injection for `pug\`...\``
- embedded style language scopes
- debug command for showing shadow TSX
- embedded style completion support via hidden virtual documents

Important correctness rule already fixed:

- the Pug grammar must **not** inject inside host comments or strings

## 9. Class Shorthand Strategy

Core class-related options:

- `classAttribute`: `auto | className | class | styleName`
- `classMerge`: `auto | concatenate | classnames`
- `startupjsCssxjs`: `auto | true | false`
- `componentPathFromUppercaseClassShorthand`: `boolean`

Default behavior:

- default React-like output: `className + concatenate`
- if startupjs/cssxjs markers are detected under auto mode:
  - `styleName + classnames`

The classnames-style merge path supports:

- nested arrays
- object forms
- dashed computed keys such as `['non-responsive']`

## 10. Operational Notes That Matter

These are the things a fresh agent is likely to trip over if they are not written down.

### 10.1 If testing local ESLint changes in a consumer repo, override both plugin and core

The ESLint plugin and `react-pug-core` move together.

If a consumer repo points at a local `eslint-plugin-react-pug` but still uses a published older `react-pug-core`, preprocess can fail because the plugin expects newer core fields.

For local validation in external repos, override both:

- the actual ESLint plugin package that the consumer repo uses
  - usually `@react-pug/eslint-plugin-react-pug`
  - some older repos may still point at `eslint-plugin-cssxjs`
- `@react-pug/react-pug-core`

The same coupling matters when publishing:

- plugin and core releases need to move together
- testing a new plugin against an old published core is not a valid release signal

### 10.2 Real consumer repos matter

Synthetic fixtures are useful, but real-project validation is also important when those repos are available locally or when there is an explicit validation flow for them.

Common public validation targets used by this repo include:

- `../startupjs`
- `../startupjs-ui`

Use them for tricky lint/autofix behavior when they are available. Do not assume every checkout has those repos in the same parent directory.

### 10.3 Do not “fix” false positives by broad suppression

The recent architecture work explicitly moved in the opposite direction:

- improve shared parsing/mapping
- improve core lint transform
- improve embedded-source lint/autofix
- keep suppressions narrow and synthetic-only

### 10.4 Compiler behavior and ESLint behavior have different contracts

A thing that is runtime-correct is not always lint-correct.

That is why:

- runtime transforms stay in core runtime mode
- ESLint gets an additional lint-oriented transform surface

Do not force one output mode to satisfy every consumer.

## 11. Testing Strategy

The repo relies on layered tests.

### 11.1 Core tests

- Pug compile output
- mapping utilities
- shadow document
- lint transform
- extracted region behavior

### 11.2 Vendored tests

- `is-expression`
- `pug-lexer`

These are important because many bugs that first appear in ESLint are actually lexer/core bugs.

### 11.3 Adapter tests

- Babel / SWC / esbuild wrapper tests
- ESLint processor tests
- TS plugin tests
- VS Code extension-host tests

### 11.4 Fixture tests

- unformatted example fixture diagnostics
- fixed snapshots after `eslint --fix`
- real-project compiler snapshots
- startupjs / startupjs-ui regression repros

### 11.5 Current testing philosophy

Prefer:

- exact snapshots for transformed code shapes
- real repros distilled to minimal public-safe cases
- explicit regression matrices for complex autofix behavior

Avoid overly loose `toContain(...)` assertions when the full output shape is the contract.

## 12. Current Known Boundaries

- Babel `basic` mode is intentionally coarse and should not promise detailed Pug mapping
- generated-JSX-surface ESLint fixes are still a weaker contract than embedded-source fixes
- the deprecated `@stylistic/jsx-indent` / `@stylistic/jsx-indent-props` compatibility dependency is still present for formatter convergence
- syntax highlighting is a separate correctness surface from the TS/shadow path
- very incomplete in-progress edits can still produce approximate editor behavior until syntax stabilizes

## 13. What A New Agent Should Assume

If you are starting fresh in this repo, assume:

1. `react-pug-core` is the source of truth for transform and mapping logic.
2. If an ESLint bug looks structural, first ask whether it is actually a lexer/core problem.
3. If a change only affects lint formatting or fix reconstruction, it probably belongs in the ESLint plugin.
4. If a change affects parsing, expression emission, or mapping math, it probably belongs in core or the vendored lexer.
5. Validate tricky behavior against a real consumer repo, not only synthetic fixtures.
6. Prefer stronger tests and explicit contract notes over clever but implicit behavior.
