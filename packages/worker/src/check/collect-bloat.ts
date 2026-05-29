import pg from 'pg';
import type {
  CollectedBloatObject,
  BloatCheckResult,
  BloatRow,
  IndexMaintenanceEvent,
} from '../types.js';
import { isObjectExcluded } from '@vacuumshift/shared';
import type { BloatCollectionThresholds } from './thresholds.js';
import {
  CHECK_PGSTATINDEX_AVAILABLE,
  CHECK_PGSTATTUPLE_INSTALLED,
  DATABASE_SIZE,
  LIST_INDEX_BLOAT_BTREE_ESTIMATE,
  LIST_INDEX_BLOAT_PGSTATINDEX,
  LIST_INDEX_MAINTENANCE_EVENTS,
  LIST_INVALID_INDEXES,
  LIST_UNUSED_INDEXES,
  LIST_TABLE_BLOAT_ESTIMATE,
  LIST_TABLE_PGSTATTUPLE,
  PREPARE_PGSTAT_SEARCH_PATH,
} from '../sql/bloat.js';

const { Client } = pg;

function applyExcludePatterns(
  objects: CollectedBloatObject[],
  patterns: string[]
): CollectedBloatObject[] {
  if (!patterns.length) return objects;
  return objects.filter(
    (o) =>
      !isObjectExcluded(patterns, {
        schemaName: o.schemaName,
        objectName: o.objectName,
        parentSchema: o.parentSchema,
        parentTable: o.parentTable,
      })
  );
}

