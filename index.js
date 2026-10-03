(function () {
'use strict';

var PLUGIN_ID = 'st-graffiti';
var MAX_GRAFFITI = 10;
var FAB_SIZE = 46;
var FAB_HIDE = 16;
var SNAP_ZONE = 40;
var initDone = false;
var paletteH = 0;
var paletteS = 1;
var paletteV = 1;
var recentColors = [];

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

function startPlugin() {
loadData();
loadRecentColors();
makeToast();
makeFab();
makeToolbar();
makePalette();
loadSettingsHtml();
restoreAll();
bindChatChange();
observeNew();
console.log('[STG] ready');
}

function loadRecentColors() {
try {
var raw = localStorage.getItem('stg_recent_colors');
if (raw) {
recentColors = JSON.parse(raw);
if (!Array.isArray(recentColors)) recentColors = [];
}
} catch (e) {}
}

function saveRecentColors() {
try {
localStorage.setItem('stg_recent_colors', JSON.stringify(recentColors));
} catch (e) {}
}

function addRecentColor(color) {
if (!color || color === '#NaNNaNNaN') return;
var idx = recentColors.indexOf(color);
if (idx > -1) {
recentColors.splice(idx, 1);
}
recentColors.unshift(color);
if (recentColors.length > 6) {
recentColors = recentColors.slice(0, 6);
}
saveRecentColors();
updateRecentColorUI();
}

function updateRecentColorUI() {
var container = document.getElementById('stg-recent-colors');
if (!container) return;
container.innerHTML = '';
for (var i = 0; i < 6; i++) {
var cell = document.createElement('div');
cell.style.width = '24px';
cell.style.height = '24px';
cell.style.borderRadius = '50%';
cell.style.border = '2px solid rgba(255,255,255,0.2)';
cell.style.boxSizing = 'border-box';
cell.style.cursor = 'pointer';
cell.style.transition = 'transform 0.15s ease';
if (i < recentColors.length) {
cell.style.background = recentColors[i];
cell.setAttribute('data-recent-color', recentColors[i]);
} else {
cell.style.background = 'rgba(255,255,255,0.1)';
}
container.appendChild(cell);
}
}

function makeToast() {
if (document.getElementById('stg-toast')) return;
var el = document.createElement('div');
el.id = 'stg-toast';
document.body.appendChild(el);
}

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

function saveFabPos(l, topVal) {
try {
localStorage.setItem('stg_fab_pos', JSON.stringify({left: l, top: topVal}));
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
fab.style.transition = 'left 0.3s ease';
}, 400);
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
fab.style.top = nt + 'px';
}
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
{id: 'mouse', label: '\uD83D\uDDB1'},
{id: 'sep1', sep: true},
{id: 'pen', label: '\u270F'},
{id: 'highlighter', label: '\uD83D\uDD8D'},
{id: 'eraser', label: '\u2B55'},
{id: 'sep2', sep: true},
{id: 'color', isColor: true},
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
if (item.isColor) {
btn.id = 'stg-color-btn';
var colorBox = document.createElement('div');
colorBox.id = 'stg-color-indicator';
colorBox.style.width = '20px';
colorBox.style.height = '20px';
colorBox.style.borderRadius = '4px';
colorBox.style.background = penColor;
colorBox.style.border = '2px solid rgba(255,255,255,0.6)';
colorBox.style.boxSizing = 'border-box';
btn.appendChild(colorBox);
} else {
btn.textContent = item.label;
}
bar.appendChild(btn);
}
}

document.body.appendChild(bar);

bar.addEventListener('click', function (e) {
var tgt = e.target.closest('[data-stg]');
if (!tgt) return;
onTool(tgt.getAttribute('data-stg'));
});
}

function updateColorIndicator() {
var indicator = document.getElementById('stg-color-indicator');
if (indicator) {
indicator.style.background = penColor;
}
}

