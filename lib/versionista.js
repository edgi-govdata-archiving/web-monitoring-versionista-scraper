'use strict';

const csvParse = require('csv-parse');
const crypto = require('crypto');
const stream = require('stream');
const jsdom = require('jsdom');
const mime = require('mime-types');
const unzip = require('unzip-stream');
const util = require('util');
const createClient = require('./client');
const flatten = require('./flatten');
const {xpath, xpathArray, xpathNode} = require('./xpath');

const csvParsePromise = util.promisify(csvParse);

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
 * @property {Number} totalVersions
 */

/**
 * @typedef {Object} VersionistaVersion
 * @property {String} versionId
 * @property {String} pageId
 * @property {String} siteId
 * @property {String} url
 * @property {Date} date
 * @property {Boolean} hasContent
 * @property {Number} errorCode
 * @property {Date} lastDate
 * @property {Number} status
 * @property {Number} length
 * @property {String} contentType
 * @property {Number} loadTime
 * @property {Array<String>} redirects
 * @property {String} title
 * @property {String} [diffWithPreviousUrl]
 * @property {Date} [diffWithPreviousDate]
 * @property {String} [diffWithFirstUrl]
 * @property {Date} [diffWithFirstDate]
 * @property {String} [diffWithPreviousSafeUrl]
 * @property {Date} [diffWithPreviousSafeDate]
 * @property {String} [diffWithFirstSafeUrl]
 * @property {Date} [diffWithFirstSafeDate]
 */

/**
 * @typedef {Object} VersionistaDiff
 * @property {Number} length The length of the diff in characters
 * @property {String} hash A SHA 256 hash of the diff
 * @property {String} content The diff itself
 */

