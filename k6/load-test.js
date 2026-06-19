import http from 'k6/http';
import { check, group } from 'k6';

/**
 * k6 load test for the CPU-heavy endpoints.
 *
 * Each endpoint runs in its own scenario using the constant-vus executor:
 *   https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-vus/
 *
 * Usage:
 *   k6 run k6/load-test.js
 *   BASE_URL=http://localhost:3000 VUS=20 DURATION=1m k6 run k6/load-test.js
 *
 * Run a single endpoint only (or a comma-separated subset):
 *   k6 run k6/load-test.js -e SCENARIO=primes
 *   k6 run k6/load-test.js -e SCENARIO=primes,hash
 */

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = parseInt(__ENV.VUS || '10', 10);
const DURATION = __ENV.DURATION || '30s';
// Optional subset filter, e.g. SCENARIO=primes or SCENARIO=primes,hash.
// Empty/unset runs every endpoint in its own scenario.
const SCENARIO = __ENV.SCENARIO || '';
const wanted = SCENARIO
  ? new Set(
      SCENARIO.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

// (endpoint name, path) — workloads match the service defaults so they stay
// comparable. Tune per scenario if you want a heavier/lighter mix.
const endpoints = [
  ['primes', '/cpu/primes?limit=100000'],
  ['fibonacci', '/cpu/fibonacci?n=30'],
  ['sort', '/cpu/sort?size=10000'],
  ['matrix', '/cpu/matrix?size=200'],
  ['pi', '/cpu/pi?iterations=10000000'],
  ['hash', '/cpu/hash?rounds=100000'],
];

// One constant-vus scenario per endpoint, all running in parallel.
// Each scenario calls a named exec function (export function <name>) below.
// Honors the SCENARIO env var so you can run a single endpoint subset.
const scenarios = {};
for (const [name, path] of endpoints) {
  if (wanted && !wanted.has(name)) continue;
  scenarios[name] = {
    executor: 'constant-vus',
    exec: name,
    vus: VUS,
    duration: DURATION,
    tags: { endpoint: name },
  };
}

// Build thresholds only for the scenarios that will actually run.
const thresholds = {
  // Fail the run if more than 5% of requests error out
  http_req_failed: ['rate<0.05'],
};
for (const name of Object.keys(scenarios)) {
  // p95 latency per endpoint should stay under 10s on a 4-CPU box
  thresholds[`http_req_duration{endpoint:${name}}`] = ['p(95)<10000'];
}

export const options = {
  scenarios,
  thresholds,
};

function hit(name, path) {
  const res = http.get(`${BASE}${path}`, { tags: { endpoint: name } });
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has durationMs': (r) => {
      try {
        return typeof r.json('durationMs') === 'number';
      } catch (e) {
        return false;
      }
    },
  });
}

// One exported function per scenario. k6 dispatches VUs to them
// according to the scenario config above.
export function primes() {
  group('primes', () => hit('primes', '/cpu/primes?limit=100000'));
}
export function fibonacci() {
  group('fibonacci', () => hit('fibonacci', '/cpu/fibonacci?n=30'));
}
export function sort() {
  group('sort', () => hit('sort', '/cpu/sort?size=10000'));
}
export function matrix() {
  group('matrix', () => hit('matrix', '/cpu/matrix?size=200'));
}
export function pi() {
  group('pi', () => hit('pi', '/cpu/pi?iterations=10000000'));
}
export function hash() {
  group('hash', () => hit('hash', '/cpu/hash?rounds=100000'));
}
