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

    var me = { x: DEFAULT_X, y: DEFAULT_Y, inWorld: false };
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
      var stride = 2 + 2 + CS_LEN + 10 + 3;
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
      return new Uint8Array([0xC1, 8, 0xD3, (key >> 8) & 0x7F, key & 255, clamp(r.x), clamp(r.y), 0x30]);
    }

    function show(list) {
      for (var i = 0; i < list.length; i += 20) {
        var chunk = list.slice(i, i + 20);
        deliver(buildCreate(chunk));
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

    // pacote do SEU cliente indo para o servidor local
    function onClientPacket(bytes) {
      try {
        eachPacket(bytes, function (h, p, hdr) {
          if (h !== 0xC1) return;
          var code = p[hdr];
          if (debug && code !== 0xD3 && code !== 0xD7) log("cliente->servidor code=0x" + code.toString(16));
          if ((code === 0xD3 || code === 0xD7) && p.length >= hdr + 3) {
            var x = p[hdr + 1], y = p[hdr + 2];
            if (x === 0 && y === 0) return;
            me.x = x; me.y = y;
            if (!me.inWorld) { me.inWorld = true; log("no mundo em", x, y); }
            sendMove(x, y);
          }
        });
      } catch (e) { log("erro cliente", e); }
    }

    // pacote do servidor local indo para o seu cliente
    function onServerPacket(bytes) {
      try {
        eachPacket(bytes, function (h, p, hdr) {
          var code = p[hdr];
          if (code === 0x1C) { // teletransporte / troca de mapa: o cliente limpa os objetos
            remotes.forEach(function (r) { r.shown = false; });
            pausedUntil = now() + 2000;
            log("troca de mapa/teleporte, ressincronizando");
          }
        });
      } catch (e) { log("erro servidor", e); }
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
        var d = dist(r, me);
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
      upsert: upsert, remove: remove, reset: reset, tick: tick,
      _build: { create: buildCreate, destroy: buildDestroy, move: buildMove }
    };
  }

  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MuMpWorld = api;
})(typeof window !== "undefined" ? window : globalThis);
