import type { PluginObj, PluginPass } from '@babel/core';
import { parseExpression } from '@babel/parser';
import type { ParseResult } from '@babel/parser';
import type { File, TaggedTemplateExpression } from '@babel/types';
import {
  createTransformSourceMap,
  mapGeneratedDiagnosticToOriginal,
  type ClassAttributeOption,
  type ClassMergeOption,
  type StartupjsCssxjsOption,
  transformSourceFile,
  type GeneratedDiagnosticLike,
  type OriginalDiagnosticLocation,
  type PugDocument,
  type PugRegion,
  type TransformSourceMap,
} from '@startupjs/react-pug-core';

export type BabelPugCompileMode = 'runtime' | 'languageService';
export type BabelPugSourceMapMode = 'basic' | 'detailed';

export interface BabelReactPugPluginOptions {
  tagFunction?: string;
  mode?: BabelPugCompileMode;
  sourceMaps?: BabelPugSourceMapMode;
  requirePugImport?: boolean;
  classShorthandProperty?: ClassAttributeOption;
  classShorthandMerge?: ClassMergeOption;
  startupjsCssxjs?: StartupjsCssxjsOption;
  componentPathFromUppercaseClassShorthand?: boolean;
}

export interface BabelReactPugMetadata {
  document: PugDocument;
  regions: PugRegion[];
}

export interface BabelReactPugTransformResult {
  code: string;
  metadata: BabelReactPugMetadata;
  sourceMap: TransformSourceMap;
}

export function transformReactPugSourceForBabel(
  sourceText: string,
  fileName: string,
  options: BabelReactPugPluginOptions = {},
): BabelReactPugTransformResult {
  const transformed = transformSourceFile(sourceText, fileName, {
    tagFunction: options.tagFunction ?? 'pug',
    compileMode: options.mode ?? 'runtime',
    requirePugImport: options.requirePugImport ?? false,
    classAttribute: options.classShorthandProperty ?? 'auto',
    classMerge: options.classShorthandMerge ?? 'auto',
    startupjsCssxjs: options.startupjsCssxjs ?? 'auto',
    componentPathFromUppercaseClassShorthand: options.componentPathFromUppercaseClassShorthand ?? true,
  });

  return {
    code: transformed.code,
    metadata: {
      document: transformed.document,
      regions: transformed.regions,
    },
    sourceMap: createTransformSourceMap(transformed, fileName),
  };
}

export function mapBabelGeneratedDiagnosticToOriginal(
  metadata: BabelReactPugMetadata,
  diagnostic: GeneratedDiagnosticLike,
): OriginalDiagnosticLocation | null {
  return mapGeneratedDiagnosticToOriginal(metadata.document, diagnostic);
}

function buildTransformCacheKey(sourceText: string, fileName: string): string {
  return `${fileName}\0${sourceText}`;
}

function parseRuntimeExpression(code: string) {
  return parseExpression(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
    errorRecovery: false,
  });
}

