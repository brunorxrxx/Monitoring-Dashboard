/* ═══════════════════════════════════════════════════════════════
   CHARTS.JS — Helpers de gráficos, render principal, pareto click
   Dependências: utils.js, config.js, filters.js
═══════════════════════════════════════════════════════════════ */

/* ── Destrói todos os gráficos Chart.js ativos ── */
function killCharts() {
  Object.values(CHARTS).forEach(function(c) { try { c.destroy(); } catch (e) {} });
  CHARTS = {};
  ['cFD', 'cItem'].forEach(function(id) {
    var cv = document.getElementById(id); if (cv) cv._acer_click = false;
  });
}

/* ── Labels de valor em cima das barras ── */
function barLabels(chart, dsIdx, color, fsize) {
  var ctx = chart.ctx, ds = chart.data.datasets[dsIdx];
  if (!ds) return;
  var meta = chart.getDatasetMeta(dsIdx);
  ctx.save();
  ctx.font = 'bold ' + fsize + 'px Segoe UI';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  meta.data.forEach(function(bar, i) {
    var v = ds.data[i];
    if (v === null || v === undefined || v === 0) return;
    ctx.fillText(v, bar.x, bar.y - 4);
  });
  ctx.restore();
}

/* ── Labels de % acumulado acima dos pontos da linha (pareto) ── */
function lineLabels(chart, dsIdx, color, fsize) {
  var ctx = chart.ctx, ds = chart.data.datasets[dsIdx];
  if (!ds) return;
  var meta = chart.getDatasetMeta(dsIdx);
  ctx.save();
  ctx.font = fsize + 'px IBM Plex Sans,Segoe UI';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  meta.data.forEach(function(pt, i) {
    var v = ds.data[i];
    if (v === null || v === undefined) return;
    var chartTop = chart.chartArea ? chart.chartArea.top : 0;
    if (pt.y - 20 < chartTop) {
      ctx.textBaseline = 'top';
      ctx.fillText(v + '%', pt.x, pt.y + 4);
      ctx.textBaseline = 'bottom';
    } else {
      ctx.fillText(v + '%', pt.x, pt.y - 7);
    }
  });
  ctx.restore();
}

/* ── Constrói gráfico Pareto (barras + linha acumulado) ── */
function makePareto(canvasId, labels, values, barColor, lineColor) {
  var canvasEl = document.getElementById(canvasId);
  if (!canvasEl) {
    console.warn('[makePareto] canvas não encontrado: ' + canvasId);
    return null;
  }
  if (!labels.length) {
    console.warn('[makePareto] sem dados para: ' + canvasId);
    return null;
  }

  var total = values.reduce(function(a, v) { return a + v; }, 0);
  var cum = 0, pcts = values.map(function(v) { cum += v; return +((cum / total) * 100).toFixed(1); });
  var bgArr   = values.map(function(v) { return v >= 3 ? '#dc2f02' : '#4cc9f0'; });
  var bordArr = values.map(function(v) { return v >= 3 ? '#b52501'  : '#29b4e0'; });

  var _maxLblLen = labels.reduce(function(mx, l) { return Math.max(mx, String(l).length); }, 0);
  var _xRotMax = _maxLblLen > 8 ? 45 : 0;

  return new Chart(canvasEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Total de Falhas', data: values, backgroundColor: bgArr, borderColor: bordArr,
          borderWidth: 1.5, borderRadius: 5, yAxisID: 'y', order: 2 },
        { type: 'line', label: '% Acumulado', data: pcts, borderColor: '#f77f00', borderWidth: 2.5,
          pointRadius: 6, pointBackgroundColor: '#f77f00', pointBorderColor: '#ffffff',
          pointBorderWidth: 2, yAxisID: 'y2', fill: false, tension: .3, order: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 32, right: 8, bottom: 4 } },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            color: '#334155', font: { size: _xRotMax === 45 ? 10 : 11 }, color: '#0F172A',
            maxRotation: _xRotMax, minRotation: _xRotMax, autoSkip: false,
            padding: _xRotMax === 45 ? 8 : 4,
            callback: function(val, idx) {
              var lbl = this.getLabelForValue(val);
              if (typeof lbl !== 'string') return lbl;
              if (_xRotMax === 0) {
                if (lbl.length <= 10) return lbl;
                var words = lbl.split(' ');
                if (words.length === 1) return [lbl.slice(0, Math.ceil(lbl.length / 2)), lbl.slice(Math.ceil(lbl.length / 2))];
                var mid = Math.ceil(words.length / 2);
                return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
              }
              if (lbl.length <= 12) return lbl;
              var words = lbl.split(' ');
              if (words.length <= 1) return lbl;
              var mid = Math.ceil(words.length / 2);
              return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
            },
            afterFit: function(axis) { if (_xRotMax === 45) axis.height = Math.min(axis.height, 85); }
          },
          grid: { color: '#E2E8F0' }, border: { display: false }
        },
        y: {
          ticks: { color: '#475569', stepSize: 1, font: { size: 9 } },
          grid: { color: '#E2E8F0' }, beginAtZero: true,
          max: Math.ceil(Math.max.apply(null, values)) + 1,
          position: 'left', border: { display: false }
        },
        y2: {
          ticks: { color: '#334155', callback: function(v) { return v + '%'; }, font: { size: 9 } },
          grid: { display: false }, min: 0, max: 108, position: 'right', border: { display: false }
        }
      },
      animation: { onComplete: function(anim) {
        barLabels(anim.chart, 0, '#0F172A', 11);
        lineLabels(anim.chart, 1, '#0F172A', 10);
      }}
    }
  });
}

