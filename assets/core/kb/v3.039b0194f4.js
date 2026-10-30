/* ── v3 问诊：三题选完，给出路径与能力页两个入口 ───────────────────── */
(function () {
  function init() {
    document.querySelectorAll('form[data-quiz]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var picks = [];
        ['q1', 'q2', 'q3'].forEach(function (name) {
          var el = form.querySelector('input[name="' + name + '"]:checked');
          if (el) picks.push(el);
        });
        var box = form.querySelector('.v3-result');
        if (!box) return;
        if (!picks.length) { box.classList.add('on'); box.textContent = form.dataset.empty || ''; return; }
        var html = '';
        picks.forEach(function (el) {
          var href = el.getAttribute('data-href');
          var title = el.getAttribute('data-title') || el.value;
          if (href) html += '<p><a href="' + href + '">' + title + ' →</a></p>';
        });
        box.innerHTML = html;
        box.classList.add('on');
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ── v3 站内检索：首页 search/ 读取构建期静态索引 ───────────────────── */
(function () {
  var form = document.querySelector('form[data-search]');
  if (!form) return;
  var input = form.querySelector('input[type="search"]');
  var box = document.querySelector('[data-search-results]');
  var idx = null;
  function load() {
    if (idx) return Promise.resolve(idx);
    var base = form.getAttribute('data-index') || 'search-index.json';
    return fetch(base).then(function (r) { return r.json(); }).then(function (d) { idx = d; return d; });
  }
  function render(items) {
    if (!box) return;
    if (!items.length) { box.innerHTML = '<p class="kb-empty">没有匹配的条目。</p>'; return; }
    box.innerHTML = items.slice(0, 40).map(function (it) {
      return '<li><a href="' + it.url + '"><b>' + it.title + '</b>'
        + '<span>' + (it.summary || '') + '</span></a></li>';
    }).join('');
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = (input.value || '').trim().toLowerCase();
    if (!q) return;
    load().then(function (items) {
      render(items.filter(function (it) {
        return (it.title + ' ' + (it.summary || '') + ' ' + (it.alias || '')).toLowerCase().indexOf(q) >= 0;
      }));
    });
  });
})();
