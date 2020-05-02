let ws = { send: () => {} };
const monitorQ = {};

function onPageShow() {
  ws = new WebSocket(`ws://${location.host}${location.pathname}ws`);
  ws.addEventListener('message', function(event) {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'html.update':
        document.querySelectorAll(msg.selector).forEach(function(elem) {
          if (elem.nodeName === 'IFRAME') {
            elem.srcdoc = msg.html;
          }
          else {
            elem.innerHTML = msg.html;
          }
          const se = elem.getElementsByTagName('script');
          for (let i = 0; i < se.length; i++) {
            eval(se[i].innerHTML);
          }
        });
        refreshCharts();
        break;
      case 'html.replace':
        document.querySelectorAll(msg.selector).forEach(function(elem) {
          const builder = document.createElement('div');
          builder.innerHTML = msg.html;
          const nelem = builder.firstElementChild;
          elem.parentNode.replaceChild(nelem, elem);
          const se = nelem.getElementsByTagName('script');
          for (let i = 0; i < se.length; i++) {
            eval(se[i].innerHTML);
          }
        });
        refreshCharts();
        break;
      case 'html.update.attribute':
        document.querySelectorAll(msg.selector).forEach(function(elem) {
          elem.setAttribute(msg.name, msg.value);
        });
        break;
      case 'html.append':
        document.querySelectorAll(msg.selector).forEach(function(elem) {
          const builder = document.createElement('tbody');
          builder.innerHTML = msg.html;
          elem.appendChild(builder.firstElementChild);
        });
        refreshCharts();
        break;
      case 'html.remove':
        document.querySelectorAll(msg.selector).forEach(function(elem) {
          elem.remove();
        });
        refreshCharts();
        break;
      case 'css.class.add':
        document.querySelectorAll(msg.selector).forEach(function(elem) {
          elem.classList.add(msg.className);
        });
        break;
      case 'page.reload':
        window.location.reload();
        break;
      case 'page.redirect':
        window.location.replace(`${msg.url}#${msg.src}`);
        break;
      case 'skeleton.load':
        install(msg.image,'skeleton');
        break;
      case 'monitor2.reply':
        monitorQ[msg.id] && monitorQ[msg.id]('reply', msg.reply);
        break;
      case 'system.captcha':
        openInlinePage(msg.url);
        break;
      default:
        break;
    }
  });
  ws.addEventListener('close', function() {
    if (window.location.pathname === '/') {
      const TIMEOUT = 10000;
      function reload() {
        const req = new XMLHttpRequest();
        req.open('GET', window.location);
        req.onreadystatechange = function() {
          if (req.readyState === 4) {
            if (req.status === 200) {
              window.location.reload();
            }
            else {
              setTimeout(reload, TIMEOUT);
            }
          }
        }
        req.timeout = TIMEOUT;
        try {
          req.send(null);
        }
        catch (_) {
        }
      }
      setTimeout(reload, TIMEOUT);
    }
  });
  ws.addEventListener('open', function() {
    updateMonitors();
  });

  document.addEventListener('visibilitychange', (event) => {
    if (document.visibilityState === 'visible') {
      updateMonitors();
    }
  });

  window.addEventListener('message', (msg) => {
    const evt = JSON.parse(msg.data);
    switch (evt.type) {
      case 'system.captcha.token':
        closeInlinePage();
        ws.send(JSON.stringify(evt));
        break;
      default:
        break;
    }
  });
}

let property = {};
let changes = [];
function setActionProperties(props) {
  property = props || {};
}
function registerChanges(ch) {
  changes = ch || [];
  changes.forEach(c => c());
}

function action(id, value) {
  if (property[id] != value) {
    property[id] = value;
    changes.forEach(c => c());
  }
  ws.send(JSON.stringify({
    type: 'action.change',
    property: id,
    value: value
  }));
}

