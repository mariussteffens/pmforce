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

function makeProxy(obj, identifier, appliedOperations = [], isRealValue = false) {
  // Wrap a primitive type to be proxy compatible
  if (typeof obj !== 'object' || obj === null) {
    obj = {"__is_primitive_value": true, "__real_primitive_value": obj}
  }
  obj.__identifier = identifier;
  if (obj.__applied_ops) {
    obj.__applied_ops = obj.__applied_ops.concat(appliedOperations);
  } else {
    obj.__applied_ops = appliedOperations;
  }

  let handler = {
    get: function (target, key, receiver) {
      if (typeof obj === 'object' && Object.keys(target).length === 2 && '__identifier' in target && '__applied_ops' in target) {
        // This means we are uncertain whether this thing here is really a object or if it is supposed to be e.g. a string
        if (key === Symbol.iterator) {
          window.__addTypeInfo(identifier, 'array');
          // this should work for array usage as well as dict usage
          obj.__is_primitive_value = true;
          obj.__real_primitive_value = [];
          obj[Symbol.iterator] = function* () {
            let i = 0;
            while (i < 5) {
              let ops = deepClone(appliedOperations);
              ops.push({'type': 'iterator', 'accessed_elem': i++});
              yield makeProxy({}, identifier, ops);
            }
            yield undefined
          };
        } else if (key in String.prototype) {
          // guess that this should in fact not be a object but rather a string. thus adapt it to be a primitive object.
          obj.__is_primitive_value = true;
          obj.__real_primitive_value = '';
        } else if (key in Number.prototype) {
          // guess that this should in fact not be a object but rather a string. thus adapt it to be a primitive object.
          obj.__is_primitive_value = true;
          obj.__real_primitive_value = '';
        }

      }
      if (key === '__is_real_value') {
        return isRealValue;
      }
      if (key === '__get_identifier') {
        return identifier;
      }
      if (key === '__get_ops') {
        return appliedOperations;
      }
      if (key === '__get_real_obj') {
        if (target.__is_primitive_value) {
          return target.__real_primitive_value;
        }
        return target;
      }
      if (key === '__is_proxy') {
        return true;
      }
      if (typeof key === 'symbol') {
        return target[key];
      }
      let accessed;

      if (key === 'valueOf' || key === 'toString' && this.__is_primitive_value) {
        return () => {
          return this.__real_primitive_value;
        }
      }

      if (target["__is_primitive_value"]) {
        target = target["__real_primitive_value"];
        accessed = target[key];

      } else {
        accessed = Reflect.get(target, key, receiver);
      }

      // We need this for implicit conversion, e.g. when == is used and types missmatch since our values will always be proxies and does provoke implicit conversions.
      // However we do not want to loose precision, when toString is called by the developer which is why we retaint it after a function call to toString or valueOf
      if (key === 'valueOf' || key === 'toString') {
        return function () {
          /*ignore_this_func*/
          return accessed.apply(target, arguments);
        }
      }
      if (typeof accessed === 'function') {
        return function () {
          return accessed.apply(target, arguments);
        }
      } else {
        // this is the case when we retrieve a property, we want to note that we are now accessing a sub property and
        if (accessed === undefined) {
          target[key] = {};
          accessed = target[key];
        }
        if (isProxy(accessed)) {
          return accessed;
        }
        return makeProxy(accessed, identifier + '.' + key.toString(), [{
          type: 'ops_on_parent_element',
          old_identifier: identifier,
          old_ops: deepClone(appliedOperations)
        }]);
      }
    },

    set: function (target, key, value, receiver) {
      return Reflect.set(target, key, value, receiver);
    }
  };
  return new Proxy(obj, handler);
}

function deepCloneMap(map) {
  let m = new Map();

  for (const [key, value] of map.entries()) {
    m.set(key, deepClone(value));
  }
  return m;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepCloneProxy(proxy) {
  let identifier = proxy.__get_identifier;
  let last_ops = proxy.__get_ops;
  let real_value = proxy.__get_real_obj;

  return {identifier: identifier, ops: last_ops, value: real_value}
}

function randomString(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = '';
  for (let i = 0; i < length; i++)
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

function delay(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

function deProxifyArguments(args) {
  let res;
  if (Array.isArray(args)) {
    res = [];
    for (let arg of args) {
      arg = deProxifyArguments(arg);
      res.push(arg);
    }
  } else if (args === undefined) {

  } else if (isProxy(args)) {
    res = {ops: args.__get_ops, identifier: args.__get_identifier};
  } else if (args.__proto__ === RegExp.prototype) {
    let regex = args.toString();
    res = regex.slice(1).slice(0, regex.lastIndexOf('/') - 1)
  } else {
    res = args;
  }

  return res
}

function isProxy(obj) {
  if (obj === window || obj === parent || obj === window.opener) {
    return false
  }
  return obj !== null && typeof obj === 'object' && obj.__is_proxy;
}

function getFunctionString(fun) {
  return (function () {
  }).toString.apply(fun);
}

export {
  makeProxy,
  deepClone,
  deepCloneMap,
  deepCloneProxy,
  randomString,
  delay,
  deProxifyArguments,
  isProxy,
  getFunctionString
}