/* ══════════════════════════════════════════
   RENDER PRINCIPAL — reconstrói tudo com dados filtrados
   Guarda contra falha silenciosa quando estações ausentes
══════════════════════════════════════════ */
function render(d) {
  killCharts();
  var outRows = d.outRows, defRows = d.defRows, O = d.O, F = d.F, woMap = d.woMap;
  if (!outRows || !defRows || !O || !F) {
    console.warn('[render] dados incompletos — render abortado');
    return;
  }
  var defRowsKpi = d.defRowsKpi || defRows;

  /* ── Agrega OUT por estação ── */
  var sO = {};
  outRows.forEach(function(r) {
    var st = S(r[O.st]) || 'N/A';
    if (!sO[st]) sO[st] = { total: 0, pass: 0, fail: 0 };
    sO[st].total += N(r[O.total]);
    sO[st].pass  += N(r[O.pass]);
    sO[st].fail  += N(r[O.fail]);
  });
  if (CURRENT_CLIENT === 'asus' && sO['AVIPK']) {
    sO['PACK-QA'] = { total: sO['AVIPK'].total, pass: sO['AVIPK'].pass, fail: sO['AVIPK'].fail };
  }

  /* ── Dedup para KPI (sem turno) ── */
  var _seenKpi = {};
  var defDedupKpi = defRowsKpi.filter(function(r) {
    var s = S(r[F.serial]); var st = S(r[F.st]) || 'N/A';
    if (!s || s === '') return true;
    var k = s + '\x00' + st;
    if (_seenKpi[k]) return false;
    _seenKpi[k] = true; return true;
  });
  var sDkpi = {};
  defDedupKpi.forEach(function(r) { var st = S(r[F.st]) || 'N/A'; sDkpi[st] = (sDkpi[st] || 0) + 1; });

  function parcKpi(st) { var df = sDkpi[st] || 0, t = sO[st] ? sO[st].total : 0; return t ? 1 - df / t : null; }
  function prod(vals)  { var v = vals.filter(function(x) { return x !== null && x > 0; }); return v.length ? v.reduce(function(a, x) { return a * x; }, 1) : null; }

  var _cfg = getCfg();
  var oSMT = prod(_cfg.smtSts.map(function(s) { return parcKpi(s); }));
  var oBE  = prod(_cfg.beSts.map(function(s)  { return parcKpi(s); }));
  var ov   = prod([oSMT, oBE]);
  var totFDedup = defDedupKpi.length;
  var loss = ov ? 1 - ov : null;
  var taxaDef = ov !== null ? 1 - ov : null;
  var pack = sO['PACKING'] ? sO['PACKING'].total : 0;
  var packFixed = (DATA._packTotal !== undefined) ? DATA._packTotal : pack;

  /* ── Dedup para gráficos (com turno) ── */
  var _seenSerSt = {};
  var defDedup = defRows.filter(function(r) {
    var s = S(r[F.serial]); var st = S(r[F.st]) || 'N/A';
    if (!s || s === '') return true;
    var k = s + '\x00' + st;
    if (_seenSerSt[k]) return false;
    _seenSerSt[k] = true; return true;
  });
  var sD = {};
  defDedup.forEach(function(r) { var st = S(r[F.st]) || 'N/A'; sD[st] = (sD[st] || 0) + 1; });
  if (DATA) { DATA._sD = sD; DATA._defDedup = defDedup; }

  function parc(st) { var df = sD[st] || 0, t = sO[st] ? sO[st].total : 0; return t ? 1 - df / t : null; }
  function yc(v)    { return !v ? 'var(--t3)' : v >= THRESH.green ? 'var(--green)' : v >= THRESH.warn ? 'var(--amber)' : v >= THRESH.amber ? 'var(--amber)' : 'var(--red)'; }
  /* kpiCls: define classe de fundo do card por threshold
     ≥ 99%        → kpi-ok   (fundo verde   #49c351)
     < 99% ≥ 98%  → warn     (fundo amarelo #FFFF00)
     < 98%        → kpi-crit (fundo vermelho #FF0000) */
  function kpiCls(v){ if (!v || v === null) return ''; if (v < 0.98) return ' kpi-crit'; if (v < THRESH.green) return ' warn'; return ' kpi-ok'; }
  function yct(v)   { return v === null ? 'var(--t3)' : v <= 0.01 ? 'var(--green)' : v <= 0.03 ? 'var(--amber)' : 'var(--red)'; }

  /* ── Produção SMT / BE por cliente ──
     Sempre usa _rawOutRows (dados sem filtro de estação/linha/etc.)
     para que os cards SMT PRODUTION e B.E PRODUTION fiquem fixos
     independente dos filtros aplicados pelo usuário. */
  var sO_fixed = {};
  var _rawOut = (DATA && DATA._rawOutRows) ? DATA._rawOutRows : outRows;
  _rawOut.forEach(function(r) {
    var st = S(r[O.st]) || 'N/A';
    if (!sO_fixed[st]) sO_fixed[st] = { total: 0, pass: 0, fail: 0 };
    sO_fixed[st].total += N(r[O.total]);
    sO_fixed[st].pass  += N(r[O.pass]);
    sO_fixed[st].fail  += N(r[O.fail]);
  });
  if (CURRENT_CLIENT === 'asus' && sO_fixed['AVIPK']) {
    sO_fixed['PACK-QA'] = { total: sO_fixed['AVIPK'].total, pass: sO_fixed['AVIPK'].pass, fail: sO_fixed['AVIPK'].fail };
  }

  var smtProd;
  if (CURRENT_CLIENT === 'huawei') {
    smtProd = sO_fixed['FT2_MP1'] ? sO_fixed['FT2_MP1'].pass : (sO_fixed['S_VI_T'] ? sO_fixed['S_VI_T'].total : 0);
  } else {
    smtProd = sO_fixed['S_VI_T'] ? sO_fixed['S_VI_T'].total : 0;
  }
  var beProd;
  if (CURRENT_CLIENT === 'hp') {
    beProd = sO_fixed['FVI2'] ? sO_fixed['FVI2'].total : 0;
  } else if (CURRENT_CLIENT === 'huawei') {
    beProd = sO_fixed['ST-MP9'] ? sO_fixed['ST-MP9'].pass : (sO_fixed['ST-MP1'] ? sO_fixed['ST-MP1'].pass : 0);
  } else if (CURRENT_CLIENT === 'asus') {
    var _stOutFixed = (DATA && DATA.stOut) ? DATA.stOut : sO_fixed;
    beProd = _stOutFixed['AVIPK'] ? _stOutFixed['AVIPK'].total : 0;
  } else {
    beProd = (sO_fixed['FBT'] ? sO_fixed['FBT'].total : 0) + (sO_fixed['F2'] ? sO_fixed['F2'].total : 0);
  }

  /* ── KPI row ── */
  var taxaAlerta = taxaDef !== null && taxaDef > 0.01;
  var taxaStr    = taxaDef !== null ? (taxaDef * 100).toFixed(2) + '%' : '—';
  var kpiEl = document.getElementById('kpiRow');
  if (kpiEl) kpiEl.innerHTML =
    '<div class="kpi kpi-prod" style="--kc:var(--cyan)"><div class="kpi-l">B.E PRODUTION</div><div class="kpi-v">' + fmt(beProd) + '</div></div>' +
    '<div class="kpi kpi-prod" style="--kc:var(--blue)"><div class="kpi-l">SMT PRODUTION</div><div class="kpi-v">' + fmt(smtProd) + '</div></div>' +
    '<div class="kpi" style="--kc:var(--red)"><div class="kpi-l">TOTAL FALHAS</div><div class="kpi-v">' + fmt(totFDedup) + '</div></div>' +
    '<div class="kpi' + kpiCls(oSMT) + '" style="--kc:' + yc(oSMT) + '"><div class="kpi-l">OVERALL SMT</div><div class="kpi-v">' + pct(oSMT) + '</div></div>' +
    '<div class="kpi' + kpiCls(oBE)  + '" style="--kc:' + yc(oBE)  + '"><div class="kpi-l">OVERALL B.E.</div><div class="kpi-v">' + pct(oBE) + '</div></div>' +
    '<div class="kpi kpi-pair' + kpiCls(ov) + (taxaAlerta ? ' kpi-taxa-alert' : '') + '" style="--kc:' + yc(ov) + '">' +
      '<div class="kpi-pair-inner">' +
        '<div class="kpi-pair-side"><div class="kpi-l">OVERALL OFICIAL</div><div class="kpi-v kpi-v-fit">' + pct(ov) + '</div></div>' +
        '<div class="kpi-pair-side"><div class="kpi-l">TAXA DE DEFEITO</div><div class="kpi-v kpi-v-fit kpi-taxa">' + taxaStr + '</div></div>' +
      '</div>' +
    '</div>';

  /* ── Station matrix ── */
  var _cfgNow = getCfg();
  var _stRowEl = document.getElementById('stRow');
  if (_stRowEl) _stRowEl.innerHTML = _cfgNow.matrix.map(function(st) {
    var p   = parcKpi(st);
    var col = _cfgNow.colors[st] || MT_CLR[st] || 'var(--t3)';
    var grp = _cfgNow.groups[st] || MT_GRP[st] || 'B.E';
    return '<div class="sk" style="--kc:' + col + '">' +
      '<div class="sk-group">' + grp + '</div>' +
      '<div class="sk-name">' + st + '</div>' +
      '<div class="sk-val" style="color:' + yc(p) + '">' + pct(p) + '</div>' +
      '<div class="sk-sub">Total: ' + fmt(sO[st] ? sO[st].total : 0) + '</div>' +
      '<div class="sk-df">Falhas: ' + fmt(sDkpi[st] || 0) + '</div></div>';
  }).join('');

  /* ── Breakdown: tabela por modelo ── */
  var selSt = MS_STATE['st'] && MS_STATE['st'].size > 0 ? MS_STATE['st'] : null;
  var ST_ORDER = ['S_VI_B', 'S_VI_T', 'FVI', 'ICT', 'FBT', 'F1', 'F2', 'FV2', 'PACK', 'PACKING'];
  var _excl2 = getCfg().excludeSt || [];
  var allStSeen = {}, allStKeys = [];
  ST_ORDER.forEach(function(st) {
    if (_excl2.indexOf(st) !== -1) return;
    var inOut = (DATA.outRows || outRows).some(function(r) { return S(r[O.st]) === st; });
    var inDef = (DATA.defRows || defRows).some(function(r) { return S(r[F.st]) === st; });
    if ((inOut || inDef) && !allStSeen[st]) { allStSeen[st] = true; allStKeys.push(st); }
  });
  var extraSt = [];
  (DATA.outRows || outRows).forEach(function(r) { var st = S(r[O.st]) || 'N/A'; if (!allStSeen[st] && _excl2.indexOf(st) === -1) { allStSeen[st] = true; extraSt.push(st); } });
  (DATA.defRows || defRows).forEach(function(r) { var st = S(r[F.st]) || 'N/A'; if (!allStSeen[st] && _excl2.indexOf(st) === -1) { allStSeen[st] = true; extraSt.push(st); } });
  extraSt.sort().forEach(function(st) { allStKeys.push(st); });

  var selMod  = MS_STATE['mod'] && MS_STATE['mod'].size > 0 ? Array.from(MS_STATE['mod']) : null;
  var modOut  = {}, modFail = {};
  outRows.forEach(function(r) { var mod = S(r[O.modelo]).trim(); if (!mod || mod === '—') return; modOut[mod] = (modOut[mod] || 0) + (N(r[O.total]) || 1); });
  defDedup.forEach(function(r) { var wo = S(r[F.wo]) || ''; var mod = (woMap[wo] ? woMap[wo].modelo : '') || S(r['_modelo']) || '—'; modFail[mod] = (modFail[mod] || 0) + 1; });
  var allMods = selMod ? selMod : Object.keys(modOut).sort();
  Object.keys(modFail).forEach(function(m) { if (allMods.indexOf(m) === -1) allMods.push(m); });
  allMods.sort();

  var bdTotT2 = 0, bdTotD2 = 0;
  var _tbStEl = document.getElementById('tbSt');
  var thead = _tbStEl ? _tbStEl.closest('table').querySelector('thead') : null;
  if (thead) thead.innerHTML = '<tr><th>Modelo</th><th>Total OUT</th><th>Falhas</th><th>●</th><th>Parcial FPY</th></tr>';
  if (_tbStEl) _tbStEl.innerHTML = allMods.map(function(mod) {
    var tot = modOut[mod] || 0, df = modFail[mod] || 0;
    bdTotT2 += tot; bdTotD2 += df;
    var p = tot ? 1 - df / tot : null;
    var dot = p === null ? 'ia' : p >= THRESH.green ? 'ig' : p >= THRESH.warn ? 'ia' : 'ir';
    return '<tr><td class="lab">' + mod + '</td><td>' + fmt(tot) + '</td>' +
      '<td style="color:var(--red)">' + fmt(df) + '</td>' +
      '<td><span class="ind ' + dot + '"></span></td>' +
      '<td style="color:' + yc(p) + ';font-weight:700">' + pct(p) + '</td></tr>';
  }).join('') +
  '<tr class="tot"><td>TOTAL</td><td>' + fmt(bdTotT2) + '</td>' +
    '<td style="color:var(--red)">' + fmt(bdTotD2) + '</td><td></td>' +
    '<td style="color:var(--cyan);">' + pct(bdTotD2 && bdTotT2 ? 1 - bdTotD2 / bdTotT2 : null) + '</td></tr>';

  var bdStEl = document.getElementById('bdSt');
  if (bdStEl) bdStEl.textContent = allMods.length + ' modelos · ' + totFDedup + ' falhas';

  /* ── Gráfico 1: Falhas por hora ── */
  var hrA = {};
  defRows.forEach(function(r) {
    var raw = S(r[F.failDate]), m = raw.match(/\s(\d{1,2}):\d{2}:\d{2}/);
    var h = m ? m[1].padStart(2, '0') + 'h' : '??';
    hrA[h] = (hrA[h] || 0) + 1;
  });
  var hK = Object.keys(hrA).filter(function(k) { return k !== '??'; }).sort();
  var hV = hK.map(function(k) { return hrA[k]; });
  var bdHrEl = document.getElementById('bdHr'); if (bdHrEl) bdHrEl.textContent = totFDedup + ' falhas';

  /* Cor por threshold: >= 3 falhas = vermelho, < 3 = azul */
  function hrBgColor(v)   { return v >= 3 ? 'rgba(139,26,26,0.75)' : 'rgba(30,58,95,0.5)'; }
  function hrBordColor(v) { return v >= 3 ? '#ff3d5a' : '#4d79ff'; }

  var cHourEl = document.getElementById('cHour');
  if (cHourEl) {
    CHARTS.hr = new Chart(cHourEl.getContext('2d'), {
      type: 'bar',
      data: { labels: hK, datasets: [{ label: 'Falhas', data: hV, borderRadius: 4, borderWidth: 1.5,
        backgroundColor: hV.map(hrBgColor),
        borderColor:     hV.map(hrBordColor) }] },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function(ctx) { return ' Falhas: ' + ctx.raw; } } } },
        onClick: function(evt, els) {
          if (!els || !els.length) { if (HOUR_FILTER !== null) { HOUR_FILTER = null; applyHourFilter(); } return; }
          var lbl = hK[els[0].index];
          HOUR_FILTER = (HOUR_FILTER === lbl) ? null : lbl;
          applyHourFilter();
        },
        scales: {
          x: { ticks: { color: '#1E293B', font: { size: 10, weight: '600' } }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#1E293B', stepSize: 1 }, grid: { color: '#E2E8F0' }, beginAtZero: true }
        },
        animation: { onComplete: function(anim) { barLabels(anim.chart, 0, '#0F172A', 11); } }
      }
    });
  }

  /* ── Gráfico 2: Turno ── */
  var tA = { '1ºT': 0, '2ºT': 0, '3ºT': 0 };
  defRows.forEach(function(r) { var t = getShift(S(r[F.failDate])); tA[t] = (tA[t] || 0) + 1; });
  var tK = ['1ºT', '2ºT', '3ºT'], tV = tK.map(function(k) { return tA[k] || 0; });
  var tBg = ['#1e3a5f', '#f77f00', '#047857'];
  var bdTurnoEl = document.getElementById('bdTurno'); if (bdTurnoEl) bdTurnoEl.textContent = totFDedup + ' total';

  var cTurnoEl = document.getElementById('cTurno');
  if (cTurnoEl) {
    CHARTS.turno = new Chart(cTurnoEl.getContext('2d'), {
      type: 'doughnut',
      data: { labels: tK, datasets: [{ data: tV, backgroundColor: tBg, borderColor: '#ffffff', borderWidth: 2, hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { color: '#1E293B', font: { size: 11, weight: '600' }, padding: 12,
            usePointStyle: true, pointStyle: 'circle',
            generateLabels: function(chart) {
              var ds = chart.data.datasets[0];
              return chart.data.labels.map(function(l, i) {
                return { text: l + '  ' + ds.data[i], fillStyle: tBg[i], strokeStyle: tBg[i], lineWidth: 0, hidden: false, index: i };
              });
            }
          }},
          tooltip: { callbacks: { label: function(ctx) { return ' ' + ctx.label + ': ' + ctx.parsed + ' falhas'; } } }
        }
      }
    });
  }

  /* ── Pareto Fail Description ── */
  var fdA = {};
  defRows.forEach(function(r) { var v = S(r[F.failDesc]) || 'TBA'; fdA[v] = (fdA[v] || 0) + 1; });
  var fdK = Object.keys(fdA).sort(function(a, b) { return fdA[b] - fdA[a]; }).slice(0, 13);
  var fdV = fdK.map(function(k) { return fdA[k]; });
  var bdFDEl = document.getElementById('bdFD'); if (bdFDEl) bdFDEl.textContent = fdK.length + ' causas';
  CHARTS.fd = makePareto('cFD', fdK, fdV, '#ff3d5a', '#00d4ff');
  if (CHARTS.fd) CHARTS.fd._origLabels = fdK;

  /* ── Pareto Item ── */
  var itmA = {};
  defRows.forEach(function(r) { var v = S(r[F.item]) || 'TBA'; itmA[v] = (itmA[v] || 0) + 1; });
  var itmK = Object.keys(itmA).sort(function(a, b) { return itmA[b] - itmA[a]; }).slice(0, 13);
  var itmV = itmK.map(function(k) { return itmA[k]; });
  var bdItemEl = document.getElementById('bdItem'); if (bdItemEl) bdItemEl.textContent = itmK.length + ' componentes';
  CHARTS.item = makePareto('cItem', itmK, itmV, '#ffc400', '#b97fff');
  if (CHARTS.item) CHARTS.item._origLabels = itmK;

  /* ── Pareto table ── */
  var serCount = {};
  defRows.forEach(function(r) { var s = S(r[F.serial]) || '—'; serCount[s] = (serCount[s] || 0) + 1; });
  var jA = {};
  defRows.forEach(function(r) {
    var wo = S(r[F.wo]), fd = S(r[F.failDesc]) || 'TBA';
    var itm = S(r[F.item]) || 'TBA', st = S(r[F.st]) || 'N/A';
    var ser = S(r[F.serial]) || '—';
    var mod = (woMap[wo] ? woMap[wo].modelo : '') || S(r['_modelo']) || '—';
    var rawDate = S(r[F.failDate]), mh = rawDate.match(/\s(\d{1,2}:\d{2})/);
    var hora = mh ? mh[1] : '—';
    var key = [fd, itm, st, ser, wo, mod, hora].join('\x00');
    jA[key] = (jA[key] || 0) + 1;
  });
  var pArr = Object.keys(jA).map(function(k) {
    var p = k.split('\x00'); return { fd: p[0], itm: p[1], st: p[2], ser: p[3], wo: p[4], mod: p[5], hora: p[6], qty: jA[k] };
  }).sort(function(a, b) { return b.qty - a.qty; });
  var pTot = pArr.reduce(function(a, r) { return a + r.qty; }, 0);
  renderParTable(pArr, pTot, ' ocorrências', serCount);
  var bdParEl = document.getElementById('bdPar'); if (bdParEl) bdParEl.textContent = fmt(pTot) + ' ocorrências';

  bindParetoClick();

  if (DATA) { DATA._sO = sO; DATA._ov = ov; DATA._sD = sD; }

  try { renderDashRow2(sO, sDkpi, defDedupKpi, ov); } catch (e) { console.warn('[renderDashRow2 inline]', e); }

  pushMonitorData();
}

