import type {
  CodeMapping,
  ExtractedStyleBlock,
  MissingTagImportDiagnostic,
  PugDocument,
  PugRegion,
  ShadowCopySegment,
  ShadowInsertion,
  ShadowMappedRegion,
  StyleTagLang,
  TagImportCleanup,
} from './mapping';
import { FULL_FEATURES } from './mapping';
import {
  extractPugAnalysis,
  type ExtractedImportData,
  type StyleScopeTarget,
} from './extractRegions';
import { compilePugToTsx, type CompileOptions } from './pugToTsx';

const STARTUPJS_OR_CSSXJS_RE = /['"](?:startupjs|cssxjs)['"]/;

interface PendingReplacement {
  kind: 'replace';
  originalStart: number;
  originalEnd: number;
  text: string;
  regionIndex: number;
  mappedRegion: Omit<ShadowMappedRegion, 'shadowStart' | 'shadowEnd'> | null;
}

interface PendingInsertion {
  kind: ShadowInsertion['kind'];
  originalOffset: number;
  text: string;
  mappedRegions: Array<Omit<ShadowMappedRegion, 'shadowStart' | 'shadowEnd'>>;
  priority: number;
}

interface PendingTextReplacement {
  kind: 'import-cleanup';
  originalStart: number;
  originalEnd: number;
  text: string;
  priority: number;
}

interface StyleCallPlan {
  regionIndex: number;
  helper: StyleTagLang;
  styleBlock: ExtractedStyleBlock;
  target: StyleScopeTarget;
}

function resolveCompileOptions(
  originalText: string,
  compileOptions: CompileOptions,
): CompileOptions {
  const startupDetected = STARTUPJS_OR_CSSXJS_RE.test(originalText);
  const classAttribute = compileOptions.classAttribute ?? (startupDetected ? 'styleName' : 'className');
  const classMerge = compileOptions.classMerge ?? (classAttribute === 'styleName' ? 'classnames' : 'concatenate');

  return {
    ...compileOptions,
    classAttribute,
    classMerge,
  };
}

function fallbackNullExpression(mode: CompileOptions['mode']): string {
  return mode === 'runtime' ? 'null' : '(null as any as JSX.Element)';
}

function countLeadingWhitespace(line: string): number {
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

function makeMissingStyleImportError(styleBlock: ExtractedStyleBlock) {
  return {
    code: 'missing-pug-import-for-style' as const,
    message: 'style blocks require importing pug so the matching style helper can be resolved',
    line: styleBlock.line,
    column: styleBlock.column,
    offset: styleBlock.tagOffset,
  };
}

function buildStyleCallText(
  region: PugRegion,
  styleBlock: ExtractedStyleBlock,
  helper: StyleTagLang,
  statementIndent: string,
): { text: string; mappedRegion: Omit<ShadowMappedRegion, 'shadowStart' | 'shadowEnd'> } {
  const bodyRaw = region.pugText.slice(styleBlock.contentStart, styleBlock.contentEnd);
  const rawLines = bodyRaw.split('\n');
  const generatedBodyIndent = `${statementIndent}  `;
  let text = `${statementIndent}${helper}\`\n`;
  let generatedOffset = text.length;
  let sourceLineStart = styleBlock.contentStart;
  const mappings: CodeMapping[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i];
    const isBlank = rawLine.trim().length === 0;
    const indentToRemove = isBlank ? rawLine.length : Math.min(styleBlock.commonIndent, countLeadingWhitespace(rawLine));
    const dedented = isBlank ? '' : rawLine.slice(indentToRemove);
    const generatedLine = dedented.length > 0 ? `${generatedBodyIndent}${dedented}` : '';

    if (dedented.length > 0) {
      mappings.push({
        sourceOffsets: [sourceLineStart + indentToRemove],
        generatedOffsets: [generatedOffset + generatedBodyIndent.length],
        lengths: [dedented.length],
        data: FULL_FEATURES,
      });
    }

    text += generatedLine;
    generatedOffset += generatedLine.length;

    if (i < rawLines.length - 1 || bodyRaw.endsWith('\n')) {
      text += '\n';
      generatedOffset += 1;
    }

    sourceLineStart += rawLine.length + 1;
  }

  if (!text.endsWith('\n')) {
    text += '\n';
    generatedOffset += 1;
  }

  text += `${statementIndent}\`\n`;

  return {
    text,
    mappedRegion: {
      kind: 'style',
      regionIndex: -1,
      sourceStart: styleBlock.contentStart,
      sourceEnd: styleBlock.contentEnd,
      mappings,
    },
  };
}

function groupKeyForTarget(target: StyleScopeTarget): string {
  return `${target.kind}:${target.insertionOffset}:${target.expressionEnd ?? -1}`;
}

function buildStyleInsertions(
  originalText: string,
  regions: PugRegion[],
  plans: StyleCallPlan[],
): PendingInsertion[] {
  const grouped = new Map<string, { target: StyleScopeTarget; plans: StyleCallPlan[] }>();
  for (const plan of plans) {
    const key = groupKeyForTarget(plan.target);
    const existing = grouped.get(key);
    if (existing) {
      existing.plans.push(plan);
    } else {
      grouped.set(key, { target: plan.target, plans: [plan] });
    }
  }

  const insertions: PendingInsertion[] = [];
  for (const { target, plans: targetPlans } of grouped.values()) {
    let text = '';
    const mappedRegions: Array<Omit<ShadowMappedRegion, 'shadowStart' | 'shadowEnd'>> = [];

    if (target.kind === 'arrow-expression' || target.kind === 'statement-body') {
      text += '{\n';
    } else if (
      target.insertionOffset > 0
      && originalText[target.insertionOffset - 1] !== '\n'
      && originalText[target.insertionOffset - 1] !== '\r'
      && originalText[target.insertionOffset] !== '\n'
      && originalText[target.insertionOffset] !== '\r'
    ) {
      const prevChar = originalText[target.insertionOffset - 1];
      if (prevChar !== '\n' && prevChar !== '\r') text += '\n';
    }

    for (const plan of targetPlans) {
      const built = buildStyleCallText(regions[plan.regionIndex], plan.styleBlock, plan.helper, target.statementIndent);
      mappedRegions.push({
        ...built.mappedRegion,
        regionIndex: plan.regionIndex,
      });
      const mappedRegion = mappedRegions[mappedRegions.length - 1];
      const offsetBefore = text.length;
      text += built.text;
      mappedRegion.sourceStart = built.mappedRegion.sourceStart;
      mappedRegion.sourceEnd = built.mappedRegion.sourceEnd;
      mappedRegion.mappings = built.mappedRegion.mappings.map((mapping) => ({
        ...mapping,
        generatedOffsets: mapping.generatedOffsets.map((offset) => offset + offsetBefore),
      }));
    }

    if (target.kind === 'arrow-expression') {
      text += `${target.statementIndent}return `;
      insertions.push({
        kind: 'style-call',
        originalOffset: target.insertionOffset,
        text,
        mappedRegions,
        priority: 0,
      });
      insertions.push({
        kind: 'arrow-body-suffix',
        originalOffset: target.expressionEnd ?? target.insertionOffset,
        text: `;\n${target.closingIndent}}`,
        mappedRegions: [],
        priority: 2,
      });
    } else if (target.kind === 'statement-body') {
      text += target.statementIndent;
      insertions.push({
        kind: 'style-call',
        originalOffset: target.insertionOffset,
        text,
        mappedRegions,
        priority: 0,
      });
      insertions.push({
        kind: 'statement-body-suffix',
        originalOffset: target.statementEnd ?? target.insertionOffset,
        text: `\n${target.closingIndent}}`,
        mappedRegions: [],
        priority: 2,
      });
    } else {
      insertions.push({
        kind: 'style-call',
        originalOffset: target.insertionOffset,
        text,
        mappedRegions,
        priority: 1,
      });
    }
  }

  return insertions;
}

function buildImportCleanupWithHelpers(
  originalText: string,
  entry: ExtractedImportData,
  helpersToAdd: Set<StyleTagLang>,
  removeTagImport: boolean,
): { cleanup: TagImportCleanup | null; mergedHelpers: Set<StyleTagLang> } {
  const declaration = entry.declaration;
  const originalStart = declaration.start ?? 0;
  const originalEnd = declaration.end ?? originalStart;
  const originalImportText = originalText.slice(originalStart, originalEnd);
  const hasSemicolon = originalImportText.trimEnd().endsWith(';');
  const sourceText = entry.sourceText;
  const matchedSpecifiers = removeTagImport ? entry.matchedSpecifiers : [];
  const remaining = declaration.specifiers.filter(spec => !matchedSpecifiers.includes(spec as any));
  const defaultSpecifier = remaining.find(spec => spec.type === 'ImportDefaultSpecifier');
  const namespaceSpecifier = remaining.find(spec => spec.type === 'ImportNamespaceSpecifier');
  const namedSpecifiers = remaining.filter(spec => spec.type === 'ImportSpecifier');
  const namedPieces = namedSpecifiers.map(spec => originalText.slice(spec.start ?? 0, spec.end ?? 0));
  const existingLocalNames = new Set(namedSpecifiers.map(spec => spec.local.name));
  const mergedHelpers = new Set<StyleTagLang>();

  if (!namespaceSpecifier) {
    for (const helper of [...helpersToAdd].sort()) {
      if (existingLocalNames.has(helper)) continue;
      namedPieces.push(helper);
      existingLocalNames.add(helper);
      mergedHelpers.add(helper);
    }
  }

  const parts: string[] = [];
  if (defaultSpecifier) parts.push(originalText.slice(defaultSpecifier.start ?? 0, defaultSpecifier.end ?? 0));
  if (namespaceSpecifier) parts.push(originalText.slice(namespaceSpecifier.start ?? 0, namespaceSpecifier.end ?? 0));
  if (namedPieces.length > 0) parts.push(`{ ${namedPieces.join(', ')} }`);

  let replacement = '';
  if (parts.length === 0) {
    replacement = declaration.importKind === 'type'
      ? ''
      : `import ${sourceText}${hasSemicolon ? ';' : ''}`;
  } else {
    const importPrefix = declaration.importKind === 'type' ? 'import type ' : 'import ';
    replacement = `${importPrefix}${parts.join(', ')} from ${sourceText}${hasSemicolon ? ';' : ''}`;
  }

  return {
    cleanup: {
      originalStart,
      originalEnd,
      replacementText: replacement,
    },
    mergedHelpers,
  };
}

/**
 * Build a shadow document from source text.
 *
 * 1. Extract pug regions using @babel/parser
 * 2. Compile each region's pug text to TSX
 * 3. Insert extracted style blocks at their target scope tops
 * 4. Replace each pug`...` span in the original text with generated TSX
 */
export function buildShadowDocument(
  originalText: string,
  uri: string,
  version: number = 1,
  tagName: string = 'pug',
  compileOptions: CompileOptions & { requirePugImport?: boolean; removeTagImport?: boolean } = {},
): PugDocument {
  const resolvedCompileOptions = resolveCompileOptions(originalText, compileOptions);
  const analysis = extractPugAnalysis(originalText, uri, tagName);
  const regions = analysis.regions;
  const removeTagImport = compileOptions.removeTagImport !== false;
  const missingTagImport: MissingTagImportDiagnostic | null = (
    compileOptions.requirePugImport && analysis.usesTagFunction && !analysis.hasTagImport
  ) ? {
    message: `Missing import for tag function "${tagName}"`,
    start: analysis.regions[0]?.originalStart ?? 0,
    length: Math.max(1, tagName.length),
  } : null;

  if (regions.length === 0) {
    return {
      originalText,
      uri,
      regions: [],
      importCleanups: [],
      copySegments: [{
        originalStart: 0,
        originalEnd: originalText.length,
        shadowStart: 0,
        shadowEnd: originalText.length,
      }],
      mappedRegions: [],
      insertions: [],
      shadowText: originalText,
      version,
      regionDeltas: [],
      usesTagFunction: false,
      hasTagImport: analysis.hasTagImport,
      missingTagImport: null,
    };
  }

  const stylePlans: StyleCallPlan[] = [];
  const requiredHelpers = new Set<StyleTagLang>();

  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    const compiled = compilePugToTsx(region.pugText, resolvedCompileOptions);
    region.tsxText = compiled.tsx;
    region.mappings = compiled.mappings;
    region.lexerTokens = compiled.lexerTokens;
    region.parseError = compiled.parseError;
    region.transformError = compiled.transformError;
    region.styleBlock = compiled.styleBlock;

    if (region.styleBlock && region.transformError == null) {
      if (!analysis.tagImportSource) {
        region.transformError = makeMissingStyleImportError(region.styleBlock);
        region.tsxText = fallbackNullExpression(resolvedCompileOptions.mode);
        region.mappings = [];
        region.lexerTokens = [];
      } else {
        stylePlans.push({
          regionIndex: i,
          helper: region.styleBlock.lang,
          styleBlock: region.styleBlock,
          target: analysis.styleScopeTargets[i],
        });
        requiredHelpers.add(region.styleBlock.lang);
      }
    }
  }

  const importCleanups: TagImportCleanup[] = [];
  const unmergedHelpers = new Set(
    [...requiredHelpers].filter(helper => !analysis.existingStyleImports.has(helper)),
  );
  for (const entry of analysis.tagImportEntries) {
    const { cleanup, mergedHelpers } = buildImportCleanupWithHelpers(
      originalText,
      entry,
      unmergedHelpers,
      removeTagImport,
    );
    if (cleanup && (removeTagImport || mergedHelpers.size > 0)) {
      importCleanups.push(cleanup);
    } else if (removeTagImport && entry.cleanup) {
      importCleanups.push(entry.cleanup);
    }
    for (const helper of mergedHelpers) unmergedHelpers.delete(helper);
  }

  const pendingInsertions: PendingInsertion[] = [];
  if (analysis.tagImportSourceText && analysis.helperImportInsertionOffset != null) {
    for (const helper of [...unmergedHelpers].sort()) {
      pendingInsertions.push({
        kind: 'style-import',
        originalOffset: analysis.helperImportInsertionOffset,
        text: `import { ${helper} } from ${analysis.tagImportSourceText};\n`,
        mappedRegions: [],
        priority: -1,
      });
    }
  }
  pendingInsertions.push(...buildStyleInsertions(originalText, regions, stylePlans));
  const pendingImportCleanups: PendingTextReplacement[] = importCleanups.map((cleanup) => ({
    kind: 'import-cleanup',
    originalStart: cleanup.originalStart,
    originalEnd: cleanup.originalEnd,
    text: cleanup.replacementText,
    priority: -2,
  }));

  const pendingReplacements: PendingReplacement[] = regions.map((region, regionIndex) => ({
    kind: 'replace',
    originalStart: region.originalStart,
    originalEnd: region.originalEnd,
    text: region.tsxText,
    regionIndex,
    mappedRegion: region.mappings.length > 0
      ? {
        kind: 'pug',
        regionIndex,
        sourceStart: 0,
        sourceEnd: region.pugText.length,
        mappings: region.mappings,
      }
      : null,
  }));

  const edits = [
    ...pendingImportCleanups.map((replacement) => ({
      sortStart: replacement.originalStart,
      priority: replacement.priority,
      edit: replacement,
    })),
    ...pendingInsertions.map((insertion) => ({
      sortStart: insertion.originalOffset,
      priority: insertion.priority,
      edit: insertion,
    })),
    ...pendingReplacements.map((replacement) => ({
      sortStart: replacement.originalStart,
      priority: 1,
      edit: replacement,
    })),
  ].sort((a, b) => {
    if (a.sortStart !== b.sortStart) return a.sortStart - b.sortStart;
    return a.priority - b.priority;
  });

  let shadowText = '';
  let cursor = 0;
  const copySegments: ShadowCopySegment[] = [];
  const mappedRegions: ShadowMappedRegion[] = [];
  const insertions: ShadowInsertion[] = [];

  for (const { edit } of edits) {
    if ('originalStart' in edit) {
      if (cursor < edit.originalStart) {
        const shadowStart = shadowText.length;
        const copied = originalText.slice(cursor, edit.originalStart);
        shadowText += copied;
        copySegments.push({
          originalStart: cursor,
          originalEnd: edit.originalStart,
          shadowStart,
          shadowEnd: shadowText.length,
        });
      }

      const shadowStart = shadowText.length;
      edit.text && (shadowText += edit.text);
      if ('regionIndex' in edit) {
        regions[edit.regionIndex].shadowStart = shadowStart;
        regions[edit.regionIndex].shadowEnd = shadowText.length;
        if (edit.mappedRegion) {
          mappedRegions.push({
            ...edit.mappedRegion,
            shadowStart,
            shadowEnd: shadowText.length,
          });
        }
      }
      cursor = edit.originalEnd;
      continue;
    }

    if (cursor < edit.originalOffset) {
      const shadowStart = shadowText.length;
      const copied = originalText.slice(cursor, edit.originalOffset);
      shadowText += copied;
      copySegments.push({
        originalStart: cursor,
        originalEnd: edit.originalOffset,
        shadowStart,
        shadowEnd: shadowText.length,
      });
      cursor = edit.originalOffset;
    }

    const shadowStart = shadowText.length;
    shadowText += edit.text;
    insertions.push({
      kind: edit.kind,
      originalOffset: edit.originalOffset,
      shadowStart,
      shadowEnd: shadowText.length,
    });
    for (const mappedRegion of edit.mappedRegions) {
      mappedRegions.push({
        ...mappedRegion,
        shadowStart: shadowStart,
        shadowEnd: shadowStart + edit.text.length,
      });
    }
  }

  if (cursor < originalText.length) {
    const shadowStart = shadowText.length;
    shadowText += originalText.slice(cursor);
    copySegments.push({
      originalStart: cursor,
      originalEnd: originalText.length,
      shadowStart,
      shadowEnd: shadowText.length,
    });
  }

  const regionDeltas = regions.map(region => region.shadowStart - region.originalStart);

  const document: PugDocument = {
    originalText,
    uri,
    regions,
    importCleanups,
    copySegments,
    mappedRegions,
    insertions,
    shadowText,
    version,
    regionDeltas,
    usesTagFunction: analysis.usesTagFunction,
    hasTagImport: analysis.hasTagImport,
    missingTagImport,
  };

  return document;
}
