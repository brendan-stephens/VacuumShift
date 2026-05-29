import { isObjectExcluded } from '@vacuumshift/shared';

export function filterIndexRowsByExclude<
  T extends {
    schema_name: string;
    object_name: string;
    parent_schema?: string | null;
    parent_table?: string | null;
  },
>(rows: T[], excludePatterns: string[]): T[] {
  if (!excludePatterns.length) return rows;
  return rows.filter(
    (row) =>
      !isObjectExcluded(excludePatterns, {
        schemaName: row.schema_name,
        objectName: row.object_name,
        parentSchema: row.parent_schema,
        parentTable: row.parent_table,
      })
  );
}
