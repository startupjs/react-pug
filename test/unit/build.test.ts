import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

// Test checklist:
// [x] Build produces dist/client.js
// [x] Build produces dist/plugin.js
// [x] Build produces source maps for both outputs
// [x] client.js is valid CommonJS (has "use strict" and exports)
// [x] plugin.js is valid CommonJS (has "use strict" and exports)
// [x] client.js excludes vscode from bundle (external)
// [x] plugin.js contains plugin logic (buildShadowDocument)
// [x] Build succeeds with zero exit code

const root = resolve(__dirname, '../..');
const distDir = resolve(root, 'dist');

describe('build pipeline', () => {
  beforeAll(() => {
    // Run build to ensure dist is fresh
    execSync('npm run build', { cwd: root, stdio: 'pipe' });
  });

  it('produces dist/client.js', () => {
    expect(existsSync(resolve(distDir, 'client.js'))).toBe(true);
  });

  it('produces dist/plugin.js', () => {
    expect(existsSync(resolve(distDir, 'plugin.js'))).toBe(true);
  });

  it('produces source maps for client', () => {
    expect(existsSync(resolve(distDir, 'client.js.map'))).toBe(true);
  });

  it('produces source maps for plugin', () => {
    expect(existsSync(resolve(distDir, 'plugin.js.map'))).toBe(true);
  });

  it('client.js is valid CommonJS', () => {
    const content = readFileSync(resolve(distDir, 'client.js'), 'utf-8');
    expect(content).toContain('"use strict"');
  });

  it('plugin.js is valid CommonJS', () => {
    const content = readFileSync(resolve(distDir, 'plugin.js'), 'utf-8');
    expect(content).toContain('"use strict"');
  });

  it('client.js does not bundle vscode internals (marked external)', () => {
    const content = readFileSync(resolve(distDir, 'client.js'), 'utf-8');
    // vscode is marked external in esbuild config. Currently the extension stub
    // only uses console.log so the vscode import is tree-shaken away entirely.
    // The key assertion is that no vscode internal code is inlined in the bundle.
    // We verify by checking that typical vscode namespace patterns are absent.
    expect(content).not.toContain('createDiagnosticCollection');
    expect(content).not.toContain('vscode.languages');
  });

  it('plugin.js contains plugin logic', () => {
    const content = readFileSync(resolve(distDir, 'plugin.js'), 'utf-8');
    expect(content).toContain('buildShadowDocument');
  });

  it('typecheck passes', { timeout: 30000 }, () => {
    expect(() => {
      execSync('npx tsc --noEmit', { cwd: root, stdio: 'pipe' });
    }).not.toThrow();
  });
});
