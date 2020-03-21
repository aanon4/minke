const HTTPS = require('https');
const Config = require('./Config');
const UPNP = require('./UPNP');
let MinkeApp;

const FALLBACK_GETIP = 'http://api.ipify.org';
const DDNS_URL = `${Config.DDNS_UPDATE}`;
const TICK = 30 * 60 * 1000; // 30 minutes
const RETRY = 60 * 1000; // 1 minute
const DELAY = 10 * 1000; // 10 seconds
const FORCE_TICKS = 48; // 1 day

const DDNS = {

  _gids: {},
  _pending: null,
  _key: '',

  start: function(key) {
    this._key = key;
    let ticks = 0;
    this._tick = setInterval(async () => {
      this._update(this._key, ticks === 0);
      ticks--;
      if (ticks < 0) {
        ticks = FORCE_TICKS;
      }
    }, TICK);
  },

  register: function(app) {
    //console.log('register', app._globalId);
    this._gids[app._globalId] = {
      app: app,
      lastIP: null,
      lastIP6: null
    };
    this._update(this._key, true);
  },

  unregister: function(app) {
    //console.log('unregister', app._globalId);
    delete this._gids[app._globalId];
  },

  _update: function(key, force) {
    if (Object.keys(this._gids).length) { // Dont store keys - may change after we've got the IP address
      if (force) {
        Object.values(this._gids).forEach(entry => {
          entry.lastIP = null;
          entry.lastIP6 = null;
        });
      }
      clearTimeout(this._pending);
      this._pending = setTimeout(() => {
        this._getExternalIP().then(eip => {
          if (!eip) {
            setTimeout(() => {
              this._update(key, true);
            }, RETRY);
          }
          else {
            Object.keys(this._gids).forEach(gid => {
              const entry = this._gids[gid];
              const ip = entry.app._remoteIP || eip;
              const ip6 = entry.app.getNATIP6() ? entry.app.getSLAACAddress() : null;
              if (ip != entry.lastIP || ip6 != entry.lastIP6) {
                if (ip) {
                  if (!ip6) {
                    //console.log(`${DDNS_URL}?key=${key}&host=${gid}&ip=${ip}`);
                    HTTPS.get(`${DDNS_URL}?key=${key}&host=${gid}&ip=${ip}`, () => {});
                  }
                  else {
                    //console.log(`${DDNS_URL}?key=${key}&host=${gid}&ip=${ip}&ip6=${ip6}`);
                    HTTPS.get(`${DDNS_URL}?key=${key}&host=${gid}&ip=${ip}&ip6=${ip6}`, () => {});
                  }
                }
                entry.lastIP = ip;
                entry.lastIP6 = ip6;
              }
            });
          }
        });
      }, DELAY);
    }
  },

  _getExternalIP: async function() {
    return new Promise((resolve) => {
      //console.log('_getExternalIP');
      UPNP.getExternalIP().then((ip) => {
        //console.log('_gotExternaIP', ip);
        if (ip) {
          resolve(ip);
        }
        else if (FALLBACK_GETIP) {
          // Fallback
          HTTPS.get(FALLBACK_GETIP, (res) => {
            res.on('data', (data) => {
              console.log('_gotExternaIP fallback', data.toString('utf8'));
              resolve(data.toString('utf8'));
            });
          });
        }
        else {
          resolve(null);
        }
      });
    });
  }

}

module.exports = DDNS;
