/* ═══════════════════════════════════════════════════════════════
   CLIENTS/ASUS.JS — Pipeline ASUS (L6 + L10 ASP)
   Dependências: utils.js, config.js, parser.js, run.js, supabase.js
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   FIM HUAWEI
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   ASUS — Upload, Parse, Generate
   L6: Output + Falhas (xlsx padrão)
   L10: Output (TUF 5 estações / PRIME 4 estações) + Falhas (.asp HTML)
   Estações yield: FT1, FT2
   Estações SMT: S_VI_B, S_VI_T, ICT  |  Produção SMT: S_VI_T  |  Produção BE: AVIPK
═══════════════════════════════════════════════════════════════ */

var RAW_AS = { outL6: null, defL6: null, outL10: null, defL10: null };

/* ── Mapa PN → Modelo ASUS ──
   Usado para replace de Model Name (L6) e SKUNO (L10 ASP) */
var ASUS_PN_MAP = {
  /* L6 P/N */
  '59MB0Y90-MB0B01S': 'PRIME J4005I-C/BR',
  '59MB13T0-MB0A01S': 'TUF GAMING X570-PLUS/BR',
  '59MB14AB-MB0B01S': 'TUF GAMING B550M-PLUS',
  '60MB14AB-MB0B3Q':  'TUF GAMING B550M-PLUS',
  '59MB151B-MB0B01S': 'PRIME A520M-E',
  '59MB17WB-MB0A01S': 'PRIME B450M-GAMING II',
  '59MB18UB-MB0A01S': 'TUF GAMING Z690-PLUS D4',
  '59MB19NB-MB0A01S': 'PRIME H610M-E D4',
  '59MB17EB-MB0A04S': 'PRIME H510M-E',
  '59MB1BJB-MB0A02S': 'TUF GAMING X670E-PLUS',
  '59MB1BGB-MB0A01S': 'TUF GAMING B650M-PLUS',
  '59MB14IB-MB0A01S': 'PRIME B550M-A',
  '59MB1E8B-MB0B01S': 'PRIME H510M-K R2.0',
  '59MB1K7B-MB0A01S': 'PRIME H610M-EC D4',
  '59MB1B6B-MB0A01S': 'PRIME H610M-CS D4',
  /* L10 P/N (SKUNO) */
  '90MB0Y90-C1BAY0':  'PRIME J4005I-C/BR',
  '90MB13T0-C1BAY0':  'TUF GAMING X570-PLUS/BR',
  '90MB14A0-C1BAY0':  'TUF GAMING B550M-PLUS',
  '90MB1510-C1BAY0':  'PRIME A520M-E',
  '90MB17W0-C1BAY0':  'PRIME B450M-GAMING II',
  '90MB18U0-C1BAY0':  'TUF GAMING Z690-PLUS D4',
  '90MB19N0-C1BAY0':  'PRIME H610M-E D4',
  '90MB17E0-C1BAY0':  'PRIME H510M-E',
  '90MB1BJ0-C1BAY0':  'TUF GAMING X670E-PLUS',
  '90MB1BG0-C1BAY0':  'TUF GAMING B650M-PLUS',
  '90MB14I0-C1BAY0':  'PRIME B550M-A',
  '90MB1E80-C1BAY0':  'PRIME H510M-K R2.0',
  '90MB1K70-C1BCY0':  'PRIME H610M-EC D4',
  '90MB1B60-C1BAY0':  'PRIME H610M-CS D4'
};

function asusModelName(pn) {
  if (!pn) return pn;
  var p = String(pn).trim();
  return ASUS_PN_MAP[p] || p; /* retorna o modelo ou mantém o PN se não encontrar */
}


/* ── Template ASUS L10 (base64 do xlsx oficial) ── */
var ASUS_L10_TEMPLATE_B64 = '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';

