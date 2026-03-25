function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createTagFunctionPresenceRegex(tagFunction: string = 'pug'): RegExp {
  return new RegExp('(?:^|[^\\w$.])' + escapeRegex(tagFunction) + '\\x60');
}

export function hasTagFunctionCall(sourceText: string, tagFunction: string = 'pug'): boolean {
  if (!tagFunction) return false;
  return createTagFunctionPresenceRegex(tagFunction).test(sourceText);
}
