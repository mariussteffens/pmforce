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
const md5 = require('md5');

class collectScripts extends BaseModule {
  constructor(chrome, page, job, db, logger) {
    super(chrome, page, job, db, logger);
    this.name = 'Empty';
    // will be used by the clean function defined on the BaseModule
    this.moduleTables = ['executioncontexts', 'scripts']
  };

  async setup() {
    let conn = this.db.getConn();
    await conn.query('CREATE TABLE executioncontexts (execid SERIAL PRIMARY KEY, url_id INTEGER references url(url_id), origin varchar(100))');
    await conn.query('CREATE INDEX executioncontexts_url_id ON executioncontexts(url_id)');
    await conn.query('CREATE INDEX executioncontexts_origin ON executioncontexts(origin)');

    await conn.query('CREATE TABLE scripts (id SERIAL PRIMARY KEY, type varchar(10), url TEXT, file_hash CHAR(32), execid INTEGER REFERENCES executioncontexts(execid))');
    await conn.query('CREATE INDEX scripts_hash ON scripts(file_hash)');
    await conn.query('CREATE INDEX scripts_type ON scripts(type)');
  };

  async getSourceToSid(session, sid) {
    let res = await session.send('Debugger.getScriptSource', {scriptId: sid});
    return res.scriptSource;
  }

  async before(save) {
    this.finished = false;
    this.scripts = [];
    this.execContexts = [];

    let pupPage = await this.page.getPuppeteerPage();
    let CDPsession = await pupPage.target().createCDPSession();

    await CDPsession.send('Debugger.enable');
    await CDPsession.send('Runtime.enable');

    await CDPsession.on('Debugger.scriptParsed', (event) => {
      if (this.finished) {
        return
      }
      this.scripts.push({
        url: event.url,
        executionContextId: event.executionContextId,
        source: this.getSourceToSid(CDPsession, event.scriptId)
      })
    });

    await CDPsession.on('Runtime.executionContextCreated', (event) => {
      if (this.finished) {
        return
      }
      this.execContexts.push(event.context)
    });


  }

  async execute(save) {
    this.finished = true;
    if (!save) {
      return;
    }

    let conn = this.db.getConn();
    let execIdToDBId = new Map();

    for (let context of this.execContexts) {
      if (context.origin === '' || context.origin === '://') {
        // FIXME: there might be cases where the origin is not set but it is a valid context that needs analyzing, e.g. about:blank frames
        // To fix this we need to remember frame creation and resolve the origin on the parent frames
        continue
      }
      let res = await conn.query('INSERT INTO executioncontexts (url_id, origin) VALUES ($1,$2) RETURNING execid', [this.job.url_id, context.origin]);
      execIdToDBId.set(context.id, res.rows[0].execid)
    }

    for (let script of this.scripts) {
      if (!execIdToDBId.has(script.executionContextId)) {
        // Only applicable if we really missed some precious contexts before, but we cannot do anything here anymore
        continue
      }
      if (!script.url.startsWith('http')) {
        await conn.query('INSERT INTO scripts (execid, type, file_hash) VALUES ($1,$2,$3)', [execIdToDBId.get(script.executionContextId), 'inline', md5(script.source)]);
      } else {
        await conn.query('INSERT INTO scripts (execid,type,url, file_hash) VALUES ($1,$2,$3,$4)', [execIdToDBId.get(script.executionContextId), 'inline', script.url, md5(script.source)]);
      }
    }
  }
}


function createModule(chrome, page, job, db, logger) {
  return new collectScripts(chrome, page, job, db, logger);
}

module.exports = {
  createModule,
};