function downloadAsusL10Template() {
  var bin = atob(ASUS_L10_TEMPLATE_B64);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  var blob = new Blob([arr], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'TEMPLATE_OUTPUT_L10_ASUS.xlsx';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(a.href);
  showToast('✅ Template ASUS L10 baixado!', 'ok');
}

/* ── Monta cards de upload ASUS ── */
function buildAsusUploadCards() {
  var btnL10 =
    '<button onclick="downloadAsusL10Template()" style="flex:1;background:rgba(30,58,95,0.1);border:1px solid var(--cyan);' +
    'color:var(--cyan);padding:5px 10px;border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;">⬇ TEMPLATE</button>' +
    '<button onclick="document.getElementById(\'f-as-outL10\').click()" style="flex:1;background:rgba(255,255,255,0.06);' +
    'border:1px solid var(--ln2);color:var(--t1);padding:5px 10px;border-radius:6px;font-size:10px;cursor:pointer;">📂 CARREGAR</button>';

  return '<div class="up-grid hw-grid">' +
    buildUploadCard({id:'c-as-outL6', badge:'01 · OUTPUT L6 · ASUS',
      title:'Output_ASUS_L6.xlsx',
      subtitle:'Line · Work Order · Model Name<br>Test station · Placa Passou · Total · FPY',
      fileId:'f-as-outL6', accept:'.xlsx,.xls', onChange:'loadAS(this,\'outL6\')',
      iconType:'default'
    }) +
    buildUploadCard({id:'c-as-defL6', badge:'02 · FALHAS L6 · ASUS',
      title:'Falhas_L6_ASUS.xlsx',
      subtitle:'Serial · Work Order · Failure Code<br>Test station · Failure date · Item',
      fileId:'f-as-defL6', accept:'.xlsx,.xls', onChange:'loadAS(this,\'defL6\')',
      optional:true, iconType:'warning', dragText:'Opcional — arraste ou clique'
    }) +
    buildUploadCard({id:'c-as-outL10', badge:'03 · OUTPUT L10 · ASUS · TUF + PRIME',
      title:'OUTPUT_L10_ASUS.xlsx',
      subtitle:'TUF: AVI · FT1 · FT2 · AUTO_OBA · AVIPK<br>PRIME: AVI · FT2 · AUTO_OBA · AVIPK<br><span style="color:var(--t3)">Primeira coluna = Modelo</span>',
      fileId:'f-as-outL10', accept:'.xlsx,.xls', onChange:'loadAS(this,\'outL10\')',
      iconType:'template', extraBtns:btnL10, dragText:'Baixe o template, preencha e carregue'
    }) +
    buildUploadCard({id:'c-as-defL10', badge:'04 · FALHAS L10 · ASUS · ASP',
      title:'sfcmondailyfailurerpt.asp',
      subtitle:'SYSSERIALNO · WORKORDERNO · DESCRIPTION<br>FAILUREEVENTPOINT · REPAIRCOMMENT<br><b>Formato HTML exportado do SFC</b>',
      fileId:'f-as-defL10', accept:'.asp,.html,.htm,.xls', onChange:'loadAsusDefL10(this)',
      optional:true, iconType:'warning', dragText:'Opcional — arquivo ASP/HTML do SFC'
    }) +
  '</div>';
}


function loadAS(input, key) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(e.target.result, {type:'binary'});
      if (key === 'outL10') {
        /* L10 tem abas TUF e PRIME — lê as duas e combina */
        var rows = [];
        ['TUF','PRIME'].forEach(function(aba) {
          if (wb.SheetNames.indexOf(aba) === -1) return;
          var ws = wb.Sheets[aba];
          var raw = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          /* Linha 1 = título, linha 2 = headers */
          var hdrs = raw[1] ? raw[1].map(function(h){ return String(h).trim(); }) : [];
          for (var i = 2; i < raw.length; i++) {
            var r = raw[i];
            if (!r || !r.some(function(v){ return v !== ''; })) continue;
            var obj = {};
            hdrs.forEach(function(h, ci){ obj[h] = r[ci] !== undefined ? r[ci] : ''; });
            obj['_aba'] = aba; /* TUF ou PRIME */
            rows.push(obj);
          }
        });
        RAW_AS.outL10 = { headers: [], rows: rows };
      } else {
        /* L6 output/falhas — formato padrão, linha 1 = headers */
        var ws = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        /* Detecta se linha 1 é título (não tem 'Line' nem 'Work Order') e headers ficam na linha 2 */
        var hdrRow = 0;
        if (raw[0] && raw[1]) {
          var r0 = raw[0].map(function(v){ return String(v).toLowerCase(); }).join(' ');
          var r1 = raw[1].map(function(v){ return String(v).toLowerCase(); }).join(' ');
          if (r1.indexOf('line') !== -1 || r1.indexOf('work order') !== -1 || r1.indexOf('model') !== -1 || r1.indexOf('serial') !== -1 || r1.indexOf('test station') !== -1) {
            hdrRow = 1; /* headers na linha 2 */
          }
        }
        var hdrs = raw[hdrRow] ? raw[hdrRow].map(function(h){ return String(h).trim(); }) : [];
        /* Renomeia duplicatas de headers para evitar sobrescrita no objeto:
           Se 'Description' aparecer 2x, a segunda vira 'Description_J' */
        var hdrsUniq = []; var seen = {};
        hdrs.forEach(function(h) {
          if (seen[h]) { hdrsUniq.push(h + '_J'); } /* segunda ocorrência = col J */
          else { hdrsUniq.push(h); seen[h] = true; }
        });
        var rows = [];
        for (var i = hdrRow + 1; i < raw.length; i++) {
          var r = raw[i];
          if (!r.some(function(v){ return v !== ''; })) continue;
          var obj = {};
          hdrsUniq.forEach(function(h, ci){ obj[h] = r[ci] !== undefined ? r[ci] : ''; });
          rows.push(obj);
        }
        RAW_AS[key] = { headers: hdrsUniq, rows: rows };
      }
      var cnt = RAW_AS[key] ? RAW_AS[key].rows.length : 0;
      RAW_CLIENTS['asus'] = RAW_CLIENTS['asus'] || {};
      RAW_CLIENTS['asus'][key] = RAW_AS[key];
      if (typeof ucardLoaded !== 'undefined') {
        ucardLoaded('c-as-' + key, 'f-as-' + key, file.name, cnt);
      } else {
        var nEl = document.getElementById('n-as-' + key);
        var cEl = document.getElementById('c-as-' + key);
        if (nEl) nEl.textContent = '✅ ' + file.name + ' — ' + cnt + ' registros';
        if (cEl) cEl.classList.add('done');
      }
      checkReadyAsus();
    } catch(err) {
      showToast('❌ Erro ao ler ' + file.name + ': ' + err.message, 'err');
    }
  };
  reader.readAsBinaryString(file);
}

