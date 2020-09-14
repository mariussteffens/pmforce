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
const {Logger} = require('./util/Logger');
const {CrawlParameterParser} = require('./util/CrawlParameterParser');
const {CrawlException} = require('./util/CrawlException');
const {Crawler} = require('./core/crawler');
const {DatabaseConnector} = require('./core/DatabaseConnector');
const {ModuleLoader} = require('./core/moduleLoader');

const util = require('./util/Util');

const readlineSync = require('readline-sync');
const fs = require('fs');
const es = require('event-stream');

class Crawly {
  constructor() {
    let parser = new CrawlParameterParser();
    this.config = parser.parseConfig();
    this.logger = new Logger(this.config.logLevel);
    this.db = new DatabaseConnector(this.config, this.logger);
    this.crawler = new Crawler(this.config, this.logger, this.db)
  }

  async main() {
    switch (this.config.dynamic.mode) {
      case 'init':
        await this._init();
        break;
      case 'setup':
        await this._setup();
        break;
      case 'test':
        await this._test();
        break;
      case 'run':
        await this._run();
        break;
      case 'clean':
        await this._clean();
        break;
      case 'addUrls':
        await this._addUrls();
        break;
    }
  }

  async _clean() {
    this.logger.log('you are making use of a dangerous functionality, with great power comes great responsibility...');
    this.logger.log('Are you certain that you want to drop the following tables:');
    this.logger.log('Host:', this.config.db.host);
    this.logger.log('DB:', this.config.db.name);
    this.logger.log('Modules:', this.config.dynamic.module);

    this.logger.log('Be warned that even if you did not supply a module, this functionality will clean the core tables such as urls, frames and jobs.');
    let answer = readlineSync.question('Are you really sure? y/n\n');
    if (answer !== 'y') {
      this.logger.log('You are not certain enough, try again!');
      // FIXME make exit codes to enums
      process.exit(55)
    }

    await this.db.connect();
    await this.db.removeBaseTables();
    let moduleLoader = new ModuleLoader(this.config.dynamic.module, this.logger);

    let mods = moduleLoader.createModules(null, null, null, this.db);
    for (let mod_name in mods) {
      this.logger.log('Cleaning up Module', mod_name);
      await mods[mod_name].clean();
    }
    this.logger.log('Database was cleaned from modules!');

    await this.db.disconnect();
  }


  async _addUrls() {
    let to_visit = [];
    let read_lines = 0;
    await new Promise((resolve, reject) => {
      fs.createReadStream(this.config.dynamic.alexa).pipe(es.split()).pipe(es.mapSync(
          function (line) {
            if (this.config.dynamic.count !== null && this.config.dynamic.count !== undefined) {
              if (read_lines >= this.config.dynamic.count) {
                return;
              }
            }
            read_lines++;
            to_visit.push(line.toString())
          }
      ).on('error', function (err) {
        this.logger.log(err)
      }).on('end', resolve));
    });

    await this.db.connect();
    await this._enterUrls(to_visit, this.config.dynamic.job_id);
    await this.db.disconnect();
  }

