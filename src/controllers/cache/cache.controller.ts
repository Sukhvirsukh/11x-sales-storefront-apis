import { FastifyReply, FastifyRequest } from 'fastify';
import { cacheService } from '../../services/cache/cache.service';
import { ApiResponse } from '../../utils/ApiResponse';
import { InvalidateCacheInput } from '../../validations/cache/cache.validation';

export async function invalidate(
  req: FastifyRequest<{ Body: InvalidateCacheInput }>,
  reply: FastifyReply,
) {
  const result = await cacheService.invalidate(req.body);
  return ApiResponse.ok(reply, result, 'Cache invalidated');
}

export async function stats(_req: FastifyRequest, reply: FastifyReply) {
  return ApiResponse.ok(reply, cacheService.stats(), 'Cache stats');
}
