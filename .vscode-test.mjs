import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

const root = path.dirname(fileURLToPath(import.meta.url));

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
    workspaceFolder: path.join(root, 'examples', 'demo'),
    env: {
      TEST_WORKSPACE_NAME: 'demo',
    },
  },
  {
    ...common,
    label: 'sample-project',
    workspaceFolder: path.join(root, 'examples', 'sample-project'),
    env: {
      TEST_WORKSPACE_NAME: 'sample-project',
    },
  },
]);
