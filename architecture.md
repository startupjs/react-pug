# Architecture: `react-pug`

## 1. Purpose and Scope

This repository provides first-class TypeScript/JavaScript editor tooling for `pug\`...\`` tagged template literals used with React.

The system gives a Pug-in-template authoring experience that behaves like JSX for:

- completions
- hover
- go-to-definition
- type definition
- signature help
- rename
- references/highlights/implementation
- diagnostics and quick fixes/refactors
- semantic/syntactic classifications (highlighting metadata)
- TextMate grammar highlighting for Pug sections

The implementation target is VS Code + tsserver plugin integration, not a separate full LSP for `.ts/.tsx/.js/.jsx`.

---

## 2. Current Monorepo Structure

The project is an npm workspace monorepo with three packages.

```
packages/
  react-pug-core/
    src/
      language/
        mapping.ts
        extractRegions.ts
        pugToTsx.ts
        shadowDocument.ts
        positionMapping.ts
    test/
      unit/
      integration/

  typescript-plugin-react-pug/
    src/index.ts
    dist/plugin.js
    test/
      fixtures/
      unit/
      integration/

  vscode-react-pug/
    src/index.ts
    syntaxes/pug-template-literal.json
    dist/client.js
    .vscode-test.mjs
    test/
      unit/
      vscode/
```

Top-level files own repo orchestration:

- `package.json` workspace scripts
- `esbuild.config.mjs` build pipeline for extension+plugin bundles
- `vitest.config.ts` test discovery across package tests
- `tsconfig.json` typecheck for package sources
- `.github/workflows/ci.yml` quality gates
- `scripts/open-vscode-fresh.mjs` manual clean VS Code launcher
- `scripts/ensure-workspace-deps.mjs` ensures demo workspace deps before VS Code tests

---

## 3. Package Responsibilities

### 3.1 `@startupjs/react-pug-core`

Framework-agnostic language core:

- finds Pug tagged templates in source text
- compiles Pug to IntelliSense-oriented TSX
- emits source mappings with feature flags
- constructs a "shadow document" (original file with Pug regions replaced by TSX)
- performs precise bidirectional offset mapping (original <-> shadow)

### 3.2 `@startupjs/typescript-plugin-react-pug`

TypeScript server plugin:

- patches `LanguageServiceHost` snapshot/version behavior
- injects shadow text into tsserver pipeline
- intercepts language service APIs and maps positions/spans between user file and shadow file
- maps diagnostics and adds custom Pug parse diagnostics
- handles classification remapping and refactor/code-fix edit remapping

### 3.3 `vscode-react-pug`

VS Code extension package:

- contributes tsserver plugin registration (`contributes.typescriptServerPlugins`)
- contributes settings (`pugReact.*`)
- contributes grammar injection for `pug\`...\`` sections
- registers `pugReact.showShadowTsx` debug command
- hosts a virtual document provider for shadow TSX viewing

---

## 4. High-Level Runtime Architecture

### 4.1 Core Pattern

The architecture follows a Volar-like hybrid model:

1. Keep VS Code/tsserver as the primary language engine.
2. Convert Pug template fragments to TSX "shadow" regions.
3. Let TypeScript reason about shadow content.
4. Map all user-facing positions/spans back to original file offsets.

### 4.2 Execution Flow (Editing)

1. User edits `.ts/.tsx/.js/.jsx` file containing `pug\`...\``.
2. tsserver requests script snapshot via host.
3. Plugin patches `getScriptSnapshot`:
- extracts Pug regions
- compiles each to TSX
- replaces regions in a shadow copy
- returns shadow snapshot to tsserver
4. tsserver computes diagnostics/completions/etc against shadow content.
5. Plugin intercepts LS API calls/results and remaps positions/spans back to original file.
6. Editor presents results at correct positions in original source.

---

## 5. Core Data Model

Defined in `packages/react-pug-core/src/language/mapping.ts`.

### 5.1 `CodeInformation`

Per-mapping feature toggles:

- `completion`
- `navigation`
- `verification`
- `semantic`

Preset profiles:

- `FULL_FEATURES` for identifiers/expressions that should fully participate in IntelliSense
- `VERIFY_ONLY` for expression coverage where diagnostics/navigation matter but completion can be suppressed
- `CSS_CLASS` and `SYNTHETIC` for non-TS identifiers / structural text

### 5.2 `PugRegion`

Represents one tagged template region.

Key fields:

