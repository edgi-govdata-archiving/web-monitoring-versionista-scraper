'use strict';

const request = require('request');

const MAX_SOCKETS = 6;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36';
const SLEEP_EVERY = 40;
const SLEEP_FOR = 1000;
const MAX_RETRIES = 3;

function createClient ({userAgent = USER_AGENT, maxSockets = MAX_SOCKETS, sleepEvery = SLEEP_EVERY, sleepFor = SLEEP_FOR} = {}) {
  const cookieJar = request.jar();
  const versionistaRequest = request.defaults({
    jar: cookieJar,
    headers: {'User-Agent': userAgent}
  });

  // Manage simultaneous requests. Request can actually do this natively with
  // its `pool` feature, but that can result in timeouts when a lot of requests
  // are queued up (which is likely here). This also lets us enforce short
  // break periods every few requests.

  let untilSleep = sleepEvery;
  let sleeping = false;
  function sleepIfNecessary () {
    if (sleeping || sleepEvery <= 0) return;

    if (untilSleep > 0) {
      untilSleep--;
    }

    if (untilSleep === 0) {
      sleep();
    }
  }

  function sleep (time = sleepFor) {
    sleeping = true;
    setTimeout(() => {
      sleeping = false;
      untilSleep = sleepEvery;
      doNextRequest();
    }, time);
  }

  let availableSockets = maxSockets;
  const queue = [];
  function doNextRequest () {
    if (availableSockets <= 0 || sleeping) return;

    const task = queue.shift();
    if (task) {
      availableSockets--;
      versionistaRequest(task.options, (error, response) => {
        availableSockets++;
        sleepIfNecessary();

        const badResponse = response && task.retryIf(response);

        if (error || badResponse) {
          // if the server hung up or was unhappy, take a break & try again
          const retryable = badResponse || error.code === 'ECONNRESET';
          if (retryable && task.retries < MAX_RETRIES) {
            task.retries += 1;
            queue.unshift(task);
            sleep(sleepFor * task.retries * 2);
          }
          else {
            task.reject(error);
          }
        }
        else {
          task.resolve(response);
        }

        // NOTE: do this *after* resolving so the resolver has an opportunity
        // queue an immediate next request first.
        process.nextTick(doNextRequest);
      });
    }
  }

  // By default, auto-retry on gateway errors
  const defaultRetryIf = r => (r.statusCode >= 502 && r.statusCode <= 504);

  return function (options) {
    return new Promise((resolve, reject) => {
      const task = {
        options: options,
        retries: (options.retry === false) ? MAX_RETRIES : 0,
        retryIf: options.retryIf || defaultRetryIf,
        resolve,
        reject
      };
      queue[options.immediate ? 'unshift' : 'push'](task);
      doNextRequest();
    });
  };
}

module.exports = createClient;
