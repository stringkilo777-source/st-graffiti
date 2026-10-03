(function () {
  'use strict';

  var PLUGIN_ID = 'st-graffiti';
  var MAX_GRAFFITI = 10;
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

  /* ---- state ---- */
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
  var openPopup = null;

  /* color HSV */
  var cHue = 0, cSat = 1, cVal = 1;
  var pickerTarget = null;

  /* fab */
  var fabLeft = -999;
  var fabTop = -999;
  var fabDragged = false;
  var fabSX = 0, fabSY = 0, fabSL = 0, fabST = 0;
  var FAB_SIZE = 46;
  var FAB_HIDE = 26;

  function startPlugin() {
    loadData();
    makeToast();
    makeFab();
    makeToolbar();
    makeColorPopup();
    makeSizePopup();
    restoreAll();
    bindChatChange();
    observeNew();
    console.log('[STG] ready');
  }

  /* ---- toast ---- */
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
    setTimeout(function () { el.classList.remove('stg-show'); }, ms || 2500);
  }

  /* ---- FAB ---- */
  function makeFab() {
    if (document.getElementById('stg-fab')) return;
    var fab = document.createElement('div');
    fab.id = 'stg-fab';
    fab.textContent = '\u270F';
    fabLeft = window.innerWidth - FAB_SIZE + FAB_HIDE;
    fabTop = window.innerHeight - 130;
    fab.style.left = fabLeft + 'px';
    fab.style.top = fabTop + 'px';
    fab.style.transition = 'left 0.3s ease';
    document.body.appendChild(fab);

    fab.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      fabDragged = false;
      fabSX = e.clientX;
      fabSY = e.clientY;
      fabSL = parseInt(fab.style.left) || fabLeft;
      fabST = parseInt(fab.style.top) || fabTop;
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
        nl = Math.max(-FAB_HIDE, Math.min(window.innerWidth - FAB_SIZE + FAB_HIDE, nl));nt = Math.max(0, Math.min(window.innerHeight - FAB_SIZE, nt));
        fab.style.left = nl + 'px';
        fab.style.top = nt + 'px';}
    });

    fab.addEventListener('pointerup', function () {
      fab.style.transition = 'left 0.3s ease';
      if (fabDragged) {
        var currentL = parseInt(fab.style.left) || 0;
        var centerX = currentL + FAB_SIZE / 2;
        if (centerX < window.innerWidth / 2) {
          fab.style.left = (-FAB_HIDE) + 'px';
        } else {
          fab.style.left = (window.innerWidth - FAB_SIZE + FAB_HIDE) + 'px';
        }
        fabLeft = parseInt(fab.style.left);
        fabTop = parseInt(fab.style.top);
      }});

    fab.addEventListener('click', function (e) {
      if (fabDragged) { e.stopPropagation(); return; }
      enterDraw();
    });
  }

  /* ---- toolbar ---- */
  function makeToolbar() {
    if (document.getElementById('stg-toolbar')) return;
    var bar = document.createElement('div');
    bar.id = 'stg-toolbar';

    var items = [
      { id: 'mouse', label: '\uD83D\uDDB1', type: 'btn' },
      { type: 'sep' },
      { id: 'pen', label: '\u270F', type: 'btn' },
      { id: 'highlighter', label: '\uD83D\uDD8D', type: 'btn' },
      { id: 'eraser', label: '\u2B55', type: 'btn' },
      { type: 'sep' },
      { id: 'color', type: 'color' },
      { type: 'sep' },
      { id: 'clear', label: '\uD83D\uDDD1', type: 'btn' },
      { id: 'save', label: '\uD83D\uDCBE', type: 'btn' },{ id: 'exit', label: '\u2716', type: 'btn' }
    ];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.type === 'sep') {
        var sep = document.createElement('div');
        sep.className = 'stg-sep';
        bar.appendChild(sep);
      } else if (item.type === 'color') {
        var btn = document.createElement('button');
        btn.className = 'stg-btn';
        btn.setAttribute('data-stg', 'color');
        btn.innerHTML = '<div id="stg-color-dot" style="background:' + penColor + '"></div>';
        bar.appendChild(btn);
      } else {
        var btn2 = document.createElement('button');
        btn2.className = 'stg-btn';
        btn2.setAttribute('data-stg', item.id);
        btn2.textContent = item.label;
        bar.appendChild(btn2);
      }
    }

    document.body.appendChild(bar);

    bar.addEventListener('click', function (e) {
      var t = e.target.closest('[data-stg]');
      if (!t) return;
      onTool(t.getAttribute('data-stg'), t);
    });
  }

  /* ---- color popup ---- */
  function makeColorPopup() {
    if (document.getElementById('stg-color-popup')) return;
    var popup = document.createElement('div');
    popup.className = 'stg-popup';
    popup.id = 'stg-color-popup';
    popup.innerHTML =
      '<canvas id="stg-picker" width="180" height="180"></canvas>' +
      '<div class="stg-preview-row">' +
      '<div class="stg-preview-swatch" id="stg-swatch" style="background:' + penColor + '"></div>' +
      '</div>';
    document.body.appendChild(popup);

    var cvs = document.getElementById('stg-picker');
    drawPicker(cvs);

    cvs.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      cvs.setPointerCapture(e.pointerId);
      pickerTarget = hitPicker(cvs, e);
      doPick(cvs, e);
    });cvs.addEventListener('pointermove', function (e) {
      if (!pickerTarget) return;
      e.preventDefault();
      doPick(cvs, e);
    });
    cvs.addEventListener('pointerup', function () {
      pickerTarget = null;
    });
  }

  function drawPicker(cvs) {
    var c = cvs.getContext('2d');
    var cx = 90, cy = 90, oR = 85, iR = 62;
    c.clearRect(0, 0, 180, 180);

    for (var a = 0; a < 360; a++) {
      var s1 = (a - 1) * Math.PI / 180;
      var s2 = (a + 1) * Math.PI / 180;
      c.beginPath();
      c.arc(cx, cy, oR, s1, s2);
      c.arc(cx, cy, iR, s2, s1, true);
      c.closePath();
      c.fillStyle = 'hsl(' + a + ',100%,50%)';
      c.fill();
    }

    var hRad = cHue * Math.PI / 180;
    var mR = (oR + iR) / 2;
    c.beginPath();
    c.arc(cx + Math.cos(hRad) * mR, cy + Math.sin(hRad) * mR, 7, 0, Math.PI * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 2.5;
    c.stroke();

    var sq = 76;
    var sx = cx - sq / 2, sy = cy - sq / 2;
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
    c.stroke();c.beginPath();
    c.arc(px, py, 4, 0, Math.PI * 2);
    c.strokeStyle = '#000';
    c.lineWidth = 1;
    c.stroke();
  }

  function hitPicker(cvs, e) {
    var r = cvs.getBoundingClientRect();
    var x = (e.clientX - r.left) * (180 / r.width);
    var y = (e.clientY - r.top) * (180 / r.height);
    var dx = x - 90, dy = y - 90;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= 58&& dist <= 88) return 'ring';
    if (Math.abs(x - 90) <= 38 && Math.abs(y - 90) <= 38) return 'square';
    return null;
  }

  function doPick(cvs, e) {
    var r = cvs.getBoundingClientRect();
    var x = (e.clientX - r.left) * (180 / r.width);
    var y = (e.clientY - r.top) * (180 / r.height);

    if (pickerTarget === 'ring') {
      var ang = Math.atan2(y - 90, x - 90) * 180 / Math.PI;
      if (ang < 0) ang += 360;
      cHue = ang;
    } else if (pickerTarget === 'square') {
      var sq = 76, sx = 90 - sq / 2, sy = 90 - sq / 2;
      cSat = Math.max(0, Math.min(1, (x - sx) / sq));
      cVal = Math.max(0, Math.min(1, 1 - (y - sy) / sq));
    }

    drawPicker(cvs);
    penColor = hsvToHex(cHue, cSat, cVal);
    var dot = document.getElementById('stg-color-dot');
    if (dot) dot.style.background = penColor;
    var sw = document.getElementById('stg-swatch');
    if (sw) sw.style.background = penColor;
  }

  function hsvToHex(h, s, v) {
    var i = Math.floor(h / 60) % 6;
    var f = h / 60 - Math.floor(h / 60);
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (i) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q;
    }
    return '#' + [r, g, b].map(function (c) {
      return Math.round(c * 255).toString(16).padStart(2, '0');
    }).join('');
  }

  /* ---- size popup ---- */
  function makeSizePopup() {
    if (document.getElementById('stg-size-popup')) return;
    var popup = document.createElement('div');
    popup.className = 'stg-popup';
    popup.id = 'stg-size-popup';
    popup.innerHTML =
      '<div class="stg-size-row">' +
      '<div class="stg-size-dot" id="stg-sdot"></div>' +
      '<input type="range" class="stg-slider" id="stg-sslider" min="1" max="40" value="3">' +
      '<span class="stg-size-label" id="stg-slabel">3px</span>' +
      '</div>';
    document.body.appendChild(popup);

    var slider = document.getElementById('stg-sslider');
    slider.addEventListener('input', function () {
      var v = parseInt(slider.value);
      setToolSize(v);
      updSizeDot(v);
    });}

  function getToolSize() {
    if (tool === 'highlighter') return highlighterWidth;
    if (tool === 'eraser') return eraserWidth;
    return penWidth;
  }

  function setToolSize(v) {
    if (tool === 'highlighter') highlighterWidth = v;
    else if (tool === 'eraser') eraserWidth = v;
    else penWidth = v;}

  function updSizeDot(size) {
    var dot = document.getElementById('stg-sdot');
    var lbl = document.getElementById('stg-slabel');
    if (dot) {
      var d = Math.max(4, Math.min(size, 32));
      dot.style.width = d + 'px';
      dot.style.height = d + 'px';
    }
    if (lbl) lbl.textContent = size + 'px';
  }

  /* ---- popup position ---- */
  function showPopup(id, btn) {
    var popup = document.getElementById(id);
    if (!popup) return;

    if (popup.classList.contains('stg-show')) {
      popup.classList.remove('stg-show');
      openPopup = null;
      return;
    }

    closePopups();
    var br = btn.getBoundingClientRect();
    var tb = document.getElementById('stg-toolbar');
    var tbr = tb ? tb.getBoundingClientRect() : br;
    popup.style.left = (tbr.right + 8) + 'px';
    popup.style.top = Math.max(10, br.top - 20) + 'px';
    popup.classList.add('stg-show');openPopup = popup;

    requestAnimationFrame(function () {
      var pr = popup.getBoundingClientRect();
      if (pr.bottom > window.innerHeight - 10) {
        popup.style.top = Math.max(10, window.innerHeight - pr.height - 10) + 'px';
      }
    });
  }

  function closePopups() {
    var all = document.querySelectorAll('.stg-popup.stg-show');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('stg-show');}
    openPopup = null;
  }

  /* ---- enter / exit ---- */
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
    closePopups();
    var bar = document.getElementById('stg-toolbar');
    if (bar) bar.classList.remove('stg-show');
    var fab = document.getElementById('stg-fab');
    if (fab) fab.style.display = 'flex';

    var all = document.querySelectorAll('.stg-canvas');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('stg-active');
    }
  }

  /* ---- tool selection ---- */
  function onTool(act, btn) {
    if (act === 'exit') { exitDraw(); return; }
    if (act === 'save') { saveData(); return; }
    if (act === 'clear') { clearAll(); return; }

    if (act === 'color') {
      showPopup('stg-color-popup', btn);
      return;
    }

    // drawing tools
    if (act === tool) {
      // re-click same tool = show size popup
      if (act !== 'mouse') {
        var slider = document.getElementById('stg-sslider');
        if (slider) {
          slider.value = getToolSize();
          updSizeDot(getToolSize());
        }
        showPopup('stg-size-popup', btn);
      }
      return;
    }

    closePopups();
    tool = act;
    hilite();
    updatePointer();
  }

  function hilite() {
    var btns = document.querySelectorAll('.stg-btn');
    for (var i = 0; i < btns.length; i++) {
      var id = btns[i].getAttribute('data-stg');
      if (id === tool) {
        btns[i].classList.add('stg-on');} else {
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

  /* ---- brush ---- */
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
        size: getToolSize(),
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

  /* ---- redraw ---- */
  function redrawCanvas(cv, data) {
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    var w = cv.width, h = cv.height;

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
      ctx.clearRect(0, 0, all[i].width, all[i].height);
      var mid = getMesId(all[i]);
      if (mid !== null && graffitiStore[mid]) {
        graffitiStore[mid].strokes = [];
      }
    }
    toast('Cleared all graffiti');
  }

  /* ---- save ---- */
  function saveData() {
    var keys = Object.keys(graffitiStore);
    for (var i = 0; i < keys.length; i++) {
      var d = graffitiStore[keys[i]];
      if (!d.
