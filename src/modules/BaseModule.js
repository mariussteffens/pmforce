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
const {CrawlException} = require('../util/CrawlException');

class BaseModule {
  constructor(chrome, page, job, db, logger) {
    this.chrome = chrome;
    this.page = page;
    this.job = job;
    this.db = db;
    this.logger = logger;

    this.name = 'BaseModule';
    this.moduleTables = []

  }

  async setup() {
    throw new CrawlException('setup function of module was not implemented!');
  };

  async clean() {
    let conn = this.db.getConn();
    for (let table_name of this.moduleTables) {
      await conn.query('DROP TABLE ' + table_name + ' CASCADE').catch(this.logger.asCallback('err'));
    }
  };

  async before(save) {
    throw new CrawlException('before function of module was not implemented!');
  };

  async execute(save) {
    throw new CrawlException('execute function of module was not implemented!');
  }
}


module.exports = {BaseModule};