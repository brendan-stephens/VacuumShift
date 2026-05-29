import { MAINTENANCE_INDEX_GUC_NAMES } from '@vacuumshift/shared';
import pg, { type Client } from 'pg';
import type { AutovacuumGlobalRow, AutovacuumTableRow } from '../types.js';
import {
  GLOBAL_AUTOVACUUM_SETTINGS,
  GLOBAL_MAINTENANCE_GUC_SETTINGS,
  TABLE_AUTOVACUUM_SETTINGS,
} from '../sql/bloat.js';

const { Client } = pg;

export interface AutovacuumSnapshot {
  capturedAt: string;
  global: AutovacuumGlobalRow[];
  tables: AutovacuumTableRow[];
}

function mergeGlobalRows(
  autovacuumRows: AutovacuumGlobalRow[],
  maintenanceRows: AutovacuumGlobalRow[]
): AutovacuumGlobalRow[] {
  const byName = new Map<string, AutovacuumGlobalRow>();
  for (const row of autovacuumRows) byName.set(row.name, row);
  for (const row of maintenanceRows) byName.set(row.name, row);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fill any curated maintenance GUC missing from pg_settings via current_setting(). */
async function fillMissingMaintenanceGucs(
  client: Client,
  rows: AutovacuumGlobalRow[]
): Promise<AutovacuumGlobalRow[]> {
  const byName = new Map(rows.map((r) => [r.name, r]));
  const filled = [...rows];

  for (const name of MAINTENANCE_INDEX_GUC_NAMES) {
    if (byName.has(name)) continue;
    try {
      const result = await client.query<{ setting: string }>(
        'select current_setting($1, false) as setting',
        [name]
      );
      const setting = result.rows[0]?.setting;
      if (setting == null) continue;
      const row: AutovacuumGlobalRow = {
        name,
        setting,
        unit: null,
        context: 'user',
        source: 'current_setting',
      };
      filled.push(row);
      byName.set(name, row);
      console.warn(`[autovacuum] pg_settings missing ${name}; used current_setting`);
    } catch (err) {
      console.warn(
        `[autovacuum] could not read ${name}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return filled.sort((a, b) => a.name.localeCompare(b.name));
}

export async function collectAutovacuumSettings(
  connectionString: string
): Promise<AutovacuumSnapshot> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });

  await client.connect();
  try {
    await client.query('SET statement_timeout = 0');

    const [autovacuumResult, maintenanceResult, tableResult] = await Promise.all([
      client.query<AutovacuumGlobalRow>(GLOBAL_AUTOVACUUM_SETTINGS),
      client.query<AutovacuumGlobalRow>(GLOBAL_MAINTENANCE_GUC_SETTINGS),
      client.query<AutovacuumTableRow>(TABLE_AUTOVACUUM_SETTINGS),
    ]);

    let global = mergeGlobalRows(autovacuumResult.rows, maintenanceResult.rows);
    global = await fillMissingMaintenanceGucs(client, global);

    const maintenance = global.filter((r) =>
      (MAINTENANCE_INDEX_GUC_NAMES as readonly string[]).includes(r.name)
    );
    console.log(
      `[autovacuum] global settings=${global.length} maintenance=${maintenance.length}`,
      maintenance.map((r) => `${r.name}=${r.setting}${r.unit ? r.unit : ''}`).join(', ') ||
        '(none)'
    );

    if (maintenance.length < MAINTENANCE_INDEX_GUC_NAMES.length) {
      const missing = MAINTENANCE_INDEX_GUC_NAMES.filter(
        (n) => !maintenance.some((r) => r.name === n)
      );
      console.warn(`[autovacuum] missing maintenance GUCs: ${missing.join(', ')}`);
    }

    return {
      capturedAt: new Date().toISOString(),
      global,
      tables: tableResult.rows,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
