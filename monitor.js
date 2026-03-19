/* ═══════════════════════════════════════════════════════════════
   MONITOR.JS — Painel Monitor, velocímetro gauge, waterfall, renderDashRow2
   Dependências: utils.js, config.js, charts.js
═══════════════════════════════════════════════════════════════ */

/* ── Relógio do painel Monitor ── */
(function monClock() {
  function tick() {
    var n = new Date();
    var hh = n.getHours().toString().padStart(2, '0');
    var mm = n.getMinutes().toString().padStart(2, '0');
    var ss = n.getSeconds().toString().padStart(2, '0');
    var cl = document.getElementById('mClock'); if (cl) cl.textContent = hh + ':' + mm + ':' + ss;
    var days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    var months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    var dt = document.getElementById('mDate');
    if (dt) dt.textContent = days[n.getDay()] + ' ' + n.getDate() + ' ' + months[n.getMonth()] + ' ' + n.getFullYear();
  }
  setInterval(tick, 1000); tick();
})();

/* ── Aciona renderMonitor se o painel estiver visível ── */
function pushMonitorData() {
  var pan = document.getElementById('panel-monitor');
  if (pan && pan.classList.contains('active')) renderMonitor();
}

/* ══════════════════════════════════════════
   renderMonitor — KPIs, estações, waterfall, ocorrências
══════════════════════════════════════════ */
function renderMonitor() {
  if (!DATA || !DATA._rawDefRows) return;
  var d = DATA, O = d.O, F = d.F;
  if (!O || !F) return;

  var defRows    = d.defRows    || d._rawDefRows;
  var outRows    = d.outRows    || d._rawOutRows;
  var defRowsKpi = d.defRowsKpi || defRows;
  var woMap      = d.woMap || {};

  /* ── Agrega OUT ── */
  var sO = {};
  outRows.forEach(function(r) {
    var st = S(r[O.st]) || 'N/A';
    if (!sO[st]) sO[st] = { total: 0, pass: 0, fail: 0 };
    sO[st].total += N(r[O.total]); sO[st].pass += N(r[O.pass]); sO[st].fail += N(r[O.fail]);
  });

  /* ── Dedup KPI (sem turno) ── */
  var _mSeenKpi = {};
  var defDedupKpi = defRowsKpi.filter(function(r) {
    var s = S(r[F.serial]); var st = S(r[F.st]) || 'N/A';
    if (!s || s === '') return true;
    var k = s + '\x00' + st; if (_mSeenKpi[k]) return false; _mSeenKpi[k] = true; return true;
  });
  var sDkpi = {};
  defDedupKpi.forEach(function(r) { var st = S(r[F.st]) || 'N/A'; sDkpi[st] = (sDkpi[st] || 0) + 1; });

  /* ── Dedup charts (com turno) ── */
  var _mSeen = {};
  var defDedup = defRows.filter(function(r) {
    var s = S(r[F.serial]); var st = S(r[F.st]) || 'N/A';
    if (!s || s === '') return true;
    var k = s + '\x00' + st; if (_mSeen[k]) return false; _mSeen[k] = true; return true;
  });
  var sD = {};
  defDedup.forEach(function(r) { var st = S(r[F.st]) || 'N/A'; sD[st] = (sD[st] || 0) + 1; });
  if (DATA) { DATA._sD = sD; DATA._defDedup = defDedup; }

  function parcKpi(st) { var df = sDkpi[st] || 0, t = sO[st] ? sO[st].total : 0; return t ? 1 - df / t : null; }
  function parc(st)    { var df = sD[st]    || 0, t = sO[st] ? sO[st].total : 0; return t ? 1 - df / t : null; }
  function prod(vals)  { var v = vals.filter(function(x) { return x !== null && x > 0; }); return v.length ? v.reduce(function(a, x) { return a * x; }, 1) : null; }
  var _mcfg = getCfg();
  var oSMT  = prod(_mcfg.smtSts.map(function(s) { return parcKpi(s); }));
  var oBE   = prod(_mcfg.beSts.map(function(s)  { return parcKpi(s); }));
  var ov    = prod([oSMT, oBE]);
  var taxa  = ov !== null ? +(((1 - ov) * 100).toFixed(2)) : null;
  var packFixed = (DATA._packTotal !== undefined) ? DATA._packTotal : 0;
  var totDedup  = defDedupKpi.length;

  function vc(v)  { return v === null ? 'var(--t3)' : v >= THRESH.green ? 'var(--green)' : v >= THRESH.warn ? 'var(--cyan)' : v >= THRESH.amber ? 'var(--amber)' : 'var(--red)'; }
  function vcl(v) { if (v === null) return ''; if (v >= THRESH.green) return 'ok'; if (v >= THRESH.amber) return 'warn'; return 'crit'; }
  function p2(v)  { return v !== null ? (v * 100).toFixed(2) + '%' : '—'; }

  /* Status dot */
  var dot = document.getElementById('mDot'), txt = document.getElementById('mTxt');
  if (taxa > 3)      { if (dot) dot.className = 'mpulse crit'; if (txt) { txt.textContent = '⚠ CRÍTICO'; txt.style.color = 'var(--red)'; } }
  else if (taxa > 1) { if (dot) dot.className = 'mpulse warn'; if (txt) { txt.textContent = 'MONITORAR'; txt.style.color = 'var(--amber)'; } }
  else               { if (dot) dot.className = 'mpulse';      if (txt) { txt.textContent = 'NORMAL'; txt.style.color = 'var(--green)'; } }

  /* KPI cards */
  function setKpi(idVal, val, idBar, barPct, col) {
    var el = document.getElementById(idVal); if (el) { el.textContent = val; if (col) el.style.color = col; }
    var b  = document.getElementById(idBar);  if (b && col) { b.style.width = barPct + '%'; b.style.background = col; b.style.boxShadow = '0 0 6px ' + col; }
  }
  setKpi('mKpi0', packFixed.toLocaleString('pt-BR'), 'mKb0', 100, 'var(--t2)');
  setKpi('mKpi1', totDedup, 'mKb1', packFixed ? Math.min(100, (totDedup / packFixed) * 100 * 20).toFixed(0) : 0, 'var(--red)');
  var taxaStr = taxa !== null ? taxa.toFixed(2) + '%' : '—';
  setKpi('mKpi2', taxaStr, 'mKb2', taxa !== null ? Math.min(100, taxa * 10).toFixed(0) : 0, 'var(--amber)');
  var sEl = document.getElementById('mVSMT'); if (sEl) { sEl.textContent = p2(oSMT); sEl.style.color = vc(oSMT); }
  var bEl = document.getElementById('mVBE');  if (bEl) { bEl.textContent = p2(oBE);  bEl.style.color = vc(oBE);  }

  /* ── FPY por estação ── */
  var ST_ORDER = ['S_VI_B', 'S_VI_T', 'FVI', 'ICT', 'FBT', 'F1', 'F2', 'FV2', 'PACK', 'PACKING'];
  var _excl = getCfg().excludeSt || [];
  var _matrixSts = getCfg().matrix;
  var _allStSeen2 = {};
  var allSt = [];
  _matrixSts.forEach(function(st) { if (_excl.indexOf(st) === -1) { _allStSeen2[st] = true; allSt.push(st); } });
  Object.keys(sO).forEach(function(s) { if (_excl.indexOf(s) === -1 && !_allStSeen2[s]) { _allStSeen2[s] = true; allSt.push(s); } });
  allSt.sort(function(a, b) {
    var ia = ST_ORDER.indexOf(a), ib = ST_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib;
  });
  var bdStEl = document.getElementById('mBdSt'); if (bdStEl) bdStEl.textContent = allSt.length + ' estações';
  var SMT_STS = getCfg().smtSts;
  var mStGridEl = document.getElementById('mStGrid');
  if (mStGridEl) mStGridEl.innerHTML = allSt.map(function(st) {
    var v = parc(st), df = sD[st] || 0, cls = vcl(v), col = vc(v);
    var fase = SMT_STS.indexOf(st) !== -1 ? 'SMT' : 'B.E';
    var faseCol = SMT_STS.indexOf(st) !== -1 ? 'var(--cyan)' : 'var(--amber)';
    return '<div class="st2-cell ' + cls + '">' +
      '<div class="st2-lbl" style="color:' + faseCol + '">' + fase + '</div>' +
      '<div class="st2-name">' + st + '</div>' +
      '<div class="st2-fpy" style="color:' + col + '">' + p2(v) + '</div>' +
      '<div class="st2-def">' + df + ' falha' + (df !== 1 ? 's' : '') + '</div></div>';
  }).join('');

  /* ── Defeitos por estação ── */
  var mDefLinesEl = document.getElementById('mDefLines');
  if (mDefLinesEl) {
    var maxDf = Math.max.apply(null, allSt.map(function(st) { return sD[st] || 0; }).concat([1]));
    mDefLinesEl.innerHTML = allSt.map(function(st) {
      var df = sD[st] || 0, t = sO[st] ? sO[st].total : 0;
      var rate = t ? ((df / t) * 100).toFixed(2) : null;
      var fpy  = t ? (1 - df / t) : null;
      var fpyCol    = fpy !== null ? vc(fpy) : 'var(--t3)';
      var bw        = maxDf ? Math.round((df / maxDf) * 100) : 0;
      var defCol    = df > 0 ? 'var(--red)' : 'var(--green)';
      var fpyBadgeBg = fpy === null ? '#333' : fpy >= THRESH.green ? '#00e67622' : fpy >= THRESH.amber ? '#ffc40022' : '#ff3d5a22';
      return '<tr>' +
        '<td style="font-weight:700;color:var(--t1);letter-spacing:1px">' + st + '</td>' +
        '<td style="font-family:monospace;color:var(--t2)">' + t.toLocaleString('pt-BR') + '</td>' +
        '<td style="font-family:monospace;font-weight:700;color:' + defCol + '">' + df + '</td>' +
        '<td><div class="mdef-bar-wrap"><div class="mdef-bar-inner" style="width:' + bw + '%"></div></div></td>' +
        '<td style="font-family:monospace;font-weight:700;color:' + (rate !== null && rate > 1 ? 'var(--red)' : 'var(--amber)') + '">' + (rate !== null ? rate + '%' : '—') + '</td>' +
        '<td><span class="mdef-fpy-badge" style="color:' + fpyCol + ';background:' + fpyBadgeBg + '">' + (fpy !== null ? (fpy * 100).toFixed(2) + '%' : 'N/A') + '</span></td>' +
        '</tr>';
    }).join('');
  }

  /* ── Falhas por hora ── */
  var hMap = {};
  defRows.forEach(function(r) { var raw = S(r[F.failDate]); var m = raw.match(/\s(\d{1,2}):/); var h = m ? parseInt(m[1]) : 0; var hk = (h < 10 ? '0' : '') + h + 'h'; hMap[hk] = (hMap[hk] || 0) + 1; });
  var hKeys = Object.keys(hMap).sort();
  var hVals = hKeys.map(function(k) { return hMap[k]; });
  var bdHrEl = document.getElementById('mBdHr'); if (bdHrEl) bdHrEl.textContent = totDedup + ' falhas';
  if (MONITOR_CHART) { MONITOR_CHART.destroy(); MONITOR_CHART = null; }
  var mctx = document.getElementById('mCHour');
  if (mctx) {
    MONITOR_CHART = new Chart(mctx.getContext('2d'), {
      type: 'bar',
      data: { labels: hKeys, datasets: [{ data: hVals,
        backgroundColor: hVals.map(function(v) { return v > 10 ? '#ff2d4a55' : v > 5 ? '#ffb30055' : '#b97fff55'; }),
        borderColor:     hVals.map(function(v) { return v > 10 ? '#ff2d4a'   : v > 5 ? '#ffb300'   : '#b97fff'; }),
        borderWidth: 1, borderRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#3d6480', font: { size: 8 }, maxRotation: 0 }, grid: { color: '#0e2840' } },
          y: { ticks: { color: '#3d6480', font: { size: 8 } }, grid: { color: '#0e2840' }, beginAtZero: true }
        }
      }
    });
  }

  /* ── Waterfall monitor ── */
  (function() {
    var wEl = document.getElementById('mWaterfall');
    if (!wEl || typeof echarts === 'undefined') return;

    var wMap = {};
    defDedup.forEach(function(r) { var v = S(r[F.failDesc]) || 'TBA'; wMap[v] = (wMap[v] || 0) + 1; });
    var baseTotal = 0;
    getCfg().matrix.forEach(function(st) { if (sO[st] && sO[st].total > baseTotal) baseTotal = sO[st].total; });
    if (!baseTotal) baseTotal = Object.keys(sO).reduce(function(m, k) { return Math.max(m, sO[k] ? sO[k].total : 0); }, 1);

    var issues = Object.keys(wMap).map(function(k) { return { k: k, n: wMap[k], loss: +(wMap[k] / baseTotal * 100).toFixed(2) }; });
    issues.sort(function(a, b) { return b.n - a.n; }); issues = issues.slice(0, 10);

    var fpyStart   = ov !== null ? +(ov * 100).toFixed(4) : 100;
    var totalFail  = issues.reduce(function(s, i) { return s + i.n; }, 0);
    var defectRate = 1 - (fpyStart / 100);
    issues.forEach(function(it) { it.loss = totalFail > 0 ? +(defectRate * it.n / totalFail * 100).toFixed(2) : 0; });

    var accCur = fpyStart, accValues = [fpyStart];
    issues.forEach(function(it) { accCur = +(accCur + it.loss).toFixed(4); accValues.push(+accCur.toFixed(2)); });
    var accFinal = accValues[accValues.length - 1];
    if (accFinal > 99.995 && accFinal <= 100.05) accFinal = 100.00;

    var labels = ['FPY'], failQty = [''], fpyLossRow = [''], accRow = [fpyStart.toFixed(2) + '%'], targetRow = ['99,00%'];
    var offsetArr = [0], valArr = [fpyStart], colArr = [fpyStart >= 99 ? '#00e676' : fpyStart >= 98 ? '#ffc400' : '#cc2233'], isNegArr = [false];

    issues.forEach(function(it, idx) {
      labels.push(it.k); failQty.push(it.n); fpyLossRow.push(it.loss.toFixed(2) + '%');
      accRow.push(accValues[idx + 1].toFixed(2) + '%'); targetRow.push('99,00%');
      offsetArr.push(accValues[idx]); valArr.push(it.loss); colArr.push('#ff3d5a'); isNegArr.push(true);
    });

    labels.push('Total'); failQty.push(totalFail); fpyLossRow.push((100 - fpyStart).toFixed(2) + '%');
    accRow.push('100.00%'); targetRow.push('99,00%');
    offsetArr.push(0); valArr.push(100.00);
    colArr.push(accFinal >= 99 ? '#00e676' : accFinal >= 98 ? '#ffc400' : '#ff3d5a'); isNegArr.push(false);

    var acc = accFinal;
    var yMin = Math.floor(fpyStart - 1); if (yMin > 94) yMin = 94; if (yMin < 90) yMin = 90;

    function wrapLbl(v, mx) {
      if (v.length <= mx) return v;
      var words = v.split(/[\s_\-]+/), lines = [], cur = '';
      words.forEach(function(w) { if ((cur + ' ' + w).trim().length > mx && cur) { lines.push(cur.trim()); cur = w; } else { cur = (cur + ' ' + w).trim(); } });
      if (cur) lines.push(cur.trim());
      return lines.join('\n');
    }
    var labelsWrapped = labels.map(function(v) { return wrapLbl(v, 9); });

    if (WATERFALL_CHART) { try { WATERFALL_CHART.dispose(); } catch (e) {} WATERFALL_CHART = null; }
    WATERFALL_CHART = echarts.init(wEl, 'dark');
    WATERFALL_CHART.setOption({
      backgroundColor: 'transparent',
      grid: { top: 36, bottom: 4, left: 52, right: 12, containLabel: false },
      xAxis: { type: 'category', data: labelsWrapped, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#1e3a50' } }, axisTick: { show: false }, splitLine: { show: false } },
      yAxis: { type: 'value', min: yMin, max: 101, axisLabel: { color: '#334155', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } }, axisLine: { lineStyle: { color: '#CBD5E1' } } },
      series: [
        { type: 'bar', stack: 'wf', silent: true, itemStyle: { color: 'transparent' }, data: offsetArr.map(function(v, i) { return isNegArr[i] ? v : 0; }) },
        { type: 'bar', stack: 'wf', barMaxWidth: 50,
          label: { show: true, position: 'top', color: '#0F172A', fontSize: 10, fontWeight: 'normal',
            formatter: function(p) {
              var i = p.dataIndex;
              if (i === 0) return fpyStart.toFixed(2) + '%';
              if (i === labels.length - 1) return '100.00%';
              return issues[i - 1].loss.toFixed(2) + '%';
            }},
          itemStyle: { color: function(p) { return colArr[p.dataIndex]; }, borderRadius: [3, 3, 0, 0] },
          data: valArr.map(function(v, i) { return { value: v, itemStyle: { color: colArr[i], borderRadius: [3, 3, 0, 0] } }; })
        },
        { type: 'line', data: labels.map(function() { return THRESH.target; }), symbol: 'none', lineStyle: { color: '#1e3a5f', width: 2, type: 'dashed' }, z: 10, silent: true, name: 'Meta 99%' }
      ],
      tooltip: {
        trigger: 'axis', backgroundColor: '#ffffffee', borderColor: '#CBD5E1', textStyle: { color: '#0F172A', fontSize: 10 },
        formatter: function(params) {
          var i = params[0].dataIndex;
          if (i === 0) return '<b>FPY Inicial</b><br/>Overall: <b style="color:#ff4455">' + fpyStart.toFixed(2) + '%</b>';
          if (i === labels.length - 1) return '<b>Total Final</b><br/>FPY: <b style="color:' + colArr[i] + '">' + acc.toFixed(2) + '%</b>';
          var it = issues[i - 1];
          return '<b>' + it.k + '</b><br/>Fail Qty: <b>' + it.n + '</b><br/>FPY Loss: <b style="color:#ff4455">-' + it.loss.toFixed(2) + '%</b><br/>ACC: <b style="color:#ffc400">' + accValues[i].toFixed(2) + '%</b>';
        }
      }
    });

    /* Tabela embaixo do gráfico */
    var tblDiv = document.getElementById('mWaterfallTable');
    if (tblDiv) {
      function getAccColor(v) { var num = parseFloat(v); return num >= 99 ? '#00e676' : num >= 98 ? '#ffc400' : '#ff3d5a'; }
      var accRowWithColors = accRow.map(function(v) { return { val: v, col: getAccColor(v) }; });
      var rows = [
        { label: 'Fail Qty',     color: '#5a8aaa', vals: failQty,            dynamic: false },
        { label: 'FPY/FPY Loss', color: '#ccaa00', vals: fpyLossRow,         dynamic: false },
        { label: 'ACC',          color: '#00cc66', vals: accRowWithColors,   dynamic: true  },
        { label: 'Target',       color: '#4488ff', vals: targetRow,          dynamic: false }
      ];
      var html = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden">';
      html += '<tr><td style="width:90px;border-bottom:2px solid #1e3a5f;border-right:1px solid #CBD5E1;background:#F1F5F9"></td>';
      labels.forEach(function(l) {
        var words = l.split(/[\s\-_]+/), mid = Math.ceil(words.length / 2);
        var txt = words.length >= 2 ? words.slice(0, mid).join(' ') + '<br>' + words.slice(mid).join(' ') : l;
        html += '<td style="text-align:center;color:#0F172A;font-weight:700;padding:4px 2px;font-size:9px;line-height:1.3;vertical-align:middle;border-bottom:2px solid #1e3a5f;border-left:1px solid #E2E8F0" title="' + l + '">' + txt + '</td>';
      });
      html += '</tr>';
      rows.forEach(function(row) {
        html += '<tr><td style="color:' + row.color + ';font-weight:700;font-size:10px;padding:3px 6px;white-space:nowrap;border-right:1px solid #CBD5E1;background:#F8FAFC">' + row.label + '</td>';
        row.vals.forEach(function(v) {
          var vStr, cellColor;
          if (row.dynamic && v && typeof v === 'object') { vStr = v.val === '' || v.val === 0 ? '' : String(v.val); cellColor = v.col; }
          else { vStr = v === '' || v === 0 ? '' : String(v); cellColor = row.color; }
          html += '<td style="text-align:center;color:' + cellColor + ';padding:3px 2px;font-family:IBM Plex Mono,monospace;font-size:10px;font-weight:500;border-left:1px solid #E2E8F0">' + vStr + '</td>';
        });
        html += '</tr>';
      });
      html += '</table>';
      tblDiv.innerHTML = html;
    }
    window.addEventListener('resize', function() { if (WATERFALL_CHART) WATERFALL_CHART.resize(); });
  })();

  /* ── Top 10 causas ── */
  var fdMap = {};
  defRows.forEach(function(r) { var v = S(r[F.failDesc]) || 'TBA'; fdMap[v] = (fdMap[v] || 0) + 1; });
  var topFd = Object.keys(fdMap).map(function(k) { return { k: k, v: fdMap[k] }; }).sort(function(a, b) { return b.v - a.v; }).slice(0, 10);
  var maxV  = topFd.length ? topFd[0].v : 1;
  var mParetoEl = document.getElementById('mPareto');
  if (mParetoEl) mParetoEl.innerHTML = topFd.map(function(it) {
    var p2x = Math.round((it.v / maxV) * 100);
    return '<div class="mc-pr"><div class="mc-pl" title="' + it.k + '">' + it.k + '</div>' +
      '<div class="mc-pb"><div class="mc-pbi" style="width:' + p2x + '%"></div></div>' +
      '<div class="mc-pv">' + it.v + '</div></div>';
  }).join('');

  /* ── Ocorrências recentes ordenadas por hora ── */
  var allOcc = defRows.map(function(r) {
    var ser = S(r[F.serial]) || '—', fd = S(r[F.failDesc]) || 'TBA';
    var st  = S(r[F.st]) || '—', rawItm = S(r[F.item]);
    var itm = (rawItm && rawItm.trim() !== '') ? rawItm : 'TBA';
    var wo  = S(r[F.wo]) || '';
    var mod = (woMap[wo] && woMap[wo].modelo && woMap[wo].modelo.trim() !== '' ? woMap[wo].modelo : '') || S(r['_modelo']) || 'TBA';
    var raw = S(r[F.failDate]), mh = raw.match(/(\d{1,2}:\d{2})/);
    var hora = mh ? mh[1].slice(0, 5) : '00:00';
    var parts = hora.split(':');
    return { ser: ser, fd: fd, st: st, itm: itm, mod: mod, hora: hora, min: parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0) };
  });
  allOcc.sort(function(a, b) { return b.min - a.min; });
  var firstSer = allOcc.length ? allOcc[0].ser : '';
  var isNew = firstSer && firstSer !== M_LAST_SER; M_LAST_SER = firstSer;
  var mRecentEl = document.getElementById('mRecent');
  if (mRecentEl) mRecentEl.innerHTML = allOcc.map(function(r, i) {
    var rowCls = (i === 0 && isNew) ? 'class="mnew"' : '';
    return '<tr ' + rowCls + '>' +
      '<td style="color:var(--t1);font-size:9px;font-family:monospace">' + r.ser.slice(-10) + '</td>' +
      '<td style="color:var(--cyan);font-size:9px;font-family:monospace;font-weight:700">' + r.hora + '</td>' +
      '<td style="color:var(--cyan);font-weight:700">' + r.st + '</td>' +
      '<td style="color:var(--amber);font-weight:700" title="' + r.fd + '">' + r.fd.slice(0, 18) + '</td>' +
      '<td style="color:var(--t2);font-size:9px" title="' + r.mod + '">' + r.mod.slice(0, 14) + '</td>' +
      '<td style="color:var(--t2)">' + r.itm.slice(0, 10) + '</td></tr>';
  }).join('');
  var bdRecEl = document.getElementById('mBdRec'); if (bdRecEl) bdRecEl.textContent = allOcc.length + ' falhas';

  drawGauge(ov);
}

