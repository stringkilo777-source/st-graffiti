(function () {
  'use strict';

  // ====== 常量 ======
  var PLUGIN_ID = 'st-graffiti';
  var PREFIX = 'stg-';
  var MAX_GRAFFITI = 10;

  // ====== 安全取酒馆上下文 ======
  function getCtx() {
    try {
      if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        return SillyTavern.getContext();
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function getEventSource() {
    var c = getCtx();
    return (c && c.eventSource) || window.eventSource || null;
  }

  function getEventTypes() {
    var c = getCtx();
    return (c && c.event_types) || window.event_types || null;
  }

  // ====== 状态 ======
  var isDrawingMode = false;
  var currentTool = 'mouse';
  var currentColor = '#ff0000';
  var currentHue = 0;
  var currentSat = 1;
  var currentVal = 1;
  var penSize = 3;
  var highlighterSize = 18;
  var eraserSize = 16;
  var isPointerDown = false;
  var activeCanvas = null;
  var activeStroke = null;
  var openPopup = null;
  var pickerDragTarget = null;

  // 悬浮球
  var fabPos = { right: 16, bottom: 80 };
  var fabDragged = false;
  var fabStartX = 0, fabStartY = 0;
  var fabStartRight = 0, fabStartBottom = 0;

  // 涂鸦数据
  var graffitiStore = {};

  // ====== 工具函数 ======
  function hsvToRgb(h, s, v) {
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
      case 5: r = v; g = p; b = q; break;
      default: r = v; g = t; b = p;
    }
    return '#' + [r, g, b].map(function (c) {
      return Math.round(c * 255).toString(16).padStart(2, '0');
    }).join('');
  }

  function updateColorFromHSV() {
    currentColor = hsvToRgb(currentHue, currentSat, currentVal);
    var indicator = document.getElementById('stg-color-indicator');
    if (indicator) indicator.style.background = currentColor;var swatch = document.querySelector('.stg-color-preview-swatch');
    if (swatch) swatch.style.background = currentColor;
  }

  function showToast(msg, duration) {
    duration = duration || 2500;
    var t = document.getElementById('stg-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('stg-show');
    setTimeout(function () { t.classList.remove('stg-show'); }, duration);
  }

  function getCurrentToolSize() {
    if (currentTool === 'pen') return penSize;
    if (currentTool === 'highlighter') return highlighterSize;
    if (currentTool === 'eraser') return eraserSize;
    return penSize;
  }

  function setCurrentToolSize(val) {
    if (currentTool === 'pen') penSize = val;
    else if (currentTool === 'highlighter') highlighterSize = val;
    else if (currentTool === 'eraser') eraserSize = val;
  }

  // ====== 初始化（APP_READY + 轮询 +幂等） ======
  var initDone = false;

  function fire() {
    if (initDone) return;
    initDone = true;
    try {
      initPlugin();
    } catch (e) {
      console.warn('[STG] init error:', e);
    }
  }

  //方式1：监听 APP_READY
  try {
    var es = getEventSource();
    var et = getEventTypes();
    if (es && et && et.APP_READY) {
      es.on(et.APP_READY, fire);
    }
  } catch (e) { /* ignore */ }

  // 方式2：轮询兜底
  var t0 = Date.now();
  var pollTimer = setInterval(function () {
    var ready = !!(window.extension_settings || (typeof SillyTavern !== 'undefined'));
    if (ready || Date.now() - t0 > 4000) {
      clearInterval(pollTimer);
      fire();
    }
  }, 300);

  // ====== 主初始化 ======
  function initPlugin() {
    loadGraffitiData();
    createToast();
    createFAB();
    createToolbar();
    createColorPickerPopup();
    createSizePopup();
    restoreSavedCanvases();
    bindGlobalEvents();
    observeNewMessages();
    console.log('[STG] ST Graffiti loaded OK');
  }

  // ====== 提示条 ======
  function createToast() {
    if (document.getElementById('stg-toast')) return;
    var el = document.createElement('div');
    el.id = 'stg-toast';
    document.body.appendChild(el);}

  // ====== 悬浮球 ======
  function createFAB() {
    if (document.getElementById('stg-fab')) return;
    var fab = document.createElement('div');
    fab.id = 'stg-fab';
    fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 21l1.4-4.2L17 4.219.8 7 7.2 19.6z"/><path d="M14.5 6.5l33"/></svg>';
    fab.style.right = fabPos.right + 'px';
    fab.style.bottom = fabPos.bottom + 'px';
    document.body.appendChild(fab);

    fab.addEventListener('pointerdown', function (e) {
      fabDragged = false;
      fabStartX = e.clientX;
      fabStartY = e.clientY;
      fabStartRight = parseInt(fab.style.right) || fabPos.right;
      fabStartBottom = parseInt(fab.style.bottom) || fabPos.bottom;
      fab.setPointerCapture(e.pointerId);
    });

    fab.addEventListener('pointermove', function (e) {
      var dx = e.clientX - fabStartX;
      var dy = e.clientY - fabStartY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        fabDragged = true;
        var newRight = fabStartRight - dx;
        var newBottom = fabStartBottom - dy;
        var maxR = window.innerWidth - fab.offsetWidth;
        var maxB = window.innerHeight - fab.offsetHeight;
        newRight = Math.max(0, Math.min(maxR, newRight));
        newBottom = Math.max(0, Math.min(maxB, newBottom));
        fab.style.right = newRight + 'px';
        fab.style.bottom = newBottom + 'px';
      }
    });

    fab.addEventListener('pointerup', function () {
      if (fabDragged) {
        var r = parseInt(fab.style.right) || 0;
        var midX = window.innerWidth / 2;
        var fabCenterX = window.innerWidth - r - fab.offsetWidth / 2;
        if (fabCenterX < midX) {
          fab.style.right = (window.innerWidth - fab.offsetWidth) + 'px';
        } else {
          fab.style.right = '0px';
        }
        fabPos.right = parseInt(fab.style.right);
        fabPos.bottom = parseInt(fab.style.bottom);}
    });

    fab.addEventListener('click', function (e) {
      if (fabDragged) { e.stopPropagation(); return; }
      enterDrawingMode();
    });
  }

  // ====== 工具栏 ======
  function createToolbar() {
    if (document.getElementById('stg-toolbar')) return;
    var tb = document.createElement('div');
    tb.id = 'stg-toolbar';

    var tools = [
      { id: 'mouse', icon: '<path d="M5 3l12 8.5-5 1.5-35.5z"/><path d="M12 11.5l4.5 5"/>' },
      { id: 'sep1', sep: true },
      { id: 'pen', icon: '<path d="M3 21l1.4-4.2L17 4.2 19.8 7 7.2 19.6z"/><path d="M14.5 6.5l3 3"/>' },
      { id: 'highlighter', icon: '<path d="M14 3l7 7-8.5 8.5-7-7z"/><path d="M3 21l3.5-1-2.5-2.5z"/><path d="M9.5 7.5l7 7"/>' },
      { id: 'eraser', icon: '<path d="M20 20H9l-6-6 9-9 8 8-5 5"/><path d="M13 20l7-7"/>' },
      { id: 'sep2', sep: true },
      { id: 'color', color: true },
      { id: 'sep3', sep: true },
      { id: 'clear', icon: '<path d="M4 6h16"/><path d="M9 6V4h6v2"/><path d="M6 6v13a1 1 0 001 1h10a1 1 0 001-1V6"/>' },{ id: 'save', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v5h8V3"/><path d="M8 14h8v7H8z"/>' },
      { id: 'exit', icon: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>' }
    ];

    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      if (t.sep) {
        var sep = document.createElement('div');
        sep.className = 'stg-separator';
        tb.appendChild(sep);
        continue;
      }
      var btn = document.createElement('button');
      btn.className = 'stg-tool-btn';
      btn.setAttribute('data-tool', t.id);
      if (t.color) {
        btn.innerHTML = '<div id="stg-color-indicator" style="background:' + currentColor + '"></div>';
      } else {
        btn.innerHTML = '<svg viewBox="0 0 24 24">' + t.icon + '</svg>';
      }
      tb.appendChild(btn);
    }

    document.body.appendChild(tb);
  }

  // ====== 粗细弹窗 ======
  function createSizePopup() {
    if (document.getElementById('stg-size-popup')) return;
    var popup = document.createElement('div');
    popup.className = 'stg-popup';
    popup.id = 'stg-size-popup';
    popup.innerHTML =
      '<div class="stg-size-preview"><div class="stg-size-dot" id="stg-size-dot"></div></div>' +
      '<input type="range" class="stg-size-slider" id="stg-size-range" min="1" max="40" value="3">' +
      '<div class="stg-size-label" id="stg-size-label">3px</div>';
    document.body.appendChild(popup);

    var slider = document.getElementById('stg-size-range');
    if (slider) {
      slider.addEventListener('input', function () {
        var v = parseInt(slider.value);
        setCurrentToolSize(v);
        updateSizePreview(v);
      });
    }
  }

  function updateSizePreview(size) {
    var dot = document.getElementById('stg-size-dot');
    var label = document.getElementById('stg-size-label');
    if (dot) {
      var display = Math.max(4, Math.min(size, 36));
      dot.style.width = display + 'px';
      dot.style.height = display + 'px';
    }
    if (label) label.textContent = size + 'px';
  }

  function showSizePopup(toolBtn) {
    var popup = document.getElementById('stg-size-popup');
    var slider = document.getElementById('stg-size-range');
    if (!popup || !slider) return;
    var size = getCurrentToolSize();
    slider.value = size;
    updateSizePreview(size);
    positionPopup(popup, toolBtn);
    popup.classList.add('stg-show');
    openPopup = popup;
  }

  // ====== 调色板弹窗 ======
  function createColorPickerPopup() {
    if (document.getElementById('stg-color-popup')) return;
    var popup = document.createElement('div');
    popup.className = 'stg-popup';
    popup.id = 'stg-color-popup';
    popup.innerHTML =
      '<canvas id="stg-picker-canvas" width="200" height="200"></canvas>' +
      '<div class="stg-color-preview-row">' +
      '<div class="stg-color-preview-swatch" style="background:' + currentColor + '"></div>' +
      '</div>';
    document.body.appendChild(popup);

    var cvs = document.getElementById('stg-picker-canvas');
    if (cvs) {
      drawPicker(cvs);

      cvs.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        cvs.setPointerCapture(e.pointerId);
        pickerDragTarget = getPickerTarget(cvs, e);
        handlePickerPointer(cvs, e);
      });cvs.addEventListener('pointermove', function (e) {
        if (pickerDragTarget) {
          e.preventDefault();
          handlePickerPointer(cvs, e);
        }
      });
      cvs.addEventListener('pointerup', function () {
        pickerDragTarget = null;
      });
    }
  }

  function drawPicker(cvs) {
    var c = cvs.getContext('2d');
    var cx = 100, cy = 100, outerR = 95, innerR = 70;
    c.clearRect(0, 0, 200, 200);

    // 色环
    for (var a = 0; a < 360; a++) {
      var startA = (a - 1) * Math.PI / 180;
      var endA = (a + 1) * Math.PI / 180;
      c.beginPath();
      c.arc(cx, cy, outerR, startA, endA);
      c.arc(cx, cy, innerR, endA, startA, true);
      c.closePath();
      c.fillStyle = 'hsl(' + a + ',100%,50%)';
      c.fill();
    }

    // 色环指示器
    var hueRad = currentHue * Math.PI / 180;
    var midR = (outerR + innerR) / 2;
    var hx = cx + Math.cos(hueRad) * midR;
    var hy = cy + Math.sin(hueRad) * midR;
    c.beginPath();
    c.arc(hx, hy,8, 0, Math.PI * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 2.5;
    c.stroke();

    // 明暗方块
    var sqSize = 86;
    var sx = cx - sqSize / 2;
    var sy = cy - sqSize / 2;

    var gradH = c.createLinearGradient(sx, sy, sx + sqSize, sy);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, 'hsl(' + currentHue + ',100%,50%)');
    c.fillStyle = gradH;
    c.fillRect(sx, sy, sqSize, sqSize);

    var gradV = c.createLinearGradient(sx, sy, sx, sy + sqSize);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = gradV;
    c.fillRect(sx, sy, sqSize, sqSize);

    // 方块指示器
    var px = sx + currentSat * sqSize;
    var py = sy + (1 - currentVal) * sqSize;
    c.beginPath();
    c.arc(px, py, 7, 0, Math.PI * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.stroke();c.beginPath();
    c.arc(px, py, 5, 0, Math.PI * 2);
    c.strokeStyle = '#000';
    c.lineWidth = 1;
    c.stroke();
  }

  function getPickerTarget(cvs, e) {
    var rect = cvs.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (200 / rect.width);
    var y = (e.clientY - rect.top) * (200 / rect.height);
    var dx = x - 100, dy = y - 100;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= 65&& dist <= 98) return 'ring';
    var sqHalf = 43;
    if (Math.abs(x - 100) <= sqHalf && Math.abs(y - 100) <= sqHalf) return 'square';
    return null;
  }

  function handlePickerPointer(cvs, e) {
    var rect = cvs.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (200 / rect.width);
    var y = (e.clientY - rect.top) * (200 / rect.height);

    if (pickerDragTarget === 'ring') {
      var angle = Math.atan2(y - 100, x - 100) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      currentHue = angle;
    } else if (pickerDragTarget === 'square') {
      var sqSize = 86;
      var sx2 = 100 - sqSize / 2;
      var sy2 = 100 - sqSize / 2;
      currentSat = Math.max(0, Math.min(1, (x - sx2) / sqSize));
      currentVal = Math.max(0, Math.min(1, 1 - (y - sy2) / sqSize));
    }

    drawPicker(cvs);
    updateColorFromHSV();
  }

  // ====== 弹窗定位 ======
  function positionPopup(popup, btn) {
    var r = btn.getBoundingClientRect();
    var tb = document.getElementById('stg-toolbar');
    if (!tb) return;
    var tbr = tb.getBoundingClientRect();
    popup.style.left = (tbr.right +8) + 'px';
    popup.style.top = Math.max(10, r.top - 20) + 'px';
    requestAnimationFrame(function () {
      var pr = popup.getBoundingClientRect();
      if (pr.bottom > window.innerHeight - 10) {
        popup.style.top = Math.max(10, window.innerHeight - pr.height - 10) + 'px';
      }
    });
  }

  function closeAllPopups() {
    var popups = document.querySelectorAll('.stg-popup.stg-show');
    for (var i = 0; i < popups.length; i++) {
      popups[i].classList.remove('stg-show');
    }
    openPopup = null;
  }

  // ====== 画布管理 ======
  function getOrCreateCanvas(mesEl) {
    var mesText = mesEl.querySelector('.mes_text');
    if (!mesText) return null;
    var existing = mesText.querySelector('.stg-canvas');
    if (existing) return existing;

    var canvas = document.createElement('canvas');
    canvas.className = 'stg-canvas';
    canvas.width = mesText.clientWidth || 300;
    canvas.height = mesText.clientHeight || 100;
    mesText.appendChild(canvas);
    return canvas;
  }

  function resizeCanvas(canvas) {
    var parent = canvas.parentElement;
    if (!parent) return;
    var w = parent.clientWidth || 300;
    var h = parent.clientHeight || 100;
    if (canvas.width === w && canvas.height === h) return;

    var tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = canvas.width;
    tmpCanvas.height = canvas.height;
    tmpCanvas.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = w;
    canvas.height = h;

    var c = canvas.getContext('2d');
    c.drawImage(tmpCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height, 0, 0, w, h);
  }

  function getMesId(canvas) {
    var mes = canvas.closest('.mes');
    return mes ? mes.getAttribute('mesid') : null;
  }

  function enableCanvasDrawing(canvas) {
    canvas.classList.add('stg-drawing');}

  function disableCanvasDrawing(canvas) {
    canvas.classList.remove('stg-drawing');
  }

  // ====== 绘制引擎 ======
  function beginStroke(canvas, x, y) {
    var c = canvas.getContext('2d');
    var size = getCurrentToolSize();
    activeStroke = {
      tool: currentTool,
      color: currentColor,
      size: size,
      points: [{ x: x / canvas.width, y: y / canvas.height }]
    };
    activeCanvas = canvas;
    setupBrush(c, currentTool, currentColor, size);
    c.beginPath();
    c.moveTo(x, y);c.lineTo(x + 0.1, y + 0.1);
    c.stroke();
  }

  function continueStroke(canvas, x, y) {
    if (!activeStroke || canvas !== activeCanvas) return;
    var c = canvas.getContext('2d');
    var pts = activeStroke.points;
    var lastPt = pts[pts.length - 1];
    var lx = lastPt.x * canvas.width;
    var ly = lastPt.y * canvas.height;

    setupBrush(c, activeStroke.tool, activeStroke.color, activeStroke.size);
    c.beginPath();
    c.moveTo(lx, ly);
    c.lineTo(x, y);
    c.stroke();

    pts.push({ x: x / canvas.width, y: y / canvas.height });
  }

  function endStroke() {
    if (!activeStroke || !activeCanvas) return;
    var mesId = getMesId(activeCanvas);
    if (mesId !== null) {
      if (!graffitiStore[mesId]) {
        graffitiStore[mesId] = {
          width: activeCanvas.width,
          height: activeCanvas.height,
          strokes: []
        };
      }
      graffitiStore[mesId].strokes.push(activeStroke);
      graffitiStore[mesId].width = activeCanvas.width;
      graffitiStore[mesId].height = activeCanvas.height;}
    activeStroke = null;
    activeCanvas = null;
  }

  function setupBrush(c, tool, color, size) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (tool === 'eraser') {
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(0,0,0,1)';
      c.lineWidth = size;
    } else if (tool === 'highlighter') {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.3;
      c.strokeStyle = color;
      c.lineWidth = size;
    } else {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.strokeStyle = color;
      c.lineWidth = size;
    }
  }

  function redrawCanvas(canvas, data) {
    var c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width;
    var h = canvas.height;

    for (var s = 0; s < data.strokes.length; s++) {
      var stroke = data.strokes[s];
      if (stroke.points.length < 1) continue;
      setupBrush(c, stroke.tool, stroke.color, stroke.size);
      c.beginPath();
      var first = stroke.points[0];
      c.moveTo(first.x * w, first.y * h);
      for (var p = 1; p < stroke.points.length; p++) {
        c.lineTo(stroke.points[p].x * w, stroke.points[p].y * h);
      }
      c.stroke();
    }

    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;}

  // ====== 画布指针事件 ======
  function onCanvasPointerDown(e) {
    if (!isDrawingMode) return;
    if (currentTool === 'mouse') return;
    e.preventDefault();
    isPointerDown = true;
    var canvas = e.target;
    canvas.setPointerCapture(e.pointerId);
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (canvas.width / rect.width);
    var y = (e.clientY - rect.top) * (canvas.height / rect.height);
    beginStroke(canvas, x, y);
  }

  function onCanvasPointerMove(e) {
    if (!isPointerDown || !activeCanvas) return;
    e.preventDefault();
    var canvas = activeCanvas;
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (canvas.width / rect.width);
    var y = (e.clientY - rect.top) * (canvas.height / rect.height);
    continueStroke(canvas, x, y);
  }

  function onCanvasPointerUp() {
    if (!isPointerDown) return;
    isPointerDown = false;
    endStroke();
  }

  function attachCanvasEvents(canvas) {
    canvas.addEventListener('pointerdown', onCanvasPointerDown);
    canvas.addEventListener('pointermove', onCanvasPointerMove);
    canvas.addEventListener('pointerup', onCanvasPointerUp);
    canvas.addEventListener('pointercancel', onCanvasPointerUp);
  }

  // ====== 进入/退出绘画模式 ======
  function enterDrawingMode() {
    isDrawingMode = true;
    currentTool = 'pen';

    var fab = document.getElementById('stg-fab');
    if (fab) fab.style.display = 'none';

    var tb = document.getElementById('stg-toolbar');
    if (tb) tb.classList.add('stg-visible');

 
