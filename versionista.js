'use strict';

const crypto = require('crypto');
const request = require('request');
const jsdom = require('jsdom');

const MAX_SOCKETS = 6;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36';
const SLEEP_EVERY = 30;
const SLEEP_FOR = 10000;

/**
 * @typedef {Object} VersionistaSite
 * @property {String} name
 * @property {String} url
 * @property {Date} lastChange
 */

/**
 * @typedef {Object} VersionistaPage
 * @property {String} url
 * @property {String} versionistaUrl
 * @property {String} title
 * @property {Date} lastChange
 */

/**
 * @typedef {Object} VersionistaVersion
 * @property {String} versionId
 * @property {String} pageId
 * @property {String} siteId
 * @property {String} url
 * @property {Date} date
 * @property {String} [diffWithPreviousUrl]
 * @property {Date} [diffWithPreviousDate]
 * @property {String} [diffWithFirstUrl]
 * @property {Date} [diffWithFirstDate]
 */

/**
 * @typedef {Object} VersionistaDiff
 * @property {Number} length The length of the diff in characters
 * @property {String} hash A SHA 256 hash of the diff
 * @property {String} content The diff itself
 */

/**
 * Provides access to data from a Versionista account.
 */
class Versionista {
  /**
   * Creates an instance of Versionista.
   * @param {Object} options
   * @param {String} options.email E-mail for Versionista account
   * @param {String} options.password Password for Versionista account
   */
  constructor (options) {
    this.client = createClient();
    this.logIn = this.logIn.bind(this, options.email, options.password);
  }

  /**
   * Make an HTTP request to Versionista. This is largely a wrapper around
   * the request module, but returns a promise and can optionally parse the
   * result with JSDOM.
   * @param {Object|String} options The URL to get or a `request` options Object
   * @param {Boolean} [options.parseBody=true] If true, return a JSDom widow
   *        object instead of a HTTP response. The window will have two
   *        additional properties:
   *        - httpResponse: The response object
   *        - requestDate: A date object representing when the request was made
   * @returns {Promise<HttpResponse|Window>}
   */
  request (options) {
    if (typeof options === 'string') {
      options = {url: options};
    }

    if (!('parseBody' in options)) {
      options.parseBody = true;
    }

    return this.client(options)
      .then(response => {
        if (options.parseBody) {
          return new Promise((resolve, reject) => {
            jsdom.env({
              html: response.body,
              url: options.url,
              done: (error, window) => {
                if (error) {
                  return reject(error);
                }
                window.httpResponse = response;
                window.requestDate = new Date();
                resolve(window);
              }
            });
          });
        }
        else {
          return response;
        }
      });
  }

  /**
   * Log in to Versionista.
   * @returns {Promise}
   */
  logIn (email, password) {
    if (!this._loggedIn) {
      this._loggedIn = this.request({
        url: 'https://versionista.com/login',
        method: 'POST',
        form: {em: email, pw: password},
        followRedirect: false
      })
        .then(window => {
          if (window.httpResponse.body.match(/log in/i)) {
            const infoNode = window.document.querySelector('.alert');
            const details = infoNode ? ` (${infoNode.textContent.trim()})` : '';
            throw new Error(`Could not log in${details}`);
          }
        });
    }
    return this._loggedIn;
  }

  /**
   * Get an array of the sites in the Versionista Account.
   * @returns {Promise<VersionistaSite[]>
   */
  getSites () {
    return this.request('https://versionista.com/home?show_all=1')
      .then(window => {
        const rows = Array.from(
          window.document.querySelectorAll('.sorttable > tbody > tr'));

        return rows.map(row => {
          const link = row.querySelector('a.kwbase');
          const lastUpdateSecondsAgo = parseFloat(
            row.querySelector('.kwlastChange').textContent);

          return {
            name: link.textContent.trim(),
            url: link.href,
            lastChange: new Date(window.requestDate - lastUpdateSecondsAgo * 1000)
          };
        });
      });
  }

