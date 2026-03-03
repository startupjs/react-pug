# Audit: vscode-pug-react

Date: 2026-03-03
Auditor: Codex

## Scope and intent reviewed
I read:
- `plan.md`
- `tasks.md`
- `teamlead.md`

Expected outcome from those docs: a production-ready VS Code + tsserver plugin that provides JSX-grade IntelliSense inside `pug\`...\`` templates, with precise position mapping, robust diagnostics, strong tests, and CI quality gates.

## Audit progress log
1. Read project intent/process docs (`plan.md`, `tasks.md`, `teamlead.md`).
2. Read all implementation modules under `src/language`, `src/plugin`, `src/extension`, grammar, and build config.
3. Read representative and critical tests across unit + integration suites.
4. Ran verification commands:
   - `npm run typecheck` -> pass
   - `npm run build` -> pass
   - `npm test` -> 560/560 pass
5. Performed targeted repro scripts for mapping/version edge cases and grammar matching behavior.

## Verification results
- Typecheck/build/tests are green locally.
- The suite is broad, but many assertions are weak ("does not crash", "is defined", broad array checks), so high pass count overstates confidence in semantic correctness.

## Findings (ordered by severity)

### 1) CRITICAL: source mapping is incorrect for indented templates
Files:
- `src/language/extractRegions.ts`
- `src/language/positionMapping.ts`

Why:
- `extractRegions` strips common indentation from `pugText` (`stripCommonIndent`) but keeps offsets (`pugTextStart`/`pugTextEnd`) in original, unstripped coordinates.
- `positionMapping` assumes `pugOffset = originalOffset - pugTextStart` is directly compatible with mappings built from stripped text.
- This creates systematic coordinate drift.

Concrete evidence:
- In a reproducible script, original offset at `onClick` mapped to shadow snippet `ick={ha}` (middle of token), not `onClick`.

Impact:
- Completion/hover/definition/rename/diagnostic positions can be shifted in real templates (especially typical indented multiline templates).
- This violates the project’s core requirement: precise bidirectional mapping.

**Resolution** (2026-03-03):
- **Status**: FIXED
- **Changes**: The pug parser requires indent-stripped input, so `stripCommonIndent` must remain. Instead, we added coordinate-space conversion between raw (original file) offsets and stripped (pug source map) offsets:
  - `src/language/mapping.ts`: Added `commonIndent: number` field to `PugRegion` to track the stripped indent amount per region.
  - `src/language/extractRegions.ts`: `stripCommonIndent()` now returns `{ stripped, indent }` and both extraction paths (AST and regex) store the indent amount.
  - `src/language/positionMapping.ts`: Added `rawToStrippedOffset()` and `strippedToRawOffset()` functions that translate between raw backtick-content offsets and stripped pug-text offsets, accounting for per-line indent removal. `originalToShadow()` converts raw → stripped before consulting the Volar source map; `shadowToOriginal()` converts stripped → raw after consulting the source map.
- **Verification**: 12 unit tests in `test/unit/audit-fixes.test.ts` verify round-trip mapping correctness for 2-space, 4-space, 8-space, and tab indentation. Specific tokens (`onClick`, `handler`, `h1`) are verified to map to the exact start of the corresponding token in shadow TSX, not to a mid-token position. The original drift repro (raw offset 12 → stripped offset 8 for `onClick`) now correctly maps through the source map and round-trips back to the original offset.

### 2) HIGH: cached version can become stale vs host version
File:
- `src/plugin/index.ts`

Why:
- `host.getScriptVersion` returns cached shadow doc version when a file is in cache.
- Cache version only updates when patched `getScriptSnapshot` rebuilds the doc.
- If underlying host version increments first, plugin can still report old version until another snapshot rebuild happens.

Concrete evidence:
- Repro output:
  - `cached-version-1 1`
  - `underlying-host-version 2`
  - `plugin-version-without-new-snapshot 1`

Impact:
- Risk of stale language-service state after edits in pug files.
- Can produce outdated IntelliSense/diagnostics until forced refresh path occurs.

**Resolution** (2026-03-03):
- **Status**: FIXED
- **Changes**: Modified `host.getScriptVersion` in `src/plugin/index.ts` (line 60-64) to return a composite version string `${hostVersion}:${cached.version}` when a cached doc exists, and the plain `hostVersion` otherwise. This ensures that whenever the underlying host file version changes (e.g., user edits the file), tsserver sees a new version string and triggers a fresh `getScriptSnapshot` call, which rebuilds the shadow document.
- **Verification**: 3 unit tests in `test/unit/audit-fixes.test.ts` verify: (a) cached version format is `hostVersion:docVersion`, (b) version changes when host version changes even without a new snapshot, (c) non-pug files return plain host version. Additionally, 3 existing tests in `test/unit/plugin-host-patching.test.ts` were updated to match the new composite version format.

