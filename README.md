[![Code of Conduct](https://img.shields.io/badge/%E2%9D%A4-code%20of%20conduct-blue.svg?style=flat)](https://github.com/edgi-govdata-archiving/overview/blob/master/CONDUCT.md)

⚠️ **This project is no longer maintained or supported.** ⚠️ EDGI no longer uses it for any ongoing work, and it depends on other no-longer-supported tools. If you are interested in learning more about it, are forking it and need help, or otherwise trying to make use of this project, please post an issue on the main [Web Monitoring Project](https://github.com/edgi-govdata-archiving/web-monitoring).


# web-monitoring-versionista-scraper (Deprecated)

This is a version of [versionista-outputter](https://github.com/edgi-govdata-archiving/versionista-outputter) that has been rewritten in Node.js and JSDom.

Why? Speed is important here. Scraping Versionista can take a *long* time. We don’t need the overhead of a browser (like loading and executing images, CSS, and JavaScript) because all the necessary content is in the inital HTML payload. Parallelizing operations is also a little easier (for me, at least) in Node than in Ruby—and we absolutely ought to be doing more in parallel.


## Installation

You’ll need Node.js. Then you should be able to globally install this with:

```sh
$ npm install -g https://github.com/edgi-govdata-archiving/web-monitoring-versionista-scraper.git
```

Then run it like so:

```sh
$ scrape-versionista --email EMAIL --password PASSWORD --after '2017-03-22' --format csv --output './scrape/versions.csv'
```

You can also split output into multiple files (by site) with the `--group-by-site` option:

```sh
$ scrape-versionista --email EMAIL --password PASSWORD --after '2017-03-22' --format csv --output './scrape/versions.csv' --group-by-site
```

Alternatively, you can clone this repo, then:

```sh
$ yarn install
# Or if you don't have yarn:
$ npm install

# And run it:
$ ./bin/scrape-versionista --email EMAIL --password PASSWORD --after '2017-03-22' --format csv --output './scrape/versions.csv'
```


## Usage

This has the same basic capabilities as `versionista-outputter`, but can also save the versioned HTML (and diffs).

For basic info:

```sh
$ scrape-versionista --help
```

### Options

- `--email STRING` **Required!** The E-mail address of Versionista Account. You can also use an env var instead: `VERSIONISTA_EMAIL`

- `--password STRING` **Required!** The password of Versionista Account. You can also use an env var instead: `VERSIONISTA_PASSWORD`

- `--after DATE|HOURS` Only check versions captured after this date. It can be an ISO 8601 date string like `2017-03-01T00:00:00Z` or a number, representing hours before the current time.

- `--before DATE|HOURS` Only check versions captured before this date. It can be an ISO 8601 date string like `2017-03-01T00:00:00Z` or a number, representing hours before the current time.

- `--format FORMAT` The output format. One of: `csv`, `json`, `json-stream`. [default: `json`]

- `--output FILEPATH` Write output to this file instead of directly to your console on stdout.

- `--save-content` If set, the raw HTML of each captured version will also be saved. Files are written to the working directory or, if `--output` is specified, the same directory as the output file.

- `--save-diffs` If set, the HTML of diffs between a version and its previous version will also be saved. Files are written to the working directory or, if `--output` is specified, the same directory as the output file.

- `--latest-version-only` If set, only the latest version (of the versions matching --after/--before times) for each page is captured.

- `--group-by-site` If set, a separate output file will be generated for each site. Files are placed in the same directory as `--output`, so the actual filename specified in `--output` will never be created.


## Examples

ALL the options!

```sh
$ scrape-versionista --email 'somebody@somewhere.com' --password somepassword --after '2017-02-01' --before '2017-03-01' --format csv --output './scrape/versions.csv' --save-content --save-diffs
```

Use environment variables for credentials:

```sh
$ export VERSIONISTA_EMAIL='somebody@somewhere.com'
$ export VERSIONISTA_PASSWORD=somepassword
$ scrape-versionista --after '2017-02-01' --before '2017-03-01' --format csv --output './scrape/versions.csv' --save-content --save-diffs
```

Specifying time as hours ago instead of a date:

```sh
# Starting 5 hours ago
$ scrape-versionista --after 5
# Decimals are accepted, so you can start 30 minutes ago, too
$ scrape-versionista --after 0.5
```


## Other Scripts

The `bin` directory contains several other scripts besides `scrape-versionista`. They’re all closely related and perform helper tasks that are important in EDGI’s workflow around Versionista. **You can use the `--help` option with all of them** to see details about arguments, options, and usage.

- `scrape-versionista-and-email` runs `scrape-versionista`, then compresses the results into a single `.tar.gz` archive and e-mails them to a specified address.

- `scrape-versionista-and-upload` runs `scrape-versionista`, uploads the resulting files to Amazon S3 and Google Cloud Storage, and finally imports them into an instance of [web-monitoring-db][].

- `upload-to-google` uploads a directory’s contents to Google Cloud Storage. (Used as part of `scrape-versionista-and-upload`.)

- `upload-to-s3` uploads a directory’s contents to Amazon S3. (Used as part of `scrape-versionista-and-upload`.)

- `import-to-db` sends the contents of a JSON-stream file listing versions that was generated by `scrape-versionista` to an instance of [web-monitoring-db][]. (Used as part of `scrape-versionista-and-upload`.)

- `query-db-and-email` queries a [web-monitoring-db][] instance for pages that were updated with new versions during a given time frame and e-mails a compressed `.tar.gz` archive of the results to a specified address. Results are CSV files — one per combination of tags specified with the `--group-by` option.

    **NOTE: this will soon be deprecated in favor of [web-monitoring-task-sheets][].**

- `get-versionista-metadata` and `get-versionista-page-chunk` are for advanced usage loading extremely large amounts of data from Versionista. See [`backfilling-data.md`](./backfilling-data.md) for usage instructions.


## Deployment

For details about how this tool is deployed to automatically scrape Versionista in production, see [`deployment.md`](deployment.md).

## Code of Conduct

This repository falls under EDGI's [Code of Conduct](https://github.com/edgi-govdata-archiving/overview/blob/master/CONDUCT.md).

## Contributing Guidelines

We love improvements to our tools! EDGI has general [guidelines for contributing](https://github.com/edgi-govdata-archiving/overview/blob/master/CONTRIBUTING.md) to all of our organizational repos.


## License & Copyright

Copyright (C) 2017 Environmental Data and Governance Initiative (EDGI)
This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3.0.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

See the [`LICENSE`](https://github.com/edgi-govdata-archiving/web-monitoring-versionista-scraper/blob/master/LICENSE) file for details.


[web-monitoring-db]: https://github.com/edgi-govdata-archiving/web-monitoring-db/
[web-monitoring-task-sheets]: https://github.com/edgi-govdata-archiving/web-monitoring-task-sheets/
