// Load test a running server (autocannon).
//
//   npm run bench                                   # GET /api/v1/health
//   BENCH_PATH=/api/v1/storefront/agent BENCH_WIDGET_KEY=<agents.widget_key> npm run bench
//   BENCH_PATH=/api/v1/me BENCH_API_KEY=<raw key> npm run bench
//
// Raise RATE_LIMIT_MAX on the server first, or most requests come back 429.
import autocannon from 'autocannon';

const url = `${(process.env.API || 'http://127.0.0.1:5100').replace(/\/$/, '')}${process.env.BENCH_PATH || '/api/v1/health'}`;
const headers = {};
if (process.env.BENCH_WIDGET_KEY) headers['x-widget-key'] = process.env.BENCH_WIDGET_KEY;
if (process.env.BENCH_API_KEY) headers['x-api-key'] = process.env.BENCH_API_KEY;

const result = await autocannon({
  url,
  headers,
  connections: Number(process.env.BENCH_CONNECTIONS || 50),
  duration: Number(process.env.BENCH_SECONDS || 10),
});

const { latency, requests, non2xx } = result;
console.log(`\n${url}`);
console.log(`requests/sec  avg ${requests.average.toFixed(0)}`);
console.log(`latency (ms)  p50 ${latency.p50}  p90 ${latency.p90}  p99 ${latency.p99}  max ${latency.max}`);
console.log(`non-2xx       ${non2xx}`);