  /**
   * Get an array of tracked pages for a given site.
   * @param {String} siteUrl URL of site page on Versionista
   * @returns {Promise<VersionistaPage[]>}
   */
  getPages (siteUrl) {
    return this.request(siteUrl).then(window => {
      const pagingUrls = getPagingUrls(window);

      let allPages = [getPageDetailData(window)];
      allPages = allPages.concat(pagingUrls.slice(1).map(pageUrl => {
        return this.request(pageUrl).then(getPageDetailData);
      }));

      return Promise.all(allPages).then(flatten);
    });
  }

  /**
   * Get an array of versions (in ascending order by date) for a given page.
   * @param {String} pageUrl URL of page details page on Versionista
   * @returns {Promise<VersionistaVersion[]>}
   */
  getVersions (pageUrl) {
    const versionDataForLink = (versionLink) => {
      const date = new Date(1000 * parseFloat(versionLink.textContent));
      const url = versionLink.href;
      return Object.assign(parseVersionistaUrl(url), {
        url,
        date
      });
    }

    function formatComparisonUrl(version, compareTo = {versionId: 0}) {
      return `https://versionista.com/${version.siteId}/${version.pageId}/${version.versionId}:${compareTo.versionId}`;
    }

    return this.request(pageUrl).then(window => {
      const versionLinks = xpathArray(window.document, "//*[@id='pageTableBody']/tr/td[2]/a");
      let oldestVersion;
      let previousVersion;

      return versionLinks.reverse().map(link => {
        const version = versionDataForLink(link);
        if (previousVersion) {
          version.diffWithPreviousUrl = formatComparisonUrl(version, previousVersion);
          version.diffWithPreviousDate = version.date;
          version.diffWithFirstUrl = formatComparisonUrl(version, oldestVersion);
          version.diffWithFirstDate = oldestVersion.date;
        }
        else {
          oldestVersion = version;
        }
        previousVersion = version;
        return version;
      });

      return
    });
  }

  /**
   * Get the raw content of a given version of an HTML page.
   * @param {String} versionUrl
   * @returns {Promise<String>}
   */
  getVersionRawContent (versionUrl) {
    // This is similar to getVersionDiffHtml, but we get to skip a step (yay!)
    // The "api" for this is available directly at versionista.com.
    const apiUrl = versionUrl.replace(
      /(versionista.com\/)(.*)$/,
      '$1api/ip_url/$2/html');

    return this.request({url: apiUrl, parseBody: false})
      .then(response => this.request(response.body))
      // The raw source is the text of the `<pre>` element. A different type of
      // result (called "safe" in versionista's API) gets us an actual webpage,
      // but it appears that the source there has been parsed, cleaned up
      // (made valid HTML), and had Versionista analytics inserted.
      .then(window => window.document.querySelector('pre').textContent);
  }

