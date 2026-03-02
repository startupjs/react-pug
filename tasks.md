# Tasks

## Milestone 0: Architecture Spike — COMPLETE

All tasks done. 58 tests passing. Spike validated: host patching works, completions return typed props through shadow JSX.

### Commits:
1. `feat(M0): scaffold project structure and build pipeline`
2. `feat(M0): implement minimal TS plugin with host patching (spike)`
3. `test(M0): add scaffolding tests and test infrastructure`
4. `feat(M0): validate spike — completions work through host patching`
5. `test(M0): add comprehensive unit tests for plugin host patching`

---

## Milestone 1: Syntax Highlighting — COMPLETE

### Task 1.1: TextMate injection grammar — DONE
### Task 1.1-QA: Grammar tests — DONE

### Commits:
6. `feat(M1): add TextMate injection grammar for pug syntax highlighting`
7. `test(M1): add TextMate grammar and package.json contributes tests`

---

## Milestone 2: Generator + Mapping — COMPLETE

### Task 2.1: Core types and mapping utilities — DONE
### Task 2.2: Region extraction with @babel/parser — DONE
### Task 2.1-QA: Tests for types and mapping — DONE
### Task 2.2-QA: Tests for region extraction — DONE
### Task 2.3: TsxEmitter and pug-to-TSX compiler — DONE
### Task 2.3-QA: pug-to-TSX test fixtures — DONE
### Task 2.4: Control flow constructs — DONE
### Task 2.4-QA: Control flow tests — DONE
### Task 2.5: buildShadowDocument — DONE
### Task 2.5-QA: shadowDocument tests — DONE

### Commits:
8. `feat(M2): add core types and mapping utilities`
9. `feat(M2): implement region extraction with @babel/parser`
10. `test(M2): add mapping utilities and region extraction tests`
11. `feat(M2): implement TsxEmitter and pug-to-TSX compiler`
12. `test(M2): add comprehensive pug-to-TSX unit tests`
13. `feat(M2): add control flow constructs to pug-to-TSX compiler`
14. `test(M2): add control flow unit tests for pug-to-TSX compiler`
15. `feat(M2): implement buildShadowDocument`
16. `test(M2): add comprehensive shadowDocument unit tests`

---

## Milestone 3: MVP (Completions + Hover) — COMPLETE

### Task 3.1: Position mapping utilities — DONE
### Task 3.2: Wire real pug-to-TSX into TS plugin — DONE
### Task 3.3: Intercept completions — DONE
### Task 3.4: Intercept hover — DONE
### Task 3.3-QA: Completions and hover integration tests — DONE
### Task 3.1-QA: Position mapping tests — DONE

### Commits:
17. `feat(M3): implement bidirectional position mapping utilities`
18. `test(M3): add comprehensive position mapping unit tests`
19. `feat(M3): wire real pug-to-TSX pipeline into TS plugin`
20. `feat(M3): intercept completions and hover with position mapping`
21. `test(M3): add completions and hover integration tests`

---

## Milestone 4: Diagnostics + Go-to-Definition — COMPLETE

### Task 4.1: Intercept go-to-definition — DONE
### Task 4.2: Intercept diagnostics — DONE
### Task 4.3: Intercept signature help — DONE
### Task 4.1-QA: Integration tests for M4 features — DONE

### Commits:
22. `feat(M4): intercept go-to-definition with position mapping`
23. `feat(M4): intercept diagnostics and signature help`
24. `test(M4): add go-to-definition, diagnostics, and signature help integration tests`

---

## Milestone 5: Rename + References — COMPLETE

### Task 5.1: Intercept rename, references, highlights, implementation — DONE
### Task 5.1-QA: Integration tests for M5 features — DONE

### Commits:
25. `feat(M5): intercept rename, references, highlights, and implementation`
26. `test(M5): add integration tests for rename, references, and highlights`

---

## Milestone 6: Polish — IN PROGRESS

### Task 6.1: Code actions and refactoring intercepts (Task #34)
- **Status**: done (dev) — awaiting QA
- **Assignee**: dev (completed), qa (Task #35 in progress)
- **Description**: Added mapFileTextChanges, getApplicableRefactors, getEditsForRefactor, getCodeFixesAtPosition, getCombinedCodeFix
- **Files**: src/plugin/index.ts (uncommitted)
- **Notes**: Code is uncommitted, waiting for QA tests before committing

### Task 6.1-QA: Integration tests for code actions (Task #35)
- **Status**: in-progress (qa)
- **Assignee**: qa
- **Description**: Write integration tests for the code actions intercepts
- **Files**: test/integration/m6-features.test.ts

### Task 6.2: Configuration settings (Task #36)
- **Status**: pending
- **Assignee**: dev
- **Description**: Add pugReact.enabled, pugReact.diagnostics.enabled, pugReact.tagFunction settings
- **Files**: package.json, src/plugin/index.ts, src/language/extractRegions.ts

### Task 6.3: JS/JSX support verification (Task #37)
- **Status**: pending
- **Assignee**: dev
- **Description**: Verify JS/JSX files work (code already handles them), add test coverage
- **Files**: test fixtures

### Task 6.4: Improve diagnostics filtering (Task #38)
- **Status**: pending
- **Assignee**: dev
- **Description**: Filter false positives, fix attribute value offset, better error recovery
- **Files**: src/plugin/index.ts, src/language/pugToTsx.ts

---

## Test Coverage Summary

437 tests passing across 18 test files:
- test/unit/build.test.ts (9)
- test/unit/setup.test.ts (1)
- test/unit/extension-module.test.ts (6)
- test/unit/grammar.test.ts (18)
- test/unit/mapping.test.ts (21)
- test/unit/pugToTsx.test.ts (78)
- test/unit/shadowDocument.test.ts (42)
- test/unit/positionMapping.test.ts (52)
- test/integration/pugToTsx.test.ts (41)
- test/integration/shadowDocument.test.ts (13)
- test/integration/positionMapping.test.ts (20)
- test/integration/completions.test.ts (21)
- test/integration/m4-features.test.ts (20)
- test/integration/m5-features.test.ts (20)
- + additional test files
