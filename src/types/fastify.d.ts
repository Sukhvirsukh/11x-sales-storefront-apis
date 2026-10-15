import 'fastify';
import { AgentContext } from '../models/agent.model';
import { JwtPayload } from '../utils/jwt';

export type AuthMethod = 'jwt' | 'apiKey' | 'widget' | 'service';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by `authenticate` after a valid platform JWT is verified. */
    user: JwtPayload | null;
    /** Populated by `authenticateApiKey` (X-API-Key). */
    admin: { id: string; apiKeyId: string } | null;
    /** Populated by `authenticateWidget` (X-Widget-Key) — the storefront's agent. */
    agent: AgentContext | null;
    /** Which credential authenticated this request. */
    authMethod: AuthMethod | null;
    /** process.hrtime.bigint() at arrival, for Server-Timing and request logs. */
    startedAt: bigint;
  }
}