  /**
   * Get information about a diff between two versions
   * (including the diff itself)
   * @param {String} diffUrl
   * @param {string} [diffType='only']
   * @returns {Promise<VersionistaDiff>}
   */
  getVersionDiff (diffUrl, diffType = 'only') {
    // This is a little bit of a tortured procedure:
    // The diff URL (e.g. https://versionista.com/74273/6221569/10485802:0/)
    // redirects to another domain that holds the diff content, like:
    // http://52.90.238.162/pa/FzGDbLeKO8hXqBifWxAukL69cLIjxUaqXL3Y6xMrRf9bgM12mizFDCWhwvDGBFSI/
    let diffHost;
    return this.request({url: diffUrl, parseBody: false})
      // On the diff host, there is an API that serves URLs for types of diffs:
      // http://{host}/api/ip_url/{path of diff page}/{diff type}
      // - edits: "rendered: single page" in UI
      // - screenshots: "rendered: screenshots" in UI
      // - html: "source: formatted" in UI
      // - filtered: "source: filtered" in UI
      // - only: "source: changes only" in UI (this is the default for us)
      // - text: "text" in UI
      // - text_only: "text: changes only" in UI
      .then(response => {
        const actualUri = response.request.uri;
        diffHost = `${actualUri.protocol}//${actualUri.host}`;
        return `${diffHost}/api/ip_url${actualUri.path}${diffType}`;
      })
      .then(apiUrl => this.request({url: apiUrl, parseBody: false}))
      // That API returns a URL for the actual diff content, so fetch that
      .then(response => this.request({url: `${diffHost}${response.body}`, parseBody: false}))
      // .then(response => ({
      //   hash: hash(response.body),
      //   length: response.body.length,
      //   content: response.body
      // }));
      .then(response => {
        if (!response.body) {
          console.error("UOHHHHH!!!", diffUrl);
        }
        return {
          hash: hash(response.body),
          length: response.body.length,
          content: response.body
        }
      });
  }
}

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
    if (sleepEvery <= 0) return;

    if (untilSleep > 1) {
      untilSleep--;
    }
    else if (untilSleep === 0) {
      sleeping = true;
      setTimeout(() => {
        sleeping = false;
        untilSleep = sleepEvery;
        doNextRequest();
      }, sleepFor);
    }
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
        process.nextTick(doNextRequest);

        if (error) {
          task.reject(error);
        }
        else {
          task.resolve(response);
        }
      });
    }
  }

  return function (options) {
    return new Promise((resolve, reject) => {
      queue.push({
        options: options,
        resolve,
        reject
      });
      doNextRequest();
    });
  };
}

function parseVersionistaUrl (url) {
  const ids = url.match(/^http(s?):\/\/[^\/]+\/(.*)$/)[2].split('/');
  return {
    siteId: ids[0],
    pageId: ids[1],
    versionId: ids[2] && ids[2].split(':')[0]
  };
}

function flatten (array) {
  return array.reduce((flattened, item) => flattened.concat(item), []);
}

function hash (text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function xpath (node, expression) {
  const document = node.nodeType === node.DOCUMENT_NODE ? node : node.ownerDocument;
  const type = document.defaultView.XPathResult.ORDERED_NODE_ITERATOR_TYPE;
  const iterator = document.evaluate(expression, node, null, type, null);
  iterator.map = function (transform) {
    let item;
    let result = [];
    while (item = iterator.iterateNext()) {
      result.push(transform(item));
    }
    return result;
  }
  return iterator;
}

function xpathArray (node, expression) {
  return xpath(node, expression).map(item => item);
}

function xpathNode (node, expression) {
  const iterator = xpath(node, expression);
  return iterator.iterateNext();
}

function promisedInput (func) {
  return function () {
    return Promise.all(Array.from(arguments).map(Promise.resolve))
      .then(resolvedArgs => func.apply(this, resolvedArgs))
  }
}

function getPagingUrls (window) {
  return Array.from(window.document.querySelectorAll('.pagination li a'))
    // The first and last links are "previous" / "next", so drop them
    .slice(1, -1)
    .map(link => link.href)
};

function getPageDetailData (window) {
  const xpathRows = xpath(window.document, "//div[contains(text(), 'URL')]/../../../following-sibling::tbody/tr");
  return xpathRows.map(row => {
    const updateTimeText = parseFloat(xpathNode(row, "./td[9]").textContent.trim());
    const updateTime = new Date(1000 * updateTimeText);
    const remoteLink = xpathNode(row, "./td[a][1]/a").href;
    // NOTE: the URL is not encoded here (!)
    const remoteUrl = remoteLink.slice(remoteLink.indexOf('?') + 1);

    return {
      url: remoteUrl,
      versionistaUrl: xpathNode(row, "./td[a][2]/a").href,
      title: xpathNode(row, "./td[a][3]").textContent.trim(),
      lastChange: updateTime
    };
  });
};

function versionDataFromLink (versionLink) {

}

module.exports = Versionista;
