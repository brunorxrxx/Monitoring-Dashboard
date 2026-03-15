/* ═══════════════════════════════════════════════════════════════
   ACER Production Intelligence v5
   Validado contra OUT.xlsx e FALHAS.xlsx reais (Foxconn)

   REGRAS DE CÁLCULO:
   - Total por estação = soma coluna "Total" do OUT (denominador DAX)
   - Falhas por estação = contagem de linhas no FALHAS por "Test station"
   - Parcial_X = 1 - (Falhas_X / Total_X)
   - Overal SMT = Parcial_S_VI_T × Parcial_S_VI_B
   - Overall BE = Parcial_FBT × Parcial_ICT × Parcial_F1 × Parcial_F2
   - Overal = SMT × BE

   MATRIZ: apenas S_VI_B, S_VI_T, ICT, FBT, F1, F2 (nessa ordem)

   FILTROS: multi-select com checkbox em cada combobox
   GRÁFICOS: números em cima de todas as barras + valores na linha Pareto
   PARETOS: Fail Description (col J) + Item (col K)
═══════════════════════════════════════════════════════════════ */

var RAW    = {out:null, def:null};
var DATA   = {};
var CHARTS = {};

/* ── THRESHOLDS CENTRALIZADOS ──────────────────────────────────
   Altere AQUI para mudar as metas em todo o dashboard de uma vez.
   green  = ≥ este valor → verde
   amber  = ≥ este valor → amarelo  (abaixo = vermelho)
   warn   = ≥ este valor → cyan (zona intermediária)
   target = valor da linha de meta nos gráficos (%)
────────────────────────────────────────────────────────────── */
const THRESH = {
  green:  0.99,   /* ≥ 99%  → verde     */
  warn:   0.98,   /* ≥ 98%  → amarelo piscando  */
  amber:  0.95,   /* ≥ 95%  → amarelo normal    */
  target: 99
};

/* Configuração de estações por cliente
   ACER (padrão): S_VI_B, S_VI_T, ICT, FBT, F1, F2
   HP           : S_VI_B, S_VI_T, FVI, ICT, FBT  (sem F1/F2; FVI faz parte do SMT; FVI2 ignorado) */
var CLIENT_CFG = {
  acer: {
    matrix:    ['S_VI_B','S_VI_T','ICT','FBT','F1','F2'],
    smtSts:    ['S_VI_B','S_VI_T'],
    beSts:     ['ICT','FBT','F1','F2'],
    excludeSt: [],
    colors:    {'S_VI_B':'var(--cyan)','S_VI_T':'var(--blue)','ICT':'var(--red)','FBT':'var(--amber)','F1':'var(--green)','F2':'var(--purple)'},
    groups:    {'S_VI_B':'SMT','S_VI_T':'SMT','ICT':'B.E','FBT':'B.E','F1':'B.E','F2':'B.E'}
  },
  hp: {
    matrix:    ['S_VI_B','S_VI_T','FVI','ICT','FBT'],
    smtSts:    ['S_VI_B','S_VI_T','FVI'],
    beSts:     ['ICT','FBT'],
    excludeSt: ['FVI2'],
    colors:    {'S_VI_B':'var(--cyan)','S_VI_T':'var(--blue)','FVI':'var(--green)','ICT':'var(--red)','FBT':'var(--amber)'},
    groups:    {'S_VI_B':'SMT','S_VI_T':'SMT','FVI':'SMT','ICT':'B.E','FBT':'B.E'}
  },
  asus: {
    matrix:    ['S_VI_B','S_VI_T','ICT','FT1','FT2','FVI','PACK-QA'],
    smtSts:    ['S_VI_B','S_VI_T','ICT'],
    beSts:     ['FT1','FT2'],
    excludeSt: ['AVI','AUTO_OBA','AVIPK','R_S_VI_T','S_INPUT_B','S_INPUT_T','R_FVI','R_ICT','REPAIR'],
    colors:    {'S_VI_B':'var(--cyan)','S_VI_T':'var(--blue)','ICT':'var(--red)',
                'FT1':'var(--green)','FT2':'var(--amber)','FVI':'var(--purple)',
                'PACK-QA':'#7c3aed'},
    groups:    {'S_VI_B':'SMT','S_VI_T':'SMT','ICT':'SMT',
                'FT1':'B.E','FT2':'B.E','FVI':'B.E','PACK-QA':'B.E'}
  },
  huawei: {
    matrix:    ['S_VI_B','S_VI_T','PTH','FT2_MP1','ST-MP1','ST-MP13','ST-MP9'],
    smtSts:    ['S_VI_B','S_VI_T','PTH','FT2_MP1'],
    beSts:     ['ST-MP1','ST-MP13','ST-MP9'],
    excludeSt: [],
    colors:    {'S_VI_B':'var(--cyan)','S_VI_T':'var(--blue)','PTH':'var(--green)',
                'FT2_MP1':'var(--purple)','ST-MP1':'var(--amber)',
                'ST-MP13':'var(--red)','ST-MP9':'#ff8c42'},
    groups:    {'S_VI_B':'SMT','S_VI_T':'SMT','PTH':'SMT','FT2_MP1':'SMT',
                'ST-MP1':'B.E','ST-MP13':'B.E','ST-MP9':'B.E'}
  }
};

function getCfg() {
  return CLIENT_CFG[CURRENT_CLIENT] || CLIENT_CFG.acer;
}

/* MT_CLR / MT_GRP — usados apenas como fallback de cor; a config real vem de getCfg() */
var MT_CLR  = {'S_VI_B':'var(--cyan)','S_VI_T':'var(--blue)','ICT':'var(--red)','FBT':'var(--amber)','F1':'var(--green)','F2':'var(--purple)','FVI':'var(--green)'};
var MT_GRP  = {'S_VI_B':'SMT','S_VI_T':'SMT','ICT':'B.E','FBT':'B.E','F1':'B.E','F2':'B.E','FVI':'SMT'};

/* Relógio */
setInterval(function(){
  var n=new Date(), el=document.getElementById('htime');
  if(el) el.textContent=n.toLocaleDateString('pt-BR')+' '+n.toLocaleTimeString('pt-BR');
},1000);

/* ══════════════════════════════════════════
   PARSER XLSX — Padrão Foxconn
   Row[0] = título (ignorado)
   Row[1] = headers (com deduplicação)
   Row[2+] = dados
   FALHAS: "Description" aparece 2x → dedup para "Description" e "Description_1"
══════════════════════════════════════════ */
function loadXL(input, key) {
  var file = input.files[0];
  if (!file) return;

  /* Feedback imediato na card */
  var nEl = document.getElementById('n-'+key);
  var cEl = document.getElementById('c-'+key);
  if (nEl) nEl.textContent = '⏳ Lendo ' + file.name + '...';

  var reader = new FileReader();
  reader.onerror = function() {
    if (nEl) nEl.style.color = '#ff3d5a';
    if (nEl) nEl.textContent = '❌ Erro ao ler arquivo';
  };
  reader.onload = function(e) {
    try {
      if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada');
      var wb  = XLSX.read(e.target.result, {type:'binary', cellDates:false, raw:false});
      var ws  = wb.Sheets[wb.SheetNames[0]];
      var aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', blankrows:false});
      if (!aoa || aoa.length < 3) { 
        if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Estrutura inválida — requer 3+ linhas'; }
        return; 
      }

      /* Deduplica headers */
      var rawH = (aoa[1]||[]).map(function(h){ return String(h==null?'':h).trim(); });
      var seen = {}, headers = rawH.map(function(h){
        if (seen[h] === undefined) { seen[h]=0; return h; }
        seen[h]++; return h+'_'+seen[h];
      });

      /* Constrói array de objetos */
      var rows = [];
      for (var i = 2; i < aoa.length; i++) {
        var r = aoa[i], hasVal = false;
        for (var j=0; j<r.length; j++) { if(r[j]!==''&&r[j]!==null&&r[j]!==undefined){hasVal=true;break;} }
        if (!hasVal) continue;
        var obj = {};
        headers.forEach(function(h,k){ obj[h] = (r[k]!==undefined&&r[k]!==null) ? r[k] : ''; });
        rows.push(obj);
      }
      RAW[key] = {headers:headers, rows:rows};
      if (nEl) { nEl.style.color = ''; nEl.textContent = '✅ ' + file.name + ' — ' + rows.length + ' registros'; }
      if (cEl) cEl.classList.add('done');
      checkReady();
    } catch(err) {
      if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Erro: '+err.message; }
      console.error('[loadXL]', err);
    }
  };
  reader.readAsBinaryString(file);
}

function checkReady() {
  /* Falhas são opcionais — apenas OUTPUT é obrigatório */
  var ok = !!(RAW.out);
  document.getElementById('btnGo').disabled = !ok;
  document.getElementById('hint').textContent = ok
    ? (RAW.def
        ? '✓ Arquivos prontos — clique em GERAR DASHBOARD'
        : '✓ Sem arquivo de falhas? OK — zero defeitos assumido. Clique em GERAR')
    : 'Aguardando OUTPUT...';
  if (ok) {
    if (!RAW.def) {
      RAW.def = { headers: ['Serial','Work Order','Failure Code','Description',
        'Line','Test station','Failure date','Repair station','Reason Code','Description_1','Item'],
        rows: [] };
    }
    setStatus('warn','Pronto para gerar');
  }
}

/* ══════════════════════════════════════════
   MULTI-SELECT COM CHECKBOX
   Cada filtro: botão que abre dropdown com checkboxes
   Nenhum selecionado = "Todos" (sem filtro)
══════════════════════════════════════════ */
var MS_STATE = {}; /* {key: Set of selected values} */

function buildMultiSelect(containerId, key, options, placeholder) {
  MS_STATE[key] = new Set(); /* vazio = todos */
  var container = document.getElementById(containerId);

  var html = '<div class="ms-wrap" id="mswrap-'+key+'">' +
    '<button type="button" class="ms-trigger" id="mstrig-'+key+'" onclick="toggleMS(\''+key+'\')">' +
      '<span id="mslabel-'+key+'">'+placeholder+'</span>' +
      '<span class="ms-arrow" id="msarrow-'+key+'">▾</span>' +
    '</button>' +
    '<div class="ms-drop" id="msdrop-'+key+'">' +
      '<input class="ms-search" placeholder="Buscar..." oninput="searchMS(\''+key+'\',this.value)"/>' +
      '<div class="ms-all active" id="msall-'+key+'" onclick="toggleAllMS(\''+key+'\')">' +
        '<span class="ms-cb">✓</span><span>Todos</span>' +
      '</div>' +
      '<div id="mslist-'+key+'"></div>' +
    '</div>' +
  '</div>';
  container.innerHTML = html;

  renderMSOptions(key, options, '');
}

function renderMSOptions(key, options, search) {
  var list = document.getElementById('mslist-'+key);
  var filt = search ? options.filter(function(o){ return o.toLowerCase().includes(search.toLowerCase()); }) : options;
  var allSelected = MS_STATE[key].size === 0; /* state vazio = Todos selecionado */
  /* Atualiza visual do botão Todos */
  var allEl = document.getElementById('msall-'+key);
  if (allEl) {
    allEl.classList.toggle('active', allSelected);
    allEl.querySelector('.ms-cb').textContent = allSelected ? '✓' : '';
  }
  list.innerHTML = filt.map(function(o){
    var sel = allSelected || MS_STATE[key].has(o);
    return '<div class="ms-item'+(sel?' active':'')+'" data-val="'+escAttr(o)+'" onclick="toggleMSItem(\''+key+'\',\''+escAttr(o)+'\')">' +
      '<span class="ms-cb">'+(sel?'✓':'')+'</span><span>'+o+'</span></div>';
  }).join('');
}

