import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

function printUsage() {
  console.log('Usage: node scripts/open-vscode-fresh.mjs <workspace-path> [--dry-run]');
  console.log('Example: node scripts/open-vscode-fresh.mjs examples/demo');
}

async function main() {
  const workspaceArg = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!workspaceArg || workspaceArg === '--help' || workspaceArg === '-h') {
    printUsage();
    process.exit(workspaceArg ? 0 : 1);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const workspacePath = path.resolve(repoRoot, workspaceArg);
  const extensionDevelopmentPath = path.join(repoRoot, 'packages', 'vscode-react-pug');

  if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
    console.error(`Workspace directory does not exist: ${workspacePath}`);
    process.exit(1);
  }

  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const sessionRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `vscode-pug-react-${path.basename(workspacePath)}-`),
  );
  const userDataDir = path.join(sessionRoot, 'user-data');
  const extensionsDir = path.join(sessionRoot, 'extensions');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  const args = [
    '--new-window',
    '--skip-welcome',
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    extensionsDir,
    '--disable-extensions',
    '--extensionDevelopmentPath',
    extensionDevelopmentPath,
    workspacePath,
  ];

  if (dryRun) {
    console.log(`VS Code executable: ${vscodeExecutablePath}`);
    console.log(`Workspace: ${workspacePath}`);
    console.log(`User data dir: ${userDataDir}`);
    console.log(`Extensions dir: ${extensionsDir}`);
    console.log(`Args: ${JSON.stringify(args)}`);
    return;
  }

  const child = spawn(vscodeExecutablePath, args, { stdio: 'inherit' });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    console.error(`Failed to launch VS Code: ${err}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(`Failed to prepare fresh VS Code session: ${err}`);
  process.exit(1);
});
