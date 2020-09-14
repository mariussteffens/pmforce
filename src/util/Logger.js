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
const {logLevel, logTag} = require('./Enums');

class Logger {
  constructor(logLevel) {
    this.logLevel = logLevel;
  }

  _getTimeStamp() {
    return new Date().toString().split(' ').slice(0, 5).join(' ');
  }

  _log(tag, args) {
    let adjusted = [this._getTimeStamp(), '[Crawly]', `[${tag}]`];
    for (let i = 0; i < args.length; i++) {
      adjusted.push(args[i]);
    }
    console.log(...adjusted);
  }

  _shouldLog(LEVEL) {
    return this.logLevel <= LEVEL;
  }

  benchmark() {
    if (this._shouldLog(logLevel.BENCHMARK)) {
      this._log(logTag.BENCHMARK, arguments)
    }
  }

  log() {
    if (this._shouldLog(logLevel.INFO)) {
      this._log(logTag.INFO, arguments)
    }
  }

  warn() {
    if (this._shouldLog(logLevel.WARN)) {
      this._log(logTag.WARN, arguments)
    }
  }

  err() {
    if (this._shouldLog(logLevel.ERROR)) {
      this._log(logTag.ERROR, arguments)
    }
  }

  page_err() {
    if (this._shouldLog(logLevel.WARN)) {
      this._log(logTag.PAGE_ERROR, arguments)
    }
  }

  asCallback(fun) {
    return this[fun].bind(this);
  }
}


module.exports = {
  Logger
};