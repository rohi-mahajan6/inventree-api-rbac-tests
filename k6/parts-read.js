/**
 * k6 read scenario. Docker only: refuses to run against the public demo.
 *
 *   k6 run --summary-export results/docker/k6-summary.json k6/parts-read.js
 *
 * Ramp to 50 virtual users over 10 s, hold 30 s, ramp down 10 s. Each iteration, as reader:
 * GET /api/part/?limit=25, then GET /api/part/{id}/ for one part from that page, then 1 s think time.
 *
 * Auth: one API token fetched in setup(). Basic Auth on every request would mostly measure password
 * hashing, not the API.
 *
 * Thresholds: under 1% failed requests and over 99% passed checks. There is deliberately no latency
 * threshold yet: the p95 limit will be set from the first measured runs, not guessed.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';

const BASE = (__ENV.INVENTREE_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
if (/demo\.inventree\.org/.test(BASE)) {
  throw new Error('k6 must not run against the public demo; use the local Docker container');
}

export const options = {
  scenarios: {
    read_parts: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const passwords = JSON.parse(__ENV.INVENTREE_DEMO_PASSWORDS || '{}');
  if (!passwords.reader) throw new Error('INVENTREE_DEMO_PASSWORDS has no password for "reader"');
  const basic = `Basic ${encoding.b64encode(`reader:${passwords.reader}`)}`;
  const res = http.get(`${BASE}/api/user/me/token/`, { headers: { Authorization: basic, Accept: 'application/json' } });
  if (res.status !== 200 || !res.json('token')) throw new Error(`could not get a token: HTTP ${res.status}`);
  return { auth: `Token ${res.json('token')}` };
}

export default function (data) {
  const params = { headers: { Authorization: data.auth, Accept: 'application/json' } };

  const list = http.get(`${BASE}/api/part/?limit=25`, { ...params, tags: { name: 'GET /api/part/?limit=25' } });
  const ok = check(list, {
    'part list: 200': (r) => r.status === 200,
    'part list: has results': (r) => Array.isArray(r.json('results')) && r.json('results').length > 0,
  });

  if (ok) {
    const results = list.json('results');
    const pk = results[Math.floor(Math.random() * results.length)].pk;
    const detail = http.get(`${BASE}/api/part/${pk}/`, { ...params, tags: { name: 'GET /api/part/{id}/' } });
    check(detail, {
      'part detail: 200': (r) => r.status === 200,
      'part detail: same pk': (r) => r.json('pk') === pk,
    });
  }

  sleep(1);
}
