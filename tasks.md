# React Pug Compiler Expansion Plan

This document is the implementation backlog for adding build-time compiler integrations on top of `@startupjs/react-pug-core`.

Goal: support the same Pug-in-tagged-template authoring experience beyond VS Code/type-service by adding:
1. Babel plugin
2. SWC plugin
3. ESLint plugin/processor
4. esbuild plugin

All integrations must reuse `react-pug-core` and ship with strong automated tests. Work is split into small tasks with commit checkpoints.

## Guiding Principles

- One shared core transform path for all tools.
- No regression in existing VS Code / TS plugin behavior.
- Keep source locations mappable back to original files.
- Add tests with each task; no large untested jumps.
- Commit after each completed task.

## Task 0: Planning Baseline

- [x] Create this `tasks.md` with phased execution plan and quality gates.
- [x] Confirm current baseline test suite is green before feature work.

Commit: `chore: add compiler expansion task plan`

---

## Phase 1: Core API Refactor For Build Integrations

### Task 1.1: Add a tool-agnostic source transform API

- [x] Add a new core API that transforms an entire source file by replacing `pug\`...\`` regions.
- [x] Keep existing `buildShadowDocument` behavior unchanged for language service usage.
- [ ] New API should return:
  - transformed code
  - region metadata
  - mapping helpers that enable reverse mapping of diagnostics to original offsets
- [x] Add config surface for tag function name and future options.

Tests:
- [x] Core unit tests for source-level transform with single and multiple regions.
- [x] Tests for files with no regions.
- [x] Tests for nested `pug` inside `${}` interpolation.

Commit: `feat(core): add shared source transform API for compiler integrations`

### Task 1.2: Add output mode support (language-service vs runtime)

- [x] Introduce compile mode options in `compilePugToTsx`:
  - `languageService` (current behavior; TS-oriented placeholders/type annotations allowed)
  - `runtime` (pure JS/JSX output, no TS-only syntax)
- [x] Ensure control-flow emitters (`while`, recovery placeholders, etc.) are runtime-safe.

Tests:
- [x] Unit tests validating runtime output contains no TS-only syntax.
- [x] Snapshot-like assertions for `while`, parse recovery, and mixed code blocks.

Commit: `feat(core): support runtime-safe compile output mode`

### Task 1.3: Map composition utilities

- [x] Add core utility helpers to map diagnostics from transformed/shadow offsets to original offsets.
- [x] Expose line/column conversion helpers for downstream plugins.

Tests:
- [x] Unit tests for offset mapping across multiple regions and indented blank lines.
- [x] Tests for edge positions around `${}` interpolation and `-` code blocks.

Commit: `feat(core): expose reusable diagnostic mapping utilities`

---

## Phase 2: Babel Plugin Package

### Task 2.1: Scaffold package

- [x] Create package `packages/babel-plugin-react-pug`.
- [x] Export Babel plugin factory with options:
  - `tagFunction` (default `pug`)
  - `mode` (`runtime` default)
- [x] Wire package metadata and tests into workspace.

Tests:
- [x] Package smoke test for plugin registration.

Commit: `feat(babel): scaffold babel-plugin-react-pug package`

### Task 2.2: Implement tagged-template transform

- [x] Transform `pug\`...\`` into equivalent JSX/JS expression via core runtime compiler.
- [x] Support nested interpolations and nested inner `pug` templates in `${}`.
- [x] Ensure transformed code parses under Babel TypeScript+JSX pipeline.

Tests:
- [x] Unit tests for representative syntax surface:
  - tags/components
  - attributes
  - conditionals
  - loops (`each`, `while`)
  - inline/interpolated code
  - unbuffered code (`-`)
  - text nodes (`|`)
  - nested `pug` in `${}`
- [x] Regression tests for previously fixed mapping edge cases.

Commit: `feat(babel): compile pug templates via core runtime transform`

### Task 2.3: Source map behavior

- [x] Preserve useful source map locations in Babel output.
- [x] Map Babel diagnostics back to original pug locations (best-effort + tested guarantees).

Tests:
- [x] Source-map-focused tests asserting key generated spans resolve to original file locations.
- [x] Diagnostic location mapping tests.

Commit: `feat(babel): add sourcemap-aware location mapping`

---

## Phase 3: SWC Plugin Package

### Task 3.1: Scaffold package

- [x] Create package `packages/swc-plugin-react-pug`.
- [x] Define SWC integration entry points and options (`tagFunction`, mode).

Tests:
- [x] Package smoke test.

Commit: `feat(swc): scaffold swc-plugin-react-pug package`

### Task 3.2: Implement SWC transform pipeline

- [x] Integrate core source transform in SWC workflow.
- [x] Ensure TS/TSX + JSX parser configurations are handled.
- [x] Keep runtime output compatible with SWC transforms.

Tests:
- [x] End-to-end tests through `@swc/core` transform.
- [x] Cases parity with Babel coverage set.

Commit: `feat(swc): transform pug templates in swc pipeline`

### Task 3.3: Diagnostic position mapping support

- [x] Add helper API for mapping SWC parse/type/lint style diagnostics back to original.

Tests:
- [x] Mapping tests on files with multiple pug regions and nested interpolation.

Commit: `feat(swc): add diagnostic mapping helpers`

---

## Phase 4: ESLint Plugin Package

### Task 4.1: Scaffold package

- [x] Create package `packages/eslint-plugin-react-pug`.
- [x] Implement processor-based approach for `*.ts,*.tsx,*.js,*.jsx`.

Tests:
- [x] Smoke tests for processor registration and invocation.

