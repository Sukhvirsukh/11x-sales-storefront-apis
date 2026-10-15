/**
 * Every cache key in one place. Other services (11xsales-be, the sync
 * service) bust entries through POST /internal/v1/cache/invalidate using
 * these exact formats, so treat them as a contract: change one here and
 * the callers have to change too.
 */
export const cacheKeys = {
  /** api_keys row by sha256(raw key). */
  apiKeyByHash: (hash: string) => `apikey:${hash}`,
  /** agents row by its public widget key. */
  agentByWidgetKey: (widgetKey: string) => `agent:wk:${widgetKey}`,
  /** Prefix of every entry belonging to one agent's storefront data. */
  agentScope: (agentId: string) => `agent:${agentId}:`,
};
