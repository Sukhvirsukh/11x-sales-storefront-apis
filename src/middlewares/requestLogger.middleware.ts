import { FastifyInstance } from 'fastify';

/**
 * One structured line per request (method/path/status/duration), like
 * 11xsales-be's requestLogger, instead of Fastify's default two. Also
 * returns the timing to the client:
 *  - `Server-Timing: app;dur=0.42` — time spent inside this API, visible in
 *    browser devtools, so "is it us or the network?" is answerable at a glance;
 *  - `X-Request-Id` — matches the `reqId` on the log line.
 */
export function registerRequestLogger(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    req.startedAt = process.hrtime.bigint();
  });

  app.addHook('onSend', async (req, reply) => {
    const ms = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    reply.header('server-timing', `app;dur=${ms.toFixed(2)}`);
    reply.header('x-request-id', req.id);
  });

  app.addHook('onResponse', async (req, reply) => {
    const durationMs = Number((Number(process.hrtime.bigint() - req.startedAt) / 1e6).toFixed(2));
    req.log.info(
      { method: req.method, path: req.url, statusCode: reply.statusCode, durationMs, ip: req.ip },
      `${req.method} ${req.url} ${reply.statusCode} - ${durationMs}ms`,
    );
  });
}
