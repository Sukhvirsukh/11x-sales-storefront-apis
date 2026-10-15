import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthMethod } from '../types/fastify';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../utils/jwt';
import { authenticateApiKey } from './api-key-auth.middleware';
import { authenticateWidget } from './widget-auth.middleware';

/**
 * Platform JWT (`Authorization: Bearer <token>`), issued by 11xsales-be and
 * verified here with the shared JWT_SECRET. Attaches the payload to `req.user`.
 * Usage: `preHandler: [authenticate]`.
 */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }
  try {
    req.user = verifyAccessToken(header.slice('Bearer '.length).trim());
    req.authMethod = 'jwt';
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
}

/** Role guard, composed after `authenticate`. Usage: `preHandler: [authenticate, authorize('admin')]`. */
export function authorize(...allowedRoles: string[]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.user) throw ApiError.unauthorized('Not authenticated');
    if (!allowedRoles.includes(req.user.role)) {
      throw ApiError.forbidden('You do not have permission to perform this action');
    }
  };
}

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const guards: Record<
  Exclude<AuthMethod, 'service'>,
  { guard: Guard; present: (req: FastifyRequest) => boolean }
> = {
  apiKey: { guard: authenticateApiKey, present: (req) => req.headers['x-api-key'] !== undefined },
  widget: {
    guard: authenticateWidget,
    present: (req) => req.headers['x-widget-key'] !== undefined,
  },
  jwt: { guard: authenticate, present: (req) => req.headers.authorization !== undefined },
};

const headerFor = { apiKey: 'X-API-Key', widget: 'X-Widget-Key', jwt: 'Authorization: Bearer' };

/**
 * Accepts whichever of the listed credentials the request carries — for
 * endpoints that both the storefront browser (widget key) and a merchant's
 * server (API key) may call. Checked in the order given; the first one
 * present must be valid (no silent fallthrough to a weaker method).
 * Usage: `preHandler: [authenticateAny('widget', 'apiKey')]`.
 */
export function authenticateAny(...methods: Array<keyof typeof guards>): Guard {
  const accepted = methods.map((m) => headerFor[m]).join(', ');
  return async (req, reply) => {
    for (const method of methods) {
      if (guards[method].present(req)) return guards[method].guard(req, reply);
    }
    throw ApiError.unauthorized(`Missing credentials. Send one of: ${accepted}`);
  };
}
