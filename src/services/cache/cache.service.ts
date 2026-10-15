import { cache } from '../../utils/cache';
import { InvalidateCacheInput } from '../../validations/cache/cache.validation';

/** Lets other services (11xsales-be, the sync service) drop entries when they change the data behind them. */
class CacheService {
  async invalidate(input: InvalidateCacheInput) {
    await cache.invalidate(input);
    return { keys: input.keys?.length ?? 0, prefixes: input.prefixes?.length ?? 0 };
  }

  stats() {
    return cache.stats();
  }
}

export const cacheService = new CacheService();
