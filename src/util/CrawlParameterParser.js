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
const ArgumentParser = require('argparse').ArgumentParser;
const {CrawlException} = require('./CrawlException');
const {config} = require('../config');

class CrawlParameterParser extends ArgumentParser {
  constructor() {
    super({
      version: '1.0',
      addHelp: true,
      description: 'Crawly, the framework for large-scale Web measurements.'
    });

  }

  _setupParameter() {
    this.addArgument(
        '--headless',
        {
          action: 'storeTrue',
          help: 'Runs the crawler in a headless mode.'
        }
    );

    this.addArgument(
        '--createTables',
        {
          action: 'storeTrue',
          help: 'Creates the base tables.'
        }
    );

    this.addArgument(
        '--mode',
        {
          required: true,
          help: 'Supply the mode in which the crawler is supposed to be started, you can choose between setup, test and run'
        }
    );


    this.addArgument(
        '--url',
        {
          help: 'Supply the url which is supposed to be crawled in test mode!'
        }
    );

    this.addArgument(
        '--alexa',
        {
          help: 'Supply the alexa file which is supposed to be used to seed!'
        }
    );

    this.addArgument(
        '--count',
        {
          help: 'Supply the number of alexa domains to crawl, e.g. 5000!'
        }
    );


    this.addArgument(
        '--job_id',
        {
          help: 'Supply the job which is supposed to be crawled in run mode!'
        }
    );

    this.addArgument(
        '--crawler_id',
        {
          help: 'Tell us more about yourself, which crawler are you!'
        }
    );

    this.addArgument(
        '--description',
        {
          help: 'Supply the job Job description.'
        }
    );


    this.addArgument(
        '--module',
        {
          action: 'append',
          help: 'Supply the job which is supposed to be crawled in run mode!',
          defaultValue: []
        }
    );

    this.addArgument(
        '--user_data_dir',
        {
          help: 'Supply the user data dir which should be used by the chrome instance, in order to separate multiple instances.'
        }
    );

    this.addArgument(
        '--logLevel',
        {
          help: 'Supply the Level of output information BS=0, INFO=1, WARN=2, ERROR=3, SILENCE=4'
        }
    );

    this.addArgument(
        '--keepBrowserOpen',
        {
          action: 'storeTrue',
          help: 'Keeps the browser open in the test mode to enable manual debugging.'
        }
    );

    this.addArgument(
        '--forever',
        {
          action: 'storeTrue',
          help: 'Run the crawler even if no urls are to be crawled(e.g. when URLs are entered at a later point in time).'
        }
    );

    this.addArgument(
        '--uniqueWithFragment',
        {
          action: 'storeTrue',
          help: 'Keep fragment for uniqueness of URLs.'
        }
    );

    this.addArgument(
        '--chromePath',
        {
          help: 'Instructs the crawler to make use of the supplied instance of chrome instead of the built in version from puppeteer'
        }
    );

    this.addArgument(
        '--delimiter',
        {
          help: 'Optional attribute which changes the delimiter behaviour'
        }
    );

    this.addArgument(
        '--alexaPattern',
        {
          help: 'Pattern which depicts the format of the url file, can contain the following format characters: u - url, r - rank, a - addInfo e.g. "u@@@r@@@a" with the delimiter specified as "@@@"'
        }
    );
  }

  _assertContains(args, keywords) {
    let result = keywords.every((e) => args[e] !== null);
    if (!result) {
      throw new CrawlException(`Missing any of the required arguments for mode ${args.mode}: ${keywords}`)
    }
  }

  parseConfig() {
    this._setupParameter();
    let args = this.parseArgs();
    switch (args.mode) {
      case 'init':
        this._assertContains(args, ['alexa', 'description']);
        break;
      case 'setup':
        this._assertContains(args, ['modules']);
        break;
      case 'test':
        this._assertContains(args, ['url']);
        break;
      case 'run':
        this._assertContains(args, ['job_id', 'crawler_id', 'user_data_dir']);
        break;
      case 'clean':
        break;
      case 'addUrls':
        this._assertContains(args, ['job_id', 'alexa', 'alexaPattern']);
        break;
      default:
        throw new CrawlException('Unrecognized carling mode!')
    }
    config.dynamic = args;
    return config;
  }
}

module.exports = {
  CrawlParameterParser,
};