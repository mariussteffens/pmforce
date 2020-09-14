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
const {ModuleLoader} = require('./moduleLoader');
const {CrawlException} = require('../util/CrawlException');
const {CrawlPage} = require('./CrawlPage');
const puppeteer = require('puppeteer');
const util = require('../util/Util.js');
const {CrawlStatus} = require('../util/Enums');

class Crawler {
  constructor(config, logger, db) {
    this.config = config;
    this.logger = logger;
    this.db = db;

    this.graceful_exit = false;
    this.disconnected = false;
    this.module_exit = false;

    this.moduleLoader = new ModuleLoader(config.dynamic.module, logger);
  }

  async initBrowser() {
    let config = {
      headless: this.config.dynamic.headless,
      userDataDir: this.config.dynamic.user_data_dir,
      args: this.config.flags,
    };
    if (this.config.dynamic.chromePath) {
      // if the option is not set the built in will be used
      config.executablePath = this.config.dynamic.chromePath;
    }
    this.logger.log('Starting chrome...');
    try {
      this.chrome = await puppeteer.launch(config);
    } catch (e) {
      this.logger.err(e);
      throw new CrawlException('Unable to launch chrome:' + e.message);
    }
    this.browser_pid = (await this.chrome.process()).pid;
    let that = this;
    this.chrome.on('disconnected', function () {
      that.ondisconnected()
    });
    this.logger.log('Chrome is ready to rumble!')
  }

  async closePages() {
    for (let page of await this.chrome.pages()) {
      if (page.url() !== 'about:blank') {
        await page.close()
      }
    }
  }

  async ondisconnected() {
    this.disconnected = new Promise((res, rej) => {
    });
    if (!this.graceful_exit) {
      console.log(this, this.logger)
      this.logger.error('Browser was disconnected...');
      if (this.job !== undefined) {
        await this.db.failedCrawling(this.job.url_id, 'disconnected');
      }
      await this.killChrome();
      // FIXME enum these exit codes
      process.exit(-2);
    }
  }

  async killChrome() {
    this.graceful_exit = true;
    if (this.browser_pid !== undefined) {
      this.logger.log('Killing browser with pid', this.browser_pid);
      // NO OP CATCH
      await util.exec('kill -9 ' + this.browser_pid).catch(() => {
      });
    }
  }


  async teardownBrowser() {
    this.graceful_exit = true;
    this.logger.log('Tearing down Chrome...');
    await this.killChrome();
  }


  async crawlSite(crawl_job, save = true) {
    this.logger.log('Crawling site', crawl_job);
    // will be used by the on disconnect routine to discern which url failed to crawl and update the DB accordingly
    this.job = crawl_job;
    await this.closePages();

    let b = util.benchmark('Crawling of site ' + crawl_job.url, this.logger);
    // add new Page
    let page = new CrawlPage(this.chrome, this.logger);

    let mods = this.moduleLoader.createModules(this.chrome, page, crawl_job, this.db, this.logger);

    // instrument the page, applying handlers of modules and utility handlers
    await page.preparePage(this.config.userAgent);

    // execute all 'before' hooks of the loaded modules
    await page.executeModules('before', mods, save);

    // Now we can navigate to the page
    try {
      await page.navigate(crawl_job.url, this.config.timings.load);
    } catch (e) {
      this.logger.log('Site load failed', crawl_job.url, e);
      if (save) {
        await this.db.failedCrawling(job.url_id, e.message);
      }
      await page.close();
      return;
    }

    // waiting before executing modules on page
    this.logger.log('Letting the page run...');
    await util.delay(this.config.timings.exec);
    this.logger.log('Retrieving end url...');
    let end_url = await page.getUrl();

    this.logger.log('Executing modules...');
    //let the modules run
    await page.executeModules('execute', mods, save);

    this.logger.log('Finished with modules...');

    if (this.config.dynamic.keepBrowserOpen) {
      // Sometimes we want to keep the browser open with all modules attached to the page
      return
    }
    // kill all execution contexts
    await page.navigate('about:blank', this.config.timings.load).catch(() => {
    });
    //dispose page
    await page.close().catch(this.logger.asCallback('err'));
    // finishing up, apply state changes
    // If we are in the process of dying, the disconnected property will be set to a promise
    await this.disconnected;
    this.job = undefined;

    if (!this.module_exit) {
      if (save)
        await this.db.changeCrawlStatus(crawl_job.url_id, CrawlStatus.CRAWLED, end_url);
      b.stop();
      this.logger.log('Finished Job', crawl_job.url);
    } else {
      b.stop();
      this.logger.log('Module exited', crawl_job.url);
      await this.db.failedCrawling(crawl_job.url_id, "module exited");
    }
  }

}


module.exports = {Crawler};