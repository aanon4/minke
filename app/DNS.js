const ChildProcess = require('child_process');
const FS = require('fs');
const URL = require('url');
const Config = require('./Config');
const Network = require('./Network');

const ETC = (DEBUG ? '/tmp/' : '/etc/');
const DNSMASQ = '/usr/sbin/dnsmasq';
const DNSCRYPT = '/usr/bin/dnscrypt-proxy';
const HOSTNAME = '/bin/hostname';
const DNSMASQ_CONFIG = `${ETC}dnsmasq.conf`;
const DNSCRYPT_CONFIG = `${ETC}dnscrypt-proxy.toml`;
const DNSMASQ_RESOLV = `${ETC}dnsmasq-servers.conf`;
const HOSTNAME_FILE = `${ETC}hostname`;
const LOCAL_RESOLV = `${ETC}resolv.conf`;
const DNSMASQ_HOSTS_DIR = (DEBUG ? '/tmp/' : `${ETC}dnshosts.d/`);
const DEFAULT_FALLBACK_RESOLVER = Config.DEFAULT_FALLBACK_RESOLVER;
const DOH_SERVER_NAME = Config.DOH_SERVER_NAME;
const DOH_SERVER_PORT = Config.DOH_SERVER_PORT;
const DOH_SERVER_PATH = Config.DOH_SERVER_PATH;

let dns = null;
let dnsc = null;
let domainName = 'home';
let hostname = 'MinkeBox';
let primaryResolver = '';
let secondaryResolver = '';
let secureResolver = null;
const resolvers = {};
const cacheSize = 1024;
const hosts = {};