function share(id, elem) {
  const parent = elem.parentElement.parentElement;
  const name = parent.querySelector('input[type="text"]');
  const checked = parent.querySelector('input[type="checkbox"]');
  if (name == elem) {
    checked.checked = true;
  }
  if (property[id] != checked.checked) {
    property[id] = checked.checked;
    changes.forEach(c => c());
  }
  ws.send(JSON.stringify({
    type: 'action.change',
    property: id,
    value: { shared: checked.checked, target: name.value }
  }));
}

function backup(id, elem) {
  const parent = elem.parentElement.parentElement;
  const checked = parent.querySelector('input[type="checkbox"]');
  if (property[id] != checked.checked) {
    property[id] = checked.checked;
    changes.forEach(c => c());
  }
  ws.send(JSON.stringify({
    type: 'action.change',
    property: id,
    value: { backup: checked.checked }
  }));
}

function publish(elem) {
  const parent = elem.parentElement.parentElement;
  const name = parent.querySelector('input[type="text"]');
  const checked = parent.querySelector('input[type="checkbox"]');
  if (name == elem) {
    checked.checked = true;
  }
}

function cmd(command, value) {
  ws.send(JSON.stringify({
    type: command,
    value: value
  }));
}

function filter(net) {
  if (!net) {
    document.querySelectorAll('.filter').forEach((elem) => {
      elem.classList.remove('hidden');
    });
  }
  else {
    document.querySelectorAll('.filter').forEach((elem) => {
      if (elem.classList.contains(net)) {
        elem.classList.remove('hidden');
      }
      else {
        elem.classList.add('hidden');
      }
    });
  }
  document.getElementsByClassName('list')[0].scrollTo(0, 0);
  refreshCharts();
  updateMonitors();
}

let editor = null;
function setEditMode(edit) {
  if (!editor) {
    const div = document.querySelector('.configure .skeleton .editor');
    editor = ace.edit(div, {
      useSoftTabs: true,
      tabSize: 2,
      printMargin: false
    });
    editor.on('change', () => {
      const content = editor.getValue();
      try {
        let skel;
        eval(`skel=${content}`);
        div.classList.remove('invalid');
        action('__EditSkeleton', content);
      }
      catch (_) {
        div.classList.add('invalid');
      }
    });
  }
  if (edit === null) {
    return document.firstElementChild.classList.toggle('editing');
  }
  else if (edit) {
    document.firstElementChild.classList.add('editing');
    return true;
  }
  else {
    document.firstElementChild.classList.remove('editing');
    return false;
  }
}

function install(app, src) {
  popbox.open('download');
  ws.send(JSON.stringify({
    type: 'newapp.image',
    value: app,
    src: src
  }));
}

function refreshCharts() {
  if (window.Chart) {
    for (let id in Chart.instances) {
      Chart.instances[id].resize();
    }
  }
}

function toggleHelp() {
  document.head.parentElement.classList.toggle('help-available');
}

function updateMonitors() {
  for (let id in monitorQ) {
    monitorQ[id]('request');
  }
}

function monitor(id, timeout, callback) {
  let timer = null;
  const fn = (op, arg) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (fn === monitorQ[id]) {
      switch (op) {
        case 'wait':
          timer = setTimeout(() => {
            timer = null;
            fn('request');
          }, timeout * 1000);
          break;
        case 'request':
          `application-status-${id}`
          if (document.visibilityState === 'visible' && !document.querySelector('.inline-page') && !document.querySelector(`.application-status-${id}.hidden`)) {
            cmd('monitor2.request', id);
          }
          break;
        case 'reply':
          try {
            callback(arg);
          }
          catch (_) {
          }
          fn('wait');
          break;
        default:
          break;
      }
    }
  }
  monitorQ[id] = fn;
  fn('request');
}

function saveSkeleton() {
  const content = editor.getValue();
  let name = 'app';
  try {
    let skel;
    eval(`skel=${content}`);
    name = skel.name || 'app';
  }
  catch (_) {
  }
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([ content ]));
  a.href = url;
  a.download = `${name}.skeleton`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

