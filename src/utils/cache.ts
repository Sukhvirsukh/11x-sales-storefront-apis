import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { redis, redisSubscriber } from '../config/redis';

/**
 * Two-tier read-through cache — the reason storefront reads are sub-millisecond.
 *
 *   L1  in-process LRU          ~1µs, per process
 *   L2  Redis (optional)        ~0.3ms, shared by every instance
 *   →   loader (Postgres)       only on a miss in both
 *
 * On top of that:
 *  - single-flight: 500 concurrent misses for one key run the loader once;
 *  - stale-while-revalidate (opt-in per call): an expired entry is served
 *    instantly while one background refresh replaces it, so callers never
 *    wait on the database for hot keys;
 *  - negative caching: a loader returning `null` (unknown API key, missing
 *    product) is cached briefly too, so misses can't be used to hammer Postgres;
 *  - invalidation fans out over Redis pub/sub, dropping L1 on every instance.
 *
 * Values must be JSON-safe (L2 stores JSON — use ISO strings, not Dates) and
 * must be treated as read-only: callers share the same object.
 */

interface Entry {
  value: unknown;
  /** Epoch ms after which the entry is stale (still servable when `staleSeconds` allows). */
  freshUntil: number;
}

interface L2Payload {
  v: unknown;
  /** Epoch ms the value expires — so L1 never outlives what L2 promised. */
  e: number;
}

export interface WrapOptions {
  /** Seconds a stale value may still be served while it refreshes in the background. */
  staleSeconds?: number;
  /** TTL for a `null` result. Defaults to CACHE_NEGATIVE_TTL_SECONDS. */
  negativeTtlSeconds?: number;
}

const instanceId = crypto.randomUUID();
const channel = `${env.redis.keyPrefix}cache:invalidate`;

const l1 = new LRUCache<string, Entry>({ max: env.cache.l1MaxEntries });
const inflight = new Map<string, Promise<unknown>>();
/** Bumped by every invalidation; loads that started before one don't write back their (maybe old) result. */
let generation = 0;

const stats = { l1Hits: 0, l1Stale: 0, l2Hits: 0, misses: 0, loaderErrors: 0, l2Errors: 0 };

async function l2Get(key: string): Promise<L2Payload | undefined> {
  if (!redis) return undefined;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as L2Payload) : undefined;
  } catch {
    stats.l2Errors++;
    return undefined;
  }
}

function l2Set(key: string, payload: L2Payload): void {
  if (!redis) return;
  const ttlMs = payload.e - Date.now();
  if (ttlMs <= 0) return;
  redis.set(key, JSON.stringify(payload), 'PX', ttlMs).catch(() => {
    stats.l2Errors++;
  });
}

function l1Set(key: string, value: unknown, expiresAt: number, staleSeconds: number): void {
  const freshUntil = Math.min(expiresAt, Date.now() + env.cache.l1MaxTtlSeconds * 1000);
  const ttl = freshUntil - Date.now() + staleSeconds * 1000;
  if (ttl > 0) l1.set(key, { value, freshUntil }, { ttl });
}

function load<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T | null>,
  opts: WrapOptions,
) {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T | null>;

  const startedAt = generation;
  const staleSeconds = opts.staleSeconds ?? 0;

  const promise = (async () => {
    const cached = await l2Get(key);
    if (cached && cached.e > Date.now()) {
      stats.l2Hits++;
      if (startedAt === generation) l1Set(key, cached.v, cached.e, staleSeconds);
      return cached.v as T | null;
    }

    stats.misses++;
    const value = await loader();
    const ttl =
      value === null ? (opts.negativeTtlSeconds ?? env.cache.negativeTtlSeconds) : ttlSeconds;
    const expiresAt = Date.now() + ttl * 1000;
    if (startedAt === generation) {
      l1Set(key, value, expiresAt, value === null ? 0 : staleSeconds);
      l2Set(key, { v: value, e: expiresAt });
    }
    return value;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export const cache = {
  /**
   * Returns the cached value for `key`, or runs `loader` once (across all
   * concurrent callers) and caches its result for `ttlSeconds`.
   */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T | null>,
    opts: WrapOptions = {},
  ): Promise<T | null> {
    const hit = l1.get(key);
    if (hit) {
      if (hit.freshUntil > Date.now()) {
        stats.l1Hits++;
        return hit.value as T | null;
      }
      // Stale but still inside its stale window: answer now, refresh in the background.
      stats.l1Stale++;
      load(key, ttlSeconds, loader, opts).catch((err) => {
        stats.loaderErrors++;
        logger.warn(
          { key, err: (err as Error).message },
          'Background cache refresh failed; serving stale',
        );
      });
      return hit.value as T | null;
    }

    try {
      return await load(key, ttlSeconds, loader, opts);
    } catch (err) {
      stats.loaderErrors++;
      throw err;
    }
  },

  /** Drops keys (exact) and/or every key under a prefix, on every instance and in Redis. */
  async invalidate({ keys = [], prefixes = [] }: { keys?: string[]; prefixes?: string[] }) {
    dropLocal(keys, prefixes);
    if (!redis) return;
    try {
      if (keys.length) await redis.del(...keys);
      for (const prefix of prefixes) await deleteByPrefix(prefix);
      await redis.publish(channel, JSON.stringify({ from: instanceId, keys, prefixes }));
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Cache invalidation could not reach Redis');
    }
  },

  stats() {
    return { ...stats, l1Size: l1.size, inflight: inflight.size, redis: Boolean(redis) };
  },
};

function dropLocal(keys: string[], prefixes: string[]): void {
  generation++;
  for (const key of keys) l1.delete(key);
  if (prefixes.length) {
    for (const key of l1.keys()) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) l1.delete(key);
    }
  }
}

/** SCAN (never KEYS — it blocks Redis) for the prefix and delete in batches. */
async function deleteByPrefix(prefix: string): Promise<void> {
  if (!redis) return;
  const fullPrefix = env.redis.keyPrefix;
  let cursor = '0';
  do {
    // SCAN's MATCH isn't keyPrefix-aware: match on the full key, then strip the prefix for DEL (which is).
    const [next, found] = await redis.scan(
      cursor,
      'MATCH',
      `${fullPrefix}${prefix}*`,
      'COUNT',
      500,
    );
    cursor = next;
    if (found.length) await redis.del(...found.map((key) => key.slice(fullPrefix.length)));
  } while (cursor !== '0');
}

/** Listen for invalidations published by other instances (call once at boot). */
export function subscribeToInvalidations(): void {
  if (!redisSubscriber) return;
  redisSubscriber.on('message', (ch, message) => {
    if (ch !== channel) return;
    try {
      const { from, keys, prefixes } = JSON.parse(message) as {
        from: string;
        keys: string[];
        prefixes: string[];
      };
      if (from !== instanceId) dropLocal(keys ?? [], prefixes ?? []);
    } catch {
      logger.warn('Ignoring malformed cache invalidation message');
    }
  });
  // Not awaited: while Redis is down the subscribe waits in the subscriber's offline
  // queue instead of blocking boot, and ioredis re-subscribes after every reconnect.
  redisSubscriber.subscribe(channel).catch((err) => {
    logger.warn({ err: (err as Error).message }, 'Cache invalidation subscribe failed');
  });
}
