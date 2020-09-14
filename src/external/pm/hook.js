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

import {analyzeHandler, isNativeFunc} from "./Analyzer.js";
import {getFunctionString} from "./util";

// restrict the page to use history to circumvent navigation lock
window.history.back = () => {
};
window.history.forward = () => {
};

(function () {
  let old_handler = window.addEventListener;
  window.addEventListener = function (ev, fun) {
    if (ev === 'message') {
      old_handler.apply(window, arguments);
      if (typeof fun !== 'function' || isNativeFunc(fun)) {
        return
      }
      let p = window.__shouldAnalyzeHandler(window.__getContextUrl(window), getFunctionString(fun));
      p.then(function (handler_id) {
        console.error('analyzing handler with id', handler_id);
        if (handler_id) {
          // this means that the handler was not yet found for this host combination so we should analyze it
          analyzeHandler(fun, handler_id);
        }
      });
    }
  }
})();