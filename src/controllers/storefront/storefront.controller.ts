import { FastifyReply, FastifyRequest } from 'fastify';
import { storefrontService } from '../../services/storefront/storefront.service';
import { ApiResponse } from '../../utils/ApiResponse';

/** GET /storefront/agent — the widget's own agent profile (widget-key authenticated). */
export async function agentProfile(req: FastifyRequest, reply: FastifyReply) {
  // Browsers may reuse it briefly; Vary keeps one store's answer from serving another.
  reply.header('cache-control', 'private, max-age=30');
  reply.header('vary', 'Origin, X-Widget-Key');
  return ApiResponse.ok(reply, storefrontService.publicProfile(req.agent!), 'Agent profile');
}

/** GET /storefront/chat-design — the widget's settings, as saved from the dashboard. */
export async function chatDesign(req: FastifyRequest, reply: FastifyReply) {
  reply.header('cache-control', 'private, max-age=30');
  reply.header('vary', 'Origin, X-Widget-Key');
  return ApiResponse.ok(
    reply,
    storefrontService.chatDesign(req.agent!),
    'Chat design fetched successfully',
  );
}

/** GET /me — who the request authenticated as, for any credential type. Handy for integrators. */
export async function whoAmI(req: FastifyRequest, reply: FastifyReply) {
  return ApiResponse.ok(
    reply,
    {
      authMethod: req.authMethod,
      user: req.user,
      admin: req.admin,
      agent: req.agent ? { id: req.agent.id, slug: req.agent.slug } : null,
    },
    'Authenticated',
  );
}
