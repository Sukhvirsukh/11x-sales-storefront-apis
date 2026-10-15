/**
 * `api_keys` — owned by 11xsales-be (its api-key.model.ts and migration).
 * This service only reads it to authenticate `X-API-Key` requests and
 * batch-updates `last_used_at`.
 *
 * No ORM model here on purpose (see config/database.ts): a row type for what
 * the queries select, and a mapper to the JSON-safe shape that gets cached.
 */
export interface ApiKeyRow {
  id: string;
  admin_id: string;
  revoked: boolean;
}

export interface ApiKeyContext {
  id: string;
  adminId: string;
  revoked: boolean;
}

export function toApiKeyContext(row: ApiKeyRow): ApiKeyContext {
  return { id: row.id, adminId: row.admin_id, revoked: row.revoked };
}