export default function babelPluginReactPug(
  api: { types: any },
  options: BabelReactPugPluginOptions = {},
): PluginObj & {
  parserOverride?: (
    sourceText: string,
    parserOpts: { sourceFileName?: string; sourceFilename?: string },
    parseWithBabel: (code: string, parserOpts: object) => ParseResult<File>,
  ) => ParseResult<File>,
} {
  const tagFunction = options.tagFunction ?? 'pug';
  const mode = options.mode ?? 'runtime';
  const sourceMapsMode = options.sourceMaps ?? 'basic';
  const requirePugImport = options.requirePugImport ?? false;
  const transformCache = new Map<string, BabelReactPugTransformResult>();

  function hasMatchingTagImport(programPath: any): boolean {
    return programPath.get('body').some((statementPath: any) => {
      if (!statementPath.isImportDeclaration()) return false;
      return statementPath.get('specifiers').some((specifierPath: any) => {
        if (specifierPath.isImportSpecifier()) {
          return (
            specifierPath.node.local?.name === tagFunction
            && specifierPath.node.imported?.type === 'Identifier'
            && specifierPath.node.imported.name === 'pug'
          );
        }
        if (specifierPath.isImportDefaultSpecifier()) {
          return specifierPath.node.local?.name === tagFunction;
        }
        return false;
      });
    });
  }

  const plugin: PluginObj & {
    parserOverride?: (
      sourceText: string,
      parserOpts: { sourceFileName?: string; sourceFilename?: string },
      parseWithBabel: (code: string, parserOpts: object) => ParseResult<File>,
    ) => ParseResult<File>,
  } = {
    name: 'react-pug',
    visitor: {
      Program(path: any, state: PluginPass) {
        const sourceText = state?.file?.code as string | undefined;
        if (!sourceText) return;

        const fileName = (state?.filename as string | undefined)
          ?? (state?.file?.opts?.filename as string | undefined)
          ?? 'file.tsx';

        const transformed = sourceMapsMode === 'detailed'
          ? transformCache.get(buildTransformCacheKey(sourceText, fileName))
          : transformReactPugSourceForBabel(sourceText, fileName, {
            tagFunction,
            mode,
            requirePugImport,
          });
        if (!transformed) return;
        if (transformed.metadata.regions.length === 0) return;

        if (sourceMapsMode === 'basic') {
          if (requirePugImport && !hasMatchingTagImport(path)) {
            throw path.buildCodeFrameError(`Missing import for tag function "${tagFunction}"`);
          }

          const taggedTemplates = new Map<string, any>();
          path.traverse({
            TaggedTemplateExpression(taggedPath: any) {
              const node = taggedPath.node as TaggedTemplateExpression;
              if (typeof node.start !== 'number' || typeof node.end !== 'number') return;
              taggedTemplates.set(`${node.start}:${node.end}`, taggedPath);
            },
          });

          const sortedRegions = [...transformed.metadata.regions]
            .sort((a, b) => b.originalStart - a.originalStart);

          for (const region of sortedRegions) {
            const taggedPath = taggedTemplates.get(`${region.originalStart}:${region.originalEnd}`);
            if (!taggedPath?.node) continue;
            taggedPath.replaceWith(parseRuntimeExpression(region.tsxText));
          }

          path.traverse({
            ImportDeclaration(importPath: any) {
              const sourceValue = importPath.node?.source?.value;
              if (!sourceValue) return;

              const matched = importPath.node.specifiers.filter((specifier: any) => {
                if (specifier.type === 'ImportSpecifier') {
                  return specifier.local?.name === tagFunction && specifier.imported?.type === 'Identifier' && specifier.imported.name === 'pug';
                }
                if (specifier.type === 'ImportDefaultSpecifier') {
                  return specifier.local?.name === tagFunction;
                }
                return false;
              });

              if (matched.length === 0) return;

              importPath.node.specifiers = importPath.node.specifiers.filter((specifier: any) => !matched.includes(specifier));
              if (importPath.node.specifiers.length === 0) {
                if (importPath.node.importKind === 'type') {
                  importPath.remove();
                } else {
                  importPath.replaceWith(api.types.importDeclaration([], api.types.stringLiteral(sourceValue)));
                }
              }
            },
          });

          path.scope.crawl();
        }

        (state.file.metadata as Record<string, unknown>).reactPug = transformed.metadata;
        transformCache.delete(buildTransformCacheKey(sourceText, fileName));
      },
    },
  };

  if (sourceMapsMode === 'detailed') {
    plugin.parserOverride = (
      sourceText: string,
      parserOpts: { sourceFileName?: string; sourceFilename?: string },
      parseWithBabel: (code: string, parserOpts: object) => ParseResult<File>,
    ) => {
      const fileName = parserOpts.sourceFileName ?? parserOpts.sourceFilename ?? 'file.tsx';
      const transformed = transformReactPugSourceForBabel(sourceText, fileName, {
        tagFunction,
        mode,
        requirePugImport,
      });

      transformCache.set(buildTransformCacheKey(sourceText, fileName), transformed);
      if (transformed.metadata.regions.length === 0) {
        return parseWithBabel(sourceText, parserOpts);
      }

      const inlineSourceMap = Buffer.from(JSON.stringify(transformed.sourceMap), 'utf8').toString('base64');
      const codeWithMap = `${transformed.code}\n//# sourceMappingURL=data:application/json;base64,${inlineSourceMap}`;
      return parseWithBabel(codeWithMap, parserOpts);
    };
  }

  return plugin;
}
