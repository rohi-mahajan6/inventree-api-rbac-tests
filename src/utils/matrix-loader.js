'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

/**
 * Loads data/rbac-matrix.csv and checks every row before any test is generated from it, so a typo in
 * the CSV fails loudly instead of producing a test that checks nothing.
 */
const MATRIX = path.join(__dirname, '..', '..', 'data', 'rbac-matrix.csv');
const ROLES = ['allaccess', 'reader', 'engineer', 'noaccess', 'ian', 'steven', 'admin', 'anonymous'];
const TARGETS = ['both', 'docker'];
const PROBES = {
  list: 'GET',
  'empty-body': 'POST',
  'missing-id': 'DELETE',
  create: 'POST',
  update: 'PATCH',
  delete: 'DELETE',
};
const SAFE_PROBES = ['list', 'empty-body', 'missing-id'];

function loadMatrix(file = MATRIX) {
  const rows = parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
  const ids = new Set();
  const problems = [];
  rows.forEach((r, i) => {
    const where = `row ${i + 2} (${r.id})`;
    if (!/^RBAC-[PD]\d{3}$/.test(r.id)) problems.push(`${where}: bad id`);
    if (ids.has(r.id)) problems.push(`${where}: duplicate id`);
    ids.add(r.id);
    if (!TARGETS.includes(r.target)) problems.push(`${where}: unknown target "${r.target}"`);
    if (!ROLES.includes(r.role)) problems.push(`${where}: unknown role "${r.role}"`);
    if (!PROBES[r.probe]) problems.push(`${where}: unknown probe "${r.probe}"`);
    else if (PROBES[r.probe] !== r.method) problems.push(`${where}: probe ${r.probe} must use ${PROBES[r.probe]}, not ${r.method}`);
    if (!/^\/api\/.+\/$/.test(r.endpoint)) problems.push(`${where}: bad endpoint "${r.endpoint}"`);
    // Writes must never be scheduled against the public demo.
    if (r.target === 'both' && !SAFE_PROBES.includes(r.probe)) problems.push(`${where}: probe ${r.probe} is not safe for the public demo`);
    const status = Number(r.expected_status);
    if (!Number.isInteger(status) || status < 200 || status > 599) problems.push(`${where}: bad expected_status`);
    r.expected_status = status;
  });
  if (problems.length) throw new Error(`rbac-matrix.csv is invalid:\n${problems.join('\n')}`);
  return rows;
}

/** Rows a project runs: public gets the safe rows shared with Docker; docker gets the Docker-only rows here. */
function rowsFor(target) {
  return loadMatrix().filter((r) => r.target === target);
}

/** "/api/stock/{id}/" -> "stock" */
function resourceOf(endpoint) {
  return endpoint.replace(/^\/api\//, '').replace(/\{id\}\/$/, '').replace(/\/$/, '');
}

module.exports = { loadMatrix, rowsFor, resourceOf, ROLES, PROBES, SAFE_PROBES };
