# Tasks

## Milestone 0: Architecture Spike — COMPLETE

All tasks done. Spike validated: host patching works, completions return typed props through shadow JSX.

### Commits:
1. `98321cd` feat(M0): scaffold project structure and build pipeline
2. `549bc7e` feat(M0): implement minimal TS plugin with host patching (spike)
3. `13228f3` test(M0): add scaffolding tests and test infrastructure
4. `24b8b44` feat(M0): validate spike — completions work through host patching
5. `2d309e9` test(M0): add comprehensive unit tests for plugin host patching
6. `bfcccd2` test(M0): add edge case tests for plugin host patching

---

## Milestone 1: Syntax Highlighting — COMPLETE

### Task 1.1: TextMate injection grammar — DONE
### Task 1.1-QA: Grammar tests — DONE

### Commits:
7. `4b72ee6` feat(M1): add TextMate grammar injection for pug syntax highlighting
8. `c7f17ff` test(M1): add TextMate grammar validation tests

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
9. `8e61a48` feat(M2): define core types and mapping utilities
10. `c7301b3` feat(M2): implement region extraction with @babel/parser
11. `fb833d8` test(M2): add core types and mapping utilities tests
12. `691b025` test(M2): add comprehensive region extraction tests
13. `c10c869` feat(M2): implement TsxEmitter and pug-to-TSX compiler
14. `c835d67` test(M2): add comprehensive pug-to-TSX unit tests
15. `8bef2f4` feat(M2): add control flow constructs to pug-to-TSX compiler
16. `03d7132` test(M2): add control flow unit tests for pug-to-TSX compiler
17. `5ead6d2` feat(M2): implement buildShadowDocument
18. `d89d8a4` test(M2): add comprehensive shadowDocument unit tests

---

## Milestone 3: MVP (Completions + Hover) — COMPLETE

### Task 3.1: Position mapping utilities — DONE
### Task 3.2: Wire real pug-to-TSX into TS plugin — DONE
### Task 3.3: Intercept completions — DONE
### Task 3.4: Intercept hover — DONE
### Task 3.1-QA: Position mapping tests — DONE
### Task 3.3-QA: Completions and hover integration tests — DONE

### Commits:
19. `2ddc2db` feat(M3): implement bidirectional position mapping utilities
20. `a3feaad` test(M3): add comprehensive position mapping unit tests
21. `f64352f` feat(M3): wire real pug-to-TSX pipeline into TS plugin
22. `b270fab` feat(M3): intercept completions and hover with position mapping
23. `7673e24` test(M3): add completions and hover integration tests

---

## Milestone 4: Diagnostics + Go-to-Definition — COMPLETE

### Task 4.1: Intercept go-to-definition — DONE
### Task 4.2: Intercept diagnostics — DONE
### Task 4.3: Intercept signature help — DONE
### Task 4.1-QA: Integration tests for M4 features — DONE

### Commits:
24. `4005cb7` feat(M4): intercept go-to-definition with position mapping
25. `6e8653a` feat(M4): intercept diagnostics and signature help
26. `cfb7f39` test(M4): add go-to-definition, diagnostics, and signature help integration tests

---

## Milestone 5: Rename + References — COMPLETE

### Task 5.1: Intercept rename, references, highlights, implementation — DONE
### Task 5.1-QA: Integration tests for M5 features — DONE

### Commits:
27. `5d9f7d3` feat(M5): intercept rename, references, highlights, and implementation
28. `0cc931e` test(M5): add integration tests for rename, references, and highlights

---

## Milestone 6: Polish — COMPLETE

### Task 6.1: Code actions and refactoring intercepts — DONE
### Task 6.1-QA: Integration tests for code actions — DONE
### Task 6.2: Configuration settings — DONE
### Task 6.2-QA: Tests for configuration settings — DONE
### Task 6.3: JS/JSX support verification — DONE
### Task 6.3-QA: JS/JSX support tests — DONE
### Task 6.4: Improve diagnostics filtering — DONE
### Task 6.4-QA: Diagnostics filtering tests — DONE

### Commits:
29. `c834827` feat(M6): add code actions and refactoring intercepts with tests
30. `8e4733b` feat(M6): add extension configuration settings with tests
31. `47d38b6` feat(M6): verify and test JS/JSX file support
32. `9e0c05c` feat(M6): improve diagnostics filtering and error recovery
33. `fb2e66c` test(M6): add diagnostics filtering integration tests
34. `39e7a2c` test(M6): add nested AST custom tagName tests and remove stale bug note
35. `ffd5b0b` test(M6): expand JS/JSX support tests with QA review

### Bug fixes:
36. `07a9f33` fix: ensure docCache is populated before LS operations

---

## Milestone 7: Hardening + Release — IN PROGRESS

### Task 7.1: Show Shadow TSX debug command — DONE
### Task 7.1-QA: Show Shadow TSX command tests — DONE
### Task 7.2: Error handling for all failure modes — DONE
### Task 7.2-QA: Error handling tests — IN PROGRESS (qa)
### Task 7.3: Create example project — PENDING
### Task 7.3-QA: TBD — PENDING

### Commits:
37. `cffdbeb` feat(M7): add Show Shadow TSX debug command
38. `2b9cf77` test(M7): add Show Shadow TSX command unit tests
39. `d236dfa` feat(M7): add error handling for all failure modes

---

## Test Coverage Summary

545 tests passing across 24 test files:

### Unit tests (316):
- test/unit/setup.test.ts (1)
- test/unit/build.test.ts (9)
- test/unit/extension-module.test.ts (6)
- test/unit/plugin-module.test.ts (6)
- test/unit/plugin-host-patching.test.ts (31)
- test/unit/grammar.test.ts (18)
- test/unit/mapping.test.ts (21)
- test/unit/extractRegions.test.ts (28)
- test/unit/pugToTsx.test.ts (78)
- test/unit/shadowDocument.test.ts (42)
- test/unit/positionMapping.test.ts (52)
- test/unit/config.test.ts (24)
- test/unit/show-shadow-tsx.test.ts (15)

### Integration tests (229):
- test/integration/spike.test.ts (10)
- test/integration/pugToTsx.test.ts (41)
- test/integration/shadowDocument.test.ts (13)
- test/integration/positionMapping.test.ts (20)
- test/integration/completions.test.ts (21)
- test/integration/m4-features.test.ts (20)
- test/integration/m5-features.test.ts (20)
- test/integration/m6-features.test.ts (18)
- test/integration/config.test.ts (12)
- test/integration/jsx-support.test.ts (20)
- test/integration/diagnostics.test.ts (19)

Note: unit count 316 + integration 229 = 545 total (15 tests are in show-shadow-tsx which is unit)

---

## Source Files

- src/plugin/index.ts — TS plugin: host patching, 20 proxy method overrides, diagnostics filtering, error handling
- src/extension/index.ts — VS Code extension: activation, Show Shadow TSX command, output channel logging
- src/language/mapping.ts — Core types: PugRegion, PugDocument, CodeMapping, CodeInformation
- src/language/extractRegions.ts — Region extraction with @babel/parser, tagName support
- src/language/pugToTsx.ts — TsxEmitter, compilePugToTsx (tags, attributes, control flow)
- src/language/shadowDocument.ts — buildShadowDocument (regions + shadow text assembly)
- src/language/positionMapping.ts — Bidirectional offset mapping (originalToShadow, shadowToOriginal)
- syntaxes/pug-template-literal.json — TextMate injection grammar