/* ══════════════════════════════════════════
   VELOCÍMETRO OVERALL (canvas)
══════════════════════════════════════════ */
function drawGauge(val) {
  var cvs = document.getElementById('mGaugeCanvas'); if (!cvs) return;
  var ctx = cvs.getContext('2d'), W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);
  var cx = W / 2, cy = H - 8, R = 94;
  var startA = Math.PI * (1 + 0.15), endA = Math.PI * (2 - 0.15);
  var pct = val !== null ? val * 100 : 0;
  var col = pct >= 99 ? '#00e676' : pct >= 98 ? '#ffc400' : '#ff3d5a';

  ctx.beginPath(); ctx.arc(cx, cy, R, startA, endA);
  ctx.strokeStyle = '#162030'; ctx.lineWidth = 20; ctx.lineCap = 'butt'; ctx.stroke();

  var frac = val !== null ? Math.max(0, Math.min(1, (pct - 95) / 5)) : 0;
  if (frac > 0) {
    var zones = [{ from: 0, to: 0.4, c0: '#ff3d5a', c1: '#ff7040' }, { from: 0.4, to: 0.6, c0: '#ff9020', c1: '#ffc400' }, { from: 0.6, to: 1.0, c0: '#80e060', c1: '#00e676' }];
    zones.forEach(function(z) {
      if (frac <= z.from) return;
      var zf = Math.min(frac, z.to), a0 = startA + (endA - startA) * z.from, a1 = startA + (endA - startA) * zf;
      var gr = ctx.createLinearGradient(cx + R * Math.cos(a0), cy + R * Math.sin(a0), cx + R * Math.cos(a1), cy + R * Math.sin(a1));
      gr.addColorStop(0, z.c0); gr.addColorStop(1, z.c1);
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.strokeStyle = gr; ctx.lineWidth = 20; ctx.lineCap = 'butt'; ctx.stroke();
    });
  }

  var ticks = [{ v: 95, l: '95%', maj: true }, { v: 96, l: '', maj: false }, { v: 97, l: '97', maj: true }, { v: 98, l: '98', maj: true }, { v: 99, l: '99', maj: true }, { v: 100, l: '100%', maj: true }];
  ticks.forEach(function(m) {
    var f = (m.v - 95) / 5, a = startA + (endA - startA) * f;
    var r1 = m.maj ? R - 14 : R - 8, r2 = R + 6;
    ctx.beginPath(); ctx.moveTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); ctx.lineTo(cx + r2 * Math.cos(a), cy + r2 * Math.sin(a));
    ctx.strokeStyle = m.maj ? '#3a5575' : '#243545'; ctx.lineWidth = m.maj ? 2 : 1; ctx.stroke();
    if (m.l) { ctx.fillStyle = '#4a7090'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillText(m.l, cx + (R + 22) * Math.cos(a), cy + (R + 22) * Math.sin(a) + 3); }
  });

  ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = '#ff3d5a66'; ctx.fillText('CRIT', cx - R * 0.60, cy - 10);
  ctx.fillStyle = '#ffc40055'; ctx.fillText('ATEN', cx, cy - R * 0.36 - 4);
  ctx.fillStyle = '#00e67666'; ctx.fillText('OK', cx + R * 0.60, cy - 10);

  if (val !== null) {
    var nfrac = Math.max(0, Math.min(1, (pct - 95) / 5));
    var na = startA + (endA - startA) * nfrac;
    var tipX = cx + (R - 24) * Math.cos(na), tipY = cy + (R - 24) * Math.sin(na);
    var baseX = cx + 8 * Math.cos(na + Math.PI), baseY = cy + 8 * Math.sin(na + Math.PI);
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(tipX, tipY); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fillStyle = col; ctx.shadowBlur = 16; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = '#060d18'; ctx.shadowBlur = 0; ctx.fill();
    ctx.restore();
  }

  var vEl = document.getElementById('mVOv');
  if (vEl) { vEl.textContent = val !== null ? pct.toFixed(2) + '%' : '—'; vEl.style.color = col; vEl.style.textShadow = '0 0 24px ' + col + '88'; }
}

