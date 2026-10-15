import { FastifyReply } from 'fastify';

/**
 * Single shape for every successful response, so clients never have to
 * guess the envelope: { success, message, data } — identical to 11xsales-be.
 */
export class ApiResponse {
  static send<T>(reply: FastifyReply, statusCode: number, message: string, data?: T) {
    return reply.status(statusCode).send({
      success: true,
      message,
      data: data ?? null,
    });
  }

  static ok<T>(reply: FastifyReply, data?: T, message = 'Success') {
    return this.send(reply, 200, message, data);
  }

  static created<T>(reply: FastifyReply, data?: T, message = 'Created') {
    return this.send(reply, 201, message, data);
  }
}

/**
 * JSON-schema wrapper for a route's `schema.response`. Fastify compiles it
 * into a dedicated serializer (several times faster than JSON.stringify),
 * and anything not declared in `data` is dropped — so a field added to a
 * query can never leak to clients by accident.
 */
export function envelopeSchema(data: Record<string, unknown>) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      data,
    },
    required: ['success', 'message', 'data'],
  } as const;
}
