import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Redis is the shared (L2) cache and the invalidation bus between instances.
 * It's an optimization, never a dependency: commands fail fast instead of
 * queueing while it's down (`enableOfflineQueue: false` + a short command
 * timeout), and every caller falls back to Postgres.
 */
export const redis: Redis | null = env.redis.url
  ? new Redis(env.redis.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: env.redis.commandTimeoutMs,
      keyPrefix: env.redis.keyPrefix,
      connectionName: '11x-storefront-apis',
    })
  : null;

/** Pub/sub needs its own connection (a subscribed connection can't run other commands). */
export const redisSubscriber: Redis | null = redis
  ? redis.duplicate({
      enableOfflineQueue: true,
      commandTimeout: undefined,
      maxRetriesPerRequest: null,
    })
  : null;

let warned = false;
for (const client of [redis, redisSubscriber]) {
  client?.on('error', (err) => {
    // ioredis retries on its own; log the first failure, not every reconnect attempt.
    if (!warned)
      logger.warn(
        { err: err.message },
        'Redis unavailable — serving from in-process cache and Postgres',
      );
    warned = true;
  });
  client?.on('ready', () => {
    if (warned) logger.info('Redis connection restored');
    warned = false;
  });
}

export async function connectRedis(): Promise<void> {
  if (!redis || !redisSubscriber) {
    logger.info('REDIS_URL not set — using the in-process cache only');
    return;
  }
  try {
    await Promise.all([redis.connect(), redisSubscriber.connect()]);
    logger.info('Redis connection established.');
  } catch (err) {
    // Not fatal: the app runs on L1 + Postgres and ioredis keeps reconnecting in the background.
    logger.warn(
      { err: (err as Error).message },
      'Redis connect failed at boot; continuing without it',
    );
  }
}

export async function pingRedis(): Promise<boolean | null> {
  if (!redis) return null;
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  // quit() waits for a reply, so it would hang shutdown on a connection that's down; drop those instead.
  const close = (client: Redis | null) =>
    client?.status === 'ready' ? client.quit() : client?.disconnect();
  await Promise.allSettled([close(redis), close(redisSubscriber)]);
}