/* ══════════════════════════════════════════
   TABELA PARETO
══════════════════════════════════════════ */
var PAR_DATA = [];
var SER_FILTER = 0;

function renderParTable(pArr, pTot, badgeSuffix, serCount) {
  PAR_DATA = pArr;
  _renderRows(pArr, serCount || window._lastSerCount || {});
  if (serCount) window._lastSerCount = serCount;
  var bdParEl = document.getElementById('bdPar');
  if (bdParEl) bdParEl.textContent = fmt(pTot) + (badgeSuffix || ' ocorrências');

  var cnt2 = 0, cnt3 = 0;
  if (serCount) Object.keys(serCount).forEach(function(s) {
    if (s === '—') return;
    var n = serCount[s]; if (n >= 3) cnt3++; else if (n === 2) cnt2++;
  });
  var b2 = document.getElementById('lgd2'), b3 = document.getElementById('lgd3');
  if (b2) { b2.textContent = cnt2 > 0 ? '⚠ ' + cnt2 + ' serial 2x' : '● 2x'; b2.style.opacity = cnt2 > 0 ? '1' : '0.4'; b2.style.fontWeight = cnt2 > 0 ? '700' : '400'; }
  if (b3) { b3.textContent = cnt3 > 0 ? '🔴 ' + cnt3 + ' serial 3x+' : '● 3x+'; b3.style.opacity = cnt3 > 0 ? '1' : '0.4'; b3.style.fontWeight = cnt3 > 0 ? '700' : '400'; }
}

