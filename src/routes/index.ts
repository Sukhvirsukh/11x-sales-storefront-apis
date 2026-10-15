import { FastifyInstance } from 'fastify';
import { pingDatabase } from '../config/database';
import { pingRedis } from '../config/redis';
import * as storefrontController from '../controllers/storefront/storefront.controller';
import { authenticateAny } from '../middlewares/auth.middleware';
import storefrontRoutes from './storefront/storefront.routes';

/**
 * Main router, mounted at `env.apiPrefix` in app.ts. Each domain gets its
 * own folder under src/routes/ (controllers/services/validations mirror the
 * same split) — this file only wires domains to their path prefix.
 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // Liveness: the process is up. No dependencies, so a DB blip doesn't restart every instance.
  app.get('/health', { config: { rateLimit: false } }, async () => ({
    success: true,
    message: 'OK',
    data: { uptime: process.uptime() },
  }));

  // Readiness: can this instance serve traffic right now?
  app.get('/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
    const ready = database; // Redis is optional — degraded, not down.
    return reply.status(ready ? 200 : 503).send({
      success: ready,
      message: ready ? 'Ready' : 'Not ready',
      data: { database, redis: redis === null ? 'not configured' : redis },
    });
  });

  app.get(
    '/me',
    { preHandler: [authenticateAny('widget', 'apiKey', 'jwt')] },
    storefrontController.whoAmI,
  );

  await app.register(storefrontRoutes, { prefix: '/storefront' });

  // Mount future domains here, e.g.:
  // await app.register(productRoutes, { prefix: '/storefront/products' });
}
