(function () {
'use strict';

var PLUGIN_ID = 'st-graffiti';
var MAX_GRAFFITI = 10;
var MAX_HISTORY = 20;
var FAB_SIZE = 46;
var FAB_HIDE = 16;
var SNAP_ZONE = 40;
var initDone = false;

var paletteH = 0;
var paletteS = 1;
var paletteV = 1;
var recentColors = [];
var paletteUI = null;

var brushPresets = [
  {
    id: 'normal',
    name: '画笔',
    icon: null,
    author: '涂鸦插件官方',
    defaultWidth: 3,
    defaultOpacity: 1,
    flow: 100,
    hardness: 100,
    spacing: 10
  },
  {
    id: 'highlighter',
    name: '荧光笔',
    icon: null,
    author: '涂鸦插件官方',
    defaultWidth: 18,
    defaultOpacity: 0.3,
    flow: 100,
    hardness: 50,
    spacing: 5
  }
];

var DEFAULT_BRUSH_ICON =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<circle cx="16" cy="16" r="10" fill="white" opacity=".3"/>' +
    '<circle cx="16" cy="16" r="6" fill="white" opacity=".8"/>' +
    '</svg>'
  );

var drawing = false;
var tool = 'brush';
var brushType = 'normal';
var penColor = '#ff0000';
var penWidth = 3;
var penOpacity = 1;
var highlighterWidth = 18;
var highlighterOpacity = 0.3;
var eraserWidth = 16;
var brushFlow = 100;
var brushHardness = 100;
var brushSpacing = 10;

var pressing = false;
var lastCanvas = null;
var currentStroke = null;
var lastX = 0;
var lastY = 0;
var graffitiStore = {};
var historyStacks = {};
var redoStacks = {};
var lastEditedMid = null;

var fabDragged = false;
var fabSX = 0;
var fabSY = 0;
var fabSL = 0;
var fabST = 0;

var brushSettingsTab = 'brushes';
var brushSizeControl = null;
var brushOpacityControl = null;

var shapeMode = null;
var shapeStartX = 0;
var shapeStartY = 0;
var shapeDrawing = false;
var shapePreviewCanvas = null;

var toastTimer = null;

/* 取色器独立状态，不复用画笔的 pressing / lastCanvas。 */
var eyedropper = {
  active: false,
  pointerId: null,
  layer: null,
  originalColor: null,
  previousTool: 'brush',
  currentColor: null,
  ui: null,
  marker: null,
  lens: null,
  canvas: null,
  label: null
};

function getCtx() {
  try {
    if (
      typeof SillyTavern !== 'undefined' &&
      typeof SillyTavern.getContext === 'function'
    ) {
      return SillyTavern.getContext();
    }
  } catch (e) {
    console.warn('[STG] context:', e);
  }
  return null;
}

function byId(id) {
  return document.getElementById(id);
}

function styled(tag, styles, text) {
  var element = document.createElement(tag);
  if (styles) Object.assign(element.style, styles);
  if (text !== undefined) element.textContent = text;
  return element;
}

function stopEvent(e) {
  e.stopPropagation();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validColor(color) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}

function hideElement(id) {
  var element = byId(id);
  if (element) element.style.display = 'none';
}

function makePanel(id, width) {
  var panel = styled('div', {
    position: 'fixed',
    left: '60px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(30,30,30,0.95)',
    borderRadius: '16px',
    border: '2px solid rgba(255,133,157,0.4)',
    padding: '12px',
    zIndex: '9999999',
    display: 'none',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
    maxWidth: 'calc(100vw - 68px)'
  });
  panel.id = id;
  if (width) panel.style.width = width + 'px';
  return panel;
}

function sectionLabel(text) {
  return styled('div', {
    fontSize: '10px',
    color: '#aaa',
    marginBottom: '6px',
    userSelect: 'none'
  }, text);
}

function startPlugin() {
  loadData();
  loadRecentColors();
  loadBrushIcons();
  makeToast();
  makeFab();
  makeToolbar();
  makeUtilityMenu();
  makeShapeToolbar();
  makePalette();
  makeBrushSettingsPanel();
  makeEyedropperUI();
  loadSettingsHtml();
  restoreAll();
  bindChatChange();
  observeNew();
  console.log('[STG] ready: touch-eyedropper-1');
}

/* ---------- 记忆色 ---------- */

function loadRecentColors() {
  try {
    var stored = JSON.parse(localStorage.getItem('stg_recent_colors') || '[]');
    recentColors = Array.isArray(stored)
      ? stored.filter(validColor).slice(0, 6)
      : [];
  } catch (e) {
    recentColors = [];
  }
}

function addRecentColor(color) {
  if (!validColor(color)) return;
  color = color.toLowerCase();
  var index = recentColors.indexOf(color);
  if (index >= 0) recentColors.splice(index, 1);
  recentColors.unshift(color);
  recentColors = recentColors.slice(0, 6);
  try {
    localStorage.setItem('stg_recent_colors', JSON.stringify(recentColors));
  } catch (e) {
    console.warn('[STG] recent colors:', e);
  }
  updateRecentColorUI();
}

function updateRecentColorUI() {
  var container = byId('stg-recent-colors');
  if (!container) return;
  container.innerHTML = '';
  for (var i = 0; i < 6; i++) {
    var cell = styled('div', {
      width: '24px',
      height: '24px',
      flexShrink: '0',
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.2)',
      boxSizing: 'border-box',
      cursor: 'pointer',
      background: recentColors[i] || 'rgba(255,255,255,0.1)'
    });
    if (recentColors[i]) {
      cell.setAttribute('data-recent-color', recentColors[i]);
    }
    container.appendChild(cell);
  }
}

function loadBrushIcons() {
  try {
    var icons = JSON.parse(localStorage.getItem('stg_brush_icons') || '{}');
    brushPresets.forEach(function (brush) {
      if (typeof icons[brush.id] === 'string') brush.icon = icons[brush.id];
    });
  } catch (e) {
    console.warn('[STG] brush icons:', e);
  }
}

function saveBrushIcon(id, iconData) {
  try {
    var icons = JSON.parse(localStorage.getItem('stg_brush_icons') || '{}');
    icons[id] = iconData;
    localStorage.setItem('stg_brush_icons', JSON.stringify(icons));
  } catch (e) {
    console.warn('[STG] save brush icon:', e);
  }
}

/* ---------- 提示、设置、悬浮球 ---------- */

function makeToast() {
  if (byId('stg-toast')) return;
  var element = document.createElement('div');
  element.id = 'stg-toast';
  document.body.appendChild(element);
}

function toast(message, duration) {
  var element = byId('stg-toast');
  if (!element) return;
  clearTimeout(toastTimer);
  element.textContent = message;
  element.classList.add('stg-show');
  toastTimer = setTimeout(function () {
    element.classList.remove('stg-show');
  }, duration || 2500);
}

function loadSettingsHtml() {
  try {
    if (typeof jQuery === 'undefined') return;
    jQuery.get(
      'scripts/extensions/third-party/st-graffiti/settings.html',
      function (html) {
        if (byId('stg-reset-btn')) return;
        jQuery('#extensions_settings2').append(html);
        jQuery('#stg-reset-btn').on('click', resetFabPosition);
      }
    );
  } catch (e) {
    console.warn('[STG] settings:', e);
  }
}

function getDefaultFabPos() {
  return {
    left: window.innerWidth - FAB_SIZE + FAB_HIDE,
    top: Math.max(0, window.innerHeight - 130)
  };
}

function loadFabPos() {
  try {
    var p = JSON.parse(localStorage.getItem('stg_fab_pos') || 'null');
    if (
      p && typeof p.left === 'number' && typeof p.top === 'number' &&
      p.left > -FAB_SIZE && p.left < window.innerWidth &&
      p.top >= 0 && p.top < window.innerHeight
    ) return p;
  } catch (e) {}
  return getDefaultFabPos();
}

function saveFabPos(left, top) {
  try {
    localStorage.setItem('stg_fab_pos', JSON.stringify({left: left, top: top}));
  } catch (e) {}
}

function resetFabPosition() {
  var pos = getDefaultFabPos();
  var fab = byId('stg-fab');
  if (fab) {
    fab.style.left = pos.left + 'px';
    fab.style.top = pos.top + 'px';
    fab.style.display = 'flex';
  }
  saveFabPos(pos.left, pos.top);
  toast('悬浮球已重置！');
}

function makeFab() {
  if (byId('stg-fab')) return;
  var fab = document.createElement('div');
  fab.id = 'stg-fab';
  fab.textContent = '\u270F';
  var pos = loadFabPos();
  fab.style.left = pos.left + 'px';
  fab.style.top = pos.top + 'px';
  fab.style.transition = 'left 0.3s ease';
  document.body.appendChild(fab);

  var activePointer = null;

  fab.addEventListener('pointerdown', function (e) {
    if (activePointer !== null) return;
    e.preventDefault();
    activePointer = e.pointerId;
    fabDragged = false;
    fabSX = e.clientX;
    fabSY = e.clientY;
    fabSL = parseFloat(fab.style.left) || 0;
    fabST = parseFloat(fab.style.top) || 0;
    fab.setPointerCapture(e.pointerId);
    fab.style.transition = 'none';
  });

  fab.addEventListener('pointermove', function (e) {
    if (e.pointerId !== activePointer) return;
    var dx = e.clientX - fabSX;
    var dy = e.clientY - fabSY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) fabDragged = true;
    if (!fabDragged) return;
    fab.style.left = clamp(
      fabSL + dx, -FAB_HIDE, window.innerWidth - FAB_SIZE + FAB_HIDE
    ) + 'px';
    fab.style.top = clamp(
      fabST + dy, 0, Math.max(0, window.innerHeight - FAB_SIZE)
    ) + 'px';
  });

  fab.addEventListener('pointerup', function (e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    fab.style.transition = 'left 0.3s ease';
    if (!fabDragged) return;
    var left = parseFloat(fab.style.left) || 0;
    if (left < SNAP_ZONE) left = -FAB_HIDE;
    else if (left > window.innerWidth - FAB_SIZE - SNAP_ZONE) {
      left = window.innerWidth - FAB_SIZE + FAB_HIDE;
    }
    fab.style.left = left + 'px';
    saveFabPos(left, parseFloat(fab.style.top) || 0);
  });

  fab.addEventListener('pointercancel', function () {
    activePointer = null;
    fabDragged = true;
  });

  fab.addEventListener('click', function (e) {
    if (fabDragged) {
      e.stopPropagation();
      return;
    }
    enterDraw();
  });
}

