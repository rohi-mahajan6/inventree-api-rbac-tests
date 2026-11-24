'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Every test appends one line to results/<project>/outcomes.jsonl with what it expected and what it
 * got. scripts/build-report.js turns these lines into the HTML matrix. Written before the assertion,
 * so failed tests are recorded too.
 */
const RESULTS = path.join(__dirname, '..', '..', 'results');

function fileFor(project) {
  return path.join(RESULTS, project, 'outcomes.jsonl');
}

function record(testInfo, outcome) {
  const file = fileFor(testInfo.project.name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ target: testInfo.project.name, test: testInfo.title, ...outcome }) + '\n');
}

function clear(project) {
  fs.rmSync(fileFor(project), { force: true });
}

module.exports = { record, clear, fileFor };
