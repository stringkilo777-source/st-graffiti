(function () {
  'use strict';

  // ====== 常量 ======
  const PLUGIN_ID = 'st-graffiti';
  const PREFIX = 'stg-';
  const MAX_GRAFFITI = 10;

  // ====== 取酒馆上下文（双保险） ======
  const ctx = SillyTavern?.getContext?.();
  const eventSource = ctx?.eventSource || window.eventSource;
  const event_types = ctx?.event_types || window.event_types;

  // ====== 状态 ======
  let isDrawingMode = false;
  let currentTool = 'mouse';   // mouse | pen | highlighter | eraser
  let currentColor = '#ff0000';
  let currentHue = 0;
  let currentSat = 1;
  let currentVal = 1;
  let penSize = 3;
  let highlighterSize = 18;
  let eraserSize = 16;
  let isPointerDown = false;
  let activeCanvas = null;
  let activeStroke = null;
  let openPopup = null;        // 当前打开的弹出面板
  let pickerDragTarget = null; // 'ring' | 'square' | null

  // 悬浮球位置记忆
  let fabPos = { right: 16, bottom: 80 };
  let fabDragged = false;
  let fabStartX = 0, fabStartY = 0;
  let fabStartRight = 0, fabStartBottom = 0;

  // 画布数据：{ mesId: { width, height, strokes: [...] } }
  let graffitiStore = {};

  // ====== 工具函数 ======
  function hsvToRgb(h, s, v) {
    const i = Math.floor(h / 60) % 6;
    const f = h / 60 - Math.floor(h / 60);
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return '#' + [r, g, b].map(c =>
      Math.round(c * 255).toString(16).padStart(2, '0')
    ).join('');
  }

  function updateColorFromHSV() {
    currentColor = hsvToRgb(currentHue, currentSat, currentVal);
    const indicator = document.getElementById('stg-color-indicator');
    if (indicator) indicator.style.background = currentColor;
    const swatch = document.querySelector('.stg-color-preview-swatch');
    if (swatch) swatch.style.background = currentColor;
  }

  function showToast(msg, duration) {
    duration = duration || 2500;
    const t = document.getElementById('stg-toast');
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

  // ====== 初始化（APP_READY + 轮询 + 幂等） ======
  let done = false;
  function fire() {
    if (done) return;
    done = true;
    try {
      init();
    } catch (e) {
      console.warn('[STG] init error:', e);
    }
  }
  if (eventSource && event_types && event_types.APP_READY) {
    eventSource.on(event_types.APP_READY, fire);
  }
  var t0 = Date.now();
  var iv = setInterval(function () {
    var ok = !!(window.extension_settings || window.SillyTavern);
    if (ok || Date.now() - t0 > 3500) { clearInterval(iv); fire(); }
  }, 250);

  // ====== 主初始化 ======
  function init() {
    loadGraffitiData();
    createToast();
    createFAB();
    createToolbar();
    createColorPickerPopup();
    createSizePopup();
    restoreSavedCanvases();
    bindGlobalEvents();
    observeNewMessages();
  }

  // ====== 提示条 ======
  function createToast() {
    if (document.getElementById('stg-toast')) return;
    var el = document.createElement('div');
    el.id = 'stg-toast';
    document.body.appendChild(el);
  }

  // ====== 悬浮球 ======
  function createFAB() {
    if (document.getElementById('stg-fab')) return;
    var fab = document.createElement('div');
    fab.id = 'stg-fab';
    fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 21l1.4-4.2L17 4.2 19.8 7 7.2 19.6z"/><path d="M14.5 6.5l3 3"/></svg>';
    fab.style.right = fabPos.right + 'px';
    fab.style.bottom = fabPos.bottom + 'px';
    document.body.appendChild(fab);

    // 拖拽逻辑
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
        // 限制在屏幕内
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
        // 贴边吸附
        var r = parseInt(fab.style.right) || 0;
        var midX = window.innerWidth / 2;
        var fabCenterX = window.innerWidth - r - fab.offsetWidth / 2;
        if (fabCenterX < midX) {
          fab.style.right = (window.innerWidth - fab.offsetWidth) + 'px';
        } else {
          fab.style.right = '0px';
        }
        fabPos.right = parseInt(fab.style.right);
        fabPos.bottom = parseInt(fab.style.bottom);
      }
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
      { id: 'mouse',       icon: '<path d="M5 3l12 8.5-5 1.5-3 5.5z"/><path d="M12 11.5l4.5 5"/>' },
      { id: 'sep1',        sep: true },
      { id: 'pen',         icon: '<path d="M3 21l1.4-4.2L17 4.2 19.8 7 7.2 19.6z"/><path d="M14.5 6.5l3 3"/>' },
      { id: 'highlighter', icon: '<path d="M14 3l7 7-8.5 8.5-7-7z"/><path d="M3 21l3.5-1-2.5-2.5z"/><path d="M9.5 7.5l7 7"/>' },
      { id: 'eraser',      icon: '<path d="M20 20H9l-6-6 9-9 8 8-5 5"/><path d="M13 20l7-7"/>' },
      { id: 'sep2',        sep: true },
      { id: 'color',       color: true },
      { id: 'sep3',        sep: true },
      { id: 'clear',       icon: '<path d="M4 6h16"/><path d="M9 6V4h6v2"/><path d="M6 6v13a1 1 0 001 1h10a1 1 0 001-1V6"/>' },
      { id: 'save',        icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v5h8V3"/><path d="M8 14h8v7H8z"/>' },
      { id: 'exit',        icon: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>' },
    ];

    tools.forEach(function (t) {
      if (t.sep) {
        var sep = document.createElement('div');
        sep.className = 'stg-separator';
        tb.appendChild(sep);
        return;
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
    });

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
    slider.addEventListener('input', function () {
      var v = parseInt(slider.value);
      setCurrentToolSize(v);
      updateSizePreview(v);
    });
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
    drawPicker(cvs);

    // 色盘交互
    cvs.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      cvs.setPointerCapture(e.pointerId);
      pickerDragTarget = getPickerTarget(cvs, e);
      handlePickerPointer(cvs, e);
    });
    cvs.addEventListener('pointermove', function (e) {
      if (pickerDragTarget) {
        e.preventDefault();
        handlePickerPointer(cvs, e);
      }
    });
    cvs.addEventListener('pointerup', function () {
      pickerDragTarget = null;
    });
  }

  // 绘制色环和明暗方块
  function drawPicker(cvs) {
    var c = cvs.getContext('2d');
    var cx = 100, cy = 100, outerR = 95, innerR = 70;
    c.clearRect(0, 0, 200, 200);

    // 色环
    for (var a = 0; a < 360; a++) {
      var start = (a - 1) * Math.PI / 180;
      var end = (a + 1) * Math.PI / 180;
      c.beginPath();
      c.arc(cx, cy, outerR, start, end);
      c.arc(cx, cy, innerR, end, start, true);
      c.closePath();
      c.fillStyle = 'hsl(' + a + ',100%,50%)';
      c.fill();
    }

    // 色环上的选中指示器
    var hueRad = currentHue * Math.PI / 180;
    var midR = (outerR + innerR) / 2;
    var hx = cx + Math.cos(hueRad) * midR;
    var hy = cy + Math.sin(hueRad) * midR;
    c.beginPath();
    c.arc(hx, hy, 8, 0, Math.PI * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 2.5;
    c.stroke();

    // 明暗方块（在色环内部）
    var sqSize = 86;
    var sx = cx - sqSize / 2;
    var sy = cy - sqSize / 2;

    // 底层：白到纯色（从左到右=饱和度）
    var gradH = c.createLinearGradient(sx, sy, sx + sqSize, sy);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, 'hsl(' + currentHue + ',100%,50%)');
    c.fillStyle = gradH;
    c.fillRect(sx, sy, sqSize, sqSize);

    // 叠加：透明到黑（从上到下=明度）
    var gradV = c.createLinearGradient(sx, sy, sx, sy + sqSize);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = gradV;
    c.fillRect(sx, sy, sqSize, sqSize);

    // 方块上的选中指示器
    var px = sx + currentSat * sqSize;
    var py = sy + (1 - currentVal) * sqSize;
    c.beginPath();
    c.arc(px, py, 7, 0, Math.PI * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.stroke();
    c.beginPath();
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
    if (dist >= 65 && dist <= 98) return 'ring';
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
      var sx = 100 - sqSize / 2;
      var sy = 100 - sqSize / 2;
      currentSat = Math.max(0, Math.min(1, (x - sx) / sqSize));
      currentVal = Math.max(0, Math.min(1, 1 - (y - sy) / sqSize));
    }

    drawPicker(cvs);
    updateColorFromHSV();
  }

  // ====== 弹窗定位 ======
  function positionPopup(popup, btn) {
    var r = btn.getBoundingClientRect();
    var tb = document.getElementById('stg-toolbar');
    var tbr = tb.getBoundingClientRect();
    popup.style.left = (tbr.right + 8) + 'px';
    popup.style.top = Math.max(10, r.top - 20) + 'px';
    // 检查是否超出屏幕底部
    requestAnimationFrame(function () {
      var pr = popup.getBoundingClientRect();
      if (pr.bottom > window.innerHeight - 10) {
        popup.style.top = Math.max(10, window.innerHeight - pr.height - 10) + 'px';
      }
    });
  }

  function closeAllPopups() {
    document.querySelectorAll('.stg-popup.stg-show').forEach(function (p) {
      p.classList.remove('stg-show');
    });
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
    canvas.width = mesText.clientWidth;
    canvas.height = mesText.clientHeight;
    mesText.appendChild(canvas);
    return canvas;
  }

  function resizeCanvas(canvas) {
    var parent = canvas.parentElement;
    if (!parent) return;
    var w = parent.clientWidth;
    var h = parent.clientHeight;
    if (canvas.width === w && canvas.height === h) return;

    // 先保存当前画面
    var tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = canvas.width;
    tmpCanvas.height = canvas.height;
    tmpCanvas.getContext('2d').drawImage(canvas, 0, 0);

    // 调整大小
    canvas.width = w;
    canvas.height = h;

    // 重新渲染（缩放绘制旧画面）
    var c = canvas.getContext('2d');
    c.drawImage(tmpCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height, 0, 0, w, h);
  }

  function getMesId(canvas) {
    var mes = canvas.closest('.mes');
    return mes ? mes.getAttribute('mesid') : null;
  }

  function enableCanvasDrawing(canvas) {
    canvas.classList.add('stg-drawing');
  }

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
    c.moveTo(x, y);
    // 画一个点（处理单击不拖动的情况）
    c.lineTo(x + 0.1, y + 0.1);
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
      graffitiStore[mesId].height = activeCanvas.height;
    }
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

  // 重绘一个画布上的所有笔画
  function redrawCanvas(canvas, data) {
    var c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width;
    var h = canvas.height;

    data.strokes.forEach(function (stroke) {
      if (stroke.points.length < 1) return;
      setupBrush(c, stroke.tool, stroke.color, stroke.size);
      c.beginPath();
      var first = stroke.points[0];
      c.moveTo(first.x * w, first.y * h);
      for (var i = 1; i < stroke.points.length; i++) {
        c.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
      }
      c.stroke();
    });

    // 恢复默认
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

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

    // 隐藏悬浮球
    var fab = document.getElementById('stg-fab');
    if (fab) fab.style.display = 'none';

    // 显示工具栏
    var tb = document.getElementById('stg-toolbar');
    if (tb) tb.classList.add('stg-visible');

    // 更新工具高亮
    updateToolHighlight();

    // 给所有消息创建画布并启用绘制
    var messages = document.querySelectorAll('#chat .mes');
    messages.forEach(function (mes) {
      var canvas = getOrCreateCanvas(mes);
      if (canvas) {
        resizeCanvas(canvas);
       
