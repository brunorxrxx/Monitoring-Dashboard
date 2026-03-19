/* ═══════════════════════════════════════════════════════════════
   PARSER.JS — Leitura de arquivos XLSX e normalização de dados
   Dependências: utils.js, config.js
═══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════
   PARSER XLSX PADRÃO FOXCONN
   Row[0] = título (ignorado)
   Row[1] = headers (com deduplicação)
   Row[2+] = dados
   FALHAS: "Description" aparece 2x → dedup para "Description" e "Description_1"
══════════════════════════════════════════ */
function loadXL(input, key) {
  var file = input.files[0];
  if (!file) return;

  var nEl = document.getElementById('n-' + key);
  var cEl = document.getElementById('c-' + key);
  if (nEl) nEl.textContent = '⏳ Lendo ' + file.name + '...';

  var reader = new FileReader();
  reader.onerror = function() {
    if (nEl) { nEl.style.color = '#ff3d5a'; nEl.textContent = '❌ Erro ao ler arquivo'; }
  };
  reader.onload = function(e) {
    try {
      if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada');
      var wb  = XLSX.read(e.target.result, { type: 'binary', cellDates: false, raw: false });
      var ws  = wb.Sheets[wb.SheetNames[0]];
      var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
      if (!aoa || aoa.length < 3) {
        if (nEl) { nEl.style.color = '#ff3d5a'; nEl.textContent = '❌ Estrutura inválida — requer 3+ linhas'; }
        return;
      }

      /* Deduplica headers */
      var rawH = (aoa[1] || []).map(function(h) { return String(h == null ? '' : h).trim(); });
      var seen = {}, headers = rawH.map(function(h) {
        if (seen[h] === undefined) { seen[h] = 0; return h; }
        seen[h]++; return h + '_' + seen[h];
      });

      /* Constrói array de objetos */
      var rows = [];
      for (var i = 2; i < aoa.length; i++) {
        var r = aoa[i], hasVal = false;
        for (var j = 0; j < r.length; j++) { if (r[j] !== '' && r[j] !== null && r[j] !== undefined) { hasVal = true; break; } }
        if (!hasVal) continue;
        var obj = {};
        headers.forEach(function(h, k) { obj[h] = (r[k] !== undefined && r[k] !== null) ? r[k] : ''; });
        rows.push(obj);
      }
      RAW[key] = { headers: headers, rows: rows };
      if (nEl) { nEl.style.color = ''; nEl.textContent = '✅ ' + file.name + ' — ' + rows.length + ' registros'; }
      if (cEl) cEl.classList.add('done');
      checkReady();
    } catch (err) {
      if (nEl) { nEl.style.color = '#ff3d5a'; nEl.textContent = '❌ Erro: ' + err.message; }
      console.error('[loadXL]', err);
    }
  };
  reader.readAsBinaryString(file);
}

/* ── checkReady padrão (ACER/HP): OUT obrigatório, FALHAS opcional ── */
function checkReady() {
  var ok = !!(RAW.out);
  var btnGo = document.getElementById('btnGo');
  if (btnGo) btnGo.disabled = !ok;
  var hint = document.getElementById('hint');
  if (hint) hint.textContent = ok
    ? (RAW.def
        ? '✓ Arquivos prontos — clique em GERAR DASHBOARD'
        : '✓ Sem arquivo de falhas? OK — zero defeitos assumido. Clique em GERAR')
    : 'Aguardando OUTPUT...';
  if (ok) {
    if (!RAW.def) {
      RAW.def = {
        headers: ['Serial', 'Work Order', 'Failure Code', 'Description',
          'Line', 'Test station', 'Failure date', 'Repair station', 'Reason Code', 'Description_1', 'Item'],
        rows: []
      };
    }
    setStatus('warn', 'Pronto para gerar');
  }
}

/* ── Separador Item / Description_1 do REPAIRCOMMENT (ASUS L10) ──
   "PMU1 DEFEITO ELÉTRICO"  → item=PMU1,  desc=DEFEITO ELÉTRICO
   "P1Q1071-CURTO DE SOLDA" → item=P1Q1071, desc=CURTO DE SOLDA
   "AL9-DESLOCADO"          → item=AL9,   desc=DESLOCADO
   "NDF"                    → item=NDF,   desc=TBA
*/
function parseRepairComment(rc) {
  if (!rc || !rc.trim()) return { item: 'TBA', desc: 'TBA' };
  var s = rc.trim();
  var idx = s.indexOf(' - ');
  if (idx > 0) return { item: s.slice(0, idx).trim(), desc: s.slice(idx + 3).trim() || 'TBA' };
  idx = s.indexOf('-');
  if (idx > 0) return { item: s.slice(0, idx).trim(), desc: s.slice(idx + 1).trim() || 'TBA' };
  idx = s.indexOf(' ');
  if (idx > 0) return { item: s.slice(0, idx).trim(), desc: s.slice(idx + 1).trim() || 'TBA' };
  return { item: s, desc: 'TBA' };
}

/* ── resetAll — limpa estado para novo upload ── */
function resetAll() {
  ['out', 'def'].forEach(function(k) {
    RAW[k] = null;
    var c = document.getElementById('c-' + k); if (c) c.classList.remove('done');
    var n = document.getElementById('n-' + k); if (n) n.textContent = 'Nenhum arquivo';
    var f = document.getElementById('f-' + k); if (f) f.value = '';
  });
  show('upZone'); hide('dash'); hide('errBox');
  var hb = document.getElementById('hBtnUpload'); if (hb) hb.style.display = 'none';
  if (IS_ADMIN) {
    var fpb = document.getElementById('fixedPublishBtn');
    if (fpb) { fpb.style.display = 'flex'; setTimeout(updateFixedPublishBtn, 100); }
  }
  var hint = document.getElementById('hint');
  if (hint) hint.textContent = 'Carregue os 2 arquivos para habilitar';
  setStatus('', 'Aguardando dados');
  killCharts(); DATA = {}; MS_STATE = {}; CHART_FILTER = { fd: null, itm: null };
}
