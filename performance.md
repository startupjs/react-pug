# Performance Notes

This document describes the current performance profile of `react-pug`.

It is not meant to be a speculative optimization wishlist. It is meant to tell a fresh agent:

- where time is actually spent
- which surfaces are cheap vs expensive
- which optimizations are realistic
- which optimizations are not worth the complexity right now

## 1. Executive Summary

For normal usage today:

- TypeScript language-service work is still the main editor cost, not Pug code generation
- embedded style completion in VS Code remains the most latency-sensitive feature we own directly
- ESLint is more expensive than raw runtime transforms because it now has dual lint surfaces and formatter passes, but it is still usually dominated by ESLint rule execution itself
- Babel/SWC/esbuild wrappers are thin over core and are not the dominant build bottleneck in normal projects
- detailed source maps cost more than plain transforms, but source-map fidelity is still the correct tradeoff for this repo

The current codebase is in a reasonable place performance-wise. Correctness work is still higher value than speculative optimization.

## 2. Main Performance Surfaces

There are four distinct performance surfaces.

1. TypeScript / tsserver path
2. VS Code extension path
3. compiler/runtime transform path
4. ESLint processor path

They have different cost centers and should not be discussed as if they were one system.

## 3. TypeScript Plugin Performance

### 3.1 What the plugin does

The TS plugin:

- detects whether a file contains Pug regions
- builds or serves a shadow TSX representation
- asks the normal TS language service to work on the shadow code
- remaps results back to original source

### 3.2 What costs time

Most cost here is still from TypeScript itself:

- semantic analysis
- completion generation
- symbol lookup/navigation
- large project graph state

The extra Pug-specific cost is:

- region extraction
- shadow transform
- mapping/query helpers

That extra cost is meaningful, but in practice it is still secondary to TS language-service work in large projects.

### 3.3 Recent architectural improvement

The repo now has shared mapping/query helpers in core for:

- original <-> shadow spans
- raw/stripped region offsets
- classification remapping
- nearby same-line fallback

That matters for performance mostly because it reduces duplicated work and drift. It is more of a stability/maintainability win than a dramatic speed win.

### 3.4 What to optimize first if the TS path becomes slow

Recommended order:

1. cache document analysis per document version
2. cache compiled region results per document version
3. profile completion-heavy scenarios before doing anything more invasive

Do **not** jump straight to incremental AST diffing or background recomputation unless profiling shows real pain.

## 4. VS Code Extension Performance

### 4.1 TextMate highlighting

Grammar-based highlighting is cheap.

It is handled by VS Code tokenization and is usually not the bottleneck. Most bugs there are correctness bugs, not speed bugs.

### 4.2 Embedded style completions

This is the most performance-sensitive editor feature we own directly.

When completion is requested inside a terminal Pug `style(...)` block, the extension must:

1. detect whether the cursor is inside a style block
2. recover the extracted style content and cursor mapping
3. update or create a hidden virtual style document
4. delegate to VS Code's CSS/SCSS/Sass/Stylus providers
5. map edits back to the real file

This is localized work, but it is the most likely place for perceived latency while typing.

### 4.3 What is already good enough

The extension does not generally make editing outside Pug slow. The expensive work is localized to:

- requests inside Pug
- especially requests inside embedded style blocks

That means broad repo-wide performance claims about the extension are usually misleading.

## 5. Runtime / Compiler Adapter Performance

The build adapters are:

- Babel plugin
- SWC wrapper
- esbuild plugin

All three reuse `transformSourceFile(...)` from core.

### 5.1 Shared costs

Common work across all of them:

- find tagged templates
- compile Pug regions
- optionally extract and relocate terminal style blocks
- build source maps or mapping metadata when requested

This work is mostly linear in file size and especially in transformed Pug region size.

### 5.2 Babel

Babel has two source-map modes.

#### `basic`

Cheaper and simpler.

- replaces matched tagged-template expressions during traversal
- keeps normal Babel ownership of the rest of the file
- mapping inside transformed Pug is intentionally coarse

#### `detailed`

More expensive.

- pretransforms full source through core
- attaches inline source map
- uses `parserOverride`
- allows downstream Babel stages to compose better mappings

Use `basic` unless detailed source-map fidelity is actually needed.

### 5.3 SWC

SWC integration is usually fast enough that the core transform is the main custom cost. Nothing in the current repo suggests SWC-specific optimization is urgent.

