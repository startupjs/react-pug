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

- [ ] Create this `tasks.md` with phased execution plan and quality gates.
- [ ] Confirm current baseline test suite is green before feature work.

Commit: `chore: add compiler expansion task plan`

---

## Phase 1: Core API Refactor For Build Integrations

### Task 1.1: Add a tool-agnostic source transform API

- [ ] Add a new core API that transforms an entire source file by replacing `pug\`...\`` regions.
- [ ] Keep existing `buildShadowDocument` behavior unchanged for language service usage.
- [ ] New API should return:
  - transformed code
  - region metadata
  - mapping helpers that enable reverse mapping of diagnostics to original offsets
- [ ] Add config surface for tag function name and future options.

Tests:
- [ ] Core unit tests for source-level transform with single and multiple regions.
- [ ] Tests for files with no regions.
- [ ] Tests for nested `pug` inside `${}` interpolation.

Commit: `feat(core): add shared source transform API for compiler integrations`

### Task 1.2: Add output mode support (language-service vs runtime)

- [ ] Introduce compile mode options in `compilePugToTsx`:
  - `languageService` (current behavior; TS-oriented placeholders/type annotations allowed)
  - `runtime` (pure JS/JSX output, no TS-only syntax)
- [ ] Ensure control-flow emitters (`while`, recovery placeholders, etc.) are runtime-safe.

Tests:
- [ ] Unit tests validating runtime output contains no TS-only syntax.
- [ ] Snapshot-like assertions for `while`, parse recovery, and mixed code blocks.

Commit: `feat(core): support runtime-safe compile output mode`

### Task 1.3: Map composition utilities

- [ ] Add core utility helpers to map diagnostics from transformed/shadow offsets to original offsets.
- [ ] Expose line/column conversion helpers for downstream plugins.

Tests:
- [ ] Unit tests for offset mapping across multiple regions and indented blank lines.
- [ ] Tests for edge positions around `${}` interpolation and `-` code blocks.

Commit: `feat(core): expose reusable diagnostic mapping utilities`

---

## Phase 2: Babel Plugin Package

### Task 2.1: Scaffold package

- [ ] Create package `packages/babel-plugin-react-pug`.
- [ ] Export Babel plugin factory with options:
  - `tagFunction` (default `pug`)
  - `mode` (`runtime` default)
- [ ] Wire package metadata and tests into workspace.

Tests:
- [ ] Package smoke test for plugin registration.

Commit: `feat(babel): scaffold babel-plugin-react-pug package`

### Task 2.2: Implement tagged-template transform

- [ ] Transform `pug\`...\`` into equivalent JSX/JS expression via core runtime compiler.
- [ ] Support nested interpolations and nested inner `pug` templates in `${}`.
- [ ] Ensure transformed code parses under Babel TypeScript+JSX pipeline.

Tests:
- [ ] Unit tests for representative syntax surface:
  - tags/components
  - attributes
  - conditionals
  - loops (`each`, `while`)
  - inline/interpolated code
  - unbuffered code (`-`)
  - text nodes (`|`)
  - nested `pug` in `${}`
- [ ] Regression tests for previously fixed mapping edge cases.

Commit: `feat(babel): compile pug templates via core runtime transform`

### Task 2.3: Source map behavior

- [ ] Preserve useful source map locations in Babel output.
- [ ] Map Babel diagnostics back to original pug locations (best-effort + tested guarantees).

Tests:
- [ ] Source-map-focused tests asserting key generated spans resolve to original file locations.
- [ ] Diagnostic location mapping tests.

Commit: `feat(babel): add sourcemap-aware location mapping`

---

## Phase 3: SWC Plugin Package

### Task 3.1: Scaffold package

- [ ] Create package `packages/swc-plugin-react-pug`.
- [ ] Define SWC integration entry points and options (`tagFunction`, mode).

Tests:
- [ ] Package smoke test.

Commit: `feat(swc): scaffold swc-plugin-react-pug package`

