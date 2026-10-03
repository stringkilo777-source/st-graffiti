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
  var colorPopupOpen = false;

  var cHue = 0;
  var cSat = 1;
  var cVal = 1;
  var pickTarget = null;

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
    makeColorPopup();
    loadSettingsHtml();
    restoreAll();
    bindChatChange();
    observeNew();bindClosePopup();
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
    try {
      var url = 'scripts/extensions/third-party/st-graffiti/settings.html';
      if (typeof jQuery !== 'undefined') {
        jQuery.get(url, function (html) {
          jQuery('#extensions_settings2').append(html);
          jQuery('#stg-reset-btn').on('click', function () {
            resetFabPosition();
          });
        });
      }
    } catch (e) {
      console.warn('[STG] settings load error', e);
    }
  }

  /* ---- color math ---- */
  function hsvToHex(h, s, v) {
    var i = Math.floor(h / 60) % 6;
    var f = h / 60 - Math.floor(h / 60);
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var tt = v * (1 - (1 - f) * s);
    var r = 0;
    var g = 0;
    var b = 0;
    if (i === 0) { r = v; g = tt; b = p; }
    if (i === 1) { r = q; g = v; b = p; }
    if (i === 2) { r = p; g = v; b = tt; }
    if (i === 3) { r = p; g = q; b = v; }
    if (i === 4) { r = tt; g = p; b = v; }
    if (i === 5) { r = v; g = p; b = q; }
    var rr = Math.round(r * 255).toString(16);
    var gg = Math.round(g * 255).toString(16);
    var bb = Math.round(b * 255).toString(16);
    if (rr.length < 2) rr = '0' + rr;
    if (gg.length < 2) gg = '0' + gg;
    if (bb.length < 2) bb = '0' + bb;
    return '#' + rr + gg + bb;
  }

  function updateColor() {
    penColor = hsvToHex(cHue, cSat, cVal);
    var dot = document.getElementById('stg-color-dot');
    if (dot) dot.style.background = penColor;
    var sw = document.getElementById('stg-swatch');
    if (sw) sw.style.background = penColor;
  }

  /* ---- color popup ---- */
  function makeColorPopup() {
    if (document.getElementById('stg-color-popup')) return;
    var popup = document.createElement('div');
    popup.id = 'stg-color-popup';
    popup.innerHTML =
      '<canvas id="stg-picker" width="180" height="180"></canvas>' +
      '<div id="stg-swatch" style="background:' + penColor + '"></div>';
    document.body.appendChild(popup);

    var cvs = document.getElementById('stg-picker');
    drawPicker(cvs);

    cvs.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      cvs.setPointerCapture(e.pointerId);
      pickTarget = hitTest(cvs, e);
      pickColor(cvs, e);
    });

    cvs.addEventListener('pointermove', function (e) {
      if (!pickTarget) return;
      e.preventDefault();
      pickColor(cvs, e);
    });

    cvs.addEventListener('pointerup', function () {
      pickTarget = null;
    });
  }

  function drawPicker(cvs) {
    var c = cvs.getContext('2d');
    var cx = 90;
    var cy = 90;
    var oR = 85;
    var iR = 62;
    c.clearRect(0, 0, 180, 180);

    var a = 0;
    while (a < 360) {
      var s1 = (a - 1) * Math.PI / 180;
      var s2 = (a + 1) * Math.PI / 180;
      c.beginPath();
      c.arc(cx, cy, oR, s1, s2);
      c.arc(cx, cy, iR, s2, s1, true);
      c.closePath();
      c.fillStyle = 'hsl(' + a + ',100%,50%)';
      c.fill();
      a = a + 1;
    }

    var hRad = cHue * Math.PI / 180;
    var mR = (oR + iR) / 2;
    var hx = cx + Math.cos(hRad) * mR;
    var hy = cy + Math.sin(hRad) * mR;
    c.beginPath();
    c.arc(hx, hy, 7, 0, Math.PI * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 2.5;
    c.stroke();

    var sq = 76;
    var sx = cx - sq / 2;
    var sy = cy - sq / 2;

    var gH = c.createLinearGradient(sx, sy, sx + sq, sy);
    gH.addColorStop(0, '#fff');
    gH.addColorStop(1, 'hsl(' + cHue + ',100%,50%)');
    c.fillStyle = gH;
    c.fillRect(sx, sy, sq, sq);

    var gV = c.createLinearGradient(sx, sy, sx, sy + sq);
    gV.addColorStop(0, 'rgba(0,0,0,0)');
    gV.addColorStop(1, '#000');
    c.fillStyle = gV;
    c.fillRect(sx, sy, sq, sq);

    var px = sx + cSat * sq;
    var py = sy + (1 - cVal) * sq;
    c.beginPath();
    c.arc(px, py, 6, 0, Math.PI * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.stroke();
    c.beginPath();
    c.arc(px, py, 4, 0, Math.PI * 2);
    c.strokeStyle = '#000';
    c.lineWidth = 1;
    c.stroke();
  }

  function hitTest(cvs, e) {
    var r = cvs.getBoundingClientRect();
    var x = (e.clientX - r.left) * (180 / r.width);
    var y = (e.clientY - r.top) * (180 / r.height);
    var dx = x - 90;
    var dy = y - 90;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= 58&& dist <= 88) return 'ring';
    if (Math.abs(x - 90) <= 38 && Math.abs(y - 90) <= 38) return 'square';
    return null;
  }

  function pickColor(cvs, e) {
    var r = cvs.getBoundingClientRect();
    var x = (e.clientX - r.left) * (180 / r.width);
    var y = (e.clientY - r.top) * (180 / r.height);

    if (pickTarget === 'ring') {
      var ang = Math.atan2(y - 90, x - 90) * 180 / Math.PI;
      if (ang < 0) ang = ang + 360;
      cHue = ang;
    }

    if (pickTarget === 'square') {
      var sq = 76;
      var sx = 90 - sq / 2;
      var sy = 90 - sq / 2;
      cSat = Math.max(0, Math.min(1, (x - sx) / sq));
      cVal = Math.max(0, Math.min(1,1 - (y - sy) / sq));
    }

    drawPicker(cvs);
    updateColor();
  }

  function toggleColorPopup(btn) {
    var popup = document.getElementById('stg-color-popup');
    if (!popup) return;

    if (popup.classList.contains('stg-show')) {
      popup.classList.remove('stg-show');
      colorPopupOpen = false;
      return;
    }

    var cvs = document.getElementById('stg-picker');
    if (cvs) drawPicker(cvs);

    var br = btn.getBoundingClientRect();
    var tb = document.getElementById('stg-toolbar');
    var tbr = tb ? tb.getBoundingClientRect() : br;
    popup.style.left = (tbr.right + 8) + 'px';
    popup.style.top = Math.max(10, br.top - 40) + 'px';
    popup.classList.add('stg-show');
    colorPopupOpen = true;

    setTimeout(function () {
      var pr = popup.getBoundingClientRect();
      if (pr.bottom > window.innerHeight - 10) {
        popup.style.top = Math.max(10, window.innerHeight - pr.height - 10) + 'px';
      }
    }, 0);
  }

  function closeColorPopup() {
    var popup = document.getElementById('stg-color-popup');
    if (popup) popup.classList.remove('stg-show');
    colorPopupOpen = false;
  }

  function bindClosePopup() {
    document.addEventListener('click', function (e) {
      if (!colorPopupOpen) return;
      if (e.target.closest('#stg-color-popup')) return;
      if (e.target.closest('[data-stg="color"]')) return;
      closeColorPopup();
    });
  }

  /* ---- FAB ---- */
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
      fab.style.top = pos.top + 'px';fab.style.display = 'flex';
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
      {id: 'color', isColor: true},
      {id: 'sep3', sep: true},
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
      } else if (item.isColor) {
        var cbtn = document.createElement('button');
        cbtn.className = 'stg-btn';
        cbtn.setAttribute('data-stg', 'color');
        cbtn.innerHTML = '<div id="stg-color-dot" style="background:' + penColor + '"></div>';
        bar.appendChild(cbtn);
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
      onTool(t.getAttribute('data-stg'), t);
    });
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
    closeColorPopup();
    var bar = document.getElementById('stg-toolbar');
    if (bar) bar.classList.remove('stg-show');
    var fab = document.getElementById('stg-fab');
    if (fab) fab.style.display = 'flex';

    var all = document.querySelectorAll('.stg-canvas');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('stg-active');
    }
  }

  function onTool(act, btn) {
    if (act === 'exit') { exitDraw(); return; }
    if (act === 'save') { saveData(); return; }
    if (act === 'clear') { clearAll(); return; }
    if (act === 'color') {
      toggleColorPopup(btn);
      return;
    }
    closeColorPopup();
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

  /* ---- canvas ---- */
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

  /* ---- redraw ---- */
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

  /* ---- clear ---- */
  function clearAll() {
    var all = document.querySelectorAll('.stg-canvas');
    for (var i = 0; i < all.length; i++) {
      var ctx = all[i].getContext('2d');
