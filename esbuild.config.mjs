import * as esbuild from 'esbuild';

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