/* ── Carrega arquivo ASP de falhas L10 ASUS ── */
function loadAsusDefL10(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var html = e.target.result;
      /* Parser de tabelas HTML */
      var rows = parseAsusAsp(html);
      RAW_AS.defL10 = { headers: [], rows: rows };
      RAW_CLIENTS['asus'] = RAW_CLIENTS['asus'] || {};
      RAW_CLIENTS['asus'].defL10 = RAW_AS.defL10;
      if (typeof ucardLoaded !== 'undefined') {
        ucardLoaded('c-as-defL10', 'f-as-defL10', file.name, rows.length);
      } else {
        var nEl = document.getElementById('n-as-defL10');
        var cEl = document.getElementById('c-as-defL10');
        if (nEl) nEl.textContent = '✅ ' + file.name + ' — ' + rows.length + ' falhas';
        if (cEl) cEl.classList.add('done');
      }
      checkReadyAsus();
    } catch(err) {
      showToast('❌ Erro ao ler ASP: ' + err.message, 'err');
    }
  };
  reader.readAsText(file, 'utf-8');
}

/* ── Parser HTML/ASP → array de objetos ── */
function parseAsusAsp(html) {
  /* Encontra a tabela principal (com header SYSSERIALNO) */
  var parser = new DOMParser();
  var doc = parser.parseFromString(html, 'text/html');
  var tables = doc.querySelectorAll('table');
  var mainTable = null;
  for (var i = 0; i < tables.length; i++) {
    var firstRow = tables[i].querySelector('tr');
    if (firstRow && firstRow.textContent.indexOf('SYSSERIALNO') !== -1) {
      mainTable = tables[i]; break;
    }
  }
  if (!mainTable) throw new Error('Tabela de falhas não encontrada no arquivo ASP');

  var rows = mainTable.querySelectorAll('tr');
  var headers = [];
  var data = [];

  rows.forEach(function(tr, ri) {
    var cells = tr.querySelectorAll('td, th');
    var vals = Array.from(cells).map(function(td){ return td.textContent.trim(); });
    if (ri === 0) {
      headers = vals;
    } else {
      if (!vals.some(function(v){ return v !== ''; })) return;
      var obj = {};
      headers.forEach(function(h, ci){ obj[h] = vals[ci] !== undefined ? vals[ci] : ''; });
      data.push(obj);
    }
  });
  return data;
}

