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
const {BaseModule} = require('./BaseModule');

class EmptyModule extends BaseModule {
  constructor(chrome, page, job, db, logger) {
    super(chrome, page, job, db, logger);
    this.name = 'Empty';
    // will be used by the clean function defined on the BaseModule
    this.moduleTables = ['sometable']
  };

  async setup() {
    // FIXME: create table which store your information
    //e.g., let conn = this.db.getConn();
    // await conn.query('CREATE TABLE sometable (id SERIAL PRIMARY KEY, name VARCHAR)');
  };

  async before(save) {
    // FIXME: this code os execute before the page code runs
    // It is useful for e.g. hooking dom functionality
    // let pupPage = this.page.getPuppeteerPage();
    // let CDPsession = await pupPage.target().createCDPSession();
    // await CDPsession.send('Network.enable').catch(err); // tell chrome to collect network information
    // await CDPsession.on('Network.responseReceived', function(event){console.log(event)})
    // pupPage.evaluateOnNewDocument(...)
  }

  async execute(save) {
    // FIXME: this code is executed after the page has run for the timing specified in the config
    // You can retrieve reports collected while the browser was running and wrap up any data collection here
  }
}


function createModule(chrome, page, job, db, logger) {
  return new EmptyModule(chrome, page, job, db, logger);
}

module.exports = {
  createModule,
};