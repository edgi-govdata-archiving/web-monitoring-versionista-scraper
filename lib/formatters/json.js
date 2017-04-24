'use strict';

// TODO: UUID assignment should happen independently of formatting
const uuid = require('../uuid.js');

/**
 * Converts scraped site data to JSON format.
 */
module.exports = function formatJson (sites, options = {}) {
  const formatted = sites.map(site => Object.assign({
    account: options.account
  }, site));
  return JSON.stringify(formatted);
}
