# Style Tag Feature Tasks

Goal: support terminal `style` blocks inside `pug`` templates and move them into top-of-scope `css``/styl``/sass``/scss``` calls with full compiler, TS shadow, highlighting, and editor coverage.

## 1. Core design and data model

- [x] Audit current core transform assumptions that only `pug`` regions rewrite in place.
- [x] Introduce explicit core data structures for extracted terminal style blocks.
- [x] Introduce explicit core data structures for injected out-of-region edits.
- [x] Introduce explicit core data structures for moved style-content mapping regions.
- [x] Keep current Pug JSX mapping behavior unchanged for non-style templates.

## 2. Raw style-block extraction from pug text

- [x] Add a preprocessing pass before normal Pug parse to detect a terminal `style` block.
- [x] Support `style`, `style(lang='css')`, `style(lang='styl')`, `style(lang='sass')`, `style(lang='scss')`.
- [x] Default missing `lang` to `css`.
- [x] Preserve `${...}` content exactly as written.
- [x] Normalize body indentation by removing the style-block common indent.
- [x] Reject unsupported `lang` values with a transform diagnostic/error.
- [x] Reject non-terminal `style` blocks with a transform diagnostic/error.
- [x] Reject multiple `style` blocks in one template unless they collapse to the same single terminal block rule.
- [x] Add unit tests for extraction, indentation trimming, interpolation preservation, and invalid placement.

## 3. Scope targeting and import analysis

- [x] Extend Babel-based file analysis to find the injection target scope for each matched `pug`` template.
- [x] Implement scope selection:
- [x] nearest enclosing named function with uppercase-leading name
- [x] otherwise the topmost function scope encountered before `Program`
- [x] otherwise `Program`
- [x] Record the matched `pug` import source per file.
- [x] Record existing `css`/`styl`/`sass`/`scss` imports from that same source.
- [x] Add analysis tests for function declarations, arrow components, nested callbacks, and program-level fallback.

## 4. Core compile result changes

- [x] Extend `compilePugToTsx()` result to return extracted style payloads and transform-time errors.
- [x] Keep parse-error recovery behavior for incomplete Pug where possible.
- [x] Ensure JSX emission ignores stripped terminal style blocks.
- [x] Add unit tests for templates that produce both JSX and style payloads.

## 5. Shadow/source transform refactor

- [x] Refactor `buildShadowDocument()` to apply ordered edits, not just region replacements.
- [x] Support inserting generated style helper calls at scope/program top.
- [x] Support adding/updating imports for `css`/`styl`/`sass`/`scss`.
- [x] Support combining helper import insertion with existing `pug` import cleanup.
- [x] Preserve side-effect-only imports when a binding is removed.
- [x] Produce shadow text that keeps normal TS/JS code stable outside transformed edits.
- [x] Extend position mapping to handle moved style-content regions.
- [x] Add position roundtrip tests for content inside moved style blocks.
- [x] Add shadow document tests for injected helper calls in:
- [x] uppercase component function
- [x] nested callback inside component
- [x] lowercase/non-component function fallback
- [x] program-level fallback

## 6. Transform/adapter behavior

- [x] Make transform-based consumers throw on style transform errors.
- [x] Ensure Babel basic/detailed modes both inherit style-tag support.
- [x] Ensure SWC transform inherits style-tag support.
- [x] Ensure esbuild transform inherits style-tag support.
- [x] Ensure ESLint preprocess inherits style-tag support.
- [x] Add adapter tests for success cases and failure cases.

## 7. TypeScript plugin support

- [x] Surface style-transform failures as editor diagnostics.
- [x] Surface missing `pug` import when a style block needs helper import source.
- [x] Keep shadow TSX import cleanup behavior correct with style helper imports.
- [x] Verify mapped positions inside moved style content remain correct in shadow TSX.
- [x] Add TS plugin integration tests for diagnostics and shadow output.

## 8. VS Code grammar and embedded-language support

- [x] Extend the Pug template grammar to recognize terminal `style` blocks.
- [x] Embed CSS content for default/`lang='css'`.
- [x] Embed Stylus content for `lang='styl'`.
- [x] Embed Sass content for `lang='sass'`.
- [x] Embed SCSS content for `lang='scss'`.
- [x] Preserve `${...}` interpolation handling inside embedded style content.
- [x] Update extension `package.json` `embeddedLanguages` mappings.
- [x] Add grammar unit tests for style-block rules and embedded-language registrations.

## 9. Real VS Code coverage

- [x] Add extension-host tests for `Show Shadow TSX` with moved style helper calls.
- [x] Add highlight tests for CSS and Stylus blocks in real VS Code.
- [x] Add completion/intellisense tests inside CSS and Stylus style blocks in real VS Code.
- [x] Verify surrounding Pug IntelliSense/highlighting still works in mixed markup + style templates.

## 10. Fixtures, docs, and final verification

- [x] Add/extend real-project fixture coverage for compiler snapshots with style blocks.
- [x] Update README usage docs for `style` / `style(lang=...)`.
- [x] Document the requirement that `pug` must be imported when style blocks are used.
- [x] Document the recommended Stylus VS Code extension.
- [x] Update architecture docs for style extraction, scope injection, and mapping.
- [x] Run targeted tests while iterating.
- [ ] Run full `xvfb-run -a npm test` before finish.