function escAttr(s){ return String(s).replace(/'/g,"&#39;").replace(/"/g,'&quot;'); }

function toggleMS(key) {
  var wrap = document.getElementById('mswrap-'+key);
  var drop = document.getElementById('msdrop-'+key);
  var isOpen = wrap.classList.contains('open');
  /* Fecha todos */
  document.querySelectorAll('.ms-wrap.open').forEach(function(w){ w.classList.remove('open'); });
  if (!isOpen) {
    wrap.classList.add('open');
    /* Posiciona dropdown com fixed coords para escapar de qualquer overflow context */
    var rect = wrap.getBoundingClientRect();
    drop.style.top  = (rect.bottom + 4) + 'px';
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
  var opts = (DATA._opts && DATA._opts[key]) || (key==='trn'?['1ºT','2ºT','3ºT']:[]);

  /* Se estado está vazio (= Todos), clicar num item desmarca só ele → adiciona todos exceto ele */
  if (state.size === 0) {
    opts.forEach(function(o){ if(o !== val) state.add(o); });
  } else {
    if (state.has(val)) state.delete(val); else state.add(val);
    /* Se todos estão marcados individualmente → volta para Todos (state vazio) */
    if (state.size === opts.length) state.clear();
    /* Se desmarcou o último item → também volta para Todos */
    if (state.size === 0) state.clear();
  }

  /* Re-renderiza lista visual com o estado atualizado */
  var list = document.getElementById('mslist-'+key);
  var allSelected = state.size === 0;
  list.querySelectorAll('.ms-item').forEach(function(el){
    var v = el.dataset.val;
    var sel = allSelected || state.has(v);
    el.classList.toggle('active', sel);
    el.querySelector('.ms-cb').textContent = sel ? '✓' : '';
  });

  /* Atualiza botão "Todos" */
  var allEl = document.getElementById('msall-'+key);
  allEl.classList.toggle('active', state.size===0);
  allEl.querySelector('.ms-cb').textContent = state.size===0?'✓':'';

  updateMSLabel(key);
  applyF();
}

function toggleAllMS(key) {
  MS_STATE[key].clear();
  var list = document.getElementById('mslist-'+key);
  /* Marca todos os itens visualmente com checkmark */
  list.querySelectorAll('.ms-item').forEach(function(el){
    el.classList.add('active');
    el.querySelector('.ms-cb').textContent = '✓';
  });
  var allEl = document.getElementById('msall-'+key);
  allEl.classList.add('active');
  allEl.querySelector('.ms-cb').textContent = '✓';
  updateMSLabel(key);
  applyF();
}

function updateMSLabel(key) {
  var state = MS_STATE[key];
  var label = document.getElementById('mslabel-'+key);
  var plMap = {wo:'Todos',mod:'Todos',lin:'Todas',st:'Todas',fd:'Todas'};
  if (!label) return;
  if (state.size === 0) { label.textContent = plMap[key]||'Todos'; return; }
  var arr = Array.from(state);
  label.innerHTML = arr.length===1
    ? '<span>'+arr[0]+'</span>'
    : '<span>'+arr[0]+'</span><span class="ms-tag">+'+( arr.length-1)+'</span>';
}

/* Fecha dropdown ao clicar fora */
document.addEventListener('click', function(e){
  if (!e.target.closest('.ms-wrap'))
    document.querySelectorAll('.ms-wrap.open').forEach(function(w){ w.classList.remove('open'); });
});

/* Fecha dropdowns ao scrollar a página — ignora scroll interno do próprio dropdown */
window.addEventListener('scroll', function(e){
  if (e.target && (e.target.classList.contains('ms-drop') || e.target.closest('.ms-drop'))) return;
  document.querySelectorAll('.ms-wrap.open').forEach(function(w){ w.classList.remove('open'); });
}, true);

/* ══════════════════════════════════════════
   PROCESSAMENTO PRINCIPAL
══════════════════════════════════════════ */
async function run() {
  setStatus('warn','Processando...');
  show('ldZone'); hide('dash'); hide('errBox');
  try {
    await step('Mapeando colunas OUT...', 80);

    /* Colunas OUT — por nome (suporte PT e EN)
       Foxconn padrão validado — aceita nomes em inglês e português */
    var oh = RAW.out.headers;
    var O = {
      linha:  colN(oh, ['Line','Linha','Linha de Produção','Production Line']),
      wo:     colN(oh, ['Work Order','Ordem de Trabalho','WO']),
      modelo: colN(oh, ['Model Name','Model name','Nome do Modelo','Modelo','Model']),
      serial: colN(oh, ['Model Serial','Model serial','Serial do Modelo','Serial','SKU']),
      st:     colN(oh, ['Test station','Test Station','Estação de Teste','Estação','Station']),
      pass:   colN(oh, ['Placa Passou','Board Pass','Pass','Passou','Qty Pass','QTY Pass']),
      fail:   colN(oh, ['Placa Falhou','Board Fail','Fail','Falhou','Qty Fail','QTY Fail']),
      total:  colN(oh, ['Total','Total Input','Input','Qty Total']),
      fpy:    colN(oh, ['FPY (%)','FPY','First Pass Yield','First Pass','Yield (%)']),
    };

    await step('Mapeando colunas FALHAS...', 80);

    /* Colunas FALHAS — índices fixos após dedup
       fh[0]=Serial, fh[1]=WO, fh[2]=FailCode, fh[3]=Description(D=técnica),
       fh[4]=Line, fh[5]=Test station, fh[6]=Failure date, fh[7]=Repair station,
       fh[8]=Reason Code, fh[9]=Description_1(J=Fail Reason), fh[10]=Item(K)
       Suporte PT e EN */
    var fh = RAW.def.headers;
    var F  = {
      serial:   colN(fh, ['Serial','Serial Number','CT Number','SN','Número Serial']),
      wo:       colN(fh, ['Work Order','WO','Ordem de Trabalho']),
      failCode: colN(fh, ['Failure Code','Código Falha','Fail Code','Código de Falha']),
      descTec:  colN(fh, ['Description','Descrição','Desc','Descrição Técnica','Descrição Categoria']),
      linha:    colN(fh, ['Line','Linha','Linha de Produção','Production Line']),
      st:       colN(fh, ['Test station','Test Station','Estação de Teste','Estação','Station']),
      failDate: colN(fh, ['Failure date','Failure Date','Data Falha','Data de Falha','Date']),
      repSt:    colN(fh, ['Repair station','Repair Station','Estação Reparo','Repair']),
      reason:   colN(fh, ['Reason Code','Código Categoria','Reason','Motivo']),
      failDesc: colN(fh, ['Description_1','Fail Description','Fail Reason','Descrição Falha','Comentário','Comentario','Fail Desc']),
      item:     colN(fh, ['Item','Componente','Component','Part']),
    };

    await step('Agregando dados...', 100);

    var outRows = RAW.out.rows, defRows = RAW.def.rows;

    /* ── REGRA: NDF / Placa Lavada → Screening Input BE ────────────────
       Se a coluna J (Description_1 / failDesc) contiver "NDF" ou
       "PLACA LAVADA" (case-insensitive), a coluna D (descTec) daquela
       linha é sobrescrita com "Screening Input BE".
       Aplicado uma única vez no carregamento, antes de qualquer cálculo. */
    defRows.forEach(function(r) {
      var jVal = S(r[F.failDesc]).toUpperCase().trim();
      var isNDF      = jVal === 'NDF' || jVal.indexOf('NDF') !== -1;
      var isLavada   = jVal.indexOf('PLACA LAVADA') !== -1;
      if (isNDF || isLavada) {
        r[F.descTec] = 'Screening Input BE';
      }
    });
    /* ─────────────────────────────────────────────────────────────────── */

    /* WO → modelo/linha (para join na tabela pareto) */
    var woMap = {};
    outRows.forEach(function(r){
      var wo = S(r[O.wo]);
      if (wo && !woMap[wo]) woMap[wo] = {modelo:S(r[O.modelo]), serial:S(r[O.serial]), linha:S(r[O.linha])};
    });


    /* Agrega OUT: soma coluna "Total" por estação */
    var stOut = {};
    outRows.forEach(function(r){
      var st = S(r[O.st]) || 'N/A';
      if (!stOut[st]) stOut[st] = {total:0, pass:0, fail:0};
      stOut[st].total += N(r[O.total]);   /* denominador */
      stOut[st].pass  += N(r[O.pass]);
      stOut[st].fail  += N(r[O.fail]);
    });

    /* Para ASUS: PACK-QA usa AVIPK como denominador de output */
    if (CURRENT_CLIENT === 'asus' && stOut['AVIPK']) {
      stOut['PACK-QA'] = { total: stOut['AVIPK'].total, pass: stOut['AVIPK'].pass, fail: stOut['AVIPK'].fail };
    }

    /* Agrega FALHAS: cada linha = 1 falha, agrupa por col "Test station" */
    var stDef = {};
    defRows.forEach(function(r){
      var st = S(r[F.st]) || 'N/A';
      stDef[st] = (stDef[st]||0) + 1;
    });

    await step('Calculando yields DAX...', 80);

    /* Parcial_X = 1 − (stDef[X] / stOut[X].total) */
    function parcial(st) {
      var d = stDef[st]||0, t = stOut[st]?stOut[st].total:0;
      return t===0 ? null : 1 - d/t;
    }
    function prodX(vals) {
      var v = vals.filter(function(x){ return x!==null && x>0; });
      return v.length ? v.reduce(function(a,x){return a*x;},1) : null;
    }

    var pSVI_B = parcial('S_VI_B'), pSVI_T = parcial('S_VI_T');
    var pFBT   = parcial('FBT'),    pICT   = parcial('ICT');
    var pF1    = parcial('F1'),     pF2    = parcial('F2');
    var pFVI   = parcial('FVI');
    var _cfg   = getCfg();
    var oSMT   = prodX(_cfg.smtSts.map(function(s){ return parcial(s); }));
    var oBE    = prodX(_cfg.beSts.map(function(s){ return parcial(s); }));
    var overal = prodX([oSMT, oBE]);
    var perda  = overal!==null ? 1-overal : null;
    var totF   = defRows.length;
    var pack   = stOut['PACKING'] ? stOut['PACKING'].total : 0;

    /* Fail Desc aggregation para IA */
    var fdAgg = {};
    defRows.forEach(function(r){
      var v = S(r[F.failDesc]) || 'TBA';
      fdAgg[v] = (fdAgg[v]||0) + 1;
    });

    /* Opções para filtros */
    var opts = {
      wo:  uniq(
        /* WOs do output (L6) + WOs das falhas (L10 ASUS tem WO real no defRows) */
        outRows.map(function(r){return S(r[O.wo]);}).concat(
          defRows.map(function(r){return S(r[F.wo]);})
        )
      ).filter(Boolean).sort(),
      mod: uniq(
        outRows.map(function(r){return S(r[O.modelo]);}).concat(
          /* Inclui modelos das falhas (via woMap ou _modelo) para ASUS e clientes com L10 */
          defRows.map(function(r){
            var wo = S(r[F.wo]);
            return (woMap[wo] && woMap[wo].modelo) ? woMap[wo].modelo : (S(r['_modelo']) || '');
          })
        )
      ).filter(Boolean).sort(),
      ser: uniq(outRows.map(function(r){return S(r[O.serial]);})).filter(Boolean).sort(),
      lin: uniq(outRows.map(function(r){return S(r[O.linha]);})).sort(),
      st:  uniq(
        outRows.map(function(r){return S(r[O.st]);})
        .concat(defRows.map(function(r){return S(r[F.st]);})) /* inclui estações das falhas (ex: PACK-QA) */
      ).filter(Boolean).sort(),
      fd:  uniq(defRows.map(function(r){return S(r[F.failDesc])||'TBA';})).sort(),
      itm: uniq(defRows.map(function(r){return S(r[F.item])||'TBA';})).sort(),
      /* dtc: União de descrições técnicas — L6 col D + L10 NOTE
         Remove vazios e 'Sem Cadastro' das OPÇÕES do filtro */
      dtc: uniq(defRows.map(function(r){
        var v = S(r[F.descTec]);
        return v && v !== 'Sem Cadastro' ? v : '';
      })).filter(Boolean).sort(),
    };

    DATA = {outRows:outRows, defRows:defRows, woMap:woMap, O:O, F:F,
            stOut:stOut, stDef:stDef,
            pSVI_B:pSVI_B, pSVI_T:pSVI_T, pFBT:pFBT, pICT:pICT, pF1:pF1, pF2:pF2,
            oSMT:oSMT, oBE:oBE, overal:overal, perda:perda,
            totF:totF, pack:pack, fdAgg:fdAgg, _opts:opts,
            _packTotal:pack,        /* valor fixo, nunca filtrado */
            _rawOutRows:outRows,    /* cópia original para refiltragem */
            _rawDefRows:defRows,    /* cópia original para refiltragem */
            defRowsKpi:defRows,     /* sem filtro de turno → KPI/cards fixos */
            _dropDefRows:defRows};  /* base estável para filtros de gráfico */

    await step('Construindo filtros...', 80);

    buildMultiSelect('ms-wo',  'wo',  opts.wo,  'Todos');
    buildMultiSelect('ms-mod', 'mod', opts.mod, 'Todos');
    buildMultiSelect('ms-ser', 'ser', opts.ser, 'Todos');
    buildMultiSelect('ms-lin', 'lin', opts.lin, 'Todas');
    buildMultiSelect('ms-st',  'st',  opts.st,  'Todas');
    buildMultiSelect('ms-fd',  'fd',  opts.fd,  'Todas');
    buildMultiSelect('ms-itm', 'itm', opts.itm, 'Todos');
    buildMultiSelect('ms-dtc', 'dtc', opts.dtc, 'Todas');
    buildMultiSelect('ms-trn', 'trn', ['1ºT','2ºT','3ºT'], 'Todos');
    updSbInfo(outRows, defRows, pack, overal, O, F);

    await step('Renderizando...', 150);
    render(DATA);

    hide('ldZone'); hide('upZone'); show('dash');
    var hb=document.getElementById('hBtnUpload'); if(hb) hb.style.display='';
    setStatus('on','Dashboard ativo');
    /* Ocultar botão PUBLICAR no dashboard — só visível na tela de upload */
    var _fpb=document.getElementById('fixedPublishBtn'); if(_fpb) _fpb.style.display='none';
    /* Renderiza painéis extras após DOM visível */
    setTimeout(function(){ try { if(DATA&&DATA.F) renderDashRow2(DATA._sO||{}, DATA._sD||{}, DATA.defRows||[], DATA._ov!=null?DATA._ov:DATA.overal); } catch(e){ console.warn('[renderDashRow2]',e); } }, 150);

  } catch(err) {
    hide('ldZone');
    showErr('Erro: '+err.message);
    console.error('[ACER v5]', err);
  }
}

/* ══════════════════════════════════════════
   FILTROS
══════════════════════════════════════════ */
function getSel(key) { return MS_STATE[key] ? Array.from(MS_STATE[key]) : []; }
function inSel(key, val) { var s=MS_STATE[key]; return !s||s.size===0||s.has(val); }
/* inSelDtc: se descTec está vazio, deixa passar (sem classificação técnica definida).
   Só filtra linhas que têm um valor de descTec E esse valor não está selecionado. */
function inSelDtc(val) {
  var s = MS_STATE['dtc'];
  if (!s || s.size === 0) return true;   /* Todos selecionado → passa tudo */
  if (!val || val === '') return true;    /* Sem descTec → sempre passa */
  return s.has(val);                      /* Filtra pelo valor */
}

/* Calcula turno a partir de failDate */
function getShift(raw) {
  var m = (raw||'').match(/\s(\d{1,2}):(\d{2}):/);
  var h = m?parseInt(m[1]):0, mi = m?parseInt(m[2]):0;
  var mins = h*60+mi;
  if (mins>=360 && mins<948)     return '1ºT';
  if (mins>=948 || mins<69)      return '2ºT';
  return '3ºT';
}

function applyF() {
  CHART_FILTER = {fd: null, itm: null};  /* reset bar click filter on sidebar change */
  /* Admin: auto-save filters for current client on every filter change */
  if (IS_ADMIN && CURRENT_CLIENT) {
    ADMIN_FILTERS[CURRENT_CLIENT] = captureFilterState();
  }
  var d = DATA, O=d.O, F=d.F;
  /* Sempre filtra a partir dos dados RAW originais */
  var rawOut = d._rawOutRows || d.outRows;
  var rawDef = d._rawDefRows || d.defRows;

  /* ── OUT rows: sem turno (turno não afeta producao OUTPUT) ── */
  var fo = rawOut.filter(function(r){
    return inSel('wo',S(r[O.wo])) && inSel('mod',S(r[O.modelo])) &&
           inSel('ser',S(r[O.serial])) &&
           inSel('lin',S(r[O.linha])) && inSel('st',S(r[O.st]));
  });

  /* Helper base para defeitos sem filtro de turno */
  function buildFd(inclTrn){
    return rawDef.filter(function(r){
      var wo=S(r[F.wo]), fdv=S(r[F.failDesc])||'TBA';
      var itv=S(r[F.item])||'TBA';
      var m=d.woMap[wo]||{};
      /* Resolve modelo: woMap (L6) ou _modelo direto (L10 ASUS) */
      var modDef = m.modelo || S(r['_modelo']) || '';
      var serMatch = !MS_STATE['ser']||MS_STATE['ser'].size===0 ||
        rawOut.filter(function(o){return S(o[O.wo])===wo && MS_STATE['ser'].has(S(o[O.serial]));}).length>0;
      return inSel('wo',wo) && inSel('mod',modDef) && serMatch &&
             inSel('lin',S(r[F.linha])||m.linha||'') &&
             inSel('st',S(r[F.st])) && inSel('fd',fdv) && inSel('itm',itv) &&
             inSelDtc(S(r[F.descTec])) &&
             (!inclTrn || inSel('trn', getShift(S(r[F.failDate]))));
    });
  }

  /* fdKpi: SEM turno → cards/KPIs sempre mostram os 3 turnos */
  var fdKpi = buildFd(false);
  /* fd: COM turno → gráficos respeitam filtro de turno */
  var fd    = buildFd(true);

  /* Atualiza DATA:
       .defRowsKpi  = sem turno → cards/KPIs fixos
       ._dropDefRows = com turno → base estável para filtros de gráfico (pareto/hora)
       .defRows      = igual _dropDefRows inicialmente (pode ser sobrescrito por filtros de gráfico) */
  DATA.outRows      = fo;
  DATA.defRowsKpi   = fdKpi;
  DATA._dropDefRows = fd;
  DATA.defRows      = fd;
  render(Object.assign({}, d, {outRows:fo, defRows:fd, defRowsKpi:fdKpi}));
}

function clearAllF() {
  ['wo','mod','ser','lin','st','fd','itm','trn','dtc'].forEach(function(key){
    if (MS_STATE[key]) MS_STATE[key].clear();
    var allEl = document.getElementById('msall-'+key);
    if (allEl) { allEl.classList.add('active'); allEl.querySelector('.ms-cb').textContent='✓'; }
    var list = document.getElementById('mslist-'+key);
    if (list) list.querySelectorAll('.ms-item').forEach(function(el){
      el.classList.remove('active'); el.querySelector('.ms-cb').textContent='';
    });
    updateMSLabel(key);
  });
  render(DATA);
}

function updSbInfo(outRows, defRows, pack, overal, O, F) {
  /* sbInfo removed */
}

/* ══════════════════════════════════════════
   RENDER — reconstrói tudo com dados filtrados
══════════════════════════════════════════ */
function render(d) {
  killCharts();
  var outRows=d.outRows, defRows=d.defRows, O=d.O, F=d.F, woMap=d.woMap;
  /* defRowsKpi: sem filtro de turno → cards/KPIs sempre mostram 3 turnos */
  var defRowsKpi = d.defRowsKpi || defRows;

  /* Re-agregar com dados filtrados */
  var sO = {};
  outRows.forEach(function(r){
    var st=S(r[O.st])||'N/A';
    if (!sO[st]) sO[st]={total:0,pass:0,fail:0};
    sO[st].total += N(r[O.total]);
    sO[st].pass  += N(r[O.pass]);
    sO[st].fail  += N(r[O.fail]);
  });
  /* ASUS: PACK-QA usa AVIPK como total de output */
  if (CURRENT_CLIENT === 'asus' && sO['AVIPK']) {
    sO['PACK-QA'] = { total: sO['AVIPK'].total, pass: sO['AVIPK'].pass, fail: sO['AVIPK'].fail };
  }

  /* ── Dedup para KPI/Overall — usa defRowsKpi (sem turno, 3 turnos fixos) ── */
  var _seenKpi={};
  var defDedupKpi=defRowsKpi.filter(function(r){
    var s=S(r[F.serial]); var st=S(r[F.st])||'N/A';
    if(!s||s==='') return true;
    var k=s+'\x00'+st;
    if(_seenKpi[k]) return false;
    _seenKpi[k]=true; return true;
  });
  var sDkpi={};
  defDedupKpi.forEach(function(r){var st=S(r[F.st])||'N/A';sDkpi[st]=(sDkpi[st]||0)+1;});

  function parcKpi(st){ var df=sDkpi[st]||0,t=sO[st]?sO[st].total:0; return t?1-df/t:null; }
  function prod(vals){ var v=vals.filter(function(x){return x!==null&&x>0;}); return v.length?v.reduce(function(a,x){return a*x;},1):null; }

  var pSB=parcKpi('S_VI_B'), pST=parcKpi('S_VI_T'), pFB=parcKpi('FBT'), pIC=parcKpi('ICT');
  var pF1=parcKpi('F1'), pF2=parcKpi('F2'), pFVI=parcKpi('FVI');
  var _cfg=getCfg();
  var oSMT=prod(_cfg.smtSts.map(function(s){return parcKpi(s);}));
  var oBE =prod(_cfg.beSts.map(function(s){return parcKpi(s);}));
  var ov  =prod([oSMT,oBE]);
  var totFDedup=defDedupKpi.length, totFRaw=defRowsKpi.length;
  var loss=ov?1-ov:null, totF=totFDedup, pack=sO['PACKING']?sO['PACKING'].total:0;
  var packFixed = (DATA._packTotal !== undefined) ? DATA._packTotal : pack;
  var taxaDef = ov !== null ? 1 - ov : null;

  /* ── Dedup para GRÁFICOS — usa defRows (com filtro de turno) ── */
  var _seenSerSt={};
  var defDedup=defRows.filter(function(r){
    var s=S(r[F.serial]); var st=S(r[F.st])||'N/A';
    if(!s||s==='') return true;
    var k=s+'\x00'+st;
    if(_seenSerSt[k]) return false;
    _seenSerSt[k]=true; return true;
  });
  var sD={};
  defDedup.forEach(function(r){var st=S(r[F.st])||'N/A';sD[st]=(sD[st]||0)+1;});
  if(DATA) DATA._sD = sD;
  if(DATA) DATA._defDedup = defDedup; /* salva defDedup para waterfall usar */
  function parc(st){ var df=sD[st]||0,t=sO[st]?sO[st].total:0; return t?1-df/t:null; }
  function yc(v){ return !v?'var(--t3)':v>=THRESH.green?'var(--green)':v>=THRESH.warn?'var(--amber)':v>=THRESH.amber?'var(--amber)':'var(--red)'; }
  /* kpiCls: abaixo 99% = warn (amarelo), abaixo 98% = kpi-crit (vermelho piscando) */
  function kpiCls(v){ if(!v||v===null) return ''; if(v<THRESH.warn) return ' kpi-crit'; if(v<THRESH.green) return ' warn'; return ''; }
  function yct(v){ return v===null?'var(--t3)':v<=0.01?'var(--green)':v<=0.03?'var(--amber)':'var(--red)'; }

  /* ── Produção SMT = total do último estágio SMT ── */
  var smtProd;
  if (CURRENT_CLIENT === 'huawei') {
    smtProd = sO['FT2_MP1'] ? sO['FT2_MP1'].pass : (sO['S_VI_T'] ? sO['S_VI_T'].total : 0);
  } else if (CURRENT_CLIENT === 'asus') {
    smtProd = sO['S_VI_T'] ? sO['S_VI_T'].total : 0;
  } else {
    smtProd = sO['S_VI_T'] ? sO['S_VI_T'].total : 0;
  }
  /* ── Produção BE ── */
  var beProd;
  if (CURRENT_CLIENT === 'hp') {
    beProd = sO['FVI2'] ? sO['FVI2'].total : 0;
  } else if (CURRENT_CLIENT === 'huawei') {
    beProd = sO['ST-MP9'] ? sO['ST-MP9'].pass : (sO['ST-MP1'] ? sO['ST-MP1'].pass : 0);
  } else if (CURRENT_CLIENT === 'asus') {
    /* Produção BE ASUS = AVIPK — usa DATA.stOut (fixo, sem filtro de estação) */
    var _stOutFixed = (DATA && DATA.stOut) ? DATA.stOut : sO;
    beProd = _stOutFixed['AVIPK'] ? _stOutFixed['AVIPK'].total : 0;
  } else {
    beProd = (sO['FBT'] ? sO['FBT'].total : 0) + (sO['F2'] ? sO['F2'].total : 0);
  }

  /* ── KPI ── */
  /* Linha 1: cards de produção + falhas (valores absolutos) */
  /* Linha 2: percentuais de qualidade */
  var taxaAlerta = taxaDef !== null && taxaDef > 0.01;
  var taxaStr = taxaDef!==null?(taxaDef*100).toFixed(2)+'%':'—';

  document.getElementById('kpiRow').innerHTML =
    /* BE PRODUTION */
    '<div class="kpi kpi-prod" style="--kc:var(--cyan)">'+
      '<div class="kpi-l">B.E PRODUTION</div>'+
      '<div class="kpi-v">'+fmt(beProd)+'</div>'+
    '</div>'+
    /* SMT PRODUTION */
    '<div class="kpi kpi-prod" style="--kc:var(--blue)">'+
      '<div class="kpi-l">SMT PRODUTION</div>'+
      '<div class="kpi-v">'+fmt(smtProd)+'</div>'+
    '</div>'+
    /* TOTAL FALHAS */
    '<div class="kpi" style="--kc:var(--red)">'+
      '<div class="kpi-l">TOTAL FALHAS</div>'+
      '<div class="kpi-v">'+fmt(totFDedup)+'</div>'+
    '</div>'+
    /* OVERALL SMT */
    '<div class="kpi'+kpiCls(oSMT)+
      '" style="--kc:'+yc(oSMT)+'">'+
      '<div class="kpi-l">OVERALL SMT</div>'+
      '<div class="kpi-v">'+pct(oSMT)+'</div>'+
    '</div>'+
    /* OVERALL B.E. */
    '<div class="kpi'+kpiCls(oBE)+
      '" style="--kc:'+yc(oBE)+'">'+
      '<div class="kpi-l">OVERALL B.E.</div>'+
      '<div class="kpi-v">'+pct(oBE)+'</div>'+
    '</div>'+
    /* OVERALL OFICIAL + TAXA DE DEFEITO juntos no mesmo card — sem divider */
    '<div class="kpi kpi-pair'+kpiCls(ov)+(taxaAlerta?' kpi-taxa-alert':'')+
      '" style="--kc:'+yc(ov)+'">'+
      '<div class="kpi-pair-inner">'+
        '<div class="kpi-pair-side">'+
          '<div class="kpi-l">OVERALL OFICIAL</div>'+
          '<div class="kpi-v kpi-v-fit">'+pct(ov)+'</div>'+
        '</div>'+
        '<div class="kpi-pair-side">'+
          '<div class="kpi-l">TAXA DE DEFEITO</div>'+
          '<div class="kpi-v kpi-v-fit kpi-taxa'+(taxaAlerta?' kpi-taxa-blink':'')+
            '" style="color:'+yct(taxaDef)+'">'+taxaStr+'</div>'+
        '</div>'+
      '</div>'+
    '</div>';

  /* ── Station matrix — usa getCfg() no momento do render, CURRENT_CLIENT já definido ── */
  var _cfgNow=getCfg();  /* lê CURRENT_CLIENT neste momento — correto */
  var _stRowEl = document.getElementById('stRow'); if(_stRowEl) _stRowEl.innerHTML = _cfgNow.matrix.map(function(st){
    var p=parcKpi(st);
    var col = _cfgNow.colors[st] || MT_CLR[st] || 'var(--t3)';
    var grp = _cfgNow.groups[st] || MT_GRP[st] || 'B.E';
    return '<div class="sk" style="--kc:'+col+'">'+
      '<div class="sk-group">'+grp+'</div>'+
      '<div class="sk-name">'+st+'</div>'+
      '<div class="sk-val" style="color:'+yc(p)+'">'+pct(p)+'</div>'+
      '<div class="sk-sub">Total: '+fmt(sO[st]?sO[st].total:0)+'</div>'+
      '<div class="sk-df">Falhas: '+fmt(sDkpi[st]||0)+'</div></div>';
  }).join('');

  /* ── Breakdown table: TODAS as estações presentes nos dados (filtradas por seleção) ── */
  /* Cálculos overall continuam usando só as 6 da MATRIX (pSB, pST, etc.) */
  var selSt = MS_STATE['st'] && MS_STATE['st'].size > 0 ? MS_STATE['st'] : null;

  /* Ordem fixa de exibição das estações */
  var ST_ORDER = ['S_VI_B','S_VI_T','FVI','ICT','FBT','F1','F2','FV2','PACK','PACKING'];
  var _excl2 = getCfg().excludeSt || [];

  /* Coleta todas as estações (exceto excluídas por cliente) */
  var allStSeen = {};
  var allStKeys = [];
  /* Primeiro adicionar as da ordem fixa que existam nos dados */
  ST_ORDER.forEach(function(st){
    if(_excl2.indexOf(st)!==-1) return; /* excluído por cliente */
    var inOut = (DATA.outRows||outRows).some(function(r){return S(r[O.st])===st;});
    var inDef = (DATA.defRows||defRows).some(function(r){return S(r[F.st])===st;});
    if((inOut||inDef) && !allStSeen[st]){ allStSeen[st]=true; allStKeys.push(st); }
  });
  /* Depois adicionar quaisquer outras estações não previstas (ordem alfabética) */
  var extraSt = [];
  (DATA.outRows||outRows).forEach(function(r){
    var st=S(r[O.st])||'N/A';
    if(!allStSeen[st] && _excl2.indexOf(st)===-1){allStSeen[st]=true;extraSt.push(st);}
  });
  (DATA.defRows||defRows).forEach(function(r){
    var st=S(r[F.st])||'N/A';
    if(!allStSeen[st] && _excl2.indexOf(st)===-1){allStSeen[st]=true;extraSt.push(st);}
  });
  extraSt.sort().forEach(function(st){allStKeys.push(st);});

  /* Filtrar por seleção do usuário se houver */
  var visibleSt = selSt ? allStKeys.filter(function(st){return selSt.has(st);}) : allStKeys;

  var stTotProd=1, stHasAny=false, stTotD=0, stTotT=0;
  /* TOTAL row usa sO/sD de TODAS as estações visíveis na tabela */
  var bdTotD=0, bdTotT=0, bdProd=1, bdHasAny=false;
  /* ── Breakdown por MODELO ── */
  /* Obtém modelos selecionados (ou todos) */
  var selMod = MS_STATE['mod'] && MS_STATE['mod'].size > 0 ? Array.from(MS_STATE['mod']) : null;

  /* Agrega total OUT por modelo (usa outRows filtrado) */
  var modOut = {}, modFail = {};
  outRows.forEach(function(r){
    var mod = S(r[O.modelo]).trim();
    if (!mod || mod === '—') return; /* ignora linhas sem modelo identificado */
    if(!modOut[mod]) modOut[mod] = 0;
    modOut[mod] += N(r[O.total]) || 1;
  });
  defDedup.forEach(function(r){
    var woR=S(r[F.wo])||'';
    var mod=(woMap[woR]?woMap[woR].modelo:'')||S(r['_modelo'])||'—';
    if(!modFail[mod]) modFail[mod] = 0;
    modFail[mod]++;
  });

  /* Lista de modelos: se filtro ativo usa só os selecionados, senão todos */
  var allMods = selMod ? selMod : Object.keys(modOut).sort();
  /* Inclui modelos que só aparecem em falhas */
  Object.keys(modFail).forEach(function(m){
    if(allMods.indexOf(m)===-1) allMods.push(m);
  });
  allMods.sort();

  var bdTotT2=0, bdTotD2=0;

  if (CURRENT_CLIENT === 'asus') {
    /* ASUS — Breakdown por modelo */
    var META_FPY = 0.99;

    /* Restaura cabeçalho padrão ASUS */
    var _tbStQ=document.getElementById('tbSt'); var thead = _tbStQ?_tbStQ.closest('table').querySelector('thead'):null;
    if (thead) thead.innerHTML = '<tr><th>Modelo</th><th>Total OUT</th><th>Falhas</th><th>●</th><th>Parcial FPY</th></tr>';

    var _tbStEl=document.getElementById('tbSt'); if(_tbStEl) _tbStEl.innerHTML = allMods.map(function(mod){
      var tot = modOut[mod]||0, df = modFail[mod]||0;
      bdTotT2+=tot; bdTotD2+=df;
      var p = tot ? 1-df/tot : null;
      var dot = p===null?'ia':p>=THRESH.green?'ig':p>=THRESH.warn?'ia':'ir';
      return '<tr>'+
        '<td class="lab">'+mod+'</td>'+
        '<td>'+fmt(tot)+'</td>'+
        '<td style="color:var(--red)">'+fmt(df)+'</td>'+
        '<td><span class="ind '+dot+'"></span></td>'+
        '<td style="color:'+yc(p)+';font-weight:700">'+pct(p)+'</td>'+
      '</tr>';
    }).join('') +
    '<tr class="tot"><td>TOTAL</td><td>'+fmt(bdTotT2)+'</td>'+
      '<td style="color:var(--red)">'+fmt(bdTotD2)+'</td><td></td>'+
      '<td style="color:var(--cyan);">'+pct(bdTotD2&&bdTotT2?1-bdTotD2/bdTotT2:null)+'</td>'+
    '</tr>';

    var _bdStEl=document.getElementById('bdSt'); if(_bdStEl) _bdStEl.textContent = allMods.length+' modelos · '+totF+' falhas';

  } else {
    /* ══ Outros clientes: tabela simples original ══ */
    /* Restaura o cabeçalho padrão */
    var _tbSt2=document.getElementById('tbSt'); var thead2 = _tbSt2?_tbSt2.closest('table').querySelector('thead'):null;
    if (thead2) thead2.innerHTML = '<tr><th>Modelo</th><th>Total OUT</th><th>Falhas</th><th>●</th><th>Parcial FPY</th></tr>';

    var _tbStEl=document.getElementById('tbSt'); if(_tbStEl) _tbStEl.innerHTML = allMods.map(function(mod){
      var tot = modOut[mod]||0, df = modFail[mod]||0;
      bdTotT2+=tot; bdTotD2+=df;
      var p = tot ? 1-df/tot : null;
      var dot = p===null?'ia':p>=THRESH.green?'ig':p>=THRESH.warn?'ia':'ir';
      return '<tr>'+
        '<td class="lab">'+mod+'</td>'+
        '<td>'+fmt(tot)+'</td>'+
        '<td style="color:var(--red)">'+fmt(df)+'</td>'+
        '<td><span class="ind '+dot+'"></span></td>'+
        '<td style="color:'+yc(p)+';font-weight:700">'+pct(p)+'</td>'+
      '</tr>';
    }).join('') +
    '<tr class="tot"><td>TOTAL</td><td>'+fmt(bdTotT2)+'</td>'+
      '<td style="color:var(--red)">'+fmt(bdTotD2)+'</td><td></td>'+
      '<td style="color:var(--cyan);">'+pct(bdTotD2&&bdTotT2?1-bdTotD2/bdTotT2:null)+'</td>'+
    '</tr>';
    var _bdSt2=document.getElementById('bdSt'); if(_bdSt2) _bdSt2.textContent = allMods.length+' modelos · '+totF+' falhas';
  }

  /* ── GRÁFICO 1: Falhas por hora ──
     Números em cima de cada barra via Chart.js plugin inline */
  var hrA={};
  defRows.forEach(function(r){
    var raw=S(r[F.failDate]);
    var m=raw.match(/\s(\d{1,2}):\d{2}:\d{2}/);
    var h=m?m[1].padStart(2,'0')+'h':'??';
    hrA[h]=(hrA[h]||0)+1;
  });
  var hK=Object.keys(hrA).filter(function(k){return k!=='??';}).sort();
  var hV=hK.map(function(k){return hrA[k];});
  var mxH=Math.max.apply(null,hV.concat([1]));
  document.getElementById('bdHr').textContent = totF+' falhas';

  CHARTS.hr = new Chart(document.getElementById('cHour').getContext('2d'), {
    type:'bar',
    data:{labels:hK, datasets:[{label:'Falhas', data:hV, borderRadius:4, borderWidth:1.5,
      backgroundColor:hV.map(function(v){return v===mxH?'rgba(139,26,26,0.75)':'rgba(30,58,95,0.5)';}),
      borderColor:hV.map(function(v){return v===mxH?'#ff3d5a':'#4d79ff';}),
    }]},
    options:{responsive:true, maintainAspectRatio:false,
      layout:{padding:{top:24}},
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label:function(ctx){return ' Falhas: '+ctx.raw;}}},
      },
      onClick: function(evt, els) {
        if (!els || !els.length) {
          if (HOUR_FILTER !== null) { HOUR_FILTER = null; applyHourFilter(); }
          return;
        }
        var lbl = hK[els[0].index];
        HOUR_FILTER = (HOUR_FILTER === lbl) ? null : lbl;
        applyHourFilter();
      },
      scales:{
        x:{ticks:{color:'#1E293B',font:{size:10,weight:'600'}},grid:{color:'#E2E8F0'}},
        y:{ticks:{color:'#1E293B',stepSize:1},grid:{color:'#E2E8F0'},beginAtZero:true}
      },
      animation:{onComplete:function(anim){barLabels(anim.chart,0,'#0F172A',11);}}
    }
  });

  /* ── GRÁFICO 2: Turno ── */
  var tA={'1ºT':0,'2ºT':0,'3ºT':0};
  defRows.forEach(function(r){ var t=getShift(S(r[F.failDate])); tA[t]=(tA[t]||0)+1; });
  var tK=['1ºT','2ºT','3ºT'], tV=tK.map(function(k){return tA[k]||0;});
  document.getElementById('bdTurno').textContent = totF+' total';
  /* Turno: cores sólidas — batem exatamente com a legenda */
  var tColors=['#1e3a5f','#f77f00','#047857'];
  var tBg    =['#1e3a5f','#f77f00','#047857'];

  CHARTS.turno = new Chart(document.getElementById('cTurno').getContext('2d'),{
    type:'doughnut',
    data:{labels:tK, datasets:[{data:tV,
      backgroundColor:tBg,
      borderColor:'#ffffff', borderWidth:2, hoverOffset:6}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:'60%',
      plugins:{
        legend:{position:'right', labels:{color:'#1E293B', font:{size:11,weight:'600'}, padding:12,
          usePointStyle:true, pointStyle:'circle',
          generateLabels:function(chart){
            var ds=chart.data.datasets[0];
            return chart.data.labels.map(function(l,i){
              return {text: l+'  '+ds.data[i], fillStyle:tBg[i],
                strokeStyle:tBg[i], lineWidth:0, hidden:false, index:i};
            });
          }
        }},
        tooltip:{callbacks:{label:function(ctx){return ' '+ctx.label+': '+ctx.parsed+' falhas';}}}
      }
    }
  });

  /* ── HELPER: pareto chart (bars + linha acumulado com números) ── */
  function makePareto(canvasId, labels, values, barColor, lineColor) {
    var total = values.reduce(function(a,v){return a+v;},0);
    var cum=0, pcts=values.map(function(v){cum+=v;return +((cum/total)*100).toFixed(1);});
    /* Azul por padrão, vermelho quando > 3 ocorrências */
    var bgArr   = values.map(function(v){ return v >= 3 ? '#dc2f02' : '#4cc9f0'; });
    var bordArr = values.map(function(v){ return v >= 3 ? '#b52501'   : '#29b4e0';   });

    var wrappedLabels = labels;

    var _maxLblLen = labels.reduce(function(mx,l){ return Math.max(mx, String(l).length); }, 0);
    var _xRotMax = _maxLblLen > 8 ? 45 : 0;
    var _xRotMin = _maxLblLen > 8 ? 45 : 0;

    return new Chart(document.getElementById(canvasId).getContext('2d'), {
      type:'bar',
      data:{
        labels: wrappedLabels,
        datasets:[
          {label:'Total de Falhas', data:values, backgroundColor:bgArr, borderColor:bordArr,
           borderWidth:1.5, borderRadius:5, yAxisID:'y', order:2},
          {type:'line', label:'% Acumulado', data:pcts, borderColor:'#f77f00', borderWidth:2.5,
           pointRadius:6, pointBackgroundColor:'#f77f00', pointBorderColor:'#ffffff',
           pointBorderWidth:2, yAxisID:'y2', fill:false, tension:.3, order:1},
        ]
      },
      options:{responsive:true, maintainAspectRatio:false,
        layout:{padding:{top:32, right:8, bottom:4}}, /* bottom gerenciado pelo afterFit */
        plugins:{legend:{display:false}},
        scales:{
          x:{ticks:{color:'#334155',
               font:{size:_xRotMax===45?10:11},
               color:'#0F172A',
               maxRotation:_xRotMax,minRotation:_xRotMin,autoSkip:false,
               padding:_xRotMax===45?8:4,
               callback:function(val,idx){
                 var lbl=this.getLabelForValue(val);
                 if(typeof lbl!=='string') return lbl;
                 if(_xRotMax===0){
                   if(lbl.length<=10) return lbl;
                   var words=lbl.split(' ');
                   if(words.length===1) return [lbl.slice(0,Math.ceil(lbl.length/2)),lbl.slice(Math.ceil(lbl.length/2))];
                   var mid=Math.ceil(words.length/2);
                   return [words.slice(0,mid).join(' '),words.slice(mid).join(' ')];
                 }
                 if(lbl.length<=12) return lbl;
                 var words=lbl.split(' ');
                 if(words.length<=1) return lbl;
                 var mid=Math.ceil(words.length/2);
                 return [words.slice(0,mid).join(' '), words.slice(mid).join(' ')];
               },
               afterFit:function(axis){ if(_xRotMax===45) axis.height=Math.min(axis.height,85); }
             },
             grid:{color:'#E2E8F0'},
             border:{display:false}},
          y:{
            ticks:{color:'#475569',stepSize:1,font:{size:9}},
            grid:{color:'#E2E8F0'},
            beginAtZero:true,
            /* Fix 2: max = maior valor + 1 para nunca tocar na borda */
            max:Math.ceil(Math.max.apply(null,values))+1,
            position:'left',
            border:{display:false}
          },
          y2:{ticks:{color:'#334155',callback:function(v){return v+'%';},font:{size:9}},
              grid:{display:false},min:0,max:108,position:'right',
              border:{display:false}}
        },
        animation:{onComplete:function(anim){
          barLabels(anim.chart, 0, '#0F172A', 11);
          lineLabels(anim.chart, 1, '#0F172A', 10);
        }}
      }
    });
  }

  /* Pareto Fail Description — usa defRows (total real de falhas) */
  var fdA={};
  defRows.forEach(function(r){var v=S(r[F.failDesc])||'TBA';fdA[v]=(fdA[v]||0)+1;});
  var fdK=Object.keys(fdA).sort(function(a,b){return fdA[b]-fdA[a];}).slice(0,13);
  var fdV=fdK.map(function(k){return fdA[k];});
  document.getElementById('bdFD').textContent = fdK.length+' causas';
  CHARTS.fd = makePareto('cFD', fdK, fdV, '#ff3d5a', '#00d4ff');
  CHARTS.fd._origLabels = fdK;

  /* Pareto Item — usa defRows (total real de falhas) */
  var itmA={};
  defRows.forEach(function(r){
    var v=S(r[F.item])||'TBA';
    itmA[v]=(itmA[v]||0)+1;
  });
  var itmK=Object.keys(itmA).sort(function(a,b){return itmA[b]-itmA[a];}).slice(0,13);
  var itmV=itmK.map(function(k){return itmA[k];});
  document.getElementById('bdItem').textContent = itmK.length+' componentes';
  CHARTS.item = makePareto('cItem', itmK, itmV, '#ffc400', '#b97fff');
  CHARTS.item._origLabels = itmK;

  /* ── Pareto table ── */
  /* Contagem de serial para alertas de duplicidade */
  var serCount = {};
  defRows.forEach(function(r){ var s=S(r[F.serial])||'—'; serCount[s]=(serCount[s]||0)+1; });

  var jA={};
  defRows.forEach(function(r){
    var wo=S(r[F.wo]), fd=S(r[F.failDesc])||'TBA';
    var itm=S(r[F.item])||'TBA', st=S(r[F.st])||'N/A';
    var ser=S(r[F.serial])||'—';
    /* Resolve modelo: 1) campo _modelo da falha (L10), 2) woMap por WO (L6) */
    var mod=(woMap[wo]?woMap[wo].modelo:'')||S(r['_modelo'])||'—';
    /* Extrai hora da falha */
    var rawDate=S(r[F.failDate]);
    var mh=rawDate.match(/\s(\d{1,2}:\d{2})/);
    var hora=mh?mh[1]:'—';
    var key=[fd,itm,st,ser,wo,mod,hora].join('\x00');
    jA[key]=(jA[key]||0)+1;
  });
  var pArr=Object.keys(jA).map(function(k){
    var p=k.split('\x00'); return{fd:p[0],itm:p[1],st:p[2],ser:p[3],wo:p[4],mod:p[5],hora:p[6],qty:jA[k]};
  }).sort(function(a,b){return b.qty-a.qty;});
  var pTot=pArr.reduce(function(a,r){return a+r.qty;},0);
  renderParTable(pArr, pTot, ' ocorrências', serCount);
  document.getElementById('bdPar').textContent = fmt(pTot)+' ocorrências';

  /* ── Click to filter: bind pareto chart bars → filter table & charts ── */
  bindParetoClick();

  /* ══ DASHBOARD ROW2: salva dados para renderizar após show('dash') ══ */
  if (DATA) { DATA._sO = sO; DATA._ov = ov; }
  if (DATA) DATA._sD = sD; /* sD definido após defDedup */

  /* Atualiza painel Monitor com dados atuais */
  pushMonitorData();
}

/* ══════════════════════════════════════════
   HELPER: renderiza tabela TOP
══════════════════════════════════════════ */
var PAR_DATA = [];      /* cache para filtro por serial */
var SER_FILTER = 0;     /* 0=todos, 2=duplo, 3=triplo+ */

function renderParTable(pArr, pTot, badgeSuffix, serCount) {
  PAR_DATA = pArr;
  _renderRows(pArr, serCount || window._lastSerCount || {});
  if (serCount) window._lastSerCount = serCount;
  document.getElementById('bdPar').textContent = fmt(pTot)+(badgeSuffix||' ocorrências');

  /* Atualiza badges de duplicidade com contagem real */
  var cnt2=0, cnt3=0;
  if (serCount) {
    Object.keys(serCount).forEach(function(s){
      if (s==='—') return;
      var n=serCount[s];
      if (n>=3) cnt3++;
      else if (n===2) cnt2++;
    });
  }
  var b2=document.getElementById('lgd2'), b3=document.getElementById('lgd3');
  if (b2) {
    b2.textContent = cnt2>0 ? '⚠ '+cnt2+' serial 2x' : '● 2x';
    b2.style.opacity = cnt2>0 ? '1' : '0.4';
    b2.style.fontWeight = cnt2>0 ? '700' : '400';
  }
  if (b3) {
    b3.textContent = cnt3>0 ? '🔴 '+cnt3+' serial 3x+' : '● 3x+';
    b3.style.opacity = cnt3>0 ? '1' : '0.4';
    b3.style.fontWeight = cnt3>0 ? '700' : '400';
  }
}

function _renderRows(pArr, serCount) {
  document.getElementById('tbPar').innerHTML = pArr.map(function(r,i){
    var fdBlank  = !r.fd  || r.fd  === '—' || r.fd  === 'TBA';
    var itmBlank = !r.itm || r.itm === '—' || r.itm === 'TBA';
    var fdCell = fdBlank
      ? '<span style="color:var(--amber);font-style:italic">TBA</span>'
      : '<span class="lab">'+r.fd+'</span>';
    var itmCell = itmBlank
      ? '<span style="color:var(--amber);font-style:italic">TBA</span>'
      : '<span style="color:var(--cyan)">'+r.itm+'</span>';

    /* Cor do serial baseada na contagem */
    var cnt = serCount[r.ser] || 1;
    var serColor, serBg, serIcon;
    if (cnt >= 3) {
      serColor = 'var(--red)'; serBg = '#ff3d5a18'; serIcon = '🔴 ';
    } else if (cnt === 2) {
      serColor = 'var(--amber)'; serBg = '#ffc40018'; serIcon = '🟡 ';
    } else {
      serColor = 'var(--t2)'; serBg = 'transparent'; serIcon = '';
    }
    var serCell = '<span style="color:'+serColor+';font-family:monospace;font-size:10px;'+
      'background:'+serBg+';padding:1px 5px;border-radius:3px" title="'+cnt+'x ocorrências neste serial">'+
      serIcon+r.ser+'</span>';
    var horaCell = r.hora && r.hora !== '—'
      ? '<span style="color:var(--cyan);font-family:monospace;font-size:10px">'+r.hora+'</span>'
      : '<span style="color:var(--t3)">—</span>';

    /* Destaque de linha inteira para duplicados */
    var rowBg = cnt>=3 ? 'background:#FEF2F2' : cnt===2 ? 'background:#FFFBEB' : '';
    var rowStyle = rowBg ? ' style="'+rowBg+'"' : '';
    return '<tr'+rowStyle+'>'+
      '<td style="color:var(--t3)">'+(i+1)+'</td>'+
      '<td>'+fdCell+'</td>'+
      '<td>'+itmCell+'</td>'+
      '<td><span class="badge bc" style="font-size:9px;padding:2px 6px">'+r.st+'</span></td>'+
      '<td>'+serCell+'</td>'+
      '<td>'+horaCell+'</td>'+
      '<td style="color:var(--t2)">'+r.wo.slice(-12)+'</td>'+
      '<td style="color:var(--t2)">'+r.mod+'</td>'+
      '<td style="color:var(--red);font-weight:700">'+r.qty+'</td></tr>';
  }).join('');
}

function filterBySer(minCount) {
  SER_FILTER = (SER_FILTER === minCount) ? 0 : minCount;
  var btn = document.getElementById('serFilterBtn');
  if (SER_FILTER === 0) {
    btn.style.display = 'none';
    _renderRows(PAR_DATA, window._lastSerCount || {});
  } else {
    btn.style.display = '';
    var filtered = PAR_DATA.filter(function(r){
      var cnt = (window._lastSerCount||{})[r.ser] || 1;
      return SER_FILTER === 3 ? cnt >= 3 : cnt === 2;
    });
    _renderRows(filtered, window._lastSerCount || {});
  }
}

function clearSerFilter() {
  SER_FILTER = 0;
  document.getElementById('serFilterBtn').style.display = 'none';
  _renderRows(PAR_DATA, window._lastSerCount || {});
}

/* ══════════════════════════════════════════
   PARETO CLICK FILTER
   Clicando numa barra filtra tabela e recalcula
══════════════════════════════════════════ */
var CHART_FILTER = {fd: null, itm: null};
var _chartRendering = false;  /* guard against re-entrant render during click */
var HOUR_FILTER = null;       /* filtra por hora clicada no gráfico */

function applyHourFilter() {
  if (!DATA || !DATA.defRows) return;
  /* Destaca barra selecionada */
  if (CHARTS.hr) {
    var hK = CHARTS.hr.data.labels;
    var hV = CHARTS.hr.data.datasets[0].data;
    var mxH = Math.max.apply(null, hV.concat([1]));
    CHARTS.hr.data.datasets[0].backgroundColor = hK.map(function(l, i){
      if (HOUR_FILTER === null) return hV[i]===mxH ? '#ff3d5a66' : '#4d79ff30';
      return l === HOUR_FILTER ? '#00d4ff99' : '#4d79ff18';
    });
    CHARTS.hr.data.datasets[0].borderColor = hK.map(function(l, i){
      if (HOUR_FILTER === null) return hV[i]===mxH ? '#ff3d5a' : '#4d79ff';
      return l === HOUR_FILTER ? '#00d4ff' : '#4d79ff44';
    });
    CHARTS.hr.update('none');
  }
  /* BUG FIX: usa DATA.defRows (ja filtrado por dropdowns) como base,
     nao _rawDefRows — assim respeita filtros ativos de turno/linha/etc.
     Tambem aplica CHART_FILTER ativo (clique no Pareto) */
  /* Sempre parte de _dropDefRows (base com turno, sem chart filters)
     depois aplica pareto filter e por último hora */
  var base = DATA._dropDefRows || DATA.defRows;
  var F = DATA.F;
  var fdF  = CHART_FILTER.fd;
  var itmF = CHART_FILTER.itm;
  if (fdF || itmF) {
    base = base.filter(function(r){
      var fd  = S(r[F.failDesc]) || 'TBA';
      var itm = S(r[F.item])     || 'TBA';
      return (!fdF || fd === fdF) && (!itmF || itm === itmF);
    });
  }
  /* Filtra pelo horário selecionado */
  var filtered = HOUR_FILTER === null ? base : base.filter(function(r){
    var raw = S(r[F.failDate]);
    var m = raw.match(/\s(\d{1,2}):\d{2}:\d{2}/);
    var h = m ? m[1].padStart(2,'0')+'h' : '??';
    return h === HOUR_FILTER;
  });
  var fo = DATA._rawOutRows;
  /* KPI cards usam defRowsKpi (3 turnos fixos, sem filtro de hora) */
  render(Object.assign({}, DATA, {outRows: fo, defRows: filtered, defRowsKpi: DATA.defRowsKpi}));
}

function bindParetoClick() {
  var cvFD = document.getElementById('cFD');
  var cvItm = document.getElementById('cItem');

  if (cvFD && !cvFD._acer_click) {
    cvFD._acer_click = true;
    cvFD.addEventListener('click', function(e){
      if (_chartRendering || !CHARTS.fd) return;
      var pts = CHARTS.fd.getElementsAtEventForMode(e,'nearest',{intersect:true},false);
      if (!pts.length) {
        if (CHART_FILTER.fd === null) return; /* nothing to do */
        CHART_FILTER.fd = null;
        /* Restaura defRows à base estável (com turno) — updateParetoHighlight vai refiltar */
        DATA.defRows = DATA._dropDefRows || DATA.defRows;
      } else {
        var idx = pts[0].index;
        var lbl = (CHARTS.fd._origLabels && CHARTS.fd._origLabels[idx]) ||
                  CHARTS.fd.data.labels[idx];
        if (Array.isArray(lbl)) lbl = lbl.join(' ');
        CHART_FILTER.fd = (CHART_FILTER.fd === lbl) ? null : lbl;
      }
      updateParetoHighlight();
    });
  }

  if (cvItm && !cvItm._acer_click) {
    cvItm._acer_click = true;
    cvItm.addEventListener('click', function(e){
      if (_chartRendering || !CHARTS.item) return;
      var pts = CHARTS.item.getElementsAtEventForMode(e,'nearest',{intersect:true},false);
      if (!pts.length) {
        if (CHART_FILTER.itm === null) return;
        CHART_FILTER.itm = null;
        /* Restaura defRows à base estável (com turno) — updateParetoHighlight vai refiltar */
        DATA.defRows = DATA._dropDefRows || DATA.defRows;
      } else {
        var idx = pts[0].index;
        var lbl = (CHARTS.item._origLabels && CHARTS.item._origLabels[idx]) ||
                  CHARTS.item.data.labels[idx];
        if (Array.isArray(lbl)) lbl = lbl.join(' ');
        CHART_FILTER.itm = (CHART_FILTER.itm === lbl) ? null : lbl;
      }
      updateParetoHighlight();
    });
  }
}

function updateParetoHighlight() {
  if (_chartRendering) return;
  _chartRendering = true;

  var d = DATA, F = d.F;
  var fdF  = CHART_FILTER.fd;
  var itmF = CHART_FILTER.itm;

  /* Sempre filtra a partir de _dropDefRows (base estável com turno, sem chart filters)
     → garante que desmarcar uma barra restaura o conjunto correto */
  var chartBase = DATA._dropDefRows || d.defRows;
  var filteredDef = (fdF || itmF) ? chartBase.filter(function(r){
    var fd  = S(r[F.failDesc]) || 'TBA';
    var itm = S(r[F.item])     || 'TBA';
    return (!fdF || fd === fdF) && (!itmF || itm === itmF);
  }) : chartBase;

  /* Atualiza DATA.defRows para hora-filtro usar como base */
  DATA.defRows = filteredDef;

  /* Full re-render — KPI cards usam defRowsKpi (3 turnos fixos) */
  render(Object.assign({}, d, {defRows: filteredDef, defRowsKpi: DATA.defRowsKpi || d.defRowsKpi}));

  /* Re-apply bar highlights + labels after render */
  setTimeout(function(){
    highlightChart(CHARTS.fd,  fdF,  '#4d79ff', '#4d79ff18');
    highlightChart(CHARTS.item,itmF, '#4d79ff', '#4d79ff18');
    var fdLbl = document.getElementById('fdFilterLbl');
    var itmLbl = document.getElementById('itmFilterLbl');
    if (fdLbl)  fdLbl.textContent  = fdF  ? '✕ '+fdF  : '';
    if (itmLbl) itmLbl.textContent = itmF ? '✕ '+itmF : '';
    _chartRendering = false;
  }, 60);
}

function highlightChart(chart, activeLabel, activeColor, dimColor) {
  if (!chart || !chart.data) return;
  var labels = chart.data.labels;
  var ds0 = chart.data.datasets[0];
  if (!ds0) return;
  var n = labels.length;

  /* Normalise bg/border to arrays on first call */
  function toArr(val, len, fallback) {
    if (Array.isArray(val)) return val.slice();
    var v = (val && val !== '') ? val : fallback;
    var arr = []; for (var i=0;i<len;i++) arr.push(v); return arr;
  }

  if (!ds0._origBgArr) {
    ds0._origBgArr   = toArr(ds0.backgroundColor, n, activeColor+'35');
    ds0._origBordArr = toArr(ds0.borderColor,      n, activeColor);
  }

  if (!activeLabel) {
    ds0.backgroundColor = ds0._origBgArr.slice();
    ds0.borderColor     = ds0._origBordArr.slice();
  } else {
    var origL = chart._origLabels || labels;
    ds0.backgroundColor = origL.map(function(l, i){
      var lStr = Array.isArray(l) ? l.join(' ') : l;
      return lStr === activeLabel ? ds0._origBgArr[i] : dimColor;
    });
    ds0.borderColor = origL.map(function(l, i){
      var lStr = Array.isArray(l) ? l.join(' ') : l;
      return lStr === activeLabel ? ds0._origBordArr[i] : dimColor;
    });
  }
  chart.update('none');
}

function rebuildTimeCharts(filteredRows, d) {
  var F = d.F;
  /* Rebuild hora chart */
  var hrA={};
  filteredRows.forEach(function(r){
    var raw=S(r[F.failDate]);
    var m=raw.match(/\s(\d{1,2}):\d{2}:\d{2}/);
    var h=m?m[1].padStart(2,'0')+'h':'??';
    hrA[h]=(hrA[h]||0)+1;
  });
  if (CHARTS.hr) {
    var hK=Object.keys(hrA).filter(function(k){return k!=='??';}).sort();
    var hV=hK.map(function(k){return hrA[k];});
    var mxH=Math.max.apply(null,hV.concat([1]));
    CHARTS.hr.data.labels = hK;
    CHARTS.hr.data.datasets[0].data = hV;
    CHARTS.hr.data.datasets[0].backgroundColor = hV.map(function(v){return v===mxH?'#ff3d5a66':'#4d79ff30';});
    CHARTS.hr.data.datasets[0].borderColor = hV.map(function(v){return v===mxH?'#ff3d5a':'#4d79ff';});
    CHARTS.hr.update();
  }
  /* Rebuild turno chart */
  var tA={'1ºT':0,'2ºT':0,'3ºT':0};
  filteredRows.forEach(function(r){ var t=getShift(S(r[F.failDate])); tA[t]=(tA[t]||0)+1; });
  if (CHARTS.turno) {
    CHARTS.turno.data.datasets[0].data = ['1ºT','2ºT','3ºT'].map(function(k){return tA[k]||0;});
    CHARTS.turno.update();
  }
}

/* ══════════════════════════════════════════
   FUNÇÕES DE LABEL NOS GRÁFICOS
   Renderizados via canvas 2D após animação
══════════════════════════════════════════ */

/* Números em cima das barras do dataset dsIdx */
/* Qty no CENTRO vertical da barra (pareto) */
function barLabels(chart, dsIdx, color, fsize) {
  var ctx=chart.ctx, ds=chart.data.datasets[dsIdx];
  if (!ds) return;
  var meta=chart.getDatasetMeta(dsIdx);
  var yAxis=chart.scales['y'];
  var zeroY=yAxis?yAxis.getPixelForValue(0):chart.chartArea.bottom;
  ctx.save();
  ctx.font='bold '+fsize+'px Segoe UI';
  ctx.fillStyle=color;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  meta.data.forEach(function(bar,i){
    var v=ds.data[i];
    if(v===null||v===undefined||v===0) return;
    /* Numero acima da barra */
    ctx.textBaseline='bottom';
    ctx.fillText(v, bar.x, bar.y-4);
    ctx.textBaseline='middle';
  });
  ctx.restore();
}

/* % acumulado ACIMA do ponto da linha (pareto) */
function lineLabels(chart, dsIdx, color, fsize) {
  var ctx=chart.ctx, ds=chart.data.datasets[dsIdx];
  if (!ds) return;
  var meta=chart.getDatasetMeta(dsIdx);
  ctx.save();
  ctx.font=fsize+'px IBM Plex Sans,Segoe UI';
  ctx.fillStyle=color;
  ctx.textAlign='center';
  ctx.textBaseline='bottom';
  meta.data.forEach(function(pt,i){
    var v=ds.data[i];
    if(v===null||v===undefined) return;
    var txt=v+'%';
    ctx.fillStyle=color;
    /* Se ponto muito alto, coloca label abaixo para nao sair do grafico */
    var chartTop = chart.chartArea ? chart.chartArea.top : 0;
    if (pt.y - 20 < chartTop) {
      ctx.textBaseline='top';
      ctx.fillText(txt, pt.x, pt.y+4);
      ctx.textBaseline='bottom';
    } else {
      ctx.fillText(txt, pt.x, pt.y-7);
    }
  });
  ctx.restore();
}

/* ── runAI removido conforme solicitado ── */
async function runAI() { /* diagnóstico IA desativado */ }

function buildLocalDiag() { return ''; }

function renderAlertas() { /* alertas IA desativados */ }

function colN(headers, cands) {
  var low=headers.map(function(h){return h.toLowerCase().trim();});
  for(var i=0;i<cands.length;i++){
    var c=cands[i].toLowerCase().trim();
    var idx=low.indexOf(c);
    if(idx===-1) for(var k=0;k<low.length;k++){if(low[k].indexOf(c)!==-1){idx=k;break;}}
    if(idx!==-1) return headers[idx];
  }
  return headers[0];
}
function S(v) { return String(v===null||v===undefined?'':v).trim(); }
function N(v) { var n=parseFloat(String(v).replace(/[^\d.\-]/g,'')); return isNaN(n)?0:n; }
function fmt(v) { return Math.round(v).toLocaleString('pt-BR'); }
function pct(v) { return (v!==null&&v!==undefined)?(v*100).toFixed(2)+'%':'N/A'; }
function uniq(a) { return a.filter(function(v,i,s){return v&&s.indexOf(v)===i;}); }
function show(id){ document.getElementById(id).style.display=''; }
function hide(id){ document.getElementById(id).style.display='none'; }
function step(msg,ms){ document.getElementById('lstep').textContent=msg; return new Promise(function(r){setTimeout(r,ms);}); }
function killCharts(){
  Object.values(CHARTS).forEach(function(c){try{c.destroy();}catch(e){}});
  CHARTS={};
  /* Reset click flags so listeners rebind correctly on next render */
  ['cFD','cItem'].forEach(function(id){
    var cv=document.getElementById(id); if(cv) cv._acer_click=false;
  });
}
function showErr(m){ var b=document.getElementById('errBox'); b.style.display=''; b.textContent='⚠ '+m; }
function setStatus(t,txt){ document.getElementById('sdot').className='dot'+(t?' '+t:''); document.getElementById('stxt').textContent=txt; }
async function typeText(el,txt){
  var words=txt.split(' '),cur='';
  for(var i=0;i<words.length;i++){
    cur+=(i?' ':'')+words[i]; el.textContent=cur;
    if(i%15===0) await new Promise(function(r){setTimeout(r,5);});
  }
}
function resetAll(){
  ['out','def'].forEach(function(k){
    RAW[k]=null;
    var c=document.getElementById('c-'+k); if(c)c.classList.remove('done');
    document.getElementById('n-'+k).textContent='Nenhum arquivo';
    document.getElementById('f-'+k).value='';
  });
  show('upZone'); hide('dash'); hide('errBox');
  var hb=document.getElementById('hBtnUpload'); if(hb) hb.style.display='none';
  /* Reexibir botão PUBLICAR se admin */
  if(IS_ADMIN){ var fpb=document.getElementById('fixedPublishBtn'); if(fpb) fpb.style.display='flex'; setTimeout(updateFixedPublishBtn,100); }
  document.getElementById('hint').textContent='Carregue os 2 arquivos para habilitar';
  setStatus('','Aguardando dados');
  killCharts(); DATA={}; MS_STATE={}; CHART_FILTER={fd:null,itm:null};
}

/* ══════════════════════════════════════════
   ABAS — switchTab
══════════════════════════════════════════ */
function switchTab(name) {
  ['dash','monitor'].forEach(function(n) {
    var btn = document.getElementById('tab-'+n);
    var pan = document.getElementById('panel-'+n);
    if (!btn || !pan) return;
    if (n === name) { btn.classList.add('active'); pan.classList.add('active'); }
    else            { btn.classList.remove('active'); pan.classList.remove('active'); }
  });
  /* Ao abrir monitor, renderiza imediatamente */
  if (name === 'monitor') {
    renderMonitor();
    setTimeout(function(){if(WATERFALL_CHART) WATERFALL_CHART.resize();},100);
  }
}

/* ══════════════════════════════════════════
   MONITOR — relógio
══════════════════════════════════════════ */
(function monClock() {
  function tick() {
    var n = new Date();
    var hh = n.getHours().toString().padStart(2,'0');
    var mm = n.getMinutes().toString().padStart(2,'0');
    var ss = n.getSeconds().toString().padStart(2,'0');
    var cl = document.getElementById('mClock');
    if (cl) cl.textContent = hh+':'+mm+':'+ss;
    var days=['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
    var months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    var dt = document.getElementById('mDate');
    if (dt) dt.textContent = days[n.getDay()]+' '+n.getDate()+' '+months[n.getMonth()]+' '+n.getFullYear();
  }
  setInterval(tick, 1000); tick();
})();

/* ══════════════════════════════════════════
   MONITOR — coleta dados do DATA global
══════════════════════════════════════════ */
var MONITOR_CHART = null;
var WATERFALL_CHART = null;
var M_LAST_SER = '';


/* ══════════════════════════════════════════════════════
   renderDashRow2 — popula Defeitos por Estação e Waterfall
   no dashboard (row2) usando os mesmos dados do render()
══════════════════════════════════════════════════════ */
function renderDashRow2(stOut, stDef, defDedup, ov) {
  /* ── Defeitos por Estação (tbDefDash / mDefLines2) ── */
  var d2 = document.getElementById('dashDefLines');
  if (d2 && stOut) {
    var cfg = getCfg();
    var allSt = cfg.matrix || Object.keys(stOut);
    var maxDf = Math.max.apply(null, allSt.map(function(st){ return stDef[st]||0; }).concat([1]));
    d2.innerHTML = allSt.map(function(st) {
      var df = stDef[st]||0, t = stOut[st] ? stOut[st].total : 0;
      var rate = t ? ((df/t)*100).toFixed(2) : null;
      var fpy  = t ? (1 - df/t) : null;
      var fpyCol = fpy === null ? '#64748B' : fpy >= THRESH.green ? '#047857' : fpy >= THRESH.warn ? '#B45309' : '#8b1a1a';
      var bw = maxDf ? Math.round((df/maxDf)*100) : 0;
      var defCol   = df > 0 ? '#8b1a1a' : '#047857';
      var rateCol  = (rate !== null && parseFloat(rate) > 1) ? '#8b1a1a' : '#B45309';
      var fpyBg    = fpy === null ? '#F1F5F9' :
                     fpy >= THRESH.green ? '#ECFDF5' :
                     fpy >= THRESH.amber ? '#FFFBEB' : '#FEF2F2';
      return '<tr>'+
        '<td style="font-weight:700;color:#0F172A;letter-spacing:0.5px;font-size:11px">'+st+'</td>'+
        '<td style="font-family:IBM Plex Mono,monospace;color:#334155">'+fmt(t)+'</td>'+
        '<td style="font-family:IBM Plex Mono,monospace;font-weight:700;color:'+defCol+'">'+df+'</td>'+
        '<td><div style="width:100%;height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden">'+
          '<div style="width:'+bw+'%;height:100%;background:'+(df>0?'#8b1a1a':'#047857')+';border-radius:4px;transition:width 0.6s ease"></div></div></td>'+
        '<td style="font-family:IBM Plex Mono,monospace;font-weight:700;color:'+rateCol+'">'+
          (rate !== null ? rate+'%' : '—')+'</td>'+
        '<td><span style="font-family:IBM Plex Mono,monospace;font-weight:700;color:'+fpyCol+';background:'+fpyBg+';padding:2px 8px;border-radius:4px;font-size:11px">'+
          (fpy !== null ? (fpy*100).toFixed(2)+'%' : 'N/A')+'</span></td>'+
        '</tr>';
    }).join('');
  }

  /* ── Waterfall no dashboard (mWaterfallDash2) ── */
  var wEl2 = document.getElementById('dashWaterfall');
  var tEl2 = document.getElementById('dashWaterfallTable');
  if (!wEl2 || typeof echarts === 'undefined') return;
  var F = DATA && DATA.F; if (!F) return;

  /* Calcula dados waterfall */
  var wMap = {};
  defDedup.forEach(function(r){ var v = S(r[F.failDesc])||'TBA'; wMap[v]=(wMap[v]||0)+1; });
  var baseTotal = 0;
  getCfg().matrix.forEach(function(st){ if(stOut[st]&&stOut[st].total>baseTotal) baseTotal=stOut[st].total; });
  if (!baseTotal) baseTotal = 1;

  var issues = Object.keys(wMap).map(function(k){ return {k:k,n:wMap[k],loss:0}; });
  issues.sort(function(a,b){ return b.n-a.n; }); issues = issues.slice(0,10);
  var fpyStart = ov !== null && ov !== undefined ? +(ov*100).toFixed(4) : 100;
  var totalFail = issues.reduce(function(s,i){ return s+i.n; }, 0);
  var defectRate = 1 - (fpyStart/100);
  issues.forEach(function(it){ it.loss = totalFail > 0 ? +(defectRate*it.n/totalFail*100).toFixed(2) : 0; });

  var accCur = fpyStart, accValues = [fpyStart];
  issues.forEach(function(it){ accCur = +(accCur+it.loss).toFixed(4); accValues.push(+accCur.toFixed(2)); });
  var accFinal = accValues[accValues.length-1];
  if (accFinal > 99.995 && accFinal <= 100.05) accFinal = 100.00;
  var labels = ['FPY'].concat(issues.map(function(it){return it.k;})).concat(['Total']);

  var colArr = [fpyStart>=99?'#00e676':fpyStart>=98?'#ffc400':'#cc2233'];
  issues.forEach(function(){ colArr.push('#dc2f02'); });
  colArr.push(accFinal>=99?'#00e676':accFinal>=98?'#ffc400':'#dc2f02');

  var offsetArr=[0], valArr=[fpyStart], isNegArr=[false];
  issues.forEach(function(it,idx){ offsetArr.push(accValues[idx]); valArr.push(it.loss); isNegArr.push(true); });
  offsetArr.push(0); valArr.push(100); isNegArr.push(false);

  var yMin = Math.floor(fpyStart-1); if(yMin>94)yMin=94; if(yMin<90)yMin=90;

  function wrapLbl(v,mx){ if(v.length<=mx)return v; var words=v.split(/[\s_\-]+/),lines=[],cur=''; words.forEach(function(w){ if((cur+' '+w).trim().length>mx&&cur){lines.push(cur.trim());cur=w;}else{cur=(cur+' '+w).trim();}}); if(cur)lines.push(cur.trim()); return lines.join('\n'); }
  var labelsWrapped = labels.map(function(v){ return wrapLbl(v,9); });

  if (window._dashWF) { try{window._dashWF.dispose();}catch(e){} window._dashWF=null; }
  window._dashWF = echarts.init(wEl2, 'dark');
  window._dashWF.setOption({
    backgroundColor:'transparent',
    grid:{top:30, bottom:4, left:95, right:12, containLabel:false},
    xAxis:{type:'category', data:labelsWrapped, axisLabel:{show:false},
           axisLine:{lineStyle:{color:'#CBD5E1'}}, axisTick:{show:false}, splitLine:{show:false}},
    yAxis:{type:'value', min:yMin, max:101,
           axisLabel:{color:'#334155',fontSize:9,formatter:'{value}%'},
           splitLine:{lineStyle:{color:'#E2E8F0',type:'dashed'}},
           axisLine:{lineStyle:{color:'#CBD5E1'}}},
    series:[
      {type:'bar', stack:'wf', silent:true, itemStyle:{color:'transparent'},
       data:offsetArr.map(function(v,i){return isNegArr[i]?v:0;})},
      {type:'bar', stack:'wf', barMaxWidth:48,
       label:{show:true, position:'top', color:'#0F172A', fontSize:9, fontWeight:'normal',
              formatter:function(p){ var i=p.dataIndex; if(i===0)return fpyStart.toFixed(2)+'%'; if(i===labels.length-1)return '100.00%'; return issues[i-1].loss.toFixed(2)+'%'; }},
       itemStyle:{color:function(p){return colArr[p.dataIndex];}, borderRadius:[3,3,0,0]},
       data:valArr.map(function(v,i){return {value:v,itemStyle:{color:colArr[i],borderRadius:[3,3,0,0]}};})},
      {type:'line', data:labels.map(function(){return THRESH.target;}), symbol:'none',
       lineStyle:{color:'#1e3a5f',width:2,type:'dashed'}, z:10, silent:true, name:'Meta 99%'}
    ],
    tooltip:{trigger:'axis', backgroundColor:'#ffffffee', borderColor:'#CBD5E1',
             textStyle:{color:'#0F172A',fontSize:10},
             formatter:function(params){ var i=params[0].dataIndex;
               if(i===0)return '<b>FPY Inicial</b><br/>Overall: <b style="color:#8b1a1a">'+fpyStart.toFixed(2)+'%</b>';
               if(i===labels.length-1)return '<b>Total Final</b><br/>FPY: <b style="color:'+colArr[i]+'">'+accFinal.toFixed(2)+'%</b>';
               var it=issues[i-1]; return '<b>'+it.k+'</b><br/>Qty: <b>'+it.n+'</b><br/>Loss: <b style="color:#8b1a1a">-'+it.loss.toFixed(2)+'%</b><br/>ACC: <b style="color:#047857">'+accValues[i].toFixed(2)+'%</b>'; }}
  });

  /* Tabela abaixo */
  if (tEl2) {
    var fpyLossRow=[''].concat(issues.map(function(it){return it.loss.toFixed(2)+'%';})).concat([(100-fpyStart).toFixed(2)+'%']);
    var accRow2=[fpyStart.toFixed(2)+'%'].concat(accValues.slice(1).map(function(v){return v.toFixed(2)+'%';}));
    var failQty2=[''].concat(issues.map(function(it){return it.n;})).concat([totalFail]);
    var targetRow2=labels.map(function(){return '99,00%';});
    function accCol(v){ var n=parseFloat(v); return n>=99?'#047857':n>=98?'#B45309':'#8b1a1a'; }
    var rows2=[
      {label:'Fail Qty',    color:'#1e3a5f', vals:failQty2,   dyn:false},
      {label:'FPY/FPY Loss',color:'#B45309', vals:fpyLossRow,  dyn:false},
      {label:'ACC',         color:'#047857', vals:accRow2,     dyn:true},
      {label:'Target',      color:'#1e3a5f', vals:targetRow2,  dyn:false}
    ];
    var h2='<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;border-top:1px solid #E2E8F0">';
    /* Header row */
    h2+='<tr><td style="width:90px;border-bottom:2px solid #1e3a5f;border-right:1px solid #CBD5E1;background:#F1F5F9"></td>';
    labels.forEach(function(l){
      var words=l.split(/[\s\-_]+/), mid=Math.ceil(words.length/2);
      var txt=words.length>=2?words.slice(0,mid).join(' ')+'<br>'+words.slice(mid).join(' '):l;
      h2+='<td style="text-align:center;color:#0F172A;font-weight:700;padding:4px 2px;font-size:9px;line-height:1.3;vertical-align:middle;border-bottom:2px solid #1e3a5f;border-left:1px solid #E2E8F0;min-height:32px" title="'+l+'">'+txt+'</td>';
    });
    h2+='</tr>';
    rows2.forEach(function(row){
      h2+='<tr><td style="color:'+row.color+';font-weight:700;font-size:10px;padding:3px 6px;white-space:nowrap;border-right:1px solid #CBD5E1;background:#F8FAFC">'+row.label+'</td>';
      row.vals.forEach(function(v){
        var vStr=(v===''||v===0)?'':String(v);
        var col=row.dyn?accCol(vStr):row.color;
        h2+='<td style="text-align:center;color:'+col+';padding:3px 2px;font-family:IBM Plex Mono,monospace;font-size:10px;font-weight:500;border-left:1px solid #E2E8F0">'+vStr+'</td>';
      });
      h2+='</tr>';
    });
    h2+='</table>';
    tEl2.innerHTML=h2;
  }
  window.addEventListener('resize', function(){ if(window._dashWF) window._dashWF.resize(); });
}

function pushMonitorData() {
  /* Renderiza o painel se já estiver visível */
  var pan = document.getElementById('panel-monitor');
  if (pan && pan.classList.contains('active')) renderMonitor();
}

function renderMonitor() {
  if (!DATA || !DATA._rawDefRows) return;
  var d = DATA, O = d.O, F = d.F;
  /* Gráficos: usa dados filtrados COM turno */
  var defRows = d.defRows || d._rawDefRows;
  var outRows = d.outRows || d._rawOutRows;
  /* Cards/KPI: usa dados filtrados SEM turno (3 turnos sempre fixos) */
  var defRowsKpi = d.defRowsKpi || defRows;
  var woMap = d.woMap || {};

  /* ── Agrega produção por estação ── */
  var sO={};
  outRows.forEach(function(r){
    var st=S(r[O.st])||'N/A';
    if(!sO[st]) sO[st]={total:0,pass:0,fail:0};
    sO[st].total+=N(r[O.total]); sO[st].pass+=N(r[O.pass]); sO[st].fail+=N(r[O.fail]);
  });

  /* ── Dedup KPI — sem turno (3 turnos fixos) ── */
  var _mSeenKpi={};
  var defDedupKpi=defRowsKpi.filter(function(r){
    var s=S(r[F.serial]); var st=S(r[F.st])||'N/A';
    if(!s||s==='') return true;
    var k=s+'\x00'+st;
    if(_mSeenKpi[k]) return false;
    _mSeenKpi[k]=true; return true;
  });
  var sDkpi={};
  defDedupKpi.forEach(function(r){var st=S(r[F.st])||'N/A';sDkpi[st]=(sDkpi[st]||0)+1;});

  /* ── Dedup charts — com turno ── */
  var _mSeen={};
  var defDedup=defRows.filter(function(r){
    var s=S(r[F.serial]); var st=S(r[F.st])||'N/A';
    if(!s||s==='') return true;
    var k=s+'\x00'+st;
    if(_mSeen[k]) return false;
    _mSeen[k]=true; return true;
  });
  var sD={};
  defDedup.forEach(function(r){var st=S(r[F.st])||'N/A';sD[st]=(sD[st]||0)+1;});
  if(DATA) DATA._sD = sD;
  if(DATA) DATA._defDedup = defDedup; /* salva defDedup para waterfall usar */

  function parcKpi(st){var df=sDkpi[st]||0,t=sO[st]?sO[st].total:0;return t?1-df/t:null;}
  function parc(st){var df=sD[st]||0,t=sO[st]?sO[st].total:0;return t?1-df/t:null;}
  function prod(vals){var v=vals.filter(function(x){return x!==null&&x>0;});return v.length?v.reduce(function(a,x){return a*x;},1):null;}
  /* Overall usa parcKpi (3 turnos fixos) — configuração por cliente */
  var _mcfg=getCfg();
  var oSMT=prod(_mcfg.smtSts.map(function(s){return parcKpi(s);}));
  var oBE =prod(_mcfg.beSts.map(function(s){return parcKpi(s);}));
  var ov=prod([oSMT,oBE]);
  var taxa=ov!==null?+(((1-ov)*100).toFixed(2)):null;
  var packFixed=(DATA._packTotal!==undefined)?DATA._packTotal:0;
  var totDedup=defDedupKpi.length, totRaw=defRowsKpi.length;
  function vc(v){return v===null?'var(--t3)':v>=THRESH.green?'var(--green)':v>=THRESH.warn?'var(--cyan)':v>=THRESH.amber?'var(--amber)':'var(--red)';}
  function vcl(v){if(v===null)return '';if(v>=THRESH.green)return 'ok';if(v>=THRESH.amber)return 'warn';return 'crit';}
  function p2(v){return v!==null?(v*100).toFixed(2)+'%':'—';}

  /* Status dot */
  var dot=document.getElementById('mDot'), txt=document.getElementById('mTxt');
  if(taxa>3){dot.className='mpulse crit';txt.textContent='⚠ CRÍTICO';txt.style.color='var(--red)';}
  else if(taxa>1){dot.className='mpulse warn';txt.textContent='MONITORAR';txt.style.color='var(--amber)';}
  else{dot.className='mpulse';txt.textContent='NORMAL';txt.style.color='var(--green)';}

  /* ── KPI CARDS TOP ── */
  function setKpi(idVal, val, idBar, barPct, col){
    var el=document.getElementById(idVal); if(el){el.textContent=val;if(col)el.style.color=col;}
    var b=document.getElementById(idBar);  if(b&&col){b.style.width=barPct+'%';b.style.background=col;b.style.boxShadow='0 0 6px '+col;}
  }
  // Pass Packing
  setKpi('mKpi0', packFixed.toLocaleString('pt-BR'), 'mKb0', 100, 'var(--t2)');
  // Total falhas
  setKpi('mKpi1', totDedup, 'mKb1', packFixed?Math.min(100,(totDedup/packFixed)*100*20).toFixed(0):0, 'var(--red)');
  // Taxa defeito
  var taxaStr=taxa!==null?taxa.toFixed(2)+'%':'—';
  setKpi('mKpi2', taxaStr, 'mKb2', taxa!==null?Math.min(100,taxa*10).toFixed(0):0, 'var(--amber)');
  // SMT mini card
  var sEl=document.getElementById('mVSMT');
  if(sEl){sEl.textContent=p2(oSMT);sEl.style.color=vc(oSMT);}
  // BE mini card
  var bEl=document.getElementById('mVBE');
  if(bEl){bEl.textContent=p2(oBE);bEl.style.color=vc(oBE);}
  // Overall (atualizado via drawGauge)

  /* ── FPY POR ESTAÇÃO ── */
  var ST_ORDER=['S_VI_B','S_VI_T','FVI','ICT','FBT','F1','F2','FV2','PACK','PACKING'];
  var _excl=getCfg().excludeSt||[];
  /* Inclui SEMPRE as estações da config do cliente, mesmo com 0 falhas */
  var _matrixSts = getCfg().matrix;
  var _allStSeen2 = {};
  var allSt = [];
  _matrixSts.forEach(function(st){ if(_excl.indexOf(st)===-1){ _allStSeen2[st]=true; allSt.push(st); } });
  Object.keys(sO).forEach(function(s){
    if(_excl.indexOf(s)===-1 && !_allStSeen2[s]){ _allStSeen2[s]=true; allSt.push(s); }
  });
  allSt.sort(function(a,b){
    var ia=ST_ORDER.indexOf(a),ib=ST_ORDER.indexOf(b);
    if(ia===-1&&ib===-1)return a.localeCompare(b);
    if(ia===-1)return 1;if(ib===-1)return -1;return ia-ib;
  });
  document.getElementById('mBdSt').textContent=allSt.length+' estações';
  var SMT_STS=getCfg().smtSts;
  document.getElementById('mStGrid').innerHTML=allSt.map(function(st){
    var v=parc(st),df=sD[st]||0,cls=vcl(v),col=vc(v);
    var fase=SMT_STS.indexOf(st)!==-1?'SMT':'B.E';
    var faseCol=SMT_STS.indexOf(st)!==-1?'var(--cyan)':'var(--amber)';
    return '<div class="st2-cell '+cls+'">'+
      '<div class="st2-lbl" style="color:'+faseCol+'">'+fase+'</div>'+
      '<div class="st2-name">'+st+'</div>'+
      '<div class="st2-fpy" style="color:'+col+'">'+p2(v)+'</div>'+
      '<div class="st2-def">'+df+' falha'+(df!==1?'s':'')+'</div></div>';
  }).join('');

  /* ── DEFEITOS POR ESTAÇÃO — tabela profissional ── */
  var mDefLines=document.getElementById('mDefLines');
  if(mDefLines){
    var maxDf=Math.max.apply(null,allSt.map(function(st){return sD[st]||0;}).concat([1]));
    mDefLines.innerHTML=allSt.map(function(st){
      var df=sD[st]||0,t=sO[st]?sO[st].total:0;
      var rate=t?((df/t)*100).toFixed(2):null;
      var fpy=t?(1-df/t):null;
      var fpyCol=fpy!==null?vc(fpy):'var(--t3)';
      var bw=maxDf?Math.round((df/maxDf)*100):0;
      var defCol=df>0?'var(--red)':'var(--green)';
      var fpyBadgeBg=fpy===null?'#333':fpy>=THRESH.green?'#00e67622':fpy>=THRESH.amber?'#ffc40022':'#ff3d5a22';
      return '<tr>'+
        '<td style="font-weight:700;color:var(--t1);letter-spacing:1px">'+st+'</td>'+
        '<td style="font-family:monospace;color:var(--t2)">'+t.toLocaleString('pt-BR')+'</td>'+
        '<td style="font-family:monospace;font-weight:700;color:'+defCol+'">'+df+'</td>'+
        '<td><div class="mdef-bar-wrap"><div class="mdef-bar-inner" style="width:'+bw+'%"></div></div></td>'+
        '<td style="font-family:monospace;font-weight:700;color:'+(rate!==null&&rate>1?'var(--red)':'var(--amber)')+'">'+
          (rate!==null?rate+'%':'—')+'</td>'+
        '<td><span class="mdef-fpy-badge" style="color:'+fpyCol+';background:'+fpyBadgeBg+'">'+
          (fpy!==null?(fpy*100).toFixed(2)+'%':'N/A')+'</span></td>'+
        '</tr>';
    }).join('');
  }

  /* ── FALHAS / HORA ── */
  var hMap={};
  defRows.forEach(function(r){var raw=S(r[F.failDate]);var m=raw.match(/\s(\d{1,2}):/);var h=m?parseInt(m[1]):0;var hk=(h<10?'0':'')+h+'h';hMap[hk]=(hMap[hk]||0)+1;});
  var hKeys=Object.keys(hMap).sort();
  var hVals=hKeys.map(function(k){return hMap[k];});
  document.getElementById('mBdHr').textContent=totDedup+' falhas';
  if(MONITOR_CHART){MONITOR_CHART.destroy();MONITOR_CHART=null;}
  var mctx=document.getElementById('mCHour');
  if(mctx){
    MONITOR_CHART=new Chart(mctx.getContext('2d'),{
      type:'bar',
      data:{labels:hKeys,datasets:[{data:hVals,
        backgroundColor:hVals.map(function(v){return v>10?'#ff2d4a55':v>5?'#ffb30055':'#b97fff55';}),
        borderColor:hVals.map(function(v){return v>10?'#ff2d4a':v>5?'#ffb300':'#b97fff';}),
        borderWidth:1,borderRadius:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{x:{ticks:{color:'#3d6480',font:{size:8},maxRotation:0},grid:{color:'#0e2840'}},
                y:{ticks:{color:'#3d6480',font:{size:8}},grid:{color:'#0e2840'},beginAtZero:true}}}
    });
  }

  /* ── WATERFALL TOP ISSUE ── */
  (function(){
    var wEl=document.getElementById('mWaterfall');
    if(!wEl||typeof echarts==='undefined') return;

    /* Agrupa falhas por failDesc (usa defDedup — IGUAL ao Dashboard) */
    var wMap={};
    defDedup.forEach(function(r){
      var v=S(r[F.failDesc])||'TBA';
      wMap[v]=(wMap[v]||0)+1;
    });

    /* Pega total de saida para calcular FPY loss % */
    var totalOut=Object.keys(sO).reduce(function(s,k){
      /* usa a estacao com mais saida como base (maior throughput) */
      var t=sO[k]?sO[k].total:0; return s+t;
    },0);
    /* Na verdade usa o total da primeira estacao SMT como base */
    var baseTotal=0;
    getCfg().matrix.forEach(function(st){
      if(sO[st]&&sO[st].total>baseTotal) baseTotal=sO[st].total;
    });
    if(!baseTotal) baseTotal=Object.keys(sO).reduce(function(m,k){return Math.max(m,sO[k]?sO[k].total:0);},1);

    /* Top issues por quantidade, max 10 */
    var issues=Object.keys(wMap).map(function(k){return{k:k,n:wMap[k],loss:+(wMap[k]/baseTotal*100).toFixed(2)};});
    issues.sort(function(a,b){return b.n-a.n;});
    issues=issues.slice(0,10);

    /* ══ CÁLCULO IGUAL AO EXCEL ══
       FPY Loss = (1 - FPY_inicial) * qty_causa / total_falhas
       ACC começa no FPY inicial e SOBE conforme retira cada causa
       Barra = pequena barra vermelha descendo do ACC anterior
       Total = barra verde/amarela/vermelha no FPY acumulado final
    */
    var fpyStart = ov!==null ? +(ov*100).toFixed(4) : 100;
    var totalFail = issues.reduce(function(s,i){return s+i.n;},0);
    var defectRate = 1 - (fpyStart/100); /* taxa de defeito = 1 - FPY */

    /* Recalcula loss de cada causa com fórmula do Excel:
       loss% = (1 - FPY_inicial) * qty / total_falhas * 100  */
    issues.forEach(function(it){
      it.loss = totalFail>0 ? +(defectRate * it.n / totalFail * 100).toFixed(2) : 0;
    });

    /* ACC acumulado — parte de fpyStart e SOMA os losses removidos */
    var accCur = fpyStart;
    var accValues = [fpyStart]; /* ACC[0] = FPY inicial */
    issues.forEach(function(it){
      accCur = +(accCur + it.loss).toFixed(4); /* mais precisão */
      accValues.push(+accCur.toFixed(2));
    });
    var accFinal = accValues[accValues.length-1];
    /* Força 100.00% se muito próximo (evita 100.01%) */
    if(accFinal > 99.995 && accFinal <= 100.05) accFinal = 100.00;

    /* Arrays para o gráfico */
    var labels    = ['FPY'];
    var failQty   = [''  ];
    var fpyLossRow= [''  ];
    var accRow    = [fpyStart.toFixed(2)+'%'];
    var targetRow = ['99,00%'];

    /* Waterfall ECharts:
       - Barra FPY inicial: offset=0, val=fpyStart (vermelha, sólida)
       - Barras de causa:   offset=ACC_anterior, val=loss (vermelha pequena, desce)
       - Barra Total:       offset=0, val=accFinal (verde/amarelo/vermelho)
    */
    var offsetArr = [0];          /* parte invisível (base) */
    var valArr    = [fpyStart];   /* parte visível */
    var colArr    = [fpyStart>=99?'#00e676':fpyStart>=98?'#ffc400':'#cc2233'];
    var isNegArr  = [false];      /* false = barra do fundo, true = barra suspensa */

    issues.forEach(function(it, idx){
      labels.push(it.k);
      failQty.push(it.n);
      fpyLossRow.push(it.loss.toFixed(2)+'%');
      accRow.push(accValues[idx+1].toFixed(2)+'%');
      targetRow.push('99,00%');
      /* offset = ACC do ponto anterior (barra começa de cima do ACC anterior) */
      offsetArr.push(accValues[idx]);
      valArr.push(it.loss);
      colArr.push('#ff3d5a');
      isNegArr.push(true);
    });

    /* Barra Total */
    var totalQty = totalFail;
    var totalLoss = +(defectRate*100).toFixed(2);
    labels.push('Total');
    failQty.push(totalQty);
    fpyLossRow.push((100-fpyStart).toFixed(2)+'%');
    accRow.push('100.00%');
    targetRow.push('99,00%');
    offsetArr.push(0);
    valArr.push(100.00);
    colArr.push(accFinal>=99?'#00e676':accFinal>=98?'#ffc400':'#ff3d5a');
    isNegArr.push(false);

    /* alias para compatibilidade com tooltip abaixo */
    var acc = accFinal;
    var accArr = offsetArr; /* usado no tooltip ACC display */

    /* Monta series */
    /* Serie 1: offset invisivel (stack base) */
    var offsetSeries={
      type:'bar', stack:'wf', silent:true,
      itemStyle:{color:'transparent'},
      data:offsetArr.map(function(v,i){return isNegArr[i]?v:0;})
    };
    /* Serie 2: barras coloridas */
    var barSeries={
      type:'bar', stack:'wf', barMaxWidth:50,
      label:{show:true, position:'top', color:'#0F172A', fontSize:10, fontWeight:'normal',
        formatter:function(p){
          var i=p.dataIndex;
          if(i===0) return fpyStart.toFixed(2)+'%';
          if(i===labels.length-1) return '100.00%';
          return issues[i-1].loss.toFixed(2)+'%';
        }
      },
      itemStyle:{
        color:function(p){return colArr[p.dataIndex];},
        borderRadius:[3,3,0,0]
      },
      data:valArr.map(function(v,i){
        return {value:v, itemStyle:{color:colArr[i], borderRadius:[3,3,0,0],
          shadowColor:colArr[i]+'66', shadowBlur:6}};
      })
    };

    /* Linha meta 99% */
    var metaLine={
      type:'line', data:labels.map(function(){return THRESH.target;}),
      symbol:'none', lineStyle:{color:'#4488ff',width:2,type:'dashed'},
      markPoint:{},
      z:10, silent:true,
      name:'Meta 99%'
    };

    /* ── Quebra de texto nos labels do eixo X ── */
    function wrapLabel(v, maxLen){
      maxLen = maxLen||10;
      if(v.length<=maxLen) return v;
      /* divide em palavras e quebra em linhas */
      var words=v.split(/[\s_\-]+/);
      var lines=[], cur='';
      words.forEach(function(w){
        if((cur+' '+w).trim().length>maxLen && cur!=''){
          lines.push(cur.trim()); cur=w;
        } else { cur=(cur+' '+w).trim(); }
      });
      if(cur) lines.push(cur.trim());
      return lines.join('\n');
    }

    var labelsWrapped = labels.map(function(v){ return wrapLabel(v,10); });

    if(WATERFALL_CHART){WATERFALL_CHART.dispose();WATERFALL_CHART=null;}
    WATERFALL_CHART=echarts.init(wEl,'dark');

    /* Calcula min do eixo Y dinamicamente */
    var yMin = Math.floor(fpyStart - 1);
    if(yMin > 94) yMin = 94;
    if(yMin < 90) yMin = 90;

    WATERFALL_CHART.setOption({
      backgroundColor:'transparent',
      grid:{top:36, bottom:4, left:52, right:12, containLabel:false},
      xAxis:{
        type:'category',
        data: labelsWrapped,
        axisLabel:{show:false}, /* REMOVE labels do eixo X */
        axisLine:{lineStyle:{color:'#1e3a50'}},
        axisTick:{show:false},
        splitLine:{show:false}
      },
      yAxis:{
        type:'value', min:yMin, max:101,
        axisLabel:{color:'#334155',fontSize:9,formatter:'{value}%'},
        splitLine:{lineStyle:{color:'#E2E8F0',type:'dashed'}},
        axisLine:{lineStyle:{color:'#CBD5E1'}}
      },
      series:[
        offsetSeries,
        barSeries,
        /* Linha meta — z alto para ficar na frente */
        {
          type:'line',
          data:labels.map(function(){return THRESH.target;}),
          name:'Meta 99%'
        }
      ],
      tooltip:{
        trigger:'axis', backgroundColor:'#ffffffee',
        borderColor:'#CBD5E1', textStyle:{color:'#0F172A',fontSize:10},
        formatter:function(params){
          var i=params[0].dataIndex;
          if(i===0) return '<b>FPY Inicial</b><br/>Overall: <b style="color:#ff4455">'+fpyStart.toFixed(2)+'%</b>';
          if(i===labels.length-1) return '<b>Total Final</b><br/>FPY: <b style="color:'+colArr[i]+'">'+acc.toFixed(2)+'%</b><br/>Loss total: <b style="color:#ff4455">-'+(fpyStart-acc).toFixed(2)+'%</b>';
          var it=issues[i-1];
          return '<b>'+it.k+'</b><br/>Fail Qty: <b>'+it.n+'</b><br/>FPY Loss: <b style="color:#ff4455">-'+it.loss.toFixed(2)+'%</b><br/>ACC: <b style="color:#ffc400">'+accValues[i].toFixed(2)+'%</b>';
        }
      }
    });

    /* ── Tabela de dados embaixo do grafico (igual imagem) ── */
    /* Usa HTML nativo abaixo do canvas para melhor controle */
    var tblDiv=document.getElementById('mWaterfallTable');
    if(tblDiv){
      var nCols=labels.length;
      /* largura de cada coluna proporcional ao grafico */
      /* Cores dinâmicas para ACC baseado no valor */
      function getAccColor(v) {
        if(!v || v==='') return '#00cc66';
        var num = parseFloat(v);
        if(num >= 99.00) return '#00e676'; /* verde */
        if(num >= 98.00) return '#ffc400'; /* amarelo */
        return '#ff3d5a'; /* vermelho */
      }
      
      var accRowWithColors = accRow.map(function(v){ return {val:v, col:getAccColor(v)}; });
      
      var rows=[
        {label:'Fail Qty',    color:'#5a8aaa',   vals:failQty, dynamic:false},
        {label:'FPY/FPY Loss',color:'#ccaa00',   vals:fpyLossRow, dynamic:false},
        {label:'ACC',         color:'#00cc66',   vals:accRowWithColors, dynamic:true},
        {label:'Target',      color:'#4488ff',   vals:targetRow, dynamic:false}
      ];
      var html='<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;margin-top:0;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden">';
      /* linha de labels (nomes de falha) — texto quebrado em 2 linhas */
      html+='<tr><td style="width:90px;border-bottom:2px solid #1e3a5f;border-right:1px solid #CBD5E1;background:#F1F5F9"></td>';
      labels.forEach(function(l,i){
        /* Quebra em 2 linhas — mostra texto completo */
        var txt = l;
        if(l.length > 12) {
          /* quebra por espaço, hífen ou underscore */
          var words = l.split(/[\s\-_]+/);
          if(words.length >= 2) {
            var mid = Math.ceil(words.length / 2);
            var line1 = words.slice(0, mid).join(' ');
            var line2 = words.slice(mid).join(' ');
            txt = line1 + '<br>' + line2;
          } else {
            /* se não tem espaço, quebra no meio */
            var half = Math.floor(l.length / 2);
            txt = l.slice(0, half) + '<br>' + l.slice(half);
          }
        }
        html+='<td style="text-align:center;color:#0F172A;font-weight:700;padding:4px 2px;font-size:9px;line-height:1.3;vertical-align:middle;border-bottom:2px solid #1e3a5f;border-left:1px solid #E2E8F0;min-height:36px;overflow:hidden" title="'+l+'">'+txt+'</td>';
      });
      html+='</tr>';
      /* linhas de dados */
      rows.forEach(function(row){
        html+='<tr>';
        html+='<td style="color:'+row.color+';font-weight:700;font-size:10px;padding:3px 6px;white-space:nowrap;width:90px;border-right:1px solid #E2E8F0;background:#F8FAFC">'+row.label+'</td>';
        row.vals.forEach(function(v,i){
          var vStr, cellColor;
          if(row.dynamic && v && typeof v === 'object') {
            /* ACC com cor dinâmica */
            vStr = v.val===''||v.val===0?'':String(v.val);
            cellColor = v.col;
          } else {
            /* Outras linhas com cor fixa */
            vStr = v===''||v===0?'':String(v);
            cellColor = row.color;
          }
          html+='<td style="text-align:center;color:'+cellColor+';padding:3px 2px;font-family:IBM Plex Mono,monospace;font-size:10px;font-weight:500;line-height:1.5;border-left:1px solid #E2E8F0">'+vStr+'</td>';
        });
        html+='</tr>';
      });
      html+='</table>';
      tblDiv.innerHTML=html;
    }

    /* Resize quando o painel for mostrado */
    window.addEventListener('resize',function(){if(WATERFALL_CHART) WATERFALL_CHART.resize();});
  })();

  /* ── TOP 10 CAUSAS ── */
  var fdMap={};
  defRows.forEach(function(r){var v=S(r[F.failDesc])||'TBA';fdMap[v]=(fdMap[v]||0)+1;});
  var topFd=Object.keys(fdMap).map(function(k){return{k:k,v:fdMap[k]};}).sort(function(a,b){return b.v-a.v;}).slice(0,10);
  var maxV=topFd.length?topFd[0].v:1;
  document.getElementById('mPareto').innerHTML=topFd.map(function(it){
    var p2x=Math.round((it.v/maxV)*100);
    return '<div class="mc-pr"><div class="mc-pl" title="'+it.k+'">'+it.k+'</div>'+
      '<div class="mc-pb"><div class="mc-pbi" style="width:'+p2x+'%"></div></div>'+
      '<div class="mc-pv">'+it.v+'</div></div>';
  }).join('');

  /* ── TODAS OCORRÊNCIAS ordenadas por hora decrescente ── */
  var allOcc=defRows.map(function(r){
    var ser=S(r[F.serial])||'—', fd=S(r[F.failDesc])||'TBA';
    var st=S(r[F.st])||'—';
    var rawItm=S(r[F.item]); var itm=(rawItm&&rawItm.trim()!=='')?rawItm:'TBA';
    var wo=S(r[F.wo])||'';
    var mod=(woMap[wo]&&woMap[wo].modelo&&woMap[wo].modelo.trim()!==''?woMap[wo].modelo:'')||S(r['_modelo'])||'TBA';
    var raw=S(r[F.failDate]), mh=raw.match(/(\d{1,2}:\d{2})/);
    var hora=mh?mh[1].slice(0,5):'00:00';
    var parts=hora.split(':');
    return {ser:ser,fd:fd,st:st,itm:itm,mod:mod,hora:hora,min:parseInt(parts[0]||0)*60+parseInt(parts[1]||0)};
  });
  allOcc.sort(function(a,b){return b.min-a.min;});
  var firstSer=allOcc.length?allOcc[0].ser:'';
  var isNew=firstSer&&firstSer!==M_LAST_SER;
  M_LAST_SER=firstSer;
  document.getElementById('mRecent').innerHTML=allOcc.map(function(r,i){
    var rowCls=(i===0&&isNew)?'class="mnew"':'';
    return '<tr '+rowCls+'>'+
      '<td style="color:var(--t1);font-size:9px;font-family:monospace">'+r.ser.slice(-10)+'</td>'+
      '<td style="color:var(--cyan);font-size:9px;font-family:monospace;font-weight:700">'+r.hora+'</td>'+
      '<td style="color:var(--cyan);font-weight:700">'+r.st+'</td>'+
      '<td style="color:var(--amber);font-weight:700" title="'+r.fd+'">'+r.fd.slice(0,18)+'</td>'+
      '<td style="color:var(--t2);font-size:9px" title="'+r.mod+'">'+r.mod.slice(0,14)+'</td>'+
      '<td style="color:var(--t2)">'+r.itm.slice(0,10)+'</td></tr>';
  }).join('');
  document.getElementById('mBdRec').textContent=allOcc.length+' falhas';

  /* ── VELOCIMETRO OVERALL ── */
  drawGauge(ov);
}

function drawGauge(val){
  var cvs=document.getElementById('mGaugeCanvas'); if(!cvs) return;
  var ctx=cvs.getContext('2d'), W=cvs.width, H=cvs.height;
  ctx.clearRect(0,0,W,H);
  /* Centro na parte inferior do canvas, arco semicircular superior */
  var cx=W/2, cy=H-8, R=94;
  /* Arco: de 207° a 333° (em radianos) — semicirculo superior aberto */
  var startA=Math.PI*(1+0.15), endA=Math.PI*(2-0.15);
  var pct=val!==null?val*100:0;
  var col=pct>=99?'#00e676':pct>=98?'#ffc400':'#ff3d5a';

  /* Track cinza */
  ctx.beginPath(); ctx.arc(cx,cy,R,startA,endA);
  ctx.strokeStyle='#162030'; ctx.lineWidth=20; ctx.lineCap='butt'; ctx.stroke();

  /* Arco colorido gradiente */
  var frac=val!==null?Math.max(0,Math.min(1,(pct-95)/5)):0;
  if(frac>0){
    /* Arco segmentado com cores */
    var zones=[
      {from:0,to:0.4,c0:'#ff3d5a',c1:'#ff7040'},
      {from:0.4,to:0.6,c0:'#ff9020',c1:'#ffc400'},
      {from:0.6,to:1.0,c0:'#80e060',c1:'#00e676'}
    ];
    zones.forEach(function(z){
      if(frac<=z.from) return;
      var zf=Math.min(frac,z.to);
      var a0=startA+(endA-startA)*z.from;
      var a1=startA+(endA-startA)*zf;
      var gr=ctx.createLinearGradient(cx+R*Math.cos(a0),cy+R*Math.sin(a0),cx+R*Math.cos(a1),cy+R*Math.sin(a1));
      gr.addColorStop(0,z.c0); gr.addColorStop(1,z.c1);
      ctx.beginPath(); ctx.arc(cx,cy,R,a0,a1);
      ctx.strokeStyle=gr; ctx.lineWidth=20; ctx.lineCap='butt'; ctx.stroke();
    });
  }

  /* Marcas de escala */
  var ticks=[{v:95,l:'95%',maj:true},{v:96,l:'',maj:false},{v:97,l:'97',maj:true},{v:98,l:'98',maj:true},{v:99,l:'99',maj:true},{v:100,l:'100%',maj:true}];
  ticks.forEach(function(m){
    var f=(m.v-95)/5, a=startA+(endA-startA)*f;
    var r1=m.maj?R-14:R-8, r2=R+6;
    ctx.beginPath();
    ctx.moveTo(cx+r1*Math.cos(a),cy+r1*Math.sin(a));
    ctx.lineTo(cx+r2*Math.cos(a),cy+r2*Math.sin(a));
    ctx.strokeStyle=m.maj?'#3a5575':'#243545'; ctx.lineWidth=m.maj?2:1; ctx.stroke();
    if(m.l){
      ctx.fillStyle='#4a7090'; ctx.font='bold 8px monospace'; ctx.textAlign='center';
      ctx.fillText(m.l, cx+(R+22)*Math.cos(a), cy+(R+22)*Math.sin(a)+3);
    }
  });

  /* Labels de zona */
  ctx.font='bold 7px sans-serif'; ctx.textAlign='center';
  ctx.fillStyle='#ff3d5a66'; ctx.fillText('CRIT', cx-R*0.60, cy-10);
  ctx.fillStyle='#ffc40055'; ctx.fillText('ATEN', cx, cy-R*0.36-4);
  ctx.fillStyle='#00e67666'; ctx.fillText('OK', cx+R*0.60, cy-10);

  /* Agulha */
  if(val!==null){
    var nfrac=Math.max(0,Math.min(1,(pct-95)/5));
    var na=startA+(endA-startA)*nfrac;
    /* Ponta da agulha */
    var tipX=cx+(R-24)*Math.cos(na), tipY=cy+(R-24)*Math.sin(na);
    /* Base da agulha (lado oposto, curta) */
    var baseX=cx+8*Math.cos(na+Math.PI), baseY=cy+8*Math.sin(na+Math.PI);
    ctx.save();
    ctx.shadowColor=col; ctx.shadowBlur=14;
    /* Haste principal */
    ctx.beginPath(); ctx.moveTo(baseX,baseY); ctx.lineTo(tipX,tipY);
    ctx.strokeStyle=col; ctx.lineWidth=3; ctx.lineCap='round'; ctx.stroke();
    /* Hub central */
    ctx.beginPath(); ctx.arc(cx,cy,8,0,Math.PI*2);
    ctx.fillStyle=col; ctx.shadowBlur=16; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,4,0,Math.PI*2);
    ctx.fillStyle='#060d18'; ctx.shadowBlur=0; ctx.fill();
    ctx.restore();
  }

  /* Valor texto */
  var vEl=document.getElementById('mVOv');
  var vStr=val!==null?pct.toFixed(2)+'%':'—';
  if(vEl){vEl.textContent=vStr; vEl.style.color=col; vEl.style.textShadow='0 0 24px '+col+'88';}
}
/* ══════════════════════════════════════════════════════════════
   SUPABASE INTEGRATION — v50
   Multi-cliente · Admin pré-filtro · Auto-refresh 30min
══════════════════════════════════════════════════════════════ */

/* ── CONFIG ── substitua com seus dados ── */
var SB_URL     = 'https://jaflfpyyybosbakokvcu.supabase.co';
var SB_ANONKEY = 'sb_publishable_QxwSShnXJ7qDZxkEqYP-Rg_5XmFwzvm';
var ADMIN_PASS = '@Admin';

/* ── CLIENTES — adicione ou remova conforme necessário ── */
var CLIENTS = [
  { id: 'acer',   label: 'ACER',   color: '#00d4ff' },
  { id: 'hp',     label: 'HP',     color: '#0096D6' },
  { id: 'huawei', label: 'HUAWEI', color: '#CF0A2C' },
  { id: 'asus',   label: 'ASUS',   color: '#00B9AE' }
];

/* ── Estado global ── */
var IS_ADMIN          = false;
var CURRENT_CLIENT    = CLIENTS[0].id;   /* cliente ativo no dashboard */
var ADMIN_CLIENT      = CLIENTS[0].id;   /* cliente que admin está editando */
var RAW_CLIENTS       = {};              /* {clientId: {out, def}} — estado admin */
var CLIENT_CACHE      = {};             /* {clientId: {out,def,updated_at,default_filters}} */
var AUTO_REFRESH_TMR  = null;

/* ══════════════════════════════════════════
   HELPERS DE PAINEL
══════════════════════════════════════════ */
function showSubPanel(id) {
  ['viewerLoading','viewerEmpty','adminLoginBox','adminUploadBox'].forEach(function(n){
    var el = document.getElementById(n);
    if (el) el.style.display = (n === id) ? '' : 'none';
  });
}

function showToast(msg, type) {
  var t = document.getElementById('sbToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'sbToast';
    t.style.cssText = 'position:fixed;bottom:70px;right:18px;z-index:9999;padding:10px 18px;' +
      'border-radius:8px;font-size:12px;font-weight:700;letter-spacing:1px;' +
      'transition:opacity 0.5s;backdrop-filter:blur(8px);pointer-events:none';
    document.body.appendChild(t);
  }
  var colors = {ok:'rgba(0,180,80,0.92)', err:'rgba(255,60,90,0.92)', info:'rgba(0,160,255,0.92)'};
  t.style.opacity = '1';
  t.style.background = colors[type] || colors.info;
  t.style.color = '#fff';
  t.textContent = msg;
  clearTimeout(t._tmr);
  t._tmr = setTimeout(function(){ t.style.opacity = '0'; }, 4000);
}

/* ══════════════════════════════════════════
   SELETOR DE CLIENTE (dashboard e monitor)
══════════════════════════════════════════ */
function buildClientTabs() {
  var bar = document.getElementById('clientTabBar');
  if (!bar) return;
  bar.innerHTML = '';
  CLIENTS.forEach(function(c) {
    var btn = document.createElement('button');
    btn.className = 'client-tab' + (c.id === CURRENT_CLIENT ? ' active' : '');
    btn.id = 'ctab-' + c.id;
    btn.style.setProperty('--ctab-color', c.color);
    btn.onclick = function(){ switchClient(c.id); };
    btn.innerHTML = '<span></span><span></span><span></span><span></span>' + c.label;
    bar.appendChild(btn);
  });
}

/* Admin filter memory: {clientId: filterStateJson} */
var ADMIN_FILTERS = {}; /* {clientId: filterStateJson} — saved live by applyF() */

function switchClient(clientId) {
  /* Evita re-render do mesmo cliente */
  if (clientId === CURRENT_CLIENT &&
      document.getElementById('dash') &&
      document.getElementById('dash').style.display !== 'none') return;

  /* Salva filtros atuais agora (redundante com applyF hook, mas garante o último estado) */
  if (IS_ADMIN && CURRENT_CLIENT) {
    ADMIN_FILTERS[CURRENT_CLIENT] = captureFilterState();
  }

  /* Sincroniza ADMIN_CLIENT quando admin navega pelas tabs */
  if (IS_ADMIN) ADMIN_CLIENT = clientId;
  CURRENT_CLIENT = clientId;

  /* Atualiza visual das tabs */
  CLIENTS.forEach(function(c){
    var btn = document.getElementById('ctab-' + c.id);
    if (btn) btn.classList.toggle('active', c.id === clientId);
  });

  /* Fonte de dados */
  var src = IS_ADMIN ? RAW_CLIENTS[clientId] : CLIENT_CACHE[clientId];

  if (src && src.out && src.def) {
    RAW.out = src.out;
    RAW.def = src.def;
    killCharts(); DATA = {}; MS_STATE = {}; CHART_FILTER = {fd:null,itm:null};

    /* Guarda o clientId em closure para o then() */
    var targetClient = clientId;
    run().then(function(){
      if (IS_ADMIN) {
        /* Restaura filtros do admin para este cliente */
        var saved = ADMIN_FILTERS[targetClient];
        if (saved && saved !== '{}') {
          applyDefaultFilters(saved);
        }
        /* Mostra barra de publicação se estava ativa */
        if (document.getElementById('adminPublishBar')) {
          showPublishBar();
        }
      } else {
        var d = CLIENT_CACHE[targetClient];
        if (d) {
          if (d.default_filters && d.default_filters !== '{}') applyDefaultFilters(d.default_filters);
          if (d.updated_at) {
            setStatus('on', c_label(targetClient) + ' · ' + new Date(d.updated_at).toLocaleString('pt-BR'));
            showLastUpdateBanner(d.updated_at);
          }
        }
      }
    });
  } else if (IS_ADMIN) {
    /* Admin tentou trocar para cliente sem dados — volta para upload */
    showToast('⚠ Carregue os dados de ' + c_label(clientId) + ' primeiro', 'err');
    /* Reverte a tab visual */
    CURRENT_CLIENT = CLIENTS.find(function(c){ return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].out; }) ?
      CLIENTS.find(function(c){ return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].out; }).id : CURRENT_CLIENT;
    CLIENTS.forEach(function(c){
      var btn = document.getElementById('ctab-' + c.id);
      if (btn) btn.classList.toggle('active', c.id === CURRENT_CLIENT);
    });
  } else {
    loadClientFromSupabase(clientId);
  }
}

function c_label(id) {
  var c = CLIENTS.find(function(x){ return x.id === id; });
  return c ? c.label : id.toUpperCase();
}

/* ══════════════════════════════════════════
   FILTROS PADRÃO (admin pré-filtra → usuário vê)
══════════════════════════════════════════ */
function captureFilterState() {
  /* Serializa MS_STATE como {key: [values]} */
  var state = {};
  Object.keys(MS_STATE).forEach(function(k){
    if (MS_STATE[k] && MS_STATE[k].size > 0) {
      state[k] = Array.from(MS_STATE[k]);
    }
  });
  return JSON.stringify(state);
}

function applyDefaultFilters(filtersJson) {
  try {
    var state = (typeof filtersJson === 'string') ? JSON.parse(filtersJson) : filtersJson;
    if (!state || Object.keys(state).length === 0) return;
    Object.keys(state).forEach(function(key){
      var vals = state[key];
      if (!Array.isArray(vals) || vals.length === 0) return;
      if (!MS_STATE[key]) MS_STATE[key] = new Set();
      vals.forEach(function(v){ MS_STATE[key].add(v); });
      /* Atualiza visual dos checkboxes */
      var list = document.getElementById('mslist-'+key);
      if (list) {
        list.querySelectorAll('.ms-item').forEach(function(el){
          var val = el.getAttribute('data-val');
          if (MS_STATE[key].has(val)) {
            el.classList.add('active');
            var cb = el.querySelector('.ms-cb');
            if (cb) cb.textContent = '✓';
          }
        });
      }
      var allEl = document.getElementById('msall-'+key);
      if (allEl) {
        allEl.classList.remove('active');
        var cb = allEl.querySelector('.ms-cb');
        if (cb) cb.textContent = '';
      }
      updateMSLabel(key);
    });
    applyF();
  } catch(e) { console.warn('[applyDefaultFilters]', e); }
}

/* ══════════════════════════════════════════
   ACESSO ADMIN — cadeado / URL
══════════════════════════════════════════ */
function showAdminLogin() {
  if (IS_ADMIN) {
    showUpZoneAdmin();
    renderAdminUpload();
    showSubPanel('adminUploadBox');
    return;
  }
  show('upZone'); hide('dash');
  showSubPanel('adminLoginBox');
  setTimeout(function(){ var inp = document.getElementById('adminPwdInput'); if(inp) inp.focus(); }, 100);
}

function adminLogin() {
  var inp = document.getElementById('adminPwdInput');
  var pw  = inp ? inp.value : '';
  var err = document.getElementById('adminLoginErr');
  if (pw === ADMIN_PASS) {
    IS_ADMIN = true;
    if (inp) inp.value = '';
    var lock = document.getElementById('adminAccessBtn');
    if (lock) lock.style.display = 'none';
    /* Badge admin */
    if (!document.getElementById('adminBadge')) {
      var badge = document.createElement('div');
      badge.id = 'adminBadge';
      badge.innerHTML = '🔑 MODO ADMIN';
      badge.style.cssText = 'position:fixed;top:6px;right:160px;z-index:9999;' +
        'background:#ff6b00;color:#fff;font-size:10px;letter-spacing:2px;' +
        'padding:4px 10px;border-radius:4px;font-weight:700;cursor:pointer';
      badge.onclick = function(){ showUpZoneAdmin(); renderAdminUpload(); showSubPanel('adminUploadBox'); };
      document.body.appendChild(badge);
    }
    renderAdminUpload();
    showSubPanel('adminUploadBox');
    setTimeout(updateFixedPublishBtn, 300);
  } else {
    if (err) err.style.display = '';
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

function adminLogout() {
  IS_ADMIN = false;
  RAW_CLIENTS = {};
  var lock = document.getElementById('adminAccessBtn');
  if (lock) lock.style.display = '';
  var badge = document.getElementById('adminBadge');
  if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
  loadAllClients();
}

function showViewer() {
  IS_ADMIN = false;
  loadAllClients();
}

/* ══════════════════════════════════════════
   ADMIN UPLOAD — multi-cliente
══════════════════════════════════════════ */
function renderAdminUpload() {
  var box = document.getElementById('adminUploadBox');
  if (!box) return;

  /* Tabs de cliente */
  var tabsHtml = '<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">';
  CLIENTS.forEach(function(c){
    var isActive = c.id === ADMIN_CLIENT;
    tabsHtml += '<button onclick="switchAdminClient(\''+c.id+'\')" id="admctab-'+c.id+'" style="' +
      'padding:6px 18px;border-radius:20px;border:2px solid '+(isActive?c.color:'rgba(255,255,255,0.15)')+';' +
      'background:'+(isActive?c.color+'22':'transparent')+';color:'+(isActive?c.color:'#888')+';' +
      'font-size:11px;font-weight:700;letter-spacing:2px;cursor:pointer;transition:all 0.2s">'+
      c.label+'</button>';
  });
  tabsHtml += '</div>';

  var clientStatus = CLIENTS.map(function(c){
    var hasData;
    if (c.id === 'huawei') {
      var hw = RAW_CLIENTS['huawei'] || {};
      hasData = !!(hw.outL6 && hw.defL6 && hw.outL10 && hw.defL10);
    } else if (c.id === 'asus') {
      var as_ = RAW_CLIENTS['asus'] || {};
      hasData = !!(as_.outL6);
    } else {
      hasData = !!(RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].out && RAW_CLIENTS[c.id].def);
    }
    return '<span style="font-size:10px;color:'+(hasData?'#00e96a':'#555')+';margin-right:12px">' +
      (hasData?'✅':'⬜') + ' ' + c.label + '</span>';
  }).join('');

  var isHW = ADMIN_CLIENT === 'huawei';
  var isAS = ADMIN_CLIENT === 'asus';
  var uploadGrid = isHW ? buildHuaweiUploadCards() : isAS ? buildAsusUploadCards() : (
    '<div class="up-grid">' +
      '<div class="ucard" id="c-out" onclick="document.getElementById(\'f-out\').click()">' +
        '<span class="un">01 · OUTPUT · ' + c_label(ADMIN_CLIENT) + '</span>' +
        '<span class="uico">📊</span>' +
        '<div class="utit">OUT.xlsx — Dados de Produção</div>' +
        '<div class="usub">Line · Work Order · Model Name · Model Serial<br>Test station · Placa Passou · Placa Falhou · <b>Total</b> · FPY (%)</div>' +
        '<input type="file" id="f-out" accept=".xlsx,.xls" onchange="loadXL(this,\'out\')"/>' +
        '<div class="ufile" id="n-out">Nenhum arquivo</div>' +
      '</div>' +
      '<div class="ucard" id="c-def" onclick="document.getElementById(\'f-def\').click()">' +
        '<span class="un">02 · FALHAS · ' + c_label(ADMIN_CLIENT) + ' · OPCIONAL</span>' +
        '<span class="uico">⚠️</span>' +
        '<div class="utit">FALHAS.xlsx — Registro de Defeitos <span style="font-size:10px;color:var(--amber)">(opcional)</span></div>' +
        '<div class="usub">Serial · Work Order · Failure Code · Description<br>Test station · Failure date · Reason Code · Item<br>' +
          '<span style="color:var(--t3)">Se não houver falhas no período, deixe em branco</span></div>' +
        '<input type="file" id="f-def" accept=".xlsx,.xls" onchange="loadXL(this,\'def\')"/>' +
        '<div class="ufile" id="n-def">Nenhum arquivo (será assumido zero defeitos)</div>' +
      '</div>' +
    '</div>'
  );

  box.innerHTML = 
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
      '<div>' +
        '<div class="up-title" style="font-size:14px;text-align:left">📤 PUBLICAR DADOS DE PRODUÇÃO</div>' +
        '<div class="up-sub" style="text-align:left">Carregue os arquivos para cada cliente, depois publique</div>' +
      '</div>' +
      '<button onclick="adminLogout()" style="background:transparent;border:1px solid rgba(255,255,255,0.2);color:#888;' +
        'padding:6px 14px;border-radius:6px;font-size:11px;cursor:pointer">Sair do Admin</button>' +
    '</div>' +
    tabsHtml +
    '<div style="margin-bottom:12px">' + clientStatus + '</div>' +
    uploadGrid +
    '<div class="abar" style="margin-top:16px">' +
      '<span class="hint" id="hint">' + (isHW ? 'Carregue os 4 arquivos para publicar' : isAS ? 'Carregue pelo menos o Output L6 ASUS' : 'Carregue os 2 arquivos para publicar') + '</span>' +
    '</div>';

  /* Restaura estado de arquivos já carregados para este cliente */
  var existing = RAW_CLIENTS[ADMIN_CLIENT];
  if (ADMIN_CLIENT === 'asus') {
    if (existing) {
      RAW_AS.outL6  = existing.outL6  || null;
      RAW_AS.defL6  = existing.defL6  || null;
      RAW_AS.outL10 = existing.outL10 || null;
      RAW_AS.defL10 = existing.defL10 || null;
    }
    restoreAsusUploadUI();
  } else if (ADMIN_CLIENT === 'huawei') {
    if (existing) {
      RAW_HW.outL6  = existing.outL6  || null;
      RAW_HW.defL6  = existing.defL6  || null;
      RAW_HW.outL10 = existing.outL10 || null;
      RAW_HW.defL10 = existing.defL10 || null;
    }
    restoreHuaweiUploadUI();
  } else if (existing) {
    RAW.out = existing.out;
    RAW.def = existing.def;
    var nout = document.getElementById('n-out');
    var ndef = document.getElementById('n-def');
    var cout = document.getElementById('c-out');
    var cdef = document.getElementById('c-def');
    if (existing.out && nout) { nout.textContent = '✅ ' + c_label(ADMIN_CLIENT) + ' OUT — ' + existing.out.rows.length + ' registros'; if(cout) cout.classList.add('done'); }
    if (existing.def && ndef) { ndef.textContent = '✅ ' + c_label(ADMIN_CLIENT) + ' FALHAS — ' + existing.def.rows.length + ' registros'; if(cdef) cdef.classList.add('done'); }
    checkReady();
  } else {
    RAW.out = null;
    RAW.def = null;
  }
}

function switchAdminClient(clientId) {
  if (clientId === ADMIN_CLIENT) return;
  /* Salva dados + filtros do cliente atual antes de trocar */
  if (!RAW_CLIENTS[ADMIN_CLIENT]) RAW_CLIENTS[ADMIN_CLIENT] = {};
  if (ADMIN_CLIENT === 'huawei') {
    if (RAW_HW.outL6)  RAW_CLIENTS[ADMIN_CLIENT].outL6  = RAW_HW.outL6;
    if (RAW_HW.defL6)  RAW_CLIENTS[ADMIN_CLIENT].defL6  = RAW_HW.defL6;
    if (RAW_HW.outL10) RAW_CLIENTS[ADMIN_CLIENT].outL10 = RAW_HW.outL10;
    if (RAW_HW.defL10) RAW_CLIENTS[ADMIN_CLIENT].defL10 = RAW_HW.defL10;
  } else {
    if (RAW.out) RAW_CLIENTS[ADMIN_CLIENT].out = RAW.out;
    if (RAW.def) RAW_CLIENTS[ADMIN_CLIENT].def = RAW.def;
  }
  /* Captura filtros que o admin aplicou no dashboard (se estiver visível) */
  if (document.getElementById('dash') && document.getElementById('dash').style.display !== 'none') {
    var captured = captureFilterState();
    RAW_CLIENTS[ADMIN_CLIENT].filters = captured;
    ADMIN_FILTERS[ADMIN_CLIENT] = captured;
  }
  ADMIN_CLIENT = clientId;
  /* Restaura dados + filtros do novo cliente */
  var saved = RAW_CLIENTS[clientId];
  if (clientId === 'huawei') {
    /* Huawei usa RAW_HW — não RAW.out/def */
    if (saved) {
      RAW_HW.outL6  = saved.outL6  || null;
      RAW_HW.defL6  = saved.defL6  || null;
      RAW_HW.outL10 = saved.outL10 || null;
      RAW_HW.defL10 = saved.defL10 || null;
    } else {
      RAW_HW = {outL6:null, defL6:null, outL10:null, defL10:null};
    }
    RAW.out = null; RAW.def = null;
  } else if (saved) {
    RAW.out = saved.out || null;
    RAW.def = saved.def || null;
  } else {
    RAW.out = null;
    RAW.def = null;
  }
  renderAdminUpload();
}

/* ── Override de checkReady para salvar em RAW_CLIENTS ── */
var _origCheckReady = null;
function checkReady() {
  /* Para Acer/HP: apenas o arquivo OUT é obrigatório.
     Se não houver FALHAS, assume lista vazia (zero defeitos no período). */
  var ok = !!(RAW.out); /* falhas são opcionais */
  var btnGo = document.getElementById('btnGo');
  if (btnGo) btnGo.disabled = !ok;
  var hint = document.getElementById('hint');
  if (hint) hint.textContent = ok
    ? (RAW.def
        ? '✓ Pronto — clique em PUBLICAR'
        : '✓ Sem arquivo de falhas? OK — será assumido zero defeitos. Clique em PUBLICAR')
    : 'Aguardando OUTPUT...';
  if (ok) {
    /* Se não há def, cria estrutura vazia compatível */
    if (!RAW.def) {
      RAW.def = { headers: ['Serial','Work Order','Failure Code','Description',
        'Line','Test station','Failure date','Repair station','Reason Code','Description_1','Item'],
        rows: [] };
    }
    /* Salva automaticamente em RAW_CLIENTS */
    RAW_CLIENTS[ADMIN_CLIENT] = { out: RAW.out, def: RAW.def };
    setStatus('warn','Pronto para publicar');
  }
}

/* ══════════════════════════════════════════
   PUBLICAR — gera dashboard e salva no banco
══════════════════════════════════════════ */
/* Publicar TODOS os clientes carregados de uma vez */
async function adminGenerateAndPublishAll() {
  var toPublish = CLIENTS.filter(function(c){
    if (c.id === 'asus')   return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].outL6;
    if (c.id === 'huawei') return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].outL6;
    return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].out;
  });
  if (toPublish.length === 0) {
    showToast('⚠ Carregue ao menos um arquivo de output (OUT.xlsx) antes de publicar', 'err');
    return;
  }

  var btn = document.querySelector('#fixedPublishBtn .pub-main');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Publicando...'; }

  showToast('⏳ Gerando e publicando ' + toPublish.length + ' cliente(s)...', 'info');

  try {
    for (var i = 0; i < toPublish.length; i++) {
      var c = toPublish[i];
      ADMIN_CLIENT = c.id;
      /* Configura RAW para o cliente atual */
      if (c.id === 'asus') {
        /* adminGenerateAsus faz tudo */
        await new Promise(function(resolve) {
          var _orig = showPublishBar;
          showPublishBar = function(){ resolve(); showPublishBar = _orig; };
          adminGenerateAsus();
        });
      } else if (c.id === 'huawei') {
        await new Promise(function(resolve) {
          var _orig = showPublishBar;
          showPublishBar = function(){ resolve(); showPublishBar = _orig; };
          adminGenerateHuawei();
        });
      } else {
        RAW.out = RAW_CLIENTS[c.id].out;
        RAW.def = RAW_CLIENTS[c.id].def || { headers:[], rows:[] };
        await run();
        await saveClientToSupabase(c.id, '{}');
        CLIENT_CACHE[c.id] = { out: RAW.out, def: RAW.def, updated_at: new Date().toISOString() };
      }
      showToast('✅ ' + c.label + ' publicado!', 'ok');
    }
    showToast('🎉 Todos os clientes publicados com sucesso!', 'ok');
  } catch(e) {
    showToast('⚠ Erro: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '☁ PUBLICAR'; }
    updateFixedPublishBtn();
  }
}

