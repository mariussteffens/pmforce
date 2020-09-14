/*
Copyright (C) 2020  Marius Steffens, CISPA

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
const {Client} = require('pg');
const util = require('../util/Util');
const crypto = require('crypto');

const {CrawlException} = require('../util/CrawlException');
const {CrawlStatus} = require('../util/Enums');


const BLACKLIST = ['ieee.org', 'tandfonline.com'];

class DatabaseConnector {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    this.conn = new Client({
      user: config.db.user,
      host: config.db.host,
      database: config.db.name,
      password: config.db.pass,
      port: config.db.port,
    });
  }

  async startTransaction() {
    await this.conn.query('BEGIN;');
  }

  async commit() {
    await this.conn.query('END;');
  }

  async removeBaseTables() {
    this.logger.log('Deleting Databases...');
    for (let entry of ['job', 'frames', 'url', 'sites', 'module_error']) {
      this.logger.log('DROP TABLE ' + entry);
      await this.conn.query('DROP TABLE ' + entry + ' CASCADE').catch(this.logger.asCallback('err'));
    }
  }

  async createBaseTables() {
    this.logger.log("Initializing Database...");
    try {
      await this.conn.query("CREATE TABLE job(job_id Serial PRIMARY KEY, description TEXT, creation_date timestamp default current_timestamp);");
      await this.conn.query("CREATE TABLE url(url_id SERIAL PRIMARY KEY, job_id INTEGER REFERENCES job(job_id), site VARCHAR(80), alexa_rank INTEGER, url TEXT, end_url TEXT, url_hash VARCHAR(64), level smallint ,addInfo TEXT , addinfo_hash varchar(32), crawl_status smallint DEFAULT 0, crawler INTEGER, errors smallint DEFAULT 0, last_error TEXT);");
      await this.conn.query("CREATE TABLE frames(frame_id SERIAL PRIMARY KEY, url_id INTEGER REFERENCES url(url_id), browser_frame_id VARCHAR(32), browser_parent VARCHAR(32),frame_start_url TEXT, frame_end_url TEXT, frame_end_site VARCHAR(80));");

      await this.conn.query('CREATE INDEX url_site ON url(site)');
      await this.conn.query('CREATE INDEX url_rank ON url(alexa_rank)');
      await this.conn.query('CREATE INDEX crawl_status ON url(crawl_status)');
      await this.conn.query('CREATE UNIQUE INDEX url_hash ON url(job_id, url_hash, addInfo_hash)');


      await this.conn.query('CREATE INDEX frames_url_id ON frames(url_id)');
      await this.conn.query('CREATE INDEX frames_site ON frames(frame_end_site)');
      await this.conn.query('CREATE UNIQUE INDEX frames_browser_id ON frames(url_id, browser_frame_id)');


      await this.conn.query('CREATE TABLE sites (job_id INTEGER REFERENCES job(job_id), site_id SERIAL PRIMARY KEY, site VARCHAR(80) UNIQUE, counter INTEGER, crawl_status INTEGER, crawler INTEGER)');
      await this.conn.query('CREATE INDEX ON sites(counter)');
      await this.conn.query('CREATE UNIQUE INDEX ON sites(site)');

      await this.conn.query('CREATE TABLE module_error(err_id SERIAL PRIMARY KEY, module_name VARCHAR(30), error TEXT)');
      await this.conn.query('CREATE INDEX mod_name ON module_error(module_name)');


      //await this.conn.query('CREATE INDEX frames_browser ON frames(url_id, browser_frame_id)'); Probably dont need this due to low amount of frames
    } catch (e) {
      throw new CrawlException('Encountered exception when initializing the database:' + e.message);
    }
    this.logger.log("Initial database setup was completed!")
  }


  async addUrl(url, job_id, level, assoc_alexa_rank, addInfo = '') {
    // TODO: change site to uncrawled if we add URLs
    let parsed, site, cont;
    try {
      if (url === undefined || !url.startsWith("http")) {
        this.logger.log("Skipping entering of non http url:", url);
        return true;
      }
      parsed = util.parseUrl(url);
      site = util.get_psl(parsed);
      cont = true;

      if (site === undefined || site === null) {
        this.logger.warn('Site was null for entry', url);
        return cont;
      }
      for (let blacklisted of BLACKLIST) {
        if (site && site.indexOf(blacklisted) !== -1) {
          this.logger.warn('ieee or tandfonline site was disregarded', url);
          // true signalizes to continue inserting
          return true;
        }
      }
    } catch (e) {
      this.logger.warn(e);
      // true signalizes to continue inserting
      return true
    }
    await this.startTransaction();
    await this.conn.query("LOCK TABLE sites IN ACCESS EXCLUSIVE MODE;").catch((e) => {
      this.logger.log('[LOCK_ERROR]', site, e.stack);
    });

    let result = await this.conn.query("SELECT counter, crawl_status FROM sites WHERE site=$1 AND job_id=$2", [site, job_id]).catch((e) => {
      this.logger.log('[SELECT_ERROR]', site, e.stack);
    });
    let site_counter, crawl_status;
    if (result.rowCount > 0) {
      site_counter = result.rows[0]["counter"];
      crawl_status = result.rows[0]["crawl_status"];
      if (crawl_status === CrawlStatus.CRAWLED) {
        crawl_status = CrawlStatus.CRAWLING;
      }
    } else {
      site_counter = 0;
      crawl_status = CrawlStatus.NOT_CRAWLED;
    }
    if (site_counter < this.config.maxUrls) {
      let hash;
      if (this.config.dynamic.uniqueWithFragment) {
        hash = crypto.createHash("sha1").update(url).digest("hex");
      } else {
        hash = crypto.createHash("sha1").update(parsed.protocol + "//" + parsed.hostname + parsed.pathname + '?' + parsed.search).digest("hex");
      }
      await this.conn.query("INSERT INTO url(job_id, site, url, url_hash, level, addInfo, addinfo_hash, alexa_rank) VALUES($1,$2,$3,$4,$5,$6,MD5($6),$7) ON CONFLICT DO NOTHING", [job_id, site, url, hash, level, addInfo, assoc_alexa_rank]
      ).then(async (result) => {
        if (result.rowCount > 0) {
          await this.conn.query("INSERT into sites (job_id, site, counter, crawl_status) VALUES ($1, $2, 1, $3) ON CONFLICT (site) DO UPDATE SET counter=sites.counter+1, crawl_status=$3", [job_id, site, crawl_status]);
        }
      }).catch(this.logger.asCallback('err'));
    } else {
      this.logger.log('Skipping URL: Max URLs for ' + site + ' exceed');
      cont = false;
    }
    await this.commit();
    return cont;
  }

  async addUrlNoPsl(url, job_id, level, assoc_alexa_rank, addInfo = null) {
    if (url === undefined || !url.startsWith("http")) {
      this.logger.log("Skipping entering of non http url:", url);
      return;
    }
    let parsed = util.parseUrl(url);

    let hash = crypto.createHash("sha1").update(parsed.protocol + "//" + parsed.hostname + parsed.pathname + '?' + parsed.search).digest("hex");
    await this.conn.query("INSERT INTO url(job_id, url, url_hash, level, addInfo, alexa_rank) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [job_id, parsed.href, hash, level, addInfo, assoc_alexa_rank]).catch(() => {
      this.logger.log('Duplicate', parsed.href);
    });
  }

  async addUrls(urls, job_id, level, assoc_alexa_rank, parent_url) {
    if (level > this.config.depth)
      return;

    let parsed_parent = util.parseUrl(parent_url);
    let site_parent = util.get_psl(parsed_parent);

    for (let url of urls) {

      let parsed = util.parseUrl(url);
      let site = util.get_psl(parsed);

      if (this.config.sameSite && site !== site_parent) {
        this.logger.log('Not entering', site, site_parent);
        continue;
      }

      let inserted = await this.addUrl(url, job_id, level, assoc_alexa_rank, null);
      if (!inserted) {
        break;
      }
    }
  }


  async createJob(description) {
    let result = await this.conn.query("INSERT INTO job(description) VALUES ($1) RETURNING job_id", [description]);
    return result.rows[0].job_id;
  }

  async failedCrawling(url_id, error) {
    this.logger.log('Failed url with id: ', url_id);
    let result = await this.conn.query("SELECT errors FROM url WHERE url_id=$1", [url_id,]);
    if (result.rows && result.rows.length && result.rows[0].errors >= args.crawl_retries) {
      this.logger.log('Already encountered', result.rows[0].errors);
      await this.conn.query("UPDATE url SET crawl_status=$1, errors=errors+1, last_error=$2 WHERE url_id=$3", [CrawlStatus.FAILED, error, url_id])
    } else {
      this.logger.log('There were not yet enough errors...');
      await this.conn.query("UPDATE url SET crawl_status=$1, errors=errors+1, last_error=$2 WHERE url_id=$3", [CrawlStatus.NOT_CRAWLED, error, url_id]);
    }
    this.logger.log('Continuing with next in queue!');
  }

  async changeCrawlStatus(url_id, status, end_url = undefined) {
    this.logger.log('Successfully crawled: ', url_id);
    // set status accordingly
    if (end_url !== undefined) {
      let parsed = util.parseUrl(end_url);
      let site = util.get_psl(parsed);
      // update site accordingly such that we account for redirects in the alexa
      await this.conn.query("UPDATE url SET crawl_status=$1, end_url=$2, site=$3 WHERE url_id=$4", [status, end_url, site, url_id]);
    } else
      await this.conn.query("UPDATE url SET crawl_status=$1 WHERE url_id=$2", [status, url_id]);
  }


  async getOrClaimSite(crawler_id) {
    let res = await this.conn.query("SELECT site FROM sites WHERE crawl_status=$1 and crawler=$2", [CrawlStatus.CRAWLING, crawler_id]);
    if (res.rowCount === 0) {
      // we dont have a site yet
      await this.startTransaction();
      res = await this.conn.query("SELECT site_id, site FROM sites WHERE crawl_status=$1 FOR UPDATE SKIP LOCKED LIMIT 1", [CrawlStatus.NOT_CRAWLED]);
      if (res.rowCount === 0) {
        // no new site claimable
        this.logger.log("Could not claim another site anymore...");
        await this.commit();
        return undefined;
      }
      let entry = res.rows[0];
      await this.conn.query("UPDATE sites SET crawl_status=$1, crawler=$2 WHERE site_id=$3", [CrawlStatus.CRAWLING, crawler_id, entry.site_id]);
      await this.commit();
      return entry.site;
    } else {
      // we already have a claimed site so we return it
      return res.rows[0].site
    }
  }

  async getUrls(count, job_id, crawler_id) {
    // TODO starting crawler should cleanup his acquired urls
    let res, site;
    if (this.config.sameSite) {
      site = await this.getOrClaimSite(crawler_id);
      if (site === undefined) {
        return [];
      }
    }
    await this.startTransaction();

    if (this.config.sameSite) {
      res = await this.conn.query('SELECT url_id, url, level, addInfo, alexa_rank FROM url  WHERE job_id=$1 AND site=$2 AND (crawl_status=$3 OR (crawl_status=$4 AND crawler=$5)) FOR UPDATE SKIP LOCKED LIMIT $6', [job_id, site, CrawlStatus.NOT_CRAWLED, CrawlStatus.CRAWLING, crawler_id, count]).catch(this.logger.asCallback('err'));
    } else {
      res = await this.conn.query('SELECT url_id, url, level, addInfo, alexa_rank FROM url  WHERE job_id=$1 AND (crawl_status=$2 OR (crawl_status=$3 AND crawler=$4)) FOR UPDATE SKIP LOCKED LIMIT $5', [job_id, CrawlStatus.NOT_CRAWLED, CrawlStatus.CRAWLING, crawler_id, count]).catch(this.logger.asCallback('err'));
    }

    let fetchedIds = [];
    let jobs = [];
    for (let row of res.rows) {
      let addInfo;
      if (row.addinfo !== undefined && row.addinfo !== null && row.addinfo !== '') {
        try {
          addInfo = JSON.parse(row.addinfo);
        } catch (e) {
          this.logger.err(e);
        }
      }
      let job = {
        url_id: row.url_id,
        url: row.url,
        level: row.level,
        addInfo: addInfo,
        alexa_rank: row.alexa_rank
      };
      jobs.push(job);
      fetchedIds.push(row.url_id);
    }
    await this.conn.query('UPDATE url SET crawl_status=$1 , crawler=$2 WHERE url_id = ANY ($3)', [CrawlStatus.CRAWLING, crawler_id, fetchedIds]);
    if (jobs.length === 0 && this.config.sameSite) {
      // No more URLs for a given site available
      await this.conn.query("UPDATE sites SET crawl_status=$1 WHERE site=$2 AND job_id=$3", [CrawlStatus.CRAWLED, site, job_id])
    }
    // After setting them to the respective crawl status we can now unlock these rows again
    await this.commit();
    return jobs;
  }


  async insertFrame(url_id, frame_id, parent_id, url, site) {
    if (frame_id.startsWith('(')) {
      frame_id = frame_id.slice(1, -1);
      if (parent_id !== undefined)
        parent_id = parent_id.slice(1, -1);
    }
    let result = await this.conn.query('INSERT INTO frames (url_id, browser_frame_id, browser_parent, frame_start_url, frame_end_url, frame_end_site) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (url_id, browser_frame_id) DO UPDATE SET frame_end_url=$7, frame_end_site=$8 RETURNING frame_id ', [url_id, frame_id, parent_id, url, url, site, url, site]).catch(this.logger.asCallback('err'));
    return result.rows[0].frame_id;
  }

  async insertContextId(fid, origin, host, furl) {
    let furl_hash = crypto.createHash("sha1").update(furl).digest("hex");
    let result = await this.conn.query('INSERT INTO executioncontexts(frame_id, origin, host, furl, furl_hash) VALUES($1,$2,$3,$4,$5) RETURNING execid', [fid, origin, host, furl, furl_hash]);
    return result.rows[0].execid;
  }

  async getSiteForUniqueExec(unique) {
    let res = await this.conn.query('SELECT host FROM executioncontexts WHERE execid=$1', [unique]);
    return res.rows[0].host
  }

  async moduleError(module_name, error) {
    await this.conn.query('INSERT INTO module_error(module_name, error) VALUES($1,$2)', [module_name, error]);
  }

  getConn() {
    return this.conn;
  }

  async disconnect() {
    await this.conn.end();
  }

  async connect() {
    // If this function is not called before we query something the library will simply hang and not produce any errors
    await this.conn.connect();
  }
}

module.exports = {DatabaseConnector};