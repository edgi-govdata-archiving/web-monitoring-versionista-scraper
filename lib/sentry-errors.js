'use strict';

/**
 * A simplified interface to Sentry.io's Raven library that makes it easy to
 * wait until calls to Sentry.io are complete.
 */

const Sentry = require('@sentry/node');

const maximumWaitTime = 5000;

// For options information, see:
// https://docs.sentry.io/error-reporting/configuration/?platform=node
exports.setup = function (options) {
  Sentry.init(options);
  return exports;
}

exports.captureException = Sentry.captureException;
exports.captureMessage = Sentry.captureMessage;
exports.flush = (timeout = maximumWaitTime) => Sentry.flush(timeout);
exports.Sentry = Sentry;