### Task 3.2: Implement SWC transform pipeline

- [ ] Integrate core source transform in SWC workflow.
- [ ] Ensure TS/TSX + JSX parser configurations are handled.
- [ ] Keep runtime output compatible with SWC transforms.

Tests:
- [ ] End-to-end tests through `@swc/core` transform.
- [ ] Cases parity with Babel coverage set.

Commit: `feat(swc): transform pug templates in swc pipeline`

### Task 3.3: Diagnostic position mapping support

- [ ] Add helper API for mapping SWC parse/type/lint style diagnostics back to original.

Tests:
- [ ] Mapping tests on files with multiple pug regions and nested interpolation.

Commit: `feat(swc): add diagnostic mapping helpers`

---

## Phase 4: ESLint Plugin Package

### Task 4.1: Scaffold package

- [ ] Create package `packages/eslint-plugin-react-pug`.
- [ ] Implement processor-based approach for `*.ts,*.tsx,*.js,*.jsx`.

Tests:
- [ ] Smoke tests for processor registration and invocation.

Commit: `feat(eslint): scaffold eslint plugin with processor`

### Task 4.2: Implement preprocess/postprocess mapping

- [ ] Preprocess: replace pug regions using core runtime-safe transform for linting.
- [ ] Postprocess: remap lint message locations back to original source.
- [ ] Preserve filenames and virtual file naming expected by ESLint.

Tests:
- [ ] Real ESLint runs with common rules (e.g. `no-undef`, `no-unused-vars`) on pug content.
- [ ] Verify reported line/column points to original pug ranges.
- [ ] Verify no false remapping for non-pug sections.

Commit: `feat(eslint): remap lint diagnostics from transformed pug back to source`

---

## Phase 5: esbuild Plugin Package

### Task 5.1: Scaffold package

- [ ] Create package `packages/esbuild-plugin-react-pug`.
- [ ] Export `reactPugPlugin(options)`.

Tests:
- [ ] Plugin registration smoke test.

Commit: `feat(esbuild): scaffold esbuild plugin package`

### Task 5.2: Implement onLoad transform

- [ ] Intercept TS/TSX/JS/JSX sources and apply core runtime transform.
- [ ] Return loader and sourcemap-friendly output.
- [ ] Ensure plugin composes with existing esbuild pipelines.

Tests:
- [ ] esbuild build tests with entry files using pug templates.
- [ ] Verify emitted JS is valid and behaviorally equivalent.

Commit: `feat(esbuild): compile pug templates in esbuild onLoad pipeline`

### Task 5.3: Source map and diagnostic mapping helpers

- [ ] Expose map utilities for external tooling / custom error reporting.

Tests:
- [ ] Map consistency tests vs core expected offsets.

Commit: `feat(esbuild): add sourcemap and diagnostic mapping utilities`

---

## Phase 6: Cross-Package Quality + Documentation

### Task 6.1: Coverage hardening

- [ ] Add shared fixtures reused across Babel/SWC/esbuild/ESLint tests.
- [ ] Add stress tests (complex nested interpolations, mixed control flow).
- [ ] Add regression tests for all discovered failures.

Commit: `test: add shared fixture matrix across compiler integrations`

### Task 6.2: DX scripts

- [ ] Add top-level scripts to run package-specific tests and all compiler tests.
- [ ] Ensure CI includes new test jobs.

Commit: `chore: wire compiler integration tests into scripts and CI`

### Task 6.3: Documentation

- [ ] Update README with new packages and usage snippets.
- [ ] Update architecture with compiler integration architecture.

Commit: `docs: add compiler integration architecture and usage`

---

## Definition of Done

- [ ] All new packages exist and have tested transform paths.
- [ ] Existing VS Code + TS plugin tests stay green.
- [ ] Compiler plugin tests are green across Babel/SWC/ESLint/esbuild.
- [ ] Mapping behavior is covered by automated tests for key failure-prone cases.
- [ ] README + architecture updated.
