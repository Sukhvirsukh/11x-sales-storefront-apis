import { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { safeEqual } from '../utils/crypto';

/**
 * Service-to-service auth: `Authorization: Bearer <INTERNAL_API_TOKEN>` — the
 * same shared token 11xsales-be uses. Off (404) when no token is configured.
 */
export async function authenticateService(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!env.internalApiToken) throw ApiError.notFound();
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token || !safeEqual(token, env.internalApiToken)) {
    throw ApiError.unauthorized('Invalid service token');
  }
  req.authMethod = 'service';
}
