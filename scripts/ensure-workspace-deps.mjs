import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function hasRequiredReactDeps(workspacePath) {
  const reactPkg = path.join(workspacePath, 'node_modules', 'react', 'package.json');
  const jsxRuntime = path.join(workspacePath, 'node_modules', 'react', 'jsx-runtime.js');
  return fs.existsSync(reactPkg) && fs.existsSync(jsxRuntime);
}

function runNpmInstall(workspacePath) {
  const result = spawnSync('npm', ['install'], {
    cwd: workspacePath,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`npm install failed in ${workspacePath} with exit code ${result.status ?? 'unknown'}`);
  }
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const workspaceArg = process.argv[2] || 'examples/demo';
  const workspacePath = path.resolve(repoRoot, workspaceArg);
  const packageJsonPath = path.join(workspacePath, 'package.json');

  if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
    throw new Error(`Workspace directory not found: ${workspacePath}`);
  }

  if (!fs.existsSync(packageJsonPath)) {
    console.log(`[deps] No package.json in ${workspacePath}; skipping install.`);
    return;
  }

  if (hasRequiredReactDeps(workspacePath)) {
    console.log(`[deps] Existing demo dependencies detected in ${workspacePath}; skipping install.`);
    return;
  }

  console.log(`[deps] Installing workspace dependencies in ${workspacePath}...`);
  runNpmInstall(workspacePath);
}

try {
  main();
} catch (err) {
  console.error(`[deps] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
