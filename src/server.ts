import cluster from 'cluster';
import { createApp } from './app';
import { closeDatabase, connectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { closeRedis, connectRedis } from './config/redis';
import { apiKeyService } from './services/api-key/api-key.service';
import { subscribeToInvalidations } from './utils/cache';

async function bootstrap(): Promise<void> {
  await Promise.all([connectDatabase(), connectRedis()]);
  subscribeToInvalidations();
  apiKeyService.startUsageFlusher();

  const app = await createApp();
  await app.listen({ port: env.port, host: env.host }); // logs "Server listening at ..."
  logger.info(`Environment: ${env.nodeEnv}, pid ${process.pid}`);
  if (env.isProduction && !env.internalApiToken) {
    logger.warn('Not configured: internal API / cache invalidation (INTERNAL_API_TOKEN)');
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received. Shutting down gracefully...`);
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
    try {
      await app.close(); // stops accepting, finishes in-flight requests (new ones get 503)
      await apiKeyService.stop(); // last batch of api_keys.last_used_at
      await Promise.all([closeDatabase(), closeRedis()]);
      logger.info('HTTP server, DB and Redis connections closed.');
      logger.flush();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ message: err.message, stack: err.stack }, 'Uncaught exception');
  logger.flush();
  process.exit(1);
});

/**
 * CLUSTER_WORKERS > 1 (or "auto") runs one process per worker on the same
 * port, so a multi-core machine serves on every core. Each worker has its
 * own DB pool (DB_POOL_MAX each) and in-process cache.
 */
if (env.clusterWorkers > 1 && cluster.isPrimary) {
  logger.info(`Primary ${process.pid} starting ${env.clusterWorkers} workers`);
  let stopping = false;
  for (let i = 0; i < env.clusterWorkers; i++) cluster.fork();
  cluster.on('exit', (worker, code) => {
    if (stopping) return;
    logger.error(`Worker ${worker.process.pid} exited (${code}); starting a replacement`);
    cluster.fork();
  });
  const stopAll = () => {
    stopping = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill('SIGTERM');
  };
  process.on('SIGTERM', stopAll);
  process.on('SIGINT', stopAll);
} else {
  bootstrap().catch((err) => {
    logger.fatal({ message: err.message, stack: err.stack }, 'Failed to start server');
    logger.flush();
    setTimeout(() => process.exit(1), 200);
  });
}
