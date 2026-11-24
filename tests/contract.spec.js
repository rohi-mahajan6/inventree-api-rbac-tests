'use strict';

/**
 * Contract tests: response bodies validated with AJV.
 *   docker project: schemas/570 (the pinned 1.7.4 API), strict, no undocumented fields allowed.
 *   public project: schemas/core (what API 570 and the demo's API agree on), extra fields allowed.
 * Known deviations from InvenTree's own schema (src/utils/known-deviations.js) are tolerated by the
 * main tests and each has its own test.fail test below, which turns red if the deviation is fixed.
 * All requests are GETs as reader, apart from the error-body cases.
 */
const { test, expect } = require('@playwright/test');
const { send } = require('../src/api/client');
const { validatorFor, errorValidator, KNOWN_DEVIATIONS } = require('../src/utils/schema-validator');
const { record } = require('../src/utils/outcomes');

const schemaSet = (project) => (project === 'docker' ? '570' : 'core');
const responses = new Map();
const deviationsSeen = [];

async function get(request, path, target) {
  if (!responses.has(path)) responses.set(path, await send(request, { path, role: 'reader', target }));
  return responses.get(path);
}

async function firstPk(request, listPath, target) {
  const res = await get(request, listPath, target);
  const pk = res.body && res.body.results && res.body.results[0] && res.body.results[0].pk;
  if (!pk) throw new Error(`no record found at ${listPath} (HTTP ${res.status})`);
  return pk;
}

const CASES = [
  { name: 'part list', component: 'PaginatedPartList', path: async () => '/api/part/?limit=5' },
  { name: 'part detail', component: 'Part', path: async (rq, t) => `/api/part/${await firstPk(rq, '/api/part/?limit=5', t)}/` },
  { name: 'stock list', component: 'PaginatedStockItemList', path: async () => '/api/stock/?limit=5' },
  { name: 'stock item detail', component: 'StockItem', path: async (rq, t) => `/api/stock/${await firstPk(rq, '/api/stock/?limit=5', t)}/` },
  { name: 'purchase order list', component: 'PaginatedPurchaseOrderList', path: async () => '/api/order/po/?limit=5' },
  { name: 'purchase order detail', component: 'PurchaseOrder', path: async (rq, t) => `/api/order/po/${await firstPk(rq, '/api/order/po/?limit=5', t)}/` },
  { name: 'user list', component: 'PaginatedUserCreateList', path: async () => '/api/user/?limit=5' },
  { name: 'current user', component: 'MeUser', path: async () => '/api/user/me/' },
  { name: 'current user roles', component: 'Role', path: async () => '/api/user/me/roles/' },
];

test.describe('Contract: response bodies', () => {
  for (const c of CASES) {
    test(`${c.name} matches ${c.component}`, async ({ request }, testInfo) => {
      const target = testInfo.project.name;
      const set = schemaSet(target);
      const path = await c.path(request, target);
      const res = await get(request, path, target);
      const result = res.status === 200 ? validatorFor(set, c.component)(res.body) : { valid: false, violations: [`HTTP ${res.status}`], deviations: [] };
      deviationsSeen.push(...result.deviations.map((d) => ({ ...d, component: c.component })));
      const devIds = [...new Set(result.deviations.map((d) => d.id))];
      record(testInfo, {
        kind: 'check', group: `Contract (${set === 'core' ? 'core schema' : `API ${set}, strict`})`,
        pass: result.valid, detail: `${path}: ${result.valid ? 'valid' : result.violations.join('; ')}${devIds.length ? ` | known deviations: ${devIds.join(', ')}` : ''}`,
      });
      expect(res.status).toBe(200);
      expect(result.violations, `schema violations in ${path}`).toEqual([]);
    });
  }

  test('401 body has a detail message', async ({ request }, testInfo) => {
    const res = await send(request, { path: '/api/user/me/', role: 'anonymous', target: testInfo.project.name });
    const v = errorValidator('detail')(res.body);
    record(testInfo, { kind: 'check', group: 'Contract: error bodies', pass: res.status === 401 && v.valid, detail: `HTTP ${res.status} ${res.text.slice(0, 120)}` });
    expect(res.status).toBe(401);
    expect(v.violations).toEqual([]);
  });

  test('403 body has a detail message', async ({ request }, testInfo) => {
    // Safe: reader is denied before the (empty) body is looked at.
    const res = await send(request, { method: 'POST', path: '/api/part/', role: 'reader', data: {}, target: testInfo.project.name });
    const v = errorValidator('detail')(res.body);
    record(testInfo, { kind: 'check', group: 'Contract: error bodies', pass: res.status === 403 && v.valid, detail: `HTTP ${res.status} ${res.text.slice(0, 120)}` });
    expect(res.status).toBe(403);
    expect(v.violations).toEqual([]);
  });

  test('400 body names the invalid field', async ({ request }, testInfo) => {
    // Safe: allaccess may create parts, but an empty body fails validation; nothing is created.
    const res = await send(request, { method: 'POST', path: '/api/part/', role: 'allaccess', data: {}, target: testInfo.project.name });
    const v = errorValidator('validation')(res.body);
    const namesField = !!(res.body && res.body.name);
    record(testInfo, { kind: 'check', group: 'Contract: error bodies', pass: res.status === 400 && v.valid && namesField, detail: `HTTP ${res.status} ${res.text.slice(0, 120)}` });
    expect(res.status).toBe(400);
    expect(v.violations).toEqual([]);
    expect(namesField, '400 body mentions "name"').toBe(true);
  });
});

test.describe('Contract: known deviations from the published schema', () => {
  for (const d of KNOWN_DEVIATIONS) {
    test.fail(`${d.id} ${d.title}`, async ({}, testInfo) => {
      const seen = deviationsSeen.filter((x) => x.id === d.id);
      const examples = [...new Set(seen.map((x) => `${x.component}${x.path} = ${JSON.stringify(x.value)}`))].slice(0, 4);
      record(testInfo, {
        kind: 'finding', id: d.id, title: d.title, present: seen.length > 0,
        detail: seen.length
          ? `${seen.length} occurrence(s). Schema: ${d.expected}. Returned: ${examples.join('; ')}`
          : `Not seen in this run. Schema: ${d.expected}. Previously returned: ${d.observed}`,
      });
      expect(seen, `${d.id} occurrences`).toEqual([]);
    });
  }
});
