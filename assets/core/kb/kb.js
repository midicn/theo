/* ═══════════════════════════════════════════════════════════════════════
   midicn 内核 · kb/assets/kb.js
   ① 把 .kb-play 按钮接到共享播放引擎（player.js，取 lib 站的 MIDI）
   ② 渲染 audiolab 交互组件（Web Audio **实时合成**，零素材零版权）

   关键约定
     · **渲染路径不依赖音频** —— 音频上下文在**首次点击时**才创建
     · 播放引擎失败（Tone/Midi 未加载）只影响播放，不影响阅读
     · 播放零跳转：fetch MIDI → 合成 → 页内出声；「详情」是另一条链接
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 音名 → 频率（用于 audiolab）───────────────────────────────── */
  var STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteToMidi(s) {
    var m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(s).trim());
    if (!m) return null;
    var n = STEP[m[1].toUpperCase()];
    if (m[2] === '#') n += 1;
    if (m[2] === 'b') n -= 1;
    return n + (parseInt(m[3], 10) + 1) * 12;
  }
  function midiToFreq(mi) { return 440 * Math.pow(2, (mi - 69) / 12); }

  /* ── 极简合成器（Web Audio 实时合成，不加载任何音频文件）───────── */
  var actx = null;
  function ac() {
    if (actx) return actx;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { actx = new C(); } catch (e) { return null; }
    return actx;
  }
  function resume() {
    var a = ac();
    if (a && a.state === 'suspended') { try { a.resume(); } catch (e) {} }
    return a;
  }
  function softTone(freq, at, dur, vol, type) {
    var a = ac(); if (!a) return;
    var t0 = a.currentTime + at;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.22, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.7));
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + (dur || 0.7) + 0.06);
  }

  /* ── 共享播放引擎接线 ───────────────────────────────────────────── */
  var engineTried = false;
  var curBtn = null;            // 当前（最后被点播的）按钮 —— 播放/暂停切换的依据
  var lastPos = 0, lastTotal = 0;

  function LBL() {
    return (window.__KB__ && window.__KB__.lbl) || {};
  }
  function clearGlyphs() {
    document.querySelectorAll('.kb-play[aria-pressed="true"]')
      .forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
  }

  function engineReady() {
    if (typeof window.Player === 'undefined') return false;
    if (!engineTried) {
      engineTried = true;
      window.Player.init({
        onState: function (playing) {
          if (!playing) {
            clearGlyphs();
            // 放完自然结束（进度已到末尾）才收起播放条；中途暂停则保留，便于继续
            var bar = document.getElementById('player');
            if (bar && !bar.hidden && lastTotal > 1 && lastPos >= lastTotal - 0.3) {
              bar.hidden = true;
              curBtn = null;
            }
          } else if (curBtn) {
            curBtn.setAttribute('aria-pressed', 'true');
          }
          var bar2 = document.getElementById('player');
          if (bar2) {
            var tb = bar2.querySelector('[data-pbar="toggle"]');
            if (tb) tb.textContent = playing ? (LBL().pause || '暂停') : (LBL().play || '播放');
          }
        },
        onBadge: function () {},
        onTime: function (pos, total) {
          lastPos = pos || 0; lastTotal = total || 0;
          seekTotal = total || 0;
          var s0 = seekBar();
          if (s0) { s0.max = String(seekTotal); if (!seeking) s0.value = String(lastPos); }
          var bar = document.getElementById('player');
          if (!bar || bar.hidden) return;
          var el = bar.querySelector('.pbar-time');
          if (el && !seeking) el.textContent = fmt(pos) + ' / ' + fmt(total);
        },
        onStatus: function (txt) {
          var bar = document.getElementById('player');
          if (!bar) return;
          var t = bar.querySelector('.pbar-title');
          if (t) t.textContent = txt || '';
        }
      });
    }
    return true;
  }
  function fmt(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function showBar(title) {
    var bar = document.getElementById('player');
    if (!bar) return;
    bar.hidden = false;
    var s0 = seekBar();
    if (s0) { s0.value = '0'; seekTotal = 0; }
    var t = bar.querySelector('.pbar-title');
    if (t) t.textContent = title || '';
  }
  function pauseBtn() {
    return function () {
      if (window.Player && window.Player.toggle) window.Player.toggle();
    };
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('.kb-play') : null;
    if (!btn) return;
    ev.preventDefault();

    var url = btn.getAttribute('data-midi');
    var id = btn.getAttribute('data-track') || '';
    var title = btn.getAttribute('data-name') || btn.getAttribute('aria-label') || id;
    if (!url) return;

    if (!engineReady()) {
      // 引擎没起来 —— 降级为「新窗口打开 MIDI」，不静默失败
      window.open(url, '_blank', 'noopener');
      return;
    }

    // 同一个按钮再点：播放中 → 暂停（图标回到 ▶）；暂停中 → 继续（图标变 ❚❚）
    if (btn === curBtn) {
      window.Player.toggle();
      return;
    }

    // 换另一首：先把上一首停掉，避免两个音叠在一起
    clearGlyphs();
    if (window.Player.isPlaying && window.Player.isPlaying()) window.Player.stop();

    curBtn = btn;
    btn.setAttribute('aria-pressed', 'true');   // → CSS 把图标切成暂停
    showBar(title);
    // player.js 只要求 { f, t, id, g, i }
    window.Player.play({ f: url, t: title, id: id });
  });

  /* 语言切换：先写偏好，再让链接自然跳转
     （中文页 head 里的检测脚本会读这个偏好，避免"切了中文又被自动跳回英文"）*/
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('[data-setlang]') : null;
    if (!a) return;
    try { localStorage.setItem('midicn-lang', a.getAttribute('data-setlang')); } catch (e) {}
  });

  /* 底部播放条按钮 */
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-pbar]') : null;
    if (!btn || !window.Player) return;
    var k = btn.getAttribute('data-pbar');
    if (k === 'toggle') {
      // 按钮文字由 onState 维护：播放中显示「暂停」，暂停时显示「播放」
      window.Player.toggle();
    } else if (k === 'stop') {
      window.Player.stop();
      curBtn = null;
      clearGlyphs();
      var bar = document.getElementById('player');
      if (bar) bar.hidden = true;
    }
  });

  /* ── audiolab 组件 ──────────────────────────────────────────────── */
  var LAB = {
    /* 音程：分别听两个音，再听和声音程 */
    interval: function (el, p) {
      var a = noteToMidi(p.a), b = noteToMidi(p.b);
      if (a == null || b == null) { el.textContent = 'audiolab 参数有误：需要 a/b 音名'; return; }
      el.innerHTML =
        '<div class="kb-lab-head">' +
        '<span class="kb-lab-label">' + esc(p.label || '听一听') + '</span>' +
        '<span class="kb-lab-hint">' + esc(p.hint || '先各自听，再听合起来') + '</span>' +
        '</div>' +
        '<div class="kb-lab-row">' +
        '<button type="button" class="kb-lab-btn" data-k="a">▶ ' + esc(p.a) + '</button>' +
        '<button type="button" class="kb-lab-btn" data-k="b">▶ ' + esc(p.b) + '</button>' +
        '<button type="button" class="kb-lab-btn kb-lab-on" data-k="both">▶ 合起来</button>' +
        '</div>' +
        '<div class="kb-lab-row"><span class="kb-lab-hint">' + esc(p.hint2 || '') + '</span></div>';
      el.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.kb-lab-btn');
        if (!btn) return;
        if (!resume()) return;
        var k = btn.getAttribute('data-k');
        if (k === 'a') softTone(midiToFreq(a), 0, 1.1, 0.22);
        else if (k === 'b') softTone(midiToFreq(b), 0, 1.1, 0.22);
        else { softTone(midiToFreq(a), 0, 1.5, 0.17); softTone(midiToFreq(b), 0, 1.5, 0.17); }
      });
    },

    /* 音阶：按音名序列逐音播放 */
    scale: function (el, p) {      var seq = (p.notes || []).map(noteToMidi);
      if (!seq.length || seq.some(function (x) { return x == null; })) {
        el.textContent = 'audiolab 参数有误：需要 notes 音名数组'; return;
      }
      var gap = p.gap || 0.32, dur = p.dur || 0.34;
      el.innerHTML =
        '<div class="kb-lab-head"><span class="kb-lab-label">' + esc(p.label || '音阶') + '</span>' +
        '<span class="kb-lab-hint">' + esc(p.hint || '上行 / 下行 / 只听构成音') + '</span></div>' +
        '<div class="kb-lab-row">' +
        '<button type="button" class="kb-lab-btn" data-k="up">▶ 上行</button>' +
        '<button type="button" class="kb-lab-btn" data-k="down">▶ 下行</button>' +
        '<button type="button" class="kb-lab-btn" data-k="chord">▶ 一起响</button>' +
        '</div>';
      el.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.kb-lab-btn'); if (!btn) return;
        if (!resume()) return;
        var k = btn.getAttribute('data-k'), i, list;
        if (k === 'up') { list = seq; for (i = 0; i < list.length; i++) softTone(midiToFreq(list[i]), i * gap, dur, 0.2); }
        else if (k === 'down') { list = seq.slice().reverse(); for (i = 0; i < list.length; i++) softTone(midiToFreq(list[i]), i * gap, dur, 0.2); }
        else { for (i = 0; i < seq.length; i++) softTone(midiToFreq(seq[i]), 0, 1.6, 0.11); }
      });
    },

    /* 和弦：根音 + 性质 + 转位（T4 用）*/
    chord: function (el, p) {
      var QUAL = {
        maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
        maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], hdim7: [0, 3, 6, 10]
      };
      var root = noteToMidi(p.root || 'C4');
      if (root == null) { el.textContent = 'chord 组件：root 音名有误'; return; }
      var q = QUAL[p.quality] || QUAL.maj;
      var inv = Math.max(0, Math.min(q.length - 1, parseInt(p.inversion || 0, 10) || 0));
      var notes = q.slice();
      for (var r = 0; r < inv; r++) { notes.push(notes.shift() + 12); }
      el.innerHTML =
        '<div class="kb-lab-head"><span class="kb-lab-label">' + esc(p.label || '和弦') + '</span>' +
        '<span class="kb-lab-hint">' + esc(p.hint || '整体听一声，再分解听构成音') + '</span></div>' +
        '<div class="kb-lab-row">' +
        '<button type="button" class="kb-lab-btn kb-lab-on" data-k="block">▶ 整体</button>' +
        '<button type="button" class="kb-lab-btn" data-k="arp">▶ 分解</button>' +
        '<button type="button" class="kb-lab-btn" data-k="open">▶ 宽排列</button>' +
        '</div>';
      el.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.kb-lab-btn'); if (!btn) return;
        if (!resume()) return;
        var k = btn.getAttribute('data-k'), i;
        if (k === 'block') {
          for (i = 0; i < notes.length; i++) softTone(midiToFreq(root + notes[i]), 0, 1.7, 0.15);
        } else if (k === 'arp') {
          for (i = 0; i < notes.length; i++) softTone(midiToFreq(root + notes[i]), i * 0.22, 0.8, 0.2);
        } else {
          for (i = 0; i < notes.length; i++) {
            var oct = i === 0 ? 0 : (i % 2 ? 12 : 0);
            softTone(midiToFreq(root + notes[i] + oct), 0, 1.8, 0.14);
          }
        }
      });
    },

    /* 和声进行：级数序列（T5 用）*/
    progression: function (el, p) {
      var DEG = {
        'I': [0, 4, 7], 'ii': [2, 5, 9], 'iii': [4, 7, 11], 'IV': [5, 9, 12],
        'V': [7, 11, 14], 'vi': [9, 12, 16], 'vii': [11, 14, 17],
        'i': [0, 3, 7], 'iv': [5, 8, 12], 'v': [7, 10, 14], 'VI': [8, 12, 15], 'VII': [10, 14, 17]
      };
      var seq = p.degrees || [];
      var root = noteToMidi(p.key || 'C4');
      if (!seq.length || root == null) {
        el.textContent = 'progression 组件：需要 key 与 degrees';
        return;
      }
      var beat = (p.beat || 0.9) * 1000;
      el.innerHTML =
        '<div class="kb-lab-head"><span class="kb-lab-label">' + esc(p.label || '和声进行') + '</span>' +
        '<span class="kb-lab-hint">' + esc(p.hint || '逐个和弦依次听，最后整体再听一遍') + '</span></div>' +
        '<div class="kb-lab-row">' +
        '<button type="button" class="kb-lab-btn kb-lab-on" data-k="play">▶ 依次播放</button>' +
        '<button type="button" class="kb-lab-btn" data-k="stop">■ 停止</button>' +
        '<span class="kb-lab-hint" data-now>—</span>' +
        '</div>';
      var timers = [];
      el.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.kb-lab-btn'); if (!btn) return;
        if (!resume()) return;
        var k = btn.getAttribute('data-k');
        if (k === 'stop') { timers.forEach(clearTimeout); timers = []; return; }
        timers.forEach(clearTimeout); timers = [];
        var now = el.querySelector('[data-now]');
        seq.forEach(function (d, idx) {
          timers.push(setTimeout(function () {
            var iv = DEG[d] || DEG['I'];
            for (var i = 0; i < iv.length; i++) {
              softTone(midiToFreq(root + iv[i]), 0, (p.beat || 0.9) * 0.95, 0.15);
            }
            if (now) now.textContent = d;
          }, idx * beat));
        });
        timers.push(setTimeout(function () { if (now) now.textContent = '—'; }, seq.length * beat));
      });
    },

    /* 节奏：拍号 + 节奏型（T7 用）—— 节拍器 + 拍点高亮 */
    rhythm: function (el, p) {
      var VAL = { h: 2, q: 1, e: 0.5, s: 0.25 };
      var sig = p.sig || '4/4';
      var parts = sig.split('/');
      var beats = parseInt(parts[0], 10) || 4;
      var unit = parseInt(parts[1], 10) || 4;
      var pat = String(p.pattern || 'q q q q').trim().split(/\s+/);
      var bpm = p.bpm || (unit === 8 ? 108 : 84);
      var spb = 60 / bpm;                       // 一拍秒数（以 unit 为分母）
      var dots = pat.map(function (t) {
        var v = VAL[t] || 1;
        return v * (unit === 8 ? 1 : 1);
      });
      el.innerHTML =
        '<div class="kb-lab-head"><span class="kb-lab-label">' + esc(p.label || '节奏') + '</span>' +
        '<span class="kb-lab-hint">' + esc(p.hint || '先听节拍器，再听节奏型') + '</span></div>' +
        '<div class="kb-lab-row">' +
        '<button type="button" class="kb-lab-btn kb-lab-on" data-k="click">▶ 节拍器</button>' +
        '<button type="button" class="kb-lab-btn" data-k="pat">▶ 节奏型</button>' +
        '<button type="button" class="kb-lab-btn" data-k="both">▶ 一起</button>' +
        '<button type="button" class="kb-lab-btn" data-k="stop">■ 停止</button>' +
        '</div>' +
        '<div class="kb-lab-row" data-dots>' +
        pat.map(function (t) { return '<span class="kb-dot">' + esc(t) + '</span>'; }).join('') +
        '</div>';
      var timers = [];
      function stopAll() { timers.forEach(clearTimeout); timers = []; }
      el.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.kb-lab-btn'); if (!btn) return;
        if (!resume()) return;
        var k = btn.getAttribute('data-k');
        stopAll();
        if (k === 'stop') return;
        var dotEls = el.querySelectorAll('[data-dots] .kb-dot');
        var t = 0;
        var total = dots.reduce(function (a, b) { return a + b; }, 0);
        var cycles = p.cycles || 2;
        var n = total * cycles;
        for (var i = 0; i < n; i++) {
          (function (i) {
            timers.push(setTimeout(function () {
              softTone(880, 0, 0.05, 0.12, 'square');
              var acc = (i % (total || 1)) === 0;
              if (acc) softTone(1320, 0, 0.06, 0.14, 'square');
              var j = dotEls[(i % (dots.length || 1))];
              if (j) {
                dotEls.forEach(function (d) { d.classList.remove('kb-dot-on'); });
                j.classList.add('kb-dot-on');
              }
            }, i * spb * (k === 'pat' ? 1 : 1) * 1000));
          })(i);
        }
        timers.push(setTimeout(function () {
          dotEls.forEach(function (d) { d.classList.remove('kb-dot-on'); });
        }, n * spb * 1000));
      });
    },

    /* 五度圈：十二个调按五度关系排成一圈，点哪个听哪个（T5 / T9 用）*/
    circle: function (el, p) {
      var RING = [
        ['C', '无升降'], ['G', '1♯'], ['D', '2♯'], ['A', '3♯'], ['E', '4♯'], ['B', '5♯'],
        ['F♯ / G♭', '6♯ / 6♭'], ['D♭', '5♭'], ['A♭', '4♭'], ['E♭', '3♭'], ['B♭', '2♭'], ['F', '1♭']
      ];
      var TONIC = { 'C': 60, 'G': 55, 'D': 62, 'A': 57, 'E': 64, 'B': 59,
                    'F♯ / G♭': 54, 'D♭': 61, 'A♭': 56, 'E♭': 63, 'B♭': 58, 'F': 53 };
      var cx = 150, cy = 150, r1 = 128, r0 = 86;
      function pt(r, deg) {
        var a = (deg - 90) * Math.PI / 180;
        return [(cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1)];
      }
      var seg = '';
      for (var i = 0; i < 12; i++) {
        var a0 = i * 30, a1 = a0 + 30, large = 0;
        var d = 'M' + pt(r1, a0) + ' A' + r1 + ',' + r1 + ' 0 ' + large + ' 1 ' + pt(r1, a1) +
                ' L' + pt(r0, a1) + ' A' + r0 + ',' + r0 + ' 0 ' + large + ' 0 ' + pt(r0, a0) + ' Z';
        var mid = a0 + 15, lp = pt((r1 + r0) / 2, mid).split(',');
        seg += '<g class="kb-cseg" data-i="' + i + '" role="button" tabindex="0" ' +
               'aria-label="' + esc(RING[i][0]) + '">' +
               '<path d="' + d + '" fill="var(--ink-2)" stroke="var(--rule)"/>' +
               '<text x="' + lp[0] + '" y="' + lp[1] + '" text-anchor="middle" ' +
               'font-family="Georgia,serif" font-size="12" fill="currentColor">' + esc(RING[i][0]) + '</text>' +
               '</g>';
      }
      el.innerHTML =
        '<div class="kb-lab-head"><span class="kb-lab-label">' + esc(p.label || '五度圈') + '</span>' +
        '<span class="kb-lab-hint">' + esc(p.hint || '点任意一格，听这个调的主三和弦') + '</span></div>' +
        '<div class="kb-lab-row kb-circle-row">' +
        '<svg class="kb-circle" viewBox="0 0 300 300" role="img" aria-label="' + esc(p.label || '五度圈') + '">' +
        seg + '<circle cx="150" cy="150" r="60" fill="none" stroke="var(--rule)"/>' +
        '<text x="150" y="146" text-anchor="middle" class="kb-circle-now" font-size="15">—</text>' +
        '<text x="150" y="168" text-anchor="middle" font-size="11" opacity=".6">—</text></svg>' +
        '<span class="kb-lab-hint">相邻两格 = 纯五度；顺时针 = 升号增加，逆时针 = 降号增加</span>' +
        '</div>';
      el.addEventListener('click', function (ev) {
        var g = ev.target.closest ? ev.target.closest('.kb-cseg') : null;
        if (!g) return;
        if (!resume()) return;
        var i = parseInt(g.getAttribute('data-i'), 10) || 0;
        var key = RING[i][0], tonic = TONIC[key] || 60;
        [0, 4, 7].forEach(function (iv, k) {
          softTone(midiToFreq(tonic + iv), k * 0.04, 1.5, 0.17);
        });
        var txt = el.querySelectorAll('.kb-circle-now');
        if (txt[0]) txt[0].textContent = key;
        if (txt[1]) txt[1].textContent = RING[i][1];
        var all = el.querySelectorAll('.kb-cseg path');
        for (var m = 0; m < all.length; m++) all[m].setAttribute('fill', 'var(--ink-2)');
        g.querySelector('path').setAttribute('fill', 'var(--accent)');
      });
    }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mountLabs() {
    document.querySelectorAll('.kb-lab[data-lab]').forEach(function (el) {
      var name = el.getAttribute('data-lab');
      var fn = LAB[name];
      if (!fn) { el.textContent = '未注册的 audiolab 组件：' + name; return; }
      var params = {};
      try { params = JSON.parse(el.getAttribute('data-params') || '{}'); } catch (e) {}
      try { fn(el, params); } catch (e) { el.textContent = 'audiolab 渲染失败：' + e.message; }
    });
  }

  /* ── 页内目录（APP 化）──────────────────────────────────────────────
     按正文 h2 自动生成；**不依赖音频引擎**；少于 3 个 h2 就不生成。
     · 宽屏（≥1400px）：右侧常驻栏，summary 由 CSS 隐藏，恒展开
     · 窄屏／手机：收在「本页目录」折叠块里，默认收起，省版面 —— 见总纲 §7.7 */
  function buildToc() {
    var main = document.querySelector('main.doc-article');
    if (!main || main.querySelector('.kb-aside')) return;
    var hs = main.querySelectorAll('.kb-body h2[id]');
    if (hs.length < 3) return;
    var L = (window.__KB__ && window.__KB__.lbl) || {};
    var title = L.toc || '本页目录';
    var items = [];
    for (var i = 0; i < hs.length; i++) {
      var t = (hs[i].textContent || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (t) items.push('<a href="#' + hs[i].id + '">' + esc(t) + '</a>');
    }
    if (items.length < 3) return;

    var wide = false;
    try { wide = window.matchMedia('(min-width:1400px)').matches; } catch (e) {}
    var aside = document.createElement('aside');
    aside.className = 'kb-aside';
    aside.innerHTML = '<details class="kb-tocbox"' + (wide ? ' open' : '') + '>' +
      '<summary>' + esc(title) + '</summary>' +
      '<nav class="kb-toc" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' +
      items.join('') + '</nav></details>';
    main.appendChild(aside);

    // 点目录项后：窄屏自动收起折叠块，让目标内容直接可见（APP 手感）
    aside.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('.kb-toc a') : null;
      if (!a) return;
      var d = aside.querySelector('details');
      if (d && !window.matchMedia('(min-width:1400px)').matches) d.open = false;
    });
  }

  /* ── 播放条进度：拖动跳转（APP 手感，桌面也能用）──────────────────── */
  var seekEl = null, seeking = false, seekTotal = 0;
  function seekBar() {
    if (!seekEl) seekEl = document.querySelector('.pbar-seek');
    return seekEl;
  }
  function bindSeek() {
    var s = seekBar();
    if (!s || s.__kbBound) return;
    s.__kbBound = true;
    s.addEventListener('pointerdown', function () { seeking = true; });
    s.addEventListener('pointerup', function () { seeking = false; });
    s.addEventListener('pointercancel', function () { seeking = false; });
    s.addEventListener('change', function () {
      seeking = false;
      if (window.Player && window.Player.seek) window.Player.seek(Number(s.value) || 0);
    });
    s.addEventListener('input', function () {
      var bar = document.getElementById('player');
      var el = bar && bar.querySelector('.pbar-time');
      if (el && seekTotal > 0) el.textContent = fmt(Number(s.value)) + ' / ' + fmt(seekTotal);
    });
  }

  /* ── 顶栏滚动收纳：下滚隐藏、上滚出现（窄屏专属，见总纲 §7.7）──────── */
  function bindHeaderCollapse() {
    var hdr = document.querySelector('header');
    if (!hdr || hdr.__kbBound) return;
    hdr.__kbBound = true;
    var last = window.pageYOffset || 0, ticking = false;
    function run() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      if (y > last + 8 && y > 120) hdr.classList.add('is-hidden');
      else if (y < last - 8) hdr.classList.remove('is-hidden');
      last = y; ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      try { window.requestAnimationFrame(run); } catch (e) { run(); }
    }, { passive: true });
  }

  function boot() { mountLabs(); buildToc(); bindSeek(); bindHeaderCollapse(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
