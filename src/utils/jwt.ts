import { createVerifier } from 'fast-jwt';
import { env } from '../config/env';

/** Same payload 11xsales-be signs (see its utils/jwt.ts `issueTokens`). */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
}

/**
 * Verifies access tokens issued by 11xsales-be with the shared JWT_SECRET.
 * This service never issues tokens. fast-jwt keeps a cache of already
 * verified tokens, so a storefront session's repeat calls skip the HMAC
 * entirely; expiry is still checked on every cache hit.
 */
const verifier = createVerifier({
  key: env.jwt.secret,
  algorithms: ['HS256'],
  cache: 10_000,
  cacheTTL: 60_000,
});

export function verifyAccessToken(token: string): JwtPayload {
  const payload = verifier(token) as Partial<JwtPayload>;
  if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
    throw new Error('Token payload is missing sub/role');
  }
  return { sub: payload.sub, email: payload.email ?? '', role: payload.role };
}
