import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import crypto from 'crypto';
import Fastify, { FastifyBaseLogger, FastifyInstance, LogController } from 'fastify';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler } from './middlewares/error.middleware';
import { notFound } from './middlewares/notFound.middleware';
import { apiRateLimit } from './middlewares/rateLimit.middleware';
import { registerRequestLogger } from './middlewares/requestLogger.middleware';
import routes from './routes';
import serviceRoutes from './routes/service.routes';

/**
 * Same layered structure as 11xsales-be — routes/, controllers/, services/,
 * repositories/, validations/, models/ as top-level folders, one file per
 * domain — on Fastify instead of Express, because every request here is on
 * a storefront page load and framework overhead is a real share of it.
 *
 * - `routes` (mounted at `env.apiPrefix`, e.g. /api/v1): storefront + client APIs.
 * - `serviceRoutes` (mounted at /internal/v1): 11xsales-be / sync service only.
 */
export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // One line per request from requestLogger instead of Fastify's two.
    logController: new LogController({ disableRequestLogging: true }),
    // Trust exactly TRUST_PROXY_HOPS proxies (hop 0 = the one connected to us), so X-Forwarded-For can't be spoofed past them.
    trustProxy:
      env.trustProxyHops > 0 ? (_address: string, hop: number) => hop < env.trustProxyHops : false,
    bodyLimit: env.bodyLimitBytes,
    keepAliveTimeout: env.keepAliveTimeoutMs,
    requestTimeout: 15_000,
    return503OnClosing: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Declared up front so every request object has the same shape (V8 keeps one hidden class).
  app.decorateRequest('user', null);
  app.decorateRequest('admin', null);
  app.decorateRequest('agent', null);
  app.decorateRequest('authMethod', null);
  app.decorateRequest('startedAt', BigInt(0));

  // JSON API: no HTML, so no CSP; responses are read by storefronts on other origins.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: env.corsOrigins.includes('*') ? '*' : env.corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Widget-Key', 'X-Request-Id'],
    exposedHeaders: [
      'X-Request-Id',
      'Server-Timing',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: 7200, // preflights cached for 2 hours (the browser maximum)
  });
  // Small JSON bodies cost more to compress than to send; brotli's default level is too slow for per-request use.
  await app.register(compress, { threshold: 2048, encodings: ['gzip', 'deflate'] });
  await app.register(rateLimit, apiRateLimit);

  registerRequestLogger(app);

  app.get('/', { config: { rateLimit: false } }, async () => ({
    name: '11xsales.ai Storefront API',
    health: `${env.apiPrefix}/health`,
  }));

  await app.register(routes, { prefix: env.apiPrefix });
  await app.register(serviceRoutes, { prefix: '/internal/v1' });

  app.setNotFoundHandler(notFound);
  app.setErrorHandler(errorHandler);

  return app;
}
