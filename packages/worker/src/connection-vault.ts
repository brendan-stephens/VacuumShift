import type { MonitoredDatabaseRow } from './types.js';

/** Vault id for VACUUM/REINDEX; monitoring/checks use connection_vault_id. */
export function maintenanceConnectionVaultId(database: MonitoredDatabaseRow): string {
  return database.maintenance_connection_vault_id ?? database.connection_vault_id;
}
