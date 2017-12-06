# Backfilling Old Data from Versionista

If for any reason there were prolonged errors in scraping data from Versionista, you may need to backfill a large amount of missed data into your database after you get things into basic working order. Versionista can be a bit sensitive to heavy, prolonged usage, but the scraping routine cannot determine whether a given site or page only has versions that are *after* your target timeframe (since it only sees a “most recent version” time). That means a backfill hits a lot more Versionista content than necessary and can run afoul of heavy usage issues.

To mitigate that, there are a couple special backfilling tools that break the job into two parts:

1. Find all the candidate pages that might have versions you care about
2. For each candidate page, scrape only versions in your timeframe

This can break the job down into many smaller parts (#2 above is actually many parts) that you can space out over time.

Note this set of instructions relies on `.env.versionstaX` environment files holding all the relevant configuration information, as described in [`deployment.md`](./deployment.md#environment-scripts).

These instructions make heavy use of variables, so you should be able to copy and paste most things as-is. Places where you need to fill in values will be called out.


## Set account environment, load candidate pages and split into chunks

The `get-versionista-metadata` script will gather a list of candidate pages that *may* have versions in the time period we are backfilling. Those pages are then output to disk in chunked files (currently 250 pages per chunk).

Source the appropriate environment file for the Versionista account you need to backfill data from and **fill in the `--after` and `--before` options to the script below.** You can also change where the output is sent (`/data/versionista-backfill`), but you’ll need to make sure to change all the later instructions, too.

```sh
source .env.versionista1
./bin/get-versionista-metadata --after '2017-10-09T02:00:00Z' --before '2017-10-18T00:00:00Z' --output /data/versionista-backfill/xxx --errors /data/versionista-backfill/errors-$VERSIONISTA_NAME.log --parallel 3 --pause-time 10000
```

You should now see a set of files in `/data/versionista-backfill` named like `pages-versionista1-0.json` with increasing numbers on the end. Make sure there were no errors (output in files named `errors-versionista1.log`).


## Scrape matching versions from candidate pages (repeat for each chunk)

Check the list of files now in `/data/versionista-backfill` to see how many chunks you have to go through. Then repeat the following steps once for each chunk. Note they all use the `$CHUNK` variable created in the first line, so the only line you need to change each time is the first (set it to the number of the chunk you are running).

This will pull down the actual raw page content, diffs, and version metadata for all the pages in a chunk.

**Make sure to set the `--after` and `--before` options the same as you did for `get-versionista-metadata` above.**

```sh
# Increment this variable each time until you've done all the chunks
CHUNK=0
# Actually scrape version metadata, raw content, and diffs
./bin/get-versionista-page-chunk --after '2017-10-09T00:00:00Z' --before '2017-10-18T00:00:00Z' --relative-paths /data/versionista-backfill/ --save-content --save-diffs --parallel 3 --pause-time 10000 --format json-stream --output /data/versionista-backfill/$VERSIONISTA_NAME/metadata-chunk-$CHUNK.json --errors /data/versionista-backfill/$VERSIONISTA_NAME/errors-page-chunk-$CHUNK.log --candidate-pages /data/versionista-backfill/pages-$VERSIONISTA_NAME-$CHUNK.json
# Add a newline to the end of the file (should fix our JSON serialization to do this)
echo '' >> /data/versionista-backfill/$VERSIONISTA_NAME/metadata-chunk-$CHUNK.json
```

You should now have a file and directory structure in `/data/versionista-backfill/versionista1` (if your sourced `.env.versionista1` as in the example, otherwise `/data/versionista-backfill/WHATEVER` depending on your environment variables) that resembles what you’d get when running the normal `scrape-versionista` script:

```
/data/versionista-backfill
└─┬ /versionista1 # or whatever $VERSIONISTA_NAME was set to
  ├─┬ /96855-7670814
  │ ├── diff-13191115.html
  │ ├── diff-13191115-text.html
  │ ├── version-13191115.html
  │ └── # etc
  ├─┬ /96855-7670957
  │ ├── diff-13191115.html
  │ ├── diff-13191115-text.html
  │ ├── version-13191115.html
  │ └── # etc
  ├── /{site_id}-{page_id}  # etc etc etc
  ├── metadata-chunk-0.json
  ├── metadata-chunk-1.json
  └── metadata-chunk-{chunk_number}.json  # etc etc etc
```

Follow all this up by combining the above metadata files into a single one for importing to web-monitoring-db:

```sh
cat /data/versionista-backfill/$VERSIONISTA_NAME/metadata-chunk-* > /data/versionista-backfill/$VERSIONISTA_NAME/metadata.json
```

The rest of this process is a manual version of what the `scrape-versionista-and-upload` script does.


## Upload to cloud storage

```sh
./bin/upload-to-s3 --prefix "$VERSIONISTA_NAME/" --throughput 50 "$AWS_S3_BUCKET" /data/versionista-backfill/$VERSIONISTA_NAME/
./bin/upload-to-google --prefix "$VERSIONISTA_NAME/" --throughput 25 "$GOOGLE_BUCKET" /data/versionista-backfill/$VERSIONISTA_NAME/
```


## Upload metadata to DB

```sh
./bin/import-to-db --host 'https://api-staging.monitoring.envirodatagov.org/' /data/versionista-backfill/$VERSIONISTA_NAME/metadata.json
./bin/import-to-db --host 'https://api.monitoring.envirodatagov.org/' /data/versionista-backfill/$VERSIONISTA_NAME/metadata.json
```
