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
const url_parse = require('url');
const path = require('path');
const util = require('util');
const fs = require('fs');
const psl = require('psl');
const exec = util.promisify(require('child_process').exec);
const readFilePromise = util.promisify(fs.readFile);


let PSL_CACHE = new Map();

function delay(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

let benchmark = function (tag, logger) {
  let start = new Date();
  return {
    stop: function () {
      let end = new Date();
      let time = end.getTime() - start.getTime();
      logger.benchmark(tag, 'finished in', time, 'ms');
    }
  }
};

function parseUrl(url) {
  return url_parse.parse(url);
}

function get_psl(parsed) {
  let hostname = parsed.hostname;
  if (hostname.startsWith('.')) {
    hostname = hostname.replace(new RegExp(
        "^[.]+", "g"
    ), "");
  }

  if (hostname.startsWith('localhost')) {
    return hostname
  }
  if (PSL_CACHE.has(hostname)) {
    return PSL_CACHE.get(hostname);
  }
  let psl_parsed = psl.parse(hostname);
  // hack for sites like blogspot which count as publicsuffix, but are still in alexa
  let site = psl_parsed.sld === null || psl_parsed.sld === undefined ? psl_parsed.tld : psl_parsed.sld + '.' + psl_parsed.tld;
  PSL_CACHE.set(hostname, site);

  return site;
}

function get_origin(url) {
  let parsed = parseUrl(url);
  return parsed.protocol + '//' + parsed.host;
}

async function getFilePromise(path) {
  return readFilePromise(path);
}

let writeFilePromise = function (file, data) {
  let dirname = path.dirname(file);
  try {
    if (!fs.existsSync(dirname))
      fs.mkdirSync(dirname);
  } catch (e) {

  }
  if (fs.existsSync(file)) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    fs.writeFile(file, data, error => {
      if (error) reject(error);
      resolve();
    });
  });
};

function randomString(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = '';
  for (let i = 0; i < length; i++)
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}


function makeResponseFromBuffer(buffer) {
  const CRLF = '\r\n';
  let text = 'HTTP/1.1 200' + CRLF + CRLF;
  let responseBuffer = Buffer.from(text, 'utf8');
  responseBuffer = Buffer.concat([responseBuffer, buffer]);
  return responseBuffer
}


module.exports = {
  delay,
  readFilePromise,
  writeFilePromise,
  parseUrl,
  get_psl,
  get_origin,
  getFilePromise,
  exec,
  benchmark,
  makeResponseFromBuffer,
  randomString
};