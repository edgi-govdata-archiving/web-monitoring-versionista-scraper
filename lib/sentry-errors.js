'use strict';

/**
 * A simplified interface to Sentry.io's Raven library that makes it easy to
 * wait until calls to Sentry.io are complete.
 */

const EventEmitter = require('events');
const Sentry = require('@sentry/node');

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

exports.setup = function (options, dsn = 'https://ded77ba6693a42fea73a23abd7c8de8f@sentry.io/1775138') {
  if (dsn) {
    const dsnObj = { dsn: dsn}
    Sentry.init(Object.assign({}, dsnObj, defaultOptions, options))
  }
  return exports;
}

exports.captureException = asyncTracker.trackMethod(Sentry, 'captureException');
exports.captureMessage = asyncTracker.trackMethod(Sentry, 'captureMessage');
exports.flush = () => asyncTracker.waitUntilInactive();
exports.Sentry = Sentry;
