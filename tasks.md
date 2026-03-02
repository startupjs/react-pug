# Tasks

## Milestone 0: Architecture Spike

### Task 0.1: Project scaffolding
- **Status**: pending
- **Assignee**: dev
- **Description**: Initialize the project with package.json (extension manifest), tsconfig.json (strict mode), .gitignore, directory structure (src/extension/, src/plugin/, src/language/, test/), vitest.config.ts, esbuild build scripts, and npm scripts (build, test, watch, package).
- **Acceptance Criteria**:
  - [ ] package.json exists with correct VS Code extension fields (name: vscode-pug-react, publisher, engines, activationEvents, main, contributes.typescriptServerPlugins)
  - [ ] Dependencies: typescript, @volar/source-map, esbuild, vitest, @types/vscode (devDep)
  - [ ] tsconfig.json with strict: true, target ES2020, module NodeNext
  - [ ] .gitignore ignores node_modules, dist, out, *.vsix
  - [ ] Directory structure: src/extension/, src/plugin/, src/language/, test/unit/, test/integration/, test/fixtures/, syntaxes/
  - [ ] vitest.config.ts configured
  - [ ] esbuild.config.ts bundles dist/plugin.js and dist/client.js
  - [ ] npm scripts: build, test, watch, package
  - [ ] `npm install` succeeds
  - [ ] `npm run build` succeeds (even if source files are stubs)
- **Files**: package.json, tsconfig.json, .gitignore, vitest.config.ts, esbuild.config.ts
- **Tests**: N/A (scaffolding)
- **Notes**: —

### Task 0.2: Basic extension entry point
- **Status**: pending
- **Assignee**: dev
- **Description**: Create the VS Code extension activation entry point and register the TypeScript server plugin.
- **Acceptance Criteria**:
  - [ ] src/extension/index.ts exports activate() and deactivate() functions
  - [ ] activate() logs activation message
  - [ ] package.json contributes.typescriptServerPlugins references the plugin
  - [ ] package.json activationEvents configured for TS/TSX/JS/JSX files
  - [ ] File compiles without errors
- **Files**: src/extension/index.ts, package.json (update contributes)
- **Tests**: N/A (verified by compilation)
- **Notes**: Keep minimal — no commands or diagnostics yet.

### Task 0.3: Minimal TS plugin with host patching (spike)
- **Status**: pending
- **Assignee**: dev
- **Description**: Create a minimal TypeScript plugin that patches getScriptSnapshot to serve shadow TSX content. For the spike, use a hard-coded transformation: detect any file containing `pug\`...\`` and replace the tagged template with hand-written JSX. This validates that tsserver will use our patched content for IntelliSense.
- **Acceptance Criteria**:
  - [ ] src/plugin/index.ts exports a TS plugin factory function (init pattern)
  - [ ] Plugin patches info.languageServiceHost.getScriptSnapshot()
  - [ ] Plugin patches info.languageServiceHost.getScriptVersion()
  - [ ] For files containing `pug\`...\``, returns shadow content where the pug tagged template is replaced with equivalent JSX expression
  - [ ] For files without pug templates, delegates to original host methods
  - [ ] Creates a proxy LanguageService that delegates all methods to the original
  - [ ] File compiles without errors
  - [ ] Build produces dist/plugin.js via esbuild
- **Files**: src/plugin/index.ts
- **Tests**: N/A (tested in 0.4)
- **Notes**: Use a simple regex or string replacement for the spike — no real pug parsing yet. The goal is to validate that host patching works.

### Task 0.4: Spike verification — completions at mapped positions
- **Status**: pending
- **Assignee**: dev
- **Description**: Write an integration test that creates a TypeScript language service with our plugin, loads a test fixture containing a pug tagged template, and verifies that completions work at positions inside the pug template. Also verify @volar/source-map works for bidirectional offset lookup.
- **Acceptance Criteria**:
  - [ ] test/fixtures/spike/ directory with a tsconfig.json and sample .tsx file containing `pug\`...\``
  - [ ] test/integration/spike.test.ts creates a TS LanguageService programmatically
  - [ ] Test verifies getCompletionsAtPosition returns expected component props at a position inside the pug template
  - [ ] Test verifies @volar/source-map can map offsets bidirectionally between pug source and TSX output
  - [ ] All tests pass with `npm test`
- **Files**: test/fixtures/spike/*, test/integration/spike.test.ts
- **Tests**: test/integration/spike.test.ts
- **Notes**: This is the key validation gate for M0. If completions work through host patching, we proceed. The test should use ts.createLanguageService() directly (not tsserver), which is simpler for testing.

### Task 0.5: QA review of spike
- **Status**: pending
- **Assignee**: qa
- **Description**: Review the spike implementation for correctness. Verify the integration test is sound, add edge case tests (file without pug templates still works normally, multiple pug templates in one file). Run all tests and verify they pass.
- **Acceptance Criteria**:
  - [ ] Review plugin code for correctness
  - [ ] Add test: file without pug templates passes through unchanged
  - [ ] Add test: verify @volar/source-map roundtrip accuracy
  - [ ] All tests pass
- **Files**: test/integration/spike.test.ts (additions)
- **Tests**: test/integration/spike.test.ts
- **Notes**: —
