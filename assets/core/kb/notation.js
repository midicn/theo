/* ═══════════════════════════════════════════════════════════════════════
   midicn 内核 · kb/assets/notation.js
   极简五线谱渲染器 —— 把音名序列画成内联 SVG

   为什么自研：第三方乐谱库（VexFlow 等）体积数百 KB 且需外链字体/CDN，
   而知识站只需要「单行谱表上的几个音」这一种用法。自研版 ~6KB，零依赖、零字体、
   离线可用，且 SVG 是内联的（可被 CSS 主题控制颜色）。

   用法（前端）：
     <div data-notation='{"clef":"treble","notes":["C4","E4","G4"]}'></div>
     <div data-notation='{"clef":"treble","notes":["C4:q","E4:q","G4:w"]}'></div>
     <div data-notation='{"clef":"treble","notes":[["C4","E4","G4"]]}'></div>   ← 和弦

   音名语法：  <音名><升/降><八度>[:时值]      如 C4 · F#5 · Bb3 · G4:h
   时值：      w 全音符 · h 二分 · q 四分(默认) · e 八分
   谱号：      treble（高音，默认）· bass（低音）
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  // 高音谱号下，五条线自下而上为 E4 G4 B4 D5 F5 → 音级序号 30 32 34 36 38
  var TREBLE_BASE = 30;
  // 低音谱号下，五条线自下而上为 G2 B2 D3 F3 A3 → 音级序号 18 20 22 24 26
  var BASS_BASE = 18;

  function parseNote(s) {
    s = String(s).trim();
    var parts = s.split(':');
    var name = parts[0];
    var dur = (parts[1] || 'q').toLowerCase().charAt(0);
    var m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
    if (!m) return null;
    var letter = m[1].toUpperCase();
    var acc = m[2];
    var oct = parseInt(m[3], 10);
    var step = oct * 7 + STEP[letter];
    var semis = step + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
    return { step: step, acc: acc, dur: dur, midi: 12 * (oct + 1) + STEP[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0), _song: semis };
  }

  var SP = 9;          // 线间距
  var HALF = SP / 2;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render(cfg) {
    var clef = (cfg.clef || 'treble').toLowerCase();
    var base = clef === 'bass' ? BASS_BASE : TREBLE_BASE;
    var raw = cfg.notes || [];
    var items = raw.map(function (n) {
      if (Object.prototype.toString.call(n) === '[object Array]') {
        var ns = n.map(parseNote).filter(Boolean);
        return ns.length ? { chord: ns, dur: ns[0].dur } : null;
      }
      var p = parseNote(n);
      return p ? { chord: [p], dur: p.dur } : null;
    }).filter(Boolean);
    if (!items.length) return '<svg viewBox="0 0 200 100" width="100%" role="img" aria-label="空谱例"></svg>';

    var padL = 46, padR = 16, padT = 26, padB = 20;
    var x0 = padL, gap = cfg.gap || 46;

    // 竖向范围（含加线）
    var lo = base, hi = base;
    items.forEach(function (it) {
      it.chord.forEach(function (n) {
        lo = Math.min(lo, n.step); hi = Math.max(hi, n.step);
      });
    });
    lo = Math.min(lo, base - 2); hi = Math.max(hi, base + 10);
    var top = base + 10;                                  // 最上线 = F5(A3)
    var yOf = function (step) { return padT + (top - step) * HALF; };
    var yBottom = yOf(base), yTop = yOf(top);

    var W = padL + items.length * gap + padR;
    var H = padT + 4 * SP + padB + (Math.max(0, base - lo) ? (base - lo) * HALF : 0)
            + (Math.max(0, hi - (base + 10)) ? (hi - base - 10) * HALF : 0);
    var dy = Math.max(0, base - lo) * HALF;               // 因加线整体下移
    if (dy) padT += 0;
    var yOfF = function (step) { return yOf(step) + dy; };

    var s = [];
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="'
      + esc(cfg.label || '五线谱谱例') + '">');

    // 五条线
    var lineY0 = yOfF(base), lineY1 = yOfF(base + 8);
    for (var i = 0; i < 5; i++) {
      var y = lineY0 - i * SP;
      s.push('<line x1="' + x0 + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y
        + '" stroke="currentColor" stroke-width="0.7" opacity=".38"/>');
    }
    // 谱号（用文字符号，不依赖乐谱字体：𝄞 / 𝄢 在多数系统不可靠 → 用简笔路径替代）
    s.push('<g fill="currentColor" opacity=".8">');
    if (clef === 'bass') {
      s.push('<text x="' + (x0 - 22) + '" y="' + (yOfF(base + 4) + 5)
        + '" font-family="Georgia,serif" font-size="26">𝄢</text>');
    } else {
      s.push('<text x="' + (x0 - 24) + '" y="' + (yOfF(base + 4) + 6)
        + '" font-family="Georgia,serif" font-size="30">𝄞</text>');
    }
    s.push('</g>');

    // 音符
    items.forEach(function (it, idx) {
      var cx = x0 + 32 + idx * gap;
      var xs = it.chord.map(function (n) { return yOfF(n.step); });
      var hollow = it.dur === 'w' || it.dur === 'h';
      var stem = it.dur !== 'w';
      var stemUp = xs[0] > yOfF(base + 4);                 // 低于中线 → 符干朝上
      var rx = 5.2, ry = 3.9;

      // 加线
      it.chord.forEach(function (n) {
        var st = n.step;
        if (st < base) {
          for (var k = base - 2; k >= st; k -= 2) {
            var yy = yOfF(k);
            s.push('<line x1="' + (cx - 10) + '" y1="' + yy + '" x2="' + (cx + 10) + '" y2="' + yy
              + '" stroke="currentColor" stroke-width="0.7" opacity=".38"/>');
          }
        } else if (st > base + 8) {
          for (var k2 = base + 10; k2 <= st; k2 += 2) {
            var yy2 = yOfF(k2);
            s.push('<line x1="' + (cx - 10) + '" y1="' + yy2 + '" x2="' + (cx + 10) + '" y2="' + yy2
              + '" stroke="currentColor" stroke-width="0.7" opacity=".38"/>');
          }
        }
      });

      // 变音记号
      it.chord.forEach(function (n) {
        if (!n.acc) return;
        s.push('<text x="' + (cx - 18) + '" y="' + (yOfF(n.step) + 4)
          + '" font-family="Georgia,serif" font-size="13" fill="currentColor" opacity=".85">'
          + (n.acc === '#' ? '♯' : '♭') + '</text>');
      });

      // 符头
      it.chord.forEach(function (n) {
        s.push('<ellipse cx="' + cx + '" cy="' + yOfF(n.step) + '" rx="' + rx + '" ry="' + ry
          + '" transform="rotate(-18 ' + cx + ' ' + yOfF(n.step) + ')" fill="'
          + (hollow ? 'none' : 'currentColor') + '" stroke="currentColor" stroke-width="1.3"/>');
      });

      // 符干
      if (stem) {
        var topY = Math.min.apply(null, xs), botY = Math.max.apply(null, xs);
        if (stemUp) s.push('<line x1="' + (cx + rx - 0.6) + '" y1="' + (botY - 1) + '" x2="'
          + (cx + rx - 0.6) + '" y2="' + (botY - 1 - SP * 3.2) + '" stroke="currentColor" stroke-width="1.3"/>');
        else s.push('<line x1="' + (cx - rx + 0.6) + '" y1="' + (topY + 1) + '" x2="'
          + (cx - rx + 0.6) + '" y2="' + (topY + 1 + SP * 3.2) + '" stroke="currentColor" stroke-width="1.3"/>');
      }
      // 符尾（八分）
      if (it.dur === 'e') {
        var sx = stemUp ? cx + rx - 0.6 : cx - rx + 0.6;
        var sy = stemUp ? Math.max.apply(null, xs) - 1 - SP * 3.2 : Math.min.apply(null, xs) + 1 + SP * 3.2;
        var dir = stemUp ? 1 : -1;
        s.push('<path d="M' + sx + ' ' + sy + ' q' + (10 * dir) + ' ' + (6) + ' 0 ' + (12 * dir)
          + '" fill="none" stroke="currentColor" stroke-width="1.6"/>');
      }
    });

    if (cfg.caption) {
      s.push('<text x="' + padL + '" y="' + (H - 4) + '" font-size="10.5" fill="currentColor" opacity=".55">'
        + esc(cfg.caption) + '</text>');
    }
    s.push('</svg>');
    return s.join('');
  }

  function mount(root) {
    (root || document).querySelectorAll('[data-notation]').forEach(function (el) {
      var cfg = {};
      try { cfg = JSON.parse(el.getAttribute('data-notation') || '{}'); } catch (e) {}
      try { el.innerHTML = render(cfg); } catch (e) {
        el.textContent = '谱例渲染失败：' + e.message;
      }
    });
  }

  global.Notation = { render: render, mount: mount };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(); });
    else mount();
  }
})(typeof window !== 'undefined' ? window : this);
