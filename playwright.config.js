'use strict';

/**
 * Two projects over the same data-driven specs:
 *   public - safe probes only (matrix rows with target "both"), against https://demo.inventree.org.
 *   docker - the same plus every Docker-only row (real writes), against inventree/inventree:1.7.4. CI only.
 * One worker in both: the public demo is shared, and the Docker write tests share fixture lookups.
 * No browser is used: tests call the API through Playwright's APIRequestContext.
 */
const { defineConfig } = require('@playwright/test');
require('dotenv').config({ quiet: true });

const target = process.env.INVENTREE_TARGET || 'public';

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./src/utils/global-setup.js'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: `results/${target}/results.json` }]],
  projects: [
    {
      name: 'public',
      // Writes and Docker-only rows never run against the public demo.
      testIgnore: /rbac-writes\.spec\.js/,
      use: { baseURL: process.env.INVENTREE_BASE_URL || 'https://demo.inventree.org' },
    },
    {
      name: 'docker',
      use: { baseURL: process.env.INVENTREE_BASE_URL || 'http://localhost:8000' },
    },
  ],
});