function _renderRows(pArr, serCount) {
  var tbParEl = document.getElementById('tbPar'); if (!tbParEl) return;
  tbParEl.innerHTML = pArr.map(function(r, i) {
    var fdCell  = (!r.fd  || r.fd  === '—' || r.fd  === 'TBA') ? '<span style="color:var(--amber);font-style:italic">TBA</span>' : '<span class="lab">' + r.fd + '</span>';
    var itmCell = (!r.itm || r.itm === '—' || r.itm === 'TBA') ? '<span style="color:var(--amber);font-style:italic">TBA</span>' : '<span style="color:var(--cyan)">' + r.itm + '</span>';
    var cnt = serCount[r.ser] || 1;
    var serColor = cnt >= 3 ? 'var(--red)' : cnt === 2 ? 'var(--amber)' : 'var(--t2)';
    var serBg    = cnt >= 3 ? '#ff3d5a18'  : cnt === 2 ? '#ffc40018'   : 'transparent';
    var serIcon  = cnt >= 3 ? '🔴 ' : cnt === 2 ? '🟡 ' : '';
    var serCell  = '<span style="color:' + serColor + ';font-family:monospace;font-size:10px;background:' + serBg + ';padding:1px 5px;border-radius:3px" title="' + cnt + 'x ocorrências neste serial">' + serIcon + r.ser + '</span>';
    var horaCell = r.hora && r.hora !== '—' ? '<span style="color:var(--cyan);font-family:monospace;font-size:10px">' + r.hora + '</span>' : '<span style="color:var(--t3)">—</span>';
    var rowBg    = cnt >= 3 ? 'background:#FEF2F2' : cnt === 2 ? 'background:#FFFBEB' : '';
    return '<tr' + (rowBg ? ' style="' + rowBg + '"' : '') + '>' +
      '<td style="color:var(--t3)">' + (i + 1) + '</td>' +
      '<td>' + fdCell + '</td><td>' + itmCell + '</td>' +
      '<td><span class="badge bc" style="font-size:9px;padding:2px 6px">' + r.st + '</span></td>' +
      '<td>' + serCell + '</td><td>' + horaCell + '</td>' +
      '<td style="color:var(--t2)">' + r.wo.slice(-12) + '</td>' +
      '<td style="color:var(--t2)">' + r.mod + '</td>' +
      '<td style="color:var(--red);font-weight:700">' + r.qty + '</td></tr>';
  }).join('');
}

