import { env } from '../../config/env';
import { AgentContext } from '../../models/agent.model';
import * as agentRepository from '../../repositories/agent/agent.repository';
import { cache } from '../../utils/cache';
import { cacheKeys } from '../../utils/cache-keys';
import { CHAT_DESIGN_KEYS, ChatDesign, DEFAULT_CHAT_DESIGN } from './chat-design.defaults';

/**
 * Storefront reads. Every method goes through `cache.wrap`, so the database
 * is only asked when the data isn't already cached — add new storefront
 * reads here the same way (key from utils/cache-keys.ts, a TTL, a loader).
 */
class StorefrontService {
  /** The agent behind a public widget key (used by the widget-key guard on every storefront call). */
  resolveWidgetAgent(widgetKey: string): Promise<AgentContext | null> {
    return cache.wrap(
      cacheKeys.agentByWidgetKey(widgetKey),
      env.authCacheTtlSeconds,
      () => agentRepository.findByWidgetKey(widgetKey),
      // Hot on every request: answer from memory while a refresh runs.
      { staleSeconds: 30 },
    );
  }

  /** What the storefront widget is allowed to know about its agent. */
  publicProfile(agent: AgentContext) {
    return {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      defaultLanguage: agent.defaultLanguage,
    };
  }

  /**
   * The chat widget's design, read the same way 11xsales-be's chat-design
   * service does: saved fields from `widget_config` over the defaults. Built
   * from the agent the widget-key guard already loaded (cached), so this
   * costs no database query.
   */
  chatDesign(agent: AgentContext): ChatDesign {
    const design: Record<string, unknown> = { ...DEFAULT_CHAT_DESIGN };
    for (const key of CHAT_DESIGN_KEYS) {
      const saved = agent.widgetConfig[key];
      if (saved !== undefined) design[key] = saved;
    }
    return design as ChatDesign;
  }
}

export const storefrontService = new StorefrontService();
