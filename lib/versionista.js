'use strict';

const crypto = require('crypto');
const stream = require('stream');
const Entities = require('html-entities').AllHtmlEntities;
const jsdom = require('jsdom');
const unzip = require('unzip-stream');
const createClient = require('./client');
const flatten = require('./flatten');
const {xpath, xpathArray, xpathNode} = require('./xpath');

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
        const contentType = response.headers['content-type'] || '';
        const mightBeHtml = contentType.startsWith('text/html') ||
          !!response.body.toString().match(/^[\s\n]*</) ||
          response.body.toString() === '';

        if (options.parseBody && mightBeHtml) {
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
            id: parseVersionistaUrl(link.href).siteId,
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
   * @param {Boolean} [includeNonHtmlPages=true] Versionista sorts "pages" into
   *        high level types: HTML, Images, Scripts. If false, only get HTML.
   * @returns {Promise<VersionistaPage[]>}
   */
  getPages (siteUrl, includeNonHtmlPages = true) {
    if (includeNonHtmlPages) {
      return Promise.all([
        this.getPages(siteUrl, false),
        this.getPages(joinUrlPaths(siteUrl, 'catImages'), false),
        this.getPages(joinUrlPaths(siteUrl, 'catScripts'), false)
      ]).then(flatten);
    }

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
    const versionDataForRow = (versionRow) => {
      const dateNode = xpathNode(versionRow, "./td[2]//*[@class='gmt']");
      const linkNode = xpathNode(versionRow, "./td[2]/a");
      const date = new Date(1000 * parseFloat(dateNode.textContent));

      let url = linkNode && linkNode.href;
      let hasContent = !!url;
      if (!url) {
        const versionId = versionRow.id.match(/^version_([^_]+)/)[1];
        url = joinUrlPaths(pageUrl, versionId);
      }

      let errorCode;
      const errorCodeNotices = versionRow.querySelectorAll('.failpage');
      if (errorCodeNotices.length > 1) {
        throw new Error(`More than one error code for version "${url}"`);
      }
      else if (errorCodeNotices.length) {
        errorCode = errorCodeNotices[0].title.match(/:\s+(\d{3})\D/)[1];
      }

      return Object.assign(parseVersionistaUrl(url), {
        url,
        date,
        hasContent,
        errorCode
      });
    }

    function formatComparisonUrl(version, compareTo = {versionId: 0}) {
      return `https://versionista.com/${version.siteId}/${version.pageId}/${version.versionId}:${compareTo.versionId}`;
    }

    return this.request(pageUrl).then(window => {
      const versionRows = xpathArray(window.document, "//*[@id='pageTableBody']/tr");
      let oldestVersion;
      let previousVersion;

      return versionRows.reverse().map(row => {
        const version = versionDataForRow(row);
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
   * TODO: should return an object indicating type (so we can do correct file
   * extensions for PDF, mp4, etc.)
   * @param {String} versionUrl
   * @param {Number} retries Number of times to retry if there's a cache timeout
   * @returns {Promise<String|Buffer>}
   */
  getVersionRawContent (versionUrl, retries = 2) {
    // This is similar to getVersionDiffHtml, but we get to skip a step (yay!)
    // The "api" for this is available directly at versionista.com.
    const apiUrl = versionUrl.replace(
      /(versionista.com\/)(.*)$/,
      '$1api/ip_url/$2/html');

    return this.request({url: apiUrl, parseBody: false})
      .then(response => {
        if (response.statusCode >= 400) {
          const error = new Error(`Invalid version URL: '${versionUrl}'`);
          error.code = 'VERSIONISTA:INVALID_URL';
          throw error;
        }

        return this.request({
          url: response.body,
          // The URL from the API is time limited, so prioritize the request
          immediate: true,
          // A version may be binary data (for PDFs, videos, etc.)
          encoding: null,
          parseBody: false
        });
      })
      // The raw source is the text of the `<pre>` element. A different type of
      // result (called "safe" in versionista's API) gets us an actual webpage,
      // but it appears that the source there has been parsed, cleaned up
      // (made valid HTML), and had Versionista analytics inserted.
      .then(response => {
        // Sometimes a version may have no content (e.g. a page was removed).
        // This is OK.
        if (response.body.toString() === '') {
          return '';
        }
        // Are we dealing with HTML?
        else if (typeof response.body === 'string') {
          // we don't actually parse this content with JSDOM because it could be
          // big enough to consume all our available memory. Instead, do some
          // dumb, simplistic decoding.
          const openPreIndex = response.body.indexOf('<pre>');
          const closePreIndex = response.body.indexOf('</pre>', openPreIndex);
          if (openPreIndex > -1 && closePreIndex > -1) {
            const formattedContent = response.body.slice(
              openPreIndex + 5,
              closePreIndex);
            const encodedContent = formattedContent.replace(/<[^>]+>/g, '');
            const entities = new Entities();
            return entities.decode(encodedContent);
          }
          // Handle cache timeout (see note on temporary URLs above)
          else if (document.body.textContent.match(/cache expired/i) && retries) {
            return this.getVersionRawContent(versionUrl, retries - 1);
          }
        }
        else if (Buffer.isBuffer(response.body)) {
          return response.body;
        }

        // FAILURE!
        const error = new Error(`Can't find raw content for ${versionUrl}`);
        error.code = 'VERSIONISTA:NO_VERSION_CONTENT';
        error.urls = [versionUrl, apiUrl, response.request.uri.href];
        error.receivedContent = response.body;
        throw error;
      });
  }

  getVersionArchive (pageUrl) {
    const createArchiveUrl = joinUrlPaths(pageUrl, 'archive');
    return this.request({
      url: createArchiveUrl,
      parseBody: false,
      retryIf: response => response.statusCode !== 200
    })
      .then(response => {
        if (response.statusCode !== 200) {
          throw new Error(`Error creating archive for ${pageUrl}: ${response.body}`);
        }

        const startTime = Date.now();
        const pollForReadiness = (url, interval = 1 * 1000, maxTime = 5 * 60 * 1000) => {
          const cacheBreaker = `?${Math.random()}`;
          url = url + cacheBreaker;
          return this.request({url, method: 'HEAD', parseBody: false})
            .then(response => {
              if (response.statusCode === 200) {
                return true;
              }
              else if (Date.now() > startTime + maxTime) {
                throw new Error(`Timed out requesting archive for ${pageUrl}`);
              }
              else {
                return new Promise(resolve => {
                  setTimeout(
                    () => resolve(pollForReadiness(url, interval, maxTime)),
                    interval
                  );
                });
              }
            });
        };

        const archiveUrl = `https://s3.amazonaws.com/versionista-packs/${response.body}`;
        return pollForReadiness(archiveUrl)
          .then(() => this.request({
            url: archiveUrl,
            immediate: true,
            encoding: null,
            parseBody: false
          }))
          .then(response => response.body);
      });
  }

  /**
   * Returns a stream of *file* entry objects. These are basically `Entry`
   * objects from the `unzip-stream` library, with a few additions:
   * - {Date} date  A date object representing the parsed version capture date
   * - {String} extension  The file extension
   * - Emits a `hash` event with the file's SHA-256 hash as a buffer
   *
   * This conveniently also skips directory entries, as we don't ever expect
   * them to be present in Versionista archives.
   *
   * Note that you MUST either read the entirety of each entry object stream OR
   * call `.autodrain()` on it. Failure to do so could leave memory in a bad
   * state :(
   *
   * @param {String} pageUrl
   * @returns {Entry}
   */
  getVersionArchiveEntries (pageUrl) {
    const entryStream = new stream.PassThrough({objectMode: true});
    const parseArchiveEntryName = this.parseArchiveEntryName;

    // FIXME: should really stream from client
    this.getVersionArchive(pageUrl)
      .then(content => {
        // TODO: clean up all the error juggling here with pumpify
        const contentStream = new stream.PassThrough();
        contentStream.end(content);
        contentStream
          .pipe(unzip.Parse())
          .on('error', error => entryStream.emit('error', error))
          .pipe(stream.Transform({
            objectMode: true,
            transform: function (entry, encoding, callback) {
              if (entry.type === 'File') {
                Object.assign(entry, parseArchiveEntryName(entry.path))

                entry
                  .pipe(crypto.createHash('sha256'))
                  .on('data', hash => entry.emit('hash', hash));

                entry.pause();
                callback(null, entry);
              }
              else {
                entry.autodrain();
                callback();
              }
            }
          }))
          .on('error', error => entryStream.emit('error', error))
          .pipe(entryStream);
      })
      .catch(error => {
        process.nextTick(() => entryStream.emit('error', error));
      });

    return entryStream;
  }

  parseArchiveEntryName (fileName) {
    const [_, year, month, day, hour, minute, second, extension = ''] =
      fileName.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)[^\.]*(\..*)?$/);
    const isoDate = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    const date = new Date(isoDate);
    return {date, extension};
  }

  /**
   * Get information about a diff between two versions (including the diff
   * itself). Note this May return `null` if there is no diff (e.g. if
   * Versionista got no content/no response when it captured the version).
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
        const status = response.statusCode;

        // Bad comparison URLs usually redirect to normal Versionista pages
        if (status >= 400 || actualUri.host.includes('versionista.com')) {
          const error = new Error(`Invalid diff URL: '${diffUrl}'`);
          error.code = 'VERSIONISTA:INVALID_URL';
          throw error;
        }

        diffHost = `${actualUri.protocol}//${actualUri.host}`;
        return `${diffHost}/api/ip_url${actualUri.path}${diffType}`;
      })
      .then(apiUrl => this.request({
        url: apiUrl,
        parseBody: false,
        immediate: true
      }))
      // That API returns a URL for the actual diff content, so fetch that
      .then(response => {
        if (response.statusCode >= 400) {
          const error = new Error(
            `API Error from '${response.request.href}' (Diff URL: ${diffUrl}): ${response.body}`);
          error.code = 'VERSIONISTA:API_ERROR';
          throw error;
        }

        return this.request({
          url: `${diffHost}${response.body}`,
          parseBody: false,
          immediate: true
        });
      })
      .then(response => {
        // A diff can be empty in cases where the version was a removed page
        if (!response.body) {
          return null;
        }
        return {
          hash: hash(response.body || ''),
          length: response.body.length,
          content: response.body
        }
      });
  }
}

[
  'getSites',
  'getPages',
  'getVersions',
  'getVersionRawContent',
  'getVersionArchive',
  'getVersionDiff'
].forEach(method => {
  const implementation = Versionista.prototype[method];
  Versionista.prototype[method] = function () {
    return this.logIn().then(() => implementation.apply(this, arguments));
  }
});

function parseVersionistaUrl (url) {
  const ids = url.match(/^http(s?):\/\/[^\/]+\/(.*)$/)[2].split('/');
  return {
    siteId: ids[0],
    pageId: ids[1],
    versionId: ids[2] && ids[2].split(':')[0]
  };
}

function hash (text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function joinUrlPaths (basePath, ...paths) {
  return paths.reduce((finalPath, urlPath) => {
    const delimiter = finalPath.endsWith('/') ? '' : '/';
    return finalPath + delimiter + urlPath;
  }, basePath);
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
    const versionistaUrl = xpathNode(row, "./td[a][2]/a").href;

    return {
      id: parseVersionistaUrl(versionistaUrl).pageId,
      url: remoteUrl,
      versionistaUrl: versionistaUrl,
      title: xpathNode(row, "./td[a][3]").textContent.trim(),
      lastChange: updateTime
    };
  });
};

function versionDataFromLink (versionLink) {

}

module.exports = Versionista;
