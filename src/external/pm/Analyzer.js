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

import {ForcedRun} from "./ForcedRun.js";
import evHelper from "./evaluationHelper.js";
import {deepClone, makeProxy, randomString, delay, isProxy, deProxifyArguments} from './util.js';
import {generateExploitForReport} from './ExploitGenerator.js';
import {getFunctionString} from "./util";

// global mapping from already instrumented functions to their instrumented counterparts
let fun_mapping = new Map();
// selectively enable/disable proxying of document.cookie localStorage values
let shouldPrivacyThings = false;


function checkParamForProxies(e, sinkID, indizes = undefined, manual = false) {
  let args = e.arguments;
  if (indizes === undefined) {
    indizes = args.keys();
  }
  for (let i of indizes) {
    if (args.length > i) {
      if (args[i] && isProxy(args[i])) {
        if (!manual)
          e.instance.ForceExecution.emitSinkAccess(args[i], sinkID, i, e.hash);
        else
          e.instance.ForceExecution.emitSinkAccess(args[i], sinkID, i, e.hash, 'manual');
      }
    }
  }
}

function parseCookies() {
  let c_st = document.cookie;
  let parsed = {};
  for (let splitted of c_st.split(';')) {
    if (splitted.indexOf('=') === -1) {
      continue
    }
    let [key, val] = splitted.split('=');
    parsed[key.trim()] = val.trim()
  }
  return parsed;
}

function extractConstraintFromProxy(p) {
  let constraint;
  if (p.__is_real_value) {
    constraint = {ops: deepClone(p.__get_ops), value: p.__get_identifier, isRealValue: true, val: p.__get_real_obj};
  } else {
    constraint = {ops: deepClone(p.__get_ops), identifier: p.__get_identifier};
  }
  return constraint;
}

function checkForFlowToSink(e) {
  // references to other windows do not yet work.
  if (e.call === document.write) {
    checkParamForProxies(e, 'document.write');
  }
  if (getFunctionString(e.call) === "function write() { [native code] }") {
    checkParamForProxies(e, 'document.write');
  }
  if (e.call === eval) {
    checkParamForProxies(e, 'eval', [0]);
  }
  if (e.call === setTimeout) {
    checkParamForProxies(e, 'setTimeout', [0]);
  }
  if (e.call === setInterval) {
    checkParamForProxies(e, 'setInterval', [0]);
  }
  if (e.callee === 'html') {
    checkParamForProxies(e, 'jquery', [0]);
  }
  if (e.call === Element.prototype.insertAdjacentHTML) {
    checkParamForProxies(e, 'insertAdjacentHTML', [1]);
  }
  if (e.callee === 'postMessage') {
    if (e.arguments.length && isProxy(e.arguments[0]) && (e.arguments[0].__get_identifier.startsWith('cookie') || e.arguments[0].__get_identifier.startsWith('storage'))) {
      checkParamForProxies(e, 'postMessageLeak', [0], true);
    } else {
      checkParamForProxies(e, 'postMessageRelay', [0], true);
    }
  }
  if (e.call === localStorage.setItem) {
    if (e.arguments.length === 2 && isProxy(e.arguments[0]) && isProxy(e.arguments[1])) {
      e.instance.ForceExecution.emitStorageAccess(e.arguments[0], e.arguments[1], e.hash)
    }

  }
}

function generateBinaryResult(left, right, op, type, forced_execution) {
  let isLeftProxy = isProxy(left);
  let isRightProxy = isProxy(right);
  if (isLeftProxy || isRightProxy) {
    let identifier;
    let last_ops;
    let l_value = left;
    let r_value = right;
    let res_value, side, isRealValue;
    if (isLeftProxy && isRightProxy) {
      identifier = l_value.__get_identifier;
      isRealValue = l_value.__is_real_value;
      last_ops = l_value.__get_ops;
      res_value = evHelper.evalBinary(op, l_value.__get_real_obj, r_value.__get_real_obj);
      r_value = extractConstraintFromProxy(r_value);
      side = 'both';
    } else if (isLeftProxy) {
      identifier = l_value.__get_identifier;
      last_ops = l_value.__get_ops;
      isRealValue = l_value.__is_real_value;
      l_value = l_value.__get_real_obj;
      res_value = evHelper.evalBinary(op, l_value, r_value);
      side = 'left';
      if (last_ops.length < 2)
        forced_execution.addTypeInfo(identifier, typeof r_value)
    } else {
      identifier = r_value.__get_identifier;
      last_ops = r_value.__get_ops;
      isRealValue = r_value.__is_real_value;
      r_value = r_value.__get_real_obj;
      res_value = evHelper.evalBinary(op, l_value, r_value);
      if (last_ops.length < 2)
        forced_execution.addTypeInfo(identifier, typeof l_value);
      side = 'right';
    }
    let new_ops = deepClone(last_ops);
    new_ops.push({
      "type": type,
      "op": op,
      "val": isLeftProxy ? r_value : l_value,
      side: side
    });
    return makeProxy(res_value, identifier, new_ops, isRealValue);

  }
}

function negateConstraint(constraint) {
  return {'type': 'Unary', 'op': '!', val: constraint};
}

function isNativeFunc(fun) {
  return getFunctionString(fun).indexOf('native code') > -1;
}

function isDestructiveCall(e) {
  if (getFunctionString(e.call) === "function removeChild() { [native code] }") {
    return true
  }
  return false;
}