const DNS = {

  start: function(config) {
    this.setDomainName(config.domainname);
    this.setHostname(config.hostname, config.ip);
    this.setDefaultResolver(config.resolvers[0], config.resolvers[1], config.secure[0], config.secure[1]);
  },

  stop: async function() {
    if (dns) {
      dns.kill();
    }
    if (dnsc) {
      dnsc.kill();
    }
  },

  setDefaultResolver: function(resolver1, resolver2, secureDNS1, secureDNS2) {
    if (!secureDNS1 && !secureDNS2) {
      primaryResolver = resolver1 ? `server=${resolver1}#53\n` : '';
      secondaryResolver = resolver2 ? `server=${resolver2}#53\n` : '';
      secureResolver = null;
      this.unregisterHostIP(DOH_SERVER_NAME);
    }
    else {
      primaryResolver = `server=127.0.0.1#5453\n`;
      secondaryResolver = '';
      const fallback = resolver1 ? resolver1 : resolver2 ? resolver2 : DEFAULT_FALLBACK_RESOLVER;
      secureResolver = [
        `listen_addresses = ['127.0.0.1:5453']`,
        `netprobe_address = '${fallback}:53'`,
        `fallback_resolver = '${fallback}:53'`
      ];
      if (!secureDNS1) {
        secureDNS1 = secureDNS2;
        secureDNS2 = null;
      }

      const servers = [];
      if (secureDNS1.indexOf('sdns://') === 0) {
        servers.push('_primary');
        secureResolver = secureResolver.concat([
          `[static.'_primary']`,
          `stamp = '${secureDNS1}'`,
        ]);
      }
      else if (secureDNS1.indexOf('https://') === 0) {
        servers.push('_primary');
        secureResolver = secureResolver.concat([
          `[static.'_primary']`,
          `stamp = '${this.encodeSDNS(secureDNS1)}'`,
        ]);
      }
      else {
        servers.push(secureDNS1);
      }
      if (secureDNS2) {
        if (secureDNS2.indexOf('sdns://') === 0) {
          servers.push('_secondary');
          secureResolver = secureResolver.concat([
            `[static.'_secondary']`,
            `stamp = '${secureDNS2}'`,
          ]);
        }
        else if (secureDNS2.indexOf('https://') === 0) {
          servers.push('_secondary');
          secureResolver = secureResolver.concat([
            `[static.'_secondary']`,
            `stamp = '${this.encodeSDNS(secureDNS2)}'`,
          ]);
        }
        else {
          servers.push(secureDNS2);
        }
      }
      secureResolver = [ `server_names = ${JSON.stringify(servers)}` ].concat(secureResolver);
    }
    this._updateResolvServers();
    this._updateSecureConfig();
    this._reloadDNS();
    this._restartDNSC();
  },

  createForward: function(args) {
    const options = args.options || {};
    const resolve = {
      _id: args._id,
      name: args.name,
      IP4Address: args.IP4Address,
      Port: args.port || 53,
      priority: options.priority || 5,
      delay: options.delay || 0
    };
    resolvers[args._id] = resolve;
    if (resolve.delay) {
      setTimeout(() => {
        resolve.delay = 0;
        this._updateResolvServers();
        this._reloadDNS();
      }, resolve.delay * 1000);
    }
    else {
      this._updateResolvServers();
      this._reloadDNS();
    }
    return resolve;
  },

  removeForward: function(resolve) {
    delete resolvers[resolve._id];
    this._updateResolvServers();
    this._reloadDNS();
  },

  setHostname: function(name, ip) {
    hostname = name || 'MinkeBox';
    if (!DEBUG) {
      FS.writeFileSync(HOSTNAME_FILE, `${hostname}\n`);
      ChildProcess.spawnSync(HOSTNAME, [ '-F', HOSTNAME_FILE ]);
    }
    this.registerHostIP(hostname, ip, Network.getSLAACAddress());
    this.registerHostIP(DOH_SERVER_NAME, ip, Network.getSLAACAddress());
  },

  setDomainName: function(domain) {
    domainName = domain || 'home';
    this._updateLocalResolv();
    if (!DEBUG) {
      for (let hostname in hosts) {
        this._registerHostIP(hostname, hosts[hostname].ip, hosts[hostname].ip6, hosts[hostname].ext);
      }
    }
  },

  registerHostIP: function(hostname, ip, ip6) {
    this._registerHostIP(hostname, ip, ip6, 'h/');
  },

  registerGlobalIP: function(hostname, ip, ip6) {
    this._registerHostIP(hostname, ip, ip6, 'g/');
  },

  _registerHostIP: function(hostname, ip, ip6, ext) {
    hosts[hostname] = { ip: ip, ip6: ip6, ext: ext };
    if (!DEBUG) {
      if (hostname.indexOf('.') === -1) {
        FS.writeFileSync(`${DNSMASQ_HOSTS_DIR}${ext}${hostname}.conf`,
          `${ip} ${hostname}.${domainName}\n` + (ip6 ? `${ip6} ${hostname}.${domainName}\n` : '')
        );
      }
      else {
        FS.writeFileSync(`${DNSMASQ_HOSTS_DIR}${ext}${hostname}.conf`,
          `${ip} ${hostname}\n` + (ip6 ? `${ip6} ${hostname}\n` : '')
        );
      }
    }
  },

  unregisterHostIP: function(hostname) {
    this._unregisterHostIP(hostname, 'h/');
  },

  unregisterGlobalIP: function(hostname) {
    this._unregisterHostIP(hostname, 'g/');
  },

  _unregisterHostIP: function(hostname, ext) {
    if (!DEBUG) {
      try {
        FS.unlinkSync(`${DNSMASQ_HOSTS_DIR}${ext}${hostname}.conf`);
      }
      catch (e) {
        //console.error(e);
      }
    }
    delete hosts[hostname];
  },

  getSDNS: function() {
    return this.encodeSDNS(`https://${DOH_SERVER_NAME}:${DOH_SERVER_PORT}/${DOH_SERVER_PATH}`);
  },

  encodeSDNS: function(urlstring) {
    const url = new URL.URL(urlstring);
    const addr = url.port ? `:${url.port}` : '';
    const buffer = [
      0x02,
      [ 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 ],
      [ addr.length, Array.from(Buffer.from(addr)) ],
      0x00,
      [ url.hostname.length, Array.from(Buffer.from(url.hostname)) ],
      [ url.pathname.length, Array.from(Buffer.from(url.pathname)) ],
    ];
    return `sdns://${Buffer.from(buffer.flat(Infinity)).toString('base64').replace(/=/g,'')}`;
  },

  _updateConfig: function() {
    if (!DEBUG) {
      FS.writeFileSync(DNSMASQ_CONFIG, `${[
        'user=root',
        'bind-interfaces',
        'no-resolv',
        `servers-file=${DNSMASQ_RESOLV}`,
        `hostsdir=${DNSMASQ_HOSTS_DIR}g/`,
        `hostsdir=${DNSMASQ_HOSTS_DIR}h/`,
        'clear-on-reload',
        'strict-order',
        `cache-size=${cacheSize}`
      ].join('\n')}\n`);
    }
  },

  _updateSecureConfig: function() {
    if (secureResolver) {
      let config = [
        `max_clients = 250`,
        `ipv4_servers = true`,
        `ipv6_servers = ${!!Network.getSLAACAddress()}`,
        `block_ipv6 = ${!Network.getSLAACAddress()}`,
        `dnscrypt_servers = true`,
        `doh_servers = true`,
        `require_dnssec = false`,
        `require_nolog = false`,
        `require_nofilter = false`,
        `force_tcp = false`,
        `timeout = 5000`,
        `keepalive = 30`,
        `cert_refresh_delay = 240`,
        `blocked_query_response = 'refused'`,
        `ignore_system_dns = true`,
        `use_syslog = false`,
        `log_files_max_size = 1`,
        `log_files_max_age = 1`,
        `log_files_max_backups = 1`,
        `#block_unqualified = true`,
        `#reject_ttl = 600`,
        `cache = true`,
        `cache_size = 1024`,
        `cache_min_ttl = 2400`,
        `cache_max_ttl = 86400`,
        `cache_neg_min_ttl = 60`,
        `cache_neg_max_ttl = 600`,
        `netprobe_timeout = 60`
      ].concat(secureResolver, [
        `[sources]`,
        `[sources.'public-resolvers']`,
        `urls = ['https://raw.githubusercontent.com/DNSCrypt/dnscrypt-resolvers/master/v2/public-resolvers.md', 'https://download.dnscrypt.info/resolvers-list/v2/public-resolvers.md']`,
        `cache_file = '/var/cache/dnscrypt-proxy/public-resolvers.md'`,
        `minisign_key = 'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3'`,
        `prefix = ''`
      ]);
      FS.writeFileSync(DNSCRYPT_CONFIG, `${config.join('\n')}\n`);
    }
  },

  _updateLocalResolv: function() {
    if (!DEBUG) {
      FS.writeFileSync(LOCAL_RESOLV, `domain ${domainName}\nsearch ${domainName}. local.\nnameserver 127.0.0.1\n`);
    }
  },

  _updateResolvServers: function() {
    if (!DEBUG) {
      // Note. DNS servers are checked in reverse order
      const dns = Object.values(resolvers);
      dns.sort((a, b) => b.priority - a.priority);
      FS.writeFileSync(DNSMASQ_RESOLV, `${secondaryResolver}${primaryResolver}${dns.map((resolve) => {
        return resolve.delay === 0 ? `server=${resolve.IP4Address}#${resolve.Port}\n` : '';
      }).join('')}`);
    }
  },

  _reloadDNS: function() {
    if (dns) {
      dns.kill('SIGHUP');
    }
  },

  _restartDNSC: function() {
    if (dnsc) {
      dnsc.kill();
    }
    if (secureResolver && !DEBUG) {
      dnsc = ChildProcess.spawn(DNSCRYPT, [ '-config', DNSCRYPT_CONFIG ]);
    }
  }

}

//
// Create default config.
//
DNS._updateLocalResolv();
DNS._updateResolvServers();
DNS._updateConfig();

if (!DEBUG) {
  dns = ChildProcess.spawn(DNSMASQ, [ '-k' ]);
}


module.exports = DNS;