### 3) HIGH risk: tsserver plugin wiring appears incorrect in package metadata
File:
- `package.json`

Why:
- Extension `main` points to `./dist/client.js`.
- `contributes.typescriptServerPlugins[0].name` is `vscode-pug-react`.
- In standard TS plugin loading, module resolution by package name would resolve to package main (client), not `dist/plugin.js`.
- `dist/client.js` depends on `vscode` runtime module, which is not tsserver plugin runtime.

Concrete evidence:
- Directly requiring client bundle in Node fails with `Cannot find module 'vscode'`.

Impact:
- High risk that tsserver plugin fails to load in real VS Code usage or loads wrong entrypoint.
- If true in actual install context, core IntelliSense feature will not work at all.

**Resolution** (2026-03-03):
- **Status**: FIXED
- **Changes**: Added `createPluginShim()` function to `esbuild.config.mjs` that runs after both build and watch modes complete. It creates `node_modules/vscode-pug-react/package.json` with `{"name":"vscode-pug-react","main":"../../dist/plugin.js"}`. This shim module allows tsserver's standard module resolution (`require('vscode-pug-react')` from the extension's `node_modules/` directory) to find and load the correct plugin entry point (`dist/plugin.js`) instead of the VS Code extension entry (`dist/client.js`).
- **Verification**: 3 unit tests in `test/unit/audit-fixes.test.ts` verify: (a) `node_modules/vscode-pug-react/package.json` exists, (b) its `main` field is `../../dist/plugin.js`, (c) the resolved target `dist/plugin.js` exists on disk. Additionally verified manually: `require.resolve('vscode-pug-react')` succeeds from the project root.

### 4) MEDIUM: grammar matching overmatches and ignores configurable tag function
Files:
- `syntaxes/pug-template-literal.json`
- `package.json` (`pugReact.tagFunction` setting)

Why:
- Begin regex is `(?<=pug)\s*(`)`, no word boundary.
- Matches strings ending in `pug` (e.g., `notpug\``), not just identifier `pug`.
- Grammar is hardcoded to `pug` while plugin supports configurable tag function via settings.

Concrete evidence:
- Regex test results:
  - `pug\`` -> `true`
  - `my_pug\`` -> `true`
  - `notpug\`` -> `true`
  - `html\`` -> `false`

Impact:
- False-positive syntax highlighting.
- UI inconsistency when users set `pugReact.tagFunction` (IntelliSense may use alias but highlighting won’t).

