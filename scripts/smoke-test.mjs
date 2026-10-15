// API smoke test against a live server: health, routing, and every auth path.
//
//   API=http://127.0.0.1:5100 node scripts/smoke-test.mjs
//
// Without data it checks everything that doesn't need a row in the database.
// Point it at seeded data to check the full journeys too:
//   SMOKE_WIDGET_KEY        an active agent's widget_key
//   SMOKE_WIDGET_ORIGIN     one of that agent's widget_allowed_origins (optional)
//   SMOKE_PAUSED_WIDGET_KEY a paused agent's widget_key (optional)
//   SMOKE_API_KEY           a valid raw API key;  SMOKE_REVOKED_API_KEY a revoked one (optional)
//   SMOKE_JWT_SECRET        JWT_SECRET, to mint platform tokens like 11xsales-be does
//   SMOKE_INTERNAL_TOKEN    INTERNAL_API_TOKEN
import crypto from 'node:crypto';

const BASE = (process.env.API || 'http://127.0.0.1:5100').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const S = process.env;
let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}

async function call(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, headers: res.headers, raw: text.slice(0, 300) };
}

/** HS256 JWT with the payload 11xsales-be issues. */
function jwt(secret, payload, expiresInSec = 300) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ ...payload, iat: now, exp: now + expiresInSec })}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const expectStatus = async (label, promise, status) => {
  const r = await promise;
  check(`${label} → ${status}`, r.status === status, `got ${r.status}: ${r.raw}`);
  return r;
};

// ── Health & routing ──────────────────────────────────────
{
  const r = await expectStatus('GET /health', call(`${API}/health`), 200);
  check('health envelope', r.json?.success === true && typeof r.json?.data?.uptime === 'number', r.raw);
  check('Server-Timing header', /app;dur=/.test(r.headers.get('server-timing') ?? ''));
  check('X-Request-Id header', Boolean(r.headers.get('x-request-id')));
  await expectStatus('GET /health/ready', call(`${API}/health/ready`), 200);
  const nf = await expectStatus('unknown route', call(`${API}/nope`), 404);
  check('404 envelope', nf.json?.success === false && /Route not found/.test(nf.json?.message), nf.raw);
}

// ── Widget key ────────────────────────────────────────────
await expectStatus('storefront without widget key', call(`${API}/storefront/agent`), 401);
await expectStatus(
  'storefront with malformed widget key',
  call(`${API}/storefront/agent`, { headers: { 'X-Widget-Key': 'not-a-key' } }),
  401,
);
if (S.SMOKE_WIDGET_KEY) {
  await expectStatus(
    'storefront with unknown widget key',
    call(`${API}/storefront/agent`, { headers: { 'X-Widget-Key': crypto.randomUUID() } }),
    401,
  );
  const ok = await expectStatus(
    'storefront with widget key',
    call(`${API}/storefront/agent`, {
      headers: { 'X-Widget-Key': S.SMOKE_WIDGET_KEY, ...(S.SMOKE_WIDGET_ORIGIN ? { Origin: S.SMOKE_WIDGET_ORIGIN } : {}) },
    }),
    200,
  );
  const d = ok.json?.data ?? {};
  check('agent profile shape', Boolean(d.id && d.name && d.slug), ok.raw);
  check('agent profile hides internals', !('adminId' in d) && !('widgetAllowedOrigins' in d), ok.raw);
  const cd = await expectStatus(
    'GET /storefront/chat-design',
    call(`${API}/storefront/chat-design`, { headers: { 'X-Widget-Key': S.SMOKE_WIDGET_KEY } }),
    200,
  );
  const design = cd.json?.data ?? {};
  check('chat design has all 28 fields', Object.keys(design).length === 28, Object.keys(design).join(','));
  check('chat design types', typeof design.primaryColor === 'string' && Array.isArray(design.predefinedMessages) && typeof design.bubbleSize === 'number', cd.raw);
  if (S.SMOKE_WIDGET_ORIGIN) {
    await expectStatus(
      'storefront from a disallowed origin',
      call(`${API}/storefront/agent`, {
        headers: { 'X-Widget-Key': S.SMOKE_WIDGET_KEY, Origin: 'https://evil.example' },
      }),
      403,
    );
  }
  const me = await expectStatus('GET /me with widget key', call(`${API}/me`, { headers: { 'X-Widget-Key': S.SMOKE_WIDGET_KEY } }), 200);
  check('/me says widget', me.json?.data?.authMethod === 'widget', me.raw);
}
if (S.SMOKE_PAUSED_WIDGET_KEY) {
  await expectStatus(
    'storefront for a paused agent',
    call(`${API}/storefront/agent`, { headers: { 'X-Widget-Key': S.SMOKE_PAUSED_WIDGET_KEY } }),
    403,
  );
}

