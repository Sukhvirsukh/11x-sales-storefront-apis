import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Fails fast at boot if a required env var is missing, instead of letting
 * `undefined` silently propagate into the DB config, JWT verification, etc.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/** CLUSTER_WORKERS: a number, or "auto" for one worker per CPU core. */
function clusterWorkers(): number {
  const raw = process.env.CLUSTER_WORKERS;
  if (raw === 'auto') return os.availableParallelism();
  return Math.max(1, optionalNumber('CLUSTER_WORKERS', 1));
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  isTest,

  port: optionalNumber('PORT', 5100),
  // 127.0.0.1 locally (IPv4 loopback, see 11xsales-be/server.ts); every interface in production.
  host: process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  /** Processes serving requests. Each one has its own DB pool and in-memory cache. */
  clusterWorkers: clusterWorkers(),
  /** Reverse proxies in front of the API (Caddy / load balancer), so rate limits see the client's IP. */
  trustProxyHops: optionalNumber('TRUST_PROXY_HOPS', isProduction ? 1 : 0),
  bodyLimitBytes: optionalNumber('BODY_LIMIT_BYTES', 1024 * 1024),
  // Longer than the load balancer's idle timeout, so it never reuses a socket we just closed.
  keepAliveTimeoutMs: optionalNumber('KEEP_ALIVE_TIMEOUT_MS', 72_000),

  /** The same database 11xsales-be uses. This service only reads it (plus api_keys.last_used_at). */
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: optionalNumber('DB_PORT', 5432),
    name: process.env.DB_NAME || 'elevenx_sales',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    logging: process.env.DB_LOGGING === 'true',
    ssl: process.env.DB_SSL === 'true',
    sslCaFile: process.env.DB_SSL_CA_FILE || '',
    // Optional read replica: every read goes there when set, writes stay on DB_HOST.
    readHost: process.env.DB_READ_HOST || '',
    readPort: optionalNumber('DB_READ_PORT', optionalNumber('DB_PORT', 5432)),
    poolMax: optionalNumber('DB_POOL_MAX', 20),
    // Connections opened at boot, so the first requests don't pay for TCP + TLS + auth.
    poolWarm: optionalNumber('DB_POOL_WARM', 4),
    idleTimeoutMs: optionalNumber('DB_IDLE_TIMEOUT_MS', 30_000),
    connectTimeoutMs: optionalNumber('DB_CONNECT_TIMEOUT_MS', 5_000),
    // A storefront read that takes longer than this is a bug — fail it rather than pile up.
    statementTimeoutMs: optionalNumber('DB_STATEMENT_TIMEOUT_MS', 3_000),
  },

  /** Shared cache (L2). Empty REDIS_URL = in-process cache only (fine for one instance). */
  redis: {
    url: process.env.REDIS_URL || '',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'sf:',
    // A slow Redis must never be slower than just asking Postgres.
    commandTimeoutMs: optionalNumber('REDIS_COMMAND_TIMEOUT_MS', 50),
  },

  cache: {
    l1MaxEntries: optionalNumber('CACHE_L1_MAX_ENTRIES', 50_000),
    // Upper bound on how long an in-process entry lives, whatever its TTL. Invalidations
    // reach every instance over Redis pub/sub; this caps staleness if one is ever missed.
    l1MaxTtlSeconds: optionalNumber('CACHE_L1_MAX_TTL_SECONDS', 30),
    // Unknown keys (bad API/widget keys) are remembered too, so guessing can't hammer the DB.
    negativeTtlSeconds: optionalNumber('CACHE_NEGATIVE_TTL_SECONDS', 30),
  },

  /** Platform JWTs issued by 11xsales-be (same secret), verified here — never issued. */
  jwt: {
    secret: required('JWT_SECRET', isTest ? 'test-secret' : undefined),
  },

  /** Seconds a looked-up API key / widget key is trusted before re-reading it. */
  authCacheTtlSeconds: optionalNumber('AUTH_CACHE_TTL_SECONDS', 60),
  /** How often api_keys.last_used_at is written (batched, off the request path). */
  apiKeyUsageFlushMs: optionalNumber('API_KEY_USAGE_FLUSH_MS', 60_000),

  rateLimit: {
    max: optionalNumber('RATE_LIMIT_MAX', 1200),
    windowMs: optionalNumber('RATE_LIMIT_WINDOW_MS', 60_000),
  },

  log: {
    dir: process.env.LOG_DIR || 'logs',
    level: process.env.LOG_LEVEL || 'info',
  },

  /**
   * Browser origins allowed by CORS. Storefronts live on any shop domain, so the default
   * is "*" — the widget-key guard enforces each agent's own origin allow-list.
   */
  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),

  // Shared secret for service-to-service calls (11xsales-be, sync service). Internal routes are off without it.
  internalApiToken: process.env.INTERNAL_API_TOKEN || '',
};

/** Production refuses to start with a weak JWT secret (it must match 11xsales-be's). */
if (isProduction && env.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