/* ---------- 工具栏 ---------- */

function makeToolbar() {
  if (byId('stg-toolbar')) return;
  var bar = document.createElement('div');
  bar.id = 'stg-toolbar';
  var items = [
    ['mouse', '\uD83D\uDDB1'],
    ['sep1'],
    ['brush', '\uD83D\uDD8C'],
    ['smudge', '晕'],
    ['eraser', '\u2B55'],
    ['sep2'],
    ['undo', '↶'],
    ['redo', '↷'],
    ['sep3'],
    ['utility', '🔧'],
    ['color', ''],
    ['clear', '\uD83D\uDDD1'],
    ['save', '\uD83D\uDCBE'],
    ['exit', '\u2716']
  ];

  items.forEach(function (item) {
    if (item.length === 1) {
      var sep = document.createElement('div');
      sep.className = 'stg-sep';
      bar.appendChild(sep);
      return;
    }
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'stg-btn';
    button.setAttribute('data-stg', item[0]);
    if (item[0] === 'color') {
      button.id = 'stg-color-btn';
      var indicator = styled('div', {
        width: '20px',
        height: '20px',
        borderRadius: '4px',
        background: penColor,
        border: '2px solid rgba(255,255,255,0.6)',
        boxSizing: 'border-box',
        pointerEvents: 'none'
      });
      indicator.id = 'stg-color-indicator';
      button.appendChild(indicator);
    } else {
      button.textContent = item[1];
    }
    bar.appendChild(button);
  });
  document.body.appendChild(bar);
  bar.addEventListener('click', function (e) {
    var target = e.target.closest('[data-stg]');
    if (target) onTool(target.getAttribute('data-stg'));
  });
}

function makeUtilityMenu() {
  if (byId('stg-utility-menu')) return;
  var menu = makePanel('stg-utility-menu');
  menu.style.padding = '8px';
  menu.style.flexDirection = 'column';
  menu.style.gap = '4px';

  [
    ['eyedropper', '💧', '取色器'],
    ['shapes', '▢', '形状']
  ].forEach(function (item) {
    var button = styled('button', {
      width: '36px',
      height: '36px',
      borderRadius: '8px',
      border: 'none',
      background: 'transparent',
      color: '#ccc',
      fontSize: '16px',
      cursor: 'pointer'
    }, item[1]);
    button.type = 'button';
    button.title = item[2];
    button.setAttribute('data-util', item[0]);
    menu.appendChild(button);
  });
  document.body.appendChild(menu);
  menu.addEventListener('click', function (e) {
    var button = e.target.closest('[data-util]');
    if (!button) return;
    menu.style.display = 'none';
    if (button.getAttribute('data-util') === 'eyedropper') {
      activateEyedropper();
    } else {
      toggleShapeToolbar();
    }
  });
  menu.addEventListener('pointerdown', stopEvent);
  menu.addEventListener('pointermove', stopEvent);
}

function makeShapeToolbar() {
  if (byId('stg-shape-toolbar')) return;
  var bar = styled('div', {
    position: 'fixed',
    left: '50%',
    bottom: '20px',
    transform: 'translateX(-50%) translateY(150%)',
    display: 'flex',
    gap: '6px',
    padding: '8px 12px',
    background: 'rgba(30,30,30,0.95)',
    borderRadius: '16px',
    border: '2px solid rgba(255,133,157,0.4)',
    zIndex: '9999999',
    transition: 'transform 0.3s ease'
  });
  bar.id = 'stg-shape-toolbar';

  [
    ['line', '—'], ['wave', '~'], ['rect', '▢'],
    ['ellipse', '○'], ['curve', '⌢'], ['close', '✕']
  ].forEach(function (item) {
    var button = styled('button', {
      width: '40px',
      height: '40px',
      borderRadius: '10px',
      border: 'none',
      background: 'transparent',
      color: '#ccc',
      fontSize: '18px',
      cursor: 'pointer'
    }, item[1]);
    button.type = 'button';
    button.className = 'stg-shape-btn';
    button.setAttribute('data-shape', item[0]);
    button.title = getShapeName(item[0]);
    bar.appendChild(button);
  });
  document.body.appendChild(bar);

  bar.addEventListener('click', function (e) {
    var button = e.target.closest('[data-shape]');
    if (!button) return;
    var id = button.getAttribute('data-shape');
    if (id === 'close') {
      hideShapeToolbar();
      return;
    }
    shapeMode = id;
    tool = 'shape';
    Array.prototype.forEach.call(bar.querySelectorAll('[data-shape]'), function (b) {
      b.style.background = b === button ? 'rgba(255,133,157,0.2)' : 'transparent';
      b.style.color = b === button ? '#ff859d' : '#ccc';
    });
    hilite();
    updatePointer();
    toast('已选择形状: ' + getShapeName(id));
  });
  bar.addEventListener('pointerdown', stopEvent);
  bar.addEventListener('pointermove', stopEvent);
}

function getShapeName(id) {
  return {
    line: '直线', wave: '波浪线', rect: '矩形',
    ellipse: '椭圆', curve: '曲线', close: '关闭'
  }[id] || id;
}

function toggleShapeToolbar() {
  var bar = byId('stg-shape-toolbar');
  if (!bar) return;
  bar.style.transform = bar.style.transform.indexOf('translateY(0)') >= 0
    ? 'translateX(-50%) translateY(150%)'
    : 'translateX(-50%) translateY(0)';
}

function hideShapeToolbar() {
  var bar = byId('stg-shape-toolbar');
  if (bar) bar.style.transform = 'translateX(-50%) translateY(150%)';
  shapeMode = null;
  if (tool === 'shape') {
    tool = 'brush';
    hilite();
    updatePointer();
  }
}

/* ---------- 手机取色器：按下预览，拖动更新，松手确认 ---------- */

function makeEyedropperUI() {
  if (eyedropper.ui) return;

  var ui = styled('div', {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    display: 'none',
    pointerEvents: 'none',
    zIndex: '10000002'
  });
  ui.id = 'stg-eyedropper-ui';

  var marker = styled('div', {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '18px',
    height: '18px',
    border: '2px solid white',
    borderRadius: '50%',
    boxSizing: 'border-box',
    boxShadow: '0 0 0 1px #000',
    transform: 'translate(-50%,-50%)',
    pointerEvents: 'none'
  });
  marker.appendChild(styled('div', {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '4px',
    height: '4px',
    background: '#fff',
    border: '1px solid #000',
    borderRadius: '50%',
    transform: 'translate(-50%,-50%)'
  }));
  ui.appendChild(marker);

  var lens = styled('div', {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '96px',
    height: '96px',
    boxSizing: 'border-box',
    border: '3px solid white',
    borderRadius: '50%',
    overflow: 'hidden',
    boxShadow: '0 0 0 1px #000,0 4px 12px rgba(0,0,0,.5)',
    backgroundColor: '#ddd',
    backgroundImage:
      'conic-gradient(#aaa 25%,#eee 0 50%,#aaa 0 75%,#eee 0)',
    backgroundSize: '12px 12px',
    pointerEvents: 'none'
  });

  var canvas = styled('canvas', {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    imageRendering: 'pixelated',
    pointerEvents: 'none'
  });
  canvas.width = 25;
  canvas.height = 25;
  canvas.id = 'stg-mag-canvas';
  lens.appendChild(canvas);

  lens.appendChild(styled('div', {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '8px',
    height: '8px',
    border: '1px solid white',
    boxShadow: '0 0 0 1px black',
    transform: 'translate(-50%,-50%)',
    boxSizing: 'border-box',
    pointerEvents: 'none'
  }));
  ui.appendChild(lens);

  var label = styled('div', {
    position: 'fixed',
    left: '0',
    top: '0',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgba(20,20,20,.94)',
    color: '#fff',
    fontSize: '12px',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    transform: 'translateX(-50%)',
    pointerEvents: 'none'
  }, '按住涂鸦取色');
  ui.appendChild(label);
  document.body.appendChild(ui);

  eyedropper.ui = ui;
  eyedropper.marker = marker;
  eyedropper.lens = lens;
  eyedropper.canvas = canvas;
  eyedropper.label = label;
}

