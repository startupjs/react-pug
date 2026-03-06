export type SwcPugCompileMode = 'runtime' | 'languageService';

export interface SwcReactPugOptions {
  tagFunction?: string;
  mode?: SwcPugCompileMode;
}