/* ══════════════════════════════════════════
   renderDashRow2 — Defeitos por Estação + Waterfall no Dashboard
══════════════════════════════════════════ */
function renderDashRow2(stOut, stDef, defDedup, ov) {
  /* ── Tabela de defeitos por estação ── */
  var d2 = document.getElementById('dashDefLines');
  if (d2 && stOut) {
    var cfg = getCfg();
    var allSt = cfg.matrix || Object.keys(stOut);
    var maxDf = Math.max.apply(null, allSt.map(function(st) { return stDef[st] || 0; }).concat([1]));
    d2.innerHTML = allSt.map(function(st) {
      var df = stDef[st] || 0, t = stOut[st] ? stOut[st].total : 0;
      var rate    = t ? ((df / t) * 100).toFixed(2) : null;
      var fpy     = t ? (1 - df / t) : null;
      var fpyCol  = fpy === null ? '#64748B' : fpy >= THRESH.green ? '#047857' : fpy >= THRESH.warn ? '#B45309' : '#8b1a1a';
      var bw      = maxDf ? Math.round((df / maxDf) * 100) : 0;
      var defCol  = df > 0 ? '#8b1a1a' : '#047857';
      var rateCol = (rate !== null && parseFloat(rate) > 1) ? '#8b1a1a' : '#B45309';
      var fpyBg   = fpy === null ? '#F1F5F9' : fpy >= THRESH.green ? '#ECFDF5' : fpy >= THRESH.amber ? '#FFFBEB' : '#FEF2F2';
      return '<tr>' +
        '<td style="font-weight:700;color:#0F172A;letter-spacing:0.5px;font-size:11px">' + st + '</td>' +
        '<td style="font-family:IBM Plex Mono,monospace;color:#334155">' + fmt(t) + '</td>' +
        '<td style="font-family:IBM Plex Mono,monospace;font-weight:700;color:' + defCol + '">' + df + '</td>' +
        '<td><div style="width:100%;height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden"><div style="width:' + bw + '%;height:100%;background:' + (df > 0 ? '#8b1a1a' : '#047857') + ';border-radius:4px;transition:width 0.6s ease"></div></div></td>' +
        '<td style="font-family:IBM Plex Mono,monospace;font-weight:700;color:' + rateCol + '">' + (rate !== null ? rate + '%' : '—') + '</td>' +
        '<td><span style="font-family:IBM Plex Mono,monospace;font-weight:700;color:' + fpyCol + ';background:' + fpyBg + ';padding:2px 8px;border-radius:4px;font-size:11px">' + (fpy !== null ? (fpy * 100).toFixed(2) + '%' : 'N/A') + '</span></td>' +
        '</tr>';
    }).join('');
  }

  /* ── Waterfall no dashboard ── */
  var wEl2 = document.getElementById('dashWaterfall');
  var tEl2 = document.getElementById('dashWaterfallTable');
  if (!wEl2 || typeof echarts === 'undefined') return;
  var F = DATA && DATA.F; if (!F) return;

  var wMap = {};
  defDedup.forEach(function(r) { var v = S(r[F.failDesc]) || 'TBA'; wMap[v] = (wMap[v] || 0) + 1; });
  var baseTotal = 0;
  getCfg().matrix.forEach(function(st) { if (stOut[st] && stOut[st].total > baseTotal) baseTotal = stOut[st].total; });
  if (!baseTotal) baseTotal = 1;

  var issues = Object.keys(wMap).map(function(k) { return { k: k, n: wMap[k], loss: 0 }; });
  issues.sort(function(a, b) { return b.n - a.n; }); issues = issues.slice(0, 10);
  var fpyStart   = ov !== null && ov !== undefined ? +(ov * 100).toFixed(4) : 100;
  var totalFail  = issues.reduce(function(s, i) { return s + i.n; }, 0);
  var defectRate = 1 - (fpyStart / 100);
  issues.forEach(function(it) { it.loss = totalFail > 0 ? +(defectRate * it.n / totalFail * 100).toFixed(2) : 0; });

  var accCur = fpyStart, accValues = [fpyStart];
  issues.forEach(function(it) { accCur = +(accCur + it.loss).toFixed(4); accValues.push(+accCur.toFixed(2)); });
  var accFinal = accValues[accValues.length - 1];
  if (accFinal > 99.995 && accFinal <= 100.05) accFinal = 100.00;

  var labels = ['FPY'].concat(issues.map(function(it) { return it.k; })).concat(['Total']);
  var colArr = [fpyStart >= 99 ? '#00e676' : fpyStart >= 98 ? '#ffc400' : '#cc2233'];
  issues.forEach(function() { colArr.push('#dc2f02'); });
  colArr.push(accFinal >= 99 ? '#00e676' : accFinal >= 98 ? '#ffc400' : '#dc2f02');

  var offsetArr = [0], valArr = [fpyStart], isNegArr = [false];
  issues.forEach(function(it, idx) { offsetArr.push(accValues[idx]); valArr.push(it.loss); isNegArr.push(true); });
  offsetArr.push(0); valArr.push(100); isNegArr.push(false);

  var yMin = Math.floor(fpyStart - 1); if (yMin > 94) yMin = 94; if (yMin < 90) yMin = 90;

  function wrapLbl2(v, mx) {
    if (v.length <= mx) return v;
    var words = v.split(/[\s_\-]+/), lines = [], cur = '';
    words.forEach(function(w) { if ((cur + ' ' + w).trim().length > mx && cur) { lines.push(cur.trim()); cur = w; } else { cur = (cur + ' ' + w).trim(); } });
    if (cur) lines.push(cur.trim()); return lines.join('\n');
  }
  var labelsWrapped = labels.map(function(v) { return wrapLbl2(v, 9); });

  if (window._dashWF) { try { window._dashWF.dispose(); } catch (e) {} window._dashWF = null; }
  window._dashWF = echarts.init(wEl2, 'dark');
  window._dashWF.setOption({
    backgroundColor: 'transparent',
    grid: { top: 30, bottom: 4, left: 95, right: 12, containLabel: false },
    xAxis: { type: 'category', data: labelsWrapped, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'value', min: yMin, max: 101, axisLabel: { color: '#334155', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } }, axisLine: { lineStyle: { color: '#CBD5E1' } } },
    series: [
      { type: 'bar', stack: 'wf', silent: true, itemStyle: { color: 'transparent' }, data: offsetArr.map(function(v, i) { return isNegArr[i] ? v : 0; }) },
      { type: 'bar', stack: 'wf', barMaxWidth: 48,
        label: { show: true, position: 'top', color: '#0F172A', fontSize: 9, fontWeight: 'normal',
          formatter: function(p) {
            var i = p.dataIndex;
            if (i === 0) return fpyStart.toFixed(2) + '%';
            if (i === labels.length - 1) return '100.00%';
            return issues[i - 1].loss.toFixed(2) + '%';
          }},
        itemStyle: { color: function(p) { return colArr[p.dataIndex]; }, borderRadius: [3, 3, 0, 0] },
        data: valArr.map(function(v, i) { return { value: v, itemStyle: { color: colArr[i], borderRadius: [3, 3, 0, 0] } }; })
      },
      { type: 'line', data: labels.map(function() { return THRESH.target; }), symbol: 'none', lineStyle: { color: '#1e3a5f', width: 2, type: 'dashed' }, z: 10, silent: true, name: 'Meta 99%' }
    ],
    tooltip: {
      trigger: 'axis', backgroundColor: '#ffffffee', borderColor: '#CBD5E1', textStyle: { color: '#0F172A', fontSize: 10 },
      formatter: function(params) {
        var i = params[0].dataIndex;
        if (i === 0) return '<b>FPY Inicial</b><br/>Overall: <b style="color:#8b1a1a">' + fpyStart.toFixed(2) + '%</b>';
        if (i === labels.length - 1) return '<b>Total Final</b><br/>FPY: <b style="color:' + colArr[i] + '">' + accFinal.toFixed(2) + '%</b>';
        var it = issues[i - 1]; return '<b>' + it.k + '</b><br/>Qty: <b>' + it.n + '</b><br/>Loss: <b style="color:#8b1a1a">-' + it.loss.toFixed(2) + '%</b><br/>ACC: <b style="color:#047857">' + accValues[i].toFixed(2) + '%</b>';
      }
    }
  });

  /* Tabela do dashboard waterfall */
  if (tEl2) {
    var fpyLossRow = [''].concat(issues.map(function(it) { return it.loss.toFixed(2) + '%'; })).concat([(100 - fpyStart).toFixed(2) + '%']);
    var accRow2    = [fpyStart.toFixed(2) + '%'].concat(accValues.slice(1).map(function(v) { return v.toFixed(2) + '%'; }));
    var failQty2   = [''].concat(issues.map(function(it) { return it.n; })).concat([totalFail]);
    var targetRow2 = labels.map(function() { return '99,00%'; });
    function accCol(v) { var n = parseFloat(v); return n >= 99 ? '#047857' : n >= 98 ? '#B45309' : '#8b1a1a'; }
    var rows2 = [
      { label: 'Fail Qty',     color: '#1e3a5f', vals: failQty2,   dyn: false },
      { label: 'FPY/FPY Loss', color: '#B45309', vals: fpyLossRow, dyn: false },
      { label: 'ACC',          color: '#047857', vals: accRow2,     dyn: true  },
      { label: 'Target',       color: '#1e3a5f', vals: targetRow2, dyn: false  }
    ];
    var h2 = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;border-top:1px solid #E2E8F0">';
    h2 += '<tr><td style="width:90px;border-bottom:2px solid #1e3a5f;border-right:1px solid #CBD5E1;background:#F1F5F9"></td>';
    labels.forEach(function(l) {
      var words = l.split(/[\s\-_]+/), mid = Math.ceil(words.length / 2);
      var txt = words.length >= 2 ? words.slice(0, mid).join(' ') + '<br>' + words.slice(mid).join(' ') : l;
      h2 += '<td style="text-align:center;color:#0F172A;font-weight:700;padding:4px 2px;font-size:9px;line-height:1.3;vertical-align:middle;border-bottom:2px solid #1e3a5f;border-left:1px solid #E2E8F0" title="' + l + '">' + txt + '</td>';
    });
    h2 += '</tr>';
    rows2.forEach(function(row) {
      h2 += '<tr><td style="color:' + row.color + ';font-weight:700;font-size:10px;padding:3px 6px;white-space:nowrap;border-right:1px solid #CBD5E1;background:#F8FAFC">' + row.label + '</td>';
      row.vals.forEach(function(v) {
        var vStr = (v === '' || v === 0) ? '' : String(v);
        var col  = row.dyn ? accCol(vStr) : row.color;
        h2 += '<td style="text-align:center;color:' + col + ';padding:3px 2px;font-family:IBM Plex Mono,monospace;font-size:10px;font-weight:500;border-left:1px solid #E2E8F0">' + vStr + '</td>';
      });
      h2 += '</tr>';
    });
    h2 += '</table>';
    tEl2.innerHTML = h2;
  }
  window.addEventListener('resize', function() { if (window._dashWF) window._dashWF.resize(); });
}