/* ── Normaliza acentos do REPAIRCOMMENT ────────────────────────
   Problema: o arquivo ASP vem em UTF-16 e alguns registros chegam
   com caracteres corrompidos (ex: "INSUFICI£NCIA DE SOLDA") enquanto
   outros chegam corretos ("INSUFICIÊNCIA DE SOLDA"). Isso faz o
   sistema tratar as duas como falhas diferentes no pareto.

   Solução: converter para maiúsculo e remover todos os acentos,
   tornando "INSUFICIÊNCIA" e "INSUFICI£NCIA" ambos "INSUFICIENCIA".
   Assim o agrupamento no pareto funciona corretamente.

   Aplica-se SOMENTE ao REPAIRCOMMENT do arquivo ASP (L10 ASUS).
   Os demais campos (NOTE, DESCRIPTION, etc.) não são alterados.
────────────────────────────────────────────────────────────── */
function normalizarAcentos(s) {
  if (!s) return s;
  return String(s)
    .toUpperCase()
    /* Remove acentos via NFD (decompõe letra+acento) quando suportado */
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   /* remove diacríticos */
    /* Fallback explícito para caracteres que podem chegar corrompidos
       do UTF-16 LE: substitui variantes comuns antes e depois da decodificação */
    .replace(/[ÀÁÂÃÄÅ]/g, 'A')
    .replace(/[ÈÉÊË]/g,   'E')
    .replace(/[ÌÍÎÏ]/g,   'I')
    .replace(/[ÒÓÔÕÖ]/g,  'O')
    .replace(/[ÙÚÛÜ]/g,   'U')
    .replace(/[Ç]/g,      'C')
    .replace(/[Ñ]/g,      'N')
    /* Substitui também os artefatos de encoding mal interpretado:
       £ = 0xA3, que no Latin-1/Windows-1252 mal lido pode substituir Ê/Ã etc. */
    .replace(/[£¢¤¦§¨©]/g, '')
    /* Remove qualquer caractere não-ASCII restante (símbolos de encoding corrompido) */
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

/* ── Separador Item / Description_1 do REPAIRCOMMENT ──
   Regras (ponto 8): primeiro espaço, " -" (espaço+traço), ou "-" (traço)
   Exemplos:
     "PMU1 DEFEITO ELETRICO"  → item=PMU1,  desc=DEFEITO ELETRICO
     "P1Q1071-CURTO DE SOLDA" → item=P1Q1071, desc=CURTO DE SOLDA
     "AL9-DESLOCADO"          → item=AL9,   desc=DESLOCADO
     "NDF"                    → item=NDF,   desc=TBA
*/
function parseRepairComment(rc) {
  if (!rc || !rc.trim()) return {item:'TBA', desc:'TBA'};
  var s = rc.trim();
  /* tenta " - " (espaço traço espaço) */
  var idx = s.indexOf(' - ');
  if (idx > 0) return {item: s.slice(0,idx).trim(), desc: s.slice(idx+3).trim()||'TBA'};
  /* tenta "-" (traço sem espaço) */
  idx = s.indexOf('-');
  if (idx > 0) return {item: s.slice(0,idx).trim(), desc: s.slice(idx+1).trim()||'TBA'};
  /* tenta primeiro espaço */
  idx = s.indexOf(' ');
  if (idx > 0) return {item: s.slice(0,idx).trim(), desc: s.slice(idx+1).trim()||'TBA'};
  /* sem separador */
  return {item: s, desc: 'TBA'};
}

/* ── checkReady ASUS — outL6 OU outL10 obrigatório ── */
function checkReadyAsus() {
  var ok = !!(
    (RAW_AS.outL6  && RAW_AS.outL6.rows  && RAW_AS.outL6.rows.length  > 0) ||
    (RAW_AS.outL10 && RAW_AS.outL10.rows && RAW_AS.outL10.rows.length > 0)
  );
  var btn = document.getElementById('btnGo');
  if (btn) btn.disabled = !ok;
  var hint = document.getElementById('hint');
  if (hint) {
    if (!ok) {
      hint.textContent = 'Aguardando Output L6 ou Output L10 ASUS...';
    } else {
      var miss = [];
      if (!RAW_AS.outL6  || !RAW_AS.outL6.rows.length)  miss.push('Output L6');
      if (!RAW_AS.outL10 || !RAW_AS.outL10.rows.length) miss.push('Output L10');
      if (!RAW_AS.defL6  || !RAW_AS.defL6.rows.length)  miss.push('Falhas L6');
      if (!RAW_AS.defL10 || !RAW_AS.defL10.rows.length) miss.push('Falhas L10');
      hint.textContent = miss.length
        ? '✓ Sem ' + miss.join(', ') + ' — OK (zero defeitos). Clique em GERAR'
        : '✓ Todos os arquivos prontos — clique em GERAR DASHBOARD';
    }
  }
}

/* ── Restaura UI ao voltar para aba ASUS ── */
function restoreAsusUploadUI() {
  var map = {outL6:'📊 Output L6', defL6:'⚠️ Falhas L6', outL10:'📋 Output L10', defL10:'🔴 Falhas L10 ASP'};
  ['outL6','defL6','outL10','defL10'].forEach(function(k){
    var nEl = document.getElementById('n-as-' + k);
    var cEl = document.getElementById('c-as-' + k);
    if (RAW_AS[k] && nEl) {
      var cnt = RAW_AS[k].rows ? RAW_AS[k].rows.length : 0;
      nEl.textContent = '✅ ' + map[k] + ' — ' + cnt + ' registros';
      if (cEl) cEl.classList.add('done');
    }
  });
  checkReadyAsus();
}

/* ── adminGenerateAsus ── */
function adminGenerateAsus() {
  var hasOut = (RAW_AS.outL6 && RAW_AS.outL6.rows && RAW_AS.outL6.rows.length > 0) ||
               (RAW_AS.outL10 && RAW_AS.outL10.rows && RAW_AS.outL10.rows.length > 0);
  if (!hasOut) {
    showToast('⚠ Carregue pelo menos o Output L6 ou Output L10 ASUS', 'err'); return;
  }
  if (!RAW_AS.outL6)  RAW_AS.outL6  = { headers: [], rows: [] };
  if (!RAW_AS.defL6)  RAW_AS.defL6  = { headers: [], rows: [] };
  /* Garante estruturas vazias */
  if (!RAW_AS.defL6  || !RAW_AS.defL6.rows)  RAW_AS.defL6  = {headers:[], rows:[]};
  if (!RAW_AS.outL10 || !RAW_AS.outL10.rows) RAW_AS.outL10 = {headers:[], rows:[]};
  if (!RAW_AS.defL10 || !RAW_AS.defL10.rows) RAW_AS.defL10 = {headers:[], rows:[]};

  var btnGo = document.getElementById('btnGo');
  if (btnGo) btnGo.disabled = true;
  showToast('⏳ Processando dados ASUS...', 'info');

  var STD_HEADERS_OUT = ['Line','Work Order','Model Name','Model Serial','Test station',
    'Placa Passou','Placa Falhou','Total','Defect Rate (%)','FPY (%)'];

  /* ── Replace Model Name no outL6 ASUS: PN → nome do modelo ── */
  RAW_AS.outL6.rows.forEach(function(r) {
    /* Model Name (col C) = PN como '59MB14AB-MB0B01S' → 'TUF GAMING B550M-PLUS' */
    var mnKey = Object.keys(r).find(function(k){
      return k.toLowerCase().indexOf('model name') !== -1 ||
             k.toLowerCase().indexOf('model serial') !== -1 ||
             k === 'Model Name' || k === 'Model Serial';
    });
    /* Tenta cada coluna Model Name / Model Serial */
    ['Model Name','Model Serial'].forEach(function(col) {
      if (r[col] !== undefined) {
        r[col] = asusModelName(r[col]);
      }
    });
  });

  /* ── Normaliza Output L10 ASUS ──
     Lê abas TUF e PRIME do Excel
     Primeira coluna = Modelo (preenchida pelo usuário)
     Event Name = estação
     TUF yield: FT1, FT2 | PRIME yield: FT1, FT2
     Produção BE = AVIPK
  */
  var outL10Norm = RAW_AS.outL10.rows.map(function(r) {
    var aba   = String(r['_aba'] || '').toUpperCase();         /* TUF ou PRIME */
    var modelo = asusModelName(String(r['Modelo'] || r['Model Name'] || '').trim());
    var st     = String(r['Event Name'] || '').trim();
    var inp    = parseFloat(String(r['Input'] || 0).replace(',','.'))||0;
    var pass   = parseFloat(String(r['Qty Pass'] || 0).replace(',','.'))||0;
    var fail   = parseFloat(String(r['Qty Fail'] || 0).replace(',','.'))||0;
    var fpRaw  = String(r['First Pass'] || '').replace('%','').replace(',','.').trim();
    var fp     = parseFloat(fpRaw)||0;
    return {
      'Line':           'L10',
      'Work Order':     '',            /* outL10 não tem WO real — modelo via _modelo */
      'Model Name':     modelo,
      'Model Serial':   modelo,
      'Test station':   st,
      'Placa Passou':   pass,
      'Placa Falhou':   fail,
      'Total':          inp,
      'Defect Rate (%)':'',
      'FPY (%)':        Math.round(fp * 100),
      '_aba':           aba
    };
  });

  /* ── Normaliza Falhas L10 ASP ──
     FAILUREEVENTPOINT = estação
     Yield L10 usa somente FT1 e FT2
     DESCRIPTION = nome do produto → identifica TUF ou PRIME
     REPAIRCOMMENT → parseRepairComment → Item + Description_1
     Work Order = DESCRIPTION (join com woMap via Modelo)
  */
  var defL10Norm = (function() {
    var result = [];
    RAW_AS.defL10.rows.forEach(function(r) {
      /* LINESEQNO 2 ou 3 → ignora (não conta no yield nem nos gráficos) */
      var lineSeq = parseInt(r['LINESEQNO'] || '1', 10);
      if (lineSeq === 2 || lineSeq === 3) return;

      var desc      = String(r['DESCRIPTION'] || '').trim();
      var st        = String(r['FAILUREEVENTPOINT'] || '').trim();
      var dtFull    = String(r['FAILUREDATE'] || '').trim();
      var hr        = String(r['FAILURECHECKOUTTIME'] || '').trim();

      /* ── Ajuste de data para madrugada (00:00 ~ 05:59) ──
         O sistema MES registra falhas da madrugada com a data do dia seguinte.
         Se o horário estiver entre 00:00 e 05:59, subtrai 1 dia da data
         para manter a falha no turno correto (dia anterior). */
      var failDate;
      var hrMatch = hr.match(/^(\d{1,2}):(\d{2})/);
      var hrNum   = hrMatch ? parseInt(hrMatch[1]) : 99;
      var minNum  = hrMatch ? parseInt(hrMatch[2]) : 0;
      /* 00:00 ~ 05:55 → terceiro turno */
      var turno   = (hrNum >= 0 && hrNum <= 4) || (hrNum === 5 && minNum <= 55) ? '3ºT' : '1ºT';
      if (hrNum >= 0 && hrNum <= 5 && dtFull) {
        /* Subtrai 1 dia da data */
        var parts = dtFull.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (parts) {
          var d = new Date(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]));
          d.setDate(d.getDate() - 1);
          var yy = d.getFullYear();
          var mm = String(d.getMonth() + 1).padStart(2, '0');
          var dd = String(d.getDate()).padStart(2, '0');
          dtFull = yy + '-' + mm + '-' + dd;
        }
      }
      var failDate  = dtFull + ' ' + hr;
      var rcRaw     = String(r['REPAIRCOMMENT'] || '').trim();
      var noteRaw   = String(r['NOTE'] || '').trim();

      /* ── Normaliza acentos do REPAIRCOMMENT antes de qualquer lógica ──
         Converte para maiúsculo e remove acentos para que variantes
         como "INSUFICIÊNCIA" e "INSUFICI£NCIA" (encoding corrompido)
         sejam tratadas como a mesma falha no pareto. */
      rcRaw = normalizarAcentos(rcRaw);

      /* ── Regras NOTE / REPAIRCOMMENT ──
         A) REPAIRCOMMENT contém NDF:
            → Item e Description_1: parseRepairComment(rcRaw) → ex: item='NDF', desc='TBA'
            → NOTE: SEMPRE vira 'Screening', independente do que estiver escrito
              (ex: 'CHK_PCIE' → 'Screening', vazio → 'Screening')
         B) REPAIRCOMMENT vazio:
            → Item = TBA, Description_1 = TBA
            → NOTE: mantém o que veio, senão 'Sem Cadastro'
         C) REPAIRCOMMENT preenchido (sem NDF):
            → Item e Description_1: parseRepairComment(rcRaw)
            → NOTE: mantém o que veio, senão 'Sem Cadastro' */
      var isNDF   = rcRaw.toUpperCase().indexOf('NDF') !== -1;
      var rcEmpty = (rcRaw === '');

      var rc, noteVal;
      if (isNDF) {
        rc = {item: 'NDF', desc: 'NDF'};  /* REPAIRCOMMENT=NDF → item e Description_1 = NDF */
        noteVal = 'Screening';            /* NOTE desta linha SEMPRE vira Screening */
      } else if (rcEmpty) {
        rc = {item: 'TBA', desc: 'TBA'};
        noteVal = noteRaw !== '' ? noteRaw : 'Sem Cadastro';
      } else {
        rc = parseRepairComment(rcRaw);
        noteVal = noteRaw !== '' ? noteRaw : 'Sem Cadastro';
      }

      /* Modelo via SKUNO com replace PN → nome real */
      var skuno   = String(r['SKUNO'] || '').trim();
      var woJoin  = asusModelName(skuno) || asusModelName(desc) || desc;
      /* Determina aba TUF/PRIME para join com outL10 (mantém compatibilidade) */
      var modelKey = woJoin.toUpperCase().indexOf('TUF') !== -1 ? 'TUF' :
                     woJoin.toUpperCase().indexOf('PRIME') !== -1 ? 'PRIME' : woJoin;
      /* Tenta encontrar linha correspondente no outL10 para consistência */
      if (RAW_AS.outL10 && RAW_AS.outL10.rows.length > 0) {
        for (var i = 0; i < RAW_AS.outL10.rows.length; i++) {
          var o = RAW_AS.outL10.rows[i];
          var oAba = String(o['_aba'] || '').toUpperCase();
          var oSt  = String(o['Event Name'] || '').trim();
          var oMod = asusModelName(String(o['Modelo'] || o['Model Name'] || '').trim());
          if (oMod === woJoin && oSt === st) { break; }
          if (oAba === modelKey && oSt === st && !oMod) { break; }
        }
      }

      result.push({
        'Serial':          String(r['SYSSERIALNO'] || '').trim(),
        'Work Order':      String(r['WORKORDERNO'] || '').trim(),
        'Failure Code':    String(r['FAILURECODE'] || '').trim(),
        'Description':     noteVal,   /* Fix 5: NOTE = Descrição Técnica (descTec) */
        'Line':            String(r['FAILUREPDLINE'] || '').trim(),
        'Test station':    st,
        'Failure date':    failDate,
        'Repair station':  String(r['REPAIRSTATION'] || '').trim(),
        'Reason Code':     String(r['CATEGORYNAME'] || '').trim(),
        'Description_1':   rc.desc,   /* Fail Description (pareto) */
        'Item':            rc.item,
        '_modelo':         woJoin,
        '_turno':          turno,
        '_desc_produto':   desc,
        '_eventpoint':     st
      });
    });
    return result;
  })();

  /* ── ASUS L10: serial duplicado → mantém só a penúltima ocorrência ── */
  (function() {
    var _serIdx = {};
    defL10Norm.forEach(function(r, i) {
      var s = String(r['Serial'] || '').trim();
      if (!s) return;
      if (!_serIdx[s]) _serIdx[s] = [];
      _serIdx[s].push(i);
    });
    var _keepSet = {};
    Object.keys(_serIdx).forEach(function(s) {
      var idxs = _serIdx[s];
      _keepSet[idxs.length === 1 ? idxs[0] : idxs[idxs.length - 2]] = true;
    });
    defL10Norm = defL10Norm.filter(function(r, i) {
      var s = String(r['Serial'] || '').trim();
      if (!s) return true;
      return !!_keepSet[i];
    });
  })();

  /* ── Combina L6 + L10 ── */
  var combinedOut = { headers: STD_HEADERS_OUT, rows: RAW_AS.outL6.rows.concat(outL10Norm) };

  var STD_DEF_HEADERS = ['Serial','Work Order','Failure Code','Description','Line',
    'Test station','Failure date','Repair station','Reason Code','Description_1','Item','_modelo','_turno'];

  /* ── Normaliza defL6 ASUS — mesma lógica da Acer ──
     Mapeia colunas pelo nome (colN), mesmo que estejam em posições diferentes.
     Coluna J do arquivo = "Description" → vai para Description_1 (Fail Reason do pareto).
     Separação Item + Description_1: primeiro espaço ou traço (igual L10 ASP). */
  var hasDefL6  = RAW_AS.defL6.rows.length  > 0;
  var hasDefL10 = RAW_AS.defL10.rows.length > 0;

  /* ── defL6Norm ASUS ──
     O arquivo L6 ASUS tem DUAS colunas chamadas "Description":
       col D (índice 3) = Descrição Técnica → descTec (filtro DESC. TÉCNICA)
       col J (índice 9) = Fail Reason → Description_1 (pareto)
     Como ambas têm o mesmo nome, lemos por ÍNDICE de posição no array de headers.
     Os demais campos usam colN normalmente pois têm nomes únicos. */
  var defL6Norm = (function() {
    var fh6 = RAW_AS.defL6.headers;
    /* Com o renomeio no loadAS, col D = 'Description', col J = 'Description_J' */
    function cn6(cands) { return colN(fh6, cands); }

    return RAW_AS.defL6.rows.map(function(r) {
      /* col D = 'Description' → descTec (filtro DESC. TÉCNICA) */
      var desc       = String(r['Description'] || r[cn6(['Description','Descrição','Desc'])] || '').trim();
      /* col J = 'Description_J' (renomeado no loadAS para evitar sobrescrita) */
      var failReason = String(r['Description_J'] || '').trim();
      if (!failReason) failReason = desc; /* fallback */

      var ser   = String(r[cn6(['Serial','Serial Number','CT Number','SN'])]||'').trim();
      var wo    = String(r[cn6(['Work Order','WO','Ordem de Trabalho'])]||'').trim();
      var fc    = String(r[cn6(['Failure Code','Código Falha','Fail Code'])]||'').trim();
      var linha = String(r[cn6(['Line','Linha','Production Line'])]||'').trim();
      var st    = String(r[cn6(['Test station','Test Station','Station','Estação'])]||'').trim();
      var fdate = String(r[cn6(['Failure date','Failure Date','Data Falha','Date'])]||'').trim();
      var repSt = String(r[cn6(['Repair station','Repair Station','Estação Reparo'])]||'').trim();
      var reason= String(r[cn6(['Reason Code','Código Categoria','Reason'])]||'').trim();
      var item  = String(r[cn6(['Item','Componente','Component','Part'])]||'').trim();

      return {
        'Serial':        ser,
        'Work Order':    wo,
        'Failure Code':  fc,
        'Description':   desc,          /* col D → descTec → filtro DESC. TÉCNICA */
        'Line':          linha,
        'Test station':  st,
        'Failure date':  fdate,
        'Repair station':repSt,
        'Reason Code':   reason,
        'Description_1': failReason || 'TBA', /* col J → pareto Fail Description */
        'Item':          item || 'TBA',
        '_modelo':       '',
        '_turno':        '1ºT'
      };
    });
  })();

  var combinedDef = {
    headers: STD_DEF_HEADERS,
    rows: (hasDefL6 ? defL6Norm : []).concat(hasDefL10 ? defL10Norm : [])
  };

  RAW.out = combinedOut;
  RAW.def = combinedDef;

  RAW_CLIENTS['asus'] = {
    outL6: RAW_AS.outL6, defL6: RAW_AS.defL6,
    outL10: RAW_AS.outL10, defL10: RAW_AS.defL10,
    out: combinedOut, def: combinedDef
  };

  /* Sincroniza CURRENT_CLIENT para que switchClient salve RAW.out no cliente correto */
  CURRENT_CLIENT = 'asus';
  ADMIN_CLIENT   = 'asus';

  run().then(function() {
    buildClientTabs(); /* ressincroniza aba ativa com CURRENT_CLIENT */
    showPublishBar();
    showToast('✅ Dashboard ASUS gerado!', 'ok');
    if (btnGo) btnGo.disabled = false;
  }).catch(function(e) {
    showToast('⚠ Erro: ' + e.message, 'err');
    if (btnGo) btnGo.disabled = false;
  });
}

/* ═══════════════════════════════════════════════════════════════
   FIM ASUS
═══════════════════════════════════════════════════════════════ */

window.addEventListener('DOMContentLoaded', function(){
  setTimeout(initSupabase, 100);

  /* Mobile: fecha dropdowns ao tocar fora */
  document.addEventListener('touchstart', function(e){
    if (!e.target.closest('.ms-wrap')) {
      document.querySelectorAll('.ms-wrap.open').forEach(function(el){
        el.classList.remove('open');
      });
    }
  }, { passive:true });

  /* Mobile: previne scroll do body quando dropdown está aberto */
  document.addEventListener('touchmove', function(e){
    if (document.querySelector('.ms-wrap.open')) {
      /* permite scroll dentro do dropdown */
      if (!e.target.closest('.ms-drop')) e.preventDefault();
    }
  }, { passive:false });

  /* Adiciona classe 'mobile' ao body para JS poder checar */
  if (window.innerWidth <= 640 || ('ontouchstart' in window)) {
    document.body.classList.add('is-mobile');
  }
});
