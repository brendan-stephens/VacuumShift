/**
 * Bloat probes run against the customer's Postgres (not Supabase metadata).
 * Requires pgstattuple for accurate page-level bloat; falls back to heuristics.
 */

/** Whether the pgstattuple extension is installed (matches pg_extension). */
export const CHECK_PGSTATTUPLE_INSTALLED = `
  select exists (
    select 1 from pg_extension where extname = 'pgstattuple'
  ) as installed;
`;

/** Whether pgstatindex exists (extension may live in schema `extensions` on Supabase). */
export const CHECK_PGSTATINDEX_AVAILABLE = `
  select coalesce(
    to_regprocedure('extensions.pgstatindex(oid)'),
    to_regprocedure('pgstatindex(oid)')
  ) is not null as installed;
`;

/** Session prep: Supabase installs pgstattuple into schema `extensions`. */
export const PREPARE_PGSTAT_SEARCH_PATH = `
  set search_path to public, extensions;
`;

/**
 * Table bloat via pgstattuple (accurate). Run per candidate table in maintenance only
 * or batch with a size filter in application code.
 */
export const TABLE_BLOAT_PGSTATTUPLE = `
  select
    $1::text as schema_name,
    $2::text as object_name,
    (pgstattuple(($1::text || '.' || $2::text)::regclass)).table_len::bigint as relation_bytes,
    (pgstattuple(($1::text || '.' || $2::text)::regclass)).dead_tuple_len::bigint as bloat_bytes,
    ceil(
      (pgstattuple(($1::text || '.' || $2::text)::regclass)).dead_tuple_len::numeric
      / nullif(current_setting('block_size')::int, 0)
    )::bigint as bloat_pages,
    (pgstattuple(($1::text || '.' || $2::text)::regclass)).dead_tuple_count::bigint as dead_tuple_estimate
`;

/**
 * Per-table heap stats via pgstattuple (requires extension).
 * bloat_bytes = dead_tuple_len (routine VACUUM); free_bytes = reclaimable via FULL/repack/cluster.
 */
export const LIST_TABLE_PGSTATTUPLE = `
  select
    n.nspname as schema_name,
    c.relname as object_name,
    t.table_len::bigint as relation_bytes,
    t.dead_tuple_len::bigint as bloat_bytes,
    t.free_space::bigint as free_bytes,
    ceil(
      t.dead_tuple_len::numeric / nullif(current_setting('block_size')::int, 0)
    )::bigint as bloat_pages,
    t.dead_tuple_count::bigint as dead_tuple_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral pgstattuple(c.oid) t
  where c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and pg_relation_size(c.oid) >= $1::bigint
  order by t.free_space desc;
`;

/**
 * Fast table bloat estimate from pg_stat_user_tables (no extension required).
 */
export const LIST_TABLE_BLOAT_ESTIMATE = `
  select
    n.nspname as schema_name,
    c.relname as object_name,
    pg_relation_size(c.oid) as relation_bytes,
    greatest(
      0,
      (s.n_dead_tup * coalesce(nullif(s.n_live_tup, 0), 1)::float8
        / nullif(s.n_live_tup + s.n_dead_tup, 0))
      * pg_relation_size(c.oid)
    )::bigint as bloat_bytes,
    ceil(
      greatest(0, s.n_dead_tup)::numeric * 24
      / nullif(current_setting('block_size')::int, 0)
    )::bigint as bloat_pages,
    s.n_dead_tup::bigint as dead_tuple_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_stat_user_tables s on s.relid = c.oid
  where c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and pg_relation_size(c.oid) >= $1::bigint
  order by bloat_bytes desc;
`;

/**
 * Index bloat estimate: wasted pages from pgstatindex when extension present.
 */
