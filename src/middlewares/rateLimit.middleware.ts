import { RateLimitPluginOptions } from '@fastify/rate-limit';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * Per client IP, counted in this process's memory: no network hop per
 * request, which matters more here than exact global counts. With N
 * instances the effective limit is N × RATE_LIMIT_MAX — size it for that.
 * Routes opt out with `config: { rateLimit: false }` (health checks).
 */
export const apiRateLimit: RateLimitPluginOptions = {
  global: true,
  max: env.rateLimit.max,
  timeWindow: env.rateLimit.windowMs,
  cache: 20_000,
  errorResponseBuilder: () =>
    ApiError.tooManyRequests('Too many requests. Please slow down and try again shortly.'),
};

/** Tighter limit for endpoints that are expensive or attractive to brute-force. */
export const strictRateLimit = {
  max: Math.max(1, Math.floor(env.rateLimit.max / 10)),
  timeWindow: env.rateLimit.windowMs,
};
