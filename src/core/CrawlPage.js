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
const util = require('../util/Util');
const path = require('path');

class CrawlPage {
  constructor(chrome, logger) {
    this.chrome = chrome;
    this.logger = logger;
  }

  async getPuppeteerPage() {
    return this.page;
  }

  async preparePage(userAgent) {
    this.page = await this.chrome.newPage();

    await this.page.setViewport({width: 1920, height: 1080});
    await this.page.setUserAgent(userAgent);

    this.CDPsession = await this.page.target().createCDPSession();
    let image_file = await util.getFilePromise(path.join(__dirname, '..', 'assets/pixel.png'));
    let video_file = await util.getFilePromise(path.join(__dirname, '..', 'assets/black.mp4'));

    let image_response = util.makeResponseFromBuffer(image_file);
    let video_response = util.makeResponseFromBuffer(video_file);

    await this.CDPsession.send('Network.setRequestInterception', {patterns: [{}],});
    await this.CDPsession.on('Network.requestIntercepted', async interceptedRequest => {
      if (interceptedRequest.resourceType === 'Image') {
        await this.CDPsession.send('Network.continueInterceptedRequest', {
          interceptionId: interceptedRequest.interceptionId,
          rawResponse: image_response.toString('base64')
        }).catch(this.logger.asCallback('err'));
      } else if (interceptedRequest.resourceType === 'Media') {
        await this.CDPsession.send('Network.continueInterceptedRequest', {
          interceptionId: interceptedRequest.interceptionId,
          rawResponse: video_response.toString('base64')
        }).catch(this.logger.asCallback('err'));
      } else {
        this.CDPsession.send('Network.continueInterceptedRequest', {interceptionId: interceptedRequest.interceptionId}).catch(this.logger.asCallback('err'))
      }
    });
    // real errors crash the page and thus are more likely to be caused by us
    await this.page.on('error', function () {
      for (let arg of arguments) {
        if (arg === undefined) {
          continue
        }
        if (arg.toString().indexOf('Page crashed') !== -1) {
          this.logger.err('Page crashed, thus we resort to browser disconnecting!');
          this.chrome.disconnect();
        }
      }
      this.logger.err(...arguments)
    });
    // normal js errors might aswell just be caused by the developer
    await this.page.on('pageerror', this.logger.asCallback('page_err'));
  }

  async executeModules(stage, modules, save) {
    for (let mod_name in modules) {
      let b = util.benchmark(stage + ' chain of ' + mod_name, this.logger);
      if (!this.page.isClosed()) {
        await modules[mod_name][stage](save).catch(this.logger.asCallback('err'));
      }
      b.stop();
    }
  }

  async navigate(url, timeout) {
    this.response = await this.page.goto(url, {
      waitUntil: 'load',
      timeout: timeout,
    })
  }

  async close() {
    await this.page.close();
  }

  async getUrl() {
    return await this.page.url();
  }
}

module.exports = {
  CrawlPage
};