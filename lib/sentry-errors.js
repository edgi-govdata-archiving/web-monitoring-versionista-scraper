'use strict';

/**
 * A simplified interface to Sentry.io's Raven library that makes it easy to
 * wait until calls to Sentry.io are complete.
 */

const Sentry = require('@sentry/node');

const defaultOptions = {captureUnhandledRejections: true};
const maximumWaitTime = 5000;

exports.setup = function (options) {
  Sentry.init(Object.assign({}, defaultOptions, options))
  return exports;
}

exports.captureException = Sentry.captureException;
exports.captureMessage = Sentry.captureMessage;
exports.flush = (timeout = maximumWaitTime) => Sentry.flush(timeout);
exports.Sentry = Sentry;
