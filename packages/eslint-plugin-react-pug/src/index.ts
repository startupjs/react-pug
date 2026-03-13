import {
  type ClassAttributeOption,
  type ClassMergeOption,
  lineColumnToOffset,
  mapGeneratedRangeToOriginal,
  offsetToLineColumn,
  type StartupjsCssxjsOption,
  transformSourceFile,
} from '@react-pug/react-pug-core';

interface EslintReactPugProcessorOptions {
  tagFunction?: string;
  requirePugImport?: boolean;
  classShorthandProperty?: ClassAttributeOption;
  classShorthandMerge?: ClassMergeOption;
  startupjsCssxjs?: StartupjsCssxjsOption;
  componentPathFromUppercaseClassShorthand?: boolean;
}

interface EslintLintMessage {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  [key: string]: unknown;
}

type SourceTransformState = ReturnType<typeof transformSourceFile>;

interface EslintProcessorLike {
  preprocess: (
    text: string,
    filename: string,
  ) => Array<string | { text: string; filename: string }>;
  postprocess: (messages: EslintLintMessage[][], filename: string) => EslintLintMessage[];
  supportsAutofix: boolean;
}

function getVirtualLintFilename(filename: string): string {
  // ESLint nests processor blocks under "<physical-file>/0_<block-filename>".
  // We escape back to a sibling filename so flat-config globs see a clean
  // ".jsx"/".tsx" path instead of ".../file.js/0_pug-react.jsx".
  if (/\.(?:ts|tsx|mts|cts)$/i.test(filename)) return '../../../pug-react.tsx';
  return '../../../pug-react.jsx';
}

function mapLintMessage(
  message: EslintLintMessage,
  transformed: SourceTransformState,
): EslintLintMessage {
  if (message.line == null || message.column == null) return message;

  const generatedStart = lineColumnToOffset(transformed.code, message.line, message.column);
  const generatedEnd = (message.endLine != null && message.endColumn != null)
    ? lineColumnToOffset(transformed.code, message.endLine, message.endColumn)
    : generatedStart + 1;

  const mapped = mapGeneratedRangeToOriginal(
    transformed.document,
    generatedStart,
    Math.max(1, generatedEnd - generatedStart),
  );

  if (!mapped) return message;

  const startLc = offsetToLineColumn(transformed.document.originalText, mapped.start);
  const endLc = offsetToLineColumn(transformed.document.originalText, mapped.end);

  return {
    ...message,
    line: startLc.line,
    column: startLc.column,
    endLine: endLc.line,
    endColumn: endLc.column,
  };
}

function createReactPugProcessor(
  options: EslintReactPugProcessorOptions = {},
): EslintProcessorLike {
  const cache = new Map<string, SourceTransformState>();

  return {
    preprocess(
      text: string,
      filename: string,
    ): Array<string | { text: string; filename: string }> {
      const transformed = transformSourceFile(text, filename, {
        tagFunction: options.tagFunction ?? 'pug',
        compileMode: 'runtime',
        requirePugImport: options.requirePugImport ?? false,
        classAttribute: options.classShorthandProperty ?? 'auto',
        classMerge: options.classShorthandMerge ?? 'auto',
        startupjsCssxjs: options.startupjsCssxjs ?? 'auto',
        componentPathFromUppercaseClassShorthand: options.componentPathFromUppercaseClassShorthand ?? true,
      });
      cache.set(filename, transformed);
      if (transformed.regions.length === 0) return [transformed.code];
      return [{
        text: transformed.code,
        filename: getVirtualLintFilename(filename),
      }];
    },

    postprocess(messages: EslintLintMessage[][], filename: string): EslintLintMessage[] {
      const transformed = cache.get(filename);
      cache.delete(filename);

      const flat = messages.flat();
      if (!transformed) return flat;
      if (transformed.regions.length === 0) return flat;

      return flat.map((msg) => mapLintMessage(msg, transformed));
    },

    supportsAutofix: true,
  };
}

const defaultProcessor = createReactPugProcessor();

const plugin = {
  processors: {
    'pug-react': defaultProcessor,
  },
  createReactPugProcessor,
};

export = plugin;
