import { FastifyInstance } from 'fastify';
import * as storefrontController from '../../controllers/storefront/storefront.controller';
import { authenticateWidget } from '../../middlewares/widget-auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { chatDesignResponseSchema } from '../../services/storefront/chat-design.defaults';
import { envelopeSchema } from '../../utils/ApiResponse';
import {
  agentProfileSchema,
  chatDesignSchema,
} from '../../validations/storefront/storefront.validation';

/**
 * Storefront routes, mounted at `${API_PREFIX}/storefront`. Every route here
 * is called from store pages, so the whole plugin sits behind the widget-key
 * guard. Pattern for a new endpoint:
 *   validation (validations/storefront) → controller → service (cache.wrap)
 *   → repository (named SQL), plus a `schema.response` for fast, leak-proof output.
 */
export default async function storefrontRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticateWidget);

  app.get(
    '/agent',
    {
      preHandler: [validate(agentProfileSchema)],
      schema: {
        response: {
          200: envelopeSchema({
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              slug: { type: 'string' },
              defaultLanguage: { type: 'string' },
            },
          }),
        },
      },
    },
    storefrontController.agentProfile,
  );

  app.get(
    '/chat-design',
    {
      preHandler: [validate(chatDesignSchema)],
      schema: { response: { 200: envelopeSchema(chatDesignResponseSchema) } },
    },
    storefrontController.chatDesign,
  );
}
