import { parseExpression } from '@babel/parser';
import type { TaggedTemplateExpression } from '@babel/types';
import type { PugRegion, StyleTagLang } from '@react-pug/react-pug-core';

interface BasicTransformMetadata {
  regions: PugRegion[];
}

function parseRuntimeExpression(code: string) {
  return parseExpression(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
    errorRecovery: false,
  });
}

function escapeTemplateLiteralContent(content: string): string {
  return content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function formatStyleTemplateLiteralContent(content: string): string {
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
  const lines = normalized.split('\n');
  const indented = lines.map(line => (line.length > 0 ? `  ${line}` : ''));
  return `\n${indented.join('\n')}\n`;
}

function parseRuntimeStyleCall(helper: string, content: string) {
  return parseRuntimeExpression(`${helper}\`${escapeTemplateLiteralContent(formatStyleTemplateLiteralContent(content))}\``);
}

function isDirectiveStatementPath(path: any): boolean {
  return path.isExpressionStatement() && typeof path.node.directive === 'string';
}

function shouldWrapStatementBodyPath(parentPath: any, key: string | number | null, childPath: any): boolean {
  if (!childPath || childPath.isBlockStatement()) return false;
  if (typeof key !== 'string') return false;

  if (parentPath.isIfStatement() && (key === 'consequent' || key === 'alternate')) return true;
  if (
    (parentPath.isWhileStatement()
      || parentPath.isDoWhileStatement()
      || parentPath.isForStatement()
      || parentPath.isForInStatement()
      || parentPath.isForOfStatement()
      || parentPath.isWithStatement()
      || parentPath.isLabeledStatement())
    && key === 'body'
  ) {
    return true;
  }

  return false;
}

function findStyleInsertionTarget(taggedPath: any): { kind: 'program' | 'block' | 'arrow-expression' | 'statement-body'; path: any; key?: string } {
  let current = taggedPath;
  while (current?.parentPath) {
    const parentPath = current.parentPath;
    const key = typeof current.key === 'string' ? current.key : null;

    if (parentPath.isArrowFunctionExpression() && key === 'body' && !current.isBlockStatement()) {
      return { kind: 'arrow-expression', path: parentPath };
    }
    if (shouldWrapStatementBodyPath(parentPath, key, current)) {
      return { kind: 'statement-body', path: parentPath, key: key ?? undefined };
    }
    if (parentPath.isBlockStatement()) {
      return { kind: 'block', path: parentPath };
    }
    if (parentPath.isProgram()) {
      return { kind: 'program', path: parentPath };
    }

    current = parentPath;
  }

  return { kind: 'program', path: taggedPath.findParent((p: any) => p.isProgram()) };
}

function insertAtStartOfContainer(api: { types: any }, target: { kind: 'program' | 'block'; path: any }, statements: any[]): void {
  const bodyPaths = target.path.get('body');
  const anchor = bodyPaths.find((statementPath: any) => (
    target.kind === 'program'
      ? !statementPath.isImportDeclaration() && !isDirectiveStatementPath(statementPath)
      : !isDirectiveStatementPath(statementPath)
  ));

  if (anchor) {
    anchor.insertBefore(statements);
  } else {
    target.path.pushContainer('body', statements);
  }
}

function ensureStyleHelpersOnImport(api: { types: any }, importPath: any, helpers: string[]): void {
  const existing = new Set(
    importPath.node.specifiers
      .filter((specifier: any) => specifier.type === 'ImportSpecifier' && specifier.imported?.type === 'Identifier')
      .map((specifier: any) => specifier.imported.name),
  );

  for (const helper of helpers) {
    if (existing.has(helper)) continue;
    importPath.node.specifiers.push(
      api.types.importSpecifier(api.types.identifier(helper), api.types.identifier(helper)),
    );
    existing.add(helper);
  }
}

function hoistStyleCallAtTarget(
  api: { types: any },
  taggedPath: any,
  helper: string,
  content: string,
): void {
  const statement = api.types.expressionStatement(parseRuntimeStyleCall(helper, content));
  const target = findStyleInsertionTarget(taggedPath);

  if (target.kind === 'program' || target.kind === 'block') {
    insertAtStartOfContainer(api, { kind: target.kind, path: target.path }, [statement]);
    return;
  }

  if (target.kind === 'arrow-expression') {
    const originalBody = target.path.get('body').node;
    target.path.get('body').replaceWith(
      api.types.blockStatement([
        statement,
        api.types.returnStatement(originalBody),
      ]),
    );
    return;
  }

  if (target.kind === 'statement-body') {
    const originalBody = target.path.get(target.key as string).node;
    target.path.get(target.key as string).replaceWith(
      api.types.blockStatement([statement, originalBody]),
    );
  }
}

function hasMatchingTagImport(programPath: any, tagFunction: string): boolean {
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

export function applyBasicRuntimeTransform(
  api: { types: any },
  programPath: any,
  transformed: { metadata: BasicTransformMetadata },
  tagFunction: string,
  requirePugImport: boolean,
): void {
  if (requirePugImport && !hasMatchingTagImport(programPath, tagFunction)) {
    throw programPath.buildCodeFrameError(`Missing import for tag function "${tagFunction}"`);
  }

  const taggedTemplates = new Map<string, any>();
  const matchingImportPaths: any[] = [];
  const matchingImportSources = new Set<string>();

  programPath.traverse({
    TaggedTemplateExpression(taggedPath: any) {
      const node = taggedPath.node as TaggedTemplateExpression;
      if (typeof node.start !== 'number' || typeof node.end !== 'number') return;
      taggedTemplates.set(`${node.start}:${node.end}`, taggedPath);
    },
    ImportDeclaration(importPath: any) {
      const matched = importPath.get('specifiers').some((specifierPath: any) => {
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
      if (!matched) return;
      matchingImportPaths.push(importPath);
      if (typeof importPath.node?.source?.value === 'string') {
        matchingImportSources.add(importPath.node.source.value);
      }
    },
  });

  const helpersNeeded = [...new Set(
    transformed.metadata.regions
      .map(region => region.styleBlock?.lang)
      .filter((helper): helper is StyleTagLang => helper != null),
  )];

  if (helpersNeeded.length > 0 && matchingImportPaths.length > 0) {
    ensureStyleHelpersOnImport(api, matchingImportPaths[0], helpersNeeded);
  }

  const sortedRegions = [...transformed.metadata.regions]
    .sort((a, b) => b.originalStart - a.originalStart);

  for (const region of sortedRegions) {
    const taggedPath = taggedTemplates.get(`${region.originalStart}:${region.originalEnd}`);
    if (!taggedPath?.node) continue;
    if (region.styleBlock) {
      hoistStyleCallAtTarget(api, taggedPath, region.styleBlock.lang, region.styleBlock.content);
    }
    taggedPath.replaceWith(parseRuntimeExpression(region.tsxText));
  }

  programPath.traverse({
    ImportDeclaration(importPath: any) {
      const sourceValue = importPath.node?.source?.value;
      if (!sourceValue) return;
      if (matchingImportSources.size > 0 && !matchingImportSources.has(sourceValue)) return;

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

  programPath.scope.crawl();
}
