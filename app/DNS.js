const UDP = require('dgram');
const Net = require('net');
const ChildProcess = require('child_process');
const FS = require('fs');
const DnsPkt = require('dns-packet');
const Config = require('./Config');
const Network = require('./Network');
const Database = require('./Database');
const MDNS = require('./MDNS');
const Native = require('./native/native');

const ETC = (DEBUG ? '/tmp/' : '/etc/');
const HOSTNAME_FILE = `${ETC}hostname`;
const HOSTNAME = '/bin/hostname';
const DNS_NETWORK = 'dns0';
const REGEXP_LOCAL_IP = /(^127\.)|(^192\.168\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^::1$)|(^[fF][cCdD])/;
const REGEXP_PTR_ZC = /^(b|lb|db)\._dns-sd\._udp\.(.*)$/;
const GLOBAL1 = { _name: 'global1', _position: { tab: Number.MAX_SAFE_INTEGER - 1 } };
const GLOBAL2 = { _name: 'global2', _position: { tab: Number.MAX_SAFE_INTEGER } };
const MAX_SAMPLES = 128;
const STDEV_QUERY = 4;
const STDEV_FAIL = 2;

const NOERROR = 0;
const SERVFAIL = 2;
const NOTFOUND = 3;

const PARALLEL_QUERY = 0;
const DEBUG_QUERY = 0;
const DEBUG_QUERY_TIMING = 0;

//
// PrivateDNS provides mappings for locally hosted services.
//
const PrivateDNS = {

  _ttl: 600, // 10 minutes
  _hostname2ip4: {},
  _hostname2ip6: {},
  _ip2localname: {},
  _ip2globalname: {},
  _domainName: '',
  _soa: null,

  query: async function(request, response, rinfo) {
    switch (request.questions[0].type) {
      case 'A':
      {
        const fullname = request.questions[0].name.toLowerCase();
        let name = null;
        const sname = fullname.split('.');
        if (sname.length === 1 && !this._domainName) {
          name = sname[0];
        }
        else if (sname.length === 2 && sname[1] === this._domainName) {
          name = sname[0];
        }
        else if (sname.length === 3 && Config.GLOBALDOMAIN === `.${sname[1]}.${sname[2]}`) {
          name = fullname;
        }
        if (name) {
          const ip = this._hostname2ip4[name];
          if (ip) {
            response.answers.push(
              { name: fullname,  ttl: this._ttl, type: 'A', class: 'IN', data: ip }
            );
            const ip6 = this._hostname2ip6[name];
            if (ip6) {
              response.additionals.push(
                { name: fullname, ttl: this._ttl, type: 'AAAA', class: 'IN', data: ip6 }
              );
            }
            if (this._soa) {
              response.authorities.push({ name: fullname, ttl: this._ttl, type: 'SOA', class: 'IN', data: this._soa });
            }
            response.flags |= DnsPkt.AUTHORITATIVE_ANSWER;
            return NOERROR;
          }
        }
        break;
      }
      case 'AAAA':
      {
        const fullname = request.questions[0].name.toLowerCase();
        let name = null;
        const sname = fullname.split('.');
        if (sname.length === 1 && !this._domainName) {
          name = sname[0];
        }
        else if (sname.length === 2 && sname[1] === this._domainName) {
          name = sname[0];
        }
        else if (sname.length === 3 && Config.GLOBALDOMAIN === `.${sname[1]}.${sname[2]}`) {
          name = fullname;
        }
        if (name) {
          const ip6 = this._hostname2ip6[name];
          if (ip6) {
            response.answers.push(
              { name: fullname, ttl: this._ttl, type: 'AAAA', class: 'IN', data: ip6 }
            );
            const ip = this._hostname2ip4[name];
            if (ip) {
              response.additionals.push(
                { name: fullname, ttl: this._ttl, type: 'A', class: 'IN', data: ip }
              );
            }if (this._soa) {
              response.authorities.push({ name: fullname, ttl: this._ttl, type: 'SOA', class: 'IN', data: this._soa });
            }
            response.flags |= DnsPkt.AUTHORITATIVE_ANSWER;
            return NOERROR;
          }
        }
        break;
      }
      case 'PTR':
      {
        const name = request.questions[0].name;
        if (name.endsWith('.in-addr.arpa')) {
          const m4 = name.split('.');
          const ip = `${m4[3]}.${m4[2]}.${m4[1]}.${m4[0]}`;
          const localname = this._ip2localname[ip];
          if (localname) {
            response.answers.push(
              { name: name, ttl: this._ttl, type: 'PTR', class: 'IN', data: `${localname}${this._domainName ? '.' + this._domainName : ''}` }
            );
            if (this._soa) {
              response.authorities.push({ name: name, ttl: this._ttl, type: 'SOA', class: 'IN', data: this._soa });
            }
            response.flags |= DnsPkt.AUTHORITATIVE_ANSWER;
            return NOERROR;
          }
        }
        else if (name.endsWith('.ip6.arpa')) {
          const m6 = name.split('.');
          const ip6 = `${m6[31]}${m6[30]}${m6[29]}${m6[28]}:${m6[27]}${m6[26]}${m6[25]}${m6[24]}:${m6[23]}${m6[22]}${m6[21]}${m6[20]}:${m6[19]}${m6[18]}${m6[17]}${m6[16]}:${m6[15]}${m6[14]}${m6[13]}${m6[12]}:${m6[11]}${m6[10]}${m6[9]}${m6[8]}:${m6[7]}${m6[6]}${m6[5]}${m6[4]}:${m6[3]}${m6[2]}${m6[1]}${m6[0]}`;
          const localname = this._ip2localname[ip6];
          if (localname) {
            response.answers.push(
              { name: name, ttl: this._ttl, type: 'PTR', class: 'IN', data: `${localname}${this._domainName ? '.' + this._domainName : ''}` }
            );
            if (this._soa) {
              response.authorities.push({ name: name, ttl: this._ttl, type: 'SOA', class: 'IN', data: this._soa });
            }
            response.flags |= DnsPkt.AUTHORITATIVE_ANSWER;
            return NOERROR;
          }
        }
        break;
      }
      case 'SOA':
      {
        const fullname = request.questions[0].name;
        const name = fullname.split('.');
        if (this._soa && ((name.length === 2 && name[1].toLowerCase() === this._domainName)  || (name.length === 1 && !this._domainName))) {
          response.answers.push({ name: fullname, ttl: this._ttl, type: 'SOA', class: 'IN', data: this._soa });
          response.flags |= DnsPkt.AUTHORITATIVE_ANSWER;
          return NOERROR;
        }
        break;
      }
      default:
        break;
    }
    return NOTFOUND;
  },

  setDomainName: function(name) {
    this._domainName = name.toLowerCase();
    this._soa = {
      mname: this._domainName,
      rname: `dns-admin.${this._domainName}`,
      serial: 1,
      refresh: this._ttl, // Time before secondary should refresh
      retry: this._ttl, // Time before secondary should retry
      expire: this._ttl * 2, // Time secondary should consider its copy authorative
      minimum: Math.floor(this._ttl / 10) // Time to cache a negative lookup
    };
  },

  registerHost: function(localname, globalname, ip, ip6) {
    const kLocalname = localname.toLowerCase();
    this._hostname2ip4[kLocalname] = ip;
    this._ip2localname[ip] = localname;
    if (ip6) {
      this._hostname2ip6[kLocalname] = ip6;
      this._ip2localname[ip6] = localname;
    }
    if (globalname) {
      const kGlobalname = globalname.toLowerCase();
      this._hostname2ip4[kGlobalname] = ip;
      this._ip2globalname[ip] = globalname;
      if (ip6) {
        this._hostname2ip6[kGlobalname] = ip6;
        this._ip2globalname[ip6] = globalname;
      }
    }
  },

  unregisterHost: function(localname) {
    const kLocalname = localname.toLowerCase();
    const ip = this._hostname2ip4[kLocalname];
    const ip6 = this._hostname2ip6[kLocalname];
    const kGlobalname = (this._ip2localname[ip] || '').toLowerCase();

    delete this._hostname2ip4[kLocalname];
    delete this._hostname2ip4[kGlobalname];
    delete this._hostname2ip6[kLocalname];
    delete this._hostname2ip6[kGlobalname];
    delete this._ip2localname[ip];
    delete this._ip2globalname[ip];
    delete this._ip2localname[ip6];
    delete this._ip2globalname[ip6];
  },

  lookupLocalnameIP: function(localname) {
    return this._hostname2ip4[localname.toLowerCase()];
  }
};

