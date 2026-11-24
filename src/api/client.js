'use strict';

const { authHeader } = require('./auth');

/**
 * Thin wrapper over Playwright's APIRequestContext. Every call returns status, parsed body and time,
 * and never throws on an HTTP error status: the status is what the tests check.
 * Against the public demo, each request is followed by a short pause so the suite never bursts.
 */
const MISSING_ID = 999999999;
const PUBLIC_PAUSE_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(request, { method = 'GET', path, role = 'anonymous', headers, data, target }) {
  const started = Date.now();
  const res = await request.fetch(path, {
    method,
    headers: { Accept: 'application/json', ...(headers || authHeader(role)) },
    data,
    failOnStatusCode: false,
    timeout: 20_000,
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (target === 'public') await sleep(PUBLIC_PAUSE_MS);
  return { status: res.status(), body, text, ms: Date.now() - started };
}

/** The three safe probes. None of them can create, change or delete anything. */
function probeRequest(row) {
  switch (row.probe) {
    case 'list':
      return { method: 'GET', path: `${row.endpoint}?limit=1` };
    case 'empty-body':
      // Allowed: 400 (validation fails, nothing created). Denied: 403. Permission is checked first.
      return { method: 'POST', path: row.endpoint, data: {} };
    case 'missing-id':
      // Allowed: 404 (no such record). Denied: 403. Never sent to a list URL (that would be a bulk delete).
      if (!row.endpoint.includes('{id}')) throw new Error(`${row.id}: missing-id probe needs a detail endpoint`);
      return { method: 'DELETE', path: row.endpoint.replace('{id}', String(MISSING_ID)) };
    default:
      throw new Error(`${row.id}: ${row.probe} is not a safe probe`);
  }
}

async function probe(request, row, target) {
  return send(request, { ...probeRequest(row), role: row.role, target });
}

module.exports = { send, probe, probeRequest, MISSING_ID };
