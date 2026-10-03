(function () {
  'use strict';

  var PLUGIN_ID = 'st-graffiti';
  var MAX_GRAFFITI = 10;
  var FAB_SIZE = 46;
  var FAB_HIDE = 16;
  var initDone = false;

  function getCtx() {
    try {
      if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        return SillyTavern.getContext();
      }
    } catch (e) {}
    return null;
  }

  function fire() {
    if (initDone) return;
    initDone = true;
    try {
      startPlugin();
    } catch (err) {
      console.warn('[STG] init error', err);
    }
  }

  var t0 = Date.now();
  var poll = setInterval(function () {
    if (document.getElementById('chat') || Date.now() - t0 > 5000) {
      clearInterval(poll);
      fire();
    }
  }, 300);

  try {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
      var _c = SillyTavern.getContext();
      if (_c && _c.eventSource && _c.event_types && _c.event_types.APP_READY) {
        _c.eventSource.on(_c.event_types.APP_READY, fire);
      }
    }
  } catch (e) {}

  var drawing = false;
  var tool = 'pen';
  var penColor = '#ff0000';
  var penWidth = 3;
  var highlighterWidth = 18;
  var eraserWidth = 16;
  var pressing = false;
  var lastCanvas = null;
  var currentStroke = null;
  var graffitiStore = {};

  var fabDragged = false;
  var fabSX = 0;
  var fabSY = 0;
  var fabSL = 0;
  var fabST = 0;

  function startPlugin() {
    loadData();
    makeToast();
    makeFab();
    makeToolbar();
    makeSettingsPanel();
    restoreAll();
    bindChatChange();
    observeNew();
    console.log('[STG] ready');
  }

  function makeToast() {
    if (document.getElementById('stg-toast')) return;
    var el = document.createElement('div');
    el.id = 'stg-toast';
    document.body.appendChild(el);}

  function toast(msg, ms) {
    var el = document.getElementById('stg-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('stg-show');
    setTimeout(function () {
      el.classList.remove('stg-show');
    }, ms || 2500);
  }

  /* ---- settings panel in extensions page ---- */
  function makeSettingsPanel() {
    if (document.getElementById('stg-settings-panel')) return;

    var targets = [
      document.getElementById('extensions_settings2'),
      document.getElementById('extensions_settings')
    ];
    var container = null;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i]) {
        container = targets[i];
        break;
      }
    }
    if (!container) return;

    var wrapper = document.createElement('div');
    wrapper.id = 'stg-settings-panel';
    wrapper.innerHTML =
      '<div class="inline-drawer">' +
        '<div class="inline-drawer-toggle inline-drawer-header">' +
          '<b>ST Graffiti</b>' +
          '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>' +
        '</div>' +
        '<div class="inline-drawer-content" style="display:none;">' +
          '<div style="padding:8px 0;">' +
            '<button id="stg-reset-btn" class="menu_button" style="width:100%;">' +
              'Reset FAB Position' +
            '</button>' +'<small style="display:block;margin-top:4px;color:#999;">' +
              'If the floating button is lost or stuck off screen, click this to bring it back.' +
            '</small>' +
          '</div>' +
        '</div>' +
      '</div>';
    container.appendChild(wrapper);

    // drawer toggle
    var header = wrapper.querySelector('.inline-drawer-toggle');
    var content = wrapper.querySelector('.inline-drawer-content');
    if (header && content) {
      header.addEventListener('click', function () {
        if (content.style.display === 'none') {
          content.style.display = 'block';} else {
          content.style.display = 'none';
        }
      });
    }

    // reset button
    var resetBtn = document.getElementById('stg-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetFabPosition();
      });
    }
  }

  /* ---- FAB position ---- */
  function getDefaultFabPos() {
    return {
      left: window.innerWidth - FAB_SIZE + FAB_HIDE,
      top: window.innerHeight - 130
    };
  }

  function loadFabPos() {
    try {
      var raw = localStorage.getItem('stg_fab_pos');
      if (raw) {
        var p = JSON.parse(raw);
        if (typeof p.left === 'number' && typeof p.top === 'number') {
          if (p.left > -FAB_SIZE && p.left < window.innerWidth && p.top >= 0 && p.top < window.innerHeight) {
            return p;
          }
        }
      }
    } catch (e) {}
    return getDefaultFabPos();
  }

  function saveFabPos(l, t) {
    try {
      localStorage.setItem('stg_fab_pos', JSON.stringify({left: l, top: t}));
    } catch (e) {}
  }

  function resetFabPosition() {
    var pos = getDefaultFabPos();
    var fab = document.getElementById('stg-fab');
    if (fab) {
      fab.style.transition = 'left 0.3s ease, top 0.3s ease';
      fab.style.left = pos.left + 'px';
      fab.style.top = pos.top + 'px';
      fab.style.display = 'flex';
      setTimeout(function () {
        fab.style.transition = 'left 0.3s ease';}, 400);
    }
    saveFabPos(pos.left, pos.top);
    toast('FAB position reset!');
  }

  /* ---- FAB ---- */
  function makeFab() {
    if (document.getElementById('stg-fab')) return;
    var fab = document.createElement('div');
    fab.id = 'stg-fab';
    fab.textContent = '\u270F';

    var pos = loadFabPos();
    fab.style.left = pos.left + 'px';
    fab.style.top = pos.top + 'px';
    fab.style.transition = 'left 0.3s ease';

    document.body.appendChild(fab);

    fab.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      fabDragged = false;
      fabSX = e.clientX;
      fabSY = e.clientY;
      fabSL = parseInt(fab.style.left) || 0;
      fabST = parseInt(fab.style.top) || 0;
      fab.setPointerCapture(e.pointerId);
      fab.style.transition = 'none';
    });

    fab.addEventListener('pointermove', function (e) {
      var dx = e.clientX - fabSX;
      var dy = e.clientY - fabSY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        fabDragged = true;
        var nl = fabSL + dx;
        var nt = fabST + dy;
        nl = Math.max(-FAB_HIDE, Math.min(window.innerWidth - FAB_SIZE + FAB_HIDE, nl));
        nt = Math.max(0, Math.min(window.innerHeight - FAB_SIZE, nt));
        fab.style.left = nl + 'px';
        fab.style.top = nt + 'px';}
    });

    fab.addEventListener('pointerup', function () {
      fab.style.transition = 'left 0.3s ease';
      if (fabDragged) {
        var currentL = parseInt(fab.style.left) || 0;
        var centerX = currentL + FAB_SIZE / 2;
        var snapL;
        if (centerX < window.innerWidth / 2) {
          snapL = -FAB_HIDE;
        } else {
          snapL = window.innerWidth - FAB_SIZE + FAB_HIDE;
        }
        fab.style.left = snapL + 'px';
        var finalTop = parseInt(fab.style.top) || 0;
        saveFabPos(snapL, finalTop);
      }
    });

    fab.addEventListener('click', function (e) {
      if (fabDragged) {
        e.stopPropagation();
        return;
      }
      enterDraw();
    });
  }

  /* ---- toolbar ---- */
  function makeToolbar() {
    if (document.getElementById('stg-toolbar')) return;
    var bar = document.createElement('div');
    bar.id = 'stg-toolbar';

    var items = [
      {id: 'mouse', label: '\uD83D\uDDB1'},
      {id: 'sep1', sep: true},
      {id: 'pen', label: '\u270F'},
      {id: 'highlighter', label: '\uD83D\uDD8D'},
      {id: 'eraser', label: '\u2B55'},
      {id: 'sep2', sep: true},
      {id: 'clear', label: '\uD83D\uDDD1'},
      {id: 'save', label: '\uD83D\uDCBE'},
      {id: 'exit', label: '\u2716'}
    ];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.sep) {
        var sep = document.createElement('div');
        sep.className = 'stg-sep';
        bar.appendChild(sep);
      } else {
        var btn = document.createElement('button');
        btn.className = 'stg-btn';
        btn.setAttribute('data-stg', item.id);
        btn.textContent = item.label;
        bar.appendChild(btn);
      }
    }

    document.body.appendChild(bar);

    bar.addEventListener('click', function (e) {
      var t = e.target.closest('[data-stg]');
      if (!t) return;
      onTool(t.getAttribute('data-stg'));
    });
  }

  function enterDraw() {
    drawing = true;
    tool = 'pen';
    var fab = document.getElementById('stg-fab');
    if (fab) fab.style.display = 'none';
    var bar = document.getElementById('stg-toolbar');
    if (bar) bar.classList.add('stg-show');hilite();

    var msgs = document.querySelectorAll('#chat .mes');
    for (var i = 0; i < msgs.length; i++) {
      setupCanvas(msgs[i]);
    }
  }

  function exitDraw() {
    drawing = false;
    pressing = false;
    lastCanvas = null;
    currentStroke = null;
    var bar = document.getElementById('stg-toolbar');
    if (bar) bar.classList.remove('stg-show');
    var fab = document.getElementById('stg-fab');
    if (fab) fab.style.display = 'flex';

    var all = document.querySelectorAll('.stg-canvas');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('stg-active');
    }
  }

  function onTool(act) {
    if (act === 'exit') {
      exitDraw();return;
    }
    if (act === 'save') {
      saveData();
      return;
    }
    if (act === 'clear') {
      clearAll();
      return;
    }
    tool = act;
    hilite();
    updatePointer();
  }

  function hilite() {
    var btns = document.querySelectorAll('.stg-btn');
    for (var i = 0; i < btns.length; i++) {
      var id = btns[i].getAttribute('data-stg');
      if (id === tool) {
        btns[i].classList.add('stg-on');
      } else {
        btns[i].classList.remove('stg-on');
      }
    }
  }

  function updatePointer() {
    var all = document.querySelectorAll('.stg-canvas');
    for (var i = 0; i < all.length; i++) {
      if (tool === 'mouse' || !drawing) {
        all[i].classList.remove('stg-active');
      } else {
        all[i].classList.add('stg-active');
      }
    }
  }

  function setupCanvas(mesEl) {
    var mt = mesEl.querySelector('.mes_text');
    if (!mt) return null;
    var existing = mt.querySelector('.stg-canvas');
    if (existing) {
      if (drawing && tool !== 'mouse') existing.classList.add('stg-active');
      return existing;
    }
    var cv = document.createElement('canvas');
    cv.className = 'stg-canvas';
    cv.width = mt.clientWidth || 300;
    cv.height = mt.clientHeight || 100;
    if (drawing && tool !== 'mouse') cv.classList.add('stg-active');
    mt.appendChild(cv);
    bindCanvas(cv);
    return cv;
  }

  function getMesId(cv) {
    var mes = cv.closest('.mes');
    return mes ? mes.getAttribute('mesid') : null;
  }

  function getToolWidth() {
    if (tool === 'highlighter') return highlighterWidth;
    if (tool === 'eraser') return eraserWidth;
    return penWidth;
  }

  function setBrush(ctx) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = eraserWidth;
    } else if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = highlighterWidth;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
    }
  }

  function setupBrushFor(ctx, stroke) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = stroke.size;
    } else if (stroke.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
    }
  }

  function bindCanvas(cv) {
    cv.addEventListener('pointerdown', function (e) {
      if (!drawing || tool === 'mouse') return;
      e.preventDefault();
      pressing = true;
      lastCanvas = cv;
      cv.setPointerCapture(e.pointerId);
      var pos = getPos(cv, e);

      currentStroke = {
        tool: tool,
        color: penColor,
        size: getToolWidth(),
        points: [{x: pos.x / cv.width, y: pos.y / cv.height}]
      };

      var ctx = cv.getContext('2d');
      setBrush(ctx);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x +0.5, pos.y + 0.5);
      ctx.stroke();
    });

    cv.addEventListener('pointermove', function (e) {
      if (!pressing || cv !== lastCanvas) return;
      e.preventDefault();
      var pos = getPos(cv, e);
      var ctx = cv.getContext('2d');
      setBrush(ctx);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);

      if (currentStroke) {
        currentStroke.points.push({x: pos.x / cv.width, y: pos.y / cv.height});
      }
    });

    cv.addEventListener('pointerup', function () {
      if (pressing && currentStroke && lastCanvas) {
        var mid = getMesId(lastCanvas);
        if (mid !== null && currentStroke.points.length > 0) {
          if (!graffitiStore[mid]) {
            graffitiStore[mid] = {strokes: []};
          }
          graffitiStore[mid].strokes.push(currentStroke);
        }
      }
      pressing = false;
      lastCanvas = null;
      currentStroke = null;
    });

    cv.addEventListener('pointercancel', function () {
      pressing = false;
      lastCanvas = null;
      currentStroke = null;
    });
  }

  function getPos(cv, e) {
    var r = cv.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (cv.width / r.width),
      y: (e.clientY - r.top) * (cv.height / r.height)
    };
  }

  function redrawCanvas(cv, data) {
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    var w = cv.width;
    var h = cv.height;

    for (var s = 0; s < data.strokes.length; s++) {
      var stroke = data.strokes[s];
      if (!stroke.points || stroke.points.length < 1) continue;
      setupBrushFor(ctx, stroke);
      ctx.beginPath();
      var first = stroke.points[0];
      ctx.moveTo(first.x * w, first.y * h);
      for (var p = 1; p < stroke.points.length; p++) {
        ctx.lineTo(stroke.points[p].x * w, stroke.points[p].y * h);
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;}

  function clearAll() {
    var all = document.querySelectorAll('.stg-canvas');
    for (var i = 0; i < all.length; i++) {
      var ctx = all[i].getContext('2d');
      ctx.clearRect(0, 0, all[i].width, all[i].height);
      var mid = getMesId(all[i]);
      if (mid !== null && graffitiStore[mid]) {
        graffitiStore[mid].strokes = [];
      }
    }
    toast('Cleared all graffiti');
  }

  function saveData() {
    var keys = Object.keys(graffitiStore);
    for (var i = 0; i < keys.length; i++) {
      var d = graffitiStore[keys[i]];
      if (!d.strokes || d.strokes.length === 0) {
        delete graffitiStore[keys[i]];
      }
    }

    var count = Object.keys(graffitiStore).length;
    if (count > MAX_GRAFFITI) {
      toast('Too many!(' + count + '/' + MAX_GRAFFITI + ') Clear some first.', 3500);
      return;
    }

    try {
      var c = getCtx();
      if (c && c.chatMetadata) {
        if (!c.chatMetadata.extensions) {
          c.chatMetadata.extensions = {};
        }
        c.chatMetadata.extensions[PLUGIN_ID] = JSON.parse(JSON.stringify(graffitiStore));
        try { if (c.saveChat) c.saveChat(); } catch (e) {}
        try { if (window.saveChatConditional) window.saveChatConditional(); } catch (e) {}
        try { if (window.saveChat) window.saveChat(); } catch (e) {}
        try { if (c.saveMetadata) c.saveMetadata(); } catch (e) {}
        try { if (window.saveMetadataDebounced) window.saveMetadataDebounced(); } catch (e) {}
      }
    } catch (e) {
      console.warn('[STG] save error', e);
    }

    try {
      var cid = getChatId();
      if (cid) {
        localStorage.setItem('stg_' + cid, JSON.stringify(graffitiStore));
      }
    } catch (e) {}

    toast('Saved!(' + count + '/' + MAX_GRAFFITI + ')');
  }

  function loadData() {
    graffitiStore = {};
    try {
      var c = getCtx();
      if (c && c.chatMetadata && c.chatMetadata.extensions && c.chatMetadata.extensions[PLUGIN_ID]) {
        graffitiStore = JSON.parse(JSON.stringify(c.chatMetadata.extensions[PLUGIN_ID]));
        return;
      }
    } catch (e) {}

    try {
      var cid = getChatId();
      if (cid) {
        var raw = localStorage.getItem('stg_' + cid);
        if (raw) {
          graffitiStore = JSON.parse(raw);
        }
      }
    } catch (e) {}
  }

  function getChatId() {
    try {
      var c = getCtx();
      if (c && c.chatId) return String(c.chatId);
      if (c && c.characters && c.activeCharacter !== undefined) {
        return 'char_' + c.activeCharacter;
      }
    } catch (e) {}
    return null;
  }

  function restoreAll() {
    var keys = Object.keys(graffitiStore);
    for (var i = 0; i < keys.length; i++) {
      var mid = keys[i];
      var mes = document.querySelector('#chat .mes[mesid="' + mid + '"]');
      if (!mes) continue;
      var cv = setupCanvas(mes);
      if (!cv) continue;
      redrawCanvas(cv, graffitiStore[mid]);
    }
  }

  function bindChatChange() {
    try {
      var c = getCtx();
      if (c && c.eventSource && c.event_types) {
        var evt = c.event_types.CHAT_CHANGED || c.event_types.CHATLOADED;
        if (evt) {
          c.eventSource.on(evt, function () {
            exitDraw();
            loadData();
            restoreAll();
          });
        }
      }
    } catch (e) {}
  }

  function observeNew() {
    var chat = document.getElementById('chat');
    if (!chat) return;

    var obs = new MutationObserver(function (muts) {
      for (var m = 0; m < muts.length; m++) {
        var added = muts[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (node.nodeType !== 1) continue;
          var mes = null;
          if (node.classList && node.classList.contains('mes')) {
            mes = node;
          } else if (node.querySelector) {
            mes = node.querySelector('.mes');
          }
          if (!mes) continue;

          var mid = mes.getAttribute('mesid');
          if (mid && graffitiStore[mid]) {
            var cv = setupCanvas(mes);
            if (cv) redrawCanvas(cv, graffitiStore[mid]);
          } else if (drawing) {
            setupCanvas(mes);
          }
        }
      }
    });

    obs.observe(chat, {childList: true, subtree: true});
  }

})();
