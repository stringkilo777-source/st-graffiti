(function () {
  'use strict';

  var initDone = false;

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
      var c = SillyTavern.getContext();
      if (c && c.eventSource && c.event_types && c.event_types.APP_READY) {
        c.eventSource.on(c.event_types.APP_READY, fire);
      }
    }
  } catch (e) {}

  function startPlugin() {
    console.log('[STG] starting');
    makeFab();
    makeToolbar();
    console.log('[STG] ready');
  }

  var drawing = false;
  var tool = 'pen';
  var penColor = '#ff0000';
  var penWidth = 3;
  var pressing = false;
  var lastCanvas = null;

  function makeFab() {
    if (document.getElementById('stg-fab')) return;
    var fab = document.createElement('div');
    fab.id = 'stg-fab';
    fab.textContent = '\u270F';
    fab.style.cssText = 'position:fixed;right:16px;bottom:80px;width:46px;height:46px;border-radius:50%;background:#2a2a2a;border:2px solid #ff859d;display:flex;align-items:center;justify-content:center;z-index:2000000;user-select:none;-webkit-user-select:none;touch-action:none;box-shadow:0 2px 10px rgba(0,0,0,0.4);font-size:20px;color:#ff859d;';
    document.body.appendChild(fab);
    fab.addEventListener('click', function () {
      enterDraw();
    });
  }

  function makeToolbar() {
    if (document.getElementById('stg-toolbar')) return;
    var bar = document.createElement('div');
    bar.id = 'stg-toolbar';

    var buttons = [
      { id: 'mouse', label: '\uD83D\uDDB1' },
      { id: 'pen', label: '\u270F' },
      { id: 'eraser', label: '\u2B55' },
      { id: 'clear', label: '\uD83D\uDDD1' },
      { id: 'save', label: '\uD83D\uDCBE' },
      { id: 'exit', label: '\u2716' }
    ];

    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var btn = document.createElement('button');
      btn.className = 'stg-btn';
      btn.setAttribute('data-stg', b.id);
      btn.textContent = b.label;
      bar.appendChild(btn);
    }

    document.body.appendChild(bar);

    bar.addEventListener('click', function (e) {
      var t = e.target.closest('[data-stg]');
      if (!t) return;
      var act = t.getAttribute('data-stg');
      onTool(act);
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
    if (!mt) return;
    var existing = mt.querySelector('.stg-canvas');
    if (existing) {
      if (tool !== 'mouse') existing.classList.add('stg-active');
      return;
    }
    var cv = document.createElement('canvas');
    cv.className = 'stg-canvas';
    cv.width = mt.clientWidth || 300;
    cv.height = mt.clientHeight || 100;
    if (tool !== 'mouse') cv.classList.add('stg-active');
    mt.appendChild(cv);
    bindCanvas(cv);
  }

  function bindCanvas(cv) {
    cv.addEventListener('pointerdown', function (e) {
      if (!drawing || tool === 'mouse') return;
      e.preventDefault();
      pressing = true;
      lastCanvas = cv;
      cv.setPointerCapture(e.pointerId);
      var pos = getPos(cv, e);
      var ctx = cv.getContext('2d');
      setBrush(ctx);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x + 0.5, pos.y + 0.5);
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
    });

    cv.addEventListener('pointerup', function () {
      pressing = false;
      lastCanvas = null;
    });

    cv.addEventListener('pointercancel', function () {
      pressing = false;
      lastCanvas = null;
    });
  }

  function getPos(cv, e) {
    var r = cv.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (cv.width / r.width),
      y: (e.clientY - r.top) * (cv.height / r.height)
    };
  }

  function setBrush(ctx) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = 16;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
    }
  }

  function clearAll() {
    var all = document.querySelectorAll('.stg-canvas');
    for (var i = 0; i < all.length; i++) {
      var ctx = all[i].getContext('2d');
      ctx.clearRect(0, 0, all[i].width, all[i].height);
    }
  }

  function saveData() {
    console.log('[STG] save called');
    alert('Saved! (basic version)');
  }

})();
