import { db } from '../../config/database';
import { AgentContext, AgentRow, toAgentContext } from '../../models/agent.model';

const COLUMNS = `id, admin_id, name, slug, default_language, status,
                 widget_allowed_origins, widget_config`;

/** Uses the unique index agents_widget_key_unique_idx. */
export async function findByWidgetKey(widgetKey: string): Promise<AgentContext | null> {
  const rows = await db.read<AgentRow>({
    name: 'agent_by_widget_key',
    text: `SELECT ${COLUMNS} FROM agents WHERE widget_key = $1 LIMIT 1`,
    values: [widgetKey],
  });
  return rows[0] ? toAgentContext(rows[0]) : null;
}

export async function findById(id: string): Promise<AgentContext | null> {
  const rows = await db.read<AgentRow>({
    name: 'agent_by_id',
    text: `SELECT ${COLUMNS} FROM agents WHERE id = $1 LIMIT 1`,
    values: [id],
  });
  return rows[0] ? toAgentContext(rows[0]) : null;
}