function filterBySer(minCount) {
  SER_FILTER = (SER_FILTER === minCount) ? 0 : minCount;
  var btn = document.getElementById('serFilterBtn');
  if (SER_FILTER === 0) {
    if (btn) btn.style.display = 'none';
    _renderRows(PAR_DATA, window._lastSerCount || {});
  } else {
    if (btn) btn.style.display = '';
    var filtered = PAR_DATA.filter(function(r) {
      var cnt = (window._lastSerCount || {})[r.ser] || 1;
      return SER_FILTER === 3 ? cnt >= 3 : cnt === 2;
    });
    _renderRows(filtered, window._lastSerCount || {});
  }
}

function clearSerFilter() {
  SER_FILTER = 0;
  var btn = document.getElementById('serFilterBtn'); if (btn) btn.style.display = 'none';
  _renderRows(PAR_DATA, window._lastSerCount || {});
}

/* ══════════════════════════════════════════
   FILTRO POR HORA (clique barra hora)
══════════════════════════════════════════ */
function applyHourFilter() {
  if (!DATA || !DATA.defRows) return;
  if (CHARTS.hr) {
    var hK = CHARTS.hr.data.labels, hV = CHARTS.hr.data.datasets[0].data;
    CHARTS.hr.data.datasets[0].backgroundColor = hK.map(function(l, i) {
      if (HOUR_FILTER !== null) return l === HOUR_FILTER ? '#00d4ff99' : '#4d79ff18';
      return hV[i] >= 3 ? '#ff3d5a66' : '#4d79ff30';
    });
    CHARTS.hr.data.datasets[0].borderColor = hK.map(function(l, i) {
      if (HOUR_FILTER !== null) return l === HOUR_FILTER ? '#00d4ff' : '#4d79ff44';
      return hV[i] >= 3 ? '#ff3d5a' : '#4d79ff';
    });
    CHARTS.hr.update('none');
  }
  var base = DATA._dropDefRows || DATA.defRows, F = DATA.F;
  var fdF = CHART_FILTER.fd, itmF = CHART_FILTER.itm;
  if (fdF || itmF) base = base.filter(function(r) {
    return (!fdF || (S(r[F.failDesc]) || 'TBA') === fdF) && (!itmF || (S(r[F.item]) || 'TBA') === itmF);
  });
  var filtered = HOUR_FILTER === null ? base : base.filter(function(r) {
    var m = S(r[F.failDate]).match(/\s(\d{1,2}):\d{2}:\d{2}/);
    return (m ? m[1].padStart(2, '0') + 'h' : '??') === HOUR_FILTER;
  });
  render(Object.assign({}, DATA, { outRows: DATA.outRows || DATA._rawOutRows, defRows: filtered, defRowsKpi: DATA.defRowsKpi }));
}