document.addEventListener('drop', function(event) {
  if (event.target.getAttribute('contenteditable') === 'true' || event.target.nodeName === 'TEXTAREA') {
    event.stopPropagation();
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer && event.dataTransfer.items && event.dataTransfer.items[0]) {
      const item = event.dataTransfer.items[0];
      if (item.kind === 'file')
      {
        const reader = new FileReader();
        reader.onload = function(e)
        {
          event.target.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          document.execCommand('insertText', false, e.target.result);
        };
        reader.readAsText(item.getAsFile());
      }
    }
  }
});

document.addEventListener('paste', function(event) {
  if (event.target.getAttribute('contenteditable')) {
    event.preventDefault();
    const text = (event.originalEvent || event).clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }
});

document.addEventListener('drop', function(event) {
  if ('skeleton' in event.target.dataset) {
    event.stopPropagation();
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer && event.dataTransfer.items && event.dataTransfer.items[0]) {
      const item = event.dataTransfer.items[0];
      const type = item.type;
      if (item.kind === 'file')
      {
        const reader = new FileReader();
        reader.onload = function(e)
        {
          const content = e.target.result;
          if (type === 'application/x-yaml') {
            cmd('docker-compose.drop', content);
          }
          else {
            try {
              let skel;
              eval(`skel=${content}`);
              if (('name' in skel) && (('image' in skel) || ('images' in skel)) && ('properties' in skel)) {
                cmd('skeleton.drop', content);
              }
            }
            catch (_) {
            }
          }
        };
        reader.readAsText(item.getAsFile());
      }
    }
  }
});

/* Inline page */

function closeInlinePage() {
  const div = document.querySelector(".inline-page");
  if (div) {
    div.remove();
    document.getElementsByClassName('nav')[0].removeEventListener('click', closeInlinePage);
    document.getElementsByClassName('nav')[0].removeEventListener('touchstart', closeInlinePage);
  }
}

function openInlinePage(url, target) {
  closeInlinePage();
  if (target === '_blank') {
    window.open(url, target);
  }
  else {
    const builder = document.createElement('div');
    const width = document.body.clientWidth;
    const height = document.body.clientHeight;
    builder.innerHTML = `<div class="inline-page pure-g"><div class="pure-u-1"><iframe allow="fullscreen" scroling="no" allowTransparency="true" frameborder="0" width="${width}" height="${height}" style="background-color: transparent"></div></div>`;
    const scrollY = window.scrollY;
    setTimeout(() => {
      window.scrollTo(0, scrollY);
      document.getElementsByClassName('nav')[0].addEventListener('click', closeInlinePage);
      document.getElementsByClassName('nav')[0].addEventListener('touchstart', closeInlinePage);
      onResizePage();
    }, 0);
    const div = builder.firstElementChild;
    const insert = document.getElementById('insertion-point');
    insert.insertBefore(div, insert.firstElementChild);
    function noScroll(e) {
      e.preventDefault();
    }
    div.addEventListener('scroll', noScroll);
    div.addEventListener('mousewheel', noScroll);
    div.querySelector('iframe').src = url;
    onResizePage();
  }
}

function onResizePage() {
  const elem = document.querySelector('.main .nav');
  if (elem) {
    const height = elem.clientHeight;
    document.querySelectorAll('.inline-page iframe').forEach((frame) => {
      const box = frame.parentElement;
      if (box) {
        frame.width = box.clientWidth;
        frame.height = height;
      }
    });
  }
}

/* Inline page */

