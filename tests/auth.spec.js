'use strict';

/**
 * Authentication edge cases. Token tests run on Docker only: asking for a token creates one on the
 * server, which is a write the public demo must not receive.
 */
const { test, expect } = require('@playwright/test');
const { send } = require('../src/api/client');
const { basic, token } = require('../src/api/auth');
const { record } = require('../src/utils/outcomes');

const GROUP = 'Authentication';

test.describe('Authentication', () => {
  test('anonymous request gets 401 "credentials were not provided"', async ({ request }, testInfo) => {
    const res = await send(request, { path: '/api/user/me/', role: 'anonymous', target: testInfo.project.name });
    const ok = res.status === 401 && /not provided/i.test((res.body && res.body.detail) || '');
    record(testInfo, { kind: 'check', group: GROUP, pass: ok, detail: `HTTP ${res.status} ${res.text.slice(0, 120)}` });
    expect(res.status).toBe(401);
    expect(res.body && res.body.detail).toMatch(/not provided/i);
  });

  let wrongPassword = null;
  test('wrong password gets 401', async ({ request }, testInfo) => {
    wrongPassword = await send(request, { path: '/api/user/me/', headers: basic('reader', 'not-the-password'), target: testInfo.project.name });
    record(testInfo, { kind: 'check', group: GROUP, pass: wrongPassword.status === 401, detail: `HTTP ${wrongPassword.status} ${wrongPassword.text.slice(0, 120)}` });
    expect(wrongPassword.status).toBe(401);
  });

  test('inactive account (ian) gets the same answer as a wrong password', async ({ request }, testInfo) => {
    const res = await send(request, { path: '/api/user/me/', role: 'ian', target: testInfo.project.name });
    // Same status and message: the response does not reveal that the account exists but is disabled.
    const same = !!wrongPassword && res.status === wrongPassword.status && res.text === wrongPassword.text;
    record(testInfo, { kind: 'check', group: GROUP, pass: res.status === 401 && same, detail: `HTTP ${res.status} ${res.text.slice(0, 120)}${same ? ' (identical to wrong password)' : ''}` });
    expect(res.status).toBe(401);
    expect(res.text, 'body identical to the wrong-password body').toBe(wrongPassword && wrongPassword.text);
  });

  test('account with no roles can log in but holds no role', async ({ request }, testInfo) => {
    const res = await send(request, { path: '/api/user/me/roles/', role: 'noaccess', target: testInfo.project.name });
    const roles = (res.body && res.body.roles) || {};
    const granted = Object.entries(roles).filter(([, perms]) => Array.isArray(perms) && perms.length);
    record(testInfo, { kind: 'check', group: GROUP, pass: res.status === 200 && granted.length === 0, detail: `HTTP ${res.status}, ${Object.keys(roles).length} roles listed, ${granted.length} granted` });
    expect(res.status).toBe(200);
    expect(Object.keys(roles).length).toBeGreaterThan(0);
    expect(granted).toEqual([]);
  });
});

test.describe('Token authentication (Docker only)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'docker', 'creates a token on the server: Docker only');
  });

  let issued = null;
  test('reader can obtain a token with Basic Auth', async ({ request }, testInfo) => {
    const res = await send(request, { path: '/api/user/me/token/', role: 'reader', target: 'docker' });
    issued = res.body && res.body.token;
    record(testInfo, { kind: 'check', group: 'Token authentication', pass: res.status === 200 && !!issued, detail: `HTTP ${res.status}, token ${issued ? 'issued' : 'missing'}` });
    expect(res.status).toBe(200);
    expect(issued).toBeTruthy();
  });

  test('the token authenticates as reader and keeps reader\'s permissions', async ({ request }, testInfo) => {
    test.skip(!issued, 'no token from the previous test');
    const me = await send(request, { path: '/api/user/me/', headers: token(issued), target: 'docker' });
    const write = await send(request, { method: 'POST', path: '/api/part/', headers: token(issued), data: {}, target: 'docker' });
    const ok = me.status === 200 && me.body && me.body.username === 'reader' && write.status === 403;
    record(testInfo, { kind: 'check', group: 'Token authentication', pass: ok, detail: `me: HTTP ${me.status} as ${me.body && me.body.username}; POST /api/part/: HTTP ${write.status}` });
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('reader');
    expect(write.status, 'a token must not grant more than the user has').toBe(403);
  });

  test('an invalid token gets 401', async ({ request }, testInfo) => {
    const res = await send(request, { path: '/api/user/me/', headers: token('inv-0000000000000000000000000000000000000000'), target: 'docker' });
    record(testInfo, { kind: 'check', group: 'Token authentication', pass: res.status === 401, detail: `HTTP ${res.status} ${res.text.slice(0, 120)}` });
    expect(res.status).toBe(401);
  });
});