/* ══════════════════════════════════════════
   PARETO CLICK FILTER
══════════════════════════════════════════ */
function bindParetoClick() {
  function bindChart(canvasId, filterKey) {
    var cv = document.getElementById(canvasId);
    if (!cv || cv._acer_click) return;
    cv._acer_click = true;
    cv.addEventListener('click', function(e) {
      if (_chartRendering || !CHARTS[filterKey === 'fd' ? 'fd' : 'item']) return;
      var chart = CHARTS[filterKey === 'fd' ? 'fd' : 'item'];
      var pts = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
      if (!pts.length) {
        if (CHART_FILTER[filterKey] === null) return;
        CHART_FILTER[filterKey] = null;
        DATA.defRows = DATA._dropDefRows || DATA.defRows;
      } else {
        var idx = pts[0].index;
        var lbl = (chart._origLabels && chart._origLabels[idx]) || chart.data.labels[idx];
        if (Array.isArray(lbl)) lbl = lbl.join(' ');
        CHART_FILTER[filterKey] = (CHART_FILTER[filterKey] === lbl) ? null : lbl;
      }
      updateParetoHighlight();
    });
  }
  bindChart('cFD',   'fd');
  bindChart('cItem', 'itm');
}

function updateParetoHighlight() {
  if (_chartRendering) return;
  _chartRendering = true;
  var d = DATA, F = d.F;
  var fdF = CHART_FILTER.fd, itmF = CHART_FILTER.itm;
  var chartBase    = DATA._dropDefRows || d.defRows;
  var filteredDef  = (fdF || itmF) ? chartBase.filter(function(r) {
    return (!fdF  || (S(r[F.failDesc]) || 'TBA') === fdF) &&
           (!itmF || (S(r[F.item])     || 'TBA') === itmF);
  }) : chartBase;
  DATA.defRows = filteredDef;
  render(Object.assign({}, d, { outRows: DATA.outRows || d.outRows, defRows: filteredDef, defRowsKpi: DATA.defRowsKpi || d.defRowsKpi }));
  setTimeout(function() {
    highlightChart(CHARTS.fd,   fdF,  '#4d79ff', '#4d79ff18');
    highlightChart(CHARTS.item, itmF, '#4d79ff', '#4d79ff18');
    var fdLbl  = document.getElementById('fdFilterLbl');
    var itmLbl = document.getElementById('itmFilterLbl');
    if (fdLbl)  fdLbl.textContent  = fdF  ? '✕ ' + fdF  : '';
    if (itmLbl) itmLbl.textContent = itmF ? '✕ ' + itmF : '';
    _chartRendering = false;
  }, 60);
}

