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
const CrawlStatus = {
  NOT_CRAWLED: 0,
  CRAWLED: 1,
  CRAWLING: 2,
  FAILED: 3,
};

const logLevel = {
  BENCHMARK: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const logTag = {
  BENCHMARK: 'Benchmark',
  INFO: 'Info',
  WARN: 'Warn',
  ERROR: 'Error',
  PAGE_ERROR: 'Page Error'
};


module.exports = {
  CrawlStatus,
  logLevel,
  logTag
};