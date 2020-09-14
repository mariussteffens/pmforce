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
class ModuleLoader {
  constructor(modules, logger) {
    this.modules = modules;
    this.logger = logger;
    this.logger.log('Loading Modules...');
    this.loadedModules = {};
    for (let mod_name of this.modules) {
      this.logger.log('Loading Dynamic Module', mod_name);
      this.loadedModules[mod_name] = require('../modules/' + mod_name);
    }
    this.logger.log('Finished loading Modules!');
  }

  createModules(chrome, page, job, db) {
    let modInstances = {};
    for (let modName of this.modules) {
      this.logger.log('Creating instance of Dynamic Module', modName);
      modInstances[modName] = this.loadedModules[modName].createModule(chrome, page, job, db, this.logger);
    }
    return modInstances;
  }
}

module.exports = {
  ModuleLoader
};