import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const extensionSrcDir = resolve(repoRoot, 'packages/vscode-react-pug-tsx');
const pluginSrcDir = resolve(repoRoot, 'packages/typescript-plugin-react-pug');

const extensionDistFile = resolve(extensionSrcDir, 'dist/client.js');
const pluginDistFile = resolve(pluginSrcDir, 'dist/plugin.js');

if (!existsSync(extensionDistFile) || !existsSync(pluginDistFile)) {
  throw new Error('Missing build artifacts. Run `npm run package` first.');
}

const extensionPkg = JSON.parse(
  readFileSync(resolve(extensionSrcDir, 'package.json'), 'utf8'),
);
const vsixOut = resolve(
  extensionSrcDir,
  `${extensionPkg.name}-${extensionPkg.version}.vsix`,
);

const tempRoot = resolve(repoRoot, '.tmp/vsix');
const tempExtDir = resolve(tempRoot, 'vscode-react-pug-tsx');
const tempPluginDir = resolve(
  tempExtDir,
  'node_modules/@startupjs/typescript-plugin-react-pug',
);

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(resolve(tempExtDir, 'dist'), { recursive: true });
mkdirSync(resolve(tempExtDir, 'syntaxes'), { recursive: true });
mkdirSync(resolve(tempPluginDir, 'dist'), { recursive: true });

copyFileSync(
  resolve(extensionSrcDir, 'package.json'),
  resolve(tempExtDir, 'package.json'),
);
copyFileSync(
  resolve(extensionSrcDir, '.vscodeignore'),
  resolve(tempExtDir, '.vscodeignore'),
);
copyFileSync(
  resolve(extensionSrcDir, 'dist/client.js'),
  resolve(tempExtDir, 'dist/client.js'),
);
copyFileSync(
  resolve(extensionSrcDir, 'syntaxes/pug-template-literal.json'),
  resolve(tempExtDir, 'syntaxes/pug-template-literal.json'),
);
copyFileSync(
  resolve(pluginSrcDir, 'package.json'),
  resolve(tempPluginDir, 'package.json'),
);
copyFileSync(
  resolve(pluginSrcDir, 'dist/plugin.js'),
  resolve(tempPluginDir, 'dist/plugin.js'),
);

const result = spawnSync(
  'npx',
  ['@vscode/vsce', 'package', '--allow-missing-repository', '--out', vsixOut],
  { cwd: tempExtDir, stdio: 'inherit' },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`VSIX created at ${vsixOut}`);
