# Deployment

The scripts in this repository are currently deployed to a web server (on Amazon EC2), where they are run on a regular schedule to extract data from Versionista and load it into a running instance of [**web-monitoring-db**](https://github.com/edgi-govdata-archiving/web-monitoring-db).

This deployment is very simple and consists of:

1. A git clone of this repository
2. An Amazon EBS volume (basically virtual hard drive) for storing intermediary data before uploading to S3/Google Cloud/web-monitoring-db (this is not required, but using it keeps data available for archival purposes even if the server is shut down).
3. A set of shell scripts that set up environment variables used to configure the scripts
4. A cron script that uses the above environment scripts
5. A crontab that runs the above cron script

On the server’s filesystem, this generally looks like:

```
/
├─┬ data/                                   # the mount point for the EBS volume
| └── versionista/                          # a directory we have permission to write/read
└─┬ home/
  └─┬ ubuntu/                               # user home directory (doesn't have to be ubuntu)
    └─┬ web-monitoring-versionista-scraper/ # the repo clone
      ├── [checked out files]
      ├── versionista-archive-key.json      # Google cloud key file for uploading to Cloud Storage
      ├── .env.vesionista1                  # An environment script for the "versionista1" account
      ├── .env.vesionista2                  # An environment script for the "versionista1" account
      └── cron-archive                      # A shell script that gets run by cron
```


## Google Cloud Key File

Unlike Amazon services, Google Cloud requires a key *file* for managing credentials. This is the `versionista-archive-key.json` file in the file hierarchy above. To create one:

1. Go to the [Google Cloud console](https://console.cloud.google.com/)
2. Select “IAM & Admin” → “Service Accounts” from the left-hand menu
3. Click “Create Service Account” at the top of the screen
    1. Give your service account any name you like
    2. Under “Role,” select “Storage” → Storage Object Admin”
    3. Check “Furnish a new private key” and select “JSON” for the key type
    4. Click “create”
    5. A JSON file should automatically be downloaded
4. Upload the JSON file you got from the above step to your server. You can rename it if you like.


## Environment Scripts

In our deployment, environment scripts are named `.env.[account name]`, e.g. `.env.versionista1`. You can name them anything you like, though. These should be a copy of the [`.env.sample`](https://github.com/edgi-govdata-archiving/web-monitoring-versionista-scraper/blob/master/.env.sample) script in this repository, but with all the values properly filled in.

Make sure that the `GOOGLE_STORAGE_KEY_FILE` variable points to `versionista-archive-key.json` (or whatever you have named it).


## Cron Shell Script

In the example above, this is the `cron-archive` script. It exists merely to be run by `cron`, load the appropriate configuration environment script, and then run the [`bin/scrape-versionista-and-upload`](https://github.com/edgi-govdata-archiving/web-monitoring-versionista-scraper/blob/master/bin/scrape-versionista-and-upload) script. In our deployment, it looks something like:

```sh
#!/bin/bash

# Load configuration
source "$HOME/web-monitoring-versionista-scraper/.env.$1"

# Load appropriate Node.js runtime via NVM
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 6 > /dev/null

# Run the scraper and upload results
$HOME/web-monitoring-versionista-scraper/bin/scrape-versionista-and-upload --after $2 --output $3
```

This script takes 3 arguments so that `cron` can run it with different configurations:

1. The name of the configuration environment script to load, e.g. `versionista1`.
2. The number of hours to cover in the scraper run
3. Where to store the scraped data on disk (this includes raw diffs, raw versions, and JSON files containing metadata about the versions and diffs)

Finally, set up `cron` to run the above script. Run `crontab -e` to configure cron. In production, we have a crontab that looks something like:

```cron
0,30 * * * * /home/ubuntu/web-monitoring-versionista-scraper/cron-archive versionista1 0.75 /data/versionista 2>> /var/log/cron-versionista.log
15,45 * * * * /home/ubuntu/web-monitoring-versionista-scraper/cron-archive versionista2 0.75 /data/versionista 2>> /var/log/cron-versionista.log
```

That runs the `cron-archive` script every 30 minutes for each account. For the “versionista1” account, it runs on the hour and at half-past; for the “versionista2” account, at a quarter after and a quarter to the hour.

That’s it!
