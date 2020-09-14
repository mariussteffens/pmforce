// crawl settings

// URLs to crawl before crawler is restarted
const url_count = 1;
// mac urls per eTLD+1
const maxUrls = 20;
// One crawler crawls one site at a time
const sameSite = false;
// retry to crawl url
const url_retries = 2;
// collect further urls while we are crawling up to maxUrls
const collectUrlsWhileCrawling = true;
// max depth to collect URLs from
const depth = 2;
// When the profile is not regularly cleared, it will collect all scripts and state information which might consume lots of space
const clearProfileOnShutdown = true;
// user agent to use
const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36';

// Delimiter for the URLs CSV file
// default values which can be overwritten by commandline parameters
const csvDelimiter = ',';
const alexaPattern = 'r,u';
// timings
const load_timeout = 60000;
const execution_time_after_load = 10000;
const module_timeout = 180000;
// DB stuff
// use DB docker credentials when no other postgres can be found to be configured via the environment
const db_user = process.env.POSTGRES_USER ? process.env.POSTGRES_USER : 'crawly';
const db_host = process.env.POSTGRES_HOST ? process.env.POSTGRES_HOST : 'db';
const db_pass = process.env.POSTGRES_PASSWORD ? process.env.POSTGRES_PASSWORD : '8161f6a2b2451a978c129bf0b7526838c1d4215c';
const db_name = process.env.POSTGRES_DB ? process.env.POSTGRES_DB : 'crawly';
const db_port = '5432';

const logLevel = 0;

// chrome flags to be passed on chrome startup
const DEFAULT_FLAGS = [
  // Disable built-in Google Translate service
  '--disable-translate',
  // Disable all chrome extensions entirely
  '--disable-extensions',
  // Disable various background network services, including extension updating,
  //   safe browsing service, upgrade detector, translate, UMA
  '--disable-background-networking',
  // Disable fetching safebrowsing lists, likely redundant due to disable-background-networking
  '--safebrowsing-disable-auto-update',
  // Disable syncing to a Google account
  '--disable-sync',
  // Disable reporting to UMA, but allows for collection
  '--metrics-recording-only',
  // Disable installation of default apps on first run
  '--disable-default-apps',
  // Mute any audio
  '--mute-audio',
  // Skip first run wizards
  '--no-first-run',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-xss-auditor',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-site-isolation-trials',
  '--disk-cache-size=536870912',
  '--disable-client-side-phishing-detection',
];


let config;
config = {
  flags: DEFAULT_FLAGS,
  maxUrls: maxUrls,
  url_count: url_count,
  csvDelimiter: csvDelimiter,
  alexaPattern: alexaPattern,
  depth: depth,
  sameSite: sameSite,
  url_retries: url_retries,
  collectUrlsWhileCrawling: collectUrlsWhileCrawling,
  db: {
    user: db_user,
    pass: db_pass,
    host: db_host,
    port: db_port,
    name: db_name,
  },
  timings: {
    load: load_timeout,
    exec: execution_time_after_load,
    module: module_timeout
  },
  clearProfileOnShutdown: clearProfileOnShutdown,
  logLevel: logLevel,
  userAgent: userAgent,
};

module.exports = {config};