function instrumentStage(stage) {
  let funlistener = stage.addListener(Iroh.FUNCTION);
  funlistener.on('return', (e) => {
    let saved_state = e.instance.ForceExecution.savedFunState;
    if (e.instance.ForceExecution.pathConstraints.length > 0 && saved_state.length > 0) {
      for (let constraint of e.instance.ForceExecution.pathConstraints) {
        saved_state[saved_state.length - 1].push(constraint);
      }
    }
  });

  let listener = stage.addListener(Iroh.CALL);
  listener.on("before", (e) => {
    checkForFlowToSink(e);
    if (isDestructiveCall(e)) {
      console.warn('replacing destructive call with no-op', e.call);
      e.call = function () {
      };
      return;
    }

    console.warn('this is before call', e);
    if (e.external) {
      if (!isNativeFunc(e.call) && e.object === null) {
        // If it is not a native function we can hook it on the fly
        let hooked;
        if (fun_mapping.has(getFunctionString(e.call))) {
          hooked = fun_mapping.get(getFunctionString(e.call));
        } else {
          window.__reportExternalFun(getFunctionString(e.call), e.instance.ForceExecution.handler_id);
          hooked = new Iroh.Stage('(' + getFunctionString(e.call) + ')');
          instrumentStage(hooked);
          fun_mapping.set(getFunctionString(e.call), hooked);
        }
        let __begin_tests = () => {
          e.instance.ForceExecution.inTest = true;
          e.instance.ForceExecution.constraintBuffer = [];

        };
        hooked.ForceExecution = e.instance.ForceExecution;
        let deepClone = window.deepClone;
        e.call = eval(hooked.script);

        e.instance.ForceExecution.savedFunState.push(e.instance.ForceExecution.pathConstraints);
        e.instance.ForceExecution.pathConstraints = [];

      } else {
        if (e.object && e.object === JSON && e.callee === 'parse') {
          e.arguments = ['{}']
        }
        for (let i = 0; i < e.arguments.length; i++) {
          let arg = e.arguments[i];
          if (isProxy(arg)) {
            e.arguments[i] = e.arguments[i].__get_real_obj
          }
        }
      }
    }
  });

  listener.on("after", (e) => {
    console.log('calling', e);
    if (e.external) {
      if (!isNativeFunc(e.call) && e.object === null) {
        // this is the case when we hooked the function on the fly and need to restore this functions setting
        e.instance.ForceExecution.pathConstraints = e.instance.ForceExecution.savedFunState.pop();
      }
    }
    if (e.object !== null) {
      if (isProxy(e.object)) {
        // if we call a function on the object it needs to be a real thing thus we need to put this into the SMT solver
        // otherwise we might not consider this object if it does not partake in a conditional but this call would throw an exception
        e.instance.ForceExecution.emitConstraint(extractConstraintFromProxy(e.object));
        let identifier = e.object.__get_identifier;
        let last_ops = e.object.__get_ops;
        let new_ops = deepClone(last_ops);
        let isRealValue = e.object.__is_real_value;

        new_ops.push({
          type: 'member_function',
          function_name: e.callee,
          args: deProxifyArguments([].slice.call(e.real_arguments))
        });
        e.return = makeProxy(e.return, identifier, new_ops, isRealValue);
      } else if (e.object.__proto__ === RegExp.prototype && e.call === /a/.test && isProxy(e.real_arguments[0])) {
        let p = e.real_arguments[0];
        let identifier = p.__get_identifier;
        let last_ops = p.__get_ops;
        let new_ops = deepClone(last_ops);
        let isRealValue = p.__is_real_value;


        let regex = e.object.toString();

        new_ops.push({
          type: 'member_function',
          function_name: 'match',
          args: [regex.slice(1).slice(0, regex.lastIndexOf('/') - 1)]
        });
        e.return = makeProxy(e.return, identifier, new_ops, isRealValue);
      } else if (e.arguments.length) {
        if (e.object === JSON && isProxy(e.real_arguments[0])) {
          // the case for e.g. JSON.parse
          let p = e.real_arguments[0];
          let identifier = p.__get_identifier;
          let last_ops = p.__get_ops;
          let new_ops = deepClone(last_ops);
          let isRealValue = p.__is_real_value;

          new_ops.push({
            type: 'external_function',
            function_name: 'JSON.parse',
            args: deProxifyArguments([].slice.call(e.real_arguments))
          });
          e.return = makeProxy(e.return, identifier, new_ops, isRealValue);
        } else if (e.object === localStorage && e.callee === 'getItem') {
          if (shouldPrivacyThings) {
            let ops = [];
            let id;
            if (isProxy(e.real_arguments[0])) {
              ops.push({
                type: 'member_function',
                function_name: e.callee,
                args: [extractConstraintFromProxy(e.real_arguments[0])]
              });
              id = '';
            } else {
              id = e.real_arguments[0]
            }
            e.return = makeProxy(id, 'storage', ops, true)
          }
        } else {
          let hasProxyAsArgument = false;
          let args = [];
          for (let arg of e.real_arguments) {
            if (isProxy(arg)) {
              hasProxyAsArgument = true;
              args.push(extractConstraintFromProxy(arg))
            } else {
              args.push(arg)
            }
          }
          if (hasProxyAsArgument) {
            e.return = makeProxy(e.object, e.object, [{
              type: 'member_function',
              function_name: e.callee,
              args: args
            }], true)
          }
        }
      }
    } else if (e.real_arguments.length === 1 && isProxy(e.real_arguments[0]) && !e.name.startsWith("$$ANON") && isNativeFunc(e.call)) {
      let p = e.real_arguments[0];
      let identifier = p.__get_identifier;
      let last_ops = p.__get_ops;
      let new_ops = deepClone(last_ops);
      let isRealValue = p.__is_real_value;

      new_ops.push({
        type: 'external_function',
        function_name: e.name,
        args: deProxifyArguments([].slice.call(e.real_arguments))
      });

      e.return = makeProxy(e.return, identifier, new_ops, isRealValue)
    }

  });

  let memberListener = stage.addListener(Iroh.MEMBER);
  memberListener.on("fire", (e) => {
    console.log('Member', e);
    if (e.object === document && e.property === 'cookie' && shouldPrivacyThings) {
      e.object = {};
      e.object[e.property] = makeProxy(document.cookie, 'cookie', [], true)
    }
    if (e.object === localStorage && typeof e.object[e.property] !== 'function' && shouldPrivacyThings) {
      let ops = [];
      let id;
      if (isProxy(e.property)) {
        ops.push({
          type: 'member_function',
          function_name: 'getItem',
          args: [extractConstraintFromProxy(e.property)]
        });
        id = '';
      } else {
        id = e.property
      }
      e.object = {};

      e.object[e.property] = makeProxy(id, 'storage', ops, true)
    }
    // takes care that environment does not produce errors when accessing further things on non-existing properties
    // let accessed_prop = e.object[e.property];
    //if (!isProxy(accessed_prop) && accessed_prop === undefined) {
    //  e.object[e.property] = {};
    //}
  });

  let assignListener = stage.addListener(Iroh.ASSIGN);
  assignListener.on("fire", (e) => {
    console.log('Assign', e);
    if ((e.property === 'innerHTML' || e.property === 'outerHTML') && e.value && isProxy(e.value)) {
      e.instance.ForceExecution.emitSinkAccess(e.value, 'innerHTML', -1, e.hash);
    }
    if ((e.property === 'textContent' || e.property === 'innerText' || e.property === 'text') && e.object instanceof HTMLScriptElement && e.value && isProxy(e.value)) {
      e.instance.ForceExecution.emitSinkAccess(e.value, 'scriptTextContent', -1, e.hash);
    }
    if (e.object === localStorage && e.property && isProxy(e.property) && e.value && isProxy(e.value)) {
      e.instance.ForceExecution.emitStorageAccess(e.property, e.value, e.hash);
    }
    if (e.object === document && e.property && e.property === 'cookie' && e.value && isProxy(e.value)) {
      e.instance.ForceExecution.emitSinkAccess(e.value, 'cookie', -1, e.hash);
    }
  });

  let IFListener = stage.addListener(Iroh.IF);
  IFListener.on("test", (e) => {
    console.log("IFTEST", e, e.value);
    let constraint;
    if (constraint === undefined && e.value !== undefined && isProxy(e.value)) {
      constraint = extractConstraintFromProxy(e.value);
    }
    if (constraint && e.instance.ForceExecution.stale.has(e.hash)) {
      constraint = negateConstraint(constraint);
    }
    if (constraint)
      e.instance.ForceExecution.emitConstraint(constraint);

    e.instance.ForceExecution.clearLogicalConstraintBuffer();

    e.value = !e.instance.ForceExecution.stale.has(e.hash);
    console.log("Forcing branch to", e.value)
  });
  IFListener.on("enter", (e) => {
    console.log("IFENTER", e, e.value);
    // For nested ifs we need to save the "old" hash and retrieve it later on
    // such that we can really pinpoint which if was potential the culprit of an error and thus label this as stale
    e.instance.ForceExecution.BBHashMap.set(e.hash, e.instance.ForceExecution.curBBHash);
    e.instance.ForceExecution.curBBHash = e.hash;
  });

  IFListener.on("leave", (e) => {
    console.log("IFLEAVE", e, e.value);
    //e.instance.ForceExecution.popConstraint();
    e.instance.ForceExecution.curBBHash = e.instance.ForceExecution.BBHashMap.get(e.hash);

    if (e.instance.ForceExecution.shouldLabelAsStale && !e.instance.ForceExecution.stale.has(e.hash)) {
      e.instance.ForceExecution.shouldLabelAsStale = false;
      e.instance.ForceExecution.stale.add(e.hash);
    }
    console.log("leave if", e)
  });

  let ELSEListener = stage.addListener(Iroh.ELSE);
  ELSEListener.on("enter", (e) => {
    console.log("enter else");
  });
  ELSEListener.on("leave", (e) => {
    console.log("leave else");

  });
  let SWITCHListener = stage.addListener(Iroh.SWITCH);

  SWITCHListener.on("test", (e) => {
    console.log("SWICHTEST", e);
    e.instance.ForceExecution.switchValue = e.value;
    e.value = e.instance.ForceExecution.randomValue;
  });

  let CASEListener = stage.addListener(Iroh.CASE);

  CASEListener.on("test", (e) => {
    console.log("CASETEST", e);
    if (e.instance.ForceExecution.stale.has(e.hash)) {
      e.value = 'nope';
    } else {
      if (isProxy(e.instance.ForceExecution.switchValue)) {
        let constraint = extractConstraintFromProxy(e.instance.ForceExecution.switchValue);
        constraint['ops'].push({
          "type": "Binary",
          "op": '==',
          "val": e.value,
          "side": 'right',
        })
        ;
        e.instance.ForceExecution.emitConstraint(constraint);
      }
      e.value = e.instance.ForceExecution.randomValue;
    }
    console.log("Forcing branch to", e.value)
  });

  CASEListener.on("enter", (e) => {
    console.log("enter case", e);
    e.instance.ForceExecution.BBHashMap.set(e.hash, e.instance.ForceExecution.curBBHash);
    e.instance.ForceExecution.curBBHash = e.hash;

  });
  CASEListener.on("leave", (e) => {
    e.instance.ForceExecution.curBBHash = e.instance.ForceExecution.BBHashMap.get(e.hash);

    if (e.instance.ForceExecution.shouldLabelAsStale && !e.instance.ForceExecution.stale.has(e.hash)) {
      e.instance.ForceExecution.shouldLabelAsStale = false;
      e.instance.ForceExecution.stale.add(e.hash);
    }
    console.log("leave case");
  });

  let LogicalListener = stage.addListener(Iroh.LOGICAL);
  LogicalListener.on("before_second", (e) => {
    console.warn('before second');
    // First we capture the actual result which in the case of chained
    if (e.left !== null && typeof e.left == "object" && e.left.__is_proxy !== undefined) {
      // Lazy execution leads to a situation where always the left one is the finished one, the right one is yet to be evaluated
      e.instance.ForceExecution.emitLogicalConstraint(e.left.__get_ops, e.op, e.left.__get_identifier);
    }
    // We need to capture all logical things until end of if test.
    e.result = e.op !== '||';
  });

  LogicalListener.on("fire", (e) => {
    console.warn("Logical Comparator", e);
    let res = generateBinaryResult(e.real_left, e.real_right, e.op, 'Logical', e.instance.ForceExecution);
    if (res !== undefined) {
      e.result = res;
    }
  });

  let BinaryListener = stage.addListener(Iroh.BINARY);
  BinaryListener.on("fire", (e) => {
    console.warn("BINARY Comparator", e);
    let res = generateBinaryResult(e.left, e.right, e.op, 'Binary', e.instance.ForceExecution);
    if (res !== undefined) {
      e.result = res;
    }
  });

  let UnaryListener = stage.addListener(Iroh.UNARY);
  UnaryListener.on("fire", (e) => {
    console.warn("Unary Comparator", e);
    let isProxyValue = isProxy(e.value);

    if (isProxyValue) {
      let identifier = e.value.__get_identifier;
      let last_ops = e.value.__get_ops;
      let real_value = e.value.__get_real_obj;
      let isRealValue = e.value.__is_real_value;

      let res_value = evHelper.evalUnary(e.op, real_value);
      let new_ops = deepClone(last_ops);
      new_ops.push({"type": "Unary", "op": e.op});
      e.result = makeProxy(res_value, identifier, new_ops, isRealValue);
    }
  });

  let LoopListener = stage.addListener(Iroh.LOOP);
  LoopListener.on("test", (e) => {
    let constraint;
    if (constraint === undefined && e.value !== undefined && isProxy(e.value)) {
      constraint = extractConstraintFromProxy(e.value);
    }
    // only emit constraint if we loop, otherwise dont add any constraint
    // this will we cleaned up once we leave the loop
    if (constraint && !e.instance.ForceExecution.forcedLoop.has(e.hash)) {
      e.instance.ForceExecution.emitConstraint(constraint);
    }
    if (isProxy(e.value)) {
      e.value = !e.instance.ForceExecution.forcedLoop.has(e.hash);
      e.instance.ForceExecution.forcedLoop.add(e.hash);
      console.log("Forcing For Loop to", e.value)
    }
  });

  let TernaryListener = stage.addListener(Iroh.TERNARY);
  TernaryListener.on("before", (e) => {
    console.log("Ternary before", e);
    let constraint;
    if (e.test !== undefined && isProxy(e.test)) {
      constraint = extractConstraintFromProxy(e.test);
    }
    if (constraint && e.instance.ForceExecution.stale.has(e.hash)) {
      constraint = negateConstraint(constraint);
    }
    if (constraint)
      e.instance.ForceExecution.emitConstraint(constraint);

    e.test = !e.instance.ForceExecution.stale.has(e.hash);

    if (e.instance.ForceExecution.shouldLabelAsStale && !e.instance.ForceExecution.stale.has(e.hash)) {
      e.instance.ForceExecution.shouldLabelAsStale = false;
      e.instance.ForceExecution.stale.add(e.hash);
    }
  });
}