//
// CachingDNS caches lookups from external DNS servers to speed things up.
//
const CachingDNS = {

  _defaultTTL: 600, // 10 minutes
  _maxTTL: 3600, // 1 hour
  _defaultNegTTL: 30, // 30 seconds
  _qHighWater: 1000,
  _qLowWater: 900,

  _q: [],
  _qTrim: null,

  _cache: {
    A: {},
    AAAA: {},
    CNAME: {},
    SOA: {}
  },

  add: function(response, error) {
    // Dont cache truncated response
    if ((response.flags & DnsPkt.TRUNCATED_RESPONSE) !== 0) {
      return;
    }
    response.authorities.forEach(authority => this._addSOA(authority));
    response.answers.forEach(answer => this._addAnswer(answer));
    response.additionals.forEach(answer => this._addAnswer(answer));
    // If we didn't answer the question, create a negative entry
    const question = response.questions[0];
    if (!response.answers.find(answer => answer.type === question.type)) {
      this._addNegative(question, error)
    }
  },

  _addAnswer: function(answer) {
    switch (answer.type) {
      case 'A':
      case 'AAAA':
      case 'CNAME':
      {
        const name = answer.name.toLowerCase();
        const R = this._cache[answer.type][name] || (this._cache[answer.type][name] = {});
        const key = answer.data.toLowerCase();
        const expires = Math.floor(Date.now() / 1000 + Math.min(this._maxTTL, (answer.ttl || this._defaultTTL)));
        if (R[key]) {
          R[key].expires = expires;
        }
        else {
          if (R.negative) {
            R.negative.expires = 0;
          }
          const rec = { key: key, name: answer.name, type: answer.type, expires: expires, data: answer.data };
          R[key] = rec;
          this._q.push(rec);
        }
        break;
      }
      default:
        break;
    }

    if (this._q.length > this._qHighWater && !this._qTrim) {
      this._qTrim = setTimeout(() => this._trimAnswers(), 0);
    }
  },

  _addNegative: function(question, error) {
    switch (question.type) {
      case 'A':
      case 'AAAA':
      case 'CNAME':
        // Need SOA information to set the TTL of the negative cache entry. If we don't
        // have it we'll use a default (which should be quite short).
        const soa = this._findSOA(question.name);
        const ttl = error === SERVFAIL ? this._defaultNegTTL : Math.min(this._maxTTL, (soa && soa.data.minimum ? soa.data.minimum : this._defaultNegTTL));
        const name = question.name.toLowerCase();
        const R = this._cache[question.type][name] || (this._cache[question.type][name] = {});
        const expires = Math.floor(Date.now() / 1000 + ttl);
        if (R.negative) {
          R.negative.expires = expires;
        }
        else {
          const rec = { key: 'negative', name: question.name, type: question.type, expires: expires };
          R.negative = rec;
          this._q.push(rec);
        }
        break;
      default:
        break;
    }
  },

  _findAnswer: function(type, name) {
    const answers = [];
    switch (type) {
      case 'A':
      case 'AAAA':
      case 'CNAME':
      {
        const R = this._cache[type][name.toLowerCase()];
        if (R) {
          const now = Math.floor(Date.now() / 1000);
          if (R.negative && R.negative.expires > now) {
            break;
          }
          for (let key in R) {
            const rec = R[key];
            if (rec.expires > now) {
              answers.push({ name: rec.name, type: rec.type, ttl: rec.expires - now, data: rec.data });
            }
          }
          break;
        }
        break;
      }
      default:
        break;
    }
    return answers.length ? answers : null;
  },

  _findNegative: function(type, name) {
    switch (type) {
      case 'A':
      case 'AAAA':
      case 'CNAME':
      {
        const R = this._cache[type][name.toLowerCase()];
        if (R && R.negative && R.negative.expires > Math.floor(Date.now() / 1000)) {
          return true;
        }
        break;
      }
    }
    return false;
  },

  _addSOA: function(soa) {
    const key = soa.name.toLowerCase();
    const entry = this._cache.SOA[key];
    if (!entry) {
      const rec = { key: 'soa', name: soa.name, type: 'SOA', class: 'IN', expires: Math.floor(Date.now() / 1000 + Math.min(this._maxTTL, (soa.ttl || this._defaultTTL))), data: soa.data };
      this._cache.SOA[key] = { soa: rec };
      this._q.push(rec);
    }
  },

  _findSOA: function(name) {
    const sname = name.toLowerCase().split('.');
    for (let i = 0; i < sname.length; i++) {
      const soa = this._cache.SOA[sname.slice(i).join('.')];
      if (soa) {
        return soa.soa;
      }
    }
    return null;
  },

  _soa: function(name, response) {
    const soa = this._findSOA(name);
    if (soa) {
      response.authorities.push(soa);
      return true;
    }
    return false;
  },

  _trimAnswers: function() {
    const diff = this._q.length - this._qLowWater;
    //console.log(`Flushing ${diff}`)
    if (diff > 0) {
      this._q.sort((a, b) => a.expires - b.expires);
      const candidates = this._q.splice(0, diff);
      candidates.forEach(candidate => {
        const name = candidate.name.toLowerCase();
        const R = this._cache[candidate.type][name];
        if (R) {
          const key = candidate.key;
          if (R[key]) {
            delete R[key];
          }
          else {
            console.error('Missing trim entry', candidate);
          }
          if (Object.keys(R).length === 0) {
            delete this._cache[candidate.type][name];
          }
        }
        else {
          console.error('Missing trim list', candidate);
        }
      });
    }
    this._qTrim = null;
  },

  flush: function() {
    if (this._qTrim) {
      clearTimeout(this._qTrim);
      this._qTrim = null;
    }
    this._q = [];
    for (let key in this._cache) {
      this._cache[key] = {};
    }
  },

  query: async function(request, response, rinfo) {
    const question = request.questions[0];
    switch (question.type) {
      case 'A':
      case 'AAAA':
      {
        // Look for a cached A/AAAA record
        const a = this._findAnswer(question.type, question.name);
        if (a) {
          response.answers.push.apply(response.answers, a);
          return NOERROR;
        }
        const cname = this._findAnswer('CNAME', question.name);
        if (cname) {
          const ac = this._findAnswer(question.type, cname[0].data);
          if (ac) {
            response.answers.push.apply(response.answers, cname);
            response.answers.push.apply(response.answers, ac);
            return NOERROR;
          }
        }

        if (!this._findNegative(question.type, question.name)) {
          return NOTFOUND;
        }

        const soa = this._findSOA(question.name);
        if (soa) {
          response.answers.push.apply(response.answers, cname);
          response.authorities.push(soa);
          return NOERROR;
        }

        return NOTFOUND;
      }
      case 'CNAME':
      {
        const cname = this._findAnswer('CNAME', question.name);
        if (cname) {
          response.answers.push.apply(response.answers, cname);
          // See if we have a cached A/AAAA for the CNAME
          const a = this._findAnswer('A', cname[0].data);
          if (a) {
            response.additionals.push.apply(response.additionals, a);
          }
          const aaaa = this._findAnswer('AAAA', cname[0].data);
          if (aaaa) {
            response.additionals.push.apply(response.additionals, aaaa);
          }
          return NOERROR;
        }
        return NOTFOUND;
      }
      default:
        return NOTFOUND;
    }
  }

};

