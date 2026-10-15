import crypto from 'crypto';

/**
 * For one-time links (email verification, password reset): the raw token
 * goes out in the email and is never persisted; only its hash is stored,
 * so a leaked database can't be used to forge valid links.
 */
export function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