function activateEyedropper() {
  if (eyedropper.active) return;
  if (!drawing || pressing || shapeDrawing) return;
  makeEyedropperUI();

  eyedropper.previousTool = tool === 'eyedropper' ? 'brush' : tool;
  eyedropper.originalColor = penColor;
  eyedropper.currentColor = null;
  eyedropper.pointerId = null;
  eyedropper.active = true;
  tool = 'eyedropper';

  hideBrushSettings();
  hideElement('stg-palette');
  hideElement('stg-utility-menu');
  eyedropper.ui.style.display = 'none';
  updatePointer();
  hilite();

  /*
   * 独立透明触摸层只在取色时存在。
   * 不往画笔 Canvas 添加或删除绘图监听器。
   */
  var layer = styled('div', {
    position: 'fixed',
    left: '0',
    top: '0',
    right: '0',
    bottom: '0',
    background: 'transparent',
    zIndex: '10000001',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none'
  });
  layer.id = 'stg-eyedropper-touch-layer';

  var cancelButton = styled('button', {
    position: 'absolute',
    right: '12px',
    top: '12px',
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #ff859d',
    background: '#242424',
    color: '#fff',
    fontSize: '13px'
  }, '取消取色');
  cancelButton.type = 'button';
  cancelButton.addEventListener('pointerdown', stopEvent);
  cancelButton.addEventListener('click', function (e) {
    e.stopPropagation();
    deactivateEyedropper(false);
  });
  layer.appendChild(cancelButton);

  layer.addEventListener('pointerdown', eyedropperClick);
  layer.addEventListener('pointermove', eyedropperMove);
  layer.addEventListener('pointerup', eyedropperRelease);
  layer.addEventListener('pointercancel', eyedropperCancel);
  layer.addEventListener('lostpointercapture', function (e) {
    if (eyedropper.active && eyedropper.pointerId === e.pointerId) {
      deactivateEyedropper(false);
    }
  });
  layer.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  eyedropper.layer = layer;
  document.body.appendChild(layer);
  window.addEventListener('blur', eyedropperCancel);
  toast('按住涂鸦拖动取色，松手确认');
}

function deactivateEyedropper(keepColor) {
  var wasActive = eyedropper.active;
  var previousTool = eyedropper.previousTool;
  var originalColor = eyedropper.originalColor;
  var layer = eyedropper.layer;

  eyedropper.active = false;
  eyedropper.pointerId = null;
  eyedropper.currentColor = null;
  eyedropper.layer = null;

  window.removeEventListener('blur', eyedropperCancel);
  if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
  if (eyedropper.ui) eyedropper.ui.style.display = 'none';

  if (wasActive && !keepColor && validColor(originalColor)) {
    previewColor(originalColor);
    syncPaletteFromColor(originalColor);
  }
  if (tool === 'eyedropper') {
    tool = previousTool || 'brush';
  }
  if (wasActive) {
    updatePointer();
    hilite();
  }
}

function eyedropperCancel() {
  if (eyedropper.active) deactivateEyedropper(false);
}

function eyedropperClick(e) {
  if (!eyedropper.active || eyedropper.pointerId !== null) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  eyedropper.pointerId = e.pointerId;
  try {
    eyedropper.layer.setPointerCapture(e.pointerId);
  } catch (error) {
    console.warn('[STG] eyedropper capture:', error);
  }

  /* 第一次按下就采样，不再等待 pointermove。 */
  sampleEyedropper(e.clientX, e.clientY);
}

function eyedropperMove(e) {
  if (!eyedropper.active || e.pointerId !== eyedropper.pointerId) return;
  e.preventDefault();
  e.stopPropagation();
  sampleEyedropper(e.clientX, e.clientY);
}

function eyedropperRelease(e) {
  if (!eyedropper.active || e.pointerId !== eyedropper.pointerId) return;
  e.preventDefault();
  e.stopPropagation();

  /* 以松手位置重新采样，不能沿用上一处有效颜色。 */
  sampleEyedropper(e.clientX, e.clientY);
  var color = eyedropper.currentColor;
  eyedropper.pointerId = null;

  if (validColor(color)) {
    deactivateEyedropper(true);
    applyColor(color);
    syncPaletteFromColor(color);
  } else {
    deactivateEyedropper(false);
    toast('松手位置没有涂鸦颜色，保留原颜色');
  }
}

function findGraffitiCanvas(x, y) {
  var layer = eyedropper.layer;
  var elements;

  /*
   * 临时让触摸层不参与命中检测，寻找真正位于触点下的楼层。
   * 这里只用于定位 Canvas，不读取 DOM 的 color/backgroundColor。
   */
  if (layer) layer.style.pointerEvents = 'none';
  try {
    elements = document.elementsFromPoint
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint(x, y)];
  } finally {
    if (layer) layer.style.pointerEvents = 'auto';
  }

  for (var i = 0; i < elements.length; i++) {
    var element = elements[i];
    if (!element || !element.closest) continue;
    if (element.closest('#stg-eyedropper-ui')) continue;

    var message = element.closest('#chat .mes');
    if (!message) continue;
    var canvas = message.querySelector('.mes_text .stg-canvas');
    if (!canvas) continue;

    var rect = canvas.getBoundingClientRect();
    if (
      rect.width > 0 && rect.height > 0 &&
      x >= rect.left && x < rect.right &&
      y >= rect.top && y < rect.bottom
    ) return canvas;
  }
  return null;
}

function sampleEyedropper(x, y) {
  if (!eyedropper.active) return;
  eyedropper.currentColor = null;

  var ui = eyedropper.ui;
  var lens = eyedropper.lens;
  var label = eyedropper.label;
  var magCanvas = eyedropper.canvas;
  var magContext = magCanvas.getContext('2d');

  ui.style.display = 'block';
  eyedropper.marker.style.left = x + 'px';
  eyedropper.marker.style.top = y + 'px';

  var lensLeft = clamp(x - 48, 6, Math.max(6, window.innerWidth - 102));
  var lensTop = y - 132;
  if (lensTop < 6) lensTop = y + 28;
  lensTop = clamp(lensTop, 6, Math.max(6, window.innerHeight - 130));

  lens.style.left = lensLeft + 'px';
  lens.style.top = lensTop + 'px';
  lens.style.borderColor = '#fff';
  label.style.left = (lensLeft + 48) + 'px';
  label.style.top = (lensTop + 101) + 'px';

  magContext.clearRect(0, 0, 25, 25);

  var canvas = findGraffitiCanvas(x, y);
  if (!canvas) {
    label.textContent = '无涂鸦';
    previewColor(eyedropper.originalColor);
    syncPaletteFromColor(eyedropper.originalColor);
    return;
  }

  var rect = canvas.getBoundingClientRect();
  var px = clamp(
    Math.floor((x - rect.left) * canvas.width / rect.width),
    0, canvas.width - 1
  );
  var py = clamp(
    Math.floor((y - rect.top) * canvas.height / rect.height),
    0, canvas.height - 1
  );

  try {
    var context = canvas.getContext('2d');
    var pixel = context.getImageData(px, py, 1, 1).data;

    /*
     * 边缘处保留空白偏移，使放大镜中央始终对应采样像素。
     */
    var sourceLeft = Math.max(0, px - 12);
    var sourceTop = Math.max(0, py - 12);
    var sourceRight = Math.min(canvas.width, px + 13);
    var sourceBottom = Math.min(canvas.height, py + 13);
    var region = context.getImageData(
      sourceLeft, sourceTop,
      sourceRight - sourceLeft, sourceBottom - sourceTop
    );
    magContext.putImageData(
      region,
      sourceLeft - (px - 12),
      sourceTop - (py - 12)
    );

    if (pixel[3] === 0) {
      label.textContent = '透明区域';
      previewColor(eyedropper.originalColor);
      syncPaletteFromColor(eyedropper.originalColor);
      return;
    }

    var color = rgbToHex(pixel[0], pixel[1], pixel[2]);
    eyedropper.currentColor = color;
    lens.style.borderColor = color;
    label.textContent = color.toUpperCase();
    previewColor(color);
    syncPaletteFromColor(color);
  } catch (error) {
    label.textContent = '无法读取像素';
    previewColor(eyedropper.originalColor);
    syncPaletteFromColor(eyedropper.originalColor);
    console.warn('[STG] eyedropper sample:', error);
  }
}

/* ---------- 画笔面板 ---------- */

function getCurrentBrushWidth() {
  if (tool === 'eraser') return eraserWidth;
  return brushType === 'highlighter' ? highlighterWidth : penWidth;
}

function getCurrentBrushOpacity() {
  if (tool === 'eraser') return 1;
  return brushType === 'highlighter' ? highlighterOpacity : penOpacity;
}

function sliderControl(label, min, max, value, onChange) {
  var row = styled('div', {marginBottom: '10px'});
  row.appendChild(sectionLabel(label));
  var wrap = styled('div', {
    display: 'flex', alignItems: 'center', gap: '8px'
  });
  var input = styled('input', {
    flex: '1', minWidth: '0', cursor: 'pointer'
  });
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = '1';
  input.value = value;
  var output = styled('div', {
    width: '32px', flexShrink: '0', textAlign: 'right',
    fontSize: '11px', color: '#ccc', userSelect: 'none'
  }, Math.round(value));
  wrap.appendChild(input);
  wrap.appendChild(output);
  row.appendChild(wrap);
  input.addEventListener('pointerdown', stopEvent);
  input.addEventListener('pointermove', stopEvent);
  input.addEventListener('input', function (e) {
    e.stopPropagation();
    var number = Number(input.value);
    output.textContent = Math.round(number);
    onChange(number);
  });
  return {row: row, input: input, output: output};
}