function adminGenerateAndPublish() {
  if (ADMIN_CLIENT === 'huawei') {
    adminGenerateHuawei();
    return;
  }
  if (ADMIN_CLIENT === 'asus') {
    adminGenerateAsus();
    return;
  }
  if (!RAW.out) { showToast('⚠ Carregue o arquivo de output primeiro', 'err'); return; }
  if (!RAW.def || !RAW.def.rows) RAW.def = { headers: [], rows: [] }; /* zero defeitos */
  var btnGo = document.getElementById('btnGo');
  if (btnGo) btnGo.disabled = true;
  showToast('⏳ Gerando dashboard...', 'info');

  /* Roda o dashboard para o admin ver e poder filtrar */
  run().then(function(){
    /* Mostra botão "Publicar com filtros atuais" no dashboard */
    showPublishBar();
    showToast('✅ Dashboard gerado! Aplique filtros se quiser, depois publique.', 'ok');
  }).catch(function(e){
    showToast('⚠ Erro: ' + e.message, 'err');
    if (btnGo) btnGo.disabled = false;
  });
}

function showPublishBar() {
  updateFixedPublishBtn();
}

/* Cria/atualiza o botão fixo de PUBLICAR no canto inferior direito */
function updateFixedPublishBtn() {
  var btn = document.getElementById('fixedPublishBtn');
  if (!btn) {
    btn = document.createElement('div');
    btn.id = 'fixedPublishBtn';
    btn.style.cssText = [
      'position:fixed;bottom:24px;right:24px;z-index:9999',
      'display:flex;flex-direction:column;align-items:flex-end;gap:8px'
    ].join(';');
    /* Só visível quando upZone está ativo */
    var upEl=document.getElementById('upZone');
    if(upEl && upEl.style.display==='none') btn.style.display='none';
    document.body.appendChild(btn);

    /* Injetar keyframes de animação */
    if (!document.getElementById('publishBtnStyles')) {
      var st = document.createElement('style');
      st.id = 'publishBtnStyles';
      st.textContent = [
        '@keyframes pub-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,107,0,0.7),0 4px 24px rgba(255,107,0,0.4)}',
        '50%{box-shadow:0 0 0 10px rgba(255,107,0,0),0 4px 24px rgba(255,107,0,0.6)}}',
        '@keyframes pub-border{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}',
        '#fixedPublishBtn .pub-main{',
        '  background:linear-gradient(135deg,#ff6b00,#ff3d00,#ff8c00,#ff3d00);',
        '  background-size:300% 300%;',
        '  animation:pub-border 3s ease infinite,pub-pulse 2s ease-in-out infinite;',
        '  border:none;border-radius:12px;color:#fff;font-size:13px;font-weight:800;',
        '  letter-spacing:2px;cursor:pointer;padding:14px 28px;',
        '  text-transform:uppercase;white-space:nowrap;',
        '  transition:transform 0.15s,opacity 0.15s;',
        '}',
        '#fixedPublishBtn .pub-main:hover{transform:scale(1.05);opacity:0.92}',
        '#fixedPublishBtn .pub-main:active{transform:scale(0.97)}',
        '#fixedPublishBtn .pub-sec{',
        '  background:rgba(255,255,255,0.1);backdrop-filter:blur(8px);',
        '  border:1px solid rgba(255,255,255,0.2);border-radius:8px;',
        '  color:rgba(255,255,255,0.7);font-size:10px;cursor:pointer;',
        '  padding:6px 14px;letter-spacing:1px;transition:all 0.2s;',
        '}',
        '#fixedPublishBtn .pub-sec:hover{background:rgba(255,255,255,0.18);color:#fff}',
        '#fixedPublishBtn .pub-status{',
        '  font-size:10px;color:rgba(255,255,255,0.7);letter-spacing:1px;',
        '  background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);',
        '  padding:4px 10px;border-radius:6px;text-align:right;',
        '}'
      ].join('');
      document.head.appendChild(st);
    }
  }

  /* Garante cliente atual em RAW_CLIENTS */
  if (RAW.out && RAW.def) RAW_CLIENTS[ADMIN_CLIENT] = RAW_CLIENTS[ADMIN_CLIENT] || { out: RAW.out, def: RAW.def };

  var loadedClients = CLIENTS.filter(function(c){
    if (c.id === 'asus')   return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].outL6;
    if (c.id === 'huawei') return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].outL6;
    return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].out;
  });

  var names  = loadedClients.map(function(c){ return c.label; }).join(' · ');

  btn.innerHTML =
    (loadedClients.length > 0
      ? '<div class="pub-status">📦 ' + names + ' prontos</div>'
      : '<div class="pub-status" style="color:rgba(255,200,100,0.9)">Carregue ao menos 1 arquivo de output</div>') +
    '<button class="pub-main" onclick="adminGenerateAndPublishAll()">' +
      '☁ PUBLICAR' +
    '</button>' +
    '<button class="pub-sec" onclick="goBackToAdminUpload()">← Voltar</button>';
}