/* Tables */
function addRmTableRow(action, event) {
  let tr;
  for (tr = event.target; tr.nodeName !== 'TR'; tr = tr.parentElement)
    ;
  let table;
  for (table = tr; table.nodeName !== 'TABLE'; table = table.parentElement)
    ;
  if (event.target.classList.contains('remove')) {
    tr.parentElement.removeChild(tr);
    saveTable(action, table);
  }
  else if (event.target.classList.contains('add')) {
    const th = table.querySelectorAll('thead tr th');
    const ntr = document.createElement('TR');
    for (let i = 1; i < tr.childElementCount; i++) {
      const td = document.createElement('TD');
      const input = document.createElement('INPUT');
      if (th.item(i-1).dataset.type === 'checkbox') {
        input.setAttribute('type', 'checkbox');
      }
      else {
        input.setAttribute('type', 'text');
        if (th.item(i-1).dataset.placeholder) {
          input.setAttribute('placeholder', th.item(i-1).dataset.placeholder);
        }
        if (th.item(i-1).dataset.pattern) {
          input.setAttribute('pattern', th.item(i-1).dataset.pattern);
        }
      }
      if (th.item(i-1).style.display === 'none') {
        td.style.display = 'none';
      }
      td.appendChild(input);
      ntr.appendChild(td);
    }
    const td = document.createElement('TD');
    td.classList.add('control');
    ntr.appendChild(td).innerHTML = '<span class="remove">&minus;</span>';
    table.querySelector('tbody').appendChild(ntr);
  }
}

function saveTable(action, table) {
  const values = [];
  for (let tr = table.querySelector('tbody tr'); tr; tr = tr.nextElementSibling) {
    const row = [];
    for (let td = tr.firstElementChild; td; td = td.nextElementSibling) {
      if (!td.classList.contains('control') && !('ignore' in td.dataset)) {
        const ipt = td.querySelector('input');
        if (ipt) {
          if (ipt.validity.valid) {
            row.push(ipt.type === 'checkbox' ? ipt.checked : ipt.value);
          }
        }
        else {
          row.push(td.innerText);
        }
      }
    }
    values.push(row);
  }
  window.action(action, JSON.stringify(values));
}

/* Tables */

/* Popbox */

function Popbox(config){
  // config = {blur:false}
  this.currently_opened = [];
  if('blur' in config){
    if(config.blur){
      var main_content = document.querySelector('.popbox_main_content');
      if(main_content){
        main_content.classList.add('popbox_blur');
      }
    }
  }
  this.bindEvents();
}