- original offsets (`originalStart`, `originalEnd`)
- raw content offsets inside backticks (`pugTextStart`, `pugTextEnd`)
- stripped Pug text (`pugText`) + `commonIndent`
- generated shadow range (`shadowStart`, `shadowEnd`)
- generated TSX text (`tsxText`)
- Volar-compatible mappings (`mappings`)
- retained lexer token metadata (`lexerTokens`)
- parse error metadata (`parseError`)

### 5.3 `PugDocument`

Per-file model in plugin cache:

- `originalText`
- `shadowText`
- `regions[]`
- mapping accelerators (`regionDeltas`)
- `version`

---

## 6. Region Extraction (`extractRegions.ts`)

Primary mechanism: `@babel/parser` AST traversal.

### 6.1 Extraction Logic

- parse source with language-aware plugins (TS/JSX support)
- collect `TaggedTemplateExpression` where tag identifier equals configured `tagFunction` (default `pug`)
- convert each to `PugRegion` boundaries

### 6.2 Indent Normalization

`stripCommonIndent()` removes shared indentation across non-empty lines in template content, storing:

- stripped content for parser/compiler stability
- `commonIndent` for accurate offset restoration

### 6.3 Fallback

If Babel parse fails, regex fallback extracts `tagName\`...\`` conservatively.

### 6.4 Unsupported Interpolation

If template contains JavaScript `${}` expressions, region is marked with parseError indicating unsupported interpolation (use `#{}` in Pug instead).

---

## 7. Pug -> TSX Generation (`pugToTsx.ts`)

### 7.1 Pipeline

1. Lex with `@startupjs/pug-lexer`
2. Strip comments with `pug-strip-comments`
3. Parse with `pug-parser`
4. Emit TSX + mappings via `TsxEmitter`

### 7.2 Emitter Strategy

`TsxEmitter` supports:

- `emitMapped`: 1:1 mapped segments
- `emitDerived`: mapped segments with differing generated length
- `emitSynthetic`: unmapped structural code

### 7.3 Supported Constructs

- tags/components (`div`, `Button`)
- attrs, boolean attrs, spread attrs
- class/id shorthand
- text nodes + piped text forms
- interpolation `#{}` / `!{}`
- line expressions `tag= expr`
- buffered/unbuffered code (`=` and `-`)
- conditionals (`if / else if / else`)
- loops (`each`, `while`)
- case/when/default
- multi-root fragment wrapping

### 7.4 TSX Shape Principles

Generator output is IntelliSense-oriented rather than a strict runtime Babel-equivalent printer. It prefers TSX constructs that maximize tsserver understanding and mapping fidelity.

### 7.5 Typing-Time Recovery

`buildTypingRecoveryText()` relaxes temporary incomplete syntax during live edits:

- handles dangling `-` lines
- handles empty `tag=` expressions
- auto-balances unclosed `()` and interpolation braces

If parse still fails, compiler returns safe placeholder TSX:

- `(null as any as JSX.Element)`

---

## 8. Shadow Document Assembly (`shadowDocument.ts`)

`buildShadowDocument(originalText, uri, version, tagName)`:

1. extract regions
2. compile each region
3. replace each `pug\`...\`` span with generated TSX in a shadow copy
4. compute cumulative deltas (`regionDeltas`) for fast mapping outside regions

Important behavior:

- files with no regions return identity model (`shadowText === originalText`)
- regions with prior parseError still receive placeholder TSX to keep tsserver operational

---

## 9. Position Mapping (`positionMapping.ts`)

Uses `@volar/source-map` per-region and binary-search helpers for performance.

### 9.1 Challenges Solved

- original raw offsets include stripped indentation and backtick context
- mapping tables operate in stripped region coordinate space
- synthetic TSX segments must not map to user positions

### 9.2 Key Functions

- `originalToShadow(doc, offset)`
- `shadowToOriginal(doc, offset)`
- region lookup helpers:
  - `findRegionAtOriginalOffset`
  - `findRegionAtShadowOffset`

### 9.3 Indent-Aware Conversion

- `rawToStrippedOffset()` returns `null` when cursor is inside removed indentation
- `strippedToRawOffset()` restores raw positions for reverse mapping

### 9.4 Outside-Region Mapping

Uses `regionDeltas` to apply/reverse cumulative offsets in O(log n).

---

## 10. TS Plugin Architecture (`typescript-plugin-react-pug/src/index.ts`)

### 10.1 Initialization

`init({ typescript })` returns tsserver `PluginModule`.

### 10.2 Host Patching

Patched methods:

- `getScriptSnapshot`:
  - builds/returns shadow snapshots when enabled and regions exist
  - caches `PugDocument` per file
  - graceful fallback to original snapshot on failure
