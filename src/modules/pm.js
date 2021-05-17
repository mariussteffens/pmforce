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
const exec = require('child_process').exec;

const TEST_TIMEOUT = 1000 * 60 * 2;
const SAT_TIMEOUT = 1000 * 30;
const HANDLER_PATH = '/handlers';

class PMModule extends BaseModule {
  constructor(chrome, page, job, db, logger) {
    super(chrome, page, job, db, logger);
    this.name = 'pm';
    // will be used by the clean function defined on the BaseModule
    this.moduleTables = ['handler', 'external_func', 'base_constraints', 'exploit_candidates', 'report', 'flow_flagged_for_manual'];
    this.handlerIdToResolve = new Map();
    this.handlerPromises = [];
    this.confirmedExploits = new Map();
    this.exploitCandidates = new Map();
    this.funs = [];
    this.reports = [];
  };

  async setup() {
    let conn = this.db.getConn();

    await conn.query('CREATE TABLE handler (handler_id SERIAL PRIMARY KEY, host VARCHAR(100), site VARCHAR(80), url TEXT, handler_hash CHAR(32), url_id INTEGER REFERENCES url(url_id))');
    await conn.query('CREATE UNIQUE INDEX handler_host ON handler(host, handler_hash)');
    await conn.query('CREATE INDEX handler_site ON handler(site)');
    await conn.query('CREATE INDEX handler_hash ON handler(handler_hash)');

    await conn.query('CREATE TABLE external_func (handler_id INTEGER REFERENCES handler(handler_id), func_hash CHAR(32))');
    await conn.query('CREATE UNIQUE INDEX external_func_uniq ON external_func(handler_id, func_hash)');

    await conn.query('CREATE TABLE base_constraints (constraint_id SERIAL PRIMARY KEY, handler_id INTEGER REFERENCES handler(handler_id), constraints JSONB)');
    await conn.query('CREATE INDEX constraint_handler_id ON base_constraints(handler_id)');

    await conn.query('CREATE TABLE exploit_candidates (exploit_id SERIAL PRIMARY KEY, constraint_id INTEGER REFERENCES base_constraints(constraint_id), exploit_constraints JSONB, types JSONB, success SMALLINT, sink VARCHAR(20), addInfo TEXT)');
    await conn.query('CREATE INDEX exploit_candidates_constraint ON exploit_candidates(constraint_id)');
    await conn.query('CREATE INDEX exploit_candidates_sink ON exploit_candidates(sink)');
    await conn.query('CREATE INDEX exploit_candidates_success ON exploit_candidates(success)');

    await conn.query('CREATE TABLE flow_flagged_for_manual (manual_flow_id SERIAL PRIMARY KEY, constraint_id INTEGER REFERENCES base_constraints(constraint_id), exploit_constraints JSONB, sink VARCHAR(20))');
    await conn.query('CREATE INDEX manual_flow_constraint ON flow_flagged_for_manual(constraint_id)');
    await conn.query('CREATE INDEX manual_flow_sinks ON flow_flagged_for_manual(sink)');


    await conn.query('CREATE TABLE report (report_id SERIAL PRIMARY KEY, exploit_id INTEGER REFERENCES exploit_candidates(exploit_id), message JSONB, addInfo JSONB);');
    await conn.query('CREATE INDEX report_exploit ON report(exploit_id)');
  };