/* ── Helper central: mostrar tela de upload e garantir botão PUBLICAR visível ── */
function showUpZoneAdmin() {
  show('upZone'); hide('dash');
  var fpb = document.getElementById('fixedPublishBtn');
  if (fpb) fpb.style.display = 'flex';
  setTimeout(updateFixedPublishBtn, 100);
}

function goBackToAdminUpload() {
  var bar = document.getElementById('adminPublishBar');
  if (bar) bar.remove();
  /* NÃO remover o fixedPublishBtn — apenas reexibir */
  showUpZoneAdmin();
  renderAdminUpload();
  showSubPanel('adminUploadBox');
}

function publishAllClients(noFilters) {
  /* Filtros do cliente visível agora */
  var currentFilters = noFilters ? '{}' : captureFilterState();
  if (RAW.out && RAW.def) RAW_CLIENTS[ADMIN_CLIENT] = RAW_CLIENTS[ADMIN_CLIENT] || { out: RAW.out, def: RAW.def };
  RAW_CLIENTS[ADMIN_CLIENT] = RAW_CLIENTS[ADMIN_CLIENT] || {};
  RAW_CLIENTS[ADMIN_CLIENT].filters = currentFilters;

  var toPublish = CLIENTS.filter(function(c){
    if (c.id==='asus')   return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].outL6;
    if (c.id==='huawei') return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].outL6;
    return RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].out;
  });
  toPublish.forEach(function(c){
    if (c.id!=='asus' && c.id!=='huawei')
      if (!RAW_CLIENTS[c.id].def||!RAW_CLIENTS[c.id].def.rows)
        RAW_CLIENTS[c.id].def={headers:[],rows:[]};
  });
  if (toPublish.length === 0) {
    showToast('⚠ Carregue ao menos um arquivo de output antes de publicar', 'err');
    return;
  }

  var bar = document.getElementById('adminPublishBar');
  if (bar) bar.innerHTML = '<div style="color:#00d4ff;font-size:12px;padding:4px">⏳ Publicando ' + toPublish.length + ' cliente(s)...</div>';

  var now = new Date().toISOString();
  var promises = toPublish.map(function(c){
    /* Usa filtros do admin para cada cliente (cada um tem seus próprios filtros salvos) */
    var filt;
    if (c.id === ADMIN_CLIENT) {
      filt = currentFilters;
    } else if (ADMIN_FILTERS[c.id] && ADMIN_FILTERS[c.id] !== '{}') {
      filt = ADMIN_FILTERS[c.id];
    } else {
      filt = RAW_CLIENTS[c.id].filters || '{}';
    }
    return saveClientToSupabase(c.id, filt).then(function(){
      CLIENT_CACHE[c.id] = {
        out: RAW_CLIENTS[c.id].out,
        def: RAW_CLIENTS[c.id].def,
        updated_at: now,
        default_filters: filt
      };
    });
  });

  Promise.all(promises).then(function(){
    var names = toPublish.map(function(c){ return c.label; }).join(' + ');
    showToast('✅ ' + names + ' publicados!', 'ok');
    setStatus('on', names + ' · ' + new Date().toLocaleString('pt-BR'));
    /* Mantém a barra mas volta ao estado normal para novas ações */
    showPublishBar();
  }).catch(function(e){
    if (bar) bar.innerHTML = '<div style="color:#ff3d5a;font-size:12px;padding:4px">⚠ Erro: ' + e.message +
      ' <button onclick="showPublishBar()" style="margin-left:8px;padding:4px 10px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:#fff;font-size:10px;cursor:pointer">Tentar novamente</button></div>';
    showToast('⚠ Erro ao publicar: ' + e.message, 'err');
  });
}

