export interface ExcludeMatchInput {
  schemaName: string;
  objectName: string;
  parentSchema?: string | null;
  parentTable?: string | null;
}

/** Names tested against exclude regexes (index/table + parent table + schema). */
export function excludeMatchNames(input: ExcludeMatchInput): string[] {
  const names = [`${input.schemaName}.${input.objectName}`, input.schemaName];
  if (input.parentSchema && input.parentTable) {
    names.push(`${input.parentSchema}.${input.parentTable}`);
    names.push(input.parentSchema);
  }
  return names;
}

/** True when any candidate name matches any POSIX regex pattern. */
export function matchesExcludePattern(
  qualifiedName: string,
  patterns: string[]
): boolean {
  if (!patterns.length) return false;
  return patterns.some((p) => {
    try {
      return new RegExp(p).test(qualifiedName);
    } catch {
      return false;
    }
  });
}

export function isObjectExcluded(patterns: string[], input: ExcludeMatchInput): boolean {
  if (!patterns.length) return false;
  const names = excludeMatchNames(input);
  return names.some((name) => matchesExcludePattern(name, patterns));
}
