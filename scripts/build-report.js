'use strict';

/**
 * Builds the HTML report from the test outcomes of both targets and the k6 summary.
 *   node scripts/build-report.js [--in results] [--out site]
 *
 * Reads every outcomes.jsonl, results.json (Playwright) and k6-summary.json under --in (local runs
 * write results/<project>/, CI downloads artifacts into results/results-<project>/).
 * Writes one self-contained index.html: the RBAC grid per target (role x endpoint x probe, each cell
 * expected vs actual), checks, findings and load-test figures.
 * Exits with an error when no outcomes are found, so an empty report is never published.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROLE_ORDER = ['admin', 'steven', 'allaccess', 'engineer', 'reader', 'noaccess', 'ian', 'anonymous'];
const RESOURCE_ORDER = ['part', 'stock', 'order/po', 'user'];
const PROBE_ORDER = ['list', 'empty-body', 'missing-id', 'create', 'update', 'delete'];
const PROBE_LABEL = {
  list: 'GET list', 'empty-body': 'POST {}', 'missing-id': 'DELETE missing', create: 'POST create', update: 'PATCH', delete: 'DELETE',
};
const TARGET_LABEL = { public: 'Public demo (demo.inventree.org)', docker: 'Docker inventree/inventree:1.7.4' };

function args() {
  const a = { in: 'results', out: 'site' };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) {
    if (v[i] === '--in') a.in = v[i + 1];
    else if (v[i] === '--out') a.out = v[i + 1];
    else throw new Error(`unknown argument ${v[i]}`);
  }
  return a;
}

function find(dir, name, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) find(full, name, found);
    else if (e.name === name) found.push(full);
  }
  return found;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const targetOf = (file) => (/docker/.test(file) ? 'docker' : 'public');

function load(inDir) {
  const outcomes = [];
  for (const f of find(inDir, 'outcomes.jsonl')) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) if (line.trim()) outcomes.push(JSON.parse(line));
  }
  const stats = {};
  for (const f of find(inDir, 'results.json')) {
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8')).stats;
      stats[targetOf(f)] = s;
    } catch { /* ignore */ }
  }
  let k6 = null;
  const k6File = find(inDir, 'k6-summary.json')[0];
  if (k6File) k6 = JSON.parse(fs.readFileSync(k6File, 'utf8'));
  return { outcomes, stats, k6 };
}

const icon = (pass) => (pass ? '<span class="ic ok" aria-hidden="true">&#10003;</span>' : '<span class="ic bad" aria-hidden="true">&#10005;</span>');

function grid(rows) {
  const resources = RESOURCE_ORDER.filter((r) => rows.some((x) => x.resource === r));
  const probes = PROBE_ORDER.filter((p) => rows.some((x) => x.probe === p));
  const roles = ROLE_ORDER.filter((r) => rows.some((x) => x.role === r));
  const at = (role, res, probe) => rows.find((x) => x.role === role && x.resource === res && x.probe === probe);

  let h = '<div class="table-wrap"><table class="grid"><thead><tr><th rowspan="2">Role</th>';
  for (const r of resources) h += `<th colspan="${probes.length}" class="grp">/api/${esc(r)}/</th>`;
  h += '</tr><tr>';
  for (const r of resources) for (const p of probes) h += `<th class="sub">${esc(PROBE_LABEL[p])}</th>`;
  h += '</tr></thead><tbody>';
  for (const role of roles) {
    h += `<tr><th class="role">${esc(role)}</th>`;
    for (const r of resources) {
      for (const p of probes) {
        const c = at(role, r, p);
        if (!c) { h += '<td class="na">&ndash;</td>'; continue; }
        const title = `${c.id}: ${c.method} ${c.endpoint} as ${c.role}. Expected ${c.expected}, got ${c.actual}.${c.detail ? ` ${c.detail}` : ''}`;
        h += `<td class="${c.pass ? 'pass' : 'fail'}" title="${esc(title)}">${icon(c.pass)}<span class="code">${esc(c.actual)}</span>${c.pass ? '' : `<span class="exp">exp ${esc(c.expected)}</span>`}</td>`;
      }
    }
    h += '</tr>';
  }
  return `${h}</tbody></table></div>`;
}

function checksTable(items) {
  if (!items.length) return '<p class="muted">None in this run.</p>';
  let h = '<div class="table-wrap"><table class="list"><thead><tr><th>Group</th><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>';
  for (const c of items) {
    h += `<tr><td>${esc(c.group)}</td><td>${esc(c.test)}</td><td class="res">${icon(c.pass)} ${c.pass ? 'Pass' : 'Fail'}</td><td class="detail">${esc(c.detail)}</td></tr>`;
  }
  return `${h}</tbody></table></div>`;
}

