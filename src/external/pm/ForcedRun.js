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

import {makeProxy, deepClone, deepCloneProxy, randomString} from './util.js';

class ForcedRun {
  constructor(stage, handler_id, fun) {
    this.old_stale = new Set();
    this.stage = stage;//  new Iroh.Stage(`(${code.toString()})(ev)`);
    this.reports = new Map();
    this.handler_id = handler_id;
    this.fun = fun;
  }

  run() {
    console.log('========== Starting new round ==========');
    let ev = makeProxy({
      origin: '', data: {}, source: {
        postMessage: function (data, origin) {

        }
      }
    }, 'event');
    this.stage.ForceExecution = this._createAnalysisState(ev);
    // code takes ev as input

    // arrow functions dont overwrite this => this still bound to the instance of ForcedRun
    // this function will be called by the instrumented code
    let __begin_tests = () => {
      this.stage.ForceExecution.inTest = true;
      this.stage.ForceExecution.constraintBuffer = undefined;
    };
    window.__addTypeInfo = (i, t) => {
      this.stage.ForceExecution.addTypeInfo(i, t);
    };

    this.stage.ForceExecution.__leave_tests = () => {
      this.stage.ForceExecution.inTest = false;
      let res = this.stage.ForceExecution.getConstraintBuffer();
      this.stage.ForceExecution.constraintBuffer = undefined;
      return res;
    };
    let isStale = true;

    let __id_to_set, __fun_obj, __fun_code;
    try {
      eval(this.stage.script);
    } catch (e) {
      let match = e.message.match(/([a-zA-Z0-9]+) is not defined/)
      if (match) {
        __id_to_set = match[1];
        __fun_obj = this.fun;
        debugger;
      }
      if (__fun_code) {
        isStale = false;
      } else {
        // We need to take care that if there was no stale block yet we need to mark the current block as stale
        this.stage.ForceExecution.stale.add(this.stage.ForceExecution.curBBHash);
        console.error('Unexpected error from force Execution', e, 'Forcing', this.stage.ForceExecution.curBBHash, 'to be stale now')
      }
    }
    // fun code will be set by debugger when we found the corresponding missing identifier from the other scope

    isStale = isStale && (this.old_stale.size === this.stage.ForceExecution.stale.size);
    this.old_stale = this.stage.ForceExecution.stale;
    console.log(this.old_stale, this.stage.ForceExecution.stale);
    return isStale;
  }

  _createAnalysisState(ev) {
    let st = {};
    st.curBBHash = null;
    st.BBHashMap = new Map();
    st.shouldLabelAsStale = true;
    st.randomValue = randomString();
    st.pathConstraints = [];
    st.inTest = false;
    st.stale = new Set(this.old_stale);
    st.forcedLoop = new Set();
    st.typeInfo = new Map();
    st.ConstraintMap = new Map();
    st.constraintBuffer = undefined;
    st.reports = this.reports;
    st.ev = ev;
    st.savedFunState = [];
    st.handler_id = this.handler_id;
    st.emitConstraint = function (constraint) {
      this.pathConstraints.push(constraint);
    };
    st.popConstraint = function () {
      this.pathConstraints.pop();
    };

    st.getConstraintBuffer = function () {
      if (this.constraintBuffer === undefined) {
        return undefined;
      }
      let buf = undefined;
      for (let i = this.constraintBuffer.length - 1; i >= 0; i--) {
        if (buf === undefined) {
          buf = this.constraintBuffer[i][1];
        } else {
          buf = {type: 'Logical', op: this.constraintBuffer[i][0], l_val: this.constraintBuffer[i][1], r_val: buf};
        }
      }
      return buf;
    };

    st.addTypeInfo = function (identifier, type) {
      this.typeInfo.set(identifier, type);
    };
    st.getTypeInfo = function () {
      let res = [];
      for (let k of this.typeInfo.keys()) {
        res.push([k, this.typeInfo.get(k)])
      }
      return res;
    };

    st.emitLogicalConstraint = function (ops, op, identifier) {
      if (this.constraintBuffer === undefined) {
        this.constraintBuffer = [[op, {ops: ops, identifier: identifier}]];
      } else if (op !== undefined) {
        this.constraintBuffer.push([op, {ops: ops, identifier: identifier}]);
      } else {
        throw Error('Unexpected Behaviour in emit LogicalConstraint')
      }
    };
    st.clearLogicalConstraintBuffer = function () {
      this.constraintBuffer = undefined;
    };
    st.emitSinkAccess = function (p, sink, arg_no, hash, target = 'XSS') {
      let cur_constraints = deepClone(this.pathConstraints);
      for (let savedConstraints of this.savedFunState) {
        cur_constraints = cur_constraints.concat(deepClone(savedConstraints))
      }
      if (this.constraintBuffer && this.constraintBuffer.length) {
        cur_constraints.push(deepClone(this.getConstraintBuffer()))
      }
      let ev = this.ev;
      if (!this.reports.has(hash)) {
        this.reports.set(hash, [{
          target: target,
          sinkObject: deepCloneProxy(p),
          arg_no: arg_no,
          constraints: cur_constraints,
          sink: sink,
          ev: ev,
          typeInfo: this.getTypeInfo(),
        }])
      } else {
        // FIXME: comment this in if we want multiple reports per sink access
        return;
        this.reports.get(hash).push({
          target: target,
          sinkObject: deepCloneProxy(p),
          arg_no: arg_no,
          constraints: cur_constraints,
          sink: sink,
          ev: ev,
          typeInfo: this.getTypeInfo(),
        });
      }
    };
    st.emitStorageAccess = function (key_obj, val_obj, hash) {
      let cur_constraints = deepClone(this.pathConstraints);
      for (let savedConstraints of this.savedFunState) {
        cur_constraints = cur_constraints.concat(deepClone(savedConstraints))
      }
      if (this.constraintBuffer && this.constraintBuffer.length) {
        cur_constraints.push(deepClone(this.getConstraintBuffer()))
      }
      let ev = this.ev;
      if (!this.reports.has(hash)) {
        this.reports.set(hash, [{
          sink: 'storage',
          key_obj: deepCloneProxy(key_obj),
          val_obj: deepCloneProxy(val_obj),
          constraints: cur_constraints,
          ev: ev,
          typeInfo: this.getTypeInfo(),

        }])
      } else {
        this.reports.get(hash).push({
          sink: 'storage',
          key_obj: deepCloneProxy(key_obj),
          val_obj: deepCloneProxy(val_obj),
          constraints: cur_constraints,
          ev: ev,
          typeInfo: this.getTypeInfo(),
        });
      }
    };
    return st;
  }

  retrieveReport() {
    return this.reports;
  }
}

export {
  ForcedRun
};