Commit: `feat(eslint): scaffold eslint plugin with processor`

### Task 4.2: Implement preprocess/postprocess mapping

- [x] Preprocess: replace pug regions using core runtime-safe transform for linting.
- [x] Postprocess: remap lint message locations back to original source.
- [x] Preserve filenames and virtual file naming expected by ESLint.

Tests:
- [x] Real ESLint runs with common rules (e.g. `no-undef`, `no-unused-vars`) on pug content.
- [x] Verify reported line/column points to original pug ranges.
- [x] Verify no false remapping for non-pug sections.

Commit: `feat(eslint): remap lint diagnostics from transformed pug back to source`

---

## Phase 5: esbuild Plugin Package

### Task 5.1: Scaffold package

- [x] Create package `packages/esbuild-plugin-react-pug`.
- [x] Export `reactPugPlugin(options)`.

Tests:
- [x] Plugin registration smoke test.

Commit: `feat(esbuild): scaffold esbuild plugin package`

### Task 5.2: Implement onLoad transform

- [x] Intercept TS/TSX/JS/JSX sources and apply core runtime transform.
- [x] Return loader and sourcemap-friendly output.
- [x] Ensure plugin composes with existing esbuild pipelines.

Tests:
- [x] esbuild build tests with entry files using pug templates.
- [x] Verify emitted JS is valid and behaviorally equivalent.

Commit: `feat(esbuild): compile pug templates in esbuild onLoad pipeline`

### Task 5.3: Source map and diagnostic mapping helpers

- [x] Expose map utilities for external tooling / custom error reporting.

Tests:
- [x] Map consistency tests vs core expected offsets.

Commit: `feat(esbuild): add sourcemap and diagnostic mapping utilities`

---

## Phase 6: Cross-Package Quality + Documentation

### Task 6.1: Coverage hardening

- [x] Add shared fixtures reused across Babel/SWC/esbuild/ESLint tests.
- [x] Add stress tests (complex nested interpolations, mixed control flow).
- [x] Add regression tests for all discovered failures.

Commit: `test: add shared fixture matrix across compiler integrations`

### Task 6.2: DX scripts

- [x] Add top-level scripts to run package-specific tests and all compiler tests.
- [x] Ensure CI includes new test jobs.

Commit: `chore: wire compiler integration tests into scripts and CI`

### Task 6.3: Documentation

- [ ] Update README with new packages and usage snippets.
- [ ] Update architecture with compiler integration architecture.

Commit: `docs: add compiler integration architecture and usage`

---

## Phase 7: Class Shorthand Strategy + Cross-Compiler Map Fidelity

### Task 7.1: Add class shorthand compile strategy in core

- [x] Add core compile options:
  - `classAttribute`: `auto | className | class | styleName`
  - `classMerge`: `auto | concatenate | classnames`
- [x] Implement deterministic resolution rules:
  - default `auto` -> `className` + `concatenate`
  - startupjs/cssxjs auto-detection can switch to `styleName` + `classnames`
- [x] Ensure merge behavior is correct for shorthand + explicit attribute combinations.
- [x] Ensure `styleName` + `classnames` emits array-compatible output.

Tests:
- [x] Add extensive unit/integration coverage for all combinations:
  - shorthand only
  - explicit attr only
  - shorthand + explicit quoted string
  - shorthand + explicit JS expression
  - shorthand + explicit object/array/classnames-style value
  - target variants: `className`, `class`, `styleName`
  - merge variants: `concatenate`, `classnames`, `auto`

Commit: `feat(core): add configurable class shorthand compile strategy`

### Task 7.2: TS plugin + VS Code settings wiring

- [x] Add plugin settings support for class shorthand strategy.
- [x] Add VS Code configuration schema entries and pass-through wiring.
- [x] Ensure `injectCssxjsTypes=auto` + startupjs/cssxjs detection can switch shorthand defaults to `styleName` + `classnames`.
- [x] Update injected cssxjs `styleName` type to support nested classnames-compatible arrays/objects.

Tests:
- [x] Unit tests for settings normalization and effective compile-option resolution.
- [x] Integration tests for TS plugin behavior under each strategy combination.

Commit: `feat(ts-plugin): support configurable class shorthand strategy and cssxjs nested styleName types`

### Task 7.3: Compiler package propagation

- [x] Add class strategy options to Babel/SWC/esbuild/ESLint package APIs.
- [x] Ensure startupjs/cssxjs auto-detection is supported consistently in all compiler paths.
- [x] Ensure JS/JSX compile paths never emit TS-only syntax.

Tests:
- [x] Add per-compiler tests for `.js/.jsx` inputs ensuring runtime-safe JSX output.
- [x] Add per-compiler tests for class shorthand strategy combinations.

Commit: `feat(compilers): propagate class shorthand strategy across babel swc esbuild eslint`

### Task 7.4: Source map generation + original-location mapping hardening

- [x] Add/expand tests to verify source maps are emitted for Babel/SWC/esbuild compilation paths.
- [x] Add/expand tests that validate mapped locations resolve to original pug source for all compiler adapters.
- [x] Add edge-case tests across nested pug interpolation and multi-region files.

Commit: `test(compilers): harden sourcemap generation and original-location mapping coverage`

---

## Definition of Done

- [ ] All new packages exist and have tested transform paths.
- [ ] Existing VS Code + TS plugin tests stay green.
- [ ] Compiler plugin tests are green across Babel/SWC/ESLint/esbuild.
- [ ] Mapping behavior is covered by automated tests for key failure-prone cases.
- [ ] README + architecture updated.