### 5.4 esbuild

Same general story as SWC.

The esbuild wrapper is thin. If performance becomes a problem, it is more likely to be because of:

- many transformed files
- large Pug regions
- source-map generation

not because of esbuild wrapper logic itself.

## 6. ESLint Processor Performance

This is the most structurally complex performance surface after the editor path.

### 6.1 What the processor now does

For files with Pug regions, the processor can do all of the following:

- main lint-oriented transform through core
- final formatting convergence passes
- embedded source-faithful lint blocks for JS inside Pug
- postprocess remapping back to original source
- embedded autofix reconstruction

This is more work than a plain preprocess/postprocess processor.

### 6.2 Why this is still acceptable

Even though the processor is heavier than before:

- ESLint rule execution is still often the main lint cost in real projects
- the extra work is only paid on files with Pug regions
- the added cost buys major UX improvements in diagnostics and autofix correctness

That is the right tradeoff for this repo.

### 6.3 What is expensive in the ESLint path

The most expensive parts are:

- formatter convergence passes
- embedded-source lint block generation when there are many JS sites in a file
- fix reconstruction for complex embedded/multiline attr cases

### 6.4 What not to optimize prematurely

Do not optimize away the second lint surface or embedded autofix reconstruction just because they add work.

They exist to preserve user-facing correctness, and the current repo direction explicitly values that over a small amount of lint-time speed.

## 7. Source Map and Mapping Costs

Source maps and mapping helpers are not free.

Current mapping costs come from:

- generated/original offset tables
- region boundary maps
- shadow query helpers
- serialized source-map generation for compiler adapters

But these are still justified because this repo is fundamentally a tooling project. Mapping fidelity is part of the product.

A fast transform with bad remapping would be the wrong tradeoff.

## 8. What We Learned From Recent Refactors

Recent work matters for performance interpretation.

### 8.1 Shared helpers reduced drift more than raw time

Moving mapping/query helpers into core probably did not create a dramatic speedup by itself. What it did do is:

- reduce duplicate work
- reduce repeated bespoke edge-case logic
- make future optimization easier because behavior is centralized

### 8.2 ESLint got more expensive but more correct

The ESLint processor now does more work than earlier versions because it supports:

- source-faithful embedded JS diagnostics
- source-faithful embedded autofix
- attr-container reconstruction for multiline fixes

This should be treated as intentional product scope, not accidental overhead.

### 8.3 Vendored lexer fixes were correctness work, not performance work

Recent lexer improvements for multiline `p= ...` and multiline `#{...}` are not primarily performance changes. They are correctness changes that prevent fallback and recovery paths from doing extra work.

## 9. Recommended Optimization Order

If performance work becomes necessary, the recommended order is:

1. cache document analysis per document version
2. cache compiled Pug region results per document version
3. reuse hidden embedded style documents more aggressively
4. optimize serialized source-map generation if profiling shows it matters
5. only then consider more invasive approaches such as incremental reuse or specialized fast paths

## 10. Things That Are Probably Not Worth It Right Now

Avoid these unless profiling shows real user pain:

- whole-file incremental diffing for Pug transforms
- background precomputation machinery for editor features
- separate fast-path parsers that drift from canonical transform logic
- replacing the hybrid text/mapping architecture with a full-file AST reprint system in the name of speed

Those changes would make the codebase harder to support and are not justified by current evidence.

## 11. Practical Profiling Guidance

If you need to investigate a slowdown, isolate which surface you are on first.

Questions to ask:

1. Is this editor latency or build/lint latency?
2. Is it inside Pug, inside a style block, or outside Pug?
3. Is the time spent in our transform or in the underlying tool (TS, ESLint, Babel, VS Code CSS provider)?
4. Is the issue in mapping/query helpers, or in repeated re-analysis of unchanged documents?

Use real consumer repos when they are available locally or when there is an explicit local validation setup for them. Common public validation targets used by this repo include:

- `../startupjs`
- `../startupjs-ui`

They are better performance signals than synthetic micro-benchmarks.

## 12. Current Recommendation

Do not optimize preemptively.

Current priorities are still correct:

- correctness of transforms
- correctness of diagnostics/fix mapping
- stable editor behavior
- stable autofix behavior
- maintainable shared architecture

The only area that still looks like an obvious future performance target is embedded style completions in the VS Code extension. Everything else is currently in a reasonable place for normal project sizes.
