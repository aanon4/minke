const FS = require('fs');
const Path = require('path');
const ChildProcess = require('child_process');
const Disks = require('./Disks');
let MinkeApp;

process.umask(0);


function _Filesystem(app) {
  this._app = app;

  MinkeApp = MinkeApp || require('./MinkeApp');
}

_Filesystem.prototype = {

  getAllMounts: function(app) {

    // Remove any broken shares (in case an app was uninstalled)
    for (let i = 0; i < app._shares.length; ) {
      const appid = app._shares[i].src.replace(/^.*apps\/([^/]+).*$/,'$1');
      if (MinkeApp.getAppById(appid) && FS.existsSync(app._shares[i].src)) {
        i++;
      }
      else {
        app._shares.splice(i, 1);
      }
    }
    // Or broken backups
    for (let i = 0; i < app._backups.length; ) {
      const appid = app._backups[i].appid;
      if (MinkeApp.getAppById(appid)) {
        i++;
      }
      else {
        app._backups.splice(i, 1);
      }
    }

    const mounts = app._binds.map(map => this._makeMount(map, app)).concat(
      app._files.map(file => this.makeFile(file)),
      app._shares.map(share => this._makeShare(share)),
      app._backups.map(backup => this._makeBackups(backup))
    ).reduce((a, b) => a.concat(b), []);
    //console.log('getAllMounts', mounts);
    return mounts;
  },

  //
  // Docker should remove any mounts as it shutsdown a container. However, if there's any mount-in-mount going
  // on it has a habit of not tidying things up properly. Do that here.
  //
  unmountAll: function(mounts) {
    // Get list of mount targets
    const paths = mounts.map(mount => mount.Source);
    // Sort longest to shortest
    paths.sort((a, b) => b.length - a.length);
    paths.forEach(path => {
      try {
        ChildProcess.spawnSync('/bin/umount', [ path ], { cwd: '/tmp', stdio: 'ignore' });
      }
      catch (_) {
      }
    });
  },

  _makeMount: function(bind, app) {
    //console.log('_makeMount', bind);
    FS.mkdirSync(bind.src, { recursive: true, mode: 0o777 });
    bind.shares.forEach((share) => {
      FS.mkdirSync(`${bind.src}/${share.sname || share.name}`, { recursive: true, mode: 0o777 });
    });
    return {
      Type: 'bind',
      Source: bind.src,
      Target: this._expand(bind.target),
      BindOptions: {
        Propagation: 'rshared'
      }
    }
  },

  makeFile: function(file) {
    //console.log('makeFile', file);
    FS.mkdirSync(Path.dirname(file.src), { recursive: true, mode: 0o777 });
    FS.writeFileSync(file.src, file.data, { mode: ('mode' in file ? file.mode : 0o666) });
    return {
      Type: 'bind',
      Source: file.src,
      Target: this._expand(file.target),
      BindOptions: {
        Propagation: 'rshared'
      }
    }
  },

  readFile: function(file) {
    //console.log('readFile', file);
    file.data = FS.readFileSync(file.src, { encoding: 'utf8' });
  },

  _makeShare: function(share) {
    //console.log('_makeShare', share);
    return {
      Type: 'bind',
      Source: share.src,
      Target: this._expand(share.target),
      BindOptions: {
        Propagation: 'rshared'
      }
    }
  },

  _makeBackups: function(backup) {
    const backups = [];
    const app = MinkeApp.getAppById(backup.appid);
    if (app) {
      const name = app._safeName();
      app._binds.forEach(bind => {
        if (bind.backup) {
          backups.push({
            Type: 'bind',
            Source: bind.src,
            Target: this._expand(`${backup.target}/${name}/${bind.target}`),
            BindOptions: {
              Propagation: 'rshared'
            },
            ReadOnly: true
          });
        }
      });
      app._files.forEach(bind => {
        if (bind.backup) {
          backups.push({
            Type: 'bind',
            Source: bind.src,
            Target: this._expand(`${backup.target}/${name}/${bind.target}`),
            BindOptions: {
              Propagation: 'rshared'
            },
            ReadOnly: true
          });
        }
      });
    }
    return backups;
  },

  mapFilenameToLocal: function(filename) {
    for (let i = 0; i < this._app._binds.length; i++) {
      const bind = this._app._binds[i];
      const target = this._expand(bind.target);
      if (filename.startsWith(target)) {
        return Path.normalize(`${bind.src}/${filename.substring(target.length)}`);
      }
    }
    return null;
  },

  uninstall: function() {
    const rmAll = (path) => {
      // Removing file trees can take a while, so we do them in an async external process
      ChildProcess.spawn('/bin/rm', [ '-rf', path ], { cwd: '/tmp', stdio: 'ignore', detached: true });
    };
    rmAll(Filesystem.getNativePath(this._app._id, 'boot', ''));
    rmAll(Filesystem.getNativePath(this._app._id, 'store', ''));
  },

  saveLogs: function(stdout, stderr) {
    const root = Filesystem.getNativePath(this._app._id, 'boot', '/logs');
    FS.mkdirSync(root, { recursive: true, mode: 0o777 });
    FS.writeFileSync(`${root}/stdout.txt`, stdout);
    FS.writeFileSync(`${root}/stderr.txt`, stderr);
  },

  _expand: function(path) {
    return this._app.expand(path);
  }

}

const Filesystem = {

  create: function(app) {
    return new _Filesystem(app);
  },

  getNativePath: function(appid, id, path) {
    return Path.normalize(`${Disks.getRoot(id)}/apps/${appid}/${path}`);
  },

};

module.exports = Filesystem;
