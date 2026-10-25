/* Multiplayer discreto: uma pílula pequena "● N online" no canto superior esquerdo.
   Toque para abrir chat e lista de jogadores. Com o painel fechado, as mensagens
   aparecem como um aviso pequeno que some sozinho. Nada fica sobre o mapa. */
(() => {
  if (window._muMp) return; window._muMp = 1;
  const SAME = /^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname);
  const WS_URL = window.MU_WS_URL || (SAME
    ? (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"
    : "wss://mu-online-multiplayer-gateway.onrender.com/ws");
  const ROOM = "Lorencia";

  // O cliente do jogo captura o teclado na janela (e bloqueia o padrão). Deixa o teclado
  // livre para o nosso campo de texto: nossa captura roda antes e corta a do jogo.
  ["keydown", "keyup", "keypress"].forEach(t => window.addEventListener(t, ev => {
    if (ev.target && ev.target.closest && ev.target.closest("#muMp")) ev.stopImmediatePropagation();
  }, true));

  const css = document.createElement("style");
  css.textContent = `
  #muMp{position:fixed;z-index:6;left:max(8px,env(safe-area-inset-left));top:48px;font:12px system-ui,sans-serif;color:#eef2fa;-webkit-user-select:none;user-select:none}
  #muMp *{box-sizing:border-box}
  #muMpPill{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;border:1px solid rgba(255,255,255,.18);background:rgba(10,12,18,.62);color:#eef2fa;font:600 11px system-ui,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}
  #muMpPill:hover,#muMp.open #muMpPill{background:rgba(10,12,18,.9)}
  #muMpDot{width:7px;height:7px;border-radius:50%;background:#d74b4b}#muMp.on #muMpDot{background:#49d17d}
  #muMpPanel{display:none;margin-top:6px;width:min(270px,calc(100vw - 16px));background:rgba(10,12,18,.93);border:1px solid rgba(255,255,255,.16);border-radius:10px;box-shadow:0 8px 24px #0008;overflow:hidden}
  #muMp.open #muMpPanel{display:block}
  #muMpWho{padding:7px 9px;color:#aebbd0;font-size:11px;border-bottom:1px solid rgba(255,255,255,.1);overflow-wrap:anywhere}
  #muMpLog{height:96px;overflow:auto;padding:7px 9px;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
  #muMpLog p{margin:0 0 5px}#muMpLog b{color:#f3ca73}#muMpLog .s{color:#8fa1ba;font-style:italic}
  #muMpForm{display:flex;gap:5px;padding:6px;border-top:1px solid rgba(255,255,255,.1)}
  #muMpForm input{min-width:0;flex:1;background:#0b111b;color:#fff;border:1px solid #48556a;border-radius:6px;padding:7px;font-size:16px;-webkit-user-select:text;user-select:text}
  #muMpForm button{background:#b8862d;color:#111;border:0;border-radius:6px;padding:0 11px;font-weight:700}
  #muMpName{display:flex;gap:5px;padding:6px;border-top:1px solid rgba(255,255,255,.1)}
  #muMpName input{font-size:12px!important}
  #muMpToast{margin-top:5px;max-width:min(240px,calc(100vw - 16px));padding:5px 8px;border-radius:8px;background:rgba(10,12,18,.72);font-size:11px;line-height:1.3;overflow-wrap:anywhere;opacity:0;transition:opacity .25s;pointer-events:none}
  #muMpToast.show{opacity:1}#muMpToast b{color:#f3ca73}
  #muMp.open #muMpToast{display:none}
  @media (pointer:coarse),(max-width:720px){#muMp{top:46px}}`;
  document.head.appendChild(css);

  const root = document.createElement("div");
  root.id = "muMp";
  root.innerHTML = `
    <button id="muMpPill" type="button" aria-label="Multiplayer"><span id="muMpDot"></span><span id="muMpCount">…</span></button>
    <div id="muMpPanel">
      <div id="muMpWho">Conectando…</div>
      <div id="muMpLog" aria-live="polite"></div>
      <form id="muMpForm"><input id="muMpText" maxlength="240" autocomplete="off" placeholder="Mensagem…"><button type="submit">Enviar</button></form>
      <form id="muMpName"><input id="muMpNick" maxlength="18" autocomplete="off" aria-label="Seu nome" style="min-width:0;flex:1;background:#0b111b;color:#fff;border:1px solid #48556a;border-radius:6px;padding:6px"><button type="submit" style="background:#2a2d37;color:#eee;border:0;border-radius:6px;padding:0 10px">Nome</button></form>
    </div>
    <div id="muMpToast"></div>`;
  document.body.appendChild(root);
  const $ = id => document.getElementById(id);
  const count = $("muMpCount"), who = $("muMpWho"), log = $("muMpLog"), toast = $("muMpToast"), nick = $("muMpNick");

  let name = "";
  try { name = localStorage.getItem("muMpName") || ""; } catch (_) {}
  if (!name) name = "Player" + Math.floor(100 + Math.random() * 900);
  nick.value = name;

  const roster = new Map();
  let socket = null, retry = null, toastTimer = null, retryMs = 2000;

  function line(text, who2, sys) {
    const p = document.createElement("p"); if (sys) p.className = "s";
    if (who2) { const b = document.createElement("b"); b.textContent = who2 + ": "; p.appendChild(b); }
    p.appendChild(document.createTextNode(text)); log.appendChild(p);
    while (log.children.length > 50) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function flash(text, who2) {
    toast.textContent = "";
    if (who2) { const b = document.createElement("b"); b.textContent = who2 + ": "; toast.appendChild(b); }
    toast.appendChild(document.createTextNode(text));
    toast.classList.add("show"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 6000);
  }
  function renderRoster() {
    count.textContent = roster.size + " online";
    who.textContent = roster.size ? "Na sala " + ROOM + ": " + [...roster.values()].map(p => p.name).join(", ") : "Sala vazia";
  }
  function send(o) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(o)); }

  function connect() {
    if (socket && socket.readyState <= 1) return;
    try { socket = new WebSocket(WS_URL); } catch (_) { return; }
    socket.addEventListener("open", () => {
      retryMs = 2000; root.classList.add("on");
      send({ type: "join", name, room: ROOM });
    });
    socket.addEventListener("message", ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "welcome") {
        roster.clear(); (m.players || []).forEach(p => roster.set(p.id, p));
        renderRoster(); line("Você entrou na sala " + m.room + ".", "", true);
      } else if (m.type === "join") { roster.set(m.player.id, m.player); renderRoster(); }
      else if (m.type === "leave") { roster.delete(m.id); renderRoster(); }
      else if (m.type === "system") line(m.text, "", true);
      else if (m.type === "chat") { line(m.text, m.name, false); if (!root.classList.contains("open")) flash(m.text, m.name); }
      else if (m.type === "error") line(m.message, "", true);
    });
    socket.addEventListener("close", () => {
      root.classList.remove("on"); roster.clear(); count.textContent = "offline"; who.textContent = "Reconectando…";
      clearTimeout(retry); retry = setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 1.7, 20000);
    });
    socket.addEventListener("error", () => { try { socket.close(); } catch (_) {} });
  }

  $("muMpPill").addEventListener("click", () => { root.classList.toggle("open"); toast.classList.remove("show"); });
  // toque fora fecha o painel
  document.addEventListener("pointerdown", ev => {
    if (root.classList.contains("open") && !root.contains(ev.target)) root.classList.remove("open");
  }, true);
  $("muMpForm").addEventListener("submit", e => {
    e.preventDefault(); const t = $("muMpText"), text = t.value.trim();
    if (!text) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) { line("Sem conexão com o servidor.", "", true); return; }
    send({ type: "chat", text }); t.value = "";
  });
  $("muMpName").addEventListener("submit", e => {
    e.preventDefault();
    const n = nick.value.trim().slice(0, 18) || name;
    name = n; nick.value = n;
    try { localStorage.setItem("muMpName", n); } catch (_) {}
    send({ type: "join", name, room: ROOM });
  });
  connect();
})();
