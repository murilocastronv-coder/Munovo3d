/**
 * ============================================================================
 * MU Online Solo Classic - Unthrottled Background Worker Timer (AFK Support)
 * ============================================================================
 * Modern browsers (Chrome, Edge, Firefox, Safari) aggressively throttle timers
 * (clamping setTimeout/setInterval to 1000ms, and after 5 minutes to 60,000ms)
 * when the tab is in the background. Web Workers run in an isolated thread and
 * are exempt from background timer throttling. Routing timer execution through
 * a dedicated Web Worker ensures Emscripten's main loop and auto-attack keep
 * ticking at full 25 FPS without interruption when the tab is hidden.
 */

(function initSoloBackgroundTimer() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof Blob === 'undefined') return;

  var workerCode = `
    var timers = new Map();
    self.onmessage = function (e) {
      var data = e.data;
      if (!data) return;
      if (data.type === 'setTimeout') {
        var id = data.id;
        var delay = data.delay || 0;
        if (delay <= 0) {
          self.postMessage({ id: id });
        } else {
          var t = setTimeout(function () {
            timers.delete(id);
            self.postMessage({ id: id });
          }, delay);
          timers.set(id, { t: t, isInterval: false });
        }
      } else if (data.type === 'setInterval') {
        var id = data.id;
        var delay = Math.max(1, data.delay || 0);
        var t = setInterval(function () {
          self.postMessage({ id: id });
        }, delay);
        timers.set(id, { t: t, isInterval: true });
      } else if (data.type === 'clear') {
        var item = timers.get(data.id);
        if (item) {
          if (item.isInterval) clearInterval(item.t);
          else clearTimeout(item.t);
          timers.delete(data.id);
        }
      }
    };
  `;

  var worker = null;
  try {
    var blob = new Blob([workerCode], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
  } catch (err) {
    console.warn('[SoloTimer] Background timer worker initialization failed:', err);
    return;
  }

  var nextId = 1;
  var callbacks = new Map();

  worker.onmessage = function (e) {
    var id = e.data && e.data.id;
    var item = callbacks.get(id);
    if (!item) return;
    if (!item.isInterval) {
      callbacks.delete(id);
    }
    try {
      item.fn.apply(null, item.args);
    } catch (err) {
      console.error('[SoloTimer] Timer callback error:', err);
    }
  };

  var origSetTimeout = window.setTimeout.bind(window);
  var origClearTimeout = window.clearTimeout.bind(window);
  var origSetInterval = window.setInterval.bind(window);
  var origClearInterval = window.clearInterval.bind(window);

  window.setTimeout = function (fn, delay) {
    if (typeof fn !== 'function') {
      return origSetTimeout.apply(window, arguments);
    }
    var id = nextId++;
    var args = Array.prototype.slice.call(arguments, 2);
    callbacks.set(id, { fn: fn, args: args, isInterval: false });
    worker.postMessage({ type: 'setTimeout', id: id, delay: Math.max(0, delay | 0) });
    return id;
  };

  window.clearTimeout = function (id) {
    if (typeof id === 'number' && callbacks.has(id)) {
      callbacks.delete(id);
      worker.postMessage({ type: 'clear', id: id });
    } else {
      origClearTimeout(id);
    }
  };

  window.setInterval = function (fn, delay) {
    if (typeof fn !== 'function') {
      return origSetInterval.apply(window, arguments);
    }
    var id = nextId++;
    var args = Array.prototype.slice.call(arguments, 2);
    callbacks.set(id, { fn: fn, args: args, isInterval: true });
    worker.postMessage({ type: 'setInterval', id: id, delay: Math.max(1, delay | 0) });
    return id;
  };

  window.clearInterval = function (id) {
    if (typeof id === 'number' && callbacks.has(id)) {
      callbacks.delete(id);
      worker.postMessage({ type: 'clear', id: id });
    } else {
      origClearInterval(id);
    }
  };

  console.log('[SoloTimer] Unthrottled background timer worker initialized (AFK support active).');
})();