function highlightChart(chart, activeLabel, activeColor, dimColor) {
  if (!chart || !chart.data) return;
  var labels = chart.data.labels, ds0 = chart.data.datasets[0];
  if (!ds0) return;
  var n = labels.length;
  function toArr(val, len, fallback) {
    if (Array.isArray(val)) return val.slice();
    var v = (val && val !== '') ? val : fallback;
    var arr = []; for (var i = 0; i < len; i++) arr.push(v); return arr;
  }
  if (!ds0._origBgArr) {
    ds0._origBgArr   = toArr(ds0.backgroundColor, n, activeColor + '35');
    ds0._origBordArr = toArr(ds0.borderColor,      n, activeColor);
  }
  if (!activeLabel) {
    ds0.backgroundColor = ds0._origBgArr.slice();
    ds0.borderColor     = ds0._origBordArr.slice();
  } else {
    var origL = chart._origLabels || labels;
    ds0.backgroundColor = origL.map(function(l, i) { return (Array.isArray(l) ? l.join(' ') : l) === activeLabel ? ds0._origBgArr[i] : dimColor; });
    ds0.borderColor     = origL.map(function(l, i) { return (Array.isArray(l) ? l.join(' ') : l) === activeLabel ? ds0._origBordArr[i] : dimColor; });
  }
  chart.update('none');
}