// ── API key ───────────────────────────────────────────────
await expectStatus('GET /me without credentials', call(`${API}/me`), 401);
await expectStatus('GET /me with malformed API key', call(`${API}/me`, { headers: { 'X-API-Key': 'short' } }), 401);
if (S.SMOKE_API_KEY) {
  await expectStatus(
    'GET /me with unknown API key',
    call(`${API}/me`, { headers: { 'X-API-Key': crypto.randomBytes(32).toString('hex') } }),
    401,
  );
  const r = await expectStatus('GET /me with API key', call(`${API}/me`, { headers: { 'X-API-Key': S.SMOKE_API_KEY } }), 200);
  check('/me says apiKey', r.json?.data?.authMethod === 'apiKey' && Boolean(r.json?.data?.admin?.id), r.raw);
}
if (S.SMOKE_REVOKED_API_KEY) {
  await expectStatus('GET /me with revoked API key', call(`${API}/me`, { headers: { 'X-API-Key': S.SMOKE_REVOKED_API_KEY } }), 401);
}

// ── Platform JWT ──────────────────────────────────────────
await expectStatus('GET /me with garbage JWT', call(`${API}/me`, { headers: { Authorization: 'Bearer x.y.z' } }), 401);
if (S.SMOKE_JWT_SECRET) {
  const payload = { sub: crypto.randomUUID(), email: 'smoke@example.com', role: 'admin' };
  const r = await expectStatus(
    'GET /me with JWT',
    call(`${API}/me`, { headers: { Authorization: `Bearer ${jwt(S.SMOKE_JWT_SECRET, payload)}` } }),
    200,
  );
  check('/me says jwt', r.json?.data?.authMethod === 'jwt' && r.json?.data?.user?.sub === payload.sub, r.raw);
  await expectStatus(
    'GET /me with expired JWT',
    call(`${API}/me`, { headers: { Authorization: `Bearer ${jwt(S.SMOKE_JWT_SECRET, payload, -60)}` } }),
    401,
  );
  await expectStatus(
    'GET /me with JWT signed by another secret',
    call(`${API}/me`, { headers: { Authorization: `Bearer ${jwt('wrong-secret', payload)}` } }),
    401,
  );
}

// ── Internal (service token) ──────────────────────────────
if (S.SMOKE_INTERNAL_TOKEN) {
  const auth = { Authorization: `Bearer ${S.SMOKE_INTERNAL_TOKEN}` };
  await expectStatus('internal without token', call(`${BASE}/internal/v1/cache/stats`), 401);
  await expectStatus(
    'internal with wrong token',
    call(`${BASE}/internal/v1/cache/stats`, { headers: { Authorization: 'Bearer nope' } }),
    401,
  );
  await expectStatus('cache stats', call(`${BASE}/internal/v1/cache/stats`, { headers: auth }), 200);
  await expectStatus(
    'invalidate with empty body',
    call(`${BASE}/internal/v1/cache/invalidate`, { method: 'POST', headers: auth, body: {} }),
    400,
  );
  await expectStatus(
    'invalidate a key',
    call(`${BASE}/internal/v1/cache/invalidate`, { method: 'POST', headers: auth, body: { keys: ['agent:wk:test'] } }),
    200,
  );
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
