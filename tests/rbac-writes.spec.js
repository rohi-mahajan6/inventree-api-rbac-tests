'use strict';

/**
 * Docker-only matrix rows (target "docker"): staff and superuser safe probes, and real writes
 * (create / update / delete) for every role on a throwaway database. Never runs against the public
 * demo: playwright.config.js ignores this file in the public project, and the matrix loader refuses
 * write probes on public rows.
 */
const { test, expect } = require('@playwright/test');
const { rowsFor, resourceOf, SAFE_PROBES } = require('../src/utils/matrix-loader');
const { probe, send } = require('../src/api/client');
const fx = require('../src/api/fixtures');
const { record } = require('../src/utils/outcomes');

test.beforeEach(({}, testInfo) => {
  if (testInfo.project.name !== 'docker') throw new Error('rbac-writes.spec.js must only run in the docker project');
});

async function runWrite(request, row) {
  const resource = resourceOf(row.endpoint);
  if (row.probe === 'create') {
    const ctx = await fx.context(request);
    const res = await send(request, { method: 'POST', path: `/api/${resource}/`, role: row.role, data: fx.createPayload(resource, ctx), target: 'docker' });
    if (res.status === 201 && res.body && res.body.pk) res.cleanup = await fx.removeAsAdmin(request, resource, res.body.pk);
    return res;
  }

  const pk = await fx.createAsAdmin(request, resource);
  let res;
  if (row.probe === 'update') {
    res = await send(request, { method: 'PATCH', path: `/api/${resource}/${pk}/`, role: row.role, data: fx.updatePayload(resource), target: 'docker' });
    res.cleanup = await fx.removeAsAdmin(request, resource, pk);
  } else {
    await fx.prepareForDelete(request, resource, pk);
    res = await send(request, { method: 'DELETE', path: `/api/${resource}/${pk}/`, role: row.role, target: 'docker' });
    if (res.status !== 204) res.cleanup = await fx.removeAsAdmin(request, resource, pk);
  }
  return res;
}

test.describe('RBAC matrix: Docker-only rows', () => {
  for (const row of rowsFor('docker')) {
    test(`${row.id} ${row.role} ${row.method} ${row.endpoint} [${row.probe}] -> ${row.expected_status}`, async ({ request }, testInfo) => {
      let res;
      try {
        res = SAFE_PROBES.includes(row.probe) ? await probe(request, row, 'docker') : await runWrite(request, row);
      } catch (err) {
        // A fixture problem still gets a grid cell, marked as an error with the reason.
        record(testInfo, {
          kind: 'rbac', id: row.id, role: row.role, resource: resourceOf(row.endpoint), endpoint: row.endpoint,
          method: row.method, probe: row.probe, expected: row.expected_status, actual: 'error', pass: false,
          detail: String(err.message).slice(0, 300),
        });
        throw err;
      }
      record(testInfo, {
        kind: 'rbac', id: row.id, role: row.role, resource: resourceOf(row.endpoint), endpoint: row.endpoint,
        method: row.method, probe: row.probe, expected: row.expected_status, actual: res.status,
        pass: res.status === row.expected_status, ms: res.ms,
        detail: res.status === row.expected_status ? '' : res.text.slice(0, 200),
      });
      expect(res.status, `${row.id} (${row.basis}): ${res.text.slice(0, 200)}`).toBe(row.expected_status);
    });
  }
});
