#!/usr/bin/env node
'use strict';

/**
 * Runs the k6 load test against BOTH app modes — single-thread and cluster —
 * back to back, and emits a separate HTML report for each.
 *
 *   k6/report-single.html   ← CLUSTER_WORKERS=1
 *   k6/report-cluster.html  ← CLUSTER_WORKERS=<WORKERS>
 *
 * The same compiled bundle (dist/main.js) is used for both; the only
 * difference is the CLUSTER_WORKERS runtime env, which main.ts reads to
 * decide whether to fork worker processes.
 *
 * Prerequisites:
 *   - npm run build           (dist/main.js must exist)
 *   - k6 on PATH              (k6 version)
 *
 * Usage:
 *   node k6/bench-both.js
 *   VUS=20 DURATION=1m WORKERS=4 node k6/bench-both.js
 *   PORT_SINGLE=4001 PORT_CLUSTER=4002 node k6/bench-both.js
 *
 * Exit code is non-zero if either run's k6 thresholds fail.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(ROOT, 'dist', 'main.js');

const VUS = process.env.VUS || '10';
const DURATION = process.env.DURATION || '30s';
const WORKERS = process.env.CLUSTER_WORKERS || '4';
const PORT_SINGLE = process.env.PORT_SINGLE || '3001';
const PORT_CLUSTER = process.env.PORT_CLUSTER || '3002';
const START_TIMEOUT_MS = Number(process.env.START_TIMEOUT_MS || 30000);

const SCENARIOS = [
  {
    label: 'Single-thread (CLUSTER_WORKERS=1)',
    reportLabel: 'Single-thread Mode',
    port: PORT_SINGLE,
    workers: '1',
    json: path.join(ROOT, 'k6', 'results-single.json'),
    html: path.join(ROOT, 'k6', 'report-single.html'),
  },
  {
    label: `Cluster (CLUSTER_WORKERS=${WORKERS})`,
    reportLabel: `Cluster Mode (${WORKERS} workers)`,
    port: PORT_CLUSTER,
    workers: WORKERS,
    json: path.join(ROOT, 'k6', 'results-cluster.json'),
    html: path.join(ROOT, 'k6', 'report-cluster.html'),
  },
];

// ---------------------------------------------------------------------------
// Small cross-platform helpers
// ---------------------------------------------------------------------------
function log(msg) {
  console.log(`\n[bench-both] ${msg}`);
}

function sleepSync(ms) {
  // Node allows Atomics.wait on the main thread; fall back to a bounded spin
  // if SharedArrayBuffer is unavailable for any reason.
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

function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      // /T kills the whole process tree (cluster workers included)
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // We spawn with detached:true so children form a process group.
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch {
    /* ignore */
  }
}

function isReachable(url) {
  const code =
    'const http=require("http");' +
    `const req=http.get(${JSON.stringify(url)},r=>{process.exit(r.statusCode<500?0:1)});` +
    'req.on("error",()=>process.exit(1));' +
    'req.setTimeout(2000,()=>{req.destroy();process.exit(1)});';
  const r = spawnSync(process.execPath, ['-e', code], { stdio: 'ignore' });
  return r.status === 0;
}

function waitFor(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isReachable(url)) return true;
    sleepSync(500);
  }
  return false;
}

function run(cmd, args, opts = {}) {
  // Inherit stdio so k6 progress / report output streams to the console.
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  return r.status;
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------
function preflight() {
  if (!fs.existsSync(MAIN_JS)) {
    console.error(
      `[bench-both] ${path.relative(ROOT, MAIN_JS)} not found.\n` +
        '           Run "npm run build" first (it produces dist/ for BOTH modes).',
    );
    process.exit(1);
  }
  const k6 = spawnSync('k6', ['version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (k6.error || k6.status !== 0) {
    console.error('[bench-both] k6 not found on PATH. Install it first: https://k6.io/docs/get-started/installation/');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  preflight();
  log(`Config: VUS=${VUS}  DURATION=${DURATION}  WORKERS=${WORKERS}`);
  log(`Ports : single=${PORT_SINGLE}  cluster=${PORT_CLUSTER}`);

  let overallExit = 0;

  // Make sure nothing is left running if the user Ctrl-C's the run.
  const procs = [];
  const cleanup = () => {
    for (const p of procs) killTree(p.pid);
    process.exit(130);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  for (const s of SCENARIOS) {
    log(`▶ Starting ${s.label} on :${s.port} …`);
    const server = spawn(process.execPath, [MAIN_JS], {
      cwd: ROOT,
      env: { ...process.env, PORT: s.port, CLUSTER_WORKERS: s.workers },
      stdio: 'inherit',
      detached: true,
    });
    procs.push(server);

    const healthUrl = `http://localhost:${s.port}/`;
    if (!waitFor(healthUrl, START_TIMEOUT_MS)) {
      console.error(`[bench-both] ${s.label} did not become healthy in ${START_TIMEOUT_MS}ms`);
      killTree(server.pid);
      overallExit = 1;
      continue;
    }

    log(`✓ ${s.label} ready — running k6 (VUS=${VUS}, DURATION=${DURATION}) …`);
    const k6Status = run(
      'k6',
      [
        'run',
        'k6/load-test.js',
        '--out',
        `json=${s.json}`,
        '-e',
        `BASE_URL=http://localhost:${s.port}`,
        '-e',
        `VUS=${VUS}`,
        '-e',
        `DURATION=${DURATION}`,
      ],
      { cwd: ROOT },
    );

    log('  Stopping server…');
    killTree(server.pid);

    if (k6Status !== 0) {
      console.error(`[bench-both] k6 reported non-zero exit (${k6Status}) for ${s.label} — thresholds may have failed.`);
      overallExit = overallExit || k6Status;
    }

    // Only render a report if we actually produced JSON data.
    if (fs.existsSync(s.json)) {
      log('  Generating report…');
      run('node', ['k6/report.js', s.json, s.html, s.reportLabel], { cwd: ROOT });
      log(`  ✔ Report: ${path.relative(ROOT, s.html)}`);
    } else {
      console.error(`[bench-both] no JSON output at ${s.json}; skipping report.`);
    }
  }

  // Done — give the OS a moment to release the ports before exiting.
  sleepSync(500);
  process.off('SIGINT', cleanup);
  process.off('SIGTERM', cleanup);

  log('─'.repeat(60));
  log('Summary:');
  for (const s of SCENARIOS) {
    console.log(`  • ${s.reportLabel.padEnd(28)} → ${path.relative(ROOT, s.html)}`);
  }
  if (overallExit === 0) {
    log('All runs completed.');
  } else {
    console.error(`[bench-both] one or more runs failed (exit=${overallExit}).`);
  }
  process.exit(overallExit);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
