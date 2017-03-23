# versoinista-edgi-node

This is a version of [versionista-outputter](https://github.com/edgi-govdata-archiving/versionista-outputter) that has been rewritten in Node.js and JSDom.

Why? Speed is important here. Scraping Versionista can take a *long* time. We don’t need the overhead of a browser (like loading and executing images, CSS, and JavaScript) because all the necessary content is in the inital HTML payload. Parallelizing operations is also a little easier (for me, at least) in Node than in Ruby—and we absolutely ought to be doing more in parallel.


## Installation

You’ll need Node.js. Then you should be able to globally install this with:

```sh
$ npm install -g https://github.com/Mr0grog/versionista-edgi-node.git
```

Then run it like so:

```sh
$ scrape-versionista --email EMAIL --password PASSWORD --after '2017-03-22' --format csv --output './scrape/versions.csv'
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

### Options:

- `--email STRING` **Required!** The E-mail address of Versionista Account. You can also use an env var instead: `VERSIONISTA_EMAIL`

- `--password STRING` **Required!** The password of Versionista Account. You can also use an env var instead: `VERSIONISTA_PASSWORD`

- `--after DATE|HOURS` Only check versions captured after this date. It can be an ISO 8601 date string like `2017-03-01T00:00:00Z` or a number, representing hours before the current time.

- `--before DATE|HOURS` Only check versions captured before this date. It can be an ISO 8601 date string like `2017-03-01T00:00:00Z` or a number, representing hours before the current time.

- `--format FORMAT` The output format. One of: `csv`, `json`, `json-stream`. [default: `json`]

- `--output FILEPATH` Write output to this file instead of directly to your console.

- `--save-content` If set, the raw HTML of each captured version will also be saved. Files are written to the working directory or, if `--output` is specified, the same directory as the output file.

- `--save-diffs` If set, the HTML of diffs between a version and its previous version will also be saved.Files are written to the working directory or, if `--output` is specified, the same directory as the output file.


## License & Copyright

All source code in this repository is copyright (c) 2017 Robert Brackett.

It is licensed under the GPL v3 source code license, found in the [`LICENSE`](https://github.com/Mr0grog/versionista-edgi-node/blob/master/LICENSE) file.
