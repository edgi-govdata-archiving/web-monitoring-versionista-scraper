'use strict';

/**
 * A simplified interface to Sentry.io's Raven library that makes it easy to
 * wait until calls to Sentry.io are complete.
 */

const EventEmitter = require('events');
const Raven = require('raven');

const defaultOptions = {captureUnhandledRejections: true};
const maximumWaitTime = 5000;

const asyncTracker = Object.assign(new EventEmitter(), {
  active: 0,

  trackMethod (context, functionName) {
    return (...args) => {
      return new Promise(resolve => {
        this.active++;
        context[functionName](...args, () => {
          this.active--;
          if (this.active === 0) {
            this.emit('allMessagesEnded');
          }
          resolve();
        });
      });
    };
  },

  waitUntilInactive () {
    return new Promise(resolve => {
      if (this.active === 0) {
        return resolve();
      }

      const timer = setTimeout(listener, maximumWaitTime);
      this.on('allMessagesEnded', listener);
      function listener () {
        this.removeListener('allMessagesEnded', listener);
        clearTimeout(timer);
        resolve();
      }
    });
  }
});

exports.setup = function (options, dsn = process.env['SENTRY_DSN']) {
  if (dsn) {
    Raven.config(dsn, Object.assign({}, defaultOptions, options)).install();
  }
  return exports;
}

exports.captureException = asyncTracker.trackMethod(Raven, 'captureException');
exports.captureMessage = asyncTracker.trackMethod(Raven, 'captureMessage');
exports.flush = () => asyncTracker.waitUntilInactive();
exports.Raven = Raven;
