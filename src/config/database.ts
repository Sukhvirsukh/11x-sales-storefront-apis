import fs from 'fs';
import { Pool, PoolConfig, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from './logger';

/**
 * Plain `pg` pools instead of an ORM: on a read-heavy path the ORM's model
 * hydration costs more than the query itself. Every repository query is a
 * *named* statement, so Postgres parses and plans it once per connection and
 * every later call skips straight to execution.
 *
 * Schema ownership stays with 11xsales-be (its migrations) — this service
 * never creates or alters tables.
 */

/** Same TLS rules as 11xsales-be: verify the server when the cluster's CA is configured. */
function sslOptions(): PoolConfig['ssl'] {
  if (!env.db.ssl) return undefined;
  if (env.db.sslCaFile) {
    return { rejectUnauthorized: true, ca: fs.readFileSync(env.db.sslCaFile, 'utf8') };
  }
  if (env.isProduction) {
    logger.warn("DB_SSL_CA_FILE is not set: the database's certificate is not being verified");
  }
  return { rejectUnauthorized: false };
}

function createPool(host: string, port: number, role: 'primary' | 'replica'): Pool {
  const pool = new Pool({
    host,
    port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    ssl: sslOptions(),
    max: env.db.poolMax,
    idleTimeoutMillis: env.db.idleTimeoutMs,
    connectionTimeoutMillis: env.db.connectTimeoutMs,
    statement_timeout: env.db.statementTimeoutMs,
    keepAlive: true,
    application_name: `11x-storefront-apis:${role}`,
  });
  // An idle client dying (DB restart, failover) must not crash the process; the pool replaces it.
  pool.on('error', (err) => logger.error({ err, role }, 'Idle database client error'));
  return pool;
}

export const writePool = createPool(env.db.host, env.db.port, 'primary');
export const readPool = env.db.readHost
  ? createPool(env.db.readHost, env.db.readPort, 'replica')
  : writePool;

export interface NamedQuery {
  /** Unique per SQL text — it's the prepared-statement name on each connection. */
  name: string;
  text: string;
  values?: unknown[];
}

async function run<R extends QueryResultRow>(pool: Pool, q: NamedQuery): Promise<R[]> {
  if (!env.db.logging) return (await pool.query<R>(q)).rows;
  const start = process.hrtime.bigint();
  const result = await pool.query<R>(q);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  logger.debug({ query: q.name, ms: Number(ms.toFixed(2)), rows: result.rowCount }, 'db query');
  return result.rows;
}

export const db = {
  read: <R extends QueryResultRow>(q: NamedQuery) => run<R>(readPool, q),
  write: <R extends QueryResultRow>(q: NamedQuery) => run<R>(writePool, q),
};

/** Opens a few connections up front and fails fast if the database is unreachable. */
export async function connectDatabase(): Promise<void> {
  const pools = readPool === writePool ? [writePool] : [writePool, readPool];
  for (const pool of pools) {
    const warm = Math.max(1, Math.min(env.db.poolWarm, env.db.poolMax));
    const clients = await Promise.all(Array.from({ length: warm }, () => pool.connect()));
    await clients[0].query('SELECT 1');
    clients.forEach((client) => client.release());
  }
  logger.info(
    `Database connection established (${env.db.readHost ? 'primary + read replica' : 'primary'}).`,
  );
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await readPool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await writePool.end();
  if (readPool !== writePool) await readPool.end();
}
