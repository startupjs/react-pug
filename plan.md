# Core / ESLint / TS / VSCode Architecture Revamp Plan

## Context
We found recurring false positives in real consumer repos (`../startupjs`, `../startupjs-ui`) even when the runtime transform was semantically correct:

- `react/jsx-fragments` on Pug `Fragment`
- `no-unneeded-ternary` on Pug `if / else`
- `@stylistic/no-multi-spaces` mapped to `return pug\`` due to inline region formatting
- previous cases around `jsx-indent`, `Provider(value=true)`, legacy `styl\`...\`` warnings, and comment-triggered VS Code highlighting leakage

These are not isolated fixture bugs. They expose a structural issue:

- one transform pipeline is currently serving multiple consumers with different needs
- the ESLint plugin has grown extra logic to compensate for code shape problems after the core transform is already done
- too much of the correction currently happens in the ESLint plugin string-formatting layer instead of in a stable semantic layer

## Problems Identified

### 1. Runtime-correct JSX is not automatically lint-correct JSX
Examples:
- attrless `Fragment` lowers to `<Fragment>...</Fragment>`, which is runtime-correct but conflicts with `react/jsx-fragments`
- `if children ... else ...` lowers to a ternary, which is runtime-correct but can conflict with `no-unneeded-ternary`

### 2. Semantic lowering and lint normalization are mixed into the ESLint plugin
Current plugin responsibilities include:
- source transform orchestration
- lint-only AST normalization
- prettier pass
- internal ESLint stylistic pass
- custom indentation normalization
- range remapping

This makes the plugin too stateful and too responsible for semantics that should live closer to the core transform.

### 3. Region rewriting is ad hoc
We currently need to rewrite transformed Pug regions for linting, but the pipeline for doing so is local to the ESLint plugin.
That means:
- harder reuse
- harder testing
- harder reasoning about mappings

### 4. String-format corrections are too late in the pipeline
Some bugs were not semantic bugs at all; they came from splicing formatted regions back into surrounding code, especially when a Pug region starts inline (for example after `return `).

## Architecture Direction

### Goal
Split responsibilities more cleanly:

- `react-pug-core` owns semantic/lint-specific normalization of Pug-generated JSX
- the ESLint plugin owns only:
  - invoking the lint-oriented core transform path
  - final stylistic shaping / formatter passes
  - diagnostic/fix remapping

### Explicit Boundary
This branch should enforce one clear rule:

- if logic changes the semantic/code-shape of generated Pug JSX in a lint-aware but semantics-preserving way, it belongs in `react-pug-core`
- if logic only formats already-normalized JSX for stylistic convergence under ESLint, it stays in the ESLint plugin

That means the plugin must stop owning:
- JSX fragment normalization
- conditional-expression simplification
- generic region-rewrite infrastructure

And the core should not grow:
- prettier passes
- internal stylistic ESLint formatting
- rule-specific diagnostic suppression

### New Core Concepts

#### A. Lint normalization of transformed Pug regions
Add a core lint-normalization layer which works on already generated JSX expressions from Pug regions and performs **semantics-preserving, lint-oriented** normalization.

Examples:
- attrless `Fragment` / `React.Fragment` -> fragment shorthand
- safe repeated ternaries like `x ? x : y` -> `x || y`

Important constraint:
- only perform transformations proven safe and repeatable
- do not broaden rewrites just to silence rules

#### B. Generic mapped-region rewriting helper
Add a core helper that can rewrite only Pug-mapped regions while preserving mapping back to the base transformed output.

This helper should:
- iterate only mapped Pug regions
- allow rewriting region text
- generate boundary maps from rewritten region back to original transformed region
- expose mapping from rewritten offsets back to the base transform

This is generic and reusable, not ESLint-specific.

#### C. Lint-oriented transform result
Expose a core helper that produces a lint-oriented transform result from runtime output.

This result should provide:
- `code` for lint consumers
- mapping from lint-oriented output back to original source
- access to the underlying base transform/document for downstream mapping

This becomes the semantic input to the ESLint plugin.