/* ══════════════════════════════════════════
   SUPABASE — salvar / carregar
══════════════════════════════════════════ */
async function saveClientToSupabase(clientId, filtersJson) {
  var data = RAW_CLIENTS[clientId] || { out: RAW.out, def: RAW.def };
  if (!data.out || !data.def) throw new Error('Sem dados para ' + clientId);
  var payload = {
    client:          clientId,
    updated_at:      new Date().toISOString(),
    out_headers:     JSON.stringify(data.out.headers),
    out_rows:        JSON.stringify(data.out.rows),
    def_headers:     JSON.stringify(data.def.headers),
    def_rows:        JSON.stringify(data.def.rows),
    default_filters: filtersJson || '{}'
  };
  var res = await fetch(SB_URL + '/rest/v1/dashboard_data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        SB_ANONKEY,
      'Authorization': 'Bearer ' + SB_ANONKEY,
      'Prefer':        'resolution=merge-duplicates'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) { var err = await res.text(); throw new Error(err); }
}

async function loadClientFromSupabase(clientId) {
  show('upZone'); hide('dash');
  showSubPanel('viewerLoading');

  try {
    if (SB_URL === 'COLE_AQUI_SUA_SUPABASE_URL') throw new Error('Supabase não configurado');
    var res = await fetch(SB_URL + '/rest/v1/dashboard_data?client=eq.' + clientId + '&select=*', {
      headers: { 'apikey': SB_ANONKEY, 'Authorization': 'Bearer ' + SB_ANONKEY }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var rows = await res.json();
    if (!rows || rows.length === 0) { showSubPanel('viewerEmpty'); return; }
    var d = rows[0];
    var clientData = {
      out:            { headers: JSON.parse(d.out_headers), rows: JSON.parse(d.out_rows) },
      def:            { headers: JSON.parse(d.def_headers), rows: JSON.parse(d.def_rows) },
      updated_at:     d.updated_at,
      default_filters: d.default_filters || '{}'
    };
    CLIENT_CACHE[clientId] = clientData;
    RAW.out = clientData.out;
    RAW.def = clientData.def;
    killCharts(); DATA = {}; MS_STATE = {}; CHART_FILTER = {fd:null,itm:null};
    await run();
    if (clientData.default_filters && clientData.default_filters !== '{}') {
      applyDefaultFilters(clientData.default_filters);
    }
    buildClientTabs();
    if (d.updated_at) setStatus('on', c_label(clientId) + ' · ' + new Date(d.updated_at).toLocaleString('pt-BR'));
  } catch(e) {
    console.error('[loadClientFromSupabase]', e);
    showSubPanel('viewerEmpty');
  }
}

async function loadAllClients() {
  /* Carrega o primeiro cliente disponível, depois coloca os outros em cache em background */
  show('upZone'); hide('dash');

  /* Tela de loading full-screen */
  var ldDiv = document.createElement('div');
  ldDiv.id = 'sbLoading';
  ldDiv.style.cssText = 'position:fixed;inset:0;background:rgba(248,250,252,0.97);display:flex;' +
    'flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:20px';
  ldDiv.innerHTML =
    '<div style="font-size:48px;animation:spin 2s linear infinite">⚙</div>' +
    '<div style="color:#1e3a5f;font-size:16px;letter-spacing:3px;font-weight:700">CARREGANDO DASHBOARD</div>' +
    '<div id="sbLoadMsg" style="color:#475569;font-size:12px;letter-spacing:1px">Conectando ao banco de dados...</div>' +
    '<div style="width:220px;height:3px;background:#E2E8F0;border-radius:2px;overflow:hidden">' +
      '<div id="sbBar" style="height:100%;width:10%;background:linear-gradient(90deg,#00d4ff,#7c3aed);transition:width 0.4s;border-radius:2px"></div>' +
    '</div>';
  document.body.appendChild(ldDiv);

  function sbStep(msg, pct) {
    var m = document.getElementById('sbLoadMsg'); if(m) m.textContent = msg;
    var b = document.getElementById('sbBar');     if(b) b.style.width = pct + '%';
  }
  function removeLd() {
    if (!ldDiv.parentNode) return;
    ldDiv.style.transition = 'opacity 0.5s'; ldDiv.style.opacity = '0';
    setTimeout(function(){ if(ldDiv.parentNode) ldDiv.parentNode.removeChild(ldDiv); }, 500);
  }

  try {
    if (SB_URL === 'COLE_AQUI_SUA_SUPABASE_URL') throw new Error('Configure as credenciais do Supabase no main.js');
    sbStep('Buscando dados...', 20);
    var res = await fetch(SB_URL + '/rest/v1/dashboard_data?select=*', {
      headers: { 'apikey': SB_ANONKEY, 'Authorization': 'Bearer ' + SB_ANONKEY }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var allRows = await res.json();
    if (!allRows || allRows.length === 0) { removeLd(); showSubPanel('viewerEmpty'); return; }

    sbStep('Processando dados...', 50);
    /* Popula cache */
    allRows.forEach(function(d){
      CLIENT_CACHE[d.client] = {
        out:            { headers: JSON.parse(d.out_headers), rows: JSON.parse(d.out_rows) },
        def:            { headers: JSON.parse(d.def_headers), rows: JSON.parse(d.def_rows) },
        updated_at:     d.updated_at,
        default_filters: d.default_filters || '{}'
      };
    });

    /* Carrega primeiro cliente (ou o atual se disponível) */
    var firstId = CLIENT_CACHE[CURRENT_CLIENT] ? CURRENT_CLIENT : Object.keys(CLIENT_CACHE)[0];
    CURRENT_CLIENT = firstId;
    var cd = CLIENT_CACHE[firstId];
    RAW.out = cd.out;
    RAW.def = cd.def;

    sbStep('Renderizando...', 75);
    await new Promise(function(r){ setTimeout(r,40); });
    await run();
    if (cd.default_filters && cd.default_filters !== '{}') applyDefaultFilters(cd.default_filters);

    sbStep('Pronto!', 100);
    buildClientTabs();
    if (cd.updated_at) setStatus('on', c_label(firstId) + ' · ' + new Date(cd.updated_at).toLocaleString('pt-BR'));
    showLastUpdateBanner(cd.updated_at);
    removeLd();
    startAutoRefresh();
  } catch(e) {
    console.error('[loadAllClients]', e);
    var b = document.getElementById('sbBar'); if(b) b.style.background='#ff3d5a';
    sbStep('Erro: ' + e.message, 100);
    setTimeout(function(){ removeLd(); showSubPanel('viewerEmpty'); }, 2500);
  }
}

/* ══════════════════════════════════════════
   AVISO ÚLTIMA ATUALIZAÇÃO (usuário)
══════════════════════════════════════════ */
var _lastUpdateIso = null;
var _lastUpdateTimer = null;

function showLastUpdateBanner(isoDate) {
  if (!isoDate) return;
  _lastUpdateIso = isoDate;
  /* Atualiza o indicador fixo no header (status bar) */
  updateLastUpdateIndicator();
  /* Mostra banner temporário no topo */
  var existing = document.getElementById('lastUpdateBanner');
  if (existing) existing.remove();
  var banner = document.createElement('div');
  banner.id = 'lastUpdateBanner';
  banner.style.cssText = 'position:fixed;top:48px;right:0;left:0;z-index:800;' +
    'background:rgba(0,60,100,0.8);backdrop-filter:blur(8px);' +
    'padding:5px 18px;display:flex;align-items:center;justify-content:center;gap:10px;' +
    'border-bottom:1px solid rgba(0,180,255,0.25);font-size:11px;color:#8bb8d0;letter-spacing:1px';
  banner.innerHTML = buildLastUpdateHTML(isoDate);
  document.body.appendChild(banner);
  clearTimeout(banner._tmr);
  banner._tmr = setTimeout(function(){
    banner.style.transition = 'opacity 1s';
    banner.style.opacity = '0';
    setTimeout(function(){ if(banner.parentNode) banner.parentNode.removeChild(banner); }, 1000);
  }, 8000);
  /* Tick a cada minuto para manter "há X min" atualizado */
  clearInterval(_lastUpdateTimer);
  _lastUpdateTimer = setInterval(updateLastUpdateIndicator, 60000);
}

function buildLastUpdateHTML(isoDate) {
  var dt = new Date(isoDate);
  var fmt = dt.toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  var diff = Math.round((Date.now() - dt.getTime()) / 60000);
  var diffTxt = diff < 1 ? 'agora mesmo' : diff === 1 ? 'há 1 min' : diff < 60 ? 'há ' + diff + ' min' : 'há ' + Math.round(diff/60) + 'h';
  return '<span style="color:#00d4ff;font-weight:700">🕐 Última atualização:</span> ' +
    '<span>' + fmt + ' <span style="color:#00d4ff">(' + diffTxt + ')</span></span>' +
    '<span style="color:#555;font-size:10px">· Atualização automática a cada 15 min</span>';
}

function updateLastUpdateIndicator() {
  if (!_lastUpdateIso) return;
  /* Atualiza banner se ainda visível */
  var banner = document.getElementById('lastUpdateBanner');
  if (banner) banner.innerHTML = buildLastUpdateHTML(_lastUpdateIso);
  /* Atualiza texto no status bar */
  var stxt = document.getElementById('stxt');
  if (stxt && _lastUpdateIso) {
    var diff = Math.round((Date.now() - new Date(_lastUpdateIso).getTime()) / 60000);
    var diffTxt = diff < 1 ? 'agora mesmo' : diff === 1 ? 'há 1 min' : diff < 60 ? 'há ' + diff + ' min' : 'há ' + Math.round(diff/60) + 'h';
    /* Só atualiza se não estiver em modo admin */
    if (!IS_ADMIN) {
      var cl = c_label(CURRENT_CLIENT);
      stxt.textContent = cl + ' · Atualizado ' + diffTxt;
    }
  }
}

/* ══════════════════════════════════════════
   AUTO-REFRESH — 15 minutos
══════════════════════════════════════════ */
function startAutoRefresh() {
  clearInterval(AUTO_REFRESH_TMR);
  AUTO_REFRESH_TMR = setInterval(async function(){
    if (IS_ADMIN) return; /* não atualiza enquanto admin está usando */
    try {
      var res = await fetch(SB_URL + '/rest/v1/dashboard_data?select=*', {
        headers: { 'apikey': SB_ANONKEY, 'Authorization': 'Bearer ' + SB_ANONKEY }
      });
      if (!res.ok) return;
      var allRows = await res.json();
      var changed = false;
      allRows.forEach(function(d){
        var cached = CLIENT_CACHE[d.client];
        /* Verifica se updated_at mudou */
        if (!cached || cached.updated_at !== d.updated_at) {
          CLIENT_CACHE[d.client] = {
            out:            { headers: JSON.parse(d.out_headers), rows: JSON.parse(d.out_rows) },
            def:            { headers: JSON.parse(d.def_headers), rows: JSON.parse(d.def_rows) },
            updated_at:     d.updated_at,
            default_filters: d.default_filters || '{}'
          };
          if (d.client === CURRENT_CLIENT) changed = true;
        }
      });
      if (changed) {
        /* Recarrega silenciosamente o cliente atual */
        var cd = CLIENT_CACHE[CURRENT_CLIENT];
        RAW.out = cd.out; RAW.def = cd.def;
        killCharts(); DATA = {}; MS_STATE = {}; CHART_FILTER = {fd:null,itm:null};
        await run();
        if (cd.default_filters && cd.default_filters !== '{}') applyDefaultFilters(cd.default_filters);
        buildClientTabs();
        setStatus('on', c_label(CURRENT_CLIENT) + ' · Atualizado ' + new Date().toLocaleString('pt-BR'));
        showLastUpdateBanner(cd.updated_at);
        showToast('🔄 Dados atualizados automaticamente', 'info');
      }
    } catch(e){ console.warn('[autoRefresh]', e); }
  }, 15 * 60 * 1000); /* 15 minutos */
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
function initSupabase() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('admin') === '1') {
    history.replaceState(null, '', window.location.pathname);
    show('upZone'); hide('dash');
    showSubPanel('adminLoginBox');
    setTimeout(function(){ var inp = document.getElementById('adminPwdInput'); if(inp) inp.focus(); }, 100);
  } else {
    loadAllClients();
  }
}

/* ── Fullscreen ── */
/* ══════════════════════════════════════════
   FULLSCREEN + MODO APRESENTAÇÃO
   Ao entrar fullscreen: cicla ACER → HP → ACER → ...
   Cada cliente fica 50s, contagem regressiva visível
══════════════════════════════════════════ */
var SLIDESHOW_TMR    = null;
var SLIDESHOW_TICK   = null;
var SLIDESHOW_ACTIVE = false;
var SLIDESHOW_IDX    = 0;
var SLIDESHOW_SECS   = 50;

function toggleFullscreen() {
  var btn = document.getElementById('btnFullscreen');
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function(){});
  } else {
    stopSlideshow();
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', function(){
  var btn = document.getElementById('btnFullscreen');
  if (document.fullscreenElement) {
    if (btn) { btn.textContent = '⛶✕'; btn.title = 'Sair da tela cheia'; btn.style.color = '#ff6b00'; }
    startSlideshow();
  } else {
    if (btn) { btn.textContent = '⛶'; btn.title = 'Tela cheia'; btn.style.color = ''; }
    stopSlideshow();
  }
});

function startSlideshow() {
  /* Só inicia se tiver mais de 1 cliente com dados */
  var available = CLIENTS.filter(function(c){ return CLIENT_CACHE[c.id] || (RAW_CLIENTS[c.id] && RAW_CLIENTS[c.id].out); });
  if (available.length < 2) { showSlideshowIndicator(null); return; }

  SLIDESHOW_ACTIVE = true;
  /* Começa no cliente atual */
  SLIDESHOW_IDX = available.findIndex(function(c){ return c.id === CURRENT_CLIENT; });
  if (SLIDESHOW_IDX < 0) SLIDESHOW_IDX = 0;

  showSlideshowIndicator(available, SLIDESHOW_SECS);
  var secsLeft = SLIDESHOW_SECS;

  SLIDESHOW_TICK = setInterval(function(){
    secsLeft--;
    showSlideshowIndicator(available, secsLeft);
    if (secsLeft <= 0) {
      secsLeft = SLIDESHOW_SECS;
      SLIDESHOW_IDX = (SLIDESHOW_IDX + 1) % available.length;
      var nextId = available[SLIDESHOW_IDX].id;
      switchClient(nextId);
      /* Fade transition */
      var dash = document.getElementById('dash');
      if (dash) {
        dash.style.opacity = '0';
        dash.style.transition = 'opacity 0.6s';
        setTimeout(function(){ dash.style.opacity = '1'; }, 700);
      }
    }
  }, 1000);
}

function stopSlideshow() {
  SLIDESHOW_ACTIVE = false;
  clearInterval(SLIDESHOW_TICK);
  clearTimeout(SLIDESHOW_TMR);
  SLIDESHOW_TICK = null;
  var ind = document.getElementById('slideshowInd');
  if (ind && ind.parentNode) ind.parentNode.removeChild(ind);
}

function showSlideshowIndicator(available, secsLeft) {
  var ind = document.getElementById('slideshowInd');
  if (!available) {
    if (ind && ind.parentNode) ind.parentNode.removeChild(ind);
    return;
  }
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'slideshowInd';
    ind.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);' +
      'z-index:9998;background:rgba(6,13,24,0.88);border:1px solid rgba(0,180,255,0.25);' +
      'border-radius:24px;padding:8px 20px;display:flex;align-items:center;gap:14px;' +
      'backdrop-filter:blur(12px);box-shadow:0 4px 24px rgba(0,0,0,0.5)';
    document.body.appendChild(ind);
  }

  var dots = available.map(function(c, i){
    var isActive = c.id === CURRENT_CLIENT;
    return '<div style="display:flex;align-items:center;gap:5px">' +
      '<div style="width:8px;height:8px;border-radius:50%;background:' +
        (isActive ? (c.color || '#00d4ff') : 'rgba(255,255,255,0.2)') +
        ';transition:all 0.3s;box-shadow:' + (isActive ? '0 0 8px '+(c.color||'#00d4ff') : 'none') + '"></div>' +
      '<span style="font-size:10px;font-weight:700;color:'+(isActive?'#fff':'#555')+';letter-spacing:1px">' + c.label + '</span>' +
    '</div>';
  }).join('<div style="width:1px;height:14px;background:rgba(255,255,255,0.1)"></div>');

  /* Progress arc / countdown */
  var pct = (SLIDESHOW_SECS - secsLeft) / SLIDESHOW_SECS;
  var r = 12, circ = 2 * Math.PI * r;
  var dash_arr = (pct * circ).toFixed(1) + ' ' + circ.toFixed(1);

  ind.innerHTML = dots +
    '<div style="position:relative;width:32px;height:32px;flex-shrink:0">' +
      '<svg width="32" height="32" style="position:absolute;top:0;left:0;transform:rotate(-90deg)">' +
        '<circle cx="16" cy="16" r="'+r+'" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>' +
        '<circle cx="16" cy="16" r="'+r+'" fill="none" stroke="#00d4ff" stroke-width="2" ' +
          'stroke-dasharray="'+dash_arr+'" stroke-linecap="round" style="transition:stroke-dasharray 0.9s linear"/>' +
      '</svg>' +
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'font-size:9px;color:#00d4ff;font-weight:700">' + secsLeft + '</div>' +
    '</div>' +
    '<button onclick="stopSlideshow();document.exitFullscreen();" title="Sair da apresentação" ' +
      'style="background:transparent;border:1px solid rgba(255,255,255,0.15);border-radius:6px;' +
      'color:#555;font-size:10px;padding:3px 8px;cursor:pointer">✕</button>';
}


