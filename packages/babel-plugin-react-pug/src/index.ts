export type BabelPugCompileMode = 'runtime' | 'languageService';

export interface BabelReactPugPluginOptions {
  tagFunction?: string;
  mode?: BabelPugCompileMode;
}

export interface BabelPluginLike {
  name: string;
  visitor: Record<string, unknown>;
}

export default function babelPluginReactPug(
  _api: unknown,
  _options: BabelReactPugPluginOptions = {},
): BabelPluginLike {
  return {
    name: 'react-pug',
    visitor: {},
  };
}
