'use strict';

/**
 * RBAC safe probes, one test per matrix row with target "both". Runs against the public demo and Docker.
 *   list        GET <list>?limit=1      200 allowed / 403 denied / 401 not logged in
 *   empty-body  POST <list> with {}     400 allowed (nothing created) / 403 / 401
 *   missing-id  DELETE <detail>/999..   404 allowed (nothing deleted) / 403 / 401
 * Plus what an account without any role can see in the user list.
 */
const { test, expect } = require('@playwright/test');
const { rowsFor, resourceOf } = require('../src/utils/matrix-loader');
const { probe, send } = require('../src/api/client');
const { errorValidator } = require('../src/utils/schema-validator');
const { record } = require('../src/utils/outcomes');

/** 401/403 must carry {detail}; 400 must name the invalid fields. */
function errorBodyProblems(res) {
  if (res.status === 401 || res.status === 403) return errorValidator('detail')(res.body).violations;
  if (res.status === 400) return errorValidator('validation')(res.body).violations;
  return [];
}

test.describe('RBAC matrix: safe probes', () => {
  for (const row of rowsFor('both')) {
    test(`${row.id} ${row.role} ${row.method} ${row.endpoint} [${row.probe}] -> ${row.expected_status}`, async ({ request }, testInfo) => {
      const res = await probe(request, row, testInfo.project.name);
      const bodyProblems = errorBodyProblems(res);
      record(testInfo, {
        kind: 'rbac', id: row.id, role: row.role, resource: resourceOf(row.endpoint), endpoint: row.endpoint,
        method: row.method, probe: row.probe, expected: row.expected_status, actual: res.status,
        pass: res.status === row.expected_status && bodyProblems.length === 0, ms: res.ms,
        detail: res.status === row.expected_status ? (bodyProblems.join('; ') || '') : res.text.slice(0, 200),
      });
      expect(res.status, `${row.id} (${row.basis}): ${res.text.slice(0, 200)}`).toBe(row.expected_status);
      expect(bodyProblems, 'error body shape').toEqual([]);
    });
  }
});

test.describe('User list visible to an account with no roles', () => {
  // Never acceptable for any viewer: secrets and login history.
  const NEVER = ['password', 'token', 'key', 'api_key', 'last_login', 'date_joined', 'otp', 'mfa'];
  // Visible to noaccess on the public demo (2026-11-24): FIND-001.
  const PRIVATE = ['email', 'is_staff', 'is_superuser', 'is_active'];

  let cached = null;
  async function userList(request, target) {
    if (!cached) cached = await send(request, { path: '/api/user/?limit=100', role: 'noaccess', target });
    return cached;
  }
  const fieldsOf = (body) => {
    const fields = new Set();
    for (const u of (body && body.results) || []) {
      for (const [k, v] of Object.entries(u)) {
        fields.add(k);
        if (v && typeof v === 'object' && !Array.isArray(v)) for (const nested of Object.keys(v)) fields.add(`${k}.${nested}`);
      }
    }
    return [...fields].sort();
  };

  test('noaccess can list users (documented: any logged-in user, scope g:read)', async ({ request }, testInfo) => {
    const res = await userList(request, testInfo.project.name);
    const count = res.body && Array.isArray(res.body.results) ? res.body.results.length : 0;
    record(testInfo, { kind: 'check', group: 'User visibility', pass: res.status === 200 && count > 0, detail: `HTTP ${res.status}, ${count} users, fields: ${fieldsOf(res.body).join(', ')}` });
    expect(res.status).toBe(200);
    expect(count).toBeGreaterThan(0);
  });

  test('user list never exposes password hashes, tokens or login history', async ({ request }, testInfo) => {
    const res = await userList(request, testInfo.project.name);
    const leaked = fieldsOf(res.body).filter((f) => NEVER.some((n) => f.split('.').pop().toLowerCase().includes(n)));
    record(testInfo, { kind: 'check', group: 'User visibility', pass: leaked.length === 0, detail: leaked.length ? `exposed: ${leaked.join(', ')}` : `none of: ${NEVER.join(', ')}` });
    expect(leaked).toEqual([]);
  });

  test.fail('FIND-001 an account with no roles cannot see other users\' email or privilege flags', async ({ request }, testInfo) => {
    const res = await userList(request, testInfo.project.name);
    const users = (res.body && res.body.results) || [];
    const exposed = PRIVATE.filter((f) => users.some((u) => u.username !== 'noaccess' && u[f] !== undefined && u[f] !== null && u[f] !== ''));
    record(testInfo, {
      kind: 'finding', id: 'FIND-001', present: exposed.length > 0,
      title: 'An account with no roles can read every user\'s email address and staff/superuser/active flags',
      detail: `GET /api/user/ as noaccess: ${users.length} users, visible: ${exposed.join(', ') || 'none'}. The schema allows any logged-in user to list users (scope g:read); the exposed fields go beyond what an account without roles needs.`,
    });
    expect(exposed).toEqual([]);
  });
});
