# Performance Notes

This document describes the current performance profile of `react-pug`, with focus on:

1. the VS Code extension and TypeScript language-service path
2. the compiler/lint integrations
3. realistic future optimizations and their tradeoffs

It is intentionally practical. The goal is to explain where time is spent, what is cheap, what is expensive, and which improvements are worth the added complexity.

## Summary

For typical usage:

- the VS Code extension cost is dominated by TypeScript language-service work, not by the Pug transform itself
- embedded `style(...)` completions are the most expensive editor-time feature added so far
- compiler integrations are comparatively cheap because they already operate in a build pipeline that parses/transforms source files anyway
- source-map generation is more expensive than plain transformation, but still not the main bottleneck in normal builds

The codebase is currently in a good place performance-wise. There are clear optimization opportunities, but most of them should only be implemented if real latency is observed in large projects.

## VS Code Extension Performance

The VS Code extension has two main performance surfaces:

1. TypeScript/JavaScript IntelliSense inside `pug\`...\``
2. embedded language support for terminal `style(...)` blocks

These have different cost profiles.

### TypeScript Plugin and Shadow Documents

Most IntelliSense features inside Pug are powered by the TypeScript language-service plugin. The plugin:

- finds Pug tagged templates
- compiles them into a shadow TSX representation
- asks the normal TS language service to work against that shadow code
- maps diagnostics, hover, completions, definitions, references, edits, and similar results back into original Pug positions

Current cost characteristics:

- Finding tagged templates requires parsing the file structure.
- Compiling Pug to TSX is linear in the size of the relevant Pug region.
- Mapping results back to original source is relatively cheap once region metadata exists.
- The heaviest part is usually still TypeScript itself, especially semantic analysis and completion generation.

Practical implication:

- normal editing outside Pug is not meaningfully affected by Pug logic
- editing inside Pug pays some extra shadow-document and mapping cost
- large TS projects will still mostly be limited by TS language-service performance, not by `react-pug`

### TextMate Highlighting

Syntax highlighting for Pug and embedded style languages is comparatively cheap.

It is grammar-based and handled by VS Code tokenization. The extension contributes:

- a TextMate injection grammar for Pug template literals
- embedded language scopes for CSS, SCSS, Sass, and Stylus regions

Current cost characteristics:

- low runtime overhead
- no heavy AST or TypeScript work involved
- mostly limited by VS Code's normal tokenization pipeline

Practical implication:

- highlighting itself is not a significant performance concern
- incorrect scope mapping is more likely to be a correctness problem than a speed problem

### Embedded `style(...)` IntelliSense

This is currently the most performance-sensitive editor feature.

When completion is requested inside a terminal Pug `style(...)` block, the extension:

1. analyzes the current source to find whether the cursor is inside a style block
2. recompiles the relevant Pug region enough to recover the extracted style content
3. maps the real cursor position into the stripped embedded style document
4. opens or updates a hidden virtual document with the correct embedded language id
5. asks VS Code's CSS/SCSS/Stylus/Sass provider for completions
6. maps completion edits back into the real file

Current cost characteristics:

- this cost is paid only when VS Code asks for completions at a position in a JS/TS file
- it is most noticeable during explicit completion or auto-triggered suggestion while typing in a `style(...)` block
- it does not broadly slow down editing elsewhere in the file

Practical implication:

- the overhead is localized
- the most likely place to notice latency is repeated auto-triggered completion inside large Pug style blocks

### Style Language Support Caveat

Performance and support are different concerns, but they interact.

Current editor support matrix:

- `css`: built-in VS Code support
- `scss`: built-in VS Code support
- `styl`: requires `sysoev.language-stylus`
- `sass`: requires `Syler.sass-indented`

If the underlying VS Code language support is missing, completion/highlighting quality drops regardless of `react-pug` performance.

### Cost of Current Import/Style Diagnostics

The extension and TS plugin also perform extra checks such as:

- `requirePugImport`
- automatic removal of used `pug` imports in shadow output
- style-block placement validation

These checks are cheap compared to:

- TypeScript semantic operations
- completion requests

They piggyback on parsing or transform passes that already exist.

## Compiler and Lint Integration Performance

Published runtime/build packages:

- `@react-pug/babel-plugin-react-pug`
- `@react-pug/swc-plugin-react-pug`
- `@react-pug/esbuild-plugin-react-pug`
- `@react-pug/eslint-plugin-react-pug`

All of them reuse `@react-pug/react-pug-core`.

### Common Shared Costs

Across build/lint integrations, the main work is:

- locating matching tagged templates
- compiling Pug content into JSX/TSX-like output
- optionally extracting and relocating terminal `style(...)` blocks
- optionally generating source maps back to original Pug ranges

The transform itself is generally linear in the size of the input file and especially in the size of the matched Pug regions.

### Babel Plugin

Babel has two source-map modes:

- `basic`
- `detailed`

#### `basic`

In `basic` mode, Babel replaces only matched `pug` tagged-template expressions and lets normal Babel parsing/transformation handle the rest.

Performance characteristics:

- relatively cheap
- best compatibility/lowest complexity mode
- coarse mapping inside transformed Pug, but fine for many build setups

#### `detailed`

In `detailed` mode, the plugin rewrites the source and attaches a granular input source map so later Babel stages can preserve detailed mapping into Pug.

Performance characteristics:

- more expensive than `basic`
- more source-map work
- still practical for normal builds

Main takeaway:

- if detailed source maps are not important, `basic` is the cheaper and simpler mode
- if debugger fidelity matters, `detailed` is the right tradeoff

### SWC Plugin

SWC integration is generally efficient because SWC is fast at baseline.

Current cost characteristics:

- transform cost is mostly the Pug compile and shared source-transform work
- source maps add overhead, but SWC itself is not the bottleneck here

