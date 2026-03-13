import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const pluginPkg = JSON.parse(
  readFileSync(resolve(pluginSrcDir, 'package.json'), 'utf8'),
);
const tempRoot = resolve(repoRoot, '.tmp/vsix');
const vsixVersionedOut = resolve(
  tempRoot,
  `${extensionPkg.name}-${extensionPkg.version}.vsix`,
);
const vsixStableOut = resolve(tempRoot, `${extensionPkg.name}.vsix`);
const tempExtDir = resolve(tempRoot, 'vscode-react-pug-tsx');
const tempPluginDir = resolve(
  tempExtDir,
  'node_modules/@react-pug/typescript-plugin-react-pug',
);
const iconRelativePath = typeof extensionPkg.icon === 'string' ? extensionPkg.icon : null;
const iconSrcFile = iconRelativePath ? resolve(extensionSrcDir, iconRelativePath) : null;

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(resolve(tempExtDir, 'dist'), { recursive: true });
mkdirSync(resolve(tempExtDir, 'syntaxes'), { recursive: true });
mkdirSync(resolve(tempPluginDir, 'dist'), { recursive: true });

if (iconRelativePath && !existsSync(iconSrcFile)) {
  throw new Error(`Extension icon not found: ${iconRelativePath}`);
}

const stagedExtensionPkg = {
  ...extensionPkg,
  scripts: {},
};

const stagedPluginPkg = {
  name: pluginPkg.name,
  version: pluginPkg.version,
  main: pluginPkg.main,
};

mkdirSync(tempExtDir, { recursive: true });
writeFileSync(
  resolve(tempExtDir, 'package.json'),
  `${JSON.stringify(stagedExtensionPkg, null, 2)}\n`,
);
copyFileSync(
  resolve(extensionSrcDir, 'LICENSE.md'),
  resolve(tempExtDir, 'LICENSE.md'),
);
copyFileSync(
  resolve(extensionSrcDir, 'README.md'),
  resolve(tempExtDir, 'README.md'),
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

if (iconRelativePath) {
  const tempIconFile = resolve(tempExtDir, iconRelativePath);
  mkdirSync(dirname(tempIconFile), { recursive: true });
  copyFileSync(iconSrcFile, tempIconFile);

  const vscodeIgnorePath = resolve(tempExtDir, '.vscodeignore');
  const vscodeIgnore = readFileSync(vscodeIgnorePath, 'utf8');
  const iconAllowRule = `!${iconRelativePath.replaceAll('\\', '/')}`;
  if (!vscodeIgnore.includes(iconAllowRule)) {
    writeFileSync(vscodeIgnorePath, `${vscodeIgnore.trimEnd()}\n${iconAllowRule}\n`);
  }
}
writeFileSync(
  resolve(tempPluginDir, 'package.json'),
  `${JSON.stringify(stagedPluginPkg, null, 2)}\n`,
);
copyFileSync(
  resolve(pluginSrcDir, 'dist/plugin.js'),
  resolve(tempPluginDir, 'dist/plugin.js'),
);

const result = spawnSync(
  'npx',
  ['@vscode/vsce', 'package', '--allow-missing-repository', '--out', vsixVersionedOut],
  { cwd: tempExtDir, stdio: 'inherit' },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

copyFileSync(vsixVersionedOut, vsixStableOut);

console.log(`VSIX created at ${vsixVersionedOut}`);
console.log(`Stable VSIX path: ${vsixStableOut}`);
