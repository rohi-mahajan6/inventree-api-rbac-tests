'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const KNOWN_DEVIATIONS = require('./known-deviations');

/**
 * AJV validator for response bodies.
 *   set "570"  full schemas of the pinned version (Docker image 1.7.4), strict: objects may not carry
 *              fields the schema does not document.
 *   set "core" what the pinned and the current public version agree on, lenient: extra fields are
 *              allowed, so the public demo can add fields without breaking the contract.
 *
 * Every schema error is either a known deviation (src/utils/known-deviations.js) or a violation.
 */
const SCHEMA_DIR = path.join(__dirname, '..', '..', 'schemas');
// OpenAPI number/string formats with no meaning for validation.
const OPAQUE_FORMATS = ['int64', 'int32', 'double', 'float', 'decimal', 'binary', 'byte', 'password'];

/** Adds additionalProperties: false to every object schema that lists its properties. */
function strictify(node) {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = v && typeof v === 'object' ? strictify(v) : v;
  if (out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

function pointer(data, instancePath) {
  if (!instancePath) return data;
  return instancePath.split('/').slice(1).reduce((v, key) => {
    if (v === undefined || v === null) return undefined;
    return v[key.replace(/~1/g, '/').replace(/~0/g, '~')];
  }, data);
}

function message(e) {
  const extra = e.params && e.params.additionalProperty ? ` "${e.params.additionalProperty}"` : '';
  return `${e.instancePath || '(root)'} ${e.message}${extra}`;
}

/** Splits AJV errors into known deviations and real violations. */
function classify(errors, data) {
  const deviations = [];
  const rest = [];
  for (const e of errors || []) {
    const value = pointer(data, e.instancePath);
    const rule = KNOWN_DEVIATIONS.find((d) => d.match(e, value));
    if (rule) deviations.push({ id: rule.id, path: e.instancePath, value });
    else rest.push(e);
  }
  // A nullable $ref is anyOf [ref, null]. When the ref branch fails only because of a known deviation,
  // AJV also reports "must be null" and "must match a schema in anyOf" for the same path: drop those.
  const violations = rest.filter((e) => {
    const wrapper = e.keyword === 'anyOf' || e.keyword === 'oneOf' || (e.keyword === 'type' && e.params.type === 'null');
    return !(wrapper && deviations.some((d) => d.path === e.instancePath || d.path.startsWith(`${e.instancePath}/`)));
  });
  return { deviations, violations: violations.map(message) };
}

const cache = new Map();

function compiler() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true });
  addFormats(ajv);
  for (const f of OPAQUE_FORMATS) ajv.addFormat(f, true);
  return ajv;
}

function wrap(validate) {
  return (body) => {
    validate(body);
    const { deviations, violations } = classify(validate.errors, body);
    return { valid: violations.length === 0, violations: violations.slice(0, 15), deviations };
  };
}

/** validate(body) -> { valid, violations[], deviations[] } for one component of a schema set. */
function validatorFor(set, component) {
  const key = `${set}/${component}`;
  if (!cache.has(key)) {
    let schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, set, `${component}.json`), 'utf8'));
    if (set !== 'core') schema = strictify(schema);
    cache.set(key, wrap(compiler().compile(schema)));
  }
  return cache.get(key);
}

/** Validates against one of the hand-written error body schemas ("detail" or "validation"). */
function errorValidator(kind) {
  const key = `errors/${kind}`;
  if (!cache.has(key)) {
    const all = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'errors.json'), 'utf8'));
    cache.set(key, wrap(compiler().compile({ $schema: all.$schema, $defs: all.$defs, $ref: `#/$defs/${kind}` })));
  }
  return cache.get(key);
}

module.exports = { validatorFor, errorValidator, strictify, KNOWN_DEVIATIONS };