## Target State

### Core
Add something conceptually like:
- `normalizePugExpressionForLint(...)`
- `rewriteMappedPugRegions(...)`
- `createLintTransform(...)`

### ESLint plugin
The plugin should:
1. call core runtime transform
2. call core lint transform / lint normalization helper
3. run final formatting pass on the lint-oriented code
4. remap diagnostics from formatted -> lint transform -> original source

The plugin should no longer own lint-specific AST normalization logic itself.

## Constraints / Non-Goals

- no broad suppressions for rule classes
- do not weaken diagnostics for real JS/TS code inside Pug
- do not relax existing correctness checks just to get green tests
- keep the old narrow, justified exceptions only where they are fundamentally synthetic (`styl\`...\`` wrapper statements, etc.)
- do not change Babel / TS / runtime semantics for non-lint consumers unless required and proven safe

## Architectural Decision

### We are not moving to a full-file Babel IR pipeline
We explicitly do **not** want to replace the current shadow/document pipeline with:

- parse the whole file into Babel AST
- generate the whole transformed file from AST
- use Babel node locations as the primary metadata model

That would not simplify the hardest part of this codebase. Our main problem is not syntax generation; it is:

- precise original-to-generated mapping
- preserving untouched source outside Pug regions
- keeping stable copied/synthetic spans for TS, ESLint, and editor tooling
- carrying feature-level mapping metadata, not just AST node locations

### Chosen model
The intended architecture is a **hybrid**:

- keep the file/document pipeline text-and-mapping based
- keep explicit copied slices and synthetic insertions
- use Babel structurally where it gives us leverage:
  - region-level lint normalization
  - structural container/context classification
  - future region-level formatting metadata when justified

### Why this is the right tradeoff
This gives us:
- stable mapping fidelity
- minimal rewriting outside transformed Pug regions
- fewer whole-file formatting side effects
- structural reasoning where it actually reduces edge cases

So the goal of this branch is **not** “move to Babel for everything”.
The goal is:
- keep the current mapping architecture
- keep moving structural decisions into explicit core contracts
- avoid whole-file AST reprint pipelines unless there is a compelling reason later

## Implementation Tasks

### Phase 1. Capture the architecture in code
1. Add a new core module for lint normalization of JSX expressions.
2. Add a new core module/helper for rewriting mapped Pug regions with preserved mapping to the base transform.
3. Export these helpers from `@react-pug/react-pug-core`.
4. Add the Babel generator/types dependencies to `react-pug-core`, since semantic lint normalization now lives there instead of in the ESLint plugin.

### Phase 2. Move semantic lint fixes into core
5. Move the current `Fragment` normalization logic from the ESLint plugin into core.
6. Move the safe repeated-ternary normalization logic from the ESLint plugin into core.
7. Add focused unit tests in core for these transformations.
8. Add direct mapping assertions in core tests so we verify rewritten offsets still map to the correct original Pug spans.

### Phase 3. Introduce a core lint transform path
9. Build a core helper which produces lint-oriented code plus mapping back to original source.
10. Add core tests which verify:
   - rewritten code is as expected
   - mapping survives region rewriting
   - only Pug regions are rewritten
   - non-Pug code on the same line or in the same file is not touched

### Phase 4. Thin the ESLint plugin
11. Remove moved AST normalization logic from the ESLint plugin.
12. Update the plugin to consume the new core lint transform path.
13. Keep only formatter-specific logic in the plugin:
   - prettier
   - stylistic pass
   - indentation/closing-bracket normalization
   - remapping from formatted code back through the core lint transform
14. Remove now-duplicated parser/token/boundary-map utilities from the plugin where they are replaced by core utilities.

### Phase 5. Strengthen tests
15. Expand existing ESLint integration tests with the new startupjs-ui repro fixtures.
16. Keep autofix tests for those files.
17. Keep diagnostics snapshot tests for those files.
18. Add core-level tests for lint normalization behavior so we do not rely only on plugin integration tests.
19. Tighten any tests that were previously only checking “no diagnostics” by also checking the specific false-positive rule classes where appropriate.
20. Keep real-project compiler snapshots updated if the lint-preprocess output changes for good reasons.