function makeBrushSettingsPanel() {
  if (byId('stg-brush-settings')) return;
  var panel = makePanel('stg-brush-settings', 260);
  panel.style.padding = '0';
  var tabs = styled('div', {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,.1)'
  });
  ['brushes', 'settings'].forEach(function (id) {
    var button = styled('button', {
      flex: '1', padding: '10px', border: 'none',
      background: 'transparent', color: '#aaa',
      fontSize: '12px', cursor: 'pointer'
    }, id === 'brushes' ? '画笔' : '设置');
    button.type = 'button';
    button.setAttribute('data-stg-tab', id);
    button.addEventListener('click', function () {
      brushSettingsTab = id;
      updateBrushTabContent();
    });
    tabs.appendChild(button);
  });
  panel.appendChild(tabs);

  var content = styled('div', {padding: '12px'});
  brushSizeControl = sliderControl(
    '大小', 1, 50, getCurrentBrushWidth(), function (value) {
      if (tool === 'eraser') eraserWidth = value;
      else if (brushType === 'highlighter') highlighterWidth = value;
      else penWidth = value;
    }
  );
  brushOpacityControl = sliderControl(
    '不透明度', 0, 100, getCurrentBrushOpacity() * 100, function (value) {
      if (tool === 'eraser') return;
      if (brushType === 'highlighter') highlighterOpacity = value / 100;
      else penOpacity = value / 100;
    }
  );
  content.appendChild(brushSizeControl.row);
  content.appendChild(brushOpacityControl.row);
  content.appendChild(styled('div', {
    height: '1px', background: 'rgba(255,255,255,.1)', margin: '12px 0'
  }));
  var tabContent = document.createElement('div');
  tabContent.id = 'stg-tab-content';
  content.appendChild(tabContent);
  panel.appendChild(content);
  document.body.appendChild(panel);
  updateBrushTabContent();

  panel.addEventListener('pointerdown', stopEvent);
  panel.addEventListener('pointermove', stopEvent);
  panel.addEventListener('pointerup', stopEvent);
  panel.addEventListener('click', function (e) {
    e.stopPropagation();
    var item = e.target.closest('[data-brush]');
    if (item) switchToBrush(item.getAttribute('data-brush'));
  });
}

function updateBrushTabContent() {
  var content = byId('stg-tab-content');
  if (!content) return;
  var tabs = document.querySelectorAll('#stg-brush-settings [data-stg-tab]');
  Array.prototype.forEach.call(tabs, function (tab) {
    var selected = tab.getAttribute('data-stg-tab') === brushSettingsTab;
    tab.style.color = selected ? '#ff859d' : '#aaa';
    tab.style.borderBottom = selected
      ? '2px solid #ff859d' : '2px solid transparent';
  });
  content.innerHTML = '';

  if (brushSettingsTab === 'brushes') {
    var grid = styled('div', {
      display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '8px'
    });
    brushPresets.forEach(function (brush) {
      var item = styled('div', {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px', borderRadius: '8px', cursor: 'pointer',
        border: '2px solid ' + (brush.id === brushType ? '#ff859d' : 'transparent'),
        background: brush.id === brushType ? 'rgba(255,133,157,.1)' : 'transparent'
      });
      item.setAttribute('data-brush', brush.id);
      var icon = styled('img', {
        width: '48px', height: '48px', borderRadius: '8px',
        objectFit: 'cover', marginBottom: '6px',
        background: 'rgba(255,255,255,.05)'
      });
      icon.src = brush.icon || DEFAULT_BRUSH_ICON;
      item.appendChild(icon);
      item.appendChild(styled('div', {
        fontSize: '11px', color: '#ccc', textAlign: 'center', userSelect: 'none'
      }, brush.name));
      grid.appendChild(item);
    });
    content.appendChild(grid);
  } else {
    var preset = brushPresets.find(function (b) { return b.id === brushType; });
    if (!preset) return;
    content.appendChild(sectionLabel('当前画笔: ' + preset.name));
    content.appendChild(sliderControl('流量', 0, 100, brushFlow, function (v) {
      brushFlow = v;
    }).row);
    content.appendChild(sliderControl('硬度', 0, 100, brushHardness, function (v) {
      brushHardness = v;
    }).row);
    content.appendChild(sliderControl('间距', 1, 100, brushSpacing, function (v) {
      brushSpacing = v;
    }).row);
    content.appendChild(sectionLabel('来源: ' + preset.author));
  }
}

function switchToBrush(id) {
  var preset = brushPresets.find(function (b) { return b.id === id; });
  if (!preset) return;
  brushType = id;
  if (id === 'highlighter') {
    highlighterWidth = preset.defaultWidth;
    highlighterOpacity = preset.defaultOpacity;
  } else {
    penWidth = preset.defaultWidth;
    penOpacity = preset.defaultOpacity;
  }
  brushFlow = preset.flow;
  brushHardness = preset.hardness;
  brushSpacing = preset.spacing;
  updateBrushTabContent();
  updateBrushSliders();
  toast('已切换到: ' + preset.name);
}

function updateBrushSliders() {
  if (!brushSizeControl || !brushOpacityControl) return;
  var width = getCurrentBrushWidth();
  var opacity = getCurrentBrushOpacity() * 100;
  brushSizeControl.input.value = width;
  brushSizeControl.output.textContent = Math.round(width);
  brushOpacityControl.input.value = opacity;
  brushOpacityControl.output.textContent = Math.round(opacity);
}

function toggleBrushSettings() {
  var panel = byId('stg-brush-settings');
  if (!panel) return;
  if (panel.style.display === 'block') panel.style.display = 'none';
  else {
    panel.style.display = 'block';
    updateBrushSliders();
    updateBrushTabContent();
  }
}

function hideBrushSettings() {
  hideElement('stg-brush-settings');
}

/* ---------- 调色板 ---------- */

function makePalette() {
  if (byId('stg-palette')) return;
  var panel = makePanel('stg-palette');
  panel.style.maxHeight = '90vh';
  panel.appendChild(sectionLabel('基本色'));

  var grid = styled('div', {
    display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
    gap: '6px', marginBottom: '12px'
  });
  [
    '#ff0000', '#ff6600', '#ffcc00', '#33cc00',
    '#00cccc', '#0066ff', '#6633ff', '#cc00cc',
    '#ff3366', '#996633', '#ffffff', '#000000',
    '#ff9999', '#ffcc99', '#99ff99', '#99ccff'
  ].forEach(function (color) {
    var cell = styled('div', {
      width: '24px', height: '24px', borderRadius: '50%',
      background: color, border: '2px solid rgba(255,255,255,.15)',
      boxSizing: 'border-box', cursor: 'pointer'
    });
    cell.addEventListener('click', function (e) {
      e.stopPropagation();
      applyColor(color);
      syncPaletteFromColor(color);
    });
    grid.appendChild(cell);
  });
  panel.appendChild(grid);
  panel.appendChild(sectionLabel('记忆色'));

  var recent = styled('div', {
    display: 'flex', gap: '6px', marginBottom: '12px'
  });
  recent.id = 'stg-recent-colors';
  recent.addEventListener('click', function (e) {
    var cell = e.target.closest('[data-recent-color]');
    if (!cell) return;
    e.stopPropagation();
    var color = cell.getAttribute('data-recent-color');
    applyColor(color);
    syncPaletteFromColor(color);
  });
  panel.appendChild(recent);

  var wrap = styled('div', {
    position: 'relative', width: '180px', height: '180px',
    margin: '0 auto 12px'
  });
  var ring = styled('canvas', {
    position: 'absolute', left: '0', top: '0',
    width: '180px', height: '180px', touchAction: 'none'
  });
  ring.width = 180;
  ring.height = 180;
  wrap.appendChild(ring);

  var square = styled('canvas', {
    position: 'absolute', left: '40px', top: '40px',
    width: '100px', height: '100px', touchAction: 'none'
  });
  square.width = 100;
  square.height = 100;
  wrap.appendChild(square);

  function cursor() {
    return styled('div', {
      position: 'absolute', width: '10px', height: '10px',
      border: '2px solid white', borderRadius: '50%',
      boxSizing: 'border-box', boxShadow: '0 0 0 1px #333',
      pointerEvents: 'none', transform: 'translate(-50%,-50%)'
    });
  }
  var ringCursor = cursor();
  var squareCursor = cursor();
  wrap.appendChild(ringCursor);
  wrap.appendChild(squareCursor);
  panel.appendChild(wrap);
  panel.appendChild(sectionLabel('HSV 调整'));

  var controls = {};
  ['H', 'S', 'V'].forEach(function (key) {
    var control = sliderControl(
      key, 0, key === 'H' ? 360 : 100,
      key === 'H' ? paletteH : (key === 'S' ? paletteS : paletteV) * 100,
      function (value) {
        if (key === 'H') paletteH = value;
        if (key === 'S') paletteS = value / 100;
        if (key === 'V') paletteV = value / 100;
        previewColorFromHSV();
        renderPaletteState();
      }
    );
    control.input.addEventListener('change', function () {
      confirmColorFromHSV();
    });
    controls[key] = control;
    panel.appendChild(control.row);
  });

  document.body.appendChild(panel);
  paletteUI = {
    ring: ring, square: square,
    ringCursor: ringCursor, squareCursor: squareCursor,
    controls: controls
  };
  drawRing(ring);
  renderPaletteState();
  updateRecentColorUI();

  bindPalettePointer(ring, function (e) {
    var rect = ring.getBoundingClientRect();
    var x = (e.clientX - rect.left) * 180 / rect.width - 90;
    var y = (e.clientY - rect.top) * 180 / rect.height - 90;
    paletteH = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }, false);

  bindPalettePointer(square, function (e) {
    var rect = square.getBoundingClientRect();
    paletteS = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    paletteV = 1 - clamp((e.clientY - rect.top) / rect.height, 0, 1);
  }, true);
}

function bindPalettePointer(element, update, confirmOnRelease) {
  var pointer = null;
  element.addEventListener('pointerdown', function (e) {
    if (pointer !== null) return;
    if (element === paletteUI.ring) {
      var rect = element.getBoundingClientRect();
      var x = (e.clientX - rect.left) * 180 / rect.width - 90;
      var y = (e.clientY - rect.top) * 180 / rect.height - 90;
      var distance = Math.sqrt(x * x + y * y);
      if (distance < 68 || distance > 90) return;
    }
    e.preventDefault();
    e.stopPropagation();
    pointer = e.pointerId;
    element.setPointerCapture(pointer);
    update(e);
    previewColorFromHSV();
    renderPaletteState();
  });
  element.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pointer) return;
    e.preventDefault();
    e.stopPropagation();
    update(e);
    previewColorFromHSV();
    renderPaletteState();
  });
  element.addEventListener('pointerup', function (e) {
    if (e.pointerId !== pointer) return;
    e.stopPropagation();
    update(e);
    previewColorFromHSV();
    renderPaletteState();
    pointer = null;
    if (confirmOnRelease) confirmColorFromHSV();
  });
  element.addEventListener('pointercancel', function () { pointer = null; });
  element.addEventListener('lostpointercapture', function () { pointer = null; });
}