//
// MulticastDNS
//
const MulticastDNS = {

  _defaultTTL: 60, // 1 minute

  query: async function(request, response, rinfo) {
    const question = request.questions[0];
    switch (question.type) {
      case 'A':
      {
        const name = question.name.split('.');
        if (name[name.length - 1].toLowerCase() === 'local') {
          const ip = MDNS.getAddrByHostname(name[0]);
          if (ip && name.length === 2) {
            response.answers.push({ name: question.name, type: 'A', ttl: this._defaultTTL, class: 'IN', data: ip });
          }
          // Return true regardless of a match to stop the query process. We don't look for 'local' anywhere else.
          return NOERROR;
        }
        break;
      }
      case 'PTR':
      {
        const match = question.name.match(REGEXP_PTR_ZC);
        if (match) {
          response.flags = (response.flags & 0xFFF0) | NOTFOUND;
          return NOERROR;
        }
        break;
      }
      default:
        break;
    }
    return NOTFOUND;
  }

};

//
// GlobalDNS proxies DNS servers on the Internet.
//
const GlobalDNS = function(address, port, timeout) {
  this._address = address;
  this._port = port;
  this._maxTimeout = timeout;
  this._samples = Array(MAX_SAMPLES).fill(this._maxTimeout);
  this._pending = {};
  // Identify local or global forwarding addresses. We don't forward local domain lookups to global addresses.
  if (address.match(REGEXP_LOCAL_IP)) {
    this._global = false;
  }
  else {
    this._global = true;
  }
}