function makePalette() {
if (document.getElementById('stg-palette')) return;
var panel = document.createElement('div');
panel.id = 'stg-palette';
panel.style.position = 'fixed';
panel.style.left = '60px';
panel.style.top = '50%';
panel.style.transform = 'translateY(-50%)';
panel.style.background = 'rgba(30,30,30,0.95)';
panel.style.borderRadius = '16px';
panel.style.border = '2px solid rgba(255,133,157,0.4)';
panel.style.padding = '12px';
panel.style.zIndex = '9999999';
panel.style.display = 'none';
panel.style.maxHeight = '90vh';
panel.style.overflowY = 'auto';

panel.addEventListener('pointerdown', function (e) {
e.stopPropagation();
});
panel.addEventListener('pointermove', function (e) {
e.stopPropagation();
});
panel.addEventListener('pointerup', function (e) {
e.stopPropagation();
});

var colors = [
'#ff0000','#ff6600','#ffcc00','#33cc00',
'#00cccc','#0066ff','#6633ff','#cc00cc',
'#ff3366','#996633','#ffffff','#000000',
'#ff9999','#ffcc99','#99ff99','#99ccff'
];

var labelPreset = document.createElement('div');
labelPreset.textContent = '基本色';
labelPreset.style.fontSize = '10px';
labelPreset.style.color = '#888';
labelPreset.style.marginBottom = '6px';
labelPreset.style.userSelect = 'none';
panel.appendChild(labelPreset);

var grid = document.createElement('div');
grid.style.display = 'grid';
grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
grid.style.gap = '6px';
grid.style.marginBottom = '12px';

for (var i = 0; i < colors.length; i++) {
var cell = document.createElement('div');
cell.setAttribute('data-preset-color', colors[i]);
cell.style.width = '24px';
cell.style.height = '24px';
cell.style.borderRadius = '50%';
cell.style.background = colors[i];
cell.style.border = '2px solid transparent';
cell.style.boxSizing = 'border-box';
cell.style.cursor = 'pointer';
cell.style.transition = 'transform 0.15s ease, border-color 0.15s ease';
grid.appendChild(cell);
}

panel.appendChild(grid);

grid.addEventListener('click', function (e) {
e.preventDefault();
e.stopPropagation();
var cell = e.target.closest('[data-preset-color]');
if (!cell) return;
var newColor = cell.getAttribute('data-preset-color');
applyColor(newColor);
});

var labelRecent = document.createElement('div');
labelRecent.textContent = '记忆色';
labelRecent.style.fontSize = '10px';
labelRecent.style.color = '#888';
labelRecent.style.marginBottom = '6px';
labelRecent.style.userSelect = 'none';
panel.appendChild(labelRecent);

var recentRow = document.createElement('div');
recentRow.id = 'stg-recent-colors';
recentRow.style.display = 'flex';
recentRow.style.gap = '6px';
recentRow.style.marginBottom = '12px';
panel.appendChild(recentRow);

recentRow.addEventListener('click', function (e) {
e.preventDefault();
e.stopPropagation();
var cell = e.target.closest('[data-recent-color]');
if (!cell) return;
var newColor = cell.getAttribute('data-recent-color');
applyColor(newColor);
});

updateRecentColorUI();

var ringWrap = document.createElement('div');
ringWrap.style.position = 'relative';
ringWrap.style.width = '180px';
ringWrap.style.height = '180px';
ringWrap.style.margin = '0 auto 12px';

var ringCv = document.createElement('canvas');
ringCv.width = 180;
ringCv.height = 180;
ringCv.style.position = 'absolute';
ringCv.style.top = '0';
ringCv.style.left = '0';
ringCv.style.borderRadius = '50%';
ringCv.style.touchAction = 'none';
ringWrap.appendChild(ringCv);

var ringCursor = document.createElement('div');
ringCursor.id = 'stg-ring-cursor';
ringCursor.style.position = 'absolute';
ringCursor.style.width = '10px';
ringCursor.style.height = '10px';
ringCursor.style.border = '2px solid white';
ringCursor.style.borderRadius = '50%';
ringCursor.style.boxSizing = 'border-box';
ringCursor.style.pointerEvents = 'none';
ringCursor.style.display = 'none';
ringWrap.appendChild(ringCursor);

var sqCv = document.createElement('canvas');
sqCv.width = 100;
sqCv.height = 100;
sqCv.style.position = 'absolute';
sqCv.style.top = '40px';
sqCv.style.left = '40px';
sqCv.style.borderRadius = '4px';
sqCv.style.touchAction = 'none';
ringWrap.appendChild(sqCv);

var sqCursor = document.createElement('div');
sqCursor.id = 'stg-sq-cursor';
sqCursor.style.position = 'absolute';
sqCursor.style.width = '10px';
sqCursor.style.height = '10px';
sqCursor.style.border = '2px solid white';
sqCursor.style.borderRadius = '50%';
sqCursor.style.boxSizing = 'border-box';
sqCursor.style.pointerEvents = 'none';
sqCursor.style.display = 'none';
ringWrap.appendChild(sqCursor);

panel.appendChild(ringWrap);

drawRing(ringCv);
drawSquare(sqCv, paletteH);

var ringDown = false;
var sqDown = false;

ringCv.addEventListener('pointerdown', function (e) {
e.preventDefault();
e.stopPropagation();
ringDown = true;
pickRing(ringCv, sqCv, ringCursor, e);
});
ringCv.addEventListener('pointermove', function (e) {
if (!ringDown) return;
e.preventDefault();
e.stopPropagation();
pickRing(ringCv, sqCv, ringCursor, e);
});
ringCv.addEventListener('pointerup', function (e) {
e.stopPropagation();
ringDown = false;
});
ringCv.addEventListener('pointercancel', function (e) {
e.stopPropagation();
ringDown = false;
});

sqCv.addEventListener('pointerdown', function (e) {
e.preventDefault();
e.stopPropagation();
sqDown = true;
pickSquare(sqCv, sqCursor, e);
});
sqCv.addEventListener('pointermove', function (e) {
if (!sqDown) return;
e.preventDefault();
e.stopPropagation();
pickSquare(sqCv, sqCursor, e);
});
sqCv.addEventListener('pointerup', function (e) {
e.stopPropagation();
sqDown = false;
});
sqCv.addEventListener('pointercancel', function (e) {
e.stopPropagation();
sqDown = false;
});

var labelHSV = document.createElement('div');
labelHSV.textContent = 'HSV 调整';
labelHSV.style.fontSize = '10px';
labelHSV.style.color = '#888';
labelHSV.style.marginBottom = '6px';
labelHSV.style.userSelect = 'none';
panel.appendChild(labelHSV);

var hRow = makeSlider('H', 0, 360, paletteH, function (v) {
paletteH = v;
drawSquare(sqCv, paletteH);
updateColorFromHSV();
updateSquareCursor(sqCursor);
});
panel.appendChild(hRow);

var sRow = makeSlider('S', 0, 100, paletteS * 100, function (v) {
paletteS = v / 100;
updateColorFromHSV();
updateSquareCursor(sqCursor);
});
panel.appendChild(sRow);

var vRow = makeSlider('V', 0, 100, paletteV * 100, function (v) {
paletteV = v / 100;
updateColorFromHSV();
updateSquareCursor(sqCursor);
});
panel.appendChild(vRow);

document.body.appendChild(panel);

console.log('[STG] 调色板已创建');
}