Popbox.prototype = {
  bindEvents: function (){
    var triggers = document.querySelectorAll('[data-popbox-target]');
    var closers = document.querySelectorAll('[data-popbox-close]');
    var popboxs = document.querySelectorAll('[data-popbox-id]');
    var self = this;
    if(triggers){
      for (var i = 0; i < triggers.length; i++) {
          triggers[i].addEventListener('click', function(e){
             e.preventDefault();
          var popbox_id = this.getAttribute('data-popbox-target');
          var popbox_arg = this.getAttribute('data-popbox-arg')
          if(popbox_id){
            self.open(popbox_id, popbox_arg);
          }
          }, false);
      }
    }
    if(closers){
      for (var i = 0; i < closers.length; i++) {
          closers[i].addEventListener('click', function(e){
             e.preventDefault();
          var popbox_id = this.getAttribute('data-popbox-close');
          if(popbox_id){
            self.close(popbox_id, this);
          }
          }, false);
      }
    }
    if(popboxs){
      for (var i = 0; i < popboxs.length; i++) {
          popboxs[i].addEventListener('click', function(e){
             e.preventDefault();
          var popbox_id = e.target.getAttribute('data-popbox-id');
          if(popbox_id){
            if (!e.target.getAttribute('data-popbox-noautoclose')) {
              self.close(popbox_id, e.target);
            }
          }
          }, false);

        popboxs[i].addEventListener(self.transition, function(e) {
          if(this.classList.contains('opened') && !this.classList.contains('visible')){
              this.classList.remove('opened');
          }
        });


      }
    }
    document.addEventListener('keyup', function(e){
      if(self.current(true) && e.keyCode == 27){
        self.close(self.current(true));
      }
    });

  },
  opened: function(popbox){
    if(popbox){
      var event = new CustomEvent("popbox_opened",{bubbles:true,detail:{popbox:popbox}});
      popbox.dispatchEvent(event);
    }
  },
  opening: function(popbox, arg){
    if(popbox){
      var event = new CustomEvent("popbox_opening",{bubbles:true,detail:{popbox:popbox,arg:arg}});
      popbox.dispatchEvent(event);
    }
  },
  closing: function(popbox,source){
    if(popbox){
      var event = new CustomEvent("popbox_closing",{bubbles:true,detail:{popbox:popbox,source:source}});
      popbox.dispatchEvent(event);
    }
  },
  closed: function(popbox,source){
    if(popbox){
      var event = new CustomEvent("popbox_closed",{bubbles:true,detail:{popbox:popbox,source:source}});
      popbox.dispatchEvent(event);
    }
  },
  current: function(last){
    // last = false
    if(last){
      var current = null;
      if(this.currently_opened.length){
        current = this.currently_opened[this.currently_opened.length-1];
      }
      return current;
    }else{
      return this.currently_opened;
    }
  },
  add: function(popbox){
    var popbox_id = this.getId(popbox);
    this.remove(popbox_id);
    this.currently_opened.push(popbox_id);
  },
  remove: function(popbox){
    var popbox_id = this.getId(popbox);
    var index = this.currently_opened.indexOf(popbox_id);
    if (index > -1) {
       this.currently_opened.splice(index, 1);
    }
  },
  zIndex: function(){
    var zindex = 9999;
    var last = this.current(true);
    if(last){
      var last = this.find(last);
      if(last){
        zindex = parseInt(last.style.zIndex);
      }
    }

    return zindex;
  },
  find: function(popbox_id){
    var popbox = this.select('[data-popbox-id="'+popbox_id+'"]');
    return popbox;
  },
  select: function(selector){
    return document.querySelector(selector);
  },
  clear: function(){
    var popboxes = document.querySelectorAll('[data-popbox-id].opened');
      for (var i = 0; i < popboxes.length; i++){
        this.close(popboxes[i]);
      }
      this.currently_opened = [];
    this.select('html').classList.remove('popbox_locked');
    this.select('html').removeAttribute('popbox');

  },
  close: function(popbox,source){
    var popbox_id = this.getId(popbox);
    var popbox = this.getpopbox(popbox);
    if(popbox){
      this.closing(popbox,source);
      this.remove(popbox_id);
      popbox.classList.remove('visible');
      popbox.style.zIndex = -999;
      if(this.currently_opened.length == 0){
        this.select('html').classList.remove('popbox_locked');
      }
      if(this.current(true)){
        this.select('html').setAttribute('popbox',this.current(true));
      }else{
        this.select('html').removeAttribute('popbox');
      }
      this.closed(popbox,source);
    }

  },
  getpopbox: function(popbox){
    if(popbox instanceof HTMLElement){
      return popbox;
    }else{
      return this.find(popbox);
    }
  },
  getId: function(popbox){
    if(popbox instanceof HTMLElement){
      return popbox.getAttribute('data-popbox-id');
    }else{
      return popbox;
    }
  },
  open: function(popbox, arg){
    var popbox_id = this.getId(popbox);
    var popbox = this.getpopbox(popbox);
    if(popbox){
      this.opening(popbox, arg);
      popbox.style.zIndex = this.zIndex()+1;
        popbox.classList.add('opened');
        setTimeout(function () {
          popbox.classList.add('visible');
        });
        this.select('html').classList.add('popbox_locked');
        this.select('html').setAttribute('popbox',popbox_id);
      this.add(popbox_id);
      this.opened(popbox);
    }
  }
}

/* Popbox */

/* Default colors */
window.mColors = [
  '#fd0a1a',
  '#ffd73e',
  '#278b30',
  '#b12427',
  '#808020',
  '#fd471f',
  '#41b376',
  '#fd1a91',
  '#88cce7',
  '#19196b',
  '#efad5a',
  '#d85452'
];

window.addEventListener('pageshow', onPageShow);
window.addEventListener('resize', onResizePage);
window.addEventListener('load', onResizePage);
