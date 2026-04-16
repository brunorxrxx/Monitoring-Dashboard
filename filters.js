/* ═══════════════════════════════════════════════════════════════
   FILTERS.JS — Filtros multi-select com checkbox e aplicação
   Dependências: utils.js, config.js
═══════════════════════════════════════════════════════════════ */

var MS_STATE = {}; /* { key: Set of selected values } */

/* ══════════════════════════════════════════
   CONSTRUÇÃO DO MULTI-SELECT
══════════════════════════════════════════ */
function buildMultiSelect(containerId, key, options, placeholder) {
  MS_STATE[key] = new Set();
  var container = document.getElementById(containerId);
  if (!container) return;

  var html =
    '<div class="ms-wrap" id="mswrap-' + key + '">' +
    '<button type="button" class="ms-trigger" id="mstrig-' + key + '" onclick="toggleMS(\'' + key + '\')">' +
    '<span id="mslabel-' + key + '">' + placeholder + '</span>' +
    '<span class="ms-arrow" id="msarrow-' + key + '">▾</span>' +
    '</button>' +
    '<div class="ms-drop" id="msdrop-' + key + '">' +
    '<input class="ms-search" placeholder="Buscar..." oninput="searchMS(\'' + key + '\',this.value)"/>' +
    '<div class="ms-all active" id="msall-' + key + '" onclick="toggleAllMS(\'' + key + '\')">' +
    '<span class="ms-cb">✓</span><span>Todos</span>' +
    '</div>' +
    '<div id="mslist-' + key + '"></div>' +
    '</div>' +
    '</div>';
  container.innerHTML = html;
  renderMSOptions(key, options, '');
}

function renderMSOptions(key, options, search) {
  var list = document.getElementById('mslist-' + key);
  if (!list) return;
  var filt = search ? options.filter(function (o) { return o.toLowerCase().includes(search.toLowerCase()); }) : options;
  var allSelected = MS_STATE[key].size === 0;
  var allEl = document.getElementById('msall-' + key);
  if (allEl) {
    allEl.classList.toggle('active', allSelected);
    allEl.querySelector('.ms-cb').textContent = allSelected ? '✓' : '';
  }
  list.innerHTML = filt.map(function (o) {
    var sel = allSelected || MS_STATE[key].has(o);
    return '<div class="ms-item' + (sel ? ' active' : '') + '" data-val="' + escAttr(o) + '" onclick="toggleMSItem(\'' + key + '\',\'' + escAttr(o) + '\')">' +
      '<span class="ms-cb">' + (sel ? '✓' : '') + '</span><span>' + o + '</span></div>';
  }).join('');
}

function toggleMS(key) {
  var wrap = document.getElementById('mswrap-' + key);
  var drop = document.getElementById('msdrop-' + key);
  if (!wrap || !drop) return;
  var isOpen = wrap.classList.contains('open');
  document.querySelectorAll('.ms-wrap.open').forEach(function (w) { w.classList.remove('open'); });
  if (!isOpen) {
    wrap.classList.add('open');
    var rect = wrap.getBoundingClientRect();
    drop.style.top = (rect.bottom + 4) + 'px';
    drop.style.left = rect.left + 'px';
    drop.style.width = Math.max(rect.width, 280) + 'px';
  }
}

function searchMS(key, val) {
  var opts = (DATA._opts && DATA._opts[key]) || [];
  renderMSOptions(key, opts, val);
}

function toggleMSItem(key, val) {
  var state = MS_STATE[key];
  var opts = (DATA._opts && DATA._opts[key]) || (key === 'trn' ? ['1ºT', '2ºT', '3ºT'] : []);
  if (state.size === 0) {
    opts.forEach(function (o) { if (o !== val) state.add(o); });
  } else {
    if (state.has(val)) state.delete(val); else state.add(val);
    if (state.size === opts.length) state.clear();
    if (state.size === 0) state.clear();
  }
  var list = document.getElementById('mslist-' + key);
  var allSelected = state.size === 0;
  if (list) list.querySelectorAll('.ms-item').forEach(function (el) {
    var v = el.dataset.val;
    var sel = allSelected || state.has(v);
    el.classList.toggle('active', sel);
    el.querySelector('.ms-cb').textContent = sel ? '✓' : '';
  });
  var allEl = document.getElementById('msall-' + key);
  if (allEl) { allEl.classList.toggle('active', state.size === 0); allEl.querySelector('.ms-cb').textContent = state.size === 0 ? '✓' : ''; }
  updateMSLabel(key);
  applyF();
}

