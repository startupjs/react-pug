import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const targetArg = process.argv.find((arg) => arg === 'extension' || arg === 'plugin');

/** @type {esbuild.Plugin} */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      if (watch) console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      if (watch) console.log('[watch] build finished');
    });
  },
};

/** @type {esbuild.BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  minify: production,
  sourcemap: production ? false : true,
  sourcesContent: false,
  external: ['vscode'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  },
  logLevel: watch ? 'info' : 'warning',
  plugins: [esbuildProblemMatcherPlugin],
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
  if (watch && production) {
    throw new Error('Cannot use --watch and --production together');
  }

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