function makeSlider(label, min, max, val, onChange) {
var row = document.createElement('div');
row.style.display = 'flex';
row.style.alignItems = 'center';
row.style.gap = '8px';
row.style.marginBottom = '6px';

var lbl = document.createElement('div');
lbl.textContent = label;
lbl.style.fontSize = '11px';
lbl.style.color = '#aaa';
lbl.style.width = '12px';
lbl.style.userSelect = 'none';
row.appendChild(lbl);

var slider = document.createElement('input');
slider.type = 'range';
slider.min = min;
slider.max = max;
slider.value = val;
slider.style.flex = '1';
slider.style.height = '4px';
slider.style.cursor = 'pointer';
row.appendChild(slider);

var valTxt = document.createElement('div');
valTxt.textContent = Math.round(val);
valTxt.style.fontSize = '11px';
valTxt.style.color = '#ccc';
valTxt.style.width = '28px';
valTxt.style.textAlign = 'right';
valTxt.style.userSelect = 'none';
row.appendChild(valTxt);

slider.addEventListener('input', function (e) {
e.stopPropagation();
var v = parseFloat(slider.value);
valTxt.textContent = Math.round(v);
onChange(v);
});

slider.addEventListener('pointerdown', function (e) {
e.stopPropagation();
});
slider.addEventListener('pointermove', function (e) {
e.stopPropagation();
});
slider.addEventListener('pointerup', function (e) {
e.stopPropagation();
});

return row;
}

function applyColor(color) {
penColor = color;
addRecentColor(color);
updateColorIndicator();
toast('已选择: ' + color);
}

function updateColorFromHSV() {
var rgb = hsvToRgb(paletteH, paletteS, paletteV);
var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
applyColor(hex);
}

function updateSquareCursor(sqCursor) {
sqCursor.style.display = 'block';
sqCursor.style.left = (40 + paletteS * 100 - 5) + 'px';
sqCursor.style.top = (40 + (1 - paletteV) * 100 - 5) + 'px';
}

function drawRing(cv) {
var ctx = cv.getContext('2d');
var cx = 90;
var cy = 90;
var outerR = 88;
var innerR = 68;
ctx.clearRect(0, 0, 180, 180);
for (var angle = 0; angle < 360; angle++) {
var rad1 = (angle - 0.5) * Math.PI / 180;
var rad2 = (angle + 1.5) * Math.PI / 180;
ctx.beginPath();
ctx.arc(cx, cy, outerR, rad1, rad2);
ctx.arc(cx, cy, innerR, rad2, rad1, true);
ctx.closePath();
ctx.fillStyle = 'hsl(' + angle + ',100%,50%)';
ctx.fill();
}
}

function drawSquare(cv, hue) {
var ctx = cv.getContext('2d');
var w = cv.width;
var h = cv.height;
ctx.clearRect(0, 0, w, h);
for (var x = 0; x < w; x++) {
var sat = x / w;
for (var y = 0; y < h; y++) {
var val = 1 - y / h;
var rgb = hsvToRgb(hue, sat, val);
ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
ctx.fillRect(x, y, 1, 1);
}
}
}

function pickRing(ringCv, sqCv, ringCursor, e) {
var rect = ringCv.getBoundingClientRect();
var x = e.clientX - rect.left - 90;
var y = e.clientY - rect.top - 90;
var dist = Math.sqrt(x * x + y * y);
if (dist < 60 || dist > 90) return;
var angle = Math.atan2(y, x) * 180 / Math.PI;
if (angle < 0) angle += 360;
paletteH = angle;
drawSquare(sqCv, paletteH);
updateColorFromHSV();

var rad = angle * Math.PI / 180;
var cursorDist = 79;
ringCursor.style.display = 'block';
ringCursor.style.left = (90 + cursorDist * Math.cos(rad) - 5) + 'px';
ringCursor.style.top = (90 + cursorDist * Math.sin(rad) - 5) + 'px';
}

function pickSquare(sqCv, sqCursor, e) {
var rect = sqCv.getBoundingClientRect();
var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
var y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
paletteS = x / rect.width;
paletteV = 1 - y / rect.height;
updateColorFromHSV();

sqCursor.style.display = 'block';
sqCursor.style.left = (40 + x - 5) + 'px';
sqCursor.style.top = (40 + y - 5) + 'px';
}

function hsvToRgb(h, s, v) {
h = h / 360;
var i = Math.floor(h * 6);
var f = h * 6 - i;
var p = v * (1 - s);
var q = v * (1 - f * s);
var u = v * (1 - (1 - f) * s);
var r = 0;
var g = 0;
var b = 0;
switch (i % 6) {
case 0: r = v; g = u; b = p; break;
case 1: r = q; g = v; b = p; break;
case 2: r = p; g = v; b = u; break;
case 3: r = p; g = q; b = v; break;
case 4: r = u; g = p; b = v; break;
case 5: r = v; g = p; b = q; break;
}
return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHex(r, g, b) {
return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
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
var pp = document.getElementById('stg-palette');
if (pp) pp.style.display = 'none';
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
if (act === 'save') { saveData(); return; }
if (act === 'clear') { clearAll(); return; }
if (act === 'color') {
var pp = document.getElementById('stg-palette');
if (pp) {
if (pp.style.display === 'block') {
pp.style.display = 'none';
toast('调色板已关闭');
} else {
pp.style.display = 'block';
toast('调色板已打开');
}
}
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
ctx.stroke();
ctx.beginPath();
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
ctx.globalAlpha = 1;
}

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
return'char_' + c.activeCharacter;
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
