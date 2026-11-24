'use strict';

/**
 * Builds the JSON Schemas used by the contract tests from InvenTree's own published OpenAPI documents
 * (github.com/inventree/schema, MIT, one api.yaml per API version).
 *
 *   node scripts/extract-schemas.js [--pinned 570] [--current 583]
 *
 * Writes:
 *   schemas/<pinned>/<Component>.json  full schema of the pinned version (Docker image 1.7.4 = API 570)
 *   schemas/core/<Component>.json      only what the pinned and the current public version agree on:
 *                                      properties present in both with the same definition, and fields
 *                                      required in both. Used against the public demo, which runs a
 *                                      newer development build.
 *   schemas/sources.json               where each file came from
 *
 * OpenAPI 3.0 is converted to JSON Schema 2020-12: `nullable` becomes a "null" type, every $ref is
 * bundled into the file's own $defs, OpenAPI-only keywords are dropped.
 */
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const ROOTS = [
  'PaginatedPartList', 'Part',
  'PaginatedStockItemList', 'StockItem',
  'PaginatedPurchaseOrderList', 'PurchaseOrder',
  'PaginatedUserCreateList',
  'MeUser', 'Role',
];
const SOURCE = (v) => `https://raw.githubusercontent.com/inventree/schema/main/export/${v}/api.yaml`;
const OPENAPI_ONLY = ['nullable', 'readOnly', 'writeOnly', 'example', 'externalDocs', 'xml', 'discriminator', 'deprecated'];

function args() {
  const a = { pinned: '570', current: '583' };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) {
    if (v[i] === '--pinned') a.pinned = v[i + 1];
    else if (v[i] === '--current') a.current = v[i + 1];
    else throw new Error(`unknown argument ${v[i]}`);
  }
  return a;
}

async function load(version) {
  const res = await fetch(SOURCE(version));
  if (!res.ok) throw new Error(`${SOURCE(version)} -> HTTP ${res.status}`);
  const doc = YAML.parse(await res.text(), { maxAliasCount: -1 });
  return doc.components.schemas;
}

/** Converts one OpenAPI schema node to JSON Schema, collecting referenced component names. */
function convert(node, refs) {
  if (Array.isArray(node)) return node.map((n) => convert(n, refs));
  if (!node || typeof node !== 'object') return node;

  if (node.$ref) {
    const name = node.$ref.split('/').pop();
    refs.add(name);
    const ref = { $ref: `#/$defs/${name}` };
    // OpenAPI 3.0 cannot put nullable next to $ref; generators wrap it as allOf + nullable instead.
    return node.nullable ? { anyOf: [ref, { type: 'null' }] } : ref;
  }

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (OPENAPI_ONLY.includes(k)) continue;
    if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, convert(s, refs)]));
    } else if (['items', 'additionalProperties', 'not'].includes(k) && typeof v === 'object') {
      out[k] = convert(v, refs);
    } else if (['allOf', 'anyOf', 'oneOf'].includes(k)) {
      out[k] = v.map((s) => convert(s, refs));
    } else {
      out[k] = v;
    }
  }

  if (node.nullable) {
    if (out.allOf && out.allOf.length === 1 && Object.keys(out).length === 1) {
      return { anyOf: [out.allOf[0], { type: 'null' }] };
    }
    if (out.type) out.type = Array.isArray(out.type) ? [...new Set([...out.type, 'null'])] : [out.type, 'null'];
    else return { anyOf: [out, { type: 'null' }] };
    if (out.enum && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
}

/** One self-contained JSON Schema for a component, with every referenced component in $defs. */
function bundle(components, root) {
  const defs = {};
  const queue = [root];
  while (queue.length) {
    const name = queue.shift();
    if (defs[name]) continue;
    if (!components[name]) throw new Error(`component ${name} not found`);
    const refs = new Set();
    defs[name] = convert(components[name], refs);
    for (const r of refs) if (!defs[r]) queue.push(r);
  }
  const { [root]: top, ...rest } = defs;
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', title: root, ...top, $defs: rest };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Keeps only what both versions agree on. Properties defined differently become {} (any value). */
function intersect(a, b) {
  if (!a || !b) return {};
  if (same(a, b)) return a;
  if (a.properties && b.properties) {
    const out = { ...a, properties: {} };
    for (const [k, v] of Object.entries(a.properties)) {
      if (k in b.properties) out.properties[k] = same(v, b.properties[k]) ? v : intersectProperty(v, b.properties[k]);
    }
    out.required = (a.required || []).filter((r) => (b.required || []).includes(r) && r in out.properties);
    if (!out.required.length) delete out.required;
    return out;
  }
  return {};
}

function intersectProperty(a, b) {
  // Arrays of objects and nested objects are intersected; anything else that differs is left open.
  if (a.type === 'array' && b.type === 'array' && a.items && b.items) return { ...a, items: intersectProperty(a.items, b.items) };
  if (a.$ref && b.$ref && a.$ref === b.$ref) return a;
  if (a.properties && b.properties) return intersect(a, b);
  return {};
}

function intersectBundle(a, b) {
  // intersect() returns its input unchanged when both sides are equal: copy before adding $defs.
  const { $defs: ignored, ...top } = structuredClone(intersect(a, b));
  const out = top;
  out.$schema = a.$schema;
  out.title = a.title;
  out.$defs = {};
  for (const [k, v] of Object.entries(a.$defs || {})) {
    if (b.$defs && b.$defs[k]) out.$defs[k] = intersect(v, b.$defs[k]);
  }
  // A $ref to a definition that only exists in one version must not break the schema.
  const text = JSON.stringify(out).replace(/\{"\$ref":"#\/\$defs\/([^"]+)"\}/g, (m, name) => (out.$defs[name] ? m : '{}'));
  return JSON.parse(text);
}

function write(dir, name, schema) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(schema, null, 2) + '\n');
}

async function main() {
  const { pinned, current } = args();
  const root = path.join(__dirname, '..', 'schemas');
  const [p, c] = await Promise.all([load(pinned), load(current)]);
  for (const name of ROOTS) {
    const full = bundle(p, name);
    write(path.join(root, pinned), name, full);
    write(path.join(root, 'core'), name, intersectBundle(full, bundle(c, name)));
    console.log(`${name}: ${Object.keys(full.properties || {}).length} properties, ${Object.keys(full.$defs).length} referenced definitions`);
  }
  fs.writeFileSync(path.join(root, 'sources.json'), JSON.stringify({
    generatedBy: 'scripts/extract-schemas.js',
    pinned: { apiVersion: Number(pinned), source: SOURCE(pinned), note: 'inventree/inventree:1.7.4' },
    current: { apiVersion: Number(current), source: SOURCE(current), note: 'public demo when generated' },
    components: ROOTS,
  }, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
