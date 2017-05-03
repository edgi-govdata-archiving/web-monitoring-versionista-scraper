'use strict';

require('../polyfill');
// TODO: UUID assignment should happen independently of formatting
const uuid = require('../uuid.js');

/**
 * Converts scraped site data to CSV format.
 */
module.exports = function formatCsv (sites, options = {}) {
  const rows = [[
    'Index',
    'UUID',
    'Output Date/Time',
    'Agency',
    'Site Name',
    'Page name',
    'URL',
    'Page View URL',
    'Last Two - Side by Side',
    'Latest to Base - Side by Side',
    'Date Found - Latest',
    'Date Found - Base',
    'Diff Length',
    'Diff Hash',
    'Account'
  ]];

  if (options.includeDiffs) {
    rows[0].push('Diff File');
  }
  if (options.includeContent) {
    rows[0].push('Version File');
    rows[0].push('Version Hash');
  }

  let index = 1;

  // TODO: this would be better as a flatmap
  sites.forEach(site => {
    site.pages && site.pages.forEach(page => {
      page.versions && page.versions.forEach(version => {
        rows.push(rowForVersion(site, page, version, options, index));
        index++;
      });
    });
  });

  return toCsvString(rows);
};

function rowForVersion (site, page, version, options, index) {
  const row = [
    index,
    uuid(),
    formatDate(new Date(), true),
    agencyForSite(site),
    site.name,
    page.title,
    page.url,
    page.versionistaUrl,
    version.diffWithPreviousUrl,
    version.diffWithFirstUrl,
    formatDate(version.diffWithPreviousDate),
    formatDate(version.diffWithFirstDate),
    version.diff && version.diff.length,
    version.diff && version.diff.hash,
    options.account
  ];

  if (options.includeDiffs) {
    if (version.diff) {
      row.push(version.diff.path);
    }
    else {
      row.push('');
    }
  }

  if (options.includeContent) {
    if (version.hasContent) {
      row.push(version.filePath);
    }
    else {
      row.push('');
    }
    row.push(version.hash || '');
  }

  return row;
}

function digits (number, length = 2, includeSign = false) {
  let sign = includeSign ? '+' : '';
  if (number < 0) {
    sign = '-';
    number = Math.abs(number);
  }
  return sign + number.toString(10).padStart(length, '0');
}

function formatDate (date, includeTimezone) {
  // Similar to ISO 8601
  // YYYY-MM-DD HH:MM:SS tz
  if (includeTimezone) {
    const offset = date.getTimezoneOffset();
    // Note flipped sign
    const tzHours = digits(-Math.floor(offset / 60), 2, true);
    const tzMinutes = digits(Math.abs(offset % 60));
    const tzString = `${tzHours}${tzMinutes}`;

    return date.getFullYear() +
      '-' +
      digits(date.getMonth() + 1) +
      '-' +
      digits(date.getDate()) +
      ' ' +
      digits(date.getHours()) +
      ':' +
      digits(date.getMinutes()) +
      ':' +
      digits(date.getSeconds()) +
      ' ' +
      tzString;
  }
  else {
    return date.getUTCFullYear() +
      '-' +
      digits(date.getUTCMonth() + 1) +
      '-' +
      digits(date.getUTCDate()) +
      ' ' +
      digits(date.getUTCHours()) +
      ':' +
      digits(date.getUTCMinutes()) +
      ':' +
      digits(date.getUTCSeconds());
  }
}

function agencyForSite (site) {
  return site.name.split('-')[0].trim();
}

// convert an array of rows to CSV data
function toCsvString (rows) {
  return rows
    .map(row => {
      return row
        .map(cell => {
          let result = '';
          if (cell != null) {
            result = cell.toString();
          }
          if (result.indexOf(',') > -1) {
            result = `"${result}"`;
          }
          return result;
        })
        .join(',');
    })
    .join('\n');
}
