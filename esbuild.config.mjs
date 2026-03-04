import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const targetArg = process.argv.find((arg) => arg === 'extension' || arg === 'plugin');

/** @type {esbuild.BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

const allConfigs = {
  extension: {
    ...shared,
    entryPoints: ['packages/vscode-react-pug/src/index.ts'],
    outfile: 'packages/vscode-react-pug/dist/client.js',
  },
  plugin: {
    ...shared,
    entryPoints: ['packages/typescript-plugin-react-pug/src/index.ts'],
    outfile: 'packages/typescript-plugin-react-pug/dist/plugin.js',
  },
};

const configs = targetArg
  ? [allConfigs[targetArg]]
  : [allConfigs.extension, allConfigs.plugin];

async function main() {
  if (watch) {
    const contexts = await Promise.all(configs.map(c => esbuild.context(c)));
    await Promise.all(contexts.map(c => c.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(configs.map(c => esbuild.build(c)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
