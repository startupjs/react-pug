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

### 6) MEDIUM: plan requirement for CI gate is not met
Evidence:
- No `.github/workflows` directory exists.
- No CI pipeline configuration found in repo.

Impact:
- Merge-blocking quality gate described in plan is not implemented.

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
