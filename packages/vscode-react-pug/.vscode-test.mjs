import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '..', '..');

const common = {
  files: 'test/vscode/**/*.test.js',
  extensionDevelopmentPath: root,
  mocha: {
    timeout: 30000,
  },
  launchArgs: [
    '--skip-welcome',
    '--disable-workspace-trust',
    '--disable-extension=vscode.git',
  ],
};

export default defineConfig([
  {
    ...common,
    label: 'demo',
    workspaceFolder: path.join(repoRoot, 'examples', 'demo'),
    env: {
      TEST_WORKSPACE_NAME: 'demo',
    },
  },
  {
    ...common,
    label: 'sample-project',
    workspaceFolder: path.join(repoRoot, 'examples', 'sample-project'),
    env: {
      TEST_WORKSPACE_NAME: 'sample-project',
    },
  },
]);