### Phase 6. Real-project validation
21. Validate `npm test` in this repo.
22. Validate full ESLint in `../startupjs-ui` using the local file-based override.
23. Validate relevant ESLint behavior in `../startupjs` using the local file-based override.
24. Check that the VS Code grammar/highlighting fix still behaves correctly and does not regress during refactor.

## Current Branch Intent

The specific implementation target for this branch is:

1. Land `packages/react-pug-core/src/language/lintTransform.ts` as the single source of truth for lint-oriented semantic rewrites.
2. Remove duplicated lint-normalization code from `packages/eslint-plugin-react-pug/src/index.ts`.
3. Keep the plugin-side formatting pipeline for now, but make it consume the core lint transform output instead of re-owning semantics.
4. Validate the result not only with repo tests but also with `../startupjs` and `../startupjs-ui`, because those repos are the most realistic signal for Pug-heavy consumer behavior.

## Current Implementation Status

### Landed in code
- `packages/react-pug-core/src/language/lintTransform.ts` exists and owns:
  - expression boundary mapping
  - lint-oriented semantic normalization
  - mapped-region rewriting
  - lint transform creation on top of the runtime transform
- `@react-pug/react-pug-core` exports the new lint-transform helpers.
- `@react-pug/react-pug-core` now owns the Babel generator/types dependencies required for lint normalization.
- `packages/eslint-plugin-react-pug/src/index.ts` now consumes the core lint transform instead of owning:
  - fragment normalization
  - repeated-ternary normalization
  - local expression token alignment helpers
- core lint transform now also exposes structural `formattingContext` metadata per rewritten Pug region, and the ESLint plugin consumes that instead of inferring ternary/property placement from raw line-prefix regexes
- core now also owns the structural formatting wrapper contract:

## TS Plugin / VS Code / Syntax Architecture Review

### Why this matters
The TypeScript plugin and the VS Code extension are now the other major consumers of the same
shadow-document mapping model. They have not had the same cleanup pass yet.

Current symptoms:
- `packages/typescript-plugin-react-pug/src/index.ts` mixes:
  - generic original/shadow coordinate mapping
  - TS-language-service-specific method overrides
  - TS-result remapping
  - synthetic-diagnostic filtering
- `packages/vscode-react-pug-tsx/src/index.ts` duplicates low-level raw/stripped offset helpers
  just to support embedded style completions
- syntax highlighting is a separate TextMate grammar path with very little overlap with shadow
  mapping logic, so we should be careful not to invent fake unification where there is none

### Main architectural observation
The core already has the right backbone:
- `PugDocument`
- copied segments
- mapped regions
- synthetic insertions
- original/shadow offset conversion

The missing piece is a stable **query/coordinate helper layer** on top of that model.

Right now, multiple consumers reimplement variants of:
- raw-region offset <-> stripped-region offset
- original span -> shadow span
- shadow span -> original span
- encoded classification span remapping
- "nearby mapped position" fallback for editor typing

These are not TS-specific. They are generic consequences of the shadow-document model and belong in
`react-pug-core`.

### Architectural decision for TS/VSCode work
We are **not** doing a whole new editor architecture or a whole-file AST rewrite.

We are keeping:
- the text-and-mapping shadow-document model
- the TS plugin as a TS-language-service adapter
- the VS Code extension as a thin consumer of core transforms and extension APIs
- the syntax-highlighting path as a separate TextMate grammar path

We are changing:
- duplicated coordinate/query logic should move into core
- the TS plugin should get thinner by using generic core helpers
- the VS Code extension should stop owning raw/stripped offset math when core can provide it

### Non-goals
- do not try to merge TextMate syntax highlighting with TS shadow mapping
- do not move TS-language-service result-shape code into core when it depends on TS types
- do not add broad suppressions in the TS plugin to paper over mapping issues
- do not relax existing diagnostics or navigation behavior to make refactors easier

