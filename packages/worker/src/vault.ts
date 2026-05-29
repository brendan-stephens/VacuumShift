import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

let vaultPool: pg.Pool | null = null;

function getVaultPool(): pg.Pool {
  if (!vaultPool) {
    vaultPool = new Pool({ connectionString: config.supabaseDbUrl, max: 3 });
  }
  return vaultPool;
}

/** Load a customer connection string from Supabase Vault (secret key DB access only). */
export async function getConnectionString(vaultSecretId: string): Promise<string> {
  const pool = getVaultPool();
  const { rows } = await pool.query<{ decrypted_secret: string }>(
    `select decrypted_secret
     from vault.decrypted_secrets
     where id = $1::uuid`,
    [vaultSecretId]
  );
  const secret = rows[0]?.decrypted_secret;
  if (!secret) {
    throw new Error(`Vault secret not found: ${vaultSecretId}`);
  }
  return secret;
}

export async function closeVaultPool(): Promise<void> {
  if (vaultPool) {
    await vaultPool.end();
    vaultPool = null;
  }
}