export const LIST_INDEX_BLOAT_PGSTATINDEX = `
  select
    n.nspname as schema_name,
    c.relname as object_name,
    tn.nspname as parent_schema,
    tc.relname as parent_table,
    pg_relation_size(c.oid) as relation_bytes,
    (pgstatindex(c.oid)).leaf_fragmentation::bigint as bloat_bytes,
    ceil(
      (pgstatindex(c.oid)).leaf_fragmentation::numeric
      / nullif(current_setting('block_size')::int, 0)
    )::bigint as bloat_pages,
    null::bigint as dead_tuple_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_index i on i.indexrelid = c.oid
  join pg_class tc on tc.oid = i.indrelid
  join pg_namespace tn on tn.oid = tc.relnamespace
  where c.relkind = 'i'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and pg_relation_size(c.oid) >= $1::bigint
  order by bloat_bytes desc;
`;

/**
 * Index bloat heuristic when pgstattuple/pgstatindex are unavailable (btree page estimate).
 * Requires pg_stats statistics on indexed columns.
 */
export const LIST_INDEX_BLOAT_BTREE_ESTIMATE = `
  with btree_index_atts as (
    select
      n.nspname,
      tbl.relname as tablename,
      idx.relname as index_name,
      idx.reltuples,
      idx.relpages,
      current_setting('block_size')::numeric as bs,
      coalesce(
        substring(
          array_to_string(idx.reloptions, ' ')
          from 'fillfactor=([0-9]+)'
        )::smallint,
        90
      ) as fillfactor,
      24 as pagehdr,
      8 as maxalign,
      2 as index_tuple_hdr,
      sum((1 - s.null_frac) * s.avg_width) as nulldatawidth
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace n on n.oid = idx.relnamespace
    join pg_attribute a on a.attrelid = tbl.oid and a.attnum = any (i.indkey)
    join pg_stats s
      on s.schemaname = n.nspname
     and s.tablename = tbl.relname
     and s.attname = a.attname
    where a.attnum > 0
      and idx.relkind = 'i'
      and i.indisvalid
      and n.nspname not in ('pg_catalog', 'information_schema')
    group by
      n.nspname,
      tbl.relname,
      idx.relname,
      idx.reltuples,
      idx.relpages,
      idx.reloptions
  ),
  index_bloat as (
    select
      nspname as schemaname,
      tablename,
      index_name,
      relpages,
      ceil(
        reltuples * (
          index_tuple_hdr + nulldatawidth + (
            maxalign - case
              when (index_tuple_hdr + nulldatawidth)::integer % maxalign = 0
                then maxalign
              else (index_tuple_hdr + nulldatawidth)::integer % maxalign
            end
          )
        ) / (bs - pagehdr)
      )::bigint as expected_pages,
      bs
    from btree_index_atts
  )
  select
    schemaname as schema_name,
    index_name as object_name,
    schemaname as parent_schema,
    tablename as parent_table,
    (relpages * bs)::bigint as relation_bytes,
    greatest((relpages - expected_pages) * bs, 0)::bigint as bloat_bytes,
    greatest(relpages - expected_pages, 0)::bigint as bloat_pages,
    null::bigint as dead_tuple_estimate
  from index_bloat
  where (relpages * bs) >= $1::bigint
  order by bloat_bytes desc
`;

/** Indexes where indisvalid = false (e.g. failed CREATE INDEX CONCURRENTLY). */
export const LIST_INVALID_INDEXES = `
  select
    n.nspname as schema_name,
    c.relname as object_name,
    pg_relation_size(c.oid) as relation_bytes,
    0::bigint as bloat_bytes,
    null::bigint as bloat_pages,
    null::bigint as dead_tuple_estimate,
    tn.nspname as parent_schema,
    tc.relname as parent_table,
    si.idx_scan,
    st.last_vacuum,
    st.last_autovacuum
  from pg_index i
  join pg_class c on i.indexrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_class tc on tc.oid = i.indrelid
  join pg_namespace tn on tn.oid = tc.relnamespace
  left join pg_stat_user_indexes si on si.indexrelid = c.oid
  left join pg_stat_user_tables st on st.relid = i.indrelid
  where not i.indisvalid
    and n.nspname not in ('pg_catalog', 'information_schema')
    and pg_relation_size(c.oid) >= $1::bigint
  order by relation_bytes desc;
`;

/**
 * Valid, non-PK indexes with zero idx_scan since stats reset.
 * Ordered by size descending.
 */