function toggleAllMS(key) {
  MS_STATE[key].clear();
  var list = document.getElementById('mslist-' + key);
  if (list) list.querySelectorAll('.ms-item').forEach(function (el) { el.classList.add('active'); el.querySelector('.ms-cb').textContent = '✓'; });
  var allEl = document.getElementById('msall-' + key);
  if (allEl) { allEl.classList.add('active'); allEl.querySelector('.ms-cb').textContent = '✓'; }
  updateMSLabel(key);
  applyF();
}

function updateMSLabel(key) {
  var state = MS_STATE[key];
  var label = document.getElementById('mslabel-' + key);
  var plMap = { wo: 'Todos', mod: 'Todos', lin: 'Todas', st: 'Todas', fd: 'Todas' };
  if (!label) return;
  if (state.size === 0) { label.textContent = plMap[key] || 'Todos'; return; }
  var arr = Array.from(state);
  label.innerHTML = arr.length === 1
    ? '<span>' + arr[0] + '</span>'
    : '<span>' + arr[0] + '</span><span class="ms-tag">+' + (arr.length - 1) + '</span>';
}

/* Fecha dropdown ao clicar fora */
document.addEventListener('click', function (e) {
  if (!e.target.closest('.ms-wrap'))
    document.querySelectorAll('.ms-wrap.open').forEach(function (w) { w.classList.remove('open'); });
});

/* Fecha dropdowns ao scrollar */
window.addEventListener('scroll', function (e) {
  if (e.target && (e.target.classList.contains('ms-drop') || e.target.closest('.ms-drop'))) return;
  document.querySelectorAll('.ms-wrap.open').forEach(function (w) { w.classList.remove('open'); });
}, true);

/* ══════════════════════════════════════════
   APLICAÇÃO DE FILTROS
══════════════════════════════════════════ */
function getSel(key) { return MS_STATE[key] ? Array.from(MS_STATE[key]) : []; }
function inSel(key, val) { var s = MS_STATE[key]; return !s || s.size === 0 || s.has(val); }

/* inSelDtc: linhas sem descTec sempre passam */
function inSelDtc(val) {
  var s = MS_STATE['dtc'];
  if (!s || s.size === 0) return true;
  if (!val || val === '') return true;
  return s.has(val);
}

function applyF() {
  CHART_FILTER = { fd: null, itm: null };
  if (IS_ADMIN && CURRENT_CLIENT) ADMIN_FILTERS[CURRENT_CLIENT] = captureFilterState();
  var d = DATA, O = d.O, F = d.F;
  if (!O || !F) return;
  var rawOut = d._rawOutRows || d.outRows;
  var rawDef = d._rawDefRows || d.defRows;

  var fo = rawOut.filter(function (r) {
    return inSel('wo', S(r[O.wo])) && inSel('mod', S(r[O.modelo])) &&
      inSel('ser', S(r[O.serial])) &&
      inSel('lin', S(r[O.linha])) && inSel('st', S(r[O.st]));
  });

  function buildFd(inclTrn) {
    return rawDef.filter(function (r) {
      var wo = S(r[F.wo]), fdv = S(r[F.failDesc]) || 'TBA';
      var itv = S(r[F.item]) || 'TBA';
      var m = d.woMap[wo] || {};
      var modDef = m.modelo || S(r['_modelo']) || '';
      var serMatch = !MS_STATE['ser'] || MS_STATE['ser'].size === 0 ||
        rawOut.filter(function (o) { return S(o[O.wo]) === wo && MS_STATE['ser'].has(S(o[O.serial])); }).length > 0;
      return inSel('wo', wo) && inSel('mod', modDef) && serMatch &&
        inSel('bser', S(r[F.serial])) &&
        inSel('lin', S(r[F.linha]) || m.linha || '') &&
        inSel('st', S(r[F.st])) && inSel('fd', fdv) && inSel('itm', itv) &&
        inSelDtc(S(r[F.descTec])) &&
        (!inclTrn || inSel('trn', getShift(S(r[F.failDate]))));
    });
  }

  var fdKpi = buildFd(false); /* SEM turno → KPIs mostram 3 turnos */
  var fd = buildFd(true);  /* COM turno → gráficos */

  DATA.outRows = fo;
  DATA.defRowsKpi = fdKpi;
  DATA._dropDefRows = fd;
  DATA.defRows = fd;
  render(Object.assign({}, d, { outRows: fo, defRows: fd, defRowsKpi: fdKpi }));
}

