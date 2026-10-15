import path from 'path';
import pino, { TransportTargetOptions } from 'pino';
import { env } from './env';

/**
 * pino instead of winston: logging is on every request's path, and pino
 * hands lines to transports running in a worker thread, so writing to disk
 * never blocks the event loop.
 *
 * Same layout as 11xsales-be: daily-rotated files under `LOG_DIR` (combined +
 * error-only, 14 days kept), plus a pretty console outside production. To
 * ship logs to a hosted stack later, add a target here — call sites only
 * ever talk to `logger`.
 */
const logDir = path.resolve(process.cwd(), env.log.dir);

const rotate = (name: string, level: string): TransportTargetOptions => ({
  target: 'pino-roll',
  level,
  options: {
    file: path.join(logDir, name),
    frequency: 'daily',
    dateFormat: 'yyyy-MM-dd',
    extension: '.log',
    limit: { count: 14 },
    mkdir: true,
  },
});

const targets: TransportTargetOptions[] = [
  rotate('combined', env.log.level),
  rotate('error', 'error'),
];

if (!env.isProduction) {
  targets.push({
    target: 'pino-pretty',
    level: env.log.level,
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname,reqId,method,path,statusCode,durationMs,ip',
    },
  });
}

export const logger = pino({
  level: env.log.level,
  base: { pid: process.pid },
  // Belt and braces: credentials must never reach a log line, even if someone logs a request.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers["x-widget-key"]',
      'headers.authorization',
      'headers["x-api-key"]',
    ],
    censor: '[redacted]',
  },
  transport: { targets },
});