- `getScriptVersion`:
  - returns `${hostVersion}:${docVersion}` for cached docs
  - ensures tsserver invalidates correctly when host text changes

### 10.3 Caching

`docCache: Map<string, PugDocument>` keyed by fileName.

- cache hit shortcut when original text unchanged
- cache cleared when file no longer contains Pug regions

### 10.4 Method Interception

The plugin proxies LS and overrides targeted APIs with safe fallback wrappers.

Intercepted methods:

- completions
  - `getCompletionsAtPosition`
  - `getCompletionEntryDetails`
- navigation/hover/signature
  - `getDefinitionAtPosition`
  - `getDefinitionAndBoundSpan`
  - `getTypeDefinitionAtPosition`
  - `getQuickInfoAtPosition`
  - `getSignatureHelpItems`
- rename/references
  - `getRenameInfo`
  - `findRenameLocations`
  - `findReferences`
  - `getReferencesAtPosition`
  - `getDocumentHighlights`
  - `getImplementationAtPosition`
- refactors/code fixes
  - `getApplicableRefactors`
  - `getEditsForRefactor`
  - `getCodeFixesAtPosition`
  - `getCombinedCodeFix`
- classifications
  - `getEncodedSyntacticClassifications`
  - `getEncodedSemanticClassifications`
- diagnostics
  - `getSemanticDiagnostics`
  - `getSyntacticDiagnostics`
  - `getSuggestionDiagnostics`

### 10.5 Typing-Time Completion Heuristic

`mapToShadowForTyping()` tries nearby mapped positions when current cursor falls in a transient unmapped area, improving live suggestion stability while typing incomplete expressions.

### 10.6 Diagnostic Strategy

- map TS diagnostics from shadow to original offsets/lengths
- drop unmapped/synthetic-only diagnostics
- suppress specific false positives in Pug regions:
  - `2503` (Cannot find namespace 'JSX')
  - `1109` (Expression expected)
- optionally inject custom Pug parser diagnostics (`code: 99001`) when enabled

### 10.7 Classification Remapping

For encoded classifications, remap triples (`start,length,class`) shadow->original and clip to requested original span.

### 10.8 Error Isolation

Every override uses safe wrapper:

- log and fall back to original language service behavior on exceptions

---

## 11. VS Code Extension Architecture (`vscode-react-pug/src/index.ts`)

### 11.1 Activation

On activation:

- create output channel `Pug React`
- register text document content provider for scheme `pug-react-shadow`
- register command `pugReact.showShadowTsx`

### 11.2 `showShadowTsx` Command

Behavior:

1. read active editor
2. resolve `pugReact.tagFunction`
3. build shadow document via core
4. if no Pug templates: info message
5. else open virtual shadow TSX document in side editor

### 11.3 Manifest Contributions (`packages/vscode-react-pug/package.json`)

- activation on TS/TSX/JS/JSX
- plugin contribution:
  - `@startupjs/typescript-plugin-react-pug`
- settings:
  - `pugReact.enabled`
  - `pugReact.diagnostics.enabled`
  - `pugReact.tagFunction`
- command contribution: `pugReact.showShadowTsx`
- grammar injection contribution
- Emmet defaults to avoid noisy abbreviation behavior in Pug contexts

---

## 12. Syntax Highlighting Architecture

Grammar file: `packages/vscode-react-pug/syntaxes/pug-template-literal.json`

### 12.1 Injection Entry

- scope: `inline.pug-template-literal`
- inject selector: TS/TSX/JS/JSX
- begin pattern anchored to standalone `pug` identifier before backtick

### 12.2 Coverage Areas

Grammar rules include:

- comments
- control flow (`if`, `else`, `each`, etc.)
- unbuffered `-` code lines
- line output expressions (`tag= expr`)
- interpolation `#{}` / `!{}`
- pipe text lines (`| text`)
- class/id shorthand
- attributes and embedded expressions

### 12.3 Embedded Languages

Rules embed `source.ts`/`source.tsx` in expression subregions to retain rich color differentiation and token semantics.

---

## 13. Build and Packaging

Build config: `esbuild.config.mjs`

Outputs:

- extension bundle:
  - entry `packages/vscode-react-pug/src/index.ts`
  - out `packages/vscode-react-pug/dist/client.js`
- plugin bundle:
  - entry `packages/typescript-plugin-react-pug/src/index.ts`
  - out `packages/typescript-plugin-react-pug/dist/plugin.js`

Shared esbuild settings:

- `platform: node`
- `format: cjs`
- sourcemaps on
- `vscode` externalized

Root scripts:

- `build`, `build:extension`, `build:plugin`, `watch`

---

## 14. Test Architecture

