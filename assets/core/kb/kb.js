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
  var MIDI_NAMES = ['C', 'C\u266f', 'D', 'D\u266f', 'E', 'F', 'F\u266f',
                    'G', 'G\u266f', 'A', 'A\u266f', 'B'];
  function midiName(mi) { return MIDI_NAMES[mi % 12] + (Math.floor(mi / 12) - 1); }

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
      /* 和弦性质表（半音偏移，从根音起）。
         ⚠️ 新增性质只改这一张表；**用错名字不会报错，会静默回退成大三和弦** ——
         故构建校验会检查 `quality` 是否在这张表里（防"演示与正文不符"）。 */
      var QUAL = {
        maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
        sus2: [0, 2, 7], sus4: [0, 5, 7],
        six: [0, 4, 7, 9], m6: [0, 3, 7, 9],
        add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
        maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10],
        hdim7: [0, 3, 6, 10], dim7: [0, 3, 6, 9],
        dom9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], min9: [0, 3, 7, 10, 14],
        dom11: [0, 4, 7, 10, 14, 17], dom13: [0, 4, 7, 10, 14, 17, 21]
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
      /* 时值表（单位：拍）。⚠️ 未知记号会**静默按 1 拍（四分音符）处理** ——
         所以构建校验会按这张表检查 pattern 的每个记号（同 chord.quality 的做法）。 */
      var VAL = { h: 2, q: 1, e: 0.5, s: 0.25, t: 0.3333, T: 0.6667 };
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
    },

    /* 乐器音色试听（M4 乐器站）—— 四级降级，见上方基础设施的说明
       参数
         gm     1–128 或 GM 名字（如 'Violin' / 41）→ L1 在旋律通道上换音色
         drum   GM 打击通道的键号（35 底鼓 / 38 军鼓 / 42 闭镲 …）→ L1 走打击通道
                ⚠️ 与 gm 互斥（两个都给 → 构建门禁会拦，避免"哪个生效"说不清）
         synth  L2 的音色模型名（bowed / plucked / struck / blown / reed / brass /
                vocal / metal / perc）
         phrase 演示短句：音名数组（如 ['G4','D5','A5']）；drum 模式下写键号（['36','38']）
         label / label_en · hint / hint_en
       两级都不可用时（无 Web Audio / 引擎失败）→ 按钮留在原地并写明原因，不静默。   */
    instrument: function (el, p) {
      var prog = gmProgram(p.gm);
      var drum = (p.drum === null || p.drum === undefined || String(p.drum).trim() === '')
        ? null : parseInt(p.drum, 10);
      var isDrum = (prog === null && drum !== null && !isNaN(drum));
      var raw = (p.phrase && p.phrase.length) ? p.phrase
        : (isDrum ? ['36', '38', '42'] : ['C4', 'G4', 'C5']);
      var seq = raw.map(function (x) { return isDrum ? parseInt(x, 10) : noteToMidi(x); });
      if (!seq.length || seq.some(function (x) { return x === null || isNaN(x); })) {
        el.textContent = 'instrument 组件：phrase 音名/键号有误';
        return;
      }
      var model = MODELS[p.synth] ? p.synth : 'bowed';   /* 未知模型由构建门禁拦 */
      var hasL1 = (prog !== null) || isDrum;
      var timers = [];
      var T = {
        gm: '▶ 真实音色', syn: '▶ 合成近似', stop: '■ 停止',
        first: '首次载入约 28 MB（之后离线可用）', ready: '就绪',
        noaudio: '本机不支持 Web Audio，无法试听'
      };
      if (window.__KB__ && window.__KB__.lang === 'en') {
        T = {
          gm: '▶ Real timbre', syn: '▶ Synth approximation', stop: '■ Stop',
          first: 'first load ≈ 28 MB, cached afterwards', ready: 'ready',
          noaudio: 'Web Audio is unavailable in this browser'
        };
      }
      el.innerHTML =
        '<div class="kb-lab-head">' +
        '<span class="kb-lab-label">' + esc(p.label || '音色试听') + '</span>' +
        '<span class="kb-lab-hint">' + esc(p.hint || (isDrum
          ? '先听合成近似，再听 GM 打击采样' : '先听合成近似，再听 GM 采样音色')) + '</span>' +
        '</div>' +
        '<div class="kb-lab-row">' +
        (hasL1 ? '<button type="button" class="kb-lab-btn" data-k="gm">' + esc(T.gm) + '</button>' : '') +
        '<button type="button" class="kb-lab-btn kb-lab-on" data-k="syn">' + esc(T.syn) + '</button>' +
        '<button type="button" class="kb-lab-btn" data-k="stop">' + esc(T.stop) + '</button>' +
        '<span class="kb-lab-hint kb-lab-state" data-state>' +
        (hasL1 ? esc(T.first) : esc(T.ready)) + '</span>' +
        '</div>' +
        '<div class="kb-lab-row"><span class="kb-lab-hint" data-keys>' +
        esc(raw.join(' · ')) + '</span></div>';

      var state = el.querySelector('[data-state]');
      function say(t) { if (state) state.textContent = t; }
      function clearTimers() { timers.forEach(clearTimeout); timers = []; }

      function playSynth() {
        killAll(); clearTimers();
        var a = resume();
        if (!a) { say(T.noaudio); return; }
        var t0 = a.currentTime + .05;
        seq.forEach(function (n, i) {
          var f = isDrum ? 2600 * Math.pow(2, (n - 38) / 12) : midiToFreq(n);
          voice(model, f, t0 + i * .42, .62, .62);
        });
        say(T.syn.replace('▶ ', '') + ' · ' + model);
      }

      function playGM() {
        clearTimers();
        say('…');
        sfLoad(function (what, f, done) {
          say(done ? (what + ' · 已缓存') : (what + ' ' + Math.round(f * 100) + '%'));
        }).then(function () {
          killAll();
          var ch = isDrum ? 9 : 0;                 /* 通道 9（0 起算）= GM 打击通道 */
          if (prog !== null) SFX.synth.midiProgramChange(ch, prog);
          var t = 0;
          seq.forEach(function (n) {
            var key = Math.max(0, Math.min(127, n));
            timers.push(setTimeout(function () {
              SFX.synth.midiNoteOn(ch, key, 100);
              timers.push(setTimeout(function () {
                try { SFX.synth.midiNoteOff(ch, key); } catch (e) {}
              }, 640));
            }, t));
            t += 430;
          });
          say((isDrum ? 'GM 打击采样' : 'GM ' + (p.gm || '') + ' 采样')
            + ' · ' + seq.map(function (n) { return isDrum ? n : midiName(n); }).join(' '));
        })['catch'](function (e) {
          var msg = (e && e.message) || String(e);
          say('采样音色不可用（' + msg + '）—— 已用合成近似代替');
          if (window.console && console.warn) console.warn('[kb] soundfont: ' + msg);
          playSynth();
        });
      }

      el.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.kb-lab-btn');
        if (!btn) return;
        var k = btn.getAttribute('data-k');
        if (k === 'stop') {
          clearTimers(); killAll();
          el.querySelectorAll('.kb-lab-btn').forEach(function (b) { b.classList.remove('kb-lab-on'); });
          say(T.ready);
          return;
        }
        el.querySelectorAll('.kb-lab-btn').forEach(function (b) {
          if (b !== btn) b.classList.remove('kb-lab-on');
        });
        if (k === 'gm') playGM(); else if (k === 'syn') playSynth();
      });
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     乐器音色试听的基础设施（M4 乐器站）—— 四级降级，见 plans/M4-instrument.md §4.2

       L1  GM 采样音色：lib 站托管的 GeneralUser GS，**首次点击才加载**（约 28 MB），
           载入后写 Cache API → 之后离线秒开。失败**自动降级到 L2 并说明原因**。
       L2  Web Audio 实时合成：零素材，九类音色模型，任何乐器都有声音。
       L3  库中真实曲目：由 front-matter 的 `instances` 渲染，不在本组件内。
       L4  只有文字与谱例：不写这个围栏。

     ⚠️ 红线：只用 lib 站托管的 soundfont + 本机实时合成 —— **不嵌任何外部播放器**。
     ⚠️ 采样库为什么从 lib 站取：该站已按作者许可**自备本地副本**（作者明确要求
        「要放在自己网站上，请提供自己的本地副本」，不允许热链他的下载）。
     ══════════════════════════════════════════════════════════════════════ */
  var LIB_SF = 'https://lib.midicn.com/soundfont/';
  var SF_GZ = LIB_SF + 'GeneralUser-GS.sf2.gz';
  var SF_RAW = LIB_SF + 'GeneralUser-GS.sf2';
  var SF_ENG = LIB_SF + 'engine/';
  var SF_CACHE = 'midicn-gm-sf-v1';

  /* ── 音色模型表（L2）—— 单一真源 ────────────────────────────────────
     ⚠️ 参数里的 `synth` 写错名字会**静默回退成 bowed**（演示与正文不符，页面看不出来），
        所以构建门禁按这张表的键校验（同 chord.quality / rhythm 的教训）。
     字段 · osc 主波形（'noise' = 噪声源）
            at 起音秒数 · dec 衰减到 sus 的秒数 · sus 保持电平
            lp/q 低通截止与谐振 · det 双振荡器失谐（音分）· vib 揉弦速率
            nz 起音噪声量 · o2/o3 + a2/a3 附加分音（倍率与电平）
            f1/f2/af 共振峰（人声元音感）                                        */
  var MODELS = {
    bowed:   { osc: 'sawtooth', at: .10, dec: 2.4, sus: .70, lp: 2700, q: 1.1, det: 8, vib: 5.3, nz: .02 },
    plucked: { osc: 'triangle', at: .006, dec: 1.5, sus: .10, lp: 3400, q: 1.4, det: 0, vib: 0, nz: .10, o2: 2, a2: .16 },
    struck:  { osc: 'sine', at: .004, dec: 2.2, sus: .06, lp: 5000, q: .9, det: 0, vib: 0, nz: .05, o2: 2, a2: .30, o3: 3, a3: .14 },
    blown:   { osc: 'triangle', at: .05, dec: 1.2, sus: .58, lp: 4200, q: 1.0, det: 0, vib: 4.6, nz: .14 },
    reed:    { osc: 'square', at: .035, dec: 1.1, sus: .62, lp: 2200, q: 3.2, det: 0, vib: 0, nz: .08, o2: 3, a2: .10 },
    brass:   { osc: 'sawtooth', at: .06, dec: 1.4, sus: .66, lp: 1800, q: 1.6, det: 5, vib: 0, nz: .04 },
    vocal:   { osc: 'sawtooth', at: .07, dec: 1.6, sus: .68, lp: 5200, q: .8, det: 0, vib: 5.8, nz: .03, f1: 760, f2: 1180, af: .40 },
    metal:   { osc: 'sine', at: .003, dec: 3.4, sus: .05, lp: 9000, q: .7, det: 0, vib: 0, nz: .02, o2: 2.76, a2: .50, o3: 5.4, a3: .25 },
    perc:    { osc: 'noise', at: .002, dec: .22, sus: 0, lp: 6000, q: 2.4, det: 0, vib: 0, nz: 1 }
  };

  /* ── GM 音色表（128 项 · 通用 MIDI 一级标准）──────────────────────────
     `gm` 参数可以写**序号**（1–128）或**名字**。做成两种写法是为了免掉差一错：
     GM 编号在人读的列表里从 1 起算，而 MIDI 的 program change 值是 0 起算 ——
     名字由这张表统一翻译，参数与代码之间只有**一处**对应关系。               */
  var GM_NAMES = [
    'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
    'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
    'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
    'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
    'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
    'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
    'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
    'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
    'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
    'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
    'Violin', 'Viola', 'Cello', 'Contrabass',
    'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
    'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
    'Choir Aahs', 'Voice Oohs', 'Synth Choir', 'Orchestra Hit',
    'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
    'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
    'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
    'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
    'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
    'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
    'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
    'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
    'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
    'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
    'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
    'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
    'Sitar', 'Banjo', 'Shamisen', 'Koto',
    'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
    'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
    'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
    'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
    'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
  ];

  function gmProgram(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    var s = String(v).trim(), n = parseInt(s, 10);
    if (/^\d+$/.test(s)) return (n >= 1 && n <= 128) ? n - 1 : null;
    for (var i = 0; i < GM_NAMES.length; i++) {
      if (GM_NAMES[i].toLowerCase() === s.toLowerCase()) return i;
    }
    return null;
  }

  /* ── 脚本注入（幂等；引擎只有 33 KB）────────────────────────────── */
  var sfScripts = {};
  function loadScript(url) {
    if (sfScripts[url]) return sfScripts[url];
    sfScripts[url] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { res(true); };
      s.onerror = function () { rej(new Error('引擎脚本加载失败')); };
      document.head.appendChild(s);
    });
    return sfScripts[url];
  }

  /* ── 带进度的取字节（首次 28 MB，用户有权知道走到哪了）────────── */
  function fetchProgress(url, onp) {
    return fetch(url, { cache: 'force-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var total = Number(res.headers.get('content-length') || 0);
      if (!res.body || !res.body.getReader) {
        return res.arrayBuffer().then(function (b) { return b; });
      }
      var rd = res.body.getReader(), parts = [], got = 0;
      function step() {
        return rd.read().then(function (it) {
          if (it.done) {
            var out = new Uint8Array(got), off = 0;
            for (var i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
            return out.buffer;
          }
          parts.push(it.value); got += it.value.length;
          if (onp) onp(total ? got / total : 0);
          return step();
        });
      }
      return step();
    });
  }

  /* 该 .gz 以 application/gzip 提供（不是 Content-Encoding）→ 必须手动解压 */
  function gunzipIfNeeded(buf) {
    var h = new Uint8Array(buf, 0, 2);
    if (h[0] !== 0x1f || h[1] !== 0x8b) return Promise.resolve(buf);
    if (typeof DecompressionStream === 'undefined') return Promise.resolve(null);
    var ds = new DecompressionStream('gzip');
    return new Response(new Blob([buf]).stream().pipeThrough(ds))
      .arrayBuffer().then(function (b) { return b; });
  }

  function cacheGet(key) {
    if (!('caches' in window)) return Promise.resolve(null);
    try {
      return caches.open(SF_CACHE).then(function (c) { return c.match(key); })
        .then(function (r) { return r ? r.arrayBuffer() : null; })
        ['catch'](function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function cachePut(key, buf) {
    if (!('caches' in window)) return;
    try {
      caches.open(SF_CACHE).then(function (c) {
        c.put(key, new Response(buf.slice(0),
          { headers: { 'Content-Type': 'application/octet-stream' } }));
      })['catch'](function () {});
    } catch (e) {}
  }

  /* ── L1 引擎单例（一次加载，全站复用；失败记原因，不静默）───────── */
  var SFX = { AC: null, node: null, synth: null, ready: false, loading: null, failed: '', gain: .9 };

  function sfLoadOnce(onp) {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return Promise.reject(new Error('浏览器不支持 Web Audio'));
    if (!SFX.AC || SFX.AC.state === 'closed') SFX.AC = new Ctor();
    var AC = SFX.AC;
    if (!AC.audioWorklet) return Promise.reject(new Error('AudioWorklet 不可用'));
    if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
    if (onp) onp('引擎', 0, false);
    return loadScript(SF_ENG + 'js-synthesizer.min.js').then(function () {
      if (!window.JSSynth) throw new Error('合成器脚本未就绪');
      return AC.audioWorklet.addModule(SF_ENG + 'libfluidsynth-2.3.0.js');
    }).then(function () {
      return AC.audioWorklet.addModule(SF_ENG + 'js-synthesizer.worklet.min.js');
    }).then(function () {
      var s = new window.JSSynth.AudioWorkletNodeSynthesizer();
      s.init(AC.sampleRate);
      var node = s.createAudioNode(AC);
      node.connect(AC.destination);          /* 直连输出：不经任何效果链，保真优先 */
      SFX.synth = s; SFX.node = node;
      return cacheGet(SF_GZ);
    }).then(function (cached) {
      if (cached) {
        if (onp) onp('采样库', 1, true);
        return cached;
      }
      return fetchProgress(SF_GZ, function (f) { if (onp) onp('采样库', f, false); })
        .then(function (raw) {
          return gunzipIfNeeded(raw).then(function (d) {
            if (d) { cachePut(SF_GZ, raw); return d; }
            /* 无 DecompressionStream → 换裸 .sf2（多 4 MB） */
            return fetchProgress(SF_RAW, function (f) { if (onp) onp('采样库', f, false); });
          });
        });
    }).then(function (buf) {
      return SFX.synth.loadSFont(buf);
    }).then(function () {
      try { SFX.synth.setInterpolation(4); } catch (e) {}
      try { SFX.synth.setGain(SFX.gain); } catch (e) {}
      SFX.ready = true; SFX.failed = '';
      return true;
    });
  }

  function sfLoad(onp) {
    if (SFX.ready) return Promise.resolve(true);
    if (SFX.loading) return SFX.loading;              /* 并发点击复用同一次加载 */
    SFX.loading = sfLoadOnce(onp)['catch'](function (e) {
      SFX.failed = (e && e.message) || String(e);
      SFX.ready = false;
      throw e;
    });
    var p = SFX.loading;
    p.then(function () { SFX.loading = null; }, function () { SFX.loading = null; });
    return p;
  }

  /* ── L2 音色模型 → 一个音（Web Audio 实时合成，零素材）────────── */
  var liveNodes = [];
  function killAll() {
    for (var i = 0; i < liveNodes.length; i++) {
      try { liveNodes[i].stop(0); } catch (e) {}
      try { liveNodes[i].disconnect(); } catch (e) {}
    }
    liveNodes = [];
    if (SFX.ready && SFX.synth) {
      try { SFX.synth.midiAllNotesOff(); } catch (e) {}
    }
  }

  function voice(name, freq, t0, dur, vel) {
    var a = ac(); if (!a) return;
    /* ⚠️ 未知模型静默按 bowed 处理 —— 所以构建门禁会校验 `synth`（同 chord.quality） */
    var M = MODELS[name] || MODELS.bowed;
    var peak = Math.max(.03, Math.min(.9, vel == null ? .6 : vel)) * .26;
    var at = M.at, dec = M.dec, sus = (M.sus == null ? .2 : M.sus);
    var t1 = t0 + at, t2 = t1 + dec;
    var t3 = t0 + Math.max(at + .05, dur);
    var rel = Math.max(.06, Math.min(.5, dur * .3));
    var stop = t3 + rel + .06;

    var g = a.createGain();
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t1);
    if (t2 < t3) {
      g.gain.exponentialRampToValueAtTime(Math.max(.0001, peak * sus), t2);
      g.gain.setValueAtTime(Math.max(.0001, peak * sus), t3);
    } else {
      var fall = Math.pow(.5, (t3 - t1) / Math.max(.02, dec));
      g.gain.exponentialRampToValueAtTime(Math.max(.0001, peak * Math.max(sus, fall)), t3);
    }
    g.gain.exponentialRampToValueAtTime(.0001, t3 + rel);
    g.connect(a.destination);

    var lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = M.lp || 4000;
    lp.Q.value = (M.q == null ? .7 : M.q);
    var pre = a.createGain(); pre.gain.value = 1;
    pre.connect(lp); lp.connect(g);

    if (M.f1) {                       /* 共振峰：人声的"元音"感 */
      [M.f1, M.f2].forEach(function (f, k) {
        if (!f) return;
        var bp = a.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4 + k * 2;
        var bg = a.createGain(); bg.gain.value = (M.af == null ? .4 : M.af) * (k ? 1 : 1.3);
        pre.connect(bp); bp.connect(bg); bg.connect(g);
      });
    }

    function osc(type, f, cents, lvl) {
      var o = a.createOscillator(); o.type = type; o.frequency.value = f;
      if (cents) o.detune.value = cents;
      var og = a.createGain(); og.gain.value = lvl;
      o.connect(og); og.connect(pre);
      o.start(t0); o.stop(stop);
      if (M.vib) {                    /* 揉弦 */
        var lfo = a.createOscillator(), lg = a.createGain();
        lfo.type = 'sine'; lfo.frequency.value = M.vib; lg.gain.value = 7;
        lfo.connect(lg); lg.connect(o.detune);
        lfo.start(t0); lfo.stop(stop);
        liveNodes.push(lfo);
      }
      liveNodes.push(o);
      return o;
    }

    function noise(lvl, dur2, bandHz) {
      var len = Math.max(1, Math.ceil(a.sampleRate * dur2));
      var b = a.createBuffer(1, len, a.sampleRate);
      var d = b.getChannelData(0), seed = 16807;
      for (var i = 0; i < len; i++) {
        seed = (seed * 16807) % 2147483647;        /* 确定性伪随机：同一参数结果可复现 */
        d[i] = (seed / 2147483647) * 2 - 1;
      }
      var ns = a.createBufferSource(); ns.buffer = b;
      var ng = a.createGain(); ng.gain.value = lvl;
      if (bandHz) {
        var bp = a.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = bandHz; bp.Q.value = 2.2;
        ns.connect(bp); bp.connect(ng);
      } else { ns.connect(ng); }
      ng.connect(pre);
      ns.start(t0); ns.stop(stop);
      liveNodes.push(ns);
      return ns;
    }

    if (M.osc === 'noise') {
      noise(1, stop - t0, Math.min(9000, Math.max(200, freq * 2.2)));
    } else {
      var lvl = M.det ? .5 : .9;
      osc(M.osc, freq, 0, lvl);
      if (M.det) osc(M.osc, freq, M.det, lvl);
      if (M.o2) osc(M.osc === 'sine' ? 'sine' : M.osc, freq * M.o2, 0, (M.a2 || .2) * .9);
      if (M.o3) osc('sine', freq * M.o3, 0, (M.a3 || .1) * .9);
      if (M.nz) noise(M.nz * .5, Math.min(.18, stop - t0), 4200);
    }
  }

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
