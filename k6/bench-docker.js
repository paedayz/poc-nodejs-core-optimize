#!/usr/bin/env node
'use strict';

/**
 * Docker variant of bench-both.js.
 *
 * Assumes the app is ALREADY running as separate containers — the `single`
 * and `cluster` services from docker-compose.yml. This script does NOT spawn
 * any servers; for each target it:
 *
 *   1. waits for GET / to answer (depends_on only guarantees start order),
 *   2. runs k6 against it  (--out json=results-<mode>.json),
 *   3. renders an HTML report via k6/report.js.
 *
 * Designed to run INSIDE the `bench` container with the host's ./k6 mounted
 * at /k6, so the scripts are read from and reports written to the host.
 *
 * Usage (from host):
 *   docker compose --profile bench up --abort-on-container-exit --exit-code-from bench
 *
 * Tunables (env): VUS, DURATION, SINGLE_URL, CLUSTER_URL, START_TIMEOUT_MS.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const VUS = process.env.VUS || '10';
const DURATION = process.env.DURATION || '30s';
const START_TIMEOUT_MS = Number(process.env.START_TIMEOUT_MS || 60000);
const K6_DIR = process.env.K6_DIR || '/k6';

const SCENARIOS = [
  {
    label: 'Single-thread Mode',
    url: process.env.SINGLE_URL || 'http://single:3000',
    json: `${K6_DIR}/results-single.json`,
    html: `${K6_DIR}/report-single.html`,
  },
  {
    label: 'Cluster Mode',
    url: process.env.CLUSTER_URL || 'http://cluster:3000',
    json: `${K6_DIR}/results-cluster.json`,
    html: `${K6_DIR}/report-cluster.html`,
  },
];

// ---------------------------------------------------------------------------
function log(msg) {
  console.log(`\n[bench-docker] ${msg}`);
}

function sleepSync(ms) {
  // Node permits Atomics.wait on the main thread; spin as a fallback.
  try {
    const buf = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(buf, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

function isReachable(url) {
  const code =
    'const http=require("http");' +
    `const req=http.get(${JSON.stringify(url)},r=>{process.exit(r.statusCode<500?0:1)});` +
    'req.on("error",()=>process.exit(1));' +
    'req.setTimeout(2000,()=>{req.destroy();process.exit(1)});';
  return spawnSync(process.execPath, ['-e', code], { stdio: 'ignore' }).status === 0;
}

function waitFor(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isReachable(url)) return true;
    sleepSync(500);
  }
  return false;
}

function run(cmd, args) {
  // k6 progress and report output stream live to the compose logs.
  return spawnSync(cmd, args, { stdio: 'inherit' }).status;
}

// ---------------------------------------------------------------------------
function main() {
  log(`Config: VUS=${VUS}  DURATION=${DURATION}  K6_DIR=${K6_DIR}`);
  let exit = 0;

  for (const s of SCENARIOS) {
    log(`▶ Waiting for ${s.label} at ${s.url} …`);
    if (!waitFor(s.url, START_TIMEOUT_MS)) {
      console.error(
        `[bench-docker] ${s.url} not reachable within ${START_TIMEOUT_MS}ms — skipping.`,
      );
      exit = 1;
      continue;
    }

    log(`✓ ${s.label} ready — running k6 (VUS=${VUS}, DURATION=${DURATION}) …`);
    const k6Status = run('k6', [
      'run',
      `${K6_DIR}/load-test.js`,
      '--out',
      `json=${s.json}`,
      '-e',
      `BASE_URL=${s.url}`,
      '-e',
      `VUS=${VUS}`,
      '-e',
      `DURATION=${DURATION}`,
    ]);

    if (k6Status !== 0) {
      console.error(`[bench-docker] k6 exited ${k6Status} for ${s.label} — thresholds may have failed.`);
      exit = exit || k6Status;
    }

    if (fs.existsSync(s.json)) {
      log('  Rendering report…');
      run('node', [`${K6_DIR}/report.js`, s.json, s.html, s.label]);
      log(`  ✔ ${s.html}`);
    } else {
      console.error(`[bench-docker] no JSON at ${s.json}; skipping report.`);
    }
  }

  log('─'.repeat(60));
  log('Reports:');
  for (const s of SCENARIOS) {
    console.log(`  • ${s.label.padEnd(20)} → ${s.html}`);
  }
  if (exit === 0) log('All runs completed.');
  else console.error(`[bench-docker] one or more runs failed (exit=${exit}).`);
  process.exit(exit);
}

main();
