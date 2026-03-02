# Tasks

## Milestone 0: Architecture Spike

### Task 0.1: Project scaffolding
- **Status**: done
- **Assignee**: dev
- **Description**: Initialize the project with package.json (extension manifest), tsconfig.json (strict mode), .gitignore, directory structure, vitest.config.ts, esbuild build scripts, and npm scripts.
- **Acceptance Criteria**: All met.
- **Files**: package.json, tsconfig.json, .gitignore, vitest.config.ts, esbuild.config.mjs, src/extension/index.ts, src/plugin/index.ts
- **Commit**: `feat(M0): scaffold project structure and build pipeline`

### Task 0.2: Basic extension entry point
- **Status**: done (completed as part of 0.1)
- **Assignee**: dev
- **Description**: VS Code extension activation entry point and TS server plugin registration.
- **Files**: src/extension/index.ts, package.json

### Task 0.1-QA: Test infrastructure and scaffolding tests
- **Status**: in-progress (qa)
- **Assignee**: qa
- **Description**: Set up test infrastructure. Write tests for build pipeline, plugin module exports, extension module exports. Create test fixture structure for upcoming spike tests.
- **Acceptance Criteria**:
  - [ ] test/unit/build.test.ts — verifies dist/client.js and dist/plugin.js are produced
  - [ ] test/unit/plugin-module.test.ts — verifies init pattern exports
  - [ ] test/unit/extension-module.test.ts — verifies activate/deactivate exports
  - [ ] test/fixtures/spike/ — tsconfig.json and sample.tsx for upcoming integration tests
  - [ ] All tests pass
- **Files**: test/unit/build.test.ts, test/unit/plugin-module.test.ts, test/unit/extension-module.test.ts, test/fixtures/spike/*

### Task 0.3: Minimal TS plugin with host patching (spike)
- **Status**: in-progress (dev)
- **Assignee**: dev
- **Description**: Minimal TypeScript plugin that patches getScriptSnapshot to serve shadow TSX content. Regex-based pug detection for the spike.
- **Acceptance Criteria**:
  - [ ] Plugin patches info.languageServiceHost.getScriptSnapshot()
  - [ ] Plugin patches info.languageServiceHost.getScriptVersion()
  - [ ] For files containing pug tagged templates, returns shadow content with JSX replacement
  - [ ] For files without pug templates, delegates to original host methods
  - [ ] Creates a proxy LanguageService that delegates all methods
  - [ ] Document cache: fileName → { originalText, shadowText, version }
  - [ ] File compiles, build produces dist/plugin.js
- **Files**: src/plugin/index.ts

### Task 0.3-QA: Tests for TS plugin host patching
- **Status**: pending (blocked by 0.3)
- **Assignee**: qa
- **Description**: Comprehensive unit tests for the TS plugin host patching logic.
- **Acceptance Criteria**:
  - [ ] Test: getScriptSnapshot returns shadow TSX for files with pug templates
  - [ ] Test: getScriptSnapshot passes through for files without pug templates
  - [ ] Test: getScriptVersion increments on content change
  - [ ] Test: document cache reuses result for unchanged content
  - [ ] Test: proxy LS delegates all methods
  - [ ] Test: regex detection finds pug tagged templates
  - [ ] Test: multiple pug templates in one file
  - [ ] All tests pass
- **Files**: test/unit/plugin-host-patching.test.ts

### Task 0.4: Spike verification — completions at mapped positions
- **Status**: pending (blocked by 0.3)
- **Assignee**: dev
- **Description**: Integration test creating a TS LanguageService with our plugin, verifying completions work through host patching. Test @volar/source-map bidirectional mapping.
- **Acceptance Criteria**:
  - [ ] test/integration/spike.test.ts creates a TS LanguageService programmatically
  - [ ] Test verifies getCompletionsAtPosition returns expected results at a position inside the pug template
  - [ ] Test verifies @volar/source-map bidirectional offset lookup
  - [ ] All tests pass
- **Files**: test/integration/spike.test.ts, test/fixtures/spike/*

### Task 0.5: QA final review of spike
- **Status**: pending (blocked by 0.4)
- **Assignee**: qa
- **Description**: Final review of spike. Add edge case tests, verify all tests pass, review code quality.
- **Acceptance Criteria**:
  - [ ] Review plugin code for correctness and plan.md adherence
  - [ ] Add edge case tests (malformed templates, empty templates, etc.)
  - [ ] All tests pass
  - [ ] Code review feedback addressed
