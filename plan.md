# Current Plan / Status / Roadmap

This document is the current working roadmap for the repo.

It is not just a historical refactor plan anymore. A fresh agent should be able to read this file and understand:

- what has already landed
- what architectural decisions are now intentional
- what remains incomplete
- what to validate before shipping changes
- which tempting directions are intentionally *not* the plan

## 1. Current State

The repo is in a materially better state than before the recent architecture work.

What has already landed:

- shared mapping/query helpers moved into `react-pug-core`
- lint-oriented semantic normalization moved into `react-pug-core`
- ESLint processor no longer owns core semantic lint rewrites
- embedded JS inside Pug now has a source-faithful lint surface
- embedded-source autofix reconstruction is implemented and stable for complex multiline cases
- multiline valid `p= ...` and `#{...}` carriers are supported in the vendored lexer
- multiline `${...}` handling was hardened in core
- attr expression emission no longer misclassifies concatenated expressions as string literals
- multiline attr-container autofix reconstruction is now stable and covered by regression tests

This means the main architecture direction is no longer speculative. It is the current baseline.

## 2. Current Architectural Decisions

### 2.1 Keep the hybrid text-and-mapping model

We are **not** moving to a whole-file Babel IR / AST-reprint architecture.

The intended model remains:

- text-based source transform backbone
- explicit copied segments and synthetic insertions
- rich mapping metadata
- region-level structural analysis where needed

Reason:

- mapping fidelity matters more than whole-file AST uniformity
- untouched code should stay untouched whenever possible
- editor/lint flows need more than plain AST node locations

### 2.2 Keep shared logic in core, adapter logic in adapters

Current boundary:

- parsing, compilation, mapping, query helpers, and lint-oriented semantic rewrites belong in `react-pug-core`
- environment-specific orchestration belongs in adapters
  - TS plugin
  - VS Code extension
  - ESLint processor
  - Babel/SWC/esbuild wrappers

### 2.3 Prefer transform/model fixes over suppression

Recent work repeatedly confirmed the right rule:

- if a bug is structural, fix the structure or mapping
- do not paper over it with broad suppressions

Suppressions remain acceptable only for truly synthetic generated artifacts where user-authored semantics cannot be reconstructed safely.

## 3. What Is Good Today

### 3.1 Core / parser / transform correctness

Strong areas now:

- multiline `p= ...`
- multiline `#{...}`
- multiline `${...}`
- TS syntax in expression carriers
- attr expression classification
- shared region/query mapping helpers

### 3.2 TS plugin / VS Code

Strong areas now:

- shadow-document mapping model is centralized in core
- TS plugin is thinner and more adapter-like
- classification / completion / hover / diagnostic remapping is well covered
- TextMate comment/string leakage issues were fixed

### 3.3 ESLint UX

Strong areas now:

- source-faithful JS diagnostics inside common embedded Pug JS sites
- source-faithful autofix for embedded JS sites
- stable multiline attr-container autofix reconstruction
- reduced transformed-surface stylistic noise
- validation against real consumer repos (`startupjs`, `startupjs-ui`)

## 4. Current Known Limitations

These are real boundaries, not surprises.

### 4.1 Generated-JSX-surface fixes are still weaker than embedded-source fixes

The strongest autofix contract today is for source-faithful embedded JS sites inside Pug.

Generated-JSX-surface fixes are not yet reconstructed back to original Pug with the same generality.

This should stay documented as a known limitation.

### 4.2 Multiline unbuffered `- ...` statements are still a narrower case

Single-line unbuffered code is well supported.

Multiline unbuffered `- ...` should not be forced into the same contract as multiline `=`/`#{}` without a cleaner design, because it overlaps with existing Pug statement-body semantics.

### 4.3 Internal formatter still depends on deprecated `@stylistic/jsx-indent` / `@stylistic/jsx-indent-props`

This remains a known follow-up.

Important historical note:

- one serious attempt to remove it already failed because formatter convergence regressed and real consumer behavior drifted

So this is not a "small cleanup". It is dedicated future work.

### 4.4 Embedded-source rule coverage is intentionally narrower than transformed-surface rule coverage

The embedded lint surface is intentionally trusted for:

- stylistic rules
- a narrow set of safe local rules

It is **not** a full replacement for the main transformed lint surface.

That is by design, because isolated embedded snippets do not always preserve full surrounding scope.

## 5. Most Important Operational Knowledge

