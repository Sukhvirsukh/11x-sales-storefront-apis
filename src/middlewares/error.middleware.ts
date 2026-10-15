import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

interface ErrorBody {
  success: false;
  message: string;
  details?: unknown;
  stack?: string;
}

/**
 * Single place every error funnels through (thrown in a hook, preHandler or
 * controller). Normalizes known error types (ApiError, Zod, Fastify's own,
 * Postgres) into the same `{ success: false, message, details? }` shape
 * 11xsales-be returns, and logs everything. Registered with
 * `app.setErrorHandler` in app.ts.
 */
export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply): void {
  let statusCode = 500;
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    details = err.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
  } else if (isPgError(err)) {
    // 23505 unique_violation, 22P02 invalid_text_representation (e.g. a bad uuid), 57014 statement timeout.
    if (err.code === '23505')
      [statusCode, message] = [409, 'A record with these details already exists'];
    else if (err.code === '22P02') [statusCode, message] = [400, 'Invalid identifier'];
    else if (err.code === '57014')
      [statusCode, message] = [503, 'The request took too long. Please retry.'];
  } else if (isFastifyError(err) && err.statusCode && err.statusCode < 500) {
    // Fastify's own client errors: malformed JSON (400), body too large (413), bad media type (415).
    statusCode = err.statusCode;
    message = err.message;
  }

  const isUnexpected = statusCode >= 500;
  const logPayload = {
    method: req.method,
    path: req.url,
    statusCode,
    message: err instanceof Error ? err.message : message,
    stack: isUnexpected && err instanceof Error ? err.stack : undefined,
  };
  if (isUnexpected) req.log.error(logPayload, 'Unhandled error');
  else req.log.warn(logPayload, 'Handled error');

  const body: ErrorBody = {
    success: false,
    // Never leak internal error messages/stack traces to the client in prod.
    message: statusCode === 500 && env.isProduction ? 'Internal server error' : message,
  };
  if (details !== undefined) body.details = details;
  if (!env.isProduction && err instanceof Error && isUnexpected) body.stack = err.stack;

  reply.status(statusCode).send(body);
}

function isPgError(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((err as { code: string }).code) &&
    'severity' in err
  );
}

function isFastifyError(err: unknown): err is FastifyError {
  return err instanceof Error && 'statusCode' in err;
}
