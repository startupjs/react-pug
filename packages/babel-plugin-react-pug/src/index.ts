import type { PluginObj } from '@babel/core';
import { parse } from '@babel/parser';
import { transformSourceFile } from '@startupjs/react-pug-core';

export type BabelPugCompileMode = 'runtime' | 'languageService';

export interface BabelReactPugPluginOptions {
  tagFunction?: string;
  mode?: BabelPugCompileMode;
}

function parseProgram(code: string) {
  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
    ranges: true,
    errorRecovery: false,
  }).program;
}

export default function babelPluginReactPug(
  _api: { types: any },
  options: BabelReactPugPluginOptions = {},
): PluginObj {
  const tagFunction = options.tagFunction ?? 'pug';
  const mode = options.mode ?? 'runtime';

  return {
    name: 'react-pug',
    visitor: {
      Program(path, state: any) {
        const sourceText = state?.file?.code as string | undefined;
        if (!sourceText) return;

        const fileName = (state?.filename as string | undefined)
          ?? (state?.file?.opts?.filename as string | undefined)
          ?? 'file.tsx';

        const transformed = transformSourceFile(sourceText, fileName, {
          tagFunction,
          compileMode: mode,
        });

        if (transformed.regions.length === 0) return;

        const nextProgram = parseProgram(transformed.code);
        path.node.body = nextProgram.body;
        path.node.directives = nextProgram.directives;
        path.scope.crawl();
      },
    },
  };
}