function renderPaletteState() {
  if (!paletteUI) return;
  drawSquare(paletteUI.square, paletteH);
  var radians = paletteH * Math.PI / 180;
  paletteUI.ringCursor.style.left = (90 + 79 * Math.cos(radians)) + 'px';
  paletteUI.ringCursor.style.top = (90 + 79 * Math.sin(radians)) + 'px';
  paletteUI.squareCursor.style.left = (40 + paletteS * 100) + 'px';
  paletteUI.squareCursor.style.top = (40 + (1 - paletteV) * 100) + 'px';
  var values = {H: paletteH, S: paletteS * 100, V: paletteV * 100};
  Object.keys(values).forEach(function (key) {
    paletteUI.controls[key].input.value = values[key];
    paletteUI.controls[key].output.textContent = Math.round(values[key]);
  });
}

function syncPaletteFromColor(hex) {
  if (!validColor(hex)) return;
  var r = parseInt(hex.slice(1, 3), 16) / 255;
  var g = parseInt(hex.slice(3, 5), 16) / 255;
  var b = parseInt(hex.slice(5, 7), 16) / 255;
  var max = Math.max(r, g, b);
  var min = Math.min(r, g, b);
  var delta = max - min;
  if (delta > 0) {
    var hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    paletteH = (hue * 60 + 360) % 360;
  }
  paletteS = max === 0 ? 0 : delta / max;
  paletteV = max;
  renderPaletteState();
}

function updateColorIndicator() {
  var indicator = byId('stg-color-indicator');
  if (indicator) indicator.style.background = penColor;
}

function previewColor(color) {
  if (!validColor(color)) return;
  penColor = color;
  updateColorIndicator();
}

function applyColor(color) {
  if (!validColor(color)) return;
  previewColor(color);
  addRecentColor(color);
  toast('已选择: ' + color);
}

function previewColorFromHSV() {
  var rgb = hsvToRgb(paletteH, paletteS, paletteV);
  previewColor(rgbToHex(rgb[0], rgb[1], rgb[2]));
}

function confirmColorFromHSV() {
  var rgb = hsvToRgb(paletteH, paletteS, paletteV);
  applyColor(rgbToHex(rgb[0], rgb[1], rgb[2]));
}

function drawRing(canvas) {
  var context = canvas.getContext('2d');
  context.clearRect(0, 0, 180, 180);
  for (var angle = 0; angle < 360; angle++) {
    var start = (angle - 0.5) * Math.PI / 180;
    var end = (angle + 1.5) * Math.PI / 180;
    context.beginPath();
    context.arc(90, 90, 88, start, end);
    context.arc(90, 90, 68, end, start, true);
    context.closePath();
    context.fillStyle = 'hsl(' + angle + ',100%,50%)';
    context.fill();
  }
}

function drawSquare(canvas, hue) {
  var context = canvas.getContext('2d');
  var width = canvas.width;
  var height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = 'hsl(' + hue + ',100%,50%)';
  context.fillRect(0, 0, width, height);
  var white = context.createLinearGradient(0, 0, width, 0);
  white.addColorStop(0, '#fff');
  white.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = white;
  context.fillRect(0, 0, width, height);
  var black = context.createLinearGradient(0, 0, 0, height);
  black.addColorStop(0, 'rgba(0,0,0,0)');
  black.addColorStop(1, '#000');
  context.fillStyle = black;
  context.fillRect(0, 0, width, height);
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  var i = Math.floor(h);
  var f = h - i;
  var p = v * (1 - s);
  var q = v * (1 - f * s);
  var u = v * (1 - (1 - f) * s);
  var values = [
    [v, u, p], [q, v, p], [p, v, u],
    [p, q, v], [u, p, v], [v, p, q]
  ][i];
  return values.map(function (value) { return Math.round(value * 255); });
}

function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* ---------- 工具切换 ---------- */

function enterDraw() {
  drawing = true;
  tool = 'brush';
  hideElement('stg-fab');
  var bar = byId('stg-toolbar');
  if (bar) bar.classList.add('stg-show');
  hilite();
  var messages = document.querySelectorAll('#chat .mes');
  for (var i = 0; i < messages.length; i++) setupCanvas(messages[i]);
}

function exitDraw() {
  drawing = false;
  deactivateEyedropper(false);
  clearWetCanvas();

  hideElement('stg-palette');
  hideBrushSettings();
  hideElement('stg-utility-menu');
  hideShapeToolbar();

  var bar = byId('stg-toolbar');
  if (bar) bar.classList.remove('stg-show');

  var fab = byId('stg-fab');
  if (fab) fab.style.display = 'flex';

  updatePointer();

  Array.prototype.forEach.call(
    document.querySelectorAll('.stg-shape-preview'),
    function (element) {
      element.remove();
    }
  );
}

function onTool(action) {
  if (eyedropper.active) deactivateEyedropper(false);
  if (action === 'exit') { exitDraw(); return; }
  if (action === 'save') { saveData(); return; }
  if (action === 'clear') { clearAll(); return; }
  if (action === 'undo') { undo(); return; }
  if (action === 'redo') { redo(); return; }

  if (action === 'utility') {
    hideBrushSettings();
    hideElement('stg-palette');
    var menu = byId('stg-utility-menu');
    if (menu) menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
    return;
  }
  if (action === 'color') {
    hideBrushSettings();
    hideElement('stg-utility-menu');
    var palette = byId('stg-palette');
    if (palette) palette.style.display =
      palette.style.display === 'block' ? 'none' : 'block';
    return;
  }
  if (action === 'brush') {
    if (tool === 'brush') toggleBrushSettings();
    else {
      tool = 'brush';
      hilite();
      updatePointer();
      hideBrushSettings();
    }
    hideElement('stg-palette');
    hideElement('stg-utility-menu');
    return;
  }
  tool = action;
  hilite();
  updatePointer();
  hideBrushSettings();
  hideElement('stg-palette');
  hideElement('stg-utility-menu');
}

function hilite() {
  var buttons = document.querySelectorAll('#stg-toolbar .stg-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle(
      'stg-on', buttons[i].getAttribute('data-stg') === tool
    );
  }
}

function updatePointer() {
  var canvases = document.querySelectorAll('#chat .stg-canvas');
  var active = drawing && tool !== 'mouse' && tool !== 'eyedropper';
  for (var i = 0; i < canvases.length; i++) {
    canvases[i].classList.toggle('stg-active', active);
  }
}

/* ---------- 原有画笔与形状绘制 ---------- */

function setupCanvas(message) {
  var text = message.querySelector('.mes_text');
  if (!text) return null;
  var existing = text.querySelector('.stg-canvas');
  var active = drawing && tool !== 'mouse' && tool !== 'eyedropper';
  if (existing) {
    existing.classList.toggle('stg-active', active);
    return existing;
  }
  var canvas = document.createElement('canvas');
  canvas.className = 'stg-canvas';
  canvas.width = text.clientWidth || 300;
  canvas.height = text.clientHeight || 100;
  if (active) canvas.classList.add('stg-active');
  text.appendChild(canvas);
  bindCanvas(canvas);
  return canvas;
}

function getMesId(canvas) {
  var message = canvas.closest('.mes');
  return message ? message.getAttribute('mesid') : null;
}

function getToolWidth() {
  if (tool === 'eraser') return eraserWidth;
  if (tool === 'shape') return penWidth;
  if (tool === 'smudge') return penWidth;
  return brushType === 'highlighter' ? highlighterWidth : penWidth;
}

function getToolOpacity() {
  if (tool === 'eraser') return 1;
  if (tool === 'shape') return penOpacity;
  if (tool === 'smudge') return penOpacity;
  return brushType === 'highlighter' ? highlighterOpacity : penOpacity;
}

function setBrush(context) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation =
    tool === 'eraser' ? 'destination-out' : 'source-over';
  context.globalAlpha = getToolOpacity();
  context.strokeStyle = tool === 'eraser' ? '#000000' : penColor;
  context.lineWidth = getToolWidth();
}

/* ---------- 旧笔画兼容 ---------- */

function setupBrushFor(context, stroke) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation =
    stroke.tool === 'eraser' ? 'destination-out' : 'source-over';

  var fallback = (
    stroke.tool === 'highlighter' ||
    stroke.brushType === 'highlighter'
  ) ? 0.3 : 1;

  context.globalAlpha = stroke.tool === 'eraser' ? 1 :
    (typeof stroke.opacity === 'number' ? stroke.opacity : fallback);

  context.strokeStyle =
    stroke.tool === 'eraser' ? '#000000' : stroke.color;

  context.lineWidth = stroke.size;
}

/* ---------- 图章画笔公共工具 ---------- */