  async _enterUrls(urls, job_id) {
    let sep = this.config.dynamic.delimiter === null ? this.config.csvDelimiter : this.config.dynamic.delimiter;
    let pattern = this.config.dynamic.alexaPattern === null ? this.config.alexaPattern : this.config.dynamic.alexaPattern;
    let propOrder = [];
    for (let pat of pattern.split(sep)) {
      switch (pat) {
        case 'r':
          propOrder.push('rank');
          break;
        case 'u':
          propOrder.push('url');
          break;
        case 'a':
          propOrder.push('addInfo');
          break;
        case 'l':
          propOrder.push('level');
          break;
        default:
          throw new CrawlException('Unknown pattern format character:' + pat);
      }
    }
    this.logger.log("Alexa Pattern:", propOrder);
    if (propOrder.indexOf('url') === -1) {
      throw new CrawlException('Pattern did not contain the url')
    }
    for (let entry of urls) {
      let job = {};

      let splitted = entry.split(sep).map(entry => entry.trim());
      if (splitted.length !== propOrder.length) {
        this.logger.warn('Missmatch in url pattern, number of arguments not matching pattern.');
        continue
      }
      for (let i = 0; i < propOrder.length; i++) {
        job[propOrder[i]] = splitted[i];
      }
      if (job['url'] === undefined || job['url'] === '') {
        this.logger.warn('url was undefined', entry);
        continue
      }
      if (!job['url'].startsWith('http'))
        job['url'] = 'http://' + job['url'];
      await this.db.addUrl(job['url'], job_id, job['level'] !== undefined ? job['level'] : 0, job['rank'], job['addInfo']);
    }
    this.logger.log("Successfully entered", urls.length, "initial URLs to DB!");
  }

  async _init() {
    let data = await util.readFilePromise(this.config.dynamic.alexa);
    let lines = data.toString().split('\n');
    let to_visit = lines;

    if (this.config.dynamic.count !== undefined && this.config.dynamic.count !== null) {
      to_visit = lines.slice(0, this.config.dynamic.count);
    }
    await this.db.connect();
    if (this.config.dynamic.createTables) {
      await this.db.createBaseTables();
    }

    let job_id = await this.db.createJob(this.config.dynamic.description);
    await this._enterUrls(to_visit, job_id);
    await this.db.disconnect();
  }


  async _setup() {
    await this.db.connect();

    let moduleLoader = new ModuleLoader(this.config.dynamic.module, this.logger);
    let mods = moduleLoader.createModules(null, null, null, this.db);
    for (let mod_name in mods) {
      this.logger.log('Setting up Module', mod_name);
      await mods[mod_name].setup();
    }
    this.logger.log('All modules were set up!');

    await this.db.disconnect();
  }


  async _test() {
    await this.crawler.initBrowser();
    await this.crawler.crawlSite({url: this.config.dynamic.url}, false);
    if (this.config.dynamic.keepBrowserOpen) {
      return
    }
    await this.crawler.teardownBrowser();
  }


  async _run() {
    await this.db.connect();
    let error = false;
    let no_new_urls = 0;

    try {
      while (1) {
        let jobs = await this.db.getUrls(this.config.url_count, this.config.dynamic.job_id, this.config.dynamic.crawler_id);
        if (jobs.length === 0) {
          if (no_new_urls++ === this.config.url_retries) {
            break;
          }
          this.logger.log('Found no new URLs, sleeping now!');
          await util.delay(3000);
          continue;
        }
        // start a browser instance;
        await this.crawler.initBrowser();
        for (let job of jobs) {
          await this.crawler.crawlSite(job);
        }
        await this.crawler.teardownBrowser();

        if (this.config.clearProfileOnShutdown) {
          console.log('clearing profile', this.config.dynamic.user_data_dir);
          const cmd = 'rm -rf ' + this.config.dynamic.user_data_dir;
          await util.exec(cmd);
        }
        process.exit(0);
      }
    } catch (e) {
      this.logger.err(e);
      this.logger.err('Fell through main crawling loop, will abort crawling since we cannot ensure valid termination of the crawler otherwise.');
      error = true;
    } finally {
      await this.db.disconnect();
    }

    // FIXME: add exit code enums here
    if (error) {
      // indicate that something went wrong and we need to be restarted
      process.exit(-3)
    }

    //There is nothing to do anymore, if we want to run the crawler while waiting for new urls we go into the forver case
    if (this.config.dynamic.forever) {
      // return some bogus value to keep being restarted
      process.exit(3)
    } else {
      // indicate that we don't want to be restarted
      process.exit(42);
    }
  }
}

async function main() {
  let crawler = new Crawly();
  await crawler.main();
}

main();