GlobalDNS.prototype = {

  start: async function() {
    return new Promise((resolve, reject) => {
      this._socket = UDP.createSocket('udp4');
      this._socket.bind();
      this._socket.once('error', () => reject(new Error()));
      this._socket.once('listening', () => {
        this._socket.on('message', (message, { port, address }) => {
          if (message.length < 2 || address !== this._address || port !== this._port) {
            return;
          }
          const id = message.readUInt16BE(0);
          this._pending[id] && this._pending[id](message);
        });
        resolve();
      });
    });
  },

  stop: function() {
    this._socket.close();
  },

  getSocket: function(rinfo) {
    const start = Date.now();
    if (rinfo.tcp) {
      return (incomingRequest, callback) => {
        const request = DNS._copyDNSPacket(incomingRequest, {
          additionals: []
        });
        const message = DnsPkt.encode(request);
        const msgout = Buffer.alloc(message.length + 2);
        msgout.writeUInt16BE(message.length);
        message.copy(msgout, 2);
        let timeout = setTimeout(() => {
          if (timeout) {
            this._addTimingFailure(Date.now() - start);
            timeout = null;
            callback(null);
          }
        }, this._getTimeout());
        const socket = Net.createConnection({ port: this._port, host: this._address }, () => {
          socket.on('error', (e) => {
            console.error(e);
            if (timeout) {
              this._addTimingFailure(Date.now() - start);
              clearTimeout(timeout);
              timeout = null;
              callback(null);
            }
            socket.destroy();
          });
          socket.on('data', (buffer) => {
            if (buffer.length >= 2) {
              const len = buffer.readUInt16BE();
              if (timeout && buffer.length >= 2 + len) {
                this._addTimingSuccess(Date.now() - start);
                clearTimeout(timeout);
                timeout = null;
                callback(DnsPkt.decode(buffer.subarray(2, 2 + len)));
              }
            }
            socket.end();
          });
          socket.write(msgout);
        });
      }
    }
    else {
      return (incomingRequest, callback) => {
        const request = DNS._copyDNSPacket(incomingRequest, {
          additionals: []
        });
        while (this._pending[request.id]) {
          request.id = Math.floor(Math.random() * 65536);
        }
        const id = request.id;
        const timeout = setTimeout(() => {
          if (this._pending[id]) {
            this._addTimingFailure(Date.now() - start);
            delete this._pending[id];
            callback(null);
          }
        }, this._getTimeout());
        this._pending[id] = (message) => {
          this._addTimingSuccess(Date.now() - start);
          clearTimeout(timeout);
          delete this._pending[id];
          callback(DnsPkt.decode(message));
        };
        this._socket.send(DnsPkt.encode(request), this._port, this._address);
      }
    }
  },

  query: async function(request, response, rinfo) {
    // Dont send a query back to a server it came from.
    if (rinfo.address === this._address || rinfo.originalAddress === this._address) {
      return NOTFOUND;
    }

    // Check we're not trying to looking up local addresses globally
    if (this._global && request.questions[0].type === 'A' || request.questions[0].type === 'AAAA') {
      const name = request.questions[0].name.split('.');
      const domain = name[name.length - 1].toLowerCase();
      if (domain === 'local' || domain === PrivateDNS._domainName) {
        return NOTFOUND;
      }
    }

    return new Promise((resolve, reject) => {
      try {
        this.getSocket(rinfo)(request, (pkt) => {
          if (pkt) {
            if (pkt.rcode === 'NOERROR') {
              response.flags = pkt.flags;
              response.answers = pkt.answers;
              response.additionals = pkt.additionals;
              response.authorities = pkt.authorities;
              return resolve(NOERROR);
            }
            return resolve(NOTFOUND);
          }
          resolve(SERVFAIL);
        });
      }
      catch (e) {
        reject(e);
      }
    });
  },

  _addTimingSuccess: function(time) {
    this._samples.shift();
    this._samples.push(Math.min(time, this._maxTimeout));
  },

  _addTimingFailure: function(time) {
    const dev = this._stddev();
    this._addTimingSuccess(time + STDEV_FAIL * dev.deviation);
  },

  _getTimeout: function() {
    // The last proxy uses the maxTimeout because it's the final attempt at an answer and there's
    // no reason to terminate it early.
    if (DNS._proxies[DNS._proxies.length - 1].srv === this) {
      return this._maxTimeout;
    }
    else {
      const dev = this._stddev();
      return Math.max(1, Math.min(dev.mean + STDEV_QUERY * dev.deviation, this._maxTimeout));
    }
  },

  _stddev: function() {
    const mean = this._samples.reduce((total, value) => total + value, 0) / this._samples.length;
    const variance = this._samples.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / (this._samples.length - 1);
    return {
      mean: mean,
      deviation: Math.sqrt(variance)
    };
  }

};

