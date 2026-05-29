/** Relation relpages for a heap or index (8k pages unless changed). */
export const REL_PAGES = `
  select coalesce(c.relpages, 0)::bigint as relpages
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1
    and c.relname = $2
    and c.relkind in ('r', 'i', 'm')
`;