function clearAllF() {
  ['wo', 'mod', 'ser', 'bser', 'lin', 'st', 'fd', 'itm', 'trn', 'dtc'].forEach(function (key) {
    if (MS_STATE[key]) MS_STATE[key].clear();
    var allEl = document.getElementById('msall-' + key);
    if (allEl) { allEl.classList.add('active'); allEl.querySelector('.ms-cb').textContent = '✓'; }
    var list = document.getElementById('mslist-' + key);
    if (list) list.querySelectorAll('.ms-item').forEach(function (el) {
      el.classList.remove('active'); el.querySelector('.ms-cb').textContent = '';
    });
    updateMSLabel(key);
  });
  /* chama applyF() para que DATA._dropDefRows / defRows sejam reconstruídos
     com os filtros agora limpos — render(DATA) direto deixaria dados velhos */
  applyF();
}

/* ── Captura e restaura estado de filtros (admin) ── */
function captureFilterState() {
  var state = {};
  Object.keys(MS_STATE).forEach(function (k) {
    if (MS_STATE[k] && MS_STATE[k].size > 0) state[k] = Array.from(MS_STATE[k]);
  });
  return JSON.stringify(state);
}

function applyDefaultFilters(filtersJson) {
  try {
    var state = (typeof filtersJson === 'string') ? JSON.parse(filtersJson) : filtersJson;
    if (!state || Object.keys(state).length === 0) return;
    Object.keys(state).forEach(function (key) {
      var vals = state[key];
      if (!Array.isArray(vals) || vals.length === 0) return;
      if (!MS_STATE[key]) MS_STATE[key] = new Set();
      vals.forEach(function (v) { MS_STATE[key].add(v); });
      var list = document.getElementById('mslist-' + key);
      if (list) list.querySelectorAll('.ms-item').forEach(function (el) {
        var val = el.getAttribute('data-val');
        if (MS_STATE[key].has(val)) {
          el.classList.add('active');
          var cb = el.querySelector('.ms-cb'); if (cb) cb.textContent = '✓';
        }
      });
      var allEl = document.getElementById('msall-' + key);
      if (allEl) {
        allEl.classList.remove('active');
        var cb = allEl.querySelector('.ms-cb'); if (cb) cb.textContent = '';
      }
      updateMSLabel(key);
    });
    applyF();
  } catch (e) { console.warn('[applyDefaultFilters]', e); }
}

/* Touch support */
window.addEventListener('DOMContentLoaded', function () {
  document.addEventListener('touchstart', function (e) {
    if (!e.target.closest('.ms-wrap'))
      document.querySelectorAll('.ms-wrap.open').forEach(function (el) { el.classList.remove('open'); });
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (document.querySelector('.ms-wrap.open')) {
      if (!e.target.closest('.ms-drop')) e.preventDefault();
    }
  }, { passive: false });

  if (window.innerWidth <= 640 || ('ontouchstart' in window))
    document.body.classList.add('is-mobile');
});