const LocalDNSSingleton = {

  _qHighWater: 50,
  _qLowWater: 20,
  _forwardCache: {},
  _backwardCache: {},
  _macCache: {},
  _pending: {},

  start: async function() {
    const home = await Network.getHomeNetwork();
    const homecidr = home.info.IPAM.Config[0].Subnet.split('/');
    let homebits = parseInt(homecidr[1]);

    this._network = await Network.getDNSNetwork();
    const cidr = this._network.info.IPAM.Config[0].Subnet.split('/');
    const base = cidr[0].split('.');
    const basebits = parseInt(cidr[1]);

    // Ideally we need one more bit in the DNS network compared to HOME. If we don't get that we might get some
    // address duplications.
    if (basebits >= homebits) {
      homebits = basebits + 1;
    }

    // Simple mapping using mask
    this._mask = [ 0, 0, 0, 0 ];
    for (let i = homebits; i < 32; i++) {
      this._mask[Math.floor(i / 8)] |= 128 >> (i % 8);
    }
    this._base = [ parseInt(base[0]), parseInt(base[1]), parseInt(base[2]), parseInt(base[3]) ];
    this._base[Math.floor(basebits / 8)] |= 128 >> (basebits % 8);

    this._broadcast = `${base[0]}.${base[1]}.255.255`;

    // Manage how ARP-replies are sent
    // http://kb.linuxvirtualserver.org/wiki/Using_arp_announce/arp_ignore_to_disable_ARP
    FS.writeFileSync('/proc/sys/net/ipv4/conf/all/arp_announce', '1', { encoding: 'utf8' });
    FS.writeFileSync('/proc/sys/net/ipv4/conf/all/arp_ignore', '2', { encoding: 'utf8' });

    // Remove my address from main interface, we don't use it.
    // And although we don't use it, the ip address still keeps turning up on the network for unknown reasons unless
    // we explicitly remove it.
    ChildProcess.spawnSync('/sbin/ip', [ 'addr', 'del', `${this._network.info.IPAM.Config[0].Gateway}/16`, 'dev', DNS_NETWORK ]);
  },

  stop: async function() {
    const state = {
      _id: 'localdns',
      dnsBase: JSON.stringify(this._base),
      map: [],
    };
    await Database.saveConfig(state);
  },

  _allocAddress: function(address) {
    // Find an active entry
    const entry = this._forwardCache[address];
    if (entry) {
      return entry;
    }

    const saddress = address.split('.');
    const daddress = `${this._base[0] | (this._mask[0] & saddress[0])}.${this._base[1] | (this._mask[1] & saddress[1])}.${this._base[2] | (this._mask[2] & saddress[2])}.${this._base[3] | (this._mask[3] & saddress[3])}`;
    const maddress = this._allocMacAddress(address);

    // If we have more source addresses than dns address, we may get duplicates. So look for a duplicate entry and remove it
    // so we can reuse it.
    const oldEntry = this._backwardCache[daddress];
    if (oldEntry) {
      if (oldEntry.address === address) {
        console.error('_allocAddress: forward and backward cache inconsistency');
      }
      delete this._forwardCache[oldEntry.address];
      delete this._backwardCache[daddress];
      delete this._macCache[oldEntry.mac];
      this._destroyInterface(oldEntry);
      if (oldEntry.socket) {
        oldEntry.socket.close();
      }
    }

    // If the mac address is in use (on another entry), remove that entry
    const macEntry = this._macCache[maddress];
    if (macEntry) {
      delete this._forwardCache[macEntry.address];
      delete this._backwardCache[macEntry.dnsAddress];
      delete this._macCache[maddress];
      this._destroyInterface(macEntry);
      if (macEntry.socket) {
        macEntry.socket.close();
      }
    }

    const newEntry = {
      socket: null,
      address: address,
      dnsAddress: daddress,
      mac: maddress,
      iface: maddress.replace(/:/g,'')
    };
    this._forwardCache[address] = newEntry;
    this._backwardCache[daddress] = newEntry;
    this._macCache[maddress] = newEntry;

    this._createInterface(newEntry);

    return newEntry;
  },

  _allocMacAddress: function(address) {
    const sa = address.split('.');
    function f(p) {
      return ('0'+parseInt(sa[p]).toString(16)).slice(-2);
    }
    return `da:00:${f(0)}:${f(1)}:${f(2)}:${f(3)}`;
  },

  // We give each client on the DNS network a unique IP and mac address (the mac is derived from the IP). It's not enough to just
  // give clients IP addesses as some DNS applications care about the mac addresses being unique too. We do this by creating
  // macvlan links connected to the dns bridge. We bind the socket we use to the specific endpoint so the requests go out with
  // the correct IP and mac address.
  _createInterface: function(entry) {
    const iface = entry.iface;
    ChildProcess.spawnSync('/sbin/ip', [ 'link', 'add', `d${iface}`, 'link', DNS_NETWORK, 'type', 'macvlan', 'mode', 'bridge' ]);
    ChildProcess.spawnSync('/sbin/ip', [ 'link', 'set', `d${iface}`, 'up', 'address', entry.mac ]);
    ChildProcess.spawnSync('/sbin/ip', [ 'addr', 'add', `${entry.dnsAddress}/16`, 'broadcast', this._broadcast, 'dev', `d${iface}` ]);
  },

  _destroyInterface: function(entry) {
    ChildProcess.spawnSync('/sbin/ip', [ 'link', 'del', 'dev', `d${entry.iface}` ]);
  },

  getSocket: async function(rinfo, tinfo) {
    const start = Date.now();
    if (rinfo.tcp) {
      return (incomingRequest, callback) => {
        const request = DNS._copyDNSPacket(incomingRequest, {
          flags: incomingRequest.flags & ~DnsPkt.RECURSION_DESIRED,
          additionals: [{
            type: 'OPT', name: '.', options: [{
              code: 'CLIENT_SUBNET',
              family: 1,
              sourcePrefixLength: 32,
              scopePrefixLength: 0,
              ip: rinfo.originalAddress,
            }]
          }]
        });
        const message = DnsPkt.encode(request);
        const msgout = Buffer.alloc(message.length + 2);
        msgout.writeUInt16BE(message.length);
        message.copy(msgout, 2);
        let timeout = setTimeout(() => {
          if (timeout) {
            this._addTimingFailure(tinfo, Date.now() - start);
            timeout = null;
            callback(null);
          }
        }, this._getTimeout(tinfo));
        const entry = this._allocAddress(rinfo.originalAddress);
        const socket = Native.getTCPSocketOnInterface(`d${entry.iface}`, entry.dnsAddress, 0);
        socket.connect({ port: tinfo._port, host: tinfo._address }, () => {
          socket.on('error', (e) => {
            console.error(e);
            if (timeout) {
              this._addTimingFailure(tinfo, Date.now() - start);
              clearTimeout(timeout);
              timeout = null;
              callback(null);
            }
            socket.destroy();
          });
          socket.on('data', (buffer) => {
            if (buffer.length >= 2) {
              const len = buffer.readUInt16BE();
              if (timeout && buffer.length >= 2 + len) {
                this._addTimingSuccess(tinfo, Date.now() - start);
                clearTimeout(timeout);
                timeout = null;
                callback(DnsPkt.decode(buffer.subarray(2, 2 + len)));
              }
            }
            socket.end();
          });
          socket.write(msgout);
        });
      }
    }
    else {
      const socket = await new Promise(async (resolve, reject) => {
        const entry = this._allocAddress(rinfo.originalAddress);
        if (entry.socket) {
          try {
            entry.socket.address(); // Will throw exception if socket not yet bound
            resolve(entry.socket);
          }
          catch {
            entry.socket.once('listening', () => resolve(entry.socket));
          }
        }
        else {
          entry.socket = Native.getUDPSocketOnInterface(`d${entry.iface}`, entry.dnsAddress, 0);
          entry.socket.once('error', e => {
            entry.socket = null;
            console.error(e);
            reject(e);
          });
          entry.socket.once('listening', () => {
            entry.socket.on('message', (message, { port, address }) => {
              if (message.length < 2) {
                return;
              }
              const id = message.readUInt16BE(0);
              this._pending[id] && this._pending[id](message);
            });
            resolve(entry.socket);
          });
        }
      });
      return (incomingRequest, callback) => {
        const request = DNS._copyDNSPacket(incomingRequest, {
          flags: incomingRequest.flags & ~DnsPkt.RECURSION_DESIRED,
          additionals: [{
            type: 'OPT', name: '.', options: [{
              code: 'CLIENT_SUBNET',
              family: 1,
              sourcePrefixLength: 32,
              scopePrefixLength: 0,
              ip: rinfo.originalAddress,
            }]
          }]
        });
        while (this._pending[request.id]) {
          request.id = Math.floor(Math.random() * 65536);
        }
        const id = request.id;
        const timeout = setTimeout(() => {
          if (this._pending[id]) {
            this._addTimingFailure(tinfo, Date.now() - start);
            delete this._pending[id];
            callback(null);
          }
        }, this._getTimeout(tinfo));
        this._pending[id] = (message) => {
          this._addTimingSuccess(tinfo, Date.now() - start);
          clearTimeout(timeout);
          delete this._pending[id];
          callback(DnsPkt.decode(message));
        };
        socket.send(DnsPkt.encode(request), tinfo._port, tinfo._address);
      }
    }
  },

  query: async function(request, response, rinfo, tinfo) {
    return new Promise(async (resolve, reject) => {
      try {
        (await this.getSocket(rinfo, tinfo))(request, (pkt) => {
          if (pkt) {
            if (pkt.rcode === 'NOERROR') {
              response.flags = pkt.flags;
              response.answers = pkt.answers;
              response.additionals = pkt.additionals;
              response.authorities = pkt.authorities;
              return resolve(NOERROR);
            }
            return resolve(NOTFOUND);
          }
          resolve(SERVFAIL);
        });
      }
      catch (e) {
        reject(e);
      }
    });
  },

  translateDNSNetworkAddress: function(address) {
    const entry = this._backwardCache[address];
    if (entry) {
      return entry.address;
    }
    return null;
  },

  _addTimingFailure: function(tinfo, time) {
    const dev = this._stddev(tinfo);
    this._addTimingSuccess(tinfo, time + STDEV_FAIL * dev.deviation);
  },

  _addTimingSuccess: function(tinfo, time) {
    tinfo._samples.shift();
    tinfo._samples.push(Math.min(time, tinfo._maxTimeout));
  },

  _getTimeout: function(tinfo) {
    const dev = this._stddev(tinfo);
    return Math.max(1, Math.min(dev.mean + STDEV_QUERY * dev.deviation, tinfo._maxTimeout));
  },

  _stddev: function(tinfo) {
    const mean = tinfo._samples.reduce((total, value) => total + value, 0) / tinfo._samples.length;
    const variance = tinfo._samples.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / (tinfo._samples.length - 1);
    return {
      mean: mean,
      deviation: Math.sqrt(variance)
    };
  }
}

