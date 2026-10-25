/* Multiplayer no mundo: mostra os outros jogadores dentro do jogo.
   Lê os pacotes de movimento do SEU personagem (cliente -> servidor local) e injeta
   pacotes padrão do MU (0x12 criar jogador, 0xD3 mover, 0x14 remover) no cliente
   para cada jogador remoto. Nenhuma alteração no .wasm é necessária.

   Ajustes por URL (para testar sem editar código):
     ?mpdebug=1   mostra no console todos os pacotes relevantes
     ?mpcs=13     tamanho do CharSet do pacote 0x12 (padrão 18)
     ?mpworld=0   desliga a parte visual (fica só chat + lista)             */
(function (root) {
  "use strict";

  function create(opts) {
    opts = opts || {};
    var deliver = opts.deliver || function () {};
    var sendMove = opts.sendMove || function () {};
    var now = opts.now || function () { return Date.now(); };
    var VIEW = opts.viewRange || 16;          // distância (em casas) para mostrar um jogador
    var CS_LEN = opts.csLen || 18;            // tamanho do CharSet no pacote 0x12
    var KEY_BASE = 0x6000;                    // chaves de objeto fora da faixa normal do servidor local
    var MAX_SLOTS = 120;
    var debug = !!opts.debug;
    var charset = opts.charset || [];         // 18 bytes opcionais com a aparência
    var DEFAULT_X = 130, DEFAULT_Y = 125;     // spawn de Lorencia até o primeiro movimento

    var me = { x: DEFAULT_X, y: DEFAULT_Y, inWorld: false, known: false };
    var moveSendCode = opts.moveCode || 0x10; // código do pacote "mover objeto" (servidor -> cliente), visto no log do cliente
    var moveSendLen = 8;
    var moveCode = 0;                         // código do movimento do SEU personagem (aprendido)
    var cand = {};                            // candidatos a código de movimento
    var heroKey = -1, learnedStride = 0;
    var cIn = {}, cOut = {};                  // contadores de pacotes por código (diagnóstico)
    var injected = 0;
    var remotes = new Map();                  // id -> { id,name,x,y,hasPos,slot,shown,sx,sy,dirty }
    var freeSlots = [];
    var nextSlot = 0;
    var pausedUntil = 0;

    function log() { if (debug) console.log.apply(console, ["[MuMpWorld]"].concat([].slice.call(arguments))); }

    function allocSlot() {
      if (freeSlots.length) return freeSlots.pop();
      if (nextSlot >= MAX_SLOTS) return -1;
      return nextSlot++;
    }
    function clamp(v) { v = v | 0; return v < 0 ? 0 : v > 255 ? 255 : v; }
    function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

    // ---------- construção de pacotes ----------
    function nameBytes(name) {
      var s = String(name || "Player").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 10) || "Player";
      var out = new Uint8Array(10);
      for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    }
    function buildCreate(list) {
      var stride = 17 + CS_LEN;
      var size = 5 + list.length * stride;
      var b = new Uint8Array(size);
      b[0] = 0xC2; b[1] = (size >> 8) & 255; b[2] = size & 255; b[3] = 0x12; b[4] = list.length;
      var o = 5;
      list.forEach(function (r) {
        var key = KEY_BASE + r.slot;
        b[o++] = (key >> 8) & 0x7F; b[o++] = key & 255;
        b[o++] = clamp(r.x); b[o++] = clamp(r.y);
        for (var i = 0; i < CS_LEN; i++) b[o++] = (charset[i] | 0) & 255;
        b.set(nameBytes(r.name), o); o += 10;
        b[o++] = clamp(r.x); b[o++] = clamp(r.y);
        b[o++] = 0x30; // direção + PK level
      });
      return b;
    }
    function buildDestroy(list) {
      var size = 4 + list.length * 2;
      var b = new Uint8Array(size);
      b[0] = 0xC1; b[1] = size; b[2] = 0x14; b[3] = list.length;
      var o = 4;
      list.forEach(function (r) { var key = KEY_BASE + r.slot; b[o++] = (key >> 8) & 0x7F; b[o++] = key & 255; });
      return b;
    }
    function buildMove(r) {
      var key = KEY_BASE + r.slot;
      var b = new Uint8Array(moveSendLen);
      b[0] = 0xC1; b[1] = moveSendLen; b[2] = moveSendCode;
      b[3] = (key >> 8) & 0x7F; b[4] = key & 255; b[5] = clamp(r.x); b[6] = clamp(r.y);
      for (var i = 7; i < moveSendLen; i++) b[i] = 0x30;
      return b;
    }

    function show(list) {
      for (var i = 0; i < list.length; i += 20) {
        var chunk = list.slice(i, i + 20);
        deliver(buildCreate(chunk)); injected++;
        chunk.forEach(function (r) { r.shown = true; r.sx = r.x; r.sy = r.y; r.dirty = false; });
      }
      log("criou", list.map(function (r) { return r.name; }));
    }
    function hide(list) {
      if (!list.length) return;
      for (var i = 0; i < list.length; i += 20) deliver(buildDestroy(list.slice(i, i + 20)));
      list.forEach(function (r) { r.shown = false; });
      log("removeu", list.map(function (r) { return r.name; }));
    }

    // ---------- leitura de pacotes ----------
    function eachPacket(b, fn) {
      var o = 0;
      while (o + 3 <= b.length) {
        var h = b[o], len, hdr;
        if (h === 0xC1 || h === 0xC3) { len = b[o + 1]; hdr = 2; }
        else if (h === 0xC2 || h === 0xC4) { len = (b[o + 1] << 8) | b[o + 2]; hdr = 3; }
        else break;
        if (!len || o + len > b.length) break;
        fn(h, b.subarray(o, o + len), hdr);
        o += len;
      }
    }

    function enterWorld() {
      if (me.inWorld) return;
      me.inWorld = true; log("no mundo; pos", me.x, me.y);
      sendMove(me.x, me.y); // avisa os outros onde você está (mesmo que seja o spawn)
    }
    function plausibleMove(x, y) {
      if (!me.known) return x > 0 && y > 0;
      return Math.max(Math.abs(x - me.x), Math.abs(y - me.y)) <= 60;
    }

    // pacote do SEU cliente indo para o servidor local
    function onClientPacket(bytes) {
      try {
        eachPacket(bytes, function (h, p, hdr) {
          if (h !== 0xC1 && h !== 0xC2) return;
          var code = p[hdr];
          cOut[code] = (cOut[code] || 0) + 1;
          if (debug) log("cliente->servidor 0x" + code.toString(16), Array.prototype.join.call(p, ","));
          if (p.length < hdr + 3 || p.length > 48) return;
          var x = p[hdr + 1], y = p[hdr + 2];
          var ok = false;
          if (moveCode) ok = (code === moveCode) && plausibleMove(x, y);
          else if ((code === 0xD3 || code === 0xD7) && plausibleMove(x, y)) ok = true;
          else if (me.known && plausibleMove(x, y) && Math.max(Math.abs(x - me.x), Math.abs(y - me.y)) <= 25) {
            // aprende o código: pacotes repetidos com destino perto de onde você está
            cand[code] = (cand[code] || 0) + 1;
            if (cand[code] >= 3) { moveCode = code; log("código de movimento aprendido: 0x" + code.toString(16)); ok = true; }
          }
          if (ok) {
            me.x = x; me.y = y; me.known = true;
            if (!me.inWorld) enterWorld(); else sendMove(x, y);
          }
        });
      } catch (e) { log("erro cliente", e); }
    }

    // pacote do servidor local indo para o seu cliente
    function onServerPacket(bytes) {
      try {
        eachPacket(bytes, function (h, p, hdr) {
          if (h !== 0xC1 && h !== 0xC2) { return; }
          var code = p[hdr];
          cIn[code] = (cIn[code] || 0) + 1;
          if (debug && code !== 0x13 && code !== 0x10) log("servidor->cliente 0x" + code.toString(16), p.length + " bytes");
          if (code === 0x12) { // criar jogador(es): o servidor local manda o SEU herói; aprende formato/aparência/posição
            var cnt = p[hdr + 1], first = hdr + 2;
            if (cnt >= 1 && cnt < 40 && (p.length - first) % cnt === 0) {
              var stride = (p.length - first) / cnt;
              if (stride > 17 && stride < 60) {
                learnedStride = stride; CS_LEN = stride - 17;
                if (heroKey < 0) {
                  heroKey = ((p[first] & 0x7F) << 8) | p[first + 1];
                  me.x = p[first + 2]; me.y = p[first + 3]; me.known = true;
                  charset = Array.prototype.slice.call(p, first + 4, first + 4 + CS_LEN); // copia a sua aparência
                  log("herói aprendido: key", heroKey, "pos", me.x, me.y, "stride", stride);
                }
              }
            }
            enterWorld();
          } else if (code === 0x13) { enterWorld(); }
          else if (code === 0x10 && h === 0xC1 && p.length >= 6 && p.length <= 12) { moveSendLen = p.length; }
          else if (code === 0x1C) { // teletransporte / troca de mapa: o cliente limpa os objetos
            remotes.forEach(function (r) { r.shown = false; });
            me.known = false;
            pausedUntil = now() + 2000;
            log("troca de mapa/teleporte, ressincronizando");
          }
        });
      } catch (e) { log("erro servidor", e); }
    }

    function topCodes(o) {
      return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, 6).map(function (k) { return "0x" + (+k).toString(16) + "×" + o[k]; }).join(" ") || "-";
    }
    function status() {
      var vis = 0; remotes.forEach(function (r) { if (r.shown) vis++; });
      return "mundo:" + (me.inWorld ? "sim" : "não") + " pos:" + (me.known ? me.x + "," + me.y : "?") +
        " remotos:" + remotes.size + " visíveis:" + vis + " injetados:" + injected +
        " cs:" + CS_LEN + (learnedStride ? "(aprendido)" : "(padrão)") + " mov:" + (moveCode ? "0x" + moveCode.toString(16) : "D3/D7") +
        "\nentrada " + topCodes(cIn) + "\nsaída " + topCodes(cOut);
    }

    // ---------- jogadores remotos ----------
    function upsert(p) {
      if (!p || !p.id) return;
      var r = remotes.get(p.id);
      if (!r) {
        r = { id: p.id, name: p.name || "Player", x: 0, y: 0, hasPos: false, slot: allocSlot(), shown: false, sx: 0, sy: 0, dirty: false };
        if (r.slot < 0) return;
        remotes.set(p.id, r);
      }
      if (p.name && p.name !== r.name) {
        r.name = p.name;
        if (r.shown) { hide([r]); } // será recriado no próximo tick com o nome novo
      }
      if (p.hasPos !== false && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.x || p.y)) {
        r.x = clamp(p.x); r.y = clamp(p.y); r.hasPos = true; r.dirty = true;
      }
    }
    function remove(id) {
      var r = remotes.get(id);
      if (!r) return;
      if (r.shown) hide([r]);
      freeSlots.push(r.slot);
      remotes.delete(id);
    }
    function reset() {
      var shown = [];
      remotes.forEach(function (r) { if (r.shown) shown.push(r); });
      hide(shown);
      remotes.clear(); freeSlots = []; nextSlot = 0;
    }

    // roda ~5x por segundo
    function tick() {
      if (!me.inWorld || now() < pausedUntil) return;
      var toShow = [], toHide = [];
      remotes.forEach(function (r) {
        if (!r.hasPos) return;
        var d = me.known ? dist(r, me) : 0;
        if (!r.shown) { if (d <= VIEW) toShow.push(r); return; }
        if (d > VIEW + 4) { toHide.push(r); return; }
        if (r.dirty && (r.x !== r.sx || r.y !== r.sy)) {
          if (dist(r, { x: r.sx, y: r.sy }) > 12) { toHide.push(r); toShow.push(r); } // pulo grande: recria
          else deliver(buildMove(r));
          r.sx = r.x; r.sy = r.y;
        }
        r.dirty = false;
      });
      hide(toHide.filter(function (r) { return r.shown; }));
      show(toShow);
    }

    return {
      me: me, remotes: remotes,
      onClientPacket: onClientPacket, onServerPacket: onServerPacket,
      upsert: upsert, remove: remove, reset: reset, tick: tick, status: status,
      _build: { create: buildCreate, destroy: buildDestroy, move: buildMove }
    };
  }

  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MuMpWorld = api;
})(typeof window !== "undefined" ? window : globalThis);
