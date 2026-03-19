/* ═══════════════════════════════════════════════════════════════
   SUPABASE.JS — Integração Supabase, Admin, Publicação, Slideshow
   Dependências: utils.js, config.js, filters.js, run.js

   ⚠ SEGURANÇA: As credenciais abaixo ficam expostas no frontend.
     Configure Row Level Security (RLS) no Supabase para proteger os dados.
     Idealmente, use um backend proxy que nunca exponha a chave ao cliente.
═══════════════════════════════════════════════════════════════ */
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


