import { FastifyInstance } from 'fastify';
import * as cacheController from '../controllers/cache/cache.controller';
import { authenticateService } from '../middlewares/service-auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { InvalidateCacheInput, invalidateCacheSchema } from '../validations/cache/cache.validation';

/**
 * Service-to-service API, mounted at /internal/v1 — used by 11xsales-be and
 * the sync service, never by browsers. Authenticated with INTERNAL_API_TOKEN.
 */
export default async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticateService);

  // Call after changing data this API caches (agent settings, revoked API key, synced products...).
  app.post<{ Body: InvalidateCacheInput }>(
    '/cache/invalidate',
    { preHandler: [validate(invalidateCacheSchema)] },
    cacheController.invalidate,
  );
  app.get('/cache/stats', cacheController.stats);
}