These are the things a new agent should know immediately.

### 5.1 For local ESLint validation in consumer repos, override both plugin and core

If a consumer repo uses local `eslint-plugin-react-pug` code but published `react-pug-core`, preprocess can fail because the plugin expects newer core data.

For local testing, override both:

- ESLint plugin package actually used by the consumer repo
- `@react-pug/react-pug-core`

The same rule applies to releases:

- plugin and core need to ship as a coherent pair
- validating a new plugin against an older published core is not a meaningful signal

### 5.2 Real repo validation matters

Synthetic tests are necessary, but real-project validation is also important when those repos are available locally or when there is an explicit process for validating against them.

Common public validation targets used by this repo include:

- `../startupjs`
- `../startupjs-ui`

Use them for tricky lint/autofix behavior when they are available. Do not assume every checkout has them in the same parent directory.

### 5.3 If an ESLint bug looks structural, first ask whether it is really a lexer/core bug

Several issues first discovered through ESLint turned out to be:

- lexer carrier limitations
- core expression-emission problems
- shared mapping math bugs

Do not assume every lint bug belongs in the ESLint plugin.

## 6. Current High-Value Follow-Ups

These are the best next candidates for meaningful work.

### 6.1 Broaden cross-library regression coverage for shared bug classes

We fixed several issues in shared layers because ESLint exposed them.

What is still worth adding:

- wrapper-level Babel/SWC/esbuild smoke coverage for:
  - multiline `p= (() => { ... })()`
  - multiline `#{(() => { ... })()}`
  - multiline `${(() => { ... })()}`
  - concatenated attr expressions
- at least one TS-plugin smoke test covering valid multiline embedded expressions end to end

This is a testing gap more than a production-code gap.

### 6.2 Revisit generated-JSX-surface fix mapping later

This is still a future architecture task.

Important rule:

- do not attempt direct raw range projection of generated-surface fixes back into original Pug

If we do this later, it must be through a proper reconstruction model, not a quick remap.

### 6.3 Eventually remove internal `jsx-indent` dependency

Still worth doing, but only as dedicated work with strong real-project validation.

### 6.4 Keep strengthening exact-output tests

The recent shift away from overly loose `toContain(...)` assertions toward exact inline snapshots was the right move.

Continue that for cases where the full emitted text is the actual contract.

## 7. Things We Should Not Do Right Now

### 7.1 Do not add broad suppressions to quiet complex lint/autofix cases

That would undo the recent architecture progress.

### 7.2 Do not move to a full-file AST reprint pipeline for the sake of uniformity

That would likely make mapping harder, not easier.

### 7.3 Do not chase performance optimizations before profiling

Correctness and contract clarity are still the higher-value work.

### 7.4 Do not over-unify VS Code TextMate highlighting with the TS/shadow architecture

They are related only loosely. Treat them as separate surfaces.

## 8. Validation Checklist For Risky Changes

For any risky transform/mapping/ESLint work, the default validation checklist should be:

1. targeted relevant unit/integration tests
2. full `npm test`
3. targeted validation in a relevant real consumer repo when one is available locally
4. if the public validation repos are available, prefer `../startupjs` and `../startupjs-ui`
5. if the bug came from another real repo, validate against that repo too when feasible

For ESLint work specifically:

1. verify diagnostics
2. verify `eslint --fix`
3. inspect resulting fixed output visually
4. ensure no corruption of surrounding attr containers / embedded sites

## 9. Current Success Criteria For The Repo Direction

The repo is in a good place if all of these remain true:

- core remains the source of truth for shared transform and mapping logic
- adapters remain relatively thin
- ESLint keeps accurate diagnostics without broad suppressions
- embedded-source autofix stays stable and non-corrupting
- real consumer repos continue to behave correctly
- tests keep growing stronger where output shape is the contract

## 10. Recommended Next Steps

If continuing immediately from the current repo state, the best next steps are:

1. add cross-library regression coverage for the shared bug classes discovered through ESLint
2. keep documenting explicit contract boundaries when we decide not to support something yet
3. only then consider larger follow-up work like generated-surface fix reconstruction or removal of deprecated formatter dependencies

## 11. Fresh-Agent Reading Order

If you are starting fresh in this repo, the recommended reading order is:

1. `architecture.md`
2. `plan.md`
3. `performance.md`

Then inspect the relevant package for your task.

That order should give enough context to avoid repeating solved design mistakes.