function k6Section(k6) {
  if (!k6) return '<p class="muted">No k6 summary in this run.</p>';
  const m = k6.metrics || {};
  const d = m.http_req_duration || {};
  const failed = m.http_req_failed || {};
  const checks = m.checks || {};
  const ms = (v) => (typeof v === 'number' ? `${v.toFixed(1)} ms` : '&ndash;');
  const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : '&ndash;');
  const failRate = typeof failed.value === 'number' ? failed.value : failed.rate;
  const checkRate = typeof checks.value === 'number' ? checks.value : checks.rate;
  const tiles = [
    ['Requests', m.http_reqs ? `${m.http_reqs.count} (${m.http_reqs.rate.toFixed(1)}/s)` : '&ndash;'],
    ['Peak virtual users', m.vus_max ? m.vus_max.value : '&ndash;'],
    ['Median', ms(d.med)], ['p95', ms(d['p(95)'])], ['p99', ms(d['p(99)'])], ['Max', ms(d.max)],
    ['Failed requests', `${pct(failRate)} ${typeof failRate === 'number' ? icon(failRate < 0.01) : ''}`],
    ['Checks passed', `${pct(checkRate)} ${typeof checkRate === 'number' ? icon(checkRate > 0.99) : ''}`],
  ];
  return `<div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="v">${v}</div><div class="k">${esc(k)}</div></div>`).join('')}</div>
  <p class="muted">Scenario: ramp to 50 virtual users over 10 s, hold 30 s, ramp down 10 s; part list then part detail as reader (token auth), 1 s think time. Thresholds: failed requests &lt; 1%, checks &gt; 99%. No latency threshold until a baseline exists.</p>`;
}

function page(data) {
  const targets = ['public', 'docker'].filter((t) => data.outcomes.some((o) => o.target === t));
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

  const summary = targets.map((t) => {
    const o = data.outcomes.filter((x) => x.target === t);
    const rbac = o.filter((x) => x.kind === 'rbac');
    const checks = o.filter((x) => x.kind === 'check');
    const s = data.stats[t];
    return `<div class="tile"><div class="k">${esc(TARGET_LABEL[t])}</div>
      <div class="v">${rbac.filter((x) => x.pass).length}/${rbac.length}</div><div class="k">RBAC cells as expected</div>
      <div class="small">${checks.filter((x) => x.pass).length}/${checks.length} checks passed${s ? ` &middot; Playwright: ${s.expected} passed, ${s.unexpected} failed, ${s.skipped} skipped` : ''}</div></div>`;
  }).join('');

  const findings = new Map();
  for (const f of data.outcomes.filter((x) => x.kind === 'finding')) {
    if (!findings.has(f.id)) findings.set(f.id, { id: f.id, title: f.title, by: {} });
    findings.get(f.id).by[f.target] = f;
  }
  let fh = '<div class="table-wrap"><table class="list"><thead><tr><th>ID</th><th>Finding</th>';
  for (const t of targets) fh += `<th>${esc(t)}</th>`;
  fh += '</tr></thead><tbody>';
  for (const f of findings.values()) {
    fh += `<tr><td class="nowrap">${esc(f.id)}</td><td>${esc(f.title)}`;
    const detail = Object.values(f.by).find((x) => x.present) || Object.values(f.by)[0];
    fh += `<div class="detail">${esc(detail.detail)}</div></td>`;
    for (const t of targets) {
      const x = f.by[t];
      fh += `<td class="nowrap">${x ? (x.present ? '<span class="ic warn" aria-hidden="true">!</span> Present' : `${icon(true)} Not seen`) : '&ndash;'}</td>`;
    }
    fh += '</tr>';
  }
  fh += '</tbody></table></div>';

  const sections = targets.map((t) => {
    const o = data.outcomes.filter((x) => x.target === t);
    return `<h2>${esc(TARGET_LABEL[t])}</h2>
      <h3>RBAC matrix</h3>${grid(o.filter((x) => x.kind === 'rbac'))}
      <h3>Checks</h3>${checksTable(o.filter((x) => x.kind === 'check'))}`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>InvenTree API RBAC</title>
<style>
:root { color-scheme: light; --bg:#f6f6f4; --surface:#fcfcfb; --border:#e2e1dc; --grid:#ecebe7; --text:#0b0b0b; --text2:#52514e; --muted:#77766f;
  --good:#0ca30c; --good-bg:#e7f5e7; --critical:#d03b3b; --critical-bg:#fbe9e9; --warning:#fab219; --link:#1c5cab; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --bg:#121211; --surface:#1a1a19; --border:#2f2f2d; --grid:#262624;
  --text:#f0efec; --text2:#c3c2b7; --muted:#96958c; --good-bg:#16301a; --critical-bg:#3a1c1c; --link:#86b6ef; } }
:root[data-theme="dark"] { color-scheme: dark; --bg:#121211; --surface:#1a1a19; --border:#2f2f2d; --grid:#262624;
  --text:#f0efec; --text2:#c3c2b7; --muted:#96958c; --good-bg:#16301a; --critical-bg:#3a1c1c; --link:#86b6ef; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
main { max-width:1200px; margin:0 auto; padding:24px 16px 48px; }
a { color:var(--link); }
h1 { font-size:24px; margin:0 0 4px; } h2 { font-size:19px; margin:36px 0 8px; } h3 { font-size:15px; margin:20px 0 8px; color:var(--text2); }
.muted, .small { color:var(--muted); } .small { font-size:12px; margin-top:6px; }
.tiles { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); margin:16px 0; }
.tile { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:14px; }
.tile .v { font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; } .tile .k { color:var(--muted); font-size:12px; }
.table-wrap { overflow-x:auto; background:var(--surface); border:1px solid var(--border); border-radius:10px; }
table { border-collapse:collapse; width:100%; font-size:13px; }
th, td { padding:6px 8px; border-bottom:1px solid var(--grid); text-align:left; vertical-align:top; }
th { color:var(--text2); font-weight:600; }
.grid th.grp { text-align:center; border-left:2px solid var(--border); }
.grid th.sub { font-weight:500; font-size:11px; white-space:nowrap; }
.grid th.role { white-space:nowrap; }
.grid td { text-align:center; white-space:nowrap; font-variant-numeric:tabular-nums; }
.grid td.pass { background:var(--good-bg); } .grid td.fail { background:var(--critical-bg); font-weight:600; } .grid td.na { color:var(--muted); }
.code { margin-left:4px; } .exp { display:block; font-size:11px; color:var(--text2); font-weight:400; }
.ic { display:inline-grid; place-items:center; width:16px; height:16px; border-radius:50%; color:#fff; font-size:10px; font-weight:700; vertical-align:-3px; }
.ic.ok { background:var(--good); } .ic.bad { background:var(--critical); } .ic.warn { background:var(--warning); color:#0b0b0b; }
.list td.res, .nowrap { white-space:nowrap; } .detail { color:var(--text2); font-size:12px; overflow-wrap:anywhere; }
footer { color:var(--muted); font-size:12px; margin-top:32px; }
</style>
</head>
<body><main>
<h1>InvenTree API RBAC</h1>
<p class="muted">Generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC${runUrl ? ` from <a href="${esc(runUrl)}">this workflow run</a>` : ' from a local run'}. Each grid cell is one matrix row: the status received, green when it matches the expected status. Hover a cell for the row id and details.</p>
<div class="tiles">${summary}</div>
<h2>Findings</h2>
<p class="muted">Behaviour worth reporting. Each is pinned by a test that turns red if it changes.</p>
${findings.size ? fh : '<p class="muted">None recorded.</p>'}
${sections}
<h2>Load test (Docker only)</h2>
${k6Section(data.k6)}
<footer>Public demo: safe probes only (GET lists, POST with an empty body, DELETE of a missing id), one request at a time. Writes and load run against a throwaway Docker container in CI. Not affiliated with InvenTree.</footer>
</main></body></html>
`;
}

function main() {
  const a = args();
  const data = load(a.in);
  if (!data.outcomes.length) {
    console.error(`build-report: no outcomes.jsonl found under ${a.in}`);
    process.exit(1);
  }
  fs.rmSync(a.out, { recursive: true, force: true });
  fs.mkdirSync(a.out, { recursive: true });
  fs.writeFileSync(path.join(a.out, 'index.html'), page(data));
  fs.writeFileSync(path.join(a.out, '.nojekyll'), '');
  const byTarget = {};
  for (const o of data.outcomes) byTarget[o.target] = (byTarget[o.target] || 0) + 1;
  console.log(`report written to ${path.join(a.out, 'index.html')} (${JSON.stringify(byTarget)} outcomes, k6: ${data.k6 ? 'yes' : 'no'})`);
}

main();