Practical implication:

- SWC is likely to remain one of the fastest integration paths for production builds

### esbuild Plugin

esbuild integration is also efficient at baseline.

Current cost characteristics:

- Pug analysis/transform is a custom pre-step around an otherwise very fast pipeline
- source-map generation is the main extra cost beyond raw transformation

Practical implication:

- for projects already using esbuild, `react-pug` should not be the dominant build-time cost unless files contain very large or numerous Pug regions

### ESLint Processor

The ESLint processor preprocesses files before rules run.

Performance characteristics:

- there is transform overhead before lint rules execute
- however, linting itself is usually already expensive enough that the Pug preprocessing is not the dominant cost
- no source-map emission is required in the same sense as Babel/SWC/esbuild output maps

Practical implication:

- lint-time overhead is acceptable
- performance pain in ESLint runs is more likely to come from ESLint rules than from the Pug preprocessing layer

## Source Map Performance

Source maps have a real cost, but they are still secondary compared to correctness.

Current implementation uses:

- in-memory mapping structures for editor remapping
- `@jridgewell/gen-mapping` for serialized compiler-facing maps

Performance characteristics:

- generating detailed source maps is more expensive than plain code emission
- mapping work scales with transformed output size
- current implementation is correct and maintainable, even if not maximally optimized

Important practical point:

- source-map generation is not free
- but removing fidelity to save a small amount of time would be a poor tradeoff for a tooling project like this

## Future Performance Improvements

This section lists realistic future optimizations, with two separate costs:

- implementation difficulty
- long-term maintenance cost

Difficulty scale:

- Low
- Medium
- High

Maintenance scale:

- Low
- Medium
- High

### 1. Cache Pug Analysis Per Document Version

Idea:

- cache `extractPugAnalysis(...)` results keyed by document URI + version
- reuse for repeated hover/completion/definition requests against the same unchanged document

Expected benefit:

- reduces repeated full-file parsing in the VS Code extension
- especially useful when many editor requests hit the same file in quick succession

Implementation difficulty:

- Low to Medium

Maintenance cost:

- Low

Tradeoff:

- strong candidate for future optimization
- good payoff without making the codebase much harder to support

### 2. Cache Compiled Pug Region Results Per Document Version

Idea:

- cache `compilePugToTsx(...)` output per region after analysis
- reuse when repeated editor requests target the same region

Expected benefit:

- reduces repeated compilation cost for the same Pug block
- especially useful for embedded style completion and repeated IntelliSense in one template

Implementation difficulty:

- Medium

Maintenance cost:

- Medium

Tradeoff:

- worthwhile if editor latency becomes noticeable
- adds more cache invalidation complexity than analysis caching

### 3. Reuse Hidden Embedded Style Documents More Aggressively

Idea:

- maintain stable virtual style documents per source document + region identity
- update contents instead of creating many short-lived virtual docs

Expected benefit:

- reduces document creation churn
- may help repeated completion scenarios inside the same style block

Implementation difficulty:

- Medium

Maintenance cost:

- Medium

Tradeoff:

- useful if style completions become a hotspot
- manageable, but requires careful lifecycle handling and cleanup

### 4. Incremental Region Reuse Instead of Reanalyzing Whole File

Idea:

- reuse previous analysis and update only affected regions after edits

Expected benefit:

- potentially significant on large files with multiple Pug templates

Implementation difficulty:

- High

Maintenance cost:

- High

Tradeoff:

- this would add substantial complexity
- likely not worth it unless profiling shows a real bottleneck in very large codebases

Recommendation:

- avoid for now

### 5. Build Source Maps Directly From Region Segments Instead of Character Scanning

Idea:

- generate serialized maps from structured mapping segments instead of scanning generated output character-by-character

Expected benefit:

- better source-map generation performance
- cleaner asymptotics for large transformed outputs

Implementation difficulty:

- Medium to High

Maintenance cost:

- Medium

Tradeoff:

- promising if compiler-side source-map generation becomes measurable in large builds
- still more specialized and harder to reason about than the current straightforward implementation

Recommendation:

- reasonable future optimization, but not urgent

### 6. Specialized Fast Path for Completion-Only Style Context Lookup

Idea:

- use a lighter lookup path for "am I inside a style block and where?" without recompiling more than necessary

Expected benefit:

- lower latency for embedded style completions

Implementation difficulty:

- Medium

Maintenance cost:

- Medium to High

Tradeoff:

- fast paths tend to drift from the canonical transform logic
- that increases correctness risk over time

Recommendation:

- only do this if profiling shows style completions are still too slow after caching

### 7. Worker/Background Precomputation for Editor Features

Idea:

- precompute region analysis or style extraction off the critical request path

Expected benefit:

- could improve perceived completion latency

Implementation difficulty:

- High

Maintenance cost:

- High

Tradeoff:

- complexity is disproportionate for the current size of the problem
- risks subtle consistency bugs between editor state and cached background results

Recommendation:

- not recommended unless the project grows far beyond current usage

## Recommended Optimization Order

If performance work becomes necessary, the recommended order is:

1. Cache document analysis per document version
2. Cache compiled region results per document version
3. Reuse embedded style virtual documents more aggressively
4. Optimize serialized source-map generation
5. Consider any incremental/fast-path architecture only if profiling still shows real latency

This order keeps the codebase maintainable while addressing the most likely hotspots first.

## Current Recommendation

Do not optimize preemptively beyond documentation and basic profiling.

Current implementation priorities are correct:

- correctness of mapping
- correctness of IntelliSense behavior
- stable compiler behavior
- understandable shared transform logic

At the moment, the only area likely to justify further performance work soon is embedded style completions in the VS Code extension. Everything else is already in a reasonable place for normal project sizes.
