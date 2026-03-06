import type { PluginObj } from '@babel/core';
import { parse } from '@babel/parser';
import {
  mapGeneratedDiagnosticToOriginal,
  transformSourceFile,
  type GeneratedDiagnosticLike,
  type OriginalDiagnosticLocation,
  type PugDocument,
  type PugRegion,
} from '@startupjs/react-pug-core';

export type BabelPugCompileMode = 'runtime' | 'languageService';

export interface BabelReactPugPluginOptions {
  tagFunction?: string;
  mode?: BabelPugCompileMode;
}

export interface BabelReactPugMetadata {
  document: PugDocument;
  regions: PugRegion[];
}

export interface BabelReactPugTransformResult {
  code: string;
  metadata: BabelReactPugMetadata;
}

export function transformReactPugSourceForBabel(
  sourceText: string,
  fileName: string,
  options: BabelReactPugPluginOptions = {},
): BabelReactPugTransformResult {
  const transformed = transformSourceFile(sourceText, fileName, {
    tagFunction: options.tagFunction ?? 'pug',
    compileMode: options.mode ?? 'runtime',
  });

  return {
    code: transformed.code,
    metadata: {
      document: transformed.document,
      regions: transformed.regions,
    },
  };
}

export function mapBabelGeneratedDiagnosticToOriginal(
  metadata: BabelReactPugMetadata,
  diagnostic: GeneratedDiagnosticLike,
): OriginalDiagnosticLocation | null {
  return mapGeneratedDiagnosticToOriginal(metadata.document, diagnostic);
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

        const transformed = transformReactPugSourceForBabel(sourceText, fileName, {
          tagFunction,
          mode,
        });

        if (transformed.metadata.regions.length === 0) return;

        const nextProgram = parseProgram(transformed.code);
        path.node.body = nextProgram.body;
        path.node.directives = nextProgram.directives;
        state.file.metadata.reactPug = transformed.metadata;
        path.scope.crawl();
      },
    },
  };
}
