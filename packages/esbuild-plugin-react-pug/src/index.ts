import type { Plugin } from 'esbuild';

export interface EsbuildReactPugOptions {
  tagFunction?: string;
}

export function reactPugEsbuildPlugin(_options: EsbuildReactPugOptions = {}): Plugin {
  return {
    name: 'react-pug',
    setup() {
      // implemented in a follow-up task
    },
  };
}
