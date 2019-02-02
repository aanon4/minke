const DB = require('nedb');
const FS = require('fs');

const DB_PATH = process.env.DEBUG ? '/home/minke/db' : '/minke/db';
const DB_APPS = `${DB_PATH}/apps.db`;
const DB_COMPACT_SEC = 60 * 60 * 24; // Every day
//const DB_COMPACT_SEC = 10;

function _wrap(fn) {
  return async function(db, ...args) {
    return new Promise((resolve, reject) => {
      args.push((err, val) => {
        if (err) {
          reject(err);
        }
        else {
          resolve(val);
        }
      });
      fn.apply(db, args);
    });
  }
}

const Database = {
  
  init: async function() {
    FS.mkdirSync(DB_PATH, { recursive: true });

    Database._apps = new DB({ filename: DB_APPS, autoload: true });
    Database._apps.persistence.setAutocompactionInterval(DB_COMPACT_SEC * 1000);
  },

  getApps: async function() {
    return this._find(Database._apps, {});
  },

  saveApp: async function(appJson) {
    await this._update(Database._apps, { _id: appJson._id }, appJson, { upsert: true });
  },

  removeApp: async function(id) {
    await this._remove(Database._apps, { _id: id });
  },

  newAppId: function() {
    return Database._apps.createNewId();
  },

  _find: _wrap(DB.prototype.find),
  _findOne: _wrap(DB.prototype.findOne),
  _insert: _wrap(DB.prototype.insert),
  _update: _wrap(DB.prototype.update),
  _ensureIndex: _wrap(DB.prototype.ensureIndex),
  _remove: _wrap(DB.prototype.remove)
};

module.exports = Database;
