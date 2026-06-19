#!/usr/bin/env node
'use strict';

/**
 * Converts k6 JSON output (--out json=results.json) into a self-contained
 * HTML dashboard with Chart.js graph visualizations.
 *
 * Usage:
 *   node k6/report.js                              # defaults
 *   node k6/report.js k6/results.json k6/report.html "Cluster Mode"
 *
 * No npm dependencies — uses only Node built-ins. Charts render via
 * Chart.js loaded from CDN, so open the HTML while online.
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const INPUT = args[0] || 'k6/results.json';
const OUTPUT = args[1] || 'k6/report.html';
const LABEL = args[2] || process.env.REPORT_LABEL || 'k6 Load Test Report';

// ---------------------------------------------------------------------------
// Parse NDJSON stream emitted by `k6 run --out json=...`.
// Each line is either a metric definition or a data point:
//   {"type":"Point","data":{"time":"...","value":1.5,"tags":{...}},"metric":"http_req_duration"}
// ---------------------------------------------------------------------------
function parse(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const points = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (obj.type !== 'Point') continue;
    const metric = obj.metric;
    const data = obj.data || {};
    const ms = Date.parse(data.time);
    if (!metric || !Number.isFinite(ms)) continue;
    points.push({ metric, t: ms, value: Number(data.value), tags: data.tags || {} });
  }
  return points;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function aggregate(points) {
  // Endpoints come from http_req_duration tags (one point per request).
  const durationsByEp = new Map();
  for (const p of points) {
    if (p.metric !== 'http_req_duration') continue;
    const ep = p.tags.endpoint || p.tags.scenario || 'default';
    if (!durationsByEp.has(ep)) durationsByEp.set(ep, []);
    durationsByEp.get(ep).push(p);
  }

  const times = points.map((p) => p.t).sort((a, b) => a - b);
  const tMin = times.length ? times[0] : 0;
  const tMax = times.length ? times[times.length - 1] : 0;
  const startBucket = Math.floor(tMin / 1000);
  const endBucket = Math.floor(tMax / 1000);
  const bucketCount = Math.max(1, endBucket - startBucket + 1);
  const bucketOf = (t) => Math.floor(t / 1000) - startBucket;

  const labels = Array.from({ length: bucketCount }, (_, i) => i);

  const series = {};
  for (const [ep, arr] of durationsByEp) {
    const buckets = Array.from({ length: bucketCount }, () => []);
    for (const d of arr) {
      const bi = bucketOf(d.t);
      if (bi >= 0 && bi < bucketCount) buckets[bi].push(d.value);
    }
    const sortedBuckets = buckets.map((b) => b.slice().sort((a, b) => a - b));
    const all = arr.map((d) => d.value).sort((a, b) => a - b);
    series[ep] = {
      total: arr.length,
      avg: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
      min: all.length ? all[0] : 0,
      max: all.length ? all[all.length - 1] : 0,
      p50: percentile(all, 50),
      p90: percentile(all, 90),
      p95: percentile(all, 95),
      p99: percentile(all, 99),
      // time series (per 1s bucket)
      rps: sortedBuckets.map((b) => b.length),
      p95Series: sortedBuckets.map((b) => percentile(b, 95)),
    };
  }

  const vus = points
    .filter((p) => p.metric === 'vus')
    .sort((a, b) => a.t - b.t)
    .map((p) => ({ x: (p.t - tMin) / 1000, y: p.value }));

  const failed = points.filter((p) => p.metric === 'http_req_failed');
  const errorRate = failed.length
    ? failed.reduce((a, b) => a + b.value, 0) / failed.length
    : 0;

  const allDurations = points
    .filter((p) => p.metric === 'http_req_duration')
    .map((p) => p.value)
    .sort((a, b) => a - b);

  return {
    label: LABEL,
    generatedAt: new Date().toISOString(),
    endpoints: [...durationsByEp.keys()].sort(),
    labels,
    series,
    vus,
    errorRate,
    totalReqs: allDurations.length,
    durationSec: bucketCount,
    overall: {
      avg: allDurations.length
        ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
        : 0,
      p50: percentile(allDurations, 50),
      p90: percentile(allDurations, 90),
      p95: percentile(allDurations, 95),
      p99: percentile(allDurations, 99),
    },
  };
}

function buildHtml(d) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(d.label)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: #0b0f17; color: #e6edf3; padding: 24px;
  }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .muted { color: #8b949e; font-size: 13px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 12px; margin: 20px 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px; }
  .card .k { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: .05em; }
  .card .v { font-size: 26px; font-weight: 600; margin-top: 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .panel { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px; }
  .panel h2 { margin: 0 0 12px; font-size: 14px; color: #c9d1d9; }
  canvas { max-height: 280px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: right; padding: 8px 10px; border-bottom: 1px solid #21262d; }
  th:first-child, td:first-child { text-align: left; }
  th { color: #8b949e; font-weight: 600; }
  td.num { font-variant-numeric: tabular-nums; }
  .footer { margin-top: 24px; color: #6e7681; font-size: 12px; }
</style>
</head>
<body>
  <h1>${escapeHtml(d.label)}</h1>
  <div class="muted">Generated ${escapeHtml(d.generatedAt)} · ${d.totalReqs.toLocaleString()} requests · ${d.durationSec}s · ${d.endpoints.length} endpoints</div>

  <div class="cards">
    <div class="card"><div class="k">Total Requests</div><div class="v">${d.totalReqs.toLocaleString()}</div></div>
    <div class="card"><div class="k">Error Rate</div><div class="v">${(d.errorRate * 100).toFixed(2)}%</div></div>
    <div class="card"><div class="k">Overall avg</div><div class="v">${fmtMs(d.overall.avg)}</div></div>
    <div class="card"><div class="k">Overall p95</div><div class="v">${fmtMs(d.overall.p95)}</div></div>
  </div>

  <div class="grid">
    <div class="panel"><h2>Throughput over time (req/s)</h2><canvas id="rps"></canvas></div>
    <div class="panel"><h2>p95 latency over time (ms)</h2><canvas id="p95"></canvas></div>
    <div class="panel"><h2>Latency percentiles per endpoint (ms)</h2><canvas id="perc"></canvas></div>
    <div class="panel"><h2>Avg throughput per endpoint (req/s)</h2><canvas id="avg"></canvas></div>
  </div>
  <div class="panel" style="margin-top:16px">
    <h2>Per-endpoint summary</h2>
    <table>
      <thead><tr><th>Endpoint</th><th>Requests</th><th>Avg</th><th>p50</th><th>p90</th><th>p95</th><th>p99</th><th>Max</th></tr></thead>
      <tbody>
        ${d.endpoints
          .map(
            (ep) =>
              `<tr><td>${escapeHtml(ep)}</td><td class="num">${d.series[ep].total.toLocaleString()}</td><td class="num">${fmtMs(d.series[ep].avg)}</td><td class="num">${fmtMs(d.series[ep].p50)}</td><td class="num">${fmtMs(d.series[ep].p90)}</td><td class="num">${fmtMs(d.series[ep].p95)}</td><td class="num">${fmtMs(d.series[ep].p99)}</td><td class="num">${fmtMs(d.series[ep].max)}</td></tr>`,
          )
          .join('\n')}
      </tbody>
    </table>
  </div>

  <div class="footer">Generated by k6/report.js · Charts powered by Chart.js</div>

<script>
const REPORT = ${JSON.stringify(d)};
const COLORS = ['#4dc9f6','#f67019','#f53794','#537bc4','#acc236','#166a8f','#00a950','#a371f7','#e8b339','#58a6ff'];
const labels = REPORT.labels.map(String);
const baseLine = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color + '33', tension: 0.3, pointRadius: 0, borderWidth: 2, fill: false });

new Chart(document.getElementById('rps'), {
  type: 'line',
  data: { labels, datasets: REPORT.endpoints.map((ep,i) => baseLine(ep, REPORT.series[ep].rps, COLORS[i%COLORS.length])) },
  options: lineOpts('req/s')
});
new Chart(document.getElementById('p95'), {
  type: 'line',
  data: { labels, datasets: REPORT.endpoints.map((ep,i) => baseLine(ep, REPORT.series[ep].p95Series, COLORS[i%COLORS.length])) },
  options: lineOpts('ms')
});
new Chart(document.getElementById('perc'), {
  type: 'bar',
  data: {
    labels: REPORT.endpoints,
    datasets: [
      bar('p50', REPORT.endpoints.map(ep => REPORT.series[ep].p50), '#4dc9f6'),
      bar('p90', REPORT.endpoints.map(ep => REPORT.series[ep].p90), '#f67019'),
      bar('p95', REPORT.endpoints.map(ep => REPORT.series[ep].p95), '#f53794'),
      bar('p99', REPORT.endpoints.map(ep => REPORT.series[ep].p99), '#acc236'),
    ]
  },
  options: barOpts('ms')
});
new Chart(document.getElementById('avg'), {
  type: 'bar',
  data: { labels: REPORT.endpoints, datasets: [bar('avg req/s', REPORT.endpoints.map(ep => REPORT.series[ep].total / REPORT.durationSec), '#58a6ff')] },
  options: barOpts('req/s')
});

function lineOpts(yTitle) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8b949e', boxWidth: 12 } } },
    scales: {
      x: { title: { display: true, text: 'seconds', color: '#8b949e' }, ticks: { color: '#6e7681' }, grid: { color: '#21262d' } },
      y: { title: { display: true, text: yTitle, color: '#8b949e' }, ticks: { color: '#6e7681' }, grid: { color: '#21262d' }, beginAtZero: true }
    }
  };
}
function barOpts(yTitle) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8b949e', boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: '#6e7681' }, grid: { color: '#21262d' } },
      y: { title: { display: true, text: yTitle, color: '#8b949e' }, ticks: { color: '#6e7681' }, grid: { color: '#21262d' }, beginAtZero: true }
    }
  };
}
function bar(label, data, color) { return { label, data, backgroundColor: color, borderRadius: 4 }; }
</script>
</body>
</html>`;
}

function fmtMs(v) {
  if (!Number.isFinite(v)) return '—';
  return v >= 1000 ? (v / 1000).toFixed(2) + ' s' : v.toFixed(1) + ' ms';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// ---------------------------------------------------------------------------
const points = parse(INPUT);
if (points.length === 0) {
  console.error(`No data points found in ${INPUT}. Run k6 with --out json=${INPUT} first.`);
  process.exit(1);
}
const data = aggregate(points);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, buildHtml(data));
console.log(
  `Report written to ${OUTPUT} (${data.totalReqs} requests, ${data.endpoints.length} endpoints)`,
);