/* ═══════════════════════════════════════════════════════════════
   HUAWEI — PIPELINE COMPLETO
   4 arquivos: Output L6, Falhas L6, Output L10, Falhas L10
═══════════════════════════════════════════════════════════════ */

/* ── Lista oficial de modelos Huawei ── */
var HW_MODELS = [
  'HG8M018245Q2',
  'HG8M018245QG23',
  'HG8M8145V5G201',
  'HG8M8145V5G270',
  'HG8M8145X6-10-V2G01',
  'HG8M8145X6-10-V2G05',
  'HG8M8145X6-10-V2G08',
  'HG8M8245Q2G15',
  'HG8M8245Q2G25',
  'HG8M8245W5-6T-V2G01',
  'HG8M8245W5G30',
  'HG8M8245W5G31'
];

/* Modelo selecionado no combobox do template L10 */
var HW_SELECTED_MODEL = '';

/* Estado dos 4 arquivos Huawei */
var RAW_HW = { outL6: null, defL6: null, outL10: null, defL10: null };

/* ── UI de upload 4 cards para Huawei ── */
function buildHuaweiUploadCards() {
  return '<div class="up-grid hw-grid">' +
    /* Card 1: Output L6 */
    '<div class="ucard" id="c-hw-outL6" onclick="document.getElementById(\'f-hw-outL6\').click()">' +
      '<span class="un">01 · OUTPUT L6 · HUAWEI</span>' +
      '<span class="uico">📊</span>' +
      '<div class="utit">Output_huawei_L6.xlsx</div>' +
      '<div class="usub">Line · Work Order · Model Name · Model Serial<br>Test station · Placa Passou · Placa Falhou · Total · FPY (%)</div>' +
      '<input type="file" id="f-hw-outL6" accept=".xlsx,.xls" onchange="loadHW(this,\'outL6\')"/>' +
      '<div class="ufile" id="n-hw-outL6">Nenhum arquivo</div>' +
    '</div>' +
    /* Card 2: Falhas L6 — opcional */
    '<div class="ucard" id="c-hw-defL6" onclick="document.getElementById(\'f-hw-defL6\').click()">' +
      '<span class="un">02 · FALHAS L6 · HUAWEI · OPCIONAL</span>' +
      '<span class="uico">⚠️</span>' +
      '<div class="utit">Falhas_L6_HUAWEI.xlsx <span style="font-size:10px;color:var(--amber)">(opcional)</span></div>' +
      '<div class="usub">Serial · Work Order · Failure Code · Description<br>Test station · Failure date · Item<br>' +
        '<span style="color:var(--t3)">Se não houver falhas L6, deixe em branco</span></div>' +
      '<input type="file" id="f-hw-defL6" accept=".xlsx,.xls" onchange="loadHW(this,\'defL6\')"/>' +
      '<div class="ufile" id="n-hw-defL6">Nenhum arquivo (zero defeitos)</div>' +
    '</div>' +
    /* Card 3: Output L10 — template download + upload (sem combobox) */
    '<div class="ucard" id="c-hw-outL10">' +
      '<span class="un">03 · OUTPUT L10 · HUAWEI</span>' +
      '<span class="uico">📋</span>' +
      '<div class="utit">OUTPUT_L10_HUAWEI.xlsx</div>' +
      '<div class="usub">ST-MP1 · ST-MP13 · ST-MP9<br>Input · Qty Pass · Qty Fail · First Pass<br>' +
        '<span style="color:var(--t3);font-size:9px">Modelo definido por linha no template</span></div>' +
      '<div style="display:flex;gap:6px;margin-top:12px">' +
        '<button onclick="downloadL10Template()" style="flex:1;background:rgba(0,212,255,0.1);border:1px solid var(--cyan);' +
          'color:var(--cyan);padding:5px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700">⬇ BAIXAR TEMPLATE</button>' +
        '<button onclick="document.getElementById(\'f-hw-outL10\').click()" style="flex:1;background:rgba(255,255,255,0.05);' +
          'border:1px solid var(--ln2);color:var(--t1);padding:5px 8px;border-radius:5px;font-size:10px;cursor:pointer">📂 CARREGAR</button>' +
      '</div>' +
      '<input type="file" id="f-hw-outL10" accept=".xlsx,.xls" onchange="loadHW(this,\'outL10\')"/>' +
      '<div class="ufile" id="n-hw-outL10">Nenhum arquivo</div>' +
    '</div>' +
    /* Card 4: Falhas L10 (HTML xls) — opcional */
    '<div class="ucard" id="c-hw-defL10" onclick="document.getElementById(\'f-hw-defL10\').click()">' +
      '<span class="un">04 · FALHAS L10 · HUAWEI · OPCIONAL</span>' +
      '<span class="uico">🔴</span>' +
      '<div class="utit">Falhas_L10_HUAWEI.xls <span style="font-size:10px;color:var(--amber)">(opcional)</span></div>' +
      '<div class="usub">Serial · Work Order · Estação · Descrição Falha<br><b>Formato HTML exportado do SFC/MES</b><br>' +
        '<span style="color:var(--t3)">Se não houver falhas L10, deixe em branco</span></div>' +
      '<input type="file" id="f-hw-defL10" accept=".xls,.xlsx,.html,.htm" onchange="loadHWDefL10(this)"/>' +
      '<div class="ufile" id="n-hw-defL10">Nenhum arquivo (zero defeitos)</div>' +
    '</div>' +
  '</div>';
}

function restoreHuaweiUploadUI() {
  var map = {outL6:'📊 Output L6', defL6:'⚠️ Falhas L6', outL10:'📋 Output L10', defL10:'🔴 Falhas L10'};
  ['outL6','defL6','outL10','defL10'].forEach(function(k){
    var nEl = document.getElementById('n-hw-'+k);
    var cEl = document.getElementById('c-hw-'+k);
    if (RAW_HW[k] && nEl) {
      var rows = RAW_HW[k].rows ? RAW_HW[k].rows.length : 0;
      nEl.textContent = '✅ ' + map[k] + ' — ' + rows + ' registros';
      if (cEl) cEl.classList.add('done');
    }
  });
  checkReady();
}