//
// LocalDNS proxies DNS servers on the DNS network.
//
const LocalDNS = function(addresses, port, timeout) {
  this._address = addresses[0];
  this._addresses = addresses
  this._port = port;
  this._maxTimeout = timeout;
  this._samples = Array(MAX_SAMPLES).fill(this._maxTimeout);
}

LocalDNS.prototype = {

  start: async function() {
  },

  stop: function() {
  },

  query: async function(request, response, rinfo) {
    // Dont send a query back to a server it came from.
    if (this._addresses.indexOf(rinfo.address) !== -1 || this._addresses.indexOf(rinfo.originalAddress) !== -1) {
      return NOTFOUND;
    }
    return await LocalDNSSingleton.query(request, response, rinfo, this);
  }
};

//
// MapDNS maps addresses which are from the DNS network back to their original values, does the lookup,
// and then send the answers back to the original caller.
//
const MapDNS = {

  query: async function(request, response, rinfo) {
    if (request.questions[0].type !== 'PTR') {
      return NOTFOUND;
    }
    const qname = request.questions[0].name;
    if (!qname.endsWith('.in-addr.arpa')) {
      return NOTFOUND;
    }
    const m4 = qname.split('.');
    const address = LocalDNSSingleton.translateDNSNetworkAddress(`${m4[3]}.${m4[2]}.${m4[1]}.${m4[0]}`);
    if (!address) {
      return NOTFOUND;
    }
    const i4 = address.split('.');
    if (i4.length !== 4) {
      return NOTFOUND;
    }
    const mname = `${i4[3]}.${i4[2]}.${i4[1]}.${i4[0]}.in-addr.arpa`;

    const mrequest = DNS._copyDNSPacket(request, {
      questions: [{ name: mname, type: 'PTR', class: 'IN' }],
    });
    const mresponse = DNS._copyDNSPacket(response);
    const error = await DNS.query(mrequest, mresponse, rinfo);
    if (error !== NOERROR) {
      return error;
    }

    response.flags = mresponse.flags;
    response.answers = mresponse.answers.map(answer => {
      if (answer.name === mname) {
        answer.name = qname;
      }
      return answer;
    });

    return NOERROR;
  }

}