### High-confidence refactor targets

#### 1. Shared region coordinate helpers in core
Create/export core helpers for:
- raw offset -> stripped offset
- stripped offset -> raw offset
- original file offset inside a Pug region -> stripped region offset
- stripped region offset -> original file offset

Consumers:
- `positionMapping.ts`
- `pugToTsx.ts`
- TS plugin parse/transform diagnostic span mapping
- VS Code embedded style completion logic

This is generic and immediately reduces duplicated edge-case handling.

#### 2. Shared shadow query/span helpers in core
Create/export core helpers for:
- original span -> shadow span
- shadow span -> original span
- encoded classification triples remapped back to original
- optional nearby-on-same-line fallback for editor typing positions

Consumers:
- TS plugin completion/hover/definition/reference/refactor/classification wrappers

This should let the TS plugin stop reimplementing mapping rules method by method.

#### 3. Thin TS plugin adapters
After the helpers exist, the TS plugin should mostly be:
- document/cache management
- LS override selection
- TS-result shape adaptation
- plugin-specific diagnostics injection/filtering

The plugin should stop owning generic shadow mapping algorithms.

#### 4. Keep syntax highlighting separate
The syntax grammar should only share:
- tag-function detection assumptions when practical
- regression tests for comment/string boundaries

It should not be forced into the shadow-document architecture, because it is a separate TextMate
tokenization path.

### TS/VSCode implementation tasks

1. Add shared raw/stripped offset helpers to core and switch existing core code to them.
2. Add shared region offset helpers to core and switch TS plugin + VS Code style completion to them.
3. Add shared original/shadow span-query helpers to core.
4. Add shared encoded-classification remapping helper to core.
5. Add optional nearby-position fallback helper to core if its behavior can be expressed
   generically without TS-specific leakage.
6. Refactor the TS plugin to consume these helpers and delete duplicated mapping code.
7. Strengthen tests around:
   - completion cursor mapping
   - hover span mapping
   - classification span mapping
   - parse/transform diagnostic locations
   - embedded style completion cursor mapping
8. Validate with:
   - `npm test`
   - targeted TS/VSCode checks in this repo
   - real consumer behavior in `../startupjs` and `../startupjs-ui`

### Success criteria
- fewer custom offset/span helpers outside core
- TS plugin becomes smaller and more adapter-like
- VS Code embedded style features reuse core coordinate logic
- no loss of diagnostics/navigation accuracy
- no new rule suppressions or mapping relaxations

### TS/VSCode current implementation status
- core now owns shared coordinate/query helpers:
  - `regionOffsetMapping.ts`
  - `queryMapping.ts`
- core code that previously duplicated raw/stripped conversion now uses those helpers:
  - `positionMapping.ts`
  - `pugToTsx.ts`
- the TS plugin now consumes shared core helpers for:
  - original span -> shadow span
  - shadow span -> original span
  - encoded classification remapping
  - nearby same-line typing fallback
  - generated diagnostic range mapping
  - core-owned document issues (`missingTagImport`, `parseError`, `transformError`)
- the VS Code extension now reuses the shared raw->stripped helper for embedded style completion context
- targeted regression tests were added for:
  - shared query/span helpers
  - classification remapping through the TS plugin
  - core-owned document issue shaping

### TS/VSCode current architectural assessment
This refactor pass materially improved the architecture:

- generic shadow coordinate/query logic is now concentrated in core
- the TS plugin is more adapter-like and owns less mapping math
- core-owned document issues are no longer shaped ad hoc inside the plugin
- real consumer validation in `../startupjs` and `../startupjs-ui` is green for the targeted Pug-heavy files

The remaining TS plugin complexity is mostly the correct kind of complexity:
- snapshot/cache management
- TS language-service override wiring
- TS result-shape adaptation
- narrow TS-specific false-positive suppression codes caused by generated shadow TSX

At this point, more refactoring should be conservative. There is no obvious next extraction that is both:
- generic across consumers
- and simpler than leaving the logic in the TS plugin