  async before(save) {
    // scoping hack to allow for access of the module in callback functions
    let that = this;

    this.conn = this.db.getConn();
    this.save = save;

    this.pupPage = await this.page.getPuppeteerPage();
    this.CDPsession = await this.pupPage.target().createCDPSession();


    await this.CDPsession.send('Runtime.enable');
    await this.CDPsession.send('Debugger.enable');


    let packedAnalyzer = await util.readFilePromise('./external/pm/dist/bundle.js');
    let iroh = await util.readFilePromise('./external/pm/iroh.js');

    // export most of the interactions between analysis and db/constraint solving
    await this.pupPage.exposeFunction('__trySolveForSat', this.trySolveForSat.bind(this));
    await this.pupPage.exposeFunction('__reportBaseConstraint', this.reportBaseConstraint.bind(this));
    await this.pupPage.exposeFunction('__report_manual_exploit', this.reportForManualExploitation.bind(this));
    await this.pupPage.exposeFunction('__shouldAnalyzeHandler', this.shouldAnalyzeHandler.bind(this));
    await this.pupPage.exposeFunction('__reportExternalFun', this.reportExternalFun.bind(this));
    await this.pupPage.exposeFunction('__report_exploits', this.reportExploits.bind(this));
    await this.pupPage.exposeFunction('__report_failed_handler', this.reportFailedHandler.bind(this));
    await this.pupPage.exposeFunction('__clean_for_exploit', this.cleanWindowForValidation.bind(this));

    // Inject functions to retrieve effective frame URL and hook window.open to inject our reporting functionalities
    await this.pupPage.evaluateOnNewDocument('(' + (function () {
      window.__getContextFromOpener = function (op) {
        if (op === null) {
          return undefined
        }
        return window.__getContextUrl(op);
      };

      window.__getContextUrl = function (w) {
        let cur_window = w;
        while (1) {
          if (cur_window.location.href.startsWith('http'))
            return cur_window.location.href;
          if (cur_window === cur_window.parent)
            return window.__getContextFromOpener(cur_window.opener);
          cur_window = cur_window.parent;

        }
      };
      let old_open = window.open;
      window.open = function () {
        let win = old_open.apply(window, arguments);
        win.eval('(function (){let ourLog = window.opener.__our_log;window.' + '__crawly__' + '= function(id){let cur_loc = window.__getContextUrl(window);ourLog("[crawly]"+ JSON.stringify({url:cur_loc, id:id}))}})();');
        win.eval('window.__getContextFromOpener = ' + window.__getContextFromOpener.toString());
        win.eval('window.__getContextUrl = ' + window.__getContextUrl.toString());
        return win;
      }
    }).toString() + ' )()');

    // inject our analysis framework into every frame
    await this.pupPage.evaluateOnNewDocument('(function (){window.__our_log = console.log;let ourLog = console.log;window.__crawly__ = function(id){let cur_loc = window.__getContextUrl(window);ourLog("[crawly]"+ JSON.stringify({url:cur_loc, id:id}))}})()');
    await this.pupPage.evaluateOnNewDocument('(function(){' + iroh + '})()');
    await this.pupPage.evaluateOnNewDocument('(function(){' + packedAnalyzer + '})()');
    await this.CDPsession.on('Runtime.consoleAPICalled', async (logEntry) => {
      if (logEntry.type === 'log') {
        let message = logEntry.args[0].value;
        if (message && message.startsWith && message.startsWith('[crawly]')) {
          let stack = logEntry.stackTrace;
          let parsed = JSON.parse(message.slice(8));
          that.reports.push(parsed);
          that.confirmedExploits.set(parsed['id'], {url: parsed['url'], stack: stack});
        }
      }
    });

    await this.CDPsession.on('Debugger.paused', async (debugInfos) => {
      // When the debugger is paused, we need to verify that this is indeed a call
      // where we want to fetch values from other scopes
      let cfs = debugInfos.callFrames;
      if (cfs.length > 0 && cfs[0].functionName === 'run') {
        let fun_obj = await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
          callFrameId: cfs[0].callFrameId,
          //  expression: '[__id_to_set, __fun_obj]
          expression: '__fun_obj'
        });
        let identifer_obj = await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
          callFrameId: cfs[0].callFrameId,
          expression: '__id_to_set'
        });
        let props = await that.requestPropertiesFromObjId(fun_obj.result.objectId);
        // If these properties are defined in the most recent scope then we have triggered the debugger to fill values
        if (props.internalProperties) {
          breakout_here:
              for (let int_props of props.internalProperties) {
                if (int_props.name === '[[Scopes]]') {
                  let scope_props = await that.requestPropertiesFromObjId(int_props.value.objectId);
                  for (let scope_obj of scope_props.result) {
                    let scope_obj_props = await that.requestPropertiesFromObjId(scope_obj.value.objectId);
                    for (let elem of scope_obj_props.result) {
                      if (elem.name === identifer_obj.result.value) {
                        await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                          callFrameId: cfs[0].callFrameId,
                          expression: '__fun_code = ' + elem.value.description
                        });
                        if (elem.value.objectId) {
                          await that.CDPsession.send('Runtime.callFunctionOn', {
                            functionDeclaration: 'function(){window.__passing_obj=this}',
                            objectId: elem.value.objectId
                          });
                          // FIXME: while setting things on the window is suboptimal, setting them for the local scope
                          //  of our functions induces weird side-effects which appears to be a bug in the devtools protocol
                          await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                            callFrameId: cfs[0].callFrameId,
                            expression: 'window.' + elem.name + ' = window.__passing_obj;'
                          });
                          console.log('Setting', elem.name, 'to', elem.value)
                        } else {
                          let val;
                          if (elem.value.type !== 'string') {
                            val = elem.value.value
                          } else {
                            val = '"' + elem.value.value + '"'
                          }
                          await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                            callFrameId: cfs[0].callFrameId,
                            expression: '__fun_code = true'
                          });
                          // FIXME: while setting things on the window is suboptimal, setting them for the local scope
                          //  of our functions induces weird side-effects which appears to be a bug in the devtools protocol
                          await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                            callFrameId: cfs[0].callFrameId,
                            expression: 'window.' + elem.name + ' =' + val + ';'
                          });
                          console.log('Setting', elem.name, 'to', val)
                        }
                        break breakout_here;
                      }
                    }
                  }
                }
              }
        }
        await that.CDPsession.send('Debugger.resume');
      }
    });
    // we need to circumvent CSP that disallow unsafe-eval, as these are hindering our analysis which relies on eval
    await this.pupPage.setBypassCSP(true);

    // activate navigation lock to hinder navigation from force execution
    this.pupPage.on('request', req => {
      if (req.isNavigationRequest() && req.frame() === that.pupPage.mainFrame() && that.pupPage.mainFrame().url().startsWith('http')) {
        console.log('abort');
        req.abort('aborted');
      } else {
        req.continue();
      }
    });
    await this.pupPage.setRequestInterception(true);
  }

  async execute(save) {
    this.logger.log('waiting for results from all handlers writes', this.handlerPromises.length);
    await Promise.all(this.handlerPromises);
    console.log('Candidates:', this.exploitCandidates);
    console.log('Confirmed:', this.confirmedExploits);
    console.log('======================')
    for (let handler_id of this.exploitCandidates.keys()) {
      for (let entry of this.exploitCandidates.get(handler_id)) {
        for (let cand of entry['candidates']) {
          if (this.confirmedExploits.has(cand['exploitId'])) {
            console.log('We found a working exploit with:', cand)
          }
        }
      }
    }
    console.log('======================')

    if (!save) {
      return
    }
    this.logger.log('waiting for results to be entered in DB');
    for (let handler_id of this.exploitCandidates.keys()) {
      for (let entry of this.exploitCandidates.get(handler_id)) {
        for (let cand of entry['candidates']) {
          if (this.confirmedExploits.has(cand['exploitId'])) {
            let addInfo = this.confirmedExploits.get(cand['exploitId']);
            this.conn.query('INSERT INTO report (exploit_id,message,addInfo) VALUES ($1,$2, $3)', [cand['exploitCandidateId'], JSON.stringify(this.escapeObj(cand['message'])), JSON.stringify(addInfo)]);
          }
        }
      }
      let all_write = [];
      for (let fun of this.funs) {
        let fun_hash = md5(fun);
        all_write.push(util.writeFilePromise(`${HANDLER_PATH}/${fun_hash.substr(0, 2)}/${fun_hash}`, fun))
      }
      this.logger.log('waiting for filedisk writes');
      await Promise.all(all_write);
    }
  }

  async reportBaseConstraint(constraints, handlerID) {
    if (this.save) {
      let res = await this.conn.query('INSERT INTO base_constraints (constraints, handler_id) VALUES ($1,$2) RETURNING constraint_id', [JSON.stringify(constraints), handlerID]);
      return res.rows[0].constraint_id;
    } else {
      this.logger.log(JSON.stringify(constraints), handlerID)
    }
    return 'constraint_' + util.randomString();
  };

  async reportConstraintSatisfiability(constraintId, constraints, expConstraints, types, success, addInfo = "", sink) {
    if (this.save) {
      let res = await this.conn.query('INSERT INTO exploit_candidates (exploit_constraints, success, addInfo,constraint_id, sink, types) VALUES ($1,$2,$3,$4, $5,$6) RETURNING exploit_id', [JSON.stringify(expConstraints), success, addInfo, constraintId, sink, JSON.stringify(types)]);
      return res.rows[0].exploit_id;
    } else {

    }
    return 'exploit_' + util.randomString();
  };

  async reportExploits(exploits, handlerId) {
    this.exploitCandidates.set(handlerId, exploits);
    // collected generated exploits for this specific handler
    this.logger.log('Calling fun for', handlerId, exploits);
    this.handlerIdToResolve.get(handlerId)();
  }

  async reportFailedHandler(handlerId, reason) {
    this.logger.err('Iroh could not handle this thing here', handlerId, reason);
    this.handlerIdToResolve.get(handlerId)();
  }

  async cleanWindowForValidation() {
    let pages = await this.chrome.pages();
    for (let p of pages.slice(2)) {
      await p.close();
    }
  }

  async trySolveForSat(constraints, types, constraintId, exp_constraints, sink) {
    let p;
    try {
      p = await new Promise((resolve) => {
        let process = exec('python3 ./external/pm/python/ConstraintSolver.py', {
          timeout: SAT_TIMEOUT,
        }, (err, stdout, stderr) => {
          resolve({stdout: stdout, stderr: stderr, err: err})
        });
        process.stdin.write(JSON.stringify({constraints: constraints, types: types}));
        process.stdin.end()
      })
    } catch (e) {
      await this.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, e, sink);
      return undefined
    }
    if (p.err) {
      if (p.err.killed) {
        // this captures kills by the exec function due to timeouts
        await this.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, 'Timeout', sink);
      } else {
        await this.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, p.stderr, sink);
      }
      return undefined
    } else if (p.stderr.length > 0) {
      // we have some info on stderr
      await this.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, p.stderr, sink);
      return undefined;
    } else {
      let assignments = JSON.parse(p.stdout);
      this.logger.log('Assignements', assignments);
      let eId = await this.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 1, assignments, sink);
      return [assignments, eId];
    }
  };

  async reportExternalFun(funString, handlerId) {
    try {
      if (this.save) {
        await this.conn.query('INSERT INTO external_func (handler_id,func_hash) VALUES ($1,$2)', [handlerId, md5(funString)]);
        this.funs.push(funString);
      }
    } catch (e) {
      this.logger.err(e)
    }
    return undefined
  };

  async reportForManualExploitation(report, handlerID) {
    try {
      if (this.save) {
        let res = await this.conn.query('INSERT INTO base_constraints (constraints, handler_id) VALUES ($1,$2) RETURNING constraint_id', [JSON.stringify(report['constraints']), handlerID]);
        let b_id = res.rows[0].constraint_id;
        await this.conn.query('INSERT INTO flow_flagged_for_manual (constraint_id, exploit_constraints,sink) VALUES ($1,$2, $3)', [b_id, JSON.stringify(report['sinkObject']), report['sink']]);
      }
    } catch (e) {
      this.logger.err(e)
    }
    return undefined
  };

  async shouldAnalyzeHandler(frameUrl, handler) {
    try {
      let handlerId = undefined;
      let handlerHash = md5(handler);
      if (this.save) {
        let parsed = util.parseUrl(frameUrl);
        let host = parsed.hostname;
        let site = util.get_psl(parsed);
        let res = await this.conn.query('INSERT INTO handler (host,site, handler_hash, url, url_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING handler_id', [host, site, handlerHash, frameUrl, this.job.url_id]);
        if (res.rows.length) {
          handlerId = res.rows[0].handler_id;
        } else {
          this.logger.log('not analyzing due to duplicate in DB', handlerHash, handlerId);
          return undefined
        }
        this.funs.push(handler);
      } else {
        if (this.handlerIdToResolve.has(handlerId)) {
          return undefined
        }
        handlerId = 'handler_' + util.randomString();
      }
      this.handlerPromises.push(new Promise((resolve => {
        let x = setTimeout(resolve, TEST_TIMEOUT);
        this.handlerIdToResolve.set(handlerId, function () {
          clearTimeout(x);
          resolve();
        });
      })));
      // handlerId is undefined when we have seen the handler already
      return handlerId
    } catch (e) {
      this.logger.err(e)
    }
    return undefined
  };

  async requestPropertiesFromObjId(objId) {
    return await this.CDPsession.send('Runtime.getProperties', {
      objectId: objId,
    });
  };

  escapeObj(obj) {
    if (typeof obj === 'object') {
      for (let key of Object.keys(obj)) {
        obj[key] = this.escapeObj(obj[key]);
      }
    } else if (typeof obj === 'string') {
      obj = escape(obj);
    }
    return obj
  }


}


function createModule(chrome, page, job, db, logger) {
  return new PMModule(chrome, page, job, db, logger);
}

module.exports = {
  createModule,
};
