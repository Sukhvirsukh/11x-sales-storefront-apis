import { FastifyReply, FastifyRequest } from 'fastify';
import { storefrontService } from '../services/storefront/storefront.service';
import { ApiError } from '../utils/ApiError';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Storefront (browser) credential: `X-Widget-Key`, the agent's public
 * `agents.widget_key`. It's embedded in store pages, so it is not a secret —
 * what protects it:
 *  - the agent must be `active`;
 *  - when the agent has `widget_allowed_origins`, a browser request's Origin
 *    must be one of them (set in the dashboard, 11xsales-be agent settings);
 *  - unknown keys are negatively cached and the route is rate limited.
 * Use API keys (never widget keys) for anything that must stay private.
 */
export async function authenticateWidget(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers['x-widget-key'];
  const widgetKey = Array.isArray(header) ? header[0] : header;

  if (!widgetKey) throw ApiError.unauthorized('Missing X-Widget-Key header');
  if (!UUID.test(widgetKey)) throw ApiError.unauthorized('Invalid widget key');

  const agent = await storefrontService.resolveWidgetAgent(widgetKey.toLowerCase());
  if (!agent) throw ApiError.unauthorized('Invalid widget key');
  if (agent.status !== 'active') throw ApiError.forbidden('This store is not active');

  const origin = req.headers.origin;
  if (origin && agent.widgetAllowedOrigins.length) {
    if (!agent.widgetAllowedOrigins.includes(origin.toLowerCase())) {
      throw ApiError.forbidden('This site is not allowed to use this widget key');
    }
  }

  req.agent = agent;
  req.authMethod = 'widget';
}
