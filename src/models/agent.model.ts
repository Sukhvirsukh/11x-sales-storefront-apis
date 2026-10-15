/**
 * `agents` — owned by 11xsales-be (its agent.model.ts and migrations). An
 * Agent is one storefront/business; its public `widget_key` is what the
 * storefront embeds, and `widget_allowed_origins` restricts which sites may
 * use that key from a browser.
 */
export type AgentStatus = 'active' | 'paused' | 'archived';

export interface AgentRow {
  id: string;
  admin_id: string;
  name: string;
  slug: string;
  default_language: string;
  status: AgentStatus;
  widget_allowed_origins: string[] | null;
  widget_config: Record<string, unknown> | null;
}

export interface AgentContext {
  id: string;
  adminId: string;
  name: string;
  slug: string;
  defaultLanguage: string;
  status: AgentStatus;
  widgetAllowedOrigins: string[];
  widgetConfig: Record<string, unknown>;
}

export function toAgentContext(row: AgentRow): AgentContext {
  return {
    id: row.id,
    adminId: row.admin_id,
    name: row.name,
    slug: row.slug,
    defaultLanguage: row.default_language,
    status: row.status,
    // Normalized once here so the per-request origin check is a plain string compare.
    widgetAllowedOrigins: (row.widget_allowed_origins ?? []).map((o) =>
      o.replace(/\/$/, '').toLowerCase(),
    ),
    widgetConfig: row.widget_config ?? {},
  };
}
