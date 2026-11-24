'use strict';

const { clear } = require('./outcomes');
const { loadMatrix } = require('./matrix-loader');

/** Starts each run with empty outcome files, and fails before any request if the matrix is invalid. */
module.exports = async (config) => {
  for (const project of config.projects) clear(project.name);
  loadMatrix();
};