function stgNumber(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function stgPressure(point) {
  return stgNumber(point.pressure, 1, 0.2, 1);
}

/*
 * 固定种子的随机数：
 * 同一笔在预览、落笔、撤销恢复后具有相同的纹理。
 */
function stgRandom(seed) {
  var state = (seed >>> 0) || 1;

  return function () {
    state = (
      Math.imul(state, 1664525) + 1013904223
    ) >>> 0;

    return state / 4294967296;
  };
}

/*
 * 硬度 100：实心圆。
 * 硬度 0：从中心向边缘连续衰减。
 *
 * 使用径向渐变，不依赖 Android WebView 对 ctx.filter 的支持。
 */
function stgMakeTip(size, hardness, color) {
  var tip = document.createElement('canvas');

  var pixels = clamp(Math.ceil(size * 2), 32, 256);
  tip.width = pixels;
  tip.height = pixels;

  var context = tip.getContext('2d');
  var center = pixels / 2;
  var radius = center - 1;
  var hard = stgNumber(hardness, 100, 0, 100) / 100;

  if (hard >= 1) {
    context.fillStyle = '#ffffff';
  } else {
    var gradient = context.createRadialGradient(
      center, center, radius * hard,
      center, center, radius
    );

    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
  }

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();

  context.globalCompositeOperation = 'source-in';
  context.fillStyle = validColor(color) ? color : '#000000';
  context.fillRect(0, 0, pixels, pixels);
  context.globalCompositeOperation = 'source-over';

  return tip;
}

/*
 * 沿折线路径按固定距离盖章。
 * 剩余距离跨 pointermove 采样点保留，避免每段起点重复打点。
 * pressure 用于改变笔尖直径；间距按设置大小计算。
 */
function stgWalkStamps(stroke, width, height, step, callback) {
  var points = stroke.points;
  if (!points || !points.length) return;

  var first = points[0];
  var previousX = first.x * width;
  var previousY = first.y * height;
  var previousPressure = stgPressure(first);

  callback(previousX, previousY, previousPressure);

  var remaining = step;

  for (var i = 1; i < points.length; i++) {
    var point = points[i];
    var x = point.x * width;
    var y = point.y * height;
    var pressure = stgPressure(point);

    var dx = x - previousX;
    var dy = y - previousY;
    var length = Math.sqrt(dx * dx + dy * dy);

    if (length > 0.0001) {
      var distance = remaining;

      while (distance <= length) {
        var fraction = distance / length;

        callback(
          previousX + dx * fraction,
          previousY + dy * fraction,
          previousPressure +
            (pressure - previousPressure) * fraction
        );

        distance += step;
      }

      remaining = distance - length;
    }

    previousX = x;
    previousY = y;
    previousPressure = pressure;
  }
}

/* ---------- 图章笔 / 橡皮 ---------- */

function stgPaintStampStroke(canvas, stroke) {
  if (!stroke.points || !stroke.points.length) return;

  var size = stgNumber(stroke.size, 3, 1, 200);
  var spacing = stgNumber(stroke.spacing, 10, 1, 100);
  var hardness = stgNumber(stroke.hardness, 100, 0, 100);
  var flow = stgNumber(stroke.flow, 100, 0, 100) / 100;
  var opacity = stgNumber(stroke.opacity, 1, 0, 1);
  var isEraser = stroke.tool === 'eraser';

  if (flow === 0 || opacity === 0) return;

  var step = Math.max(0.5, size * spacing / 100);
  var tip = stgMakeTip(
    size,
    hardness,
    isEraser ? '#000000' : stroke.color
  );

  /*
   * 整笔先绘制到透明层。
   * 流量影响每枚图章，不透明度在整笔合成时应用一次。
   */
  var layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;

  var layerContext = layer.getContext('2d');
  var random = stgRandom(stroke.seed);

  stgWalkStamps(
    stroke,
    canvas.width,
    canvas.height,
    step,
    function (x, y, pressure) {
      var diameter = size * pressure;

      // 轻微透明度变化，产生可重复的笔触纹理。
      layerContext.globalAlpha =
        flow * (isEraser ? 1 : 0.94 + random() * 0.06);

      layerContext.drawImage(
        tip,
        x - diameter / 2,
        y - diameter / 2,
        diameter,
        diameter
      );
    }
  );

  var context = canvas.getContext('2d');
  context.save();

  context.globalCompositeOperation =
    isEraser ? 'destination-out' : 'source-over';
  context.globalAlpha = opacity;
  context.drawImage(layer, 0, 0);

  context.restore();
}

/* ---------- 涂抹笔 ---------- */

function stgPaintSmudgeStroke(canvas, stroke) {
  if (!stroke.points || stroke.points.length < 2) return;

  var size = stgNumber(stroke.size, 3, 1, 200);
  var hardness = stgNumber(stroke.hardness, 50, 0, 100);
  var spacing = stgNumber(stroke.spacing, 10, 1, 100);

  /*
   * 大跨度移动拆成小步。
   * 涂抹步长最多为笔径的 25%，避免快速滑动断成几块。
   */
  var step = Math.max(
    0.5,
    Math.min(size * spacing / 100, size * 0.25)
  );

  var context = canvas.getContext('2d');
  var patch = document.createElement('canvas');
  var patchContext = patch.getContext('2d');

  var small = document.createElement('canvas');
  var smallContext = small.getContext('2d');

  var tip = stgMakeTip(size, hardness, '#ffffff');
  var previous = null;

  stgWalkStamps(
    stroke,
    canvas.width,
    canvas.height,
    step,
    function (x, y, pressure) {
      if (!previous) {
        previous = {x: x, y: y};
        return;
      }

      var diameter = Math.max(1, size * pressure);
      var pixels = Math.max(2, Math.ceil(diameter));
      var sourceLeft = Math.floor(previous.x - pixels / 2);
      var sourceTop = Math.floor(previous.y - pixels / 2);

      /*
       * 只读取画布内的像素，画布边缘之外保持透明。
       * 不从页面背景或聊天文字取色。
       */
      var left = Math.max(0, sourceLeft);
      var top = Math.max(0, sourceTop);
      var right = Math.min(canvas.width, sourceLeft + pixels);
      var bottom = Math.min(canvas.height, sourceTop + pixels);

      if (right > left && bottom > top) {
        patch.width = pixels;
        patch.height = pixels;

        var image = context.getImageData(
          left, top, right - left, bottom - top
        );

        patchContext.putImageData(
          image,
          left - sourceLeft,
          top - sourceTop
        );

        /*
         * 缩小再放大，产生轻微模糊。
         * 不依赖 ctx.filter，兼容不支持 Canvas filter 的 WebView。
         */
        small.width = Math.max(1, Math.floor(pixels / 2));
        small.height = Math.max(1, Math.floor(pixels / 2));

        smallContext.imageSmoothingEnabled = true;
        smallContext.drawImage(
          patch, 0, 0, small.width, small.height
        );

        patchContext.clearRect(0, 0, pixels, pixels);
        patchContext.imageSmoothingEnabled = true;
        patchContext.drawImage(
          small, 0, 0, pixels, pixels
        );

        // 圆形笔尖遮罩，避免出现方形像素块。
        patchContext.globalCompositeOperation = 'destination-in';
        patchContext.drawImage(tip, 0, 0, pixels, pixels);
        patchContext.globalCompositeOperation = 'source-over';

        context.save();
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 0.5;

        context.drawImage(
          patch,
          x - diameter / 2,
          y - diameter / 2,
          diameter,
          diameter
        );

        context.restore();
      }

      previous = {x: x, y: y};
    }
  );
}

/* ---------- 统一笔画重放入口 ---------- */

function stgPaintStroke(canvas, stroke) {
  if (!stroke || !Array.isArray(stroke.points) ||
      !stroke.points.length) return;

  if (stroke.engine === 'stamp-v1') {
    if (stroke.tool === 'smudge') {
      stgPaintSmudgeStroke(canvas, stroke);
    } else {
      stgPaintStampStroke(canvas, stroke);
    }
    return;
  }

  // 旧存档和形状仍然使用原来的路径算法。
  var context = canvas.getContext('2d');
  var points = stroke.points.map(function (point) {
    return {
      x: point.x * canvas.width,
      y: point.y * canvas.height
    };
  });

  context.save();
  setupBrushFor(context, stroke);
  context.setLineDash([]);
  strokePointPath(context, points);
  context.restore();
}

/* ---------- 湿画布状态 ---------- */

var wetCanvas = null;
var wetOwner = null;
var wetPointerId = null;
var wetOwnerOpacity = '';
var wetFrame = null;

function clearWetCanvas() {
  var owner = wetOwner;
  var pointerId = wetPointerId;

  if (wetFrame !== null) {
    cancelAnimationFrame(wetFrame);
    wetFrame = null;
  }

  if (owner) owner.style.opacity = wetOwnerOpacity;

  wetOwner = null;
  wetPointerId = null;
  wetOwnerOpacity = '';

  if (wetCanvas && wetCanvas.parentNode) {
    wetCanvas.parentNode.removeChild(wetCanvas);
  }

  wetCanvas = null;
  pressing = false;
  currentStroke = null;
  lastCanvas = null;
  shapeDrawing = false;
  shapePreviewCanvas = null;

  if (
    owner && pointerId !== null &&
    typeof owner.hasPointerCapture === 'function' &&
    owner.hasPointerCapture(pointerId)
  ) {
    try {
      owner.releasePointerCapture(pointerId);
    } catch (error) {
      console.warn('[STG] release pointer:', error);
    }
  }
}

function createWetCanvas(canvas) {
  wetOwner = canvas;
  wetOwnerOpacity = canvas.style.opacity;

  wetCanvas = document.createElement('canvas');
  wetCanvas.className = 'stg-wet-canvas';
  wetCanvas.width = canvas.width;
  wetCanvas.height = canvas.height;

  Object.assign(wetCanvas.style, {
    position: 'absolute',
    left: canvas.offsetLeft + 'px',
    top: canvas.offsetTop + 'px',
    width: canvas.clientWidth + 'px',
    height: canvas.clientHeight + 'px',
    pointerEvents: 'none',
    zIndex: '15',
    opacity: '1'
  });

  canvas.parentNode.appendChild(wetCanvas);
  wetCanvas.getContext('2d').drawImage(canvas, 0, 0);

  /*
   * 预览包含已有画面，所以临时隐藏底层的显示，
   * 防止半透明颜色被显示两遍。
   * opacity:0 不影响指针捕获。
   */
  canvas.style.opacity = '0';
}

function getWetPressure(e) {
  if (e.pointerType !== 'pen') return 1;

  var pressure = Number(e.pressure);
  if (!Number.isFinite(pressure)) return 1;

  return 0.2 + 0.8 * clamp(pressure, 0, 1);
}

/* ---------- 指针绑定 ---------- */

function bindCanvas(canvas) {
  var gesture = null;

  function appendPoint(e, usePressure) {
    if (!gesture || gesture.kind !== 'stroke') return;

    var pos = getPos(canvas, e);
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;

    var points = gesture.stroke.points;
    var previous = points[points.length - 1];
    var x = pos.x / canvas.width;
    var y = pos.y / canvas.height;
    var pressure = usePressure
      ? getWetPressure(e)
      : previous.pressure;

    if (
      previous.x === x &&
      previous.y === y &&
      previous.pressure === pressure
    ) return;

    points.push({x: x, y: y, pressure: pressure});
  }

  function renderNow() {
    if (!gesture || wetOwner !== canvas || !wetCanvas) return;

    var context = wetCanvas.getContext('2d');

    context.save();
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, wetCanvas.width, wetCanvas.height);
    context.drawImage(canvas, 0, 0);
    context.restore();

    if (gesture.kind === 'stroke') {
      stgPaintStroke(wetCanvas, gesture.stroke);
      return;
    }

    context.save();
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = gesture.opacity * 0.7;
    context.strokeStyle = gesture.color;
    context.lineWidth = gesture.size;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.setLineDash([5, 5]);

    strokePointPath(
      context,
      getShapePoints(
        gesture.mode,
        gesture.start.x,
        gesture.start.y,
        gesture.end.x,
        gesture.end.y
      )
    );

    context.restore();
  }

  function abortGesture(error) {
    gesture = null;
    clearWetCanvas();

    if (error) {
      console.warn('[STG] brush engine:', error);
      toast('本次笔画未提交，请重试');
    }
  }

  function queueRender() {
    if (wetFrame !== null) return;

    wetFrame = requestAnimationFrame(function () {
      wetFrame = null;

      try {
        renderNow();
      } catch (error) {
        abortGesture(error);
      }
    });
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!drawing || tool === 'mouse' || tool === 'eyedropper') return;
    if (wetPointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    var rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    e.preventDefault();

    try {
      var pos = getPos(canvas, e);

      if (tool === 'shape' && shapeMode) {
        gesture = {
          kind: 'shape',
          mode: shapeMode,
          start: pos,
          end: pos,
          color: penColor,
          size: penWidth,
          opacity: penOpacity
        };

        shapeDrawing = true;
        shapePreviewCanvas = canvas;
        shapeStartX = pos.x;
        shapeStartY = pos.y;
      } else {
        var stroke = {
          engine: 'stamp-v1',
          tool: tool,
          brushType: brushType,
          color: penColor,
          size: getToolWidth(),
          opacity: getToolOpacity(),
          hardness: brushHardness,
          spacing: brushSpacing,
          flow: brushFlow,
          seed: Math.floor(Math.random() * 4294967296),
          points: [{
            x: pos.x / canvas.width,
            y: pos.y / canvas.height,
            pressure: getWetPressure(e)
          }]
        };

        gesture = {kind: 'stroke', stroke: stroke};
        pressing = true;
        currentStroke = stroke;
      }

      createWetCanvas(canvas);
      wetPointerId = e.pointerId;
      lastCanvas = canvas;

      canvas.setPointerCapture(e.pointerId);
      renderNow();
    } catch (error) {
      abortGesture(error);
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (
      !gesture ||
      wetOwner !== canvas ||
      e.pointerId !== wetPointerId
    ) return;

    e.preventDefault();

    if (gesture.kind === 'shape') {
      gesture.end = getPos(canvas, e);
      queueRender();
      return;
    }

    var samples = typeof e.getCoalescedEvents === 'function'
      ? e.getCoalescedEvents()
      : [];

    for (var i = 0; i < samples.length; i++) {
      appendPoint(samples[i], true);
    }

    // 保留主事件末端坐标；完全相同的点由 appendPoint 去重。
    appendPoint(e, true);
    queueRender();
  });

  canvas.addEventListener('pointerup', function (e) {
    if (
      !gesture ||
      wetOwner !== canvas ||
      e.pointerId !== wetPointerId
    ) return;

    e.preventDefault();

    try {
      var mid = getMesId(canvas);
      if (mid === null) return;

      var stroke;

      if (gesture.kind === 'shape') {
        var pos = getPos(canvas, e);
        var points = getShapePoints(
          gesture.mode,
          gesture.start.x,
          gesture.start.y,
          pos.x,
          pos.y
        );

        if (!points.length) return;

        stroke = {
          tool: 'shape',
          shapeMode: gesture.mode,
          color: gesture.color,
          size: gesture.size,
          opacity: gesture.opacity,
          points: points.map(function (point) {
            return {
              x: point.x / canvas.width,
              y: point.y / canvas.height
            };
          })
        };
      } else {
        // 松手不使用归零的压感。
        appendPoint(e, false);
        stroke = gesture.stroke;

        // 涂抹笔只点击、不移动，不产生历史记录。
        if (stroke.tool === 'smudge' && stroke.points.length < 2) return;
      }

      if (wetFrame !== null) {
        cancelAnimationFrame(wetFrame);
        wetFrame = null;
      }

      /*
       * 先在临时画布完成最终计算。
       * 失败时不修改主画布，也不新增笔画记录。
       */
      var wetContext = wetCanvas.getContext('2d');
      wetContext.clearRect(0, 0, wetCanvas.width, wetCanvas.height);
      wetContext.drawImage(canvas, 0, 0);
      stgPaintStroke(wetCanvas, stroke);

      if (!graffitiStore[mid]) graffitiStore[mid] = {strokes: []};
      saveHistory(mid);

      var context = canvas.getContext('2d');
      context.save();
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(wetCanvas, 0, 0);
      context.restore();

      graffitiStore[mid].strokes.push(stroke);
      lastEditedMid = mid;
    } catch (error) {
      console.warn('[STG] commit stroke:', error);
      toast('本次笔画提交失败，请重试');
    } finally {
      gesture = null;
      clearWetCanvas();
    }
  });

  function cancelGesture(e) {
    if (
      wetOwner !== canvas ||
      e.pointerId !== wetPointerId
    ) return;

    abortGesture();
  }

  canvas.addEventListener('pointercancel', cancelGesture);
  canvas.addEventListener('lostpointercapture', cancelGesture);

  // 移动端绘画时禁止浏览器把拖动画布识别成页面滚动。
  canvas.style.touchAction = 'none';
}

