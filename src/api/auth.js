'use strict';

/**
 * Credentials come from INVENTREE_DEMO_PASSWORDS, a JSON object of username -> password
 * (.env locally, a repository secret in CI). "anonymous" sends no Authorization header.
 */
let cached = null;

function passwords() {
  if (!cached) {
    const raw = process.env.INVENTREE_DEMO_PASSWORDS;
    if (!raw) throw new Error('INVENTREE_DEMO_PASSWORDS is not set (see .env.example)');
    try {
      cached = JSON.parse(raw);
    } catch {
      throw new Error('INVENTREE_DEMO_PASSWORDS is not valid JSON');
    }
  }
  return cached;
}

function basic(username, password) {
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}

function authHeader(role) {
  if (role === 'anonymous') return {};
  const password = passwords()[role];
  if (!password) throw new Error(`INVENTREE_DEMO_PASSWORDS has no password for "${role}"`);
  return basic(role, password);
}

function token(value) {
  return { Authorization: `Token ${value}` };
}

module.exports = { authHeader, basic, token, passwords };
