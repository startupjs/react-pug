import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

const configs = [
  {
    ...shared,
    entryPoints: ['src/extension/index.ts'],
    outfile: 'dist/client.js',
  },
  {
    ...shared,
    entryPoints: ['src/plugin/index.ts'],
    outfile: 'dist/plugin.js',
  },
];

/** Create a shim module so tsserver can resolve the plugin by name */
function createPluginShim() {
  const shimDir = path.resolve('node_modules/vscode-pug-react');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(
    path.join(shimDir, 'package.json'),
    JSON.stringify({ name: 'vscode-pug-react', main: '../../dist/plugin.js' }),
  );
}

async function main() {
  if (watch) {
    const contexts = await Promise.all(configs.map(c => esbuild.context(c)));
    await Promise.all(contexts.map(c => c.watch()));
    createPluginShim();
    console.log('Watching for changes...');
  } else {
    await Promise.all(configs.map(c => esbuild.build(c)));
    createPluginShim();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