### 14.1 Test Commands

- unit+integration (Vitest):
  - `npm run test:unit`
- VS Code extension-host tests:
  - `npm run test:vscode`
  - `npm run test:vscode:demo`
  - screenshot mode: `npm run test:vscode:demo:screenshots`
- full suite:
  - `npm test` (runs `test:unit` then `test:vscode`)

### 14.2 Test Locations

- core tests:
  - `packages/react-pug-core/test/unit`
  - `packages/react-pug-core/test/integration`
- plugin tests:
  - `packages/typescript-plugin-react-pug/test/unit`
  - `packages/typescript-plugin-react-pug/test/integration`
  - fixtures under `packages/typescript-plugin-react-pug/test/fixtures`
- extension tests:
  - `packages/vscode-react-pug/test/unit`
  - `packages/vscode-react-pug/test/vscode`

### 14.3 VS Code Host Test Config

- config file: `packages/vscode-react-pug/.vscode-test.mjs`
- active label: `demo`
- workspace target: `examples/demo`

### 14.4 Screenshot Capture in VS Code Tests

`packages/vscode-react-pug/test/vscode/screenshot.js` supports:

- optional capture (`VSCODE_CAPTURE_SCREENSHOTS=1`)
- settle delay tuning (`VSCODE_SCREENSHOT_SETTLE_MS`)
- artifacts in `artifacts/vscode-screenshots/<workspace>/`
- platform-specific capture strategies (VS Code API / OS screenshot command)

### 14.5 Current Test Volume

As of latest local run:

- 26 test files
- 629 passing tests

---

## 15. CI Architecture

Workflow: `.github/workflows/ci.yml`

Quality gate steps:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `xvfb-run -a npm test`

Notes:

- `npm test` includes both Vitest and VS Code extension-host tests.
- xvfb is required for headless VS Code test execution on Linux runners.

---

## 16. Developer Utility Scripts

### 16.1 `scripts/open-vscode-fresh.mjs`

Launches a fresh VS Code session with:

- temporary user-data and extensions dirs
- all external extensions disabled
- this extension loaded via `--extensionDevelopmentPath packages/vscode-react-pug`

### 16.2 `scripts/ensure-workspace-deps.mjs`

Before VS Code tests, ensures demo workspace dependencies exist (notably `react` and `react/jsx-runtime`) and runs `npm install` in demo if missing.

---

## 17. Configuration Surface

End-user settings:

- `pugReact.enabled`: global plugin behavior toggle
- `pugReact.diagnostics.enabled`: custom Pug parse diagnostics toggle
- `pugReact.tagFunction`: custom tag identifier support (default `pug`)

Behavior implications:

- disabling plugin returns original snapshots (pass-through mode)
- changing tag function affects extraction in both plugin and debug command

---

## 18. Performance Characteristics

Current design decisions for responsiveness:

- fast text precheck before parsing (`tagName` presence)
- per-file cached `PugDocument`
- binary-search region lookups
- `regionDeltas` for O(log n) outside-region mapping
- limited-radius typing-time completion fallback

No long-lived external process is introduced; operations stay in tsserver plugin path.

---

## 19. Error Handling and Resilience

Core and plugin are designed to fail soft:

- parse failures generate placeholder TSX instead of breaking LS calls
- unsupported constructs produce targeted diagnostics, not crashes
- method-level override wrapper falls back to underlying LS on exception
- extension command catches failures, logs to output channel, and surfaces user-friendly errors

---

## 20. Known Limits and Semantics

Important boundaries:

- JavaScript `${}` inside `pug\`...\`` is not supported (use Pug `#{}`)
- Generated TSX is IntelliSense-oriented and may not be byte-for-byte runtime Babel output
- Some mapping for highly malformed intermediate typing states is heuristic-based

---

## 21. Why This Architecture

This approach intentionally avoids a standalone LSP replacement and instead composes with TypeScript's native language service.

Benefits:

- keeps TS ecosystem features and project resolution behavior intact
- minimizes integration risk with VS Code TS extension behavior
- enables high-feature parity using source transforms + precise mapping

Tradeoff:

- mapping logic is non-trivial and requires robust regression coverage (which the current test architecture provides).

---

## 22. Operational Checklist

For maintainers and agents:

1. Install deps: `npm ci`
2. Typecheck: `npm run typecheck`
3. Build: `npm run build`
4. Unit/integration tests: `npm run test:unit`
5. VS Code host tests: `npm run test:vscode`
6. Full suite: `npm test`

For visual/manual validation:

- `npm run test:vscode:demo:screenshots`
- `npm run vscode:fresh:demo`

