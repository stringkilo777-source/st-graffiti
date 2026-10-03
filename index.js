(function () {
  'use strict';

  var PLUGIN_ID = 'st-graffiti';
  var MAX_GRAFFITI = 10;
  var FAB_SIZE = 46;
  var FAB_HIDE = 16;
  var SNAP_ZONE = 40;
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
    try { startPlugin(); }
    catch (err) { console.warn('[STG] init error', err); }
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

  var HUE_COLORS = [
    '#ff0000', '#ff6600', '#ffcc00', '#33cc00',
    '#00cccc', '#0066ff', '#6633ff', '#cc00cc',
    '#ff3366', '#996633', '#ffffff', '#888888'
  ];

  function startPlugin() {
    try { loadData(); } catch (e) { console.warn('[STG]', e); }
    try { makeToast(); } catch (e) { console.warn('[STG]', e); }
    try { makeFab(); } catch (e) { console.warn('[STG]', e); }
    try { makeToolbar(); } catch (e) { console.warn('[STG]', e); }
    try { makePalette(); } catch (e) { console.warn('[STG]', e); }
    try { loadSettingsHtml(); } catch (e) { console.warn('[STG]', e); }
    try { restoreAll(); } catch (e) { console.warn('[STG]', e); }
    try { bindChatChange(); } catch (e) { console.warn('[STG]', e); }
    try { observeNew(); } catch (e) { console.warn('[STG]', e); }
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

  function loadSettingsHtml() {
    var url = 'scripts/extensions/third-party/st-graffiti/settings.html';
    if (typeof jQuery !== 'undefined') {
      jQuery.get(url, function (html) {
        jQuery('#extensions_settings2').append(html);
        jQuery('#stg-reset-btn').on('click', function () {
          resetFabPosition();
        });
      });
    }
  }

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
      localStorage.setItem('stg_fab_pos', JSON.stringify({ left: l, top: t }));
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
    toast('\u60AC\u6D6E\u7403\u5DF2\u91CD\u7F6E\uFF01');
  }

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
        var finalL = currentL;
        if (currentL < SNAP_ZONE) {
          finalL = -FAB_HIDE;
        } else if (currentL > window.innerWidth - FAB_SIZE - SNAP_ZONE) {
          finalL = window.innerWidth - FAB_SIZE + FAB_HIDE;
        }
        fab.style.left = finalL + 'px';
        var finalTop = parseInt(fab.style.top) || 0;
        saveFabPos(finalL, finalTop);
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

function makeToolbar() {
  if (document.getElementById('stg-toolbar')) return;
  var bar = document.createElement('div');
  bar.id = 'stg-toolbar';

  var items = [
    { id: 'mouse', label: '\uD83D\uDDB1' },
    { id: 'sep1', sep: true },
    { id: 'pen', label: '\u270F' },
    { id: 'highlighter', label: '\uD83D\uDD8D' },
    { id: 'eraser', label: '\u2B55' },
    { id: 'sep2', sep: true },
    { id: 'color', label: '\uD83C\uDFA8' },
    { id: 'clear', label: '\uD83D\uDDD1' },{ id: 'save', label: '\uD83D\uDCBE' },
    { id: 'exit', label: '\u2716' }
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
    var target = e.target.closest('[data-stg]');
    if (!target) return;
    onTool(target.getAttribute('data-stg'));
  });
}
  
function makePalette() {
  if (document.getElementById('stg-palette')) return;

  var panel = document.createElement('div');
  panel.id = 'stg-palette';

  var title = document.createElement('div');
  title.className = 'stg-palette-title';
  title.textContent = '\u9009\u62E9\u989C\u8272';
  panel.appendChild(title);

  var ring = document.createElement('div');
  ring.className = 'stg-hue-ring';
  ring.id = 'stg-hue-ring';

  for (var i = 0; i < HUE_COLORS.length; i++) {
    var hDot = document.createElement('div');
    hDot.className = 'stg-hue-dot';
    hDot.setAttribute('data-color', HUE_COLORS[i]);
    hDot.style.background = HUE_COLORS[i];
    if (HUE_COLORS[i] === penColor) {
      hDot.classList.add('stg-selected');
    }
    ring.appendChild(hDot);
  }
  panel.appendChild(ring);

  var shadeLabel = document.createElement('div');
  shadeLabel.className = 'stg-shade-label';
  shadeLabel.textContent = '\u660E\u6697\u53D8\u4F53';
  panel.appendChild(shadeLabel);

  var shadeRow = document.createElement('div');
  shadeRow.className = 'stg-shade-row';
  shadeRow.id = 'stg-shade-row';
  panel.appendChild(shadeRow);

  buildShades(penColor, shadeRow);

  document.body.appendChild(panel);

  ring.addEventListener('click', function (e) {
    var clickedDot = e.target.closest('.stg-hue-dot');
    if (!clickedDot) return;
    var color = clickedDot.getAttribute('data-color');
    selectHueColor(color);
  });

  shadeRow.addEventListener('click', function (e) {
    var cell = e.target.closest('.stg-shade-cell');
    if (!cell) return;
    var color = cell.getAttribute('data-color');
    applyColor(color);
    highlightShadeCell(color);
  });
}

function selectHueColor(color) {
  var dots = document.querySelectorAll('#stg-hue-ring .stg-hue-dot');
  for (var i = 0; i < dots.length; i++) {
    if (dots[i].getAttribute('data-color') === color) {
      dots[i].classList.add('stg-selected');
    } else {
      dots[i].classList.remove('stg-selected');
    }
  }var shadeRow = document.getElementById('stg-shade-row');
  if (shadeRow) {
    buildShades(color, shadeRow);
  }
  applyColor(color);
}

function buildShades(baseColor, container) {
  container.innerHTML = '';
  var shades = generateShades(baseColor);
  for (var i = 0; i < shades.length; i++) {
    var cell = document.createElement('div');
    cell.className = 'stg-shade-cell';
    cell.setAttribute('data-color', shades[i]);
    cell.style.background = shades[i];
    if (shades[i] === penColor) {
      cell.classList.add('stg-selected');
    }
    container.appendChild(cell);
  }
}

function highlightShadeCell(color) {
  var cells = document.querySelectorAll('#stg-shade-row .stg-shade-cell');
  for (var i = 0; i < cells.length; i++) {
    if (cells[i].getAttribute('data-color') === color) {
      cells[i].classList.add('stg-selected');
    } else {
      cells[i].classList.remove('stg-selected');
    }
  }
}

function applyColor(color) {
  penColor = color;
  var dot = document.getElementById('stg-color-dot');
  if (dot) {
    dot.style.background = color;
  }
  var fab = document.getElementById('stg-fab');
  if (fab) {
    fab.style.borderColor = color;
    fab.style.color = color;
  }
}

function generateShades(hex) {
  var rgb = hexToRgb(hex);
  if (!rgb) return [hex];
  var shades = [];
  for (var i = 5; i >= 1; i--) {
    var factor = i / 5;
    shades.push(rgbToHex(
      Math.round(rgb.r + (255 - rgb.r) * factor),
      Math.round(rgb.g + (255 - rgb.g) * factor),
      Math.round(rgb.b + (255 - rgb.b) * factor)
    ));
  }
  shades.push(hex);
  for (var j = 1; j <= 5; j++) {
    var dark = 1 - j / 5;
    shades.push(rgbToHex(
      Math.round(rgb.r * dark),
      Math.round(rgb.g * dark),
      Math.round(rgb.b * dark)
    ));
  }
  return shades;
}

function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  var num = parseInt(hex, 16);
  if (isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexToRgba(hex, alpha) {
  var rgb = hexToRgb(hex);
  if (!rgb) return'rgba(255,133,157,' + alpha + ')';
  return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
}

function togglePalette() {
  var panel = document.getElementById('stg-palette');
  if (!panel) return;
  if (panel.classList.contains('stg-show')) {
    panel.classList.remove('stg-show');
  } else {
    panel.classList.add('stg-show');
  }
}

function hidePalette() {
  var panel = document.getElementById('stg-palette');
  if (panel) {
    panel.classList.remove('stg-show');
  }
}

function enterDraw() {
  drawing = true;
  tool = 'pen';
  var fab = document.getElementById('stg-fab');
  if (fab) fab.style.display = 'none';
  var bar = document.getElementById('stg-toolbar');
  if (bar) bar.classList.add('stg-show');
  hilite();

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
  hidePalette();
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
  if (act === 'exit') { exitDraw(); return; }
  if (act === 'save') { hidePalette(); saveData(); return; }
  if (act === 'clear') { hidePalette(); clearAll(); return; }
  if (act === 'color') { togglePalette(); return; }

  hidePalette();
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
        points: [{ x: pos.x / cv.width, y: pos.y / cv.height }]
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
        currentStroke.points.push({ x: pos.x / cv.width, y: pos.y / cv.height });
      }
    });

    cv.addEventListener('pointerup', function () {
      if (pressing && currentStroke && lastCanvas) {
        var mid = getMesId(lastCanvas);
        if (mid !== null && currentStroke.points.length > 0) {
          if (!graffitiStore[mid]) {
            graffitiStore[mid] = { strokes: [] };
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
    toast('\u5DF2\u6E05\u9664\u6240\u6709\u6D82\u9E26');
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
      toast('\u6D82\u9E26\u592A\u591A\u4E86\uFF01(' + count + '/' + MAX_GRAFFITI +') \u8BF7\u5148\u6E05\u9664\u4E00\u4E9B', 3500);
      return;
    }

    try {
      var c = getCtx();
      if (c && c.chatMetadata) {
        if (!c.chatMetadata.extensions) {
          c.chatMetadata.extensions = {};
        }
        c.chatMetadata.extensions[PLUGIN_ID] = JSON.parse(JSON.stringify(graffitiStore));
        try { if (c.saveChat) c.saveChat(); } catch (e) {}try { if (window.saveChatConditional) window.saveChatConditional(); } catch (e) {}
        try { if (window.saveChat) window.saveChat(); } catch (e) {}try { if (c.saveMetadata) c.saveMetadata(); } catch (e) {}
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

    toast('\u5DF2\u4FDD\u5B58\uFF01(' + count + '/' + MAX_GRAFFITI + ')');
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
            loadData();restoreAll();
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
    obs.observe(chat, { childList: true, subtree: true });
  }

})();