function getPos(canvas, e) {
  var rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

/* 形状预览和最终绘制共用同一组点，避免两者位置不一致。 */
function getShapePoints(mode, x1, y1, x2, y2) {
  var points = [];
  var dx = x2 - x1;
  var dy = y2 - y1;
  var length = Math.sqrt(dx * dx + dy * dy);

  if (mode === 'line') {
    return [{x: x1, y: y1}, {x: x2, y: y2}];
  }

  if (mode === 'rect') {
    return [
      {x: x1, y: y1},
      {x: x2, y: y1},
      {x: x2, y: y2},
      {x: x1, y: y2},
      {x: x1, y: y1}
    ];
  }

  if (mode === 'ellipse') {
    var cx = (x1 + x2) / 2;
    var cy = (y1 + y2) / 2;
    var rx = Math.abs(dx) / 2;
    var ry = Math.abs(dy) / 2;
    for (var a = 0; a <= 360; a += 5) {
      var radians = a * Math.PI / 180;
      points.push({
        x: cx + rx * Math.cos(radians),
        y: cy + ry * Math.sin(radians)
      });
    }
    return points;
  }

  /*
   * 保留当前波浪线和曲线的生成方式。
   * 曲线的可拖动控制点属于后续功能，本次不改交互。
   */
  if (mode === 'wave' || mode === 'curve') {
    if (length < 0.001) return [{x: x1, y: y1}];

    var steps = Math.max(10, Math.ceil(length / 5));
    var perpendicularX = -dy / length;
    var perpendicularY = dx / length;

    for (var i = 0; i <= steps; i++) {
      var fraction = i / steps;
      var offset = Math.sin(fraction * Math.PI * 3) * (length / 10);
      points.push({
        x: x1 + dx * fraction + perpendicularX * offset,
        y: y1 + dy * fraction + perpendicularY * offset
      });
    }
  }

  return points;
}

function strokePointPath(context, points) {
  if (!points || points.length === 0) return;

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  if (points.length === 1) {
    context.lineTo(points[0].x + 0.5, points[0].y + 0.5);
  } else {
    for (var i = 1; i < points.length; i++) {
      context.lineTo(points[i].x, points[i].y);
    }
  }

  context.stroke();
}

function drawShapePreview(context, x1, y1, x2, y2) {
  var points = getShapePoints(shapeMode, x1, y1, x2, y2);
  strokePointPath(context, points);
}

function drawShape(canvas, x1, y1, x2, y2) {
  var mid = getMesId(canvas);
  if (mid === null) return;

  var points = getShapePoints(shapeMode, x1, y1, x2, y2);
  if (points.length === 0) return;

  if (!graffitiStore[mid]) graffitiStore[mid] = {strokes: []};
  saveHistory(mid);

  var stroke = {
    tool: 'shape',
    shapeMode: shapeMode,
    color: penColor,
    size: penWidth,
    opacity: penOpacity,
    points: points.map(function (point) {
      return {
        x: point.x / canvas.width,
        y: point.y / canvas.height
      };
    })
  };

  var context = canvas.getContext('2d');
  setupBrushFor(context, stroke);
  context.setLineDash([]);
  strokePointPath(context, points);

  graffitiStore[mid].strokes.push(stroke);
  lastEditedMid = mid;
}

function redrawCanvas(canvas, data) {
  var context = canvas.getContext('2d');

  context.save();
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();

  var strokes = data && Array.isArray(data.strokes)
    ? data.strokes
    : [];

  /*
   * 必须按原顺序重放。
   * 涂抹笔读取的是此前已经绘制出来的像素。
   */
  for (var i = 0; i < strokes.length; i++) {
    stgPaintStroke(canvas, strokes[i]);
  }

  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.setLineDash([]);
}

/* ---------- 撤销和恢复 ---------- */

function getStoredStrokes(mid) {
  var data = graffitiStore[mid];
  return data && Array.isArray(data.strokes) ? data.strokes : [];
}

function saveHistory(mid) {
  if (mid === null || mid === undefined) return;

  if (!historyStacks[mid]) historyStacks[mid] = [];
  historyStacks[mid].push(clone(getStoredStrokes(mid)));

  if (historyStacks[mid].length > MAX_HISTORY) {
    historyStacks[mid].shift();
  }

  /* 只有新绘制或清除才清空恢复记录，redo 不调用本函数。 */
  redoStacks[mid] = [];
}

function getCurrentMesId() {
  if (lastCanvas && lastCanvas.isConnected) {
    return getMesId(lastCanvas);
  }

  if (lastEditedMid !== null) return lastEditedMid;

  var canvases = document.querySelectorAll('#chat .stg-canvas');
  if (!canvases.length) return null;
  return getMesId(canvases[canvases.length - 1]);
}

function redrawMessage(mid) {
  var messages = document.querySelectorAll('#chat .mes');
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].getAttribute('mesid') !== String(mid)) continue;

    var canvas = setupCanvas(messages[i]);
    if (canvas) {
      redrawCanvas(canvas, {strokes: getStoredStrokes(mid)});
    }
  }
}