export const LIST_UNUSED_INDEXES = `
  select
    n.nspname as schema_name,
    c.relname as object_name,
    pg_relation_size(c.oid) as relation_bytes,
    0::bigint as bloat_bytes,
    null::bigint as bloat_pages,
    null::bigint as dead_tuple_estimate,
    tn.nspname as parent_schema,
    tc.relname as parent_table,
    coalesce(si.idx_scan, 0)::bigint as idx_scan,
    i.indisunique,
    i.indisprimary
  from pg_index i
  join pg_class c on i.indexrelid = c.oid
  join pg_namespace n on c.relnamespace = n.oid
  join pg_class tc on tc.oid = i.indrelid
  join pg_namespace tn on tn.oid = tc.relnamespace
  left join pg_stat_user_indexes si on si.indexrelid = c.oid
  where i.indisvalid
    and not i.indisprimary
    and coalesce(si.idx_scan, 0) = 0
    and n.nspname not in ('pg_catalog', 'information_schema')
  order by relation_bytes desc
  limit 100;
`;

/**
 * User indexes with parent-table vacuum timestamps (stats reset on restart).
 * Ordered by most recent parent maintenance activity.
 */
export const LIST_INDEX_MAINTENANCE_EVENTS = `
  select
    n.nspname as schema_name,
    c.relname as object_name,
    tn.nspname as parent_schema,
    tc.relname as parent_table,
    i.indisvalid,
    pg_relation_size(c.oid) as relation_bytes,
    coalesce(si.idx_scan, 0)::bigint as idx_scan,
    st.last_vacuum,
    st.last_autovacuum,
    st.last_analyze,
    st.last_autoanalyze,
    greatest(
      coalesce(st.last_vacuum, 'epoch'::timestamptz),
      coalesce(st.last_autovacuum, 'epoch'::timestamptz),
      coalesce(st.last_analyze, 'epoch'::timestamptz),
      coalesce(st.last_autoanalyze, 'epoch'::timestamptz)
    ) as last_maintenance_at
  from pg_class c
  join pg_index i on i.indexrelid = c.oid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_class tc on tc.oid = i.indrelid
  join pg_namespace tn on tn.oid = tc.relnamespace
  left join pg_stat_user_indexes si on si.indexrelid = c.oid
  left join pg_stat_user_tables st on st.relid = i.indrelid
  where c.relkind = 'i'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and pg_relation_size(c.oid) >= $1::bigint
  order by last_maintenance_at desc nulls last, n.nspname, c.relname
  limit 200;
`;

export const DATABASE_SIZE = `
  select pg_database_size(current_database())::bigint as database_size_bytes;
`;

/** Global autovacuum% and vacuum_cost / freeze GUCs */
export const GLOBAL_AUTOVACUUM_SETTINGS = `
  select name, setting, unit, context, source
  from pg_settings
  where name like 'autovacuum%'
     or name in (
       'vacuum_cost_delay', 'vacuum_cost_limit',
       'vacuum_freeze_min_age', 'vacuum_freeze_table_age',
       'vacuum_multixact_freeze_min_age', 'vacuum_multixact_freeze_table_age'
     )
  order by name;
`;

/** Maintenance / parallel workers (VACUUM, REINDEX, CREATE INDEX) */
export const GLOBAL_MAINTENANCE_GUC_SETTINGS = `
  select name, setting, unit, context, source
  from pg_settings
  where name in (
    'maintenance_work_mem',
    'max_parallel_maintenance_workers',
    'max_parallel_workers'
  )
  order by name;
`;

/** Per-table storage params + reloptions that affect autovacuum */
export const TABLE_AUTOVACUUM_SETTINGS = `
  select
    n.nspname as schema_name,
    c.relname as table_name,
    coalesce(c.reloptions, '{}') as reloptions,
    jsonb_build_object(
      'n_live_tup', s.n_live_tup,
      'n_dead_tup', s.n_dead_tup,
      'last_vacuum', s.last_vacuum,
      'last_autovacuum', s.last_autovacuum,
      'last_analyze', s.last_analyze,
      'last_autoanalyze', s.last_autoanalyze
    ) as stat_snapshot
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
  where c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema')
  order by n.nspname, c.relname;
`;
