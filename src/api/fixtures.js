'use strict';

const { send } = require('./client');

/**
 * Test data for the real write rows (Docker only). Records are created and removed as admin, so a
 * write test checks one thing: whether the role under test is allowed the action.
 * Names carry a run stamp, so leftovers from a failed cleanup are easy to spot.
 */
const ADMIN = 'admin';
const RUN = Date.now().toString(36);
let counter = 0;
let lookups = null;

const unique = () => `${RUN}${(counter += 1)}`;

async function asAdmin(request, method, path, data) {
  return send(request, { method, path, role: ADMIN, data, target: 'docker' });
}

/** Existing records from the demo dataset that new records point at. */
async function context(request) {
  if (!lookups) {
    lookups = (async () => {
      const first = async (path) => {
        const res = await asAdmin(request, 'GET', path);
        const pk = res.body && res.body.results && res.body.results[0] && res.body.results[0].pk;
        if (res.status !== 200 || !pk) throw new Error(`fixture lookup ${path} -> HTTP ${res.status}`);
        return pk;
      };
      return {
        category: await first('/api/part/category/?limit=1'),
        part: await first('/api/part/?limit=1&active=true&virtual=false'),
        supplier: await first('/api/company/?limit=1&is_supplier=true'),
      };
    })();
  }
  return lookups;
}

function createPayload(resource, ctx) {
  const u = unique();
  switch (resource) {
    case 'part':
      return { name: `RBAC test part ${u}`, description: 'Created by inventree-api-rbac-tests', category: ctx.category, active: true, component: true };
    case 'stock':
      return { part: ctx.part, quantity: 1, batch: `RBAC-${u}` };
    case 'order/po':
      // Default reference pattern is "PO-{ref:04d}"; a high number keeps clear of the dataset's orders.
      return { supplier: ctx.supplier, reference: `PO-${700000 + (Date.now() % 100000) + counter}`, description: `RBAC test order ${u}` };
    case 'user':
      return { username: `rbac_${u}`, first_name: 'Rbac', last_name: 'Test', email: `rbac_${u}@example.com` };
    default:
      throw new Error(`no create payload for ${resource}`);
  }
}

function updatePayload(resource) {
  switch (resource) {
    case 'part': return { description: 'Updated by inventree-api-rbac-tests' };
    case 'stock': return { batch: `RBAC-UPDATED-${unique()}` };
    case 'order/po': return { description: 'Updated by inventree-api-rbac-tests' };
    case 'user': return { first_name: 'Updated' };
    default: throw new Error(`no update payload for ${resource}`);
  }
}

/** Creates a record as admin and returns its pk. Throws with the server's answer if that fails. */
async function createAsAdmin(request, resource) {
  const ctx = await context(request);
  const res = await asAdmin(request, 'POST', `/api/${resource}/`, createPayload(resource, ctx));
  if (res.status !== 201 || !res.body || !res.body.pk) {
    throw new Error(`fixture: admin could not create ${resource}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  }
  return res.body.pk;
}

/** A part can only be deleted once it is inactive; this keeps delete tests about permission only. */
async function prepareForDelete(request, resource, pk) {
  if (resource === 'part') {
    const res = await asAdmin(request, 'PATCH', `/api/part/${pk}/`, { active: false });
    if (res.status !== 200) throw new Error(`fixture: could not deactivate part ${pk}: HTTP ${res.status}`);
  }
}

/** Best-effort cleanup as admin. Returns the final status, never throws. */
async function removeAsAdmin(request, resource, pk) {
  try {
    await prepareForDelete(request, resource, pk);
    const res = await asAdmin(request, 'DELETE', `/api/${resource}/${pk}/`);
    return res.status;
  } catch {
    return null;
  }
}

module.exports = { context, createPayload, updatePayload, createAsAdmin, prepareForDelete, removeAsAdmin };