So the current recommendation is:
- stop the TS/VSCode refactor here unless a new real consumer bug shows a genuinely generic seam we missed
- keep validating against `../startupjs` and `../startupjs-ui` after any future mapping changes
  - wrapper creation per region container kind
  - formatted-expression extraction back out of a wrapper
  - unit-tested indentation baseline semantics for wrapper extraction
- core now also owns the generic second-pass region rewrite helper used by the ESLint formatter layer
  - the plugin no longer owns a custom “rewrite all rewritten Pug regions again” loop
  - that remapping infrastructure is now reusable and tested in core
- `RegionFormattingContext` was simplified to only the structural field that still matters:
  - `containerKind`
  - the earlier `inlinePrefix` / `closingIndentOffset` metadata was removed because it no longer drove real formatting decisions
- startupjs / startupjs-ui real-world repros were copied into the fixture suite and now guard:
  - fragment lowering
  - repeated ternary lowering
  - inline `return pug\`` formatting
  - object-property `children: pug\`` formatting
  - startupjs-ui prompt / mdx / wrapInput regressions

### Still intentionally left in the ESLint plugin
- prettier pass
- internal stylistic formatting pass
- rebasing formatted region indentation back into surrounding source
- JSX closing-bracket normalization
- message/fix remapping
- narrow justified filtering for fundamentally synthetic legacy constructs only

### Newly reduced in the ESLint plugin
- second-pass segmented-region rewrite plumbing
- custom formatted-copy / formatted-region segment bookkeeping
- custom formatted-offset back-mapping helper for that second pass

Those now rely on the generic core segmented-region rewrite helper instead.

### Removed during this refactor
- the earlier `Provider(value=true)` suppression was removed
- current startupjs-ui behavior now intentionally reports the two real `react/jsx-boolean-value` diagnostics in `mdxComponents`
- this is the correct outcome: we no longer suppress real rule results just because they were inconvenient in one consumer fixture

### Remaining validation tasks
- latest validation after the generic second-pass rewrite helper move:
  - full `npm test` passed
  - targeted `../startupjs-ui` validation passed with local `file:` overrides for:
    - `eslint-plugin-cssxjs`
    - `@react-pug/react-pug-core`
  - targeted `../startupjs` validation passed with the same local `file:` overrides
- continue to re-run these after any further formatter-layer refactors
- when validating `../startupjs-ui`, the expected remaining diagnostics in `mdxComponents` are still:
  - the two real `react/jsx-boolean-value` errors
  - the repo-local unused disable-directive warning
- when validating `../startupjs`, the targeted repro files are currently clean
- current remaining work is architectural cleanup, not “make the suite green”

### Known non-goal for this branch
- removing the internal dependency on deprecated `@stylistic/jsx-indent`
  - this remains a follow-up
  - correctness and stable diagnostics matter more than removing that warning in this branch

## Current Architectural Assessment

### Direction check
The refactor direction is correct:

- semantic, lint-aware code-shape rewrites now live in core
- the ESLint plugin is thinner and no longer owns semantic AST rewrites
- real consumer repos were used as validation targets instead of relying only on synthetic tests

This is a genuine simplification. The branch is not moving in the wrong direction.

### Main remaining weak point
The main remaining fragility is no longer semantic normalization. It is the final formatter-layer shaping in the ESLint plugin.

The biggest earlier problem, formatting-context inference from line prefixes, has now been reduced materially:
- container-kind classification lives in core
- wrapper creation/extraction per container kind lives in core
- the plugin no longer guesses branch/property/return wrappers from raw text

The remaining heuristic layer is now smaller and genuinely formatter-specific:
- region rebasing against surrounding source indentation
- `normalizeJsxClosingBracketIndent(...)`
- continued reliance on deprecated internal `@stylistic/jsx-indent`

These are still string-level concerns, but they are now downstream of an explicit structural contract and generic rewrite infrastructure instead of mixed into semantic rewriting.

### What this means
The branch already improved the architecture materially, but it is **not yet the fully generic end state**.

