import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../utils/ApiError';

/** Registered with `app.setNotFoundHandler`; the error handler shapes the response. */
export async function notFound(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  throw ApiError.notFound(`Route not found: ${req.method} ${req.url}`);
}