function rebuildTimeCharts(filteredRows, d) {
  var F = d.F;
  var hrA = {};
  filteredRows.forEach(function(r) {
    var raw = S(r[F.failDate]), m = raw.match(/\s(\d{1,2}):\d{2}:\d{2}/);
    hrA[m ? m[1].padStart(2, '0') + 'h' : '??'] = (hrA[m ? m[1].padStart(2, '0') + 'h' : '??'] || 0) + 1;
  });
  if (CHARTS.hr) {
    var hK = Object.keys(hrA).filter(function(k) { return k !== '??'; }).sort();
    var hV = hK.map(function(k) { return hrA[k]; });
    CHARTS.hr.data.labels = hK;
    CHARTS.hr.data.datasets[0].data = hV;
    CHARTS.hr.data.datasets[0].backgroundColor = hV.map(function(v) { return v >= 3 ? '#ff3d5a66' : '#4d79ff30'; });
    CHARTS.hr.data.datasets[0].borderColor = hV.map(function(v) { return v >= 3 ? '#ff3d5a' : '#4d79ff'; });
    CHARTS.hr.update();
  }
  var tA = { '1ºT': 0, '2ºT': 0, '3ºT': 0 };
  filteredRows.forEach(function(r) { var t = getShift(S(r[F.failDate])); tA[t] = (tA[t] || 0) + 1; });
  if (CHARTS.turno) { CHARTS.turno.data.datasets[0].data = ['1ºT', '2ºT', '3ºT'].map(function(k) { return tA[k] || 0; }); CHARTS.turno.update(); }
}

/* ── Stub: IA desativada ── */
async function runAI() { /* diagnóstico IA desativado */ }
function buildLocalDiag() { return ''; }
function renderAlertas() { /* alertas IA desativados */ }

/* ── Aba switchTab ── */
function switchTab(name) {
  ['dash', 'monitor'].forEach(function(n) {
    var btn = document.getElementById('tab-' + n);
    var pan = document.getElementById('panel-' + n);
    if (!btn || !pan) return;
    if (n === name) { btn.classList.add('active'); pan.classList.add('active'); }
    else            { btn.classList.remove('active'); pan.classList.remove('active'); }
  });
  if (name === 'monitor') {
    renderMonitor();
    setTimeout(function() { if (WATERFALL_CHART) WATERFALL_CHART.resize(); }, 100);
  }
}

/* ── Fullscreen ── */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function() {});
  } else {
    stopSlideshow();
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', function() {
  var btn = document.getElementById('btnFullscreen');
  if (document.fullscreenElement) {
    if (btn) { btn.textContent = '⛶✕'; btn.title = 'Sair da tela cheia'; btn.style.color = '#ff6b00'; }
    startSlideshow();
  } else {
    if (btn) { btn.textContent = '⛶'; btn.title = 'Tela cheia'; btn.style.color = ''; }
    stopSlideshow();
  }
});