The next real simplification target is now smaller:
- keep pushing more formatter decisions toward explicit structural metadata when that reduces real consumer edge cases
- avoid reintroducing line-prefix inference into the plugin

## Next Generic Cleanup Target

### Problem
Right now the plugin asks questions like:
- “is this region after `return `?”
- “is this line prefix actually a ternary branch or just an object property like `children:`?”
- “should the closing `)` be aligned with the branch or the property key?”

Those are structural questions, but the plugin is answering them from line-prefix regex checks.

That is exactly the class of logic that tends to create edge cases.

### Better architecture
The better long-term design is:

- core lint transform returns rewritten regions, offset maps, and structural formatting metadata
- core also owns the wrapper/envelope contract used to format those regions structurally
- the plugin formats that wrapper, extracts the region back out, and remaps diagnostics

That means the plugin should make as few structural decisions as possible on its own.

### Why this matters
If we do that:
- the prompt-style `children: pug\`` case stops being a regex special case
- ternary-branch indentation stops being a hand-maintained line normalizer
- future consumer repros are more likely to be covered by the model automatically

This is the next place where genericity can improve meaningfully.

## Additional Implementation Tasks

### Phase 7. Reduce formatter heuristics
25. Audit the remaining plugin formatter helpers and classify them into:
   - genuinely style-tool-specific repairs
   - still-avoidable string-splice repairs
26. Keep expanding the core structural formatting contract only when it removes real consumer edge cases cleanly.
27. Add or keep fixture coverage for each formatting context shape we support:
   - `return pug\`...\``
   - object property `children: pug\`...\`,`
   - ternary branch
   - arrow body
   - call argument
   - logical branch if we encounter one in real code
28. Only keep plugin-side formatter post-processing that is genuinely style-tool-specific, not context inference.
29. Reassess whether `normalizeJsxClosingBracketIndent(...)` and the region rebasing helper can be reduced further once enough structural context is exposed.
30. Keep any additional rewrite-stage mapping/bookkeeping out of the plugin unless it is impossible to express generically in core.

### Phase 8. Keep the hybrid model explicit
31. Keep core/plugin boundaries aligned with the hybrid text+mapping model, not a full-file Babel IR model.
32. When introducing new structural metadata, prefer:
   - core contracts
   - per-region analysis
   over:
   - whole-file regeneration
   - AST-location-only mapping schemes
33. Only revisit a broader Babel-backed generation layer if a concrete unsolved problem shows that the current hybrid model cannot support it cleanly.

### Phase 9. Re-evaluate branch completeness
34. After reducing formatter heuristics, re-run:
   - repo `npm test`
   - `../startupjs` targeted lint checks
   - `../startupjs-ui` targeted lint checks
35. For TS/VSCode mapping changes, re-run:
   - repo `npm test`
   - targeted TS/classification checks in this repo
   - targeted shadow-plugin checks in `../startupjs`
   - targeted shadow-plugin checks in `../startupjs-ui`
35. Reassess whether any remaining suppressions are still principled and synthetic-only.
36. Only then consider the architecture revamp “complete”.

## Success Criteria

We are done when all of the following are true:
- `npm test` passes in this repo
- no broad suppressions were added for the new false-positive classes
- startupjs-ui files previously failing now lint correctly:
  - `packages/input/wrapInput.tsx`
  - `packages/mdx/client/mdxComponents/index.js`
  - fragment / ternary / inline-return repro files
- startupjs targeted regressions remain fixed
- lint-only semantic normalization logic lives in core, not in the ESLint plugin
- the ESLint plugin becomes simpler, not more ad hoc
- the remaining formatter behavior is driven mostly by explicit context, not line-prefix heuristics
- the architecture remains intentionally hybrid: text/mapping backbone plus region-level structural analysis

## Open Follow-Ups (not mandatory for this branch)

- consider whether the formatter layer can later stop depending on deprecated `@stylistic/jsx-indent`
- consider whether some formatting-specific utilities should also move into a reusable core utility layer
- consider richer origin metadata for synthetic wrappers so future mapping/filtering decisions can be principled without rule-specific handling