async function analyzeHandler(code, handler_id) {
  // ANALYZE HELPER VARIABLES
  let stage;
  try {
    stage = new Iroh.Stage(`(${getFunctionString(code)})(ev)`);
  } catch (e) {
    console.error('WTF', code.toString());
    window.__report_failed_handler(handler_id, 'Iroh could not parse this one!', getFunctionString(code));
    return
  }
  instrumentStage(stage);

  let i = 0;
  let stale;
  console.log('start analysis');
  let fr = new ForcedRun(stage, handler_id, code);
  do {
    if (i++ === 30) {
      console.error("Emergency break");
      break;
    }
    stale = fr.run(stage.script);

  } while (!stale);

  let exploitos = [];
  for (let arr of fr.retrieveReport().values()) {
    for (let report of arr) {
      if (report['target'] !== 'manual') {
        let p = generateExploitForReport(report, handler_id);
        exploitos.push(p);
      } else {
        delete report.ev;
        window.__report_manual_exploit(report, handler_id);
      }
    }
  }
  console.log('Waiting for all exploits', exploitos.length);
  exploitos = await Promise.all(exploitos);
  let entries = [...exploitos];
  entries = entries.filter(function (entry) {
    return entry !== undefined && entry !== null
  });
  for (let entry of entries) {
    let cands = entry['candidates'];
    let ev;
    for (let cand of cands) {
      try {
        console.log(cand)
        ev = cand['message'];
        await window.__clean_for_exploit();
        console.log("Trying Exploit stuff", code, 'with', ev, handler_id);
        eval(`(${getFunctionString(code)})(ev)`);

        await delay(1000)
      } catch (e) {
        console.error('Error in executing with payload', e, ev)
      }
      // check for alterations in stores
      if (entry['sink'] === 'storage') {
        for (let key in JSON.parse(JSON.stringify(localStorage))) {
          if (key === cand['exploitId']) {
            __crawly__(key);
          }
        }
      }
      if (entry['sink'] === 'cookie') {
        let cookies = parseCookies();
        let cookie_keys = Object.keys(cookies);
        for (let key of cookie_keys) {
          if (key === cand['exploitId']) {
            __crawly__(key);
          }
        }
      }
    }
  }
  // report found exploits back to the crawler to save to DB/display to the console
  await window.__report_exploits(Array.from(entries), handler_id);
}

export {analyzeHandler, isNativeFunc}