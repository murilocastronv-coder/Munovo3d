/* Botões mobile extras (poções, atalhos, chat…). Usa a mesma ponte de teclas do
   teclado virtual existente: Module._mu_key(down, vk, ch). Só aparece em telas de toque. */
(function () {
  if (window._muActions) return;
  window._muActions = 1;

  // [rótulo, legenda, vk, ch]  — atalhos confirmados no código do cliente 0.97k
  var KEYS = [
    ['Q', 'Poção 1', 81, 113], ['W', 'Poção 2', 87, 119], ['E', 'Poção 3', 69, 101], ['␣', 'Pegar', 32, 32],
    ['C', 'Perso', 67, 99], ['I', 'Inv.', 73, 105], ['M', 'Mover', 77, 109], ['⇥', 'Mapa', 9, 0],
    ['P', 'Grupo', 80, 112], ['G', 'Guild', 71, 103], ['⏎', 'Chat', 13, 13], ['⎋', 'Esc', 27, 0]
  ];
  var MIN_HOLD = 90; // o jogo lê as teclas a cada quadro; segura um pouco para não perder o toque

  var css = document.createElement('style');
  css.textContent =
    '#muActions{display:none;position:fixed;z-index:8;right:84px;bottom:max(12px,env(safe-area-inset-bottom));' +
    'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none}' +
    '#muActGrid{display:grid;grid-template-columns:repeat(4,40px);gap:5px}' +
    '#muActions.mu-hide #muActGrid{display:none}' +
    '#muActions button{touch-action:none;-webkit-tap-highlight-color:transparent;font-family:system-ui,sans-serif}' +
    '.muAct{height:40px;opacity:.78;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(18,20,28,.82);' +
    'color:#f1f5f9;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}' +
    '.muAct b{font-size:15px;line-height:1;font-weight:700}.muAct i{font-style:normal;font-size:8.5px;line-height:1;opacity:.75}' +
    '.muAct.on{opacity:1;background:rgba(198,155,74,.95);color:#111;border-color:#ffe4a1}.muAct.on i{opacity:1}' +
    '.muActPot{border-color:rgba(231,96,96,.5)}' +
    '#muActToggle{display:block;margin:0 0 5px auto;height:24px;min-width:40px;padding:0 10px;opacity:.8;border-radius:12px;' +
    'border:1px solid rgba(255,255,255,.22);background:rgba(18,20,28,.82);color:#cbd5e1;font-size:11px}' +
    '@media (pointer:coarse),(max-width:900px){#muActions{display:block}}' +
    '@media (pointer:coarse) and (orientation:portrait),(max-width:600px) and (orientation:portrait){' +
    '#muActions{bottom:calc(150px + env(safe-area-inset-bottom))}}' +
    'body:has(#muKeys.on) #muActions{display:none!important}';
  document.head.appendChild(css);

  var box = document.createElement('div');
  box.id = 'muActions';
  box.innerHTML = '<button id="muActToggle" type="button" aria-label="Mostrar ou esconder atalhos">Atalhos ▾</button><div id="muActGrid"></div>';
  document.body.appendChild(box);
  var grid = box.querySelector('#muActGrid');
  var toggle = box.querySelector('#muActToggle');

  function send(down, vk, ch) {
    if (typeof Module !== 'undefined' && Module._mu_key)
      Module._mu_key(down ? 1 : 0, vk | 0, down ? (ch | 0) : 0);
  }
  function focusCanvas() {
    var c = document.getElementById('canvas');
    if (c) c.focus({ preventScroll: true });
  }

  var held = {};
  KEYS.forEach(function (k, idx) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'muAct' + (idx < 3 ? ' muActPot' : '');
    b.setAttribute('aria-label', k[1]);
    b.innerHTML = '<b>' + k[0] + '</b><i>' + k[1] + '</i>';
    b.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      try { b.setPointerCapture(ev.pointerId); } catch (e) { }
      focusCanvas();
      b.classList.add('on');
      held[ev.pointerId] = { b: b, vk: k[2], t: Date.now() };
      send(1, k[2], k[3]);
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { } }
    });
    function lift(ev) {
      var h = held[ev.pointerId];
      if (!h || h.b !== b) return;
      delete held[ev.pointerId];
      var wait = Math.max(0, MIN_HOLD - (Date.now() - h.t));
      setTimeout(function () { send(0, h.vk, 0); b.classList.remove('on'); }, wait);
    }
    b.addEventListener('pointerup', lift);
    b.addEventListener('pointercancel', lift);
    b.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    grid.appendChild(b);
  });

  var hidden = true;
  try { var sv = localStorage.getItem('muActHidden'); if (sv !== null) hidden = sv === '1'; } catch (e) { }
  function applyHidden() {
    box.classList.toggle('mu-hide', hidden);
    toggle.textContent = hidden ? 'Atalhos ▸' : 'Atalhos ▾';
  }
  applyHidden();
  toggle.addEventListener('pointerdown', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    hidden = !hidden; applyHidden();
    try { localStorage.setItem('muActHidden', hidden ? '1' : '0'); } catch (e) { }
  });

  window.addEventListener('blur', function () {
    Object.keys(held).forEach(function (id) { send(0, held[id].vk, 0); held[id].b.classList.remove('on'); });
    held = {};
  });
})();
