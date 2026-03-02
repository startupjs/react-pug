import type ts from 'typescript';

function init(_modules: { typescript: typeof ts }): ts.server.PluginModule {
  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      return info.languageService;
    },
  };
}

export = init;