//
// DNS
// The main DNS system. This fields request and then tries to answer them by walking though a prioritized list of DNS servers.
// By default these handle local names, mulitcast names, address maps, and caching. We can also add global dns servers (which are
// references to DNS services on the physical network) as well as local dns servers (which are dns servers on our internal DNS network).
//
const DNS = { // { app: app, srv: proxy, cache: cache }

  _proxies: [
    { app: { _name: 'private', _position: { tab: -9 } }, srv: PrivateDNS,   cache: false, local: true },
    { app: { _name: 'mdns',    _position: { tab: -8 } }, srv: MulticastDNS, cache: false, local: true },
    { app: { _name: 'map',     _position: { tab: -7 } }, srv: MapDNS,       cache: false, local: true },
    { app: { _name: 'cache',   _position: { tab: -6 } }, srv: CachingDNS,   cache: false, local: true }
  ],

  start: async function(config) {
    this.setDomainName(config.domainname);
    this.setHostname(config.hostname, config.ip);
    this.setDefaultResolver(config.resolvers[0], config.resolvers[1]);

    const onMessage = async (msgin, rinfo) => {
      //console.log(msgin, rinfo);
      const start = DEBUG_QUERY_TIMING && Date.now();
      const response = {
        id: 0,
        type: 'response',
        flags: 0,
        questions: [],
        answers: [],
        authorities: [],
        additionals: []
      };
      try {
        if (msgin.length < 2) {
          throw Error('Bad length');
        }
        const request = DnsPkt.decode(msgin);
        DEBUG_QUERY && console.log('request', rinfo, JSON.stringify(request, null, 2));
        response.id = request.id;
        response.flags = request.flags;
        if ((response.flags & DnsPkt.RECURSION_DESIRED) !== 0) {
          response.flags |= DnsPkt.RECURSION_AVAILABLE;
        }
        response.questions = request.questions;
        const opt = request.additionals.find(additional => additional.type === 'OPT');
        const client = opt && opt.options.find(option => option.type === 'CLIENT_SUBNET'); // 'type' in decode, 'code' in encode
        if (client) {
          rinfo.originalAddress = client.ip; // Even as a partial address is more useful than the local address.
        }
        else {
          rinfo.originalAddress = rinfo.address;
        }
        await this.query(request, response, rinfo);
        // If we got no answers, and no error code set, we set notfound
        if (response.answers.length === 0 && (response.flags & 0x0F) === 0) {
          response.flags = (response.flags & 0xFFF0) | NOTFOUND;
        }
      }
      catch (e) {
        console.error(e);
        response.flags = (response.flags & 0xFFF0) | SERVFAIL;
      }
      DEBUG_QUERY && console.log('response', rinfo.tcp ? 'tcp' : 'udp', rinfo, JSON.stringify(DnsPkt.decode(DnsPkt.encode(response)), null, 2));
      DEBUG_QUERY_TIMING && console.log(`Query time ${Date.now() - start}ms: ${response.questions[0].name} ${response.questions[0].type}`);
      return DnsPkt.encode(response);
    }

    await new Promise(resolve => {
      const run = (callback) => {
        this._udp = UDP.createSocket({
          type: 'udp4',
          reuseAddr: true
        });
        this._udp.on('message', async (msgin, rinfo) => {
          const msgout = await onMessage(msgin, { tcp: false, address: rinfo.address, port: rinfo.port });
          this._udp.send(msgout, rinfo.port, rinfo.address, err => {
            if (err) {
              console.error(err);
            }
          });
        });
        this._udp.on('error', (e) => {
          console.log('DNS socket error - reopening');
          console.error(e);
          try {
            this._udp.close();
            this._udp = null;
          }
          catch (_) {
          }
          // Wait a moment before reopening
          setTimeout(() => run(() => {}), 1000);
        });
        this._udp.bind(config.port, callback);
      }
      run(resolve);
    });

    // Super primitive DNS over TCP handler
    await new Promise(resolve => {
      this._tcp = Net.createServer({
        allowHalfOpen: true
      }, socket => {
        socket.on('error', (e) => {
          console.error(e);
          socket.destroy();
        });
        socket.on('data', async (buffer) => {
          try {
            if (buffer.length >= 2) {
              const len = buffer.readUInt16BE();
              if (buffer.length >= 2 + len) {
                const msgin = buffer.subarray(2, 2 + len);
                const msgout = await onMessage(msgin, { tcp: true, address: socket.remoteAddress.replace(/^::ffff:/, ''), port: socket.remotePort });
                const reply = Buffer.alloc(msgout.length + 2);
                reply.writeUInt16BE(msgout.length, 0);
                msgout.copy(reply, 2);
                socket.end(reply);
              }
              else {
                socket.end();
              }
            }
          }
          catch (e) {
            console.error(e);
            socket.destroy();
          }
        });
      });
      this._tcp.on('error', (e) => {
        // If we fail to open the dns/tcp socket, report and move on.
        console.error(e);
        resolve();
      });
      this._tcp.listen(config.port, resolve);
    });

    await LocalDNSSingleton.start();

    // DNS order determined by app order in the tabs. If that changes we re-order DNS.
    // We flush the cache if the reordering is material to the DNS.
    Root.on('apps.tabs.reorder', () => {
      const order = this._proxies.reduce((t, a) => `${t},${a.app._name}`, '');
      this._proxies.sort((a, b) => a.app._position.tab - b.app._position.tab);
      const norder = this._proxies.reduce((t, a) => `${t},${a.app._name}`, '');
      if (order !== norder) {
        CachingDNS.flush();
      }
    });
  },

  stop: async function() {
    this._udp.close();
    this._tcp.close();
    await LocalDNSSingleton.stop();
  },

  setDefaultResolver: function(resolver1, resolver2) {
    this.removeDNSServer({ app: GLOBAL1 });
    this.removeDNSServer({ app: GLOBAL2 });
    if (resolver1) {
      this._addDNSProxy(GLOBAL1, new GlobalDNS(resolver1, 53, 5000), true, false);
    }
    if (resolver2) {
      this._addDNSProxy(GLOBAL2, new GlobalDNS(resolver2, 53, 5000), true, false);
    }
  },

  addDNSServer: function(app, args) {
    const proxy = args.dnsNetwork ?
      new LocalDNS([ app._secondaryIP, app._homeIP ], args.port || 53, args.timeout || 5000) :
      new GlobalDNS(app._homeIP, args.port || 53, args.timeout || 5000);
    this._addDNSProxy(app, proxy, true, false);
    return { app: app };
  },

  _addDNSProxy: function(app, proxy, cache, local) {
    proxy.start().then(() => {
      this._proxies.push({ app: app, srv: proxy, cache: cache, local: local });
      this._proxies.sort((a, b) => a.app._position.tab - b.app._position.tab);
    });
    CachingDNS.flush();
  },

  _copyDNSPacket: function(pkt, changes) {
    const npkt = DnsPkt.decode(DnsPkt.encode(pkt));
    if (changes) {
      Object.assign(npkt, changes);
    }
    return npkt;
  },

  removeDNSServer: function(dns) {
    for (let i = 0; i < this._proxies.length; i++) {
      if (this._proxies[i].app === dns.app) {
        this._proxies.splice(i, 1)[0].srv.stop();
        CachingDNS.flush();
        break;
      }
    }
  },

  setHostname: function(hostname, ip) {
    hostname = hostname || 'MinkeBox';
    if (!DEBUG) {
      FS.writeFileSync(HOSTNAME_FILE, `${hostname}\n`);
      ChildProcess.spawnSync(HOSTNAME, [ '-F', HOSTNAME_FILE ]);
    }
    this.registerHost(hostname, null, ip, Network.getSLAACAddress());
  },

  setDomainName: function(domain) {
    PrivateDNS.setDomainName(domain);
  },

  registerHost: function(localname, globalname, ip, ip6) {
    PrivateDNS.registerHost(localname, globalname, ip, ip6);
  },

  unregisterHost: function(localname) {
    PrivateDNS.unregisterHost(localname);
  },

  lookupLocalnameIP: function(localname) {
    return PrivateDNS.lookupLocalnameIP(localname);
  },

  squery: async function(request, response, rinfo) {
    const question = request.questions[0];
    if (!question) {
      throw new Error('Missing question');
    }
    let error = SERVFAIL;
    for (let i = 0; i < this._proxies.length; i++) {
      const proxy = this._proxies[i];
      DEBUG_QUERY && console.log(`Trying ${proxy.app._name}`);
      error = await proxy.srv.query(request, response, rinfo);
      if (error === NOERROR) {
        DEBUG_QUERY && console.log('Found');
        if (proxy.cache) {
          CachingDNS.add(response, NOERROR);
        }
        return true;
      }
    }
    DEBUG_QUERY && console.log('Not found', error);
    if (response.authorities.length) {
      CachingDNS.add(response, error);
    }
    response.flags = (response.flags & 0xFFF0) | error;
    return false;
  },

  pquery: async function(request, response, rinfo) {
    const question = request.questions[0];
    if (!question) {
      throw new Error('Missing question');
    }
    const done = [];
    let i = 0;
    for (; i < this._proxies.length; i++) {
      const proxy = this._proxies[i];
      if (!proxy.local) {
        break;
      }
      DEBUG_QUERY && console.log(`Trying local ${proxy.app._name}`);
      const lerror = await proxy.srv.query(request, response, rinfo);
      if (lerror === NOERROR) {
        DEBUG_QUERY && console.log('Found');
        if (proxy.cache) {
          CachingDNS.add(response, NOERROR);
        }
        return true;
      }
      done[i] = 'fail';
    }
    if (i >= this._proxies.length) {
      return NOTFOUND;
    }
    const vresponse = await new Promise(resolve => {
      let replied = false;
      for(; i < this._proxies.length; i++) {
        const proxy = this._proxies[i];
        DEBUG_QUERY && console.log(`Trying ${proxy.app._name}`);
        const presponse = DNS._copyDNSPacket(response);
        const idx = i;
        const start = DEBUG_QUERY_TIMING && Date.now();
        proxy.srv.query(Object.assign({}, request), presponse, rinfo).then(error => {
          DEBUG_QUERY && console.log(`Reply ${this._proxies[idx].app._name}`, error);
          DEBUG_QUERY_TIMING && console.log(`Query time ${Date.now() - start}ms ${this._proxies[idx].app._name}: ${question.name} ${question.type}`);
          if (!replied) {
            done[idx] = error === NOERROR ? presponse : 'fail';
            for (let k = 0; k < this._proxies.length; k++) {
              if (!done[k]) {
                // Query pending before we find an answer - need to wait for it to complete
                return;
              }
              else if (done[k] !== 'fail') {
                // Found an answer after earlier queries failed, go with this.
                replied = true;
                DEBUG_QUERY && console.log(`Success ${this._proxies[idx].app._name}`);
                if (this._proxies[k].cache) {
                  CachingDNS.add(done[k], NOERROR);
                }
                return resolve(done[k]);
              }
            }
            // Everything failed
            replied = true;
            DEBUG_QUERY && console.log('Not found');
            return resolve(null);
          }
        });
      }
    });
    if (!vresponse) {
      return NOTFOUND;
    }
    Object.assign(response, vresponse);
    return NOERROR;
  }

};

DNS.query = PARALLEL_QUERY ? DNS.pquery : DNS.squery;

module.exports = DNS;