function toNum(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function mapTableRow(row: BloatRow): CollectedBloatObject {
  const schemaName = row.schema_name;
  const objectName = row.object_name;
  return {
    kind: 'table',
    schemaName,
    objectName,
    qualifiedName: `${schemaName}.${objectName}`,
    relationBytes: toNum(row.relation_bytes),
    bloatBytes: toNum(row.bloat_bytes),
    bloatPages: row.bloat_pages != null ? toNum(row.bloat_pages) : null,
    deadTupleEstimate:
      row.dead_tuple_estimate != null ? toNum(row.dead_tuple_estimate) : null,
  };
}

function mapUnusedIndexRow(row: BloatRow): CollectedBloatObject {
  const schemaName = row.schema_name;
  const objectName = row.object_name;
  return {
    kind: 'unused_index',
    schemaName,
    objectName,
    qualifiedName: `${schemaName}.${objectName}`,
    relationBytes: toNum(row.relation_bytes),
    bloatBytes: 0,
    bloatPages: null,
    deadTupleEstimate: null,
    parentSchema: row.parent_schema ?? undefined,
    parentTable: row.parent_table ?? undefined,
    meta: {
      idx_scan: row.idx_scan != null ? toNum(row.idx_scan) : 0,
      is_unique: row.indisunique ?? false,
    },
  };
}

function mapInvalidIndexRow(row: BloatRow): CollectedBloatObject {
  const schemaName = row.schema_name;
  const objectName = row.object_name;
  return {
    kind: 'invalid_index',
    schemaName,
    objectName,
    qualifiedName: `${schemaName}.${objectName}`,
    relationBytes: toNum(row.relation_bytes),
    bloatBytes: 0,
    bloatPages: null,
    deadTupleEstimate: null,
    parentSchema: row.parent_schema ?? undefined,
    parentTable: row.parent_table ?? undefined,
    meta: {
      idx_scan: row.idx_scan != null ? toNum(row.idx_scan) : null,
      parent_last_vacuum: row.last_vacuum ?? null,
      parent_last_autovacuum: row.last_autovacuum ?? null,
    },
  };
}

function mapIndexMaintenanceRow(row: BloatRow): IndexMaintenanceEvent {
  const lastAt = row.last_maintenance_at;
  const neverMaintained =
    lastAt != null && new Date(lastAt).getTime() <= new Date('1970-01-02').getTime();
  return {
    schemaName: row.schema_name,
    indexName: row.object_name,
    parentSchema: row.parent_schema ?? '',
    parentTable: row.parent_table ?? '',
    valid: row.indisvalid ?? true,
    relationBytes: toNum(row.relation_bytes),
    idxScan: row.idx_scan != null ? toNum(row.idx_scan) : 0,
    lastVacuum: row.last_vacuum ?? null,
    lastAutovacuum: row.last_autovacuum ?? null,
    lastAnalyze: row.last_analyze ?? null,
    lastAutoanalyze: row.last_autoanalyze ?? null,
    lastMaintenanceAt: neverMaintained ? null : (lastAt ?? null),
  };
}

function mapIndexRow(row: BloatRow): CollectedBloatObject {
  const schemaName = row.schema_name;
  const objectName = row.object_name;
  return {
    kind: 'index',
    schemaName,
    objectName,
    qualifiedName: `${schemaName}.${objectName}`,
    relationBytes: toNum(row.relation_bytes),
    bloatBytes: toNum(row.bloat_bytes),
    bloatPages: row.bloat_pages != null ? toNum(row.bloat_pages) : null,
    deadTupleEstimate: null,
    parentSchema: row.parent_schema ?? undefined,
    parentTable: row.parent_table ?? undefined,
  };
}

function aggregate(objects: CollectedBloatObject[]): Pick<
  BloatCheckResult,
  'tableBloatBytes' | 'indexBloatBytes' | 'tableBloatPages' | 'indexBloatPages'
> {
  let tableBloatBytes = 0;
  let indexBloatBytes = 0;
  let tableBloatPages = 0;
  let indexBloatPages = 0;
  for (const o of objects) {
    if (o.kind === 'table') {
      tableBloatBytes += o.bloatBytes;
      tableBloatPages += o.bloatPages ?? 0;
    } else if (o.kind === 'index') {
      indexBloatBytes += o.bloatBytes;
      indexBloatPages += o.bloatPages ?? 0;
    }
  }
  return { tableBloatBytes, indexBloatBytes, tableBloatPages, indexBloatPages };
}

async function collectIndexBloat(
  client: pg.Client,
  pgstatAvailable: boolean,
  minIndexBytes: number
): Promise<{ objects: CollectedBloatObject[]; indexBloatEstimated: boolean }> {
  if (pgstatAvailable) {
    try {
      await client.query(PREPARE_PGSTAT_SEARCH_PATH);
      const indexResult = await client.query<BloatRow>(LIST_INDEX_BLOAT_PGSTATINDEX, [
        minIndexBytes,
      ]);
      return {
        objects: indexResult.rows.map(mapIndexRow),
        indexBloatEstimated: false,
      };
    } catch (err) {
      console.warn(
        '[collect-bloat] pgstatindex failed, falling back to btree estimate:',
        err instanceof Error ? err.message : err
      );
    }
  }

  try {
    const indexResult = await client.query<BloatRow>(LIST_INDEX_BLOAT_BTREE_ESTIMATE, [
      minIndexBytes,
    ]);
    return {
      objects: indexResult.rows.map(mapIndexRow),
      indexBloatEstimated: true,
    };
  } catch (err) {
    console.warn(
      '[collect-bloat] btree index estimate failed:',
      err instanceof Error ? err.message : err
    );
    return { objects: [], indexBloatEstimated: false };
  }
}

export async function collectBloat(
  connectionString: string,
  thresholds: BloatCollectionThresholds = {
    minTableBytes: 0,
    minIndexBytes: 0,
    excludePatterns: [],
  }
): Promise<BloatCheckResult> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });

  await client.connect();
  try {
    await client.query('SET statement_timeout = 0');

    const sizeResult = await client.query<{ database_size_bytes: string }>(DATABASE_SIZE);
    const databaseSizeBytes = toNum(sizeResult.rows[0]?.database_size_bytes);

    const extResult = await client.query<{ installed: boolean }>(CHECK_PGSTATTUPLE_INSTALLED);
    const pgstattupleInstalled = extResult.rows[0]?.installed ?? false;

    const pgstatResult = await client.query<{ installed: boolean }>(CHECK_PGSTATINDEX_AVAILABLE);
    const pgstatindexAvailable = pgstatResult.rows[0]?.installed ?? false;

    let tableReclaimableBytes: number | null = null;
    let objects: CollectedBloatObject[];

    if (pgstattupleInstalled) {
      await client.query(PREPARE_PGSTAT_SEARCH_PATH);
      const tableResult = await client.query<BloatRow>(LIST_TABLE_PGSTATTUPLE, [
        thresholds.minTableBytes,
      ]);
      objects = applyExcludePatterns(
        tableResult.rows.map(mapTableRow),
        thresholds.excludePatterns
      );
      tableReclaimableBytes = tableResult.rows.reduce(
        (sum, row) => sum + toNum(row.free_bytes),
        0
      );
    } else {
      const tableResult = await client.query<BloatRow>(LIST_TABLE_BLOAT_ESTIMATE, [
        thresholds.minTableBytes,
      ]);
      objects = applyExcludePatterns(
        tableResult.rows.map(mapTableRow),
        thresholds.excludePatterns
      );
    }

    const indexBloat = await collectIndexBloat(
      client,
      pgstatindexAvailable,
      thresholds.minIndexBytes
    );
    objects.push(...applyExcludePatterns(indexBloat.objects, thresholds.excludePatterns));

    const invalidResult = await client.query<BloatRow>(LIST_INVALID_INDEXES, [
      thresholds.minIndexBytes,
    ]);
    objects.push(
      ...applyExcludePatterns(
        invalidResult.rows.map(mapInvalidIndexRow),
        thresholds.excludePatterns
      )
    );

    const unusedResult = await client.query<BloatRow>(LIST_UNUSED_INDEXES);
    objects.push(
      ...applyExcludePatterns(
        unusedResult.rows.map(mapUnusedIndexRow),
        thresholds.excludePatterns
      )
    );

    const indexMaintenanceResult = await client.query<BloatRow>(
      LIST_INDEX_MAINTENANCE_EVENTS,
      [thresholds.minIndexBytes]
    );
    const indexMaintenanceEvents = indexMaintenanceResult.rows.map(mapIndexMaintenanceRow);

    objects.sort((a, b) => b.bloatBytes - a.bloatBytes);

    const totals = aggregate(objects);
    const reclaimableBytes =
      tableReclaimableBytes != null
        ? tableReclaimableBytes + totals.indexBloatBytes
        : null;

    return {
      databaseSizeBytes,
      objects,
      indexMaintenanceEvents,
      pgstattupleInstalled,
      indexBloatEstimated: indexBloat.indexBloatEstimated,
      tableReclaimableBytes,
      reclaimableBytes,
      ...totals,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
