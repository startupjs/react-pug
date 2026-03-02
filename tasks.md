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

## Milestone 1: Syntax Highlighting

### Task 1.1: TextMate injection grammar for pug syntax highlighting
- **Status**: in-progress (dev)
- **Assignee**: dev
- **Description**: Create TextMate grammar injection so pug code inside `pug\`...\`` gets syntax highlighting.
- **Acceptance Criteria**:
  - [ ] syntaxes/pug-template-literal.json exists with correct injectionSelector
  - [ ] Injection covers source.ts, source.tsx, source.js, source.jsx
  - [ ] Pattern matches `pug` tag followed by backtick
  - [ ] contentName: "source.pug" delegates to Pug grammar
  - [ ] package.json contributes.grammars registered
  - [ ] embeddedLanguages maps source.pug to jade
  - [ ] Build passes
- **Files**: syntaxes/pug-template-literal.json, package.json

### Task 1.1-QA: Tests for grammar structure and package.json contributes
- **Status**: pending (blocked by 1.1)
- **Assignee**: qa
- **Description**: Validate TextMate grammar JSON structure, injection selectors, and package.json configuration.
- **Acceptance Criteria**:
  - [ ] Grammar JSON is valid and has correct structure
  - [ ] injectionSelector covers all 4 language scopes
  - [ ] scopeName follows conventions
  - [ ] package.json contributes.grammars is correct
  - [ ] embeddedLanguages maps source.pug to jade
  - [ ] All tests pass
- **Files**: test/unit/grammar.test.ts
