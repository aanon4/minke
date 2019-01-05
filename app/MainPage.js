const FS = require('fs');
const Handlebars = require('handlebars');
const MinkeApp = require('./MinkeApp');

async function MainPageHTML(ctx) {
  const template = Handlebars.compile(FS.readFileSync(`${__dirname}/html/MainPage.html`, { encoding: 'utf8' }));
  const apps = MinkeApp.getApps().map((app) => {
    return {
      online: app._online,
      name: app._name,
      link: !!app._forward
    }
  })
  ctx.body = template({ apps: apps });
  ctx.type = 'text/html';
}

async function MainPageWS(ctx) {
  const apps = MinkeApp.getApps();

  function updateOnline(status) {
    ctx.websocket.send(JSON.stringify({
      type: 'update.html',
      selector: `#application-${status.app._name} .ready`,
      html: status.online ? '<span class="online">online</span>' : '<span class="offline">offline</span>'
    }));
  }
  function updateStatus(status) {
    ctx.websocket.send(JSON.stringify({
      type: 'update.html',
      selector: `#application-${status.app._name} .status`,
      html: status.html
    }));
  }

  ctx.websocket.on('message', (msg) => {
    // ...
  });

  ctx.websocket.on('close', () => {
    apps.forEach((app) => {
      app.off('update.online', updateOnline);
      app.off('update.status', updateStatus);
    });
  });

  ctx.websocket.on('error', () => {
    ctx.websocket.close();
  });

  apps.forEach((app) => {
    app.on('update.online', updateOnline);
    app.on('update.status', updateStatus);
  });
}

module.exports = {
  HTML: MainPageHTML,
  WS: MainPageWS
};