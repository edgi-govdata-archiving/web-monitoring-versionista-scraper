'use strict';

require('../polyfill');
const {compareMany, ascend} = require('../tools');
const crypto = require('crypto');
// TODO: UUID assignment should happen independently of formatting
const uuid = require('../uuid.js');

const emptyHash = crypto.createHash('sha256').digest('hex');

module.exports = formatCsv;

/**
 * Converts scraped site data to CSV format.
 */
function formatCsv (sites, options = {}) {
  const versionType = options.versionType || 'versions';

  const rows = [];
  const headerRow = headers.slice();

  if (options.includeDiffs) {
    headerRow.push('Diff File');
    headerRow.push('Text Diff File');
  }
  if (options.includeContent) {
    headerRow.push('Version File');
    headerRow.push('Version Hash');
  }

  // TODO: this would be better as a flatmap
  sites.forEach(site => {
    site.pages && site.pages.forEach(page => {
      page[versionType] && page[versionType].forEach(version => {
        rows.push(rowForVersion(site, page, version, options));
      });
    });
  });

  return toCsvString([headerRow, ...(sortRows(rows))]);
};

const headers = [
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
  'Text Diff Length',
  'Text Diff Hash'
];

function rowForVersion (site, page, version, options) {
  const diff = version.diff || {};
  const textDiff = version.textDiff || {};

  const row = [
    '',
    uuid(),
    formatDate(new Date(), true),
    agencyForSite(site),
    site.name,
    page.title,
    page.url,
    page.versionistaUrl,
    version.diffWithPreviousSafeUrl || version.diffWithPreviousUrl || '[initial version]',
    version.diffWithFirstSafeUrl || version.diffWithFirstUrl || '[initial version]',
    formatDate(version.diffWithPreviousSafeDate || version.diffWithPreviousDate) || '[initial version]',
    formatDate(version.diffWithFirstSafeDate || version.diffWithFirstDate) || '[initial version]',
    diff.length,
    diff.hash !== emptyHash ? diff.hash : '',
    textDiff.length,
    textDiff.hash !== emptyHash ? textDiff.hash : ''
  ];

  if (options.includeDiffs) {
    row.push(version.diff ? version.diff.path : '');
    row.push(version.textDiff ? version.textDiff.path : '');
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
  if (!date) {
    return '';
  }

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
          if (result.includes(',') || result.includes('\n') || result.includes('"')) {
            result = `"${result.replace(/"/g, '""')}"`;
          }
          return result;
        })
        .join(',');
    })
    .join('\n');
}

// Standard comparator for sorting CSV output rows.
const compareRows =  compareMany(
  ascend(15),                   // text diff hash
  ascend(13),                   // source diff hash
  ascend(x => new Date(x[10]))  // capture time
);

function updateIndexColumn (value, index) {
  value[0] = index + 1;
  return value;
}

function sortRows (rows) {
  return rows
    .sort(compareRows)
    .map(updateIndexColumn);
}

formatCsv.headers = headers;
formatCsv.formatDate = formatDate;
formatCsv.toCsvString = toCsvString;
formatCsv.sortRows = sortRows;

