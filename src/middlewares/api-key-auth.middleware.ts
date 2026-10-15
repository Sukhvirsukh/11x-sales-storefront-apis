import { FastifyReply, FastifyRequest } from 'fastify';
import { apiKeyService } from '../services/api-key/api-key.service';
import { ApiError } from '../utils/ApiError';

// 11xsales-be issues 64 hex chars (randomBytes(32)); anything else can't be a key, so skip the lookup.
const KEY_FORMAT = /^[0-9a-f]{64}$/;

/**
 * Server-to-server credential: `X-API-Key`, one of an admin's keys created
 * in 11xsales-be. Same rules as 11xsales-be's own middleware — any
 * non-revoked key of the admin passes — but the lookup is cached and the
 * last-used write is batched, so a hot key costs no database round trip.
 */
export async function authenticateApiKey(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers['x-api-key'];
  const rawKey = Array.isArray(header) ? header[0] : header;

  if (!rawKey) throw ApiError.unauthorized('Missing X-API-Key header');
  if (!KEY_FORMAT.test(rawKey)) throw ApiError.unauthorized('Invalid or revoked API key');

  const apiKey = await apiKeyService.resolve(rawKey);
  if (!apiKey || apiKey.revoked) throw ApiError.unauthorized('Invalid or revoked API key');

  apiKeyService.recordUse(apiKey.id);
  req.admin = { id: apiKey.adminId, apiKeyId: apiKey.id };
  req.authMethod = 'apiKey';
}