function undo() {
  if (pressing || shapeDrawing) return;
  var mid = getCurrentMesId();

  if (mid === null || !historyStacks[mid] || !historyStacks[mid].length) {
    toast('没有可撤销的操作');
    return;
  }

  if (!redoStacks[mid]) redoStacks[mid] = [];
  redoStacks[mid].push(clone(getStoredStrokes(mid)));

  graffitiStore[mid] = {
    strokes: historyStacks[mid].pop()
  };

  lastEditedMid = mid;
  redrawMessage(mid);
  toast('已撤销');
}

function redo() {
  if (pressing || shapeDrawing) return;
  var mid = getCurrentMesId();

  if (mid === null || !redoStacks[mid] || !redoStacks[mid].length) {
    toast('没有可恢复的操作');
    return;
  }

  if (!historyStacks[mid]) historyStacks[mid] = [];
  historyStacks[mid].push(clone(getStoredStrokes(mid)));

  if (historyStacks[mid].length > MAX_HISTORY) {
    historyStacks[mid].shift();
  }

  graffitiStore[mid] = {
    strokes: redoStacks[mid].pop()
  };

  lastEditedMid = mid;
  redrawMessage(mid);
  toast('已恢复');
}

function clearAll() {
  if (pressing || shapeDrawing) return;

  var keys = Object.keys(graffitiStore);
  for (var i = 0; i < keys.length; i++) {
    var mid = keys[i];
    if (!getStoredStrokes(mid).length) continue;
    saveHistory(mid);
    graffitiStore[mid] = {strokes: []};
  }

  var canvases = document.querySelectorAll('#chat .stg-canvas');
  for (var j = 0; j < canvases.length; j++) {
    var context = canvases[j].getContext('2d');
    context.clearRect(0, 0, canvases[j].width, canvases[j].height);
  }

  toast('已清除所有涂鸦');
}

/* ---------- 数据保存和加载 ---------- */

async function saveData() {
  if (pressing || shapeDrawing) {
    toast('请先松手，再保存');
    return;
  }

  /*
   * 保存副本时过滤空记录，不删除内存里的条目，
   * 避免保存后撤销或恢复找不到对应楼层。
   */
  var snapshot = {};
  Object.keys(graffitiStore).forEach(function (mid) {
    var strokes = getStoredStrokes(mid);
    if (strokes.length) snapshot[mid] = {strokes: clone(strokes)};
  });

  var count = Object.keys(snapshot).length;
  if (count > MAX_GRAFFITI) {
    toast(
      '涂鸦太多了！(' + count + '/' + MAX_GRAFFITI + ') 请先清除一些',
      3500
    );
    return;
  }

  var localSaved = false;
  var chatSaved = false;

  try {
    var cid = getChatId();
    if (cid !== null) {
      localStorage.setItem('stg_' + cid, JSON.stringify(snapshot));
      localSaved = true;
    }
  } catch (error) {
    console.warn('[STG] local save:', error);
  }

  try {
    var context = getCtx();
    if (context && context.chatMetadata) {
      if (!context.chatMetadata.extensions) {
        context.chatMetadata.extensions = {};
      }
      context.chatMetadata.extensions[PLUGIN_ID] = clone(snapshot);

      if (typeof context.saveChat === 'function') {
        await context.saveChat();
        chatSaved = true;
      } else if (typeof context.saveMetadata === 'function') {
        await context.saveMetadata();
        chatSaved = true;
      }
    }
  } catch (error) {
    console.warn('[STG] chat save:', error);
  }

  if (chatSaved) {
    toast('已保存！(' + count + '/' + MAX_GRAFFITI + ')');
  } else if (localSaved) {
    toast('已保存到本机！(' + count + '/' + MAX_GRAFFITI + ')');
  } else {
    toast('保存失败，涂鸦仍保留在当前页面', 3500);
  }
}

function loadData() {
  graffitiStore = {};
  historyStacks = {};
  redoStacks = {};
  lastEditedMid = null;

  try {
    var context = getCtx();
    var extensions = context &&
      context.chatMetadata &&
      context.chatMetadata.extensions;

    if (extensions && extensions[PLUGIN_ID]) {
      graffitiStore = clone(extensions[PLUGIN_ID]);
      return;
    }
  } catch (error) {
    console.warn('[STG] metadata load:', error);
  }

  try {
    var cid = getChatId();
    if (cid !== null) {
      var raw = localStorage.getItem('stg_' + cid);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          graffitiStore = data;
        }
      }
    }
  } catch (error) {
    console.warn('[STG] local load:', error);
  }
}

function getChatId() {
  try {
    var context = getCtx();
    if (!context) return null;

    if (context.chatId !== undefined && context.chatId !== null &&
        context.chatId !== '') {
      return String(context.chatId);
    }

    if (typeof context.getCurrentChatId === 'function') {
      var currentId = context.getCurrentChatId();
      if (currentId !== undefined && currentId !== null && currentId !== '') {
        return String(currentId);
      }
    }

    /* 保留旧版使用过的本机存储键兼容路径。 */
    if (context.characters && context.activeCharacter !== undefined) {
      return 'char_' + context.activeCharacter;
    }
  } catch (error) {
    console.warn('[STG] chat id:', error);
  }
  return null;
}

function restoreAll() {
  var messages = document.querySelectorAll('#chat .mes');
  for (var i = 0; i < messages.length; i++) {
    var mid = messages[i].getAttribute('mesid');
    if (mid === null || !graffitiStore[mid]) continue;

    var canvas = setupCanvas(messages[i]);
    if (canvas) redrawCanvas(canvas, graffitiStore[mid]);
  }
}

function bindChatChange() {
  try {
    var context = getCtx();
    if (!context || !context.eventSource || !context.event_types) return;

    var event = context.event_types.CHAT_CHANGED ||
      context.event_types.CHATLOADED;

    if (event) {
      context.eventSource.on(event, function () {
        exitDraw();
        loadData();
        restoreAll();
      });
    }
  } catch (error) {
    console.warn('[STG] chat event:', error);
  }
}

function observeNew() {
  var chat = byId('chat');
  if (!chat) return;

  var observer = new MutationObserver(function (mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var added = mutations[m].addedNodes;

      for (var n = 0; n < added.length; n++) {
        var node = added[n];
        if (node.nodeType !== 1) continue;

        var messages = [];
        if (node.classList && node.classList.contains('mes')) {
          messages.push(node);
        } else if (node.querySelectorAll) {
          messages = Array.prototype.slice.call(node.querySelectorAll('.mes'));
        }

        for (var i = 0; i < messages.length; i++) {
          var message = messages[i];
          var mid = message.getAttribute('mesid');

          if (mid !== null && graffitiStore[mid]) {
            var canvas = setupCanvas(message);
            if (canvas) redrawCanvas(canvas, graffitiStore[mid]);
          } else if (drawing) {
            setupCanvas(message);
          }
        }
      }
    }
  });

  observer.observe(chat, {childList: true, subtree: true});
}

/* ---------- 所有状态声明完成之后启动 ---------- */

var poll = null;
var startupTime = Date.now();

function fire() {
  if (initDone || !document.body) return;
  initDone = true;

  if (poll !== null) {
    clearInterval(poll);
    poll = null;
  }

  try {
    startPlugin();
  } catch (error) {
    console.warn('[STG] init error:', error);
    toast('涂鸦插件初始化失败，请保留当前文件用于排查', 5000);
  }
}

poll = setInterval(function () {
  if (
    document.body &&
    (byId('chat') || Date.now() - startupTime > 5000)
  ) {
    fire();
  }
}, 300);

try {
  var startupContext = getCtx();
  if (
    startupContext &&
    startupContext.eventSource &&
    startupContext.event_types &&
    startupContext.event_types.APP_READY
  ) {
    startupContext.eventSource.on(
      startupContext.event_types.APP_READY,
      fire
    );
  }
} catch (error) {
  console.warn('[STG] ready event:', error);
}

})();