**Resolution** (2026-03-03):
- **Status**: FIXED (word boundary) / DOCUMENTED (configurable tag function)
- **Changes**: Changed the begin regex in `syntaxes/pug-template-literal.json` from `(?<=pug)\s*(`)` to `(?<=(?<![\\w$])pug)\\s*(`)`. The nested negative lookbehind `(?<![\\w$])` rejects any word character or `$` immediately before `pug`, ensuring only standalone `pug` identifiers trigger highlighting.
  - The configurable tag function limitation is inherent to TextMate grammars (static regex, cannot read VS Code settings at runtime). This is documented as a known limitation — syntax highlighting always uses `pug` while IntelliSense respects the configured `pugReact.tagFunction`.
- **Verification**: 14 unit tests in `test/unit/audit-fixes.test.ts` verify the regex matches valid contexts (`pug\``, `(pug\``, ` pug\``, `=pug\``, `{pug\``, `,pug\``, `;pug\``, `!pug\``, `return pug\``, `yield pug\``) and rejects invalid prefixes (`xpug\``, `$pug\``, `_pug\``, `apug\``).

### 5) MEDIUM: test quality is uneven; many assertions are non-specific
Files (examples):
- `test/integration/config.test.ts`
- `test/integration/completions.test.ts`
- `test/integration/m6-features.test.ts`
- `test/integration/m5-features.test.ts`

Why:
- Frequent assertions of the form:
  - "array is returned"
  - "result is defined"
  - "does not crash"
- These do not prove feature correctness or mapping precision.

Impact:
- Test count is high, but defect-detection power for subtle correctness bugs is lower than reported.
- Explains why mapping drift can exist despite 560 passing tests.

**Resolution** (2026-03-03):
- **Status**: FIXED
- **Changes**: Systematically strengthened assertions across 12 test files (both unit and integration). Key improvements:
  - `test/integration/completions.test.ts` — Verify specific prop names (`onClick`, `label`) at correct positions; verify hover display text contains expected type strings; replace "does not crash" with value verification.
  - `test/integration/config.test.ts` — Verify `textSpan.start`, `kind`, display text on hover; verify disabled config behavior; check shadow document activation returns correct `kind`.
  - `test/integration/m4-features.test.ts` — Verify exact `fileName`, `textSpan.length === 'Button'.length`, exact span text via slice; verify parameter names in signature help.
  - `test/integration/m5-features.test.ts` — Verify exact 'handler' text at rename spans; verify `Button` name in definition references; verify exact span text in highlights.
  - `test/integration/m6-features.test.ts` — Remove `expect(true).toBe(true)` patterns; add structural checks on refactors.
  - `test/integration/jsx-support.test.ts` — Verify ref counts with exact span lengths; verify `DefinitionAndBoundSpan` text; verify `toHaveLength(0)` for clean diagnostics.
  - `test/unit/error-handling.test.ts` — Replace broken `callCount` pattern with `threw` boolean flag; verify throw happened and fallback result validity.
  - `test/unit/pugToTsx.test.ts` — Verify `parseError.message`, null placeholder on error, specific token types (`tag`, `eos`).
  - `test/unit/plugin-host-patching.test.ts` — Verify preserved source text content (`const s`, `const v`).
  - `test/unit/shadowDocument.test.ts` — Verify mapping lengths contain expected tokens; verify lexer token types.
  - `test/integration/shadowDocument.test.ts` — Verify `onClick={handler}` in TSX output; verify mapping lengths for specific tokens.
  - `test/integration/diagnostics.test.ts` — Verify `messageText` type and `category` field on global diagnostics.
  - `test/integration/spike.test.ts` — Replace indirect boolean checks with direct `toContain('onClick')`.
- **Verification**: Test suite grew from 560 to 592 tests (32 new targeted tests + strengthened existing assertions). All 592 tests pass. The strengthened assertions would now catch mapping drift bugs — for example, the indented-template round-trip tests verify that `onClick` maps to the exact start of `onClick` in shadow TSX, which would have failed with the original drift bug.

### 6) MEDIUM: plan requirement for CI gate is not met
Evidence:
- No `.github/workflows` directory exists.
- No CI pipeline configuration found in repo.

Impact:
- Merge-blocking quality gate described in plan is not implemented.

**Resolution** (2026-03-03):
- **Status**: NOT ADDRESSED (out of scope)
- **Reason**: CI pipeline was mentioned in plan.md as a quality gate but was not part of the M0-M7 milestone deliverables. The project is currently developed on a local `master` branch without remote CI. This can be added as a follow-up when the project is published to a remote repository.

## Overall assessment
- Implementation has substantial breadth and good effort.
- Project is **not yet at the reliability level claimed in docs** due to critical mapping correctness issue and high-risk packaging/versioning concerns.
- The current test suite is extensive in volume but not consistently strong in semantic assertions.

## Recommended next actions (priority)
1. Fix mapping model to preserve/translate indentation offsets correctly (or stop stripping indent before mapping).
2. Fix versioning strategy: incorporate underlying host version into plugin version (or force snapshot refresh on potential version change).
3. Validate and correct tsserver plugin entrypoint packaging in actual VS Code install context.
4. Tighten grammar regex with identifier boundaries and align highlighting behavior with configurable tag function.
5. Upgrade tests: add strict token-level span assertions and edit-cycle tests that catch stale-cache regressions.
6. Add CI workflow that runs `typecheck`, `build`, and `test` on push/PR.

---

## Post-audit resolution summary (2026-03-03)

All critical and high-severity findings have been addressed. The test suite has been substantially strengthened.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | CRITICAL | Source mapping drift from indent stripping | **FIXED** |
| 2 | HIGH | Stale cached version vs host version | **FIXED** |
| 3 | HIGH | tsserver plugin module not resolvable | **FIXED** |
| 4 | MEDIUM | Grammar regex overmatches | **FIXED** (word boundary) / DOCUMENTED (configurable tag) |
| 5 | MEDIUM | Weak test assertions | **FIXED** (12 files strengthened, 32 new tests) |
| 6 | MEDIUM | No CI pipeline | NOT ADDRESSED (out of scope) |

**Test suite**: 560 → 592 tests across 26 files, all passing. Assertions now verify semantic correctness at the token level (exact span text, specific completion names, round-trip mapping accuracy) rather than just structural existence checks.

---

## Re-Audit Validation (2026-03-03, pass 2)

### What was re-validated
1. Re-read this file (`audit.md`) and validated each claimed fix against current source.
2. Re-ran project checks:
   - `npm run typecheck` -> pass
   - `npm run build` -> pass
   - `npm test` -> pass (592 tests)
3. Re-ran targeted repros for:
   - indented-template mapping correctness
   - host-version staleness behavior
   - grammar overmatch behavior
   - plugin module resolvability

### Validation verdict by original finding
1. **Finding 1 (mapping drift)**: Mostly fixed.
   - Token-level mapping now works for indented templates (`Button`, `onClick`, `handler`, `label` map to correct shadow tokens and round-trip).
   - New edge case found: offsets in stripped leading indentation spaces map to the first token of the line instead of being treated as unmapped/null.
2. **Finding 2 (version staleness)**: Fixed.
   - `getScriptVersion` now includes host version and changes even without fresh snapshot (`1:1` -> `2:1`).
3. **Finding 3 (plugin wiring)**: Partially fixed in local dev, still high risk for packaging/distribution.
   - Current fix creates `node_modules/vscode-pug-react` shim at build time.
   - `npm ls` reports this shim as **extraneous**.
   - `npm prune --production --dry-run` shows it would be removed (`remove vscode-pug-react undefined`).
   - This strongly suggests the shim is brittle for VSIX/production packaging workflows.
4. **Finding 4 (grammar overmatch)**: Fixed.
   - Updated regex no longer matches `notpug\``/`my_pug\``/`$pug\`` and still matches valid contexts.
5. **Finding 5 (weak tests)**: Improved.
   - Test suite increased and stronger assertions are present.
   - Not all tests are strict, but quality is materially better.
6. **Finding 6 (CI missing)**: Still not addressed.

### New/remaining findings after re-audit

#### A) HIGH: Plugin entrypoint fix relies on extraneous shim under `node_modules`
Files:
- `esbuild.config.mjs`
- `node_modules/vscode-pug-react/package.json` (generated artifact)

Why:
- The fix depends on a generated module not declared in dependencies.
- Packaging/prune steps can remove it, breaking tsserver resolution again.

Evidence:
- `npm ls vscode-pug-react --depth=0` -> `vscode-pug-react@ extraneous`
- `npm prune --production --dry-run` includes `remove vscode-pug-react undefined`

Impact:
- Works locally after build, but may fail in packaged/published extension workflows.

#### B) MEDIUM: Leading indentation spaces inside pug content are not treated as unmapped
Files:
- `src/language/positionMapping.ts` (`rawToStrippedOffset`)

Why:
- Raw offsets within stripped indent are clamped to stripped column `0`.
- Multiple raw positions collapse to one mapped token position.

Evidence:
- For a line `    Button(...)`, all four leading spaces map to the same shadow position as `Button`.

Impact:
- Cursor on indentation whitespace may produce token-context IntelliSense instead of null/unmapped behavior.

### Updated overall status
- Substantial progress and most previously critical issues are genuinely improved.
- Project is **closer to production quality**, but not fully clean yet due to:
  1. fragile plugin resolvability strategy for packaging (HIGH)
  2. indentation-whitespace mapping edge case (MEDIUM)
  3. missing CI gate (MEDIUM)

---

## Patch follow-up (2026-03-03, pass 3 by Codex)

Patched the two remaining code issues from pass 2:

1. **Plugin resolvability packaging fix (HIGH)**
   - Replaced build-time shim creation in `node_modules` with a real file dependency package:
     - Added `ts-plugin/package.json` (`name: vscode-pug-react-ts-plugin`, `main: ../../dist/plugin.js`)
     - Added dependency in root `package.json`:
       - `"vscode-pug-react-ts-plugin": "file:./ts-plugin"`
     - Updated `contributes.typescriptServerPlugins[0].name` to `vscode-pug-react-ts-plugin`
     - Removed `createPluginShim()` from `esbuild.config.mjs`
   - Validation:
     - `npm ls vscode-pug-react-ts-plugin --depth=0` shows installed (non-extraneous local file dep).
     - `npm prune --production --dry-run` no longer reports removal of plugin module.
     - `require.resolve('vscode-pug-react-ts-plugin')` resolves to `dist/plugin.js`.

2. **Indentation-whitespace mapping behavior (MEDIUM)**
   - Updated `src/language/positionMapping.ts`:
     - `rawToStrippedOffset()` now returns `null` when cursor is inside stripped indentation.
     - `originalToShadow()` now returns `null` for that case instead of collapsing to line-start token.
   - Validation:
     - Repro now returns `[null, null, null, null]` for four leading spaces before `Button(...)`.

Additional updates:
- Strengthened/updated tests in `test/unit/audit-fixes.test.ts` for new packaging strategy and indentation-whitespace behavior.
- Updated plugin name references in `README.md`, `test/fixtures/tsconfig.json`, and `examples/demo/tsconfig.json`.

Final status after pass 3:
- Finding A (packaging/shim fragility): **FIXED**
- Finding B (indent whitespace mapping): **FIXED**
- CI gate: **still not addressed** (unchanged)

---

## CI follow-up (2026-03-03, pass 4 by Codex)

CI quality gate is now implemented.

- Added GitHub Actions workflow: `.github/workflows/ci.yml`
- Trigger: `push` and `pull_request` on `master`
- Job: `quality-gates` on `ubuntu-latest`
- Steps:
  1. `npm ci`
  2. `npm run typecheck`
  3. `npm run build`
  4. `npm test`

Status update:
- Finding 6 (missing CI): **FIXED**
