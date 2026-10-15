import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { ApiKeyContext } from '../../models/api-key.model';
import * as apiKeyRepository from '../../repositories/api-key/api-key.repository';
import { cache } from '../../utils/cache';
import { cacheKeys } from '../../utils/cache-keys';
import { hashToken } from '../../utils/token';

/**
 * Resolves `X-API-Key` values against 11xsales-be's api_keys table (keys
 * are created and revoked there). A key is cached for AUTH_CACHE_TTL_SECONDS
 * — revoking one in 11xsales-be takes effect within that window, or at once
 * if it calls POST /internal/v1/cache/invalidate with `apikey:<hash>`.
 *
 * `last_used_at` is collected in memory and written in one batched UPDATE
 * every API_KEY_USAGE_FLUSH_MS, instead of a DB write on every request.
 */
class ApiKeyService {
  private usage = new Map<string, Date>();
  private timer: NodeJS.Timeout | null = null;

  resolve(rawKey: string): Promise<ApiKeyContext | null> {
    const hash = hashToken(rawKey);
    return cache.wrap(cacheKeys.apiKeyByHash(hash), env.authCacheTtlSeconds, () =>
      apiKeyRepository.findByHash(hash),
    );
  }

  recordUse(apiKeyId: string): void {
    this.usage.set(apiKeyId, new Date());
  }

  startUsageFlusher(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flushUsage(), env.apiKeyUsageFlushMs);
    this.timer.unref();
  }

  async flushUsage(): Promise<void> {
    if (!this.usage.size) return;
    const batch = this.usage;
    this.usage = new Map();
    try {
      await apiKeyRepository.touchLastUsed(batch);
    } catch (err) {
      // Bookkeeping only — never worth failing anything over. Re-queue for the next flush.
      for (const [id, at] of batch) if (!this.usage.has(id)) this.usage.set(id, at);
      logger.warn({ err: (err as Error).message }, 'Could not record API key usage');
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flushUsage();
  }
}

export const apiKeyService = new ApiKeyService();