/* ── Loader para arquivos XLSX padrão (L6 output e falhas, L10 output) ── */
function loadHW(input, key) {
  var file = input.files[0];
  if (!file) return;
  var nEl = document.getElementById('n-hw-'+key);
  var cEl = document.getElementById('c-hw-'+key);
  if (nEl) nEl.textContent = '⏳ Lendo ' + file.name + '...';
  var reader = new FileReader();
  reader.onerror = function() { if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Erro ao ler'; } };
  reader.onload = function(e) {
    try {
      if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada');
      var wb  = XLSX.read(e.target.result, {type:'binary', cellDates:false, raw:false});
      var ws  = wb.Sheets[wb.SheetNames[0]];
      var aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', blankrows:false});
      /* L10 output tem título na row 0, headers na row 1, dados na row 2+ */
      var startRow = (key === 'outL10') ? 1 : 1;
      if (!aoa || aoa.length <= startRow) { 
        if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Estrutura inválida'; } return; 
      }
      var rawH = (aoa[startRow]||[]).map(function(h){ return String(h==null?'':h).trim(); });
      var seen = {}, headers = rawH.map(function(h){
        if (seen[h]===undefined){seen[h]=0;return h;} seen[h]++;return h+'_'+seen[h];
      });
      var rows = [];
      for (var i = startRow+1; i < aoa.length; i++) {
        var r = aoa[i], hasVal = false;
        for (var j=0;j<r.length;j++){if(r[j]!==''&&r[j]!==null&&r[j]!==undefined){hasVal=true;break;}}
        if (!hasVal) continue;
        var obj = {};
        headers.forEach(function(h,k2){ obj[h] = (r[k2]!==undefined&&r[k2]!==null)?r[k2]:''; });
        rows.push(obj);
      }
      RAW_HW[key] = {headers:headers, rows:rows};
      if (nEl) { nEl.style.color=''; nEl.textContent='✅ '+file.name+' — '+rows.length+' registros'; }
      if (cEl) cEl.classList.add('done');
      checkReady();
    } catch(err) {
      if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Erro: '+err.message; }
    }
  };
  reader.readAsBinaryString(file);
}

/* ── Loader para Falhas L10 (HTML/UTF-16 exportado do SFC) ── */
function loadHWDefL10(input) {
  var file = input.files[0];
  if (!file) return;
  var nEl = document.getElementById('n-hw-defL10');
  var cEl = document.getElementById('c-hw-defL10');
  if (nEl) nEl.textContent = '⏳ Lendo ' + file.name + '...';
  var reader = new FileReader();
  reader.onerror = function() { if(nEl){nEl.style.color='#ff3d5a';nEl.textContent='❌ Erro ao ler';} };
  reader.onload = function(e) {
    try {
      /* Detecta encoding: FF FE = UTF-16 LE */
      var bytes = new Uint8Array(e.target.result);
      var text;
      if (bytes[0]===0xFF && bytes[1]===0xFE) {
        text = new TextDecoder('utf-16le').decode(e.target.result.slice(2));
      } else {
        text = new TextDecoder('utf-8').decode(e.target.result);
      }
      /* Parse tabela HTML */
      var trList = text.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      if (trList.length === 0) {
        /* Tenta como XLSX se falhar HTML */
        if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Formato não reconhecido — use o .xls original'; }
        return;
      }
      function stripTags(s){ return s.replace(/<[^>]+>/g,'').trim(); }
      var headers = [];
      var rows = [];
      trList.forEach(function(tr, idx) {
        var cells = (tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)||[]).map(function(td){return stripTags(td);});
        if (idx===0) { headers=cells; }
        else if (cells.length>0) {
          var obj={}; headers.forEach(function(h,k){obj[h]=cells[k]||'';}); rows.push(obj);
        }
      });
      RAW_HW.defL10 = {headers:headers, rows:rows};
      if (nEl) { nEl.style.color=''; nEl.textContent='✅ '+file.name+' — '+rows.length+' registros'; }
      if (cEl) cEl.classList.add('done');
      checkReady();
    } catch(err) {
      if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Erro: '+err.message; }
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ── checkReady para Huawei — somente outL6 é obrigatório ── */
var _origCheckReady = checkReady;
checkReady = function() {
  if (typeof ADMIN_CLIENT !== 'undefined' && ADMIN_CLIENT === 'asus') {
    checkReadyAsus();
    return;
  }
  if (typeof ADMIN_CLIENT !== 'undefined' && ADMIN_CLIENT === 'huawei') {
    /* Apenas outL6 é obrigatório; outL10, defL6 e defL10 são todos opcionais */
    var ok = !!(RAW_HW.outL6);
    var btn = document.getElementById('btnGo');
    if (btn) btn.disabled = !ok;
    var hint = document.getElementById('hint');
    if (hint) {
      if (!ok) {
        hint.textContent = 'Aguardando: outL6 (Output L6 obrigatório)';
      } else {
        var noFiles = [];
        if (!RAW_HW.outL10) noFiles.push('Output L10');
        if (!RAW_HW.defL6)  noFiles.push('Falhas L6');
        if (!RAW_HW.defL10) noFiles.push('Falhas L10');
        /* Garante estruturas vazias para os opcionais ausentes */
        if (!RAW_HW.outL10) RAW_HW.outL10 = { headers: [], rows: [] };
        if (!RAW_HW.defL6)  RAW_HW.defL6  = { headers: [], rows: [] };
        if (!RAW_HW.defL10) RAW_HW.defL10 = { headers: [], rows: [] };
        hint.textContent = noFiles.length
          ? '✓ Sem ' + noFiles.join(' / ') + ' — OK, zero defeitos assumido. Clique em GERAR'
          : '✓ Todos os arquivos prontos — clique em GERAR DASHBOARD';
      }
    }
    return;
  }
  _origCheckReady();
};

/* ── Template download para Output L10 — arquivo oficial ── */
function downloadL10Template() {
  /* Baixa o template xlsx exato fornecido pela equipe Foxconn/Huawei */
  var b64 = 'UEsDBBQAAAAAAAAAAADxYTwnQgMAAEIDAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3dvcmtzaGVldCIgVGFyZ2V0PSJ3b3Jrc2hlZXRzL3NoZWV0MS54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQyIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3dvcmtzaGVldCIgVGFyZ2V0PSJ3b3Jrc2hlZXRzL3NoZWV0Mi54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQzIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3RoZW1lIiBUYXJnZXQ9InRoZW1lL3RoZW1lMS54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQ0IiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3N0eWxlcyIgVGFyZ2V0PSJzdHlsZXMueG1sIi8+PFJlbGF0aW9uc2hpcCBJZD0icklkNSIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9zaGVldE1ldGFkYXRhIiBUYXJnZXQ9Im1ldGFkYXRhLnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAAAAAAADAPiGveHQAA3h0AABMAAAB4bC90aGVtZS90aGVtZTEueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPGE6dGhlbWUgeG1sbnM6YT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL2RyYXdpbmdtbC8yMDA2L21haW4iIG5hbWU9Ik9mZmljZSBUaGVtZSI+PGE6dGhlbWVFbGVtZW50cz48YTpjbHJTY2hlbWUgbmFtZT0iT2ZmaWNlIj48YTpkazE+PGE6c3lzQ2xyIHZhbD0id2luZG93VGV4dCIgbGFzdENscj0iMDAwMDAwIi8+PC9hOmRrMT48YTpsdDE+PGE6c3lzQ2xyIHZhbD0id2luZG93IiBsYXN0Q2xyPSJGRkZGRkYiLz48L2E6bHQxPjxhOmRrMj48YTpzcmdiQ2xyIHZhbD0iMUY0OTdEIi8+PC9hOmRrMj48YTpsdDI+PGE6c3JnYkNsciB2YWw9IkVFRUNFMSIvPjwvYTpsdDI+PGE6YWNjZW50MT48YTpzcmdiQ2xyIHZhbD0iNEY4MUJEIi8+PC9hOmFjY2VudDE+PGE6YWNjZW50Mj48YTpzcmdiQ2xyIHZhbD0iQzA1MDREIi8+PC9hOmFjY2VudDI+PGE6YWNjZW50Mz48YTpzcmdiQ2xyIHZhbD0iOUJCQjU5Ii8+PC9hOmFjY2VudDM+PGE6YWNjZW50ND48YTpzcmdiQ2xyIHZhbD0iODA2NEEyIi8+PC9hOmFjY2VudDQ+PGE6YWNjZW50NT48YTpzcmdiQ2xyIHZhbD0iNEJBQ0M2Ii8+PC9hOmFjY2VudDU+PGE6YWNjZW50Nj48YTpzcmdiQ2xyIHZhbD0iRjc5NjQ2Ii8+PC9hOmFjY2VudDY+PGE6aGxpbms+PGE6c3JnYkNsciB2YWw9IjAwMDBGRiIvPjwvYTpobGluaz48YTpmb2xIbGluaz48YTpzcmdiQ2xyIHZhbD0iODAwMDgwIi8+PC9hOmZvbEhsaW5rPjwvYTpjbHJTY2hlbWU+PGE6Zm9udFNjaGVtZSBuYW1lPSJPZmZpY2UiPjxhOm1ham9yRm9udD48YTpsYXRpbiB0eXBlZmFjZT0iQ2FtYnJpYSIvPjxhOmVhIHR5cGVmYWNlPSIiLz48YTpjcyB0eXBlZmFjZT0iIi8+PGE6Zm9udCBzY3JpcHQ9IkpwYW4iIHR5cGVmYWNlPSLvvK3vvLMg77yw44K044K344OD44KvIi8+PGE6Zm9udCBzY3JpcHQ9IkhhbmciIHR5cGVmYWNlPSLrp5HsnYAg6rOg65SVIi8+PGE6Zm9udCBzY3JpcHQ9IkhhbnMiIHR5cGVmYWNlPSLlrovkvZMiLz48YTpmb250IHNjcmlwdD0iSGFudCIgdHlwZWZhY2U9IuaWsOe0sOaYjumrlCIvPjxhOmZvbnQgc2NyaXB0PSJBcmFiIiB0eXBlZmFjZT0iVGltZXMgTmV3IFJvbWFuIi8+PGE6Zm9udCBzY3JpcHQ9IkhlYnIiIHR5cGVmYWNlPSJUaW1lcyBOZXcgUm9tYW4iLz48YTpmb250IHNjcmlwdD0iVGhhaSIgdHlwZWZhY2U9IlRhaG9tYSIvPjxhOmZvbnQgc2NyaXB0PSJFdGhpIiB0eXBlZmFjZT0iTnlhbGEiLz48YTpmb250IHNjcmlwdD0iQmVuZyIgdHlwZWZhY2U9IlZyaW5kYSIvPjxhOmZvbnQgc2NyaXB0PSJHdWpyIiB0eXBlZmFjZT0iU2hydXRpIi8+PGE6Zm9udCBzY3JpcHQ9IktobXIiIHR5cGVmYWNlPSJNb29sQm9yYW4iLz48YTpmb250IHNjcmlwdD0iS25kYSIgdHlwZWZhY2U9IlR1bmdhIi8+PGE6Zm9udCBzY3JpcHQ9Ikd1cnUiIHR5cGVmYWNlPSJSYWF2aSIvPjxhOmZvbnQgc2NyaXB0PSJDYW5zIiB0eXBlZmFjZT0iRXVwaGVtaWEiLz48YTpmb250IHNjcmlwdD0iQ2hlciIgdHlwZWZhY2U9IlBsYW50YWdlbmV0IENoZXJva2VlIi8+PGE6Zm9udCBzY3JpcHQ9IllpaWkiIHR5cGVmYWNlPSJNaWNyb3NvZnQgWWkgQmFpdGkiLz48YTpmb250IHNjcmlwdD0iVGlidCIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBIaW1hbGF5YSIvPjxhOmZvbnQgc2NyaXB0PSJUaGFhIiB0eXBlZmFjZT0iTVYgQm9saSIvPjxhOmZvbnQgc2NyaXB0PSJEZXZhIiB0eXBlZmFjZT0iTWFuZ2FsIi8+PGE6Zm9udCBzY3JpcHQ9IlRlbHUiIHR5cGVmYWNlPSJHYXV0YW1pIi8+PGE6Zm9udCBzY3JpcHQ9IlRhbWwiIHR5cGVmYWNlPSJMYXRoYSIvPjxhOmZvbnQgc2NyaXB0PSJTeXJjIiB0eXBlZmFjZT0iRXN0cmFuZ2VsbyBFZGVzc2EiLz48YTpmb250IHNjcmlwdD0iT3J5YSIgdHlwZWZhY2U9IkthbGluZ2EiLz48YTpmb250IHNjcmlwdD0iTWx5bSIgdHlwZWZhY2U9IkthcnRpa2EiLz48YTpmb250IHNjcmlwdD0iTGFvbyIgdHlwZWZhY2U9IkRva0NoYW1wYSIvPjxhOmZvbnQgc2NyaXB0PSJTaW5oIiB0eXBlZmFjZT0iSXNrb29sYSBQb3RhIi8+PGE6Zm9udCBzY3JpcHQ9Ik1vbmciIHR5cGVmYWNlPSJNb25nb2xpYW4gQmFpdGkiLz48YTpmb250IHNjcmlwdD0iVmlldCIgdHlwZWZhY2U9IlRpbWVzIE5ldyBSb21hbiIvPjxhOmZvbnQgc2NyaXB0PSJVaWdoIiB0eXBlZmFjZT0iTWljcm9zb2Z0IFVpZ2h1ciIvPjxhOmZvbnQgc2NyaXB0PSJHZW9yIiB0eXBlZmFjZT0iU3lsZmFlbiIvPjwvYTptYWpvckZvbnQ+PGE6bWlub3JGb250PjxhOmxhdGluIHR5cGVmYWNlPSJDYWxpYnJpIi8+PGE6ZWEgdHlwZWZhY2U9IiIvPjxhOmNzIHR5cGVmYWNlPSIiLz48YTpmb250IHNjcmlwdD0iSnBhbiIgdHlwZWZhY2U9Iu+8re+8syDvvLDjgrTjgrfjg4Pjgq8iLz48YTpmb250IHNjcmlwdD0iSGFuZyIgdHlwZWZhY2U9IuunkeydgCDqs6DrlJUiLz48YTpmb250IHNjcmlwdD0iSGFucyIgdHlwZWZhY2U9IuWui+S9kyIvPjxhOmZvbnQgc2NyaXB0PSJIYW50IiB0eXBlZmFjZT0i5paw57Sw5piO6auUIi8+PGE6Zm9udCBzY3JpcHQ9IkFyYWIiIHR5cGVmYWNlPSJBcmlhbCIvPjxhOmZvbnQgc2NyaXB0PSJIZWJyIiB0eXBlZmFjZT0iQXJpYWwiLz48YTpmb250IHNjcmlwdD0iVGhhaSIgdHlwZWZhY2U9IlRhaG9tYSIvPjxhOmZvbnQgc2NyaXB0PSJFdGhpIiB0eXBlZmFjZT0iTnlhbGEiLz48YTpmb250IHNjcmlwdD0iQmVuZyIgdHlwZWZhY2U9IlZyaW5kYSIvPjxhOmZvbnQgc2NyaXB0PSJHdWpyIiB0eXBlZmFjZT0iU2hydXRpIi8+PGE6Zm9udCBzY3JpcHQ9IktobXIiIHR5cGVmYWNlPSJEYXVuUGVuaCIvPjxhOmZvbnQgc2NyaXB0PSJLbmRhIiB0eXBlZmFjZT0iVHVuZ2EiLz48YTpmb250IHNjcmlwdD0iR3VydSIgdHlwZWZhY2U9IlJhYXZpIi8+PGE6Zm9udCBzY3JpcHQ9IkNhbnMiIHR5cGVmYWNlPSJFdXBoZW1pYSIvPjxhOmZvbnQgc2NyaXB0PSJDaGVyIiB0eXBlZmFjZT0iUGxhbnRhZ2VuZXQgQ2hlcm9rZWUiLz48YTpmb250IHNjcmlwdD0iWWlpaSIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBZaSBCYWl0aSIvPjxhOmZvbnQgc2NyaXB0PSJUaWJ0IiB0eXBlZmFjZT0iTWljcm9zb2Z0IEhpbWFsYXlhIi8+PGE6Zm9udCBzY3JpcHQ9IlRoYWEiIHR5cGVmYWNlPSJNViBCb2xpIi8+PGE6Zm9udCBzY3JpcHQ9IkRldmEiIHR5cGVmYWNlPSJNYW5nYWwiLz48YTpmb250IHNjcmlwdD0iVGVsdSIgdHlwZWZhY2U9IkdhdXRhbWkiLz48YTpmb250IHNjcmlwdD0iVGFtbCIgdHlwZWZhY2U9IkxhdGhhIi8+PGE6Zm9udCBzY3JpcHQ9IlN5cmMiIHR5cGVmYWNlPSJFc3RyYW5nZWxvIEVkZXNzYSIvPjxhOmZvbnQgc2NyaXB0PSJPcnlhIiB0eXBlZmFjZT0iS2FsaW5nYSIvPjxhOmZvbnQgc2NyaXB0PSJNbHltIiB0eXBlZmFjZT0iS2FydGlrYSIvPjxhOmZvbnQgc2NyaXB0PSJMYW9vIiB0eXBlZmFjZT0iRG9rQ2hhbXBhIi8+PGE6Zm9udCBzY3JpcHQ9IlNpbmgiIHR5cGVmYWNlPSJJc2tvb2xhIFBvdGEiLz48YTpmb250IHNjcmlwdD0iTW9uZyIgdHlwZWZhY2U9Ik1vbmdvbGlhbiBCYWl0aSIvPjxhOmZvbnQgc2NyaXB0PSJWaWV0IiB0eXBlZmFjZT0iQXJpYWwiLz48YTpmb250IHNjcmlwdD0iVWlnaCIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBVaWdodXIiLz48YTpmb250IHNjcmlwdD0iR2VvciIgdHlwZWZhY2U9IlN5bGZhZW4iLz48L2E6bWlub3JGb250PjwvYTpmb250U2NoZW1lPjxhOmZtdFNjaGVtZSBuYW1lPSJPZmZpY2UiPjxhOmZpbGxTdHlsZUxzdD48YTpzb2xpZEZpbGw+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiLz48L2E6c29saWRGaWxsPjxhOmdyYWRGaWxsIHJvdFdpdGhTaGFwZT0iMSI+PGE6Z3NMc3Q+PGE6Z3MgcG9zPSIwIj48YTpzY2hlbWVDbHIgdmFsPSJwaENsciI+PGE6dGludCB2YWw9IjUwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMzAwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PGE6Z3MgcG9zPSIzNTAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSIzNzAwMCIvPjxhOnNhdE1vZCB2YWw9IjMwMDAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOmdzPjxhOmdzIHBvcz0iMTAwMDAwIj48YTpzY2hlbWVDbHIgdmFsPSJwaENsciI+PGE6dGludCB2YWw9IjE1MDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PC9hOmdzTHN0PjxhOmxpbiBhbmc9IjE2MjAwMDAwIiBzY2FsZWQ9IjEiLz48L2E6Z3JhZEZpbGw+PGE6Z3JhZEZpbGwgcm90V2l0aFNoYXBlPSIxIj48YTpnc0xzdD48YTpncyBwb3M9IjAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTp0aW50IHZhbD0iMTAwMDAwIi8+PGE6c2hhZGUgdmFsPSIxMDAwMDAiLz48YTpzYXRNb2QgdmFsPSIxMzAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48YTpncyBwb3M9IjEwMDAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSI1MDAwMCIvPjxhOnNoYWRlIHZhbD0iMTAwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PC9hOmdzTHN0PjxhOmxpbiBhbmc9IjE2MjAwMDAwIiBzY2FsZWQ9IjAiLz48L2E6Z3JhZEZpbGw+PC9hOmZpbGxTdHlsZUxzdD48YTpsblN0eWxlTHN0PjxhOmxuIHc9Ijk1MjUiIGNhcD0iZmxhdCIgY21wZD0ic25nIiBhbGduPSJjdHIiPjxhOnNvbGlkRmlsbD48YTpzY2hlbWVDbHIgdmFsPSJwaENsciI+PGE6c2hhZGUgdmFsPSI5NTAwMCIvPjxhOnNhdE1vZCB2YWw9IjEwNTAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOnNvbGlkRmlsbD48YTpwcnN0RGFzaCB2YWw9InNvbGlkIi8+PC9hOmxuPjxhOmxuIHc9IjI1NDAwIiBjYXA9ImZsYXQiIGNtcGQ9InNuZyIgYWxnbj0iY3RyIj48YTpzb2xpZEZpbGw+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiLz48L2E6c29saWRGaWxsPjxhOnByc3REYXNoIHZhbD0ic29saWQiLz48L2E6bG4+PGE6bG4gdz0iMzgxMDAiIGNhcD0iZmxhdCIgY21wZD0ic25nIiBhbGduPSJjdHIiPjxhOnNvbGlkRmlsbD48YTpzY2hlbWVDbHIgdmFsPSJwaENsciIvPjwvYTpzb2xpZEZpbGw+PGE6cHJzdERhc2ggdmFsPSJzb2xpZCIvPjwvYTpsbj48L2E6bG5TdHlsZUxzdD48YTplZmZlY3RTdHlsZUxzdD48YTplZmZlY3RTdHlsZT48YTplZmZlY3RMc3Q+PGE6b3V0ZXJTaGR3IGJsdXJSYWQ9IjQwMDAwIiBkaXN0PSIyMDAwMCIgZGlyPSI1NDAwMDAwIiByb3RXaXRoU2hhcGU9IjAiPjxhOnNyZ2JDbHIgdmFsPSIwMDAwMDAiPjxhOmFscGhhIHZhbD0iMzgwMDAiLz48L2E6c3JnYkNscj48L2E6b3V0ZXJTaGR3PjwvYTplZmZlY3RMc3Q+PC9hOmVmZmVjdFN0eWxlPjxhOmVmZmVjdFN0eWxlPjxhOmVmZmVjdExzdD48YTpvdXRlclNoZHcgYmx1clJhZD0iNDAwMDAiIGRpc3Q9IjIzMDAwIiBkaXI9IjU0MDAwMDAiIHJvdFdpdGhTaGFwZT0iMCI+PGE6c3JnYkNsciB2YWw9IjAwMDAwMCI+PGE6YWxwaGEgdmFsPSIzNTAwMCIvPjwvYTpzcmdiQ2xyPjwvYTpvdXRlclNoZHc+PC9hOmVmZmVjdExzdD48L2E6ZWZmZWN0U3R5bGU+PGE6ZWZmZWN0U3R5bGU+PGE6ZWZmZWN0THN0PjxhOm91dGVyU2hkdyBibHVyUmFkPSI0MDAwMCIgZGlzdD0iMjMwMDAiIGRpcj0iNTQwMDAwMCIgcm90V2l0aFNoYXBlPSIwIj48YTpzcmdiQ2xyIHZhbD0iMDAwMDAwIj48YTphbHBoYSB2YWw9IjM1MDAwIi8+PC9hOnNyZ2JDbHI+PC9hOm91dGVyU2hkdz48L2E6ZWZmZWN0THN0PjxhOnNjZW5lM2Q+PGE6Y2FtZXJhIHByc3Q9Im9ydGhvZ3JhcGhpY0Zyb250Ij48YTpyb3QgbGF0PSIwIiBsb249IjAiIHJldj0iMCIvPjwvYTpjYW1lcmE+PGE6bGlnaHRSaWcgcmlnPSJ0aHJlZVB0IiBkaXI9InQiPjxhOnJvdCBsYXQ9IjAiIGxvbj0iMCIgcmV2PSIxMjAwMDAwIi8+PC9hOmxpZ2h0UmlnPjwvYTpzY2VuZTNkPjxhOnNwM2Q+PGE6YmV2ZWxUIHc9IjYzNTAwIiBoPSIyNTQwMCIvPjwvYTpzcDNkPjwvYTplZmZlY3RTdHlsZT48L2E6ZWZmZWN0U3R5bGVMc3Q+PGE6YmdGaWxsU3R5bGVMc3Q+PGE6c29saWRGaWxsPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIi8+PC9hOnNvbGlkRmlsbD48YTpncmFkRmlsbCByb3RXaXRoU2hhcGU9IjEiPjxhOmdzTHN0PjxhOmdzIHBvcz0iMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSI0MDAwMCIvPjxhOnNhdE1vZCB2YWw9IjM1MDAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOmdzPjxhOmdzIHBvcz0iNDAwMDAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTp0aW50IHZhbD0iNDUwMDAiLz48YTpzaGFkZSB2YWw9Ijk5MDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PGE6Z3MgcG9zPSIxMDAwMDAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTpzaGFkZSB2YWw9IjIwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMjU1MDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PC9hOmdzTHN0PjxhOnBhdGggcGF0aD0iY2lyY2xlIj48YTpmaWxsVG9SZWN0IGw9IjUwMDAwIiB0PSItODAwMDAiIHI9IjUwMDAwIiBiPSIxODAwMDAiLz48L2E6cGF0aD48L2E6Z3JhZEZpbGw+PGE6Z3JhZEZpbGwgcm90V2l0aFNoYXBlPSIxIj48YTpnc0xzdD48YTpncyBwb3M9IjAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTp0aW50IHZhbD0iODAwMDAiLz48YTpzYXRNb2QgdmFsPSIzMDAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48YTpncyBwb3M9IjEwMDAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnNoYWRlIHZhbD0iMzAwMDAiLz48YTpzYXRNb2QgdmFsPSIyMDAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48L2E6Z3NMc3Q+PGE6cGF0aCBwYXRoPSJjaXJjbGUiPjxhOmZpbGxUb1JlY3QgbD0iNTAwMDAiIHQ9IjUwMDAwIiByPSI1MDAwMCIgYj0iNTAwMDAiLz48L2E6cGF0aD48L2E6Z3JhZEZpbGw+PC9hOmJnRmlsbFN0eWxlTHN0PjwvYTpmbXRTY2hlbWU+PC9hOnRoZW1lRWxlbWVudHM+PGE6b2JqZWN0RGVmYXVsdHM+PGE6c3BEZWY+PGE6c3BQci8+PGE6Ym9keVByLz48YTpsc3RTdHlsZS8+PGE6c3R5bGU+PGE6bG5SZWYgaWR4PSIxIj48YTpzY2hlbWVDbHIgdmFsPSJhY2NlbnQxIi8+PC9hOmxuUmVmPjxhOmZpbGxSZWYgaWR4PSIzIj48YTpzY2hlbWVDbHIgdmFsPSJhY2NlbnQxIi8+PC9hOmZpbGxSZWY+PGE6ZWZmZWN0UmVmIGlkeD0iMiI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTplZmZlY3RSZWY+PGE6Zm9udFJlZiBpZHg9Im1pbm9yIj48YTpzY2hlbWVDbHIgdmFsPSJsdDEiLz48L2E6Zm9udFJlZj48L2E6c3R5bGU+PC9hOnNwRGVmPjxhOmxuRGVmPjxhOnNwUHIvPjxhOmJvZHlQci8+PGE6bHN0U3R5bGUvPjxhOnN0eWxlPjxhOmxuUmVmIGlkeD0iMiI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTpsblJlZj48YTpmaWxsUmVmIGlkeD0iMCI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTpmaWxsUmVmPjxhOmVmZmVjdFJlZiBpZHg9IjEiPjxhOnNjaGVtZUNsciB2YWw9ImFjY2VudDEiLz48L2E6ZWZmZWN0UmVmPjxhOmZvbnRSZWYgaWR4PSJtaW5vciI+PGE6c2NoZW1lQ2xyIHZhbD0idHgxIi8+PC9hOmZvbnRSZWY+PC9hOnN0eWxlPjwvYTpsbkRlZj48L2E6b2JqZWN0RGVmYXVsdHM+PGE6ZXh0cmFDbHJTY2hlbWVMc3QvPjwvYTp0aGVtZT5QSwMEFAAAAAAAAAAAAFX0BJRaBAAAWgQAAA0AAAB4bC9zdHlsZXMueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPHN0eWxlU2hlZXQgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6dnQ9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L2RvY1Byb3BzVlR5cGVzIj48bnVtRm10cyBjb3VudD0iMSI+PG51bUZtdCBudW1GbXRJZD0iNTYiIGZvcm1hdENvZGU9IiZxdW90O+S4iuWNiC/kuIvljYggJnF1b3Q7aGgmcXVvdDvmmYImcXVvdDttbSZxdW90O+WIhiZxdW90O3NzJnF1b3Q756eSICZxdW90OyIvPjwvbnVtRm10cz48Zm9udHMgY291bnQ9IjEiPjxmb250PjxzeiB2YWw9IjEyIi8+PGNvbG9yIHRoZW1lPSIxIi8+PG5hbWUgdmFsPSJDYWxpYnJpIi8+PGZhbWlseSB2YWw9IjIiLz48c2NoZW1lIHZhbD0ibWlub3IiLz48L2ZvbnQ+PC9mb250cz48ZmlsbHMgY291bnQ9IjIiPjxmaWxsPjxwYXR0ZXJuRmlsbCBwYXR0ZXJuVHlwZT0ibm9uZSIvPjwvZmlsbD48ZmlsbD48cGF0dGVybkZpbGwgcGF0dGVyblR5cGU9ImdyYXkxMjUiLz48L2ZpbGw+PC9maWxscz48Ym9yZGVycyBjb3VudD0iMSI+PGJvcmRlcj48bGVmdC8+PHJpZ2h0Lz48dG9wLz48Ym90dG9tLz48ZGlhZ29uYWwvPjwvYm9yZGVyPjwvYm9yZGVycz48Y2VsbFN0eWxlWGZzIGNvdW50PSIxIj48eGYgbnVtRm10SWQ9IjAiIGZvbnRJZD0iMCIgZmlsbElkPSIwIiBib3JkZXJJZD0iMCIvPjwvY2VsbFN0eWxlWGZzPjxjZWxsWGZzIGNvdW50PSIxIj48eGYgbnVtRm10SWQ9IjAiIGZvbnRJZD0iMCIgZmlsbElkPSIwIiBib3JkZXJJZD0iMCIgeGZJZD0iMCIgYXBwbHlOdW1iZXJGb3JtYXQ9IjEiLz48L2NlbGxYZnM+PGNlbGxTdHlsZXMgY291bnQ9IjEiPjxjZWxsU3R5bGUgbmFtZT0iTm9ybWFsIiB4ZklkPSIwIiBidWlsdGluSWQ9IjAiLz48L2NlbGxTdHlsZXM+PGR4ZnMgY291bnQ9IjAiLz48dGFibGVTdHlsZXMgY291bnQ9IjAiIGRlZmF1bHRUYWJsZVN0eWxlPSJUYWJsZVN0eWxlTWVkaXVtOSIgZGVmYXVsdFBpdm90U3R5bGU9IlBpdm90U3R5bGVNZWRpdW00Ii8+PC9zdHlsZVNoZWV0PlBLAwQUAAAAAAAAAAAAJC9kb8kRAADJEQAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4NCjx3b3Jrc2hlZXQgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6cj0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcyI+PGRpbWVuc2lvbiByZWY9IkExOlQ1Ii8+PHNoZWV0Vmlld3M+PHNoZWV0VmlldyB3b3JrYm9va1ZpZXdJZD0iMCIvPjwvc2hlZXRWaWV3cz48Y29scz48Y29sIG1pbj0iMSIgbWF4PSIxIiB3aWR0aD0iMjYuODMyMDMxMjUiIGN1c3RvbVdpZHRoPSIxIi8+PGNvbCBtaW49IjIiIG1heD0iMiIgd2lkdGg9IjUuODMyMDMxMjUiIGN1c3RvbVdpZHRoPSIxIi8+PGNvbCBtaW49IjMiIG1heD0iMyIgd2lkdGg9IjEwLjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSI0IiBtYXg9IjQiIHdpZHRoPSI4LjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSI1IiBtYXg9IjUiIHdpZHRoPSI4LjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSI2IiBtYXg9IjYiIHdpZHRoPSIxMC44MzIwMzEyNSIgY3VzdG9tV2lkdGg9IjEiLz48Y29sIG1pbj0iNyIgbWF4PSI3IiB3aWR0aD0iMTAuODMyMDMxMjUiIGN1c3RvbVdpZHRoPSIxIi8+PGNvbCBtaW49IjgiIG1heD0iOCIgd2lkdGg9IjE0LjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSI5IiBtYXg9IjkiIHdpZHRoPSIxNC44MzIwMzEyNSIgY3VzdG9tV2lkdGg9IjEiLz48Y29sIG1pbj0iMTAiIG1heD0iMTAiIHdpZHRoPSIxMC44MzIwMzEyNSIgY3VzdG9tV2lkdGg9IjEiLz48Y29sIG1pbj0iMTEiIG1heD0iMTEiIHdpZHRoPSIxMC44MzIwMzEyNSIgY3VzdG9tV2lkdGg9IjEiLz48Y29sIG1pbj0iMTIiIG1heD0iMTIiIHdpZHRoPSI4LjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSIxMyIgbWF4PSIxMyIgd2lkdGg9IjE0LjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSIxNCIgbWF4PSIxNCIgd2lkdGg9IjEwLjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSIxNSIgbWF4PSIxNSIgd2lkdGg9IjEyLjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSIxNiIgbWF4PSIxNiIgd2lkdGg9IjE4LjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSIxNyIgbWF4PSIxNyIgd2lkdGg9IjEyLjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjxjb2wgbWluPSIxOCIgbWF4PSIxOCIgd2lkdGg9IjEyLjgzMjAzMTI1IiBjdXN0b21XaWR0aD0iMSIvPjwvY29scz48c2hlZXREYXRhPjxyb3cgcj0iMSI+PGMgcj0iQTEiIHQ9InN0ciI+PHY+QWxsIGluIE9uZSAtIEZPWENPTk4gfDwvdj48L2M+PGMgcj0iQjEiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJDMSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkQxIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iRTEiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJGMSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkcxIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iSDEiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJJMSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkoxIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iSzEiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJMMSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ik0xIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iTjEiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJPMSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IlAxIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iUTEiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJSMSIgdD0ic3RyIj48dj48L3Y+PC9jPjwvcm93Pjxyb3cgcj0iMiI+PGMgcj0iQTIiIHQ9InN0ciI+PHY+TW9kZWxvPC92PjwvYz48YyByPSJCMiIgdD0ic3RyIj48dj4jPC92PjwvYz48YyByPSJDMiIgdD0ic3RyIj48dj5FdmVudCBOYW1lPC92PjwvYz48YyByPSJEMiIgdD0ic3RyIj48dj5JbnB1dDwvdj48L2M+PGMgcj0iRTIiIHQ9InN0ciI+PHY+UmV0dXJuPC92PjwvYz48YyByPSJGMiIgdD0ic3RyIj48dj5RdHkgUGFzczwvdj48L2M+PGMgcj0iRzIiIHQ9InN0ciI+PHY+UXR5IEZhaWw8L3Y+PC9jPjxjIHI9IkgyIiB0PSJzdHIiPjx2PlF0eSBNYW51YWwgRmFpbDwvdj48L2M+PGMgcj0iSTIiIHQ9InN0ciI+PHY+UXR5IEF1dG8gRmFpbDwvdj48L2M+PGMgcj0iSjIiIHQ9InN0ciI+PHY+UXR5IFJldGVzdDwvdj48L2M+PGMgcj0iSzIiIHQ9InN0ciI+PHY+UXR5IEZyZXNoPC92PjwvYz48YyByPSJMMiIgdD0ic3RyIj48dj5RdHkgUk1BPC92PjwvYz48YyByPSJNMiIgdD0ic3RyIj48dj5GYWlsIFJldGVzdCBRdHk8L3Y+PC9jPjxjIHI9Ik4yIiB0PSJzdHIiPjx2PllpZWxkICglKTwvdj48L2M+PGMgcj0iTzIiIHQ9InN0ciI+PHY+Rmlyc3QgUGFzczwvdj48L2M+PGMgcj0iUDIiIHQ9InN0ciI+PHY+UmV0ZXN0IENhbGN1bGF0aW9uICglKTwvdj48L2M+PGMgcj0iUTIiIHQ9InN0ciI+PHY+UmV0ZXN0IDEgICglKTwvdj48L2M+PGMgcj0iUjIiIHQ9InN0ciI+PHY+UmV0ZXN0IDIgICglKTwvdj48L2M+PC9yb3c+PHJvdyByPSIzIj48YyByPSJBMyIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkIzIj48dj4yMDwvdj48L2M+PGMgcj0iQzMiIHQ9InN0ciI+PHY+U1QtTVAxPC92PjwvYz48YyByPSJEMyIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkUzIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iRjMiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJHMyIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkgzIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iSTMiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJKMyIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkszIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iTDMiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJNMyIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ik4zIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iTzMiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJQMyIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IlEzIiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iUjMiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJTMyIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IlQzIiB0PSJzdHIiPjx2Pjwvdj48L2M+PC9yb3c+PHJvdyByPSI0Ij48YyByPSJBNCIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkI0Ij48dj4zMDwvdj48L2M+PGMgcj0iQzQiIHQ9InN0ciI+PHY+U1QtTVAxMzwvdj48L2M+PGMgcj0iRDQiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJFNCIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkY0IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iRzQiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJINCIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ikk0IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iSjQiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJLNCIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ikw0IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iTTQiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJONCIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ik80IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iUDQiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJRNCIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IlI0IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iUzQiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJUNCIgdD0ic3RyIj48dj48L3Y+PC9jPjwvcm93Pjxyb3cgcj0iNSI+PGMgcj0iQTUiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJCNSI+PHY+NDA8L3Y+PC9jPjxjIHI9IkM1IiB0PSJzdHIiPjx2PlNULU1QOTwvdj48L2M+PGMgcj0iRDUiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJFNSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IkY1IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iRzUiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJINSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ikk1IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iSjUiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJLNSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ikw1IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iTTUiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJONSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9Ik81IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iUDUiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJRNSIgdD0ic3RyIj48dj48L3Y+PC9jPjxjIHI9IlI1IiB0PSJzdHIiPjx2Pjwvdj48L2M+PGMgcj0iUzUiIHQ9InN0ciI+PHY+PC92PjwvYz48YyByPSJUNSIgdD0ic3RyIj48dj48L3Y+PC9jPjwvcm93Pjwvc2hlZXREYXRhPjxpZ25vcmVkRXJyb3JzPjxpZ25vcmVkRXJyb3IgbnVtYmVyU3RvcmVkQXNUZXh0PSIxIiBzcXJlZj0iQTE6VDUiLz48L2lnbm9yZWRFcnJvcnM+PC93b3Jrc2hlZXQ+UEsDBBQAAAAAAAAAAAC4AB5MxwQAAMcEAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDIueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPHdvcmtzaGVldCB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3NwcmVhZHNoZWV0bWwvMjAwNi9tYWluIiB4bWxuczpyPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzIj48ZGltZW5zaW9uIHJlZj0iQTE6QTEyIi8+PHNoZWV0Vmlld3M+PHNoZWV0VmlldyB3b3JrYm9va1ZpZXdJZD0iMCIvPjwvc2hlZXRWaWV3cz48Y29scz48Y29sIG1pbj0iMSIgbWF4PSIxIiB3aWR0aD0iMjYuODMyMDMxMjUiIGN1c3RvbVdpZHRoPSIxIi8+PC9jb2xzPjxzaGVldERhdGE+PHJvdyByPSIxIj48YyByPSJBMSIgdD0ic3RyIj48dj5IRzhNMDE4MjQ1UTI8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iMiI+PGMgcj0iQTIiIHQ9InN0ciI+PHY+SEc4TTAxODI0NVFHMjM8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iMyI+PGMgcj0iQTMiIHQ9InN0ciI+PHY+SEc4TTgxNDVWNUcyMDE8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iNCI+PGMgcj0iQTQiIHQ9InN0ciI+PHY+SEc4TTgxNDVWNUcyNzA8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iNSI+PGMgcj0iQTUiIHQ9InN0ciI+PHY+SEc4TTgxNDVYNi0xMC1WMkcwMTwvdj48L2M+PC9yb3c+PHJvdyByPSI2Ij48YyByPSJBNiIgdD0ic3RyIj48dj5IRzhNODE0NVg2LTEwLVYyRzA1PC92PjwvYz48L3Jvdz48cm93IHI9IjciPjxjIHI9IkE3IiB0PSJzdHIiPjx2PkhHOE04MTQ1WDYtMTAtVjJHMDg8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iOCI+PGMgcj0iQTgiIHQ9InN0ciI+PHY+SEc4TTgyNDVRMkcxNTwvdj48L2M+PC9yb3c+PHJvdyByPSI5Ij48YyByPSJBOSIgdD0ic3RyIj48dj5IRzhNODI0NVEyRzI1PC92PjwvYz48L3Jvdz48cm93IHI9IjEwIj48YyByPSJBMTAiIHQ9InN0ciI+PHY+SEc4TTgyNDVXNS02VC1WMkcwMTwvdj48L2M+PC9yb3c+PHJvdyByPSIxMSI+PGMgcj0iQTExIiB0PSJzdHIiPjx2PkhHOE04MjQ1VzVHMzA8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iMTIiPjxjIHI9IkExMiIgdD0ic3RyIj48dj5IRzhNODI0NVc1RzMxPC92PjwvYz48L3Jvdz48L3NoZWV0RGF0YT48aWdub3JlZEVycm9ycz48aWdub3JlZEVycm9yIG51bWJlclN0b3JlZEFzVGV4dD0iMSIgc3FyZWY9IkExOkExMiIvPjwvaWdub3JlZEVycm9ycz48L3dvcmtzaGVldD5QSwMEFAAAAAAAAAAAAGCAAIGIAwAAiAMAAA8AAAB4bC9tZXRhZGF0YS54bWw8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8bWV0YWRhdGEgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6eGxyZD0iaHR0cDovL3NjaGVtYXMubWljcm9zb2Z0LmNvbS9vZmZpY2Uvc3ByZWFkc2hlZXRtbC8yMDE3L3JpY2hkYXRhIiB4bWxuczp4ZGE9Imh0dHA6Ly9zY2hlbWFzLm1pY3Jvc29mdC5jb20vb2ZmaWNlL3NwcmVhZHNoZWV0bWwvMjAxNy9keW5hbWljYXJyYXkiPgogIDxtZXRhZGF0YVR5cGVzIGNvdW50PSIxIj4KICAgIDxtZXRhZGF0YVR5cGUgbmFtZT0iWExEQVBSIiBtaW5TdXBwb3J0ZWRWZXJzaW9uPSIxMjAwMDAiIGNvcHk9IjEiIHBhc3RlQWxsPSIxIiBwYXN0ZVZhbHVlcz0iMSIgbWVyZ2U9IjEiIHNwbGl0Rmlyc3Q9IjEiIHJvd0NvbFNoaWZ0PSIxIiBjbGVhckZvcm1hdHM9IjEiIGNsZWFyQ29tbWVudHM9IjEiIGFzc2lnbj0iMSIgY29lcmNlPSIxIiBjZWxsTWV0YT0iMSIvPgogIDwvbWV0YWRhdGFUeXBlcz4KICA8ZnV0dXJlTWV0YWRhdGEgbmFtZT0iWExEQVBSIiBjb3VudD0iMSI+CiAgICA8Yms+CiAgICAgIDxleHRMc3Q+CiAgICAgICAgPGV4dCB1cmk9IntiZGJiOGNkYy1mYTFlLTQ5NmUtYTg1Ny0zYzNmMzBjMDI5YzN9Ij4KICAgICAgICAgIDx4ZGE6ZHluYW1pY0FycmF5UHJvcGVydGllcyBmRHluYW1pYz0iMSIgZkNvbGxhcHNlZD0iMCIvPgogICAgICAgIDwvZXh0PgogICAgICA8L2V4dExzdD4KICAgIDwvYms+CiAgPC9mdXR1cmVNZXRhZGF0YT4KICA8Y2VsbE1ldGFkYXRhIGNvdW50PSIxIj4KICAgIDxiaz4KICAgICAgPHJjIHQ9IjEiIHY9IjAiLz4KICAgIDwvYms+CiAgPC9jZWxsTWV0YWRhdGE+CjwvbWV0YWRhdGE+UEsDBBQAAAAAAAAAAACUW1oRgAEAAIABAAAPAAAAeGwvd29ya2Jvb2sueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPHdvcmtib29rIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvc3ByZWFkc2hlZXRtbC8yMDA2L21haW4iIHhtbG5zOnI9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMiPjx3b3JrYm9va1ByIGNvZGVOYW1lPSJUaGlzV29ya2Jvb2siLz48c2hlZXRzPjxzaGVldCBuYW1lPSJTaGVldDEiIHNoZWV0SWQ9IjEiIHI6aWQ9InJJZDEiLz48c2hlZXQgbmFtZT0iTW9kZWxvcyIgc2hlZXRJZD0iMiIgcjppZD0icklkMiIgc3RhdGU9ImhpZGRlbiIvPjwvc2hlZXRzPjwvd29ya2Jvb2s+UEsDBBQAAAAAAAAAAABKahH5TAIAAEwCAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJySWQyIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMvbWV0YWRhdGEvY29yZS1wcm9wZXJ0aWVzIiBUYXJnZXQ9ImRvY1Byb3BzL2NvcmUueG1sIi8+PFJlbGF0aW9uc2hpcCBJZD0icklkMyIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9leHRlbmRlZC1wcm9wZXJ0aWVzIiBUYXJnZXQ9ImRvY1Byb3BzL2FwcC54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL29mZmljZURvY3VtZW50IiBUYXJnZXQ9InhsL3dvcmtib29rLnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAAAAAAAAOhEyROAgAATgIAABAAAABkb2NQcm9wcy9hcHAueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPFByb3BlcnRpZXMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L2V4dGVuZGVkLXByb3BlcnRpZXMiIHhtbG5zOnZ0PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9kb2NQcm9wc1ZUeXBlcyI+PEFwcGxpY2F0aW9uPlNoZWV0SlM8L0FwcGxpY2F0aW9uPjxIZWFkaW5nUGFpcnM+PHZ0OnZlY3RvciBzaXplPSIyIiBiYXNlVHlwZT0idmFyaWFudCI+PHZ0OnZhcmlhbnQ+PHZ0Omxwc3RyPldvcmtzaGVldHM8L3Z0Omxwc3RyPjwvdnQ6dmFyaWFudD48dnQ6dmFyaWFudD48dnQ6aTQ+MjwvdnQ6aTQ+PC92dDp2YXJpYW50PjwvdnQ6dmVjdG9yPjwvSGVhZGluZ1BhaXJzPjxUaXRsZXNPZlBhcnRzPjx2dDp2ZWN0b3Igc2l6ZT0iMiIgYmFzZVR5cGU9Imxwc3RyIj48dnQ6bHBzdHI+U2hlZXQxPC92dDpscHN0cj48dnQ6bHBzdHI+TW9kZWxvczwvdnQ6bHBzdHI+PC92dDp2ZWN0b3I+PC9UaXRsZXNPZlBhcnRzPjwvUHJvcGVydGllcz5QSwMEFAAAAAAAAAAAANaSfBFaAQAAWgEAABEAAABkb2NQcm9wcy9jb3JlLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4NCjxjcDpjb3JlUHJvcGVydGllcyB4bWxuczpjcD0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9tZXRhZGF0YS9jb3JlLXByb3BlcnRpZXMiIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6ZGN0ZXJtcz0iaHR0cDovL3B1cmwub3JnL2RjL3Rlcm1zLyIgeG1sbnM6ZGNtaXR5cGU9Imh0dHA6Ly9wdXJsLm9yZy9kYy9kY21pdHlwZS8iIHhtbG5zOnhzaT0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEtaW5zdGFuY2UiLz5QSwMEFAAAAAAAAAAAAMd1yY2dCAAAnQgAABMAAABbQ29udGVudF9UeXBlc10ueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiIHhtbG5zOnhzZD0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEiIHhtbG5zOnhzaT0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEtaW5zdGFuY2UiPjxEZWZhdWx0IEV4dGVuc2lvbj0ieG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24veG1sIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJiaW4iIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQubXMtZXhjZWwuc2hlZXQuYmluYXJ5Lm1hY3JvRW5hYmxlZC5tYWluIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJ2bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQudm1sRHJhd2luZyIvPjxEZWZhdWx0IEV4dGVuc2lvbj0iZGF0YSIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5tb2RlbCtkYXRhIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJibXAiIENvbnRlbnRUeXBlPSJpbWFnZS9ibXAiLz48RGVmYXVsdCBFeHRlbnNpb249InBuZyIgQ29udGVudFR5cGU9ImltYWdlL3BuZyIvPjxEZWZhdWx0IEV4dGVuc2lvbj0iZ2lmIiBDb250ZW50VHlwZT0iaW1hZ2UvZ2lmIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJlbWYiIENvbnRlbnRUeXBlPSJpbWFnZS94LWVtZiIvPjxEZWZhdWx0IEV4dGVuc2lvbj0id21mIiBDb250ZW50VHlwZT0iaW1hZ2UveC13bWYiLz48RGVmYXVsdCBFeHRlbnNpb249ImpwZyIgQ29udGVudFR5cGU9ImltYWdlL2pwZWciLz48RGVmYXVsdCBFeHRlbnNpb249ImpwZWciIENvbnRlbnRUeXBlPSJpbWFnZS9qcGVnIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJ0aWYiIENvbnRlbnRUeXBlPSJpbWFnZS90aWZmIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJ0aWZmIiBDb250ZW50VHlwZT0iaW1hZ2UvdGlmZiIvPjxEZWZhdWx0IEV4dGVuc2lvbj0icGRmIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vcGRmIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJyZWxzIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLXBhY2thZ2UucmVsYXRpb25zaGlwcyt4bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC93b3JrYm9vay54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldC5tYWluK3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0iL3hsL3dvcmtzaGVldHMvc2hlZXQxLnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLndvcmtzaGVldCt4bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC93b3Jrc2hlZXRzL3NoZWV0Mi54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC53b3Jrc2hlZXQreG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIveGwvdGhlbWUvdGhlbWUxLnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC50aGVtZSt4bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC9zdHlsZXMueG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc3R5bGVzK3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0iL2RvY1Byb3BzL2NvcmUueG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLXBhY2thZ2UuY29yZS1wcm9wZXJ0aWVzK3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0iL2RvY1Byb3BzL2FwcC54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuZXh0ZW5kZWQtcHJvcGVydGllcyt4bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC9tZXRhZGF0YS54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldE1ldGFkYXRhK3htbCIvPjwvVHlwZXM+UEsBAgAAFAAAAAAAAAAAAPFhPCdCAwAAQgMAABoAAAAAAAAAAAAAAAAAAAAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAgAAFAAAAAAAAAAAADAPiGveHQAA3h0AABMAAAAAAAAAAAAAAAAAegMAAHhsL3RoZW1lL3RoZW1lMS54bWxQSwECAAAUAAAAAAAAAAAAVfQElFoEAABaBAAADQAAAAAAAAAAAAAAAACJIQAAeGwvc3R5bGVzLnhtbFBLAQIAABQAAAAAAAAAAAAkL2RvyREAAMkRAAAYAAAAAAAAAAAAAAAAAA4mAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwECAAAUAAAAAAAAAAAAuAAeTMcEAADHBAAAGAAAAAAAAAAAAAAAAAANOAAAeGwvd29ya3NoZWV0cy9zaGVldDIueG1sUEsBAgAAFAAAAAAAAAAAAGCAAIGIAwAAiAMAAA8AAAAAAAAAAAAAAAAACj0AAHhsL21ldGFkYXRhLnhtbFBLAQIAABQAAAAAAAAAAACUW1oRgAEAAIABAAAPAAAAAAAAAAAAAAAAAL9AAAB4bC93b3JrYm9vay54bWxQSwECAAAUAAAAAAAAAAAASmoR+UwCAABMAgAACwAAAAAAAAAAAAAAAABsQgAAX3JlbHMvLnJlbHNQSwECAAAUAAAAAAAAAAAAA6ETJE4CAABOAgAAEAAAAAAAAAAAAAAAAADhRAAAZG9jUHJvcHMvYXBwLnhtbFBLAQIAABQAAAAAAAAAAADWknwRWgEAAFoBAAARAAAAAAAAAAAAAAAAAF1HAABkb2NQcm9wcy9jb3JlLnhtbFBLAQIAABQAAAAAAAAAAADHdcmNnQgAAJ0IAAATAAAAAAAAAAAAAAAAAOZIAABbQ29udGVudF9UeXBlc10ueG1sUEsFBgAAAAALAAsAwQIAALRRAAAAAA==';
  var bin = atob(b64);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  var blob = new Blob([arr], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'OUTPUT_L10_HUAWEI_TEMPLATE.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast('✅ Template baixado! Preencha Qty Pass/Fail por modelo e estação.', 'ok');
}

/* ── Normaliza turno SHIFT → ºT ── */
function normTurnoHW(v) {
  if (!v) return '1ºT';
  var s = String(v).toUpperCase();
  if (s.indexOf('2')>-1 || s.indexOf('TARDE')>-1) return '2ºT';
  if (s.indexOf('3')>-1 || s.indexOf('NOITE')>-1) return '3ºT';
  return '1ºT';
}

/* ── adminGenerateHuawei ── */
function adminGenerateHuawei() {
  if (!RAW_HW.outL6) {
    showToast('⚠ Carregue pelo menos o Output L6 Huawei', 'err'); return;
  }
  /* Garante estruturas vazias para arquivos opcionais não carregados */
  if (!RAW_HW.outL10) RAW_HW.outL10 = { headers: [], rows: [] };
  if (!RAW_HW.defL6)  RAW_HW.defL6  = { headers: [], rows: [] };
  if (!RAW_HW.defL10) RAW_HW.defL10 = { headers: [], rows: [] };
  /* Cria estrutura vazia para falhas se não fornecidas */
  var EMPTY_DEF_L6 = { headers: RAW_HW.defL6 ? RAW_HW.defL6.headers :
    ['Serial','Work Order','Failure Code','Description','Line','Test station',
     'Failure date','Repair station','Reason Code','Description_1','Item'], rows: [] };
  var EMPTY_DEF_L10 = { headers: ['CT Number','Work Order','Código Falha','Descrição Categoria',
    'Linha Produção','Estação','Data Falha','Hora Falha','Estação Reparo','Código Categoria',
    'Comentário','Família','Turno Falha'], rows: [] };

  if (!RAW_HW.defL6)  RAW_HW.defL6  = EMPTY_DEF_L6;
  if (!RAW_HW.defL10) RAW_HW.defL10 = EMPTY_DEF_L10;
  var btnGo = document.getElementById('btnGo');
  if (btnGo) btnGo.disabled = true;
  showToast('⏳ Processando dados Huawei...', 'info');

  /* ── L6 Output: já é padrão Foxconn ── */
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

  /* ── Normaliza L10 Output → formato padrão ── */
  /* Prioridade de modelo: 1) coluna "Modelo" no arquivo, 2) ComboBox selecionado */
  var selectedModel = HW_SELECTED_MODEL || '';
  var outL10Norm = RAW_HW.outL10.rows.map(function(r){
    var inp  = parseFloat(String(r['Input']||0).replace(',','.'))||0;
    var pass = parseFloat(String(r['Qty Pass']||0).replace(',','.'))||0;
    var fail = parseFloat(String(r['Qty Fail']||0).replace(',','.'))||0;
    var fpRaw = String(r['First Pass']||'').replace('%','').replace(',','.').trim();
    var fp = parseFloat(fpRaw)||0;
    var rowModel = String(r['Modelo']||r['Model Name']||r['Model']||r['Família']||r['Familia']||selectedModel||'').trim();
    return {
      'Line':'L10', 'Work Order': '', 'Model Name': rowModel,
      'Model Serial': rowModel, 'Test station': String(r['Event Name']||'').trim(),
      'Placa Passou': pass, 'Placa Falhou': fail, 'Total': inp,
      'Defect Rate (%)':'', 'FPY (%)': Math.round(fp*100)
    };
  });

  /* ── Normaliza L10 Falhas → formato padrão ── */
  var defL10Norm = RAW_HW.defL10.rows.map(function(r){
    var dt = String(r['Data Falha']||'').trim();
    var hr = String(r['Hora Falha']||'').trim();
    // getShift precisa de " HH:MM:SS"
    var failDate = dt + ' ' + hr + ':00';
    return {
      'Serial':        String(r['CT Number']||r['Serial']||'').trim(),
      'Work Order':    String(r['Work Order']||'').trim(),
      'Failure Code':  String(r['Código Falha']||'').trim(),
      'Description':   String(r['Descrição Categoria']||'').trim(),
      'Line':          String(r['Linha Produção']||'').trim(),
      'Test station':  String(r['Estação']||'').trim(),
      'Failure date':  failDate,
      'Repair station':String(r['Estação Reparo']||'').trim(),
      'Reason Code':   String(r['Código Categoria']||'').trim(),
      /* Comentário: "U6M CURTO DE SOLDA" → Item="U6M", Description_1="CURTO DE SOLDA"
         Se vazio → Item="TBA", Description_1="TBA" (igual L6) */
      'Description_1': (function(){
        var comentario = String(r['Comentário']||r['Comentario']||'').trim();
        if (!comentario) return 'TBA';
        var spaceIdx = comentario.indexOf(' ');
        return spaceIdx > -1 ? comentario.slice(spaceIdx+1).trim() : 'TBA';
      })(),
      'Item': (function(){
        var comentario = String(r['Comentário']||r['Comentario']||'').trim();
        if (!comentario) return 'TBA';
        var spaceIdx = comentario.indexOf(' ');
        return spaceIdx > -1 ? comentario.slice(0, spaceIdx).trim() : comentario;
      })(),
      '_modelo':       String(r['Modelo']||r['Família']||r['Familia']||r['Sku']||r['Model Name']||selectedModel||'').trim(),
      '_turno':        normTurnoHW(r['Turno Falha'])
    };
  });

  /* ── Combina: L6 + L10 normalizados ── */
  var combinedOut = { headers: STD_HEADERS_OUT, rows: RAW_HW.outL6.rows.concat(outL10Norm) };

  /* Headers e rows do def: usa somente o que foi carregado
     - Só L6:  headers L6, rows L6
     - Só L10: headers normalizados (padrão L6), rows L10
     - Ambos:  concatena L6 + L10 */
  var hasDefL6  = RAW_HW.defL6  && RAW_HW.defL6.rows  && RAW_HW.defL6.rows.length  > 0;
  var hasDefL10 = RAW_HW.defL10 && RAW_HW.defL10.rows && RAW_HW.defL10.rows.length > 0;
  var STD_DEF_HEADERS = ['Serial','Work Order','Failure Code','Description','Line',
    'Test station','Failure date','Repair station','Reason Code','Description_1','Item','_modelo','_turno'];
  var defRows_L6  = hasDefL6  ? RAW_HW.defL6.rows  : [];
  var defRows_L10 = hasDefL10 ? defL10Norm         : [];
  var defHeaders  = STD_DEF_HEADERS;
  var combinedDef = { headers: defHeaders, rows: defRows_L6.concat(defRows_L10) };

  /* Injeta em RAW e chama run() padrão */
  RAW.out = combinedOut;
  RAW.def = combinedDef;

  /* Salva em RAW_CLIENTS */
  RAW_CLIENTS['huawei'] = {
    outL6:RAW_HW.outL6, defL6:RAW_HW.defL6, outL10:RAW_HW.outL10, defL10:RAW_HW.defL10,
    out: combinedOut, def: combinedDef
  };

  run().then(function(){
    showPublishBar();
    showToast('✅ Dashboard Huawei gerado!', 'ok');
    if (btnGo) btnGo.disabled = false;
  }).catch(function(e){
    showToast('⚠ Erro: '+e.message,'err');
    if (btnGo) btnGo.disabled = false;
  });
}

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
  return '<div class="up-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">' +

    /* Card 1: Output L6 */
    '<div class="ucard" id="c-as-outL6" onclick="document.getElementById(\'f-as-outL6\').click()">' +
      '<span class="un">01 · OUTPUT L6 · ASUS</span>' +
      '<span class="uico">📊</span>' +
      '<div class="utit">Output_ASUS_L6.xlsx</div>' +
      '<div class="usub">Line · Work Order · Model Name<br>Test station · Placa Passou · Total · FPY</div>' +
      '<input type="file" id="f-as-outL6" accept=".xlsx,.xls" onchange="loadAS(this,\'outL6\')"/>' +
      '<div class="ufile" id="n-as-outL6">Nenhum arquivo</div>' +
    '</div>' +

    /* Card 2: Falhas L6 — opcional */
    '<div class="ucard" id="c-as-defL6" onclick="document.getElementById(\'f-as-defL6\').click()">' +
      '<span class="un">02 · FALHAS L6 · ASUS · OPCIONAL</span>' +
      '<span class="uico">⚠️</span>' +
      '<div class="utit">Falhas_L6_ASUS.xlsx <span style="font-size:10px;color:var(--amber)">(opcional)</span></div>' +
      '<div class="usub">Serial · Work Order · Failure Code<br>Test station · Failure date · Item<br>' +
        '<span style="color:var(--t3)">Se não houver falhas L6, deixe em branco</span></div>' +
      '<input type="file" id="f-as-defL6" accept=".xlsx,.xls" onchange="loadAS(this,\'defL6\')"/>' +
      '<div class="ufile" id="n-as-defL6">Nenhum arquivo (zero defeitos)</div>' +
    '</div>' +

    /* Card 3: Output L10 */
    '<div class="ucard" id="c-as-outL10">' +
      '<span class="un">03 · OUTPUT L10 · ASUS · TUF + PRIME</span>' +
      '<span class="uico">📋</span>' +
      '<div class="utit">OUTPUT_L10_ASUS.xlsx</div>' +
      '<div class="usub">TUF: AVI · FT1 · FT2 · AUTO_OBA · AVIPK<br>PRIME: AVI · FT2 · AUTO_OBA · AVIPK<br>' +
        '<span style="color:var(--t3);font-size:9px">Primeira coluna = Modelo</span></div>' +
      '<div style="display:flex;gap:6px;margin-top:10px">' +
        '<button onclick="downloadAsusL10Template()" style="flex:1;background:rgba(0,185,174,0.1);border:1px solid #00B9AE;' +
          'color:#00B9AE;padding:5px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700">⬇ TEMPLATE</button>' +
        '<button onclick="document.getElementById(\'f-as-outL10\').click()" style="flex:1;background:rgba(255,255,255,0.05);' +
          'border:1px solid var(--ln2);color:var(--t1);padding:5px 8px;border-radius:5px;font-size:10px;cursor:pointer">📂 CARREGAR</button>' +
      '</div>' +
      '<input type="file" id="f-as-outL10" accept=".xlsx,.xls" onchange="loadAS(this,\'outL10\')"/>' +
      '<div class="ufile" id="n-as-outL10">Nenhum arquivo</div>' +
    '</div>' +

    /* Card 4: Falhas L10 — arquivo ASP */
    '<div class="ucard" id="c-as-defL10" onclick="document.getElementById(\'f-as-defL10\').click()">' +
      '<span class="un">04 · FALHAS L10 · ASUS · ASP · OPCIONAL</span>' +
      '<span class="uico">🔴</span>' +
      '<div class="utit">sfcmondailyfailurerpt.asp <span style="font-size:10px;color:var(--amber)">(opcional)</span></div>' +
      '<div class="usub">SYSSERIALNO · WORKORDERNO · DESCRIPTION<br>FAILUREEVENTPOINT · REPAIRCOMMENT<br>' +
        '<b>Formato HTML exportado do SFC</b><br>' +
        '<span style="color:var(--t3)">Se não houver falhas L10, deixe em branco</span></div>' +
      '<input type="file" id="f-as-defL10" accept=".asp,.html,.htm,.txt" onchange="loadAsusDefL10(this)"/>' +
      '<div class="ufile" id="n-as-defL10">Nenhum arquivo (zero defeitos)</div>' +
    '</div>' +

  '</div>';
}

/* ── Carrega arquivo ASUS (outL6, defL6, outL10) ── */
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
      var nEl = document.getElementById('n-as-' + key);
      var cEl = document.getElementById('c-as-' + key);
      var cnt = RAW_AS[key] ? RAW_AS[key].rows.length : 0;
      if (nEl) nEl.textContent = '✅ ' + file.name + ' — ' + cnt + ' registros';
      if (cEl) cEl.classList.add('done');
      RAW_CLIENTS['asus'] = RAW_CLIENTS['asus'] || {};
      RAW_CLIENTS['asus'][key] = RAW_AS[key];
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
      var nEl = document.getElementById('n-as-defL10');
      var cEl = document.getElementById('c-as-defL10');
      if (nEl) nEl.textContent = '✅ ' + file.name + ' — ' + rows.length + ' falhas';
      if (cEl) cEl.classList.add('done');
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

/* ── Separador Item / Description_1 do REPAIRCOMMENT ──
   Regras (ponto 8): primeiro espaço, " -" (espaço+traço), ou "-" (traço)
   Exemplos:
     "PMU1 DEFEITO ELÉTRICO"  → item=PMU1,  desc=DEFEITO ELÉTRICO
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

/* ── checkReady ASUS — só outL6 obrigatório ── */
function checkReadyAsus() {
  var ok = !!(RAW_AS.outL6 && RAW_AS.outL6.rows && RAW_AS.outL6.rows.length > 0);
  var btn = document.getElementById('btnGo');
  if (btn) btn.disabled = !ok;
  var hint = document.getElementById('hint');
  if (hint) {
    if (!ok) {
      hint.textContent = 'Aguardando Output L6 ASUS...';
    } else {
      var miss = [];
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
  if (!RAW_AS.outL6 || !RAW_AS.outL6.rows.length) {
    showToast('⚠ Carregue pelo menos o Output L6 ASUS', 'err'); return;
  }
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
      var desc      = String(r['DESCRIPTION'] || '').trim();
      var st        = String(r['FAILUREEVENTPOINT'] || '').trim();
      var dtFull    = String(r['FAILUREDATE'] || '').trim();
      var hr        = String(r['FAILURECHECKOUTTIME'] || '').trim();
      var failDate  = dtFull + ' ' + hr;
      var rcRaw     = String(r['REPAIRCOMMENT'] || '').trim();
      var noteRaw   = String(r['NOTE'] || '').trim();

      /* ── Regras NOTE / REPAIRCOMMENT ──
         A) REPAIRCOMMENT = NDF (qualquer posição):
            → NOTE em branco: noteVal = 'Screening'
            → NOTE preenchido: noteVal = noteRaw (mantém o que veio)
            → Item = 'Screening', Description_1 = 'Screening'
         B) REPAIRCOMMENT vazio:
            → Item = TBA, Description_1 = TBA
            → noteVal = noteRaw se preenchido, senão 'Sem Cadastro'
         C) REPAIRCOMMENT preenchido (sem NDF):
            → rc = parseRepairComment
            → noteVal = noteRaw se preenchido, senão 'Sem Cadastro' */
      var isNDF   = rcRaw.toUpperCase().indexOf('NDF') !== -1;
      var rcEmpty = (rcRaw === '');

      var rc, noteVal;
      if (isNDF) {
        rc = {item: 'Screening', desc: 'Screening'};
        noteVal = noteRaw !== '' ? noteRaw : 'Screening';
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
        '_turno':          '1ºT',
        '_desc_produto':   desc,
        '_eventpoint':     st
      });
    });
    return result;
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

  run().then(function() {
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
