import { db } from '../../config/database';
import { ApiKeyContext, ApiKeyRow, toApiKeyContext } from '../../models/api-key.model';

/** Uses the unique index api_keys_key_hash_unique_idx — a single index probe. */
export async function findByHash(keyHash: string): Promise<ApiKeyContext | null> {
  const rows = await db.read<ApiKeyRow>({
    name: 'api_key_by_hash',
    text: 'SELECT id, admin_id, revoked_at IS NOT NULL AS revoked FROM api_keys WHERE key_hash = $1 LIMIT 1',
    values: [keyHash],
  });
  return rows[0] ? toApiKeyContext(rows[0]) : null;
}

/** One statement for every key used since the last flush, instead of a write per request. */
export async function touchLastUsed(usage: Map<string, Date>): Promise<void> {
  if (!usage.size) return;
  await db.write({
    name: 'api_keys_touch_last_used',
    text: `UPDATE api_keys AS a
              SET last_used_at = u.used_at
             FROM unnest($1::uuid[], $2::timestamptz[]) AS u(id, used_at)
            WHERE a.id = u.id
              AND (a.last_used_at IS NULL OR a.last_used_at < u.used_at)`,
    values: [[...usage.keys()], [...usage.values()]],
  });
}