const versionistaSourceAdditionsPattern =
  /\n?<!--\s*Versionista general\s*-->[^]*?<!--\s*End Versionista general\s*-->\n?/i;

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
    this.client = createClient(options && options.client || {});
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
          const dom = new jsdom.JSDOM(response.body, {url: options.url});
          dom.window.httpResponse = response;
          dom.window.requestDate = new Date();
          return dom.window;
        }
        else if (options.stringifyHtml && mightBeHtml) {
          response.body = response.body.toString();
          return response;
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
   * @returns {Promise<VersionistaSite[]>}
   */
  getSites () {
    return this.request('https://versionista.com/home?show_all=1')
      .then(window => {
        const table = window.document.querySelector('.sorttable');
        if (!table) {
          throw new Error(`HTML for site listing has no table of sites`);
        }

        const rows = Array.from(
          window.document.querySelectorAll('.sorttable > tbody > tr'));

        return rows.map(row => {
          const link = row.querySelector('a.kwbase');
          // There's no longer any reliable class for "time since last change",
          // but it is the next cell from "new pages found".
          const updateElement = row.querySelector('.kwnewfound + td .h');
          let lastUpdateSecondsAgo = 0;
          if (updateElement) {
            lastUpdateSecondsAgo = parseFloat(updateElement.textContent);
          }
          else {
            // It appears that if there were no updates in the past year or so,
            // the `.h` element will be replaced with `.anev`. This is
            // imperfect, but basically just treat it as "1 year ago."
            if (row.querySelector('.kwnewfound + td .anev')) {
              lastUpdateSecondsAgo = 1000 * 60 * 60 * 24 * 365;
            }
            else {
              throw new Error('Could not find "since" field on the sites page.');
            }
          }

          return {
            id: parseVersionistaUrl(link.href).siteId,
            name: link.textContent.trim(),
            url: link.href,
            lastChange: (Number.isNaN(lastUpdateSecondsAgo))
              ? null
              : new Date(window.requestDate - lastUpdateSecondsAgo * 1000)
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
    const site = parseVersionistaUrl(siteUrl);

    // Versionista seems to be growing a bit of an API, but it may not be very
    // stable yet. Observed schema has a `data` property and `page` object:
    const apiSiteDataSchema = {
      // Title of the page.
      title_alt: 'string',
      // Base URL for the site. May be needed to combine with a page's URL to
      // form a complete URL for the page.
      base: 'string',
      // Unknown.
      folder: 'number',
      // Status. Not sure on possible values, see the page schema as a guide.
      st: 'string',
      // ID of the site.
      id: 'string',
      // Any additional notes.
      notes: 'string'
    };
    const apiPageSchema = {
      // Title of page. Only present if the page is not new and a title could
      // be parsed from the content.
      title: 'string?',
      // Array of string flags. Not sure what all the possible values are. May
      // be an empty array, but always present.
      flags: 'array',
      // URL of page. May be a complete URL or may just be a path that you must
      // combine with the site's `base` property.
      url: 'string',
      // Date last checked as Unix timestamp (seconds since seconds since
      // Jan 01 1970, UTC). Not present for "new" pages.
      lchk: 'number?',
      // Not sure what this is. We've never seen it absent and it's always 1.
      beacon: 'number',
      // Number of versions of the page. May be 0, but never absent.
      vers: 'number',
      // ID of the page.
      id: 'string',
      // Status of the page. Known possible values:
      // - `A` (added and actively monitored)
      // - `I` (paused but previously monitored)
      // - `N` (newly detected but not actively monitored)
      // Most of the optional values in this schema are present for A and I,
      // but not for N.
      st: 'string',
      // Date added as a Unix timestamp.
      added: 'number',
      // Mime type. Always present, but may be an empty string.
      mime: 'string',
      // ID of latest version of the page.
      cur_ver: 'number',
      // Not sure what this is. If present, it's always 1.
      seenlast: 'number?',
      // Date of the latest version of the page as Unix timestamp.
      lnew: 'number?'
    };

    const apiUrl = `https://versionista.com/api/site/${site.siteId}/`;
    return this.request({url: apiUrl, json: true}).then(response => {
      const apiData = response.body;
      if (Array.isArray(apiData)) {
        throw new Error(`Response from page listing API was not a JSON object: ${apiUrl}`);
      }
      if (!apiData.data || !apiData.pages) {
        throw new Error(`Response from page listing API did not have 'data' and 'pages' properties: ${apiUrl}`);
      }
      if (Array.isArray(apiData.pages)) {
        throw new Error(`The 'pages' property in the page listing API was not an object: ${apiUrl}`);
      }

      const siteBase = apiData.data.base;
      // TODO: once we are reasonably confident in the schema, just assert on
      // the first item for performance.
      return Object.entries(apiData.pages).map(([id, apiPage]) => {
        assertSchema(
          apiPageSchema,
          apiPage,
          `Page does not match expected schema. ID: ${id}, URL: ${apiUrl}, $ERROR`);

        let remoteUrl = apiPage.url;
        if (!/^\w+:\/\//.test(remoteUrl)) {
          remoteUrl = siteBase + remoteUrl;
        }

        return {
          id: apiPage.id,
          url: remoteUrl,
          versionistaUrl: `https://versionista.com/${site.siteId}/${apiPage.id}/`,
          title: apiPage.title,
          lastChange: apiPage.lnew && new Date(apiPage.lnew * 1000),
          lastChecked: apiPage.lchk && new Date(apiPage.lchk * 1000),
          dateAdded: new Date(apiPage.added * 1000),
          totalVersions: apiPage.vers
        };
      });
    });


  }

  /**
   * Get an array of versions (in ascending order by date) for a given page.
   * @param {String} pageUrl URL of page details page on Versionista
   * @returns {Promise<VersionistaVersion[]>}
   */
  getVersions (pageUrl) {
    const page = parseVersionistaUrl(pageUrl);

    /**
     * Versionista seems to be growing a bit of an API, but it may not be very
     * stable yet. Observed schema for versions:
     * {
     * stored: boolean,      // Whether the content is stored and available
     * rc: string,           // Response code as text, e.g. '200 OK'
     * seen: number,         // Optional; Unix epoch time when page was viewed on Versionista, e.g. 1491736083
     * render_stamp: number, // Optional; don't know what this is! Looks like a timestamp, maybe of when the screenshot was rendered? e.g. 1485722161687
     * final_url: string,    // Only present on redirects. This is the final target URL of the redirect.
     * size: number,         // Size of response in bytes.
     * fst: number,          // Unix epoch time when version was first captured
     * protected: boolean,   // Whether the version is protected from deletion on Versionista
     * content_type: string, // Content-type header from response, e.g. 'text/html'
     * lst: number,          // Unix epoch time when version was last captured, e.g. 1485722160
     * id: number,           // ID of Version on Versionista, e.g. 9651274
     * title: string,        // Title of page
     * beacon: number        // Don't know what this is! Appears to always be 0 or 1.
     * }
     */
    const apiVersionSchema = {
      rc: 'string',
      size: 'number',
      fst: 'number',
      content_type: 'string',
      lst: 'number',
      id: undefined,
      // Only present if true
      stored: 'boolean?',
      seen: 'number?',
      title: 'string?'
    };
    const versionsApiUrl = `https://versionista.com/api/versions/${page.siteId}/${page.pageId}`;
    return this.request({url: versionsApiUrl, json: true}).then(response => {
      const apiVersions = response.body;
      if (!Array.isArray(apiVersions)) {
        throw new Error(`Response from version listing API was not a JSON array: ${versionsApiUrl}`)
      }
      // TODO: once we are reasonably confident in the schema, just assert on
      // the first item for performance.
      // if (apiVersions.length) {
      //   assertSchema(apiVersionSchema, apiVersions[0]);
      // }

      let oldestVersion;
      let previousVersion;
      let oldestSafeVersion;
      let previousSafeVersion;
      return apiVersions
        // The API appears to return metadata for old, deleted records (!) but
        // that metadata is ultra-limited and I'm not sure how/if to use it
        // effectively yet. We didn't have this before, so drop it for now.
        // FIXME: keep this data (we might need a different schema for it)
        .filter(version => !version.deleted)
        .map((apiVersion, index) => {
          assertSchema(
            apiVersionSchema,
            apiVersion,
            `Version does not match expected schema. Index: ${index}, URL: ${versionsApiUrl}`);

          // This is a string like '200 OK', so we can safely parse the code
          // off the front of it.
          const status = parseInt(apiVersion.rc, 10);
          if (isNaN(status)) {
            throw new Error(`Could not parse status code from version. String: '${apiVersion.rc}', ${index}, URL: ${versionsApiUrl}`);
          }

          return Object.assign({}, page, {
            versionId: apiVersion.id,
            url: `https://versionista.com/${page.siteId}/${page.pageId}/${apiVersion.id}/`,
            date: new Date(apiVersion.fst * 1000),
            hasContent: apiVersion.stored,
            // Because of historical fun, errorCode is a string and only present
            // if it was an error status code.
            errorCode: (status && status >= 400) ? status.toString(10) : null,
            lastDate: new Date(apiVersion.lst * 1000),
            status: status,
            length: apiVersion.size,
            contentType: apiVersion.content_type,
            redirects: apiVersion.final_url ? [apiVersion.final_url] : null,
            title: apiVersion.title
            // NOTE: the CSV has load timing, which the API does not. That's the
            // only missing piece, though. Is it worth fetching the CSV for that?
            // loadTime: csvRow.load_time
          });
        })
        .reverse()
        .map(version => {
          // Create links and diff info for previous and first versions
          if (previousVersion) {
            version.diffWithPreviousUrl = formatComparisonUrl(version, previousVersion);
            version.diffWithPreviousDate = version.date;
            version.diffWithFirstUrl = formatComparisonUrl(version, oldestVersion);
            version.diffWithFirstDate = oldestVersion.date;

            if (previousSafeVersion && previousSafeVersion !== previousVersion) {
              version.diffWithPreviousSafeUrl = formatComparisonUrl(version, previousSafeVersion);
              version.diffWithPreviousSafeDate = version.date;
              version.diffWithFirstSafeUrl = formatComparisonUrl(version, oldestSafeVersion);
              version.diffWithFirstSafeDate = oldestSafeVersion.date;
            }
          }
          else {
            oldestVersion = version;
          }

          previousVersion = version;
          if (!version.errorCode) {
            previousSafeVersion = version;
            oldestSafeVersion = oldestSafeVersion || version;
          }

          return version;
        });
    });

    // FIXME: this code is unreachable now, and we may want to excise it or
    // split it out so it can be used as a fallback somehow.
    const versionDataForRow = (versionRow) => {
      const linkNode = xpathNode(versionRow, "./td[2]/a");
      let url = linkNode && linkNode.href;
      const hasContent = !!url;
      if (!url) {
        const versionId = versionRow.id.match(/^version_([^_]+)/)[1];
        url = joinUrlPaths(pageUrl, versionId);
      }

      const dateNode = xpathNode(versionRow, "./td[2]//*[@class='gmt']");
      if (!dateNode) {
        throw new Error(`Could not find date field for version "${url}"`);
      }
      const timestamp = 1000 * parseFloat(dateNode.textContent);
      const date = Number.isNaN(timestamp) ? null : new Date(timestamp);

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
      return `https://versionista.com/${version.siteId}/${version.pageId}/${version.versionId}:${compareTo.versionId}/`;
    }

    function getVersionCsvUrl(page) {
      return `https://versionista.com/download/page-${page.siteId}-${page.pageId}.csv`;
    }

    function parseVersionsCsv(csvString) {
      return csvParsePromise(csvString.toString(), {
        cast: true,
        cast_date: true,
        columns (names) {
          // lower-case, replace spaces with `_`, remove parentheticals:
          // 'Load time' -> 'load_time'
          const result = names.map(name =>
            name.toLowerCase().replace(/\s+\(.+?\)/g, '').replace(/\s/g, '_'));

          // Validate
          const columns = [
            'first_seen',
            'last_seen',
            'response_code',
            'size',
            'mime_type',
            'load_time',
            'redirected_to'
          ];
          columns.forEach(name => {
            if (!result.includes(name)) throw new Error(`Page CSV is missing required columns: ${columns.join(', ')}`);
          });

          return result;
        }
      });
    }

    const versionsFromPage = this.request(pageUrl).then(window => {
      const table = window.document.getElementById('pageTableBody');
      if (!table) {
        throw new Error(`HTML for page ${pageUrl} has no versions table`);
      }

      const versionRows = Array.from(table.querySelectorAll('tr.version'));
      let oldestVersion;
      let previousVersion;
      let oldestSafeVersion;
      let previousSafeVersion;

      return versionRows.reverse().map(row => {
        const version = versionDataForRow(row);

        // Create links and diff info for previous and first versions
        if (previousVersion) {
          version.diffWithPreviousUrl = formatComparisonUrl(version, previousVersion);
          version.diffWithPreviousDate = version.date;
          version.diffWithFirstUrl = formatComparisonUrl(version, oldestVersion);
          version.diffWithFirstDate = oldestVersion.date;

          if (previousSafeVersion && previousSafeVersion !== previousVersion) {
            version.diffWithPreviousSafeUrl = formatComparisonUrl(version, previousSafeVersion);
            version.diffWithPreviousSafeDate = version.date;
            version.diffWithFirstSafeUrl = formatComparisonUrl(version, oldestSafeVersion);
            version.diffWithFirstSafeDate = oldestSafeVersion.date;
          }
        }
        else {
          oldestVersion = version;
        }

        previousVersion = version;
        if (!version.errorCode) {
          previousSafeVersion = version;
          oldestSafeVersion = oldestSafeVersion || version;
        }

        return version;
      });
    });

    const csvMetadata = this.request({url: getVersionCsvUrl(page), parseBody: false})
      .then(response => parseVersionsCsv(response.body))
      .then(csv => {
        // Create timestamp lookup for CSV data (the CSVs have no IDs)
        const csvByDate = new Map();
        csv.forEach(row => csvByDate.set(row.first_seen.getTime(), row));
        return csvByDate;
      });

    // Combine in-page and CSV-based data
    return Promise.all([versionsFromPage, csvMetadata])
      .then(([versions, csv]) => {
        return versions.map(version => {
          const csvRow = csv.get(version.date.getTime());
          if (!csvRow) {
            throw new Error(`No CSV row for version '${version.siteId}/${version.pageId}/${version.versionId}'`);
          }

          Object.assign(version, {
            lastDate: csvRow.last_seen,
            status: parseInt(csvRow.response_code, 10),
            length: csvRow.size,
            contentType: csvRow.mime_type,
            loadTime: csvRow.load_time,
            redirects: csvRow.redirected_to ? [csvRow.redirected_to] : null,
            title: csvRow.title || null
          });

          return version;
        });
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
      '$1api/ip_url/$2/raw');

    return this.request({url: apiUrl, parseBody: false})
      .then(response => {
        if (response.statusCode >= 400) {
          const error = new Error(`Invalid version URL: '${versionUrl}'`);
          error.code = 'VERSIONISTA:INVALID_URL';
          throw error;
        }

        let rawUrl = response.body;
        if (!/^https?:\/\//.test(rawUrl)) {
          rawUrl = `https://versionista.com${rawUrl}`;
        }

        return this.request({
          url: rawUrl,
          // The URL from the API is time limited, so prioritize the request
          immediate: true,
          // A version may be binary data (for PDFs, videos, etc.)
          encoding: null,
          parseBody: false,
          stringifyHtml: true
        });
      })
      // The raw source is the text of the `<pre>` element. A different type of
      // result (called "safe" in versionista's API) gets us an actual webpage,
      // but it appears that the source there has been parsed, cleaned up
      // (made valid HTML), and had Versionista analytics inserted.
      .then(response => {
        let mimeExtension = mime.extension(response.headers['content-type']);
        const buildResult = (extras) => {
          const result = Object.assign({
            headers: response.headers,
            body: response.body,
            extension: mimeExtension ? `.${mimeExtension}` : ''
          }, extras);
          result.hash = hash(result.body);
          result.length = Buffer.byteLength(result.body, 'utf8');
          return result;
        };

        // Sometimes a version may have no content (e.g. a page was removed).
        // This is OK.
        if (response.body.toString() === '') {
          return buildResult({body: ''});
        }
        // Are we dealing with HTML?
        else if (typeof response.body === 'string') {
          let source = response.body;

          if (/^<h\d>Cache expired<\/h\d>/i.test(source)) {
            // fall through to the error if there are no more retries
            if (retries) {
              return this.getVersionRawContent(versionUrl, retries - 1);
            }
          }
          else {
            // For some reason Versionista seems to insert some blank lines
            if (source.startsWith('\n\n\n')) {
              source = source.slice(3);
            }
            // Clear out Versionista additions (even though there's nothing
            // actually between these comments in `raw` responses).
            source = source.replace(versionistaSourceAdditionsPattern, '');

            return buildResult({body: source});
          }
        }
        else if (Buffer.isBuffer(response.body)) {
          return buildResult({body: response.body});
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
  getVersionDiff (diffUrl, diffType) {
    diffType = diffType || 'only';
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
        return `${diffHost}/api/ip_url${actualUri.pathname}${diffType}${actualUri.search || ''}`;
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

        let finalUrl = response.body;
        if (!/^http(s)?:\/\//.test(response.body)) {
          finalUrl = `${diffHost}${response.body}`;
        }

        return this.request({
          url: finalUrl,
          parseBody: false,
          immediate: true
        });
      })
      .then(response => {
        // A diff can be empty in cases where the version was a removed page
        if (!response.body) {
          return null;
        }

        // Make hashes better for comparison by removing Versionista-specific
        // metadata, scripting and styling
        let hashableBody = response.body || '';
        if (typeof hashableBody === 'string') {
          hashableBody = hashableBody
            .replace(versionistaSourceAdditionsPattern, '')
            .trim();
        }

        return {
          hash: hash(hashableBody),
          length: hashableBody.length,
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

function versionDataFromLink (versionLink) {

}

function oneLine (string) {
  return string.replace(/\n\s+/g, ' ');
}

/**
 * Asserts that an object implements a given schema or throws an error if not.
 * The types are always strings (similar to those returned by `typeof`, but
 * can differentiate 'object' and 'array'). If the type ends with '?', it will
 * only be checked if the property is present. If the type is null or
 * undefined, then the presence of the property, but not its type, will be
 * checked. The schema defines a minimum set of properties that the object must
 * support -- the object can have other properties not present in the schema.
 * @param {object} schema An object mapping keys to types, e.g.
 *        `{name: 'string', age: 'number'}`
 * @param {any} object Object that is expected to implement the schema
 * @param {string} [message] Optional message for the error that will be thrown
 *        if the schema does not match. If the message has the text '$ERROR',
 *        '$ERROR' will be replaced with detailed information.
 */
function assertSchema(schema, object, message = null) {
  const keys = [
    ...Object.getOwnPropertyNames(schema),
    ...Object.getOwnPropertySymbols(schema)
  ];

  keys.forEach(key => {
    let type = schema[key];
    let optional = false;
    if ((typeof type === 'string') && type.endsWith('?')) {
      optional = true;
      type = type.slice(0, -1);
    }

    if (!(key in object)) {
      if (optional) return;

      const error = `Object is missing property '${key}'`;
      throw new Error(message ? message.replace('$ERROR', error) : error);
    }

    if (type && !isType(object[key], type)) {
      const error = `The '${key}' property of object was not a ${type}`;
      throw new Error(message ? message.replace('$ERROR', error) : error);
    }
  });
}

/**
 * Check whether a value is of a given type. This can handle more types than
 * 'typeof' can (it differentiates 'array' and 'object', for example).
 * @param {any} value Value to check type of.
 * @param {string} type Name of type to check that value is.
 * @returns {boolean}
 */
function isType(value, type) {
  if (type === 'array') return Array.isArray(value);
  else if (type === 'object' && Array.isArray(value)) return false;
  return typeof value === type;
}

module.exports = Versionista;
