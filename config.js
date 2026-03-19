/* ═══════════════════════════════════════════════════════════════
   CONFIG.JS — Configuração de clientes e estado global
   Dependências: utils.js
═══════════════════════════════════════════════════════════════ */

/* ── Estado global de dados ── */
var RAW    = { out: null, def: null };
var DATA   = {};
var CHARTS = {};

/* ── Configuração de estações por cliente ── */
var CLIENT_CFG = {
  acer: {
    matrix:    ['S_VI_B', 'S_VI_T', 'ICT', 'FBT', 'F1', 'F2'],
    smtSts:    ['S_VI_B', 'S_VI_T'],
    beSts:     ['ICT', 'FBT', 'F1', 'F2'],
    excludeSt: [],
    colors:    { 'S_VI_B': 'var(--cyan)', 'S_VI_T': 'var(--blue)', 'ICT': 'var(--red)', 'FBT': 'var(--amber)', 'F1': 'var(--green)', 'F2': 'var(--purple)' },
    groups:    { 'S_VI_B': 'SMT', 'S_VI_T': 'SMT', 'ICT': 'B.E', 'FBT': 'B.E', 'F1': 'B.E', 'F2': 'B.E' }
  },
  hp: {
    matrix:    ['S_VI_B', 'S_VI_T', 'FVI', 'ICT', 'FBT'],
    smtSts:    ['S_VI_B', 'S_VI_T', 'FVI'],
    beSts:     ['ICT', 'FBT'],
    excludeSt: ['FVI2'],
    colors:    { 'S_VI_B': 'var(--cyan)', 'S_VI_T': 'var(--blue)', 'FVI': 'var(--green)', 'ICT': 'var(--red)', 'FBT': 'var(--amber)' },
    groups:    { 'S_VI_B': 'SMT', 'S_VI_T': 'SMT', 'FVI': 'SMT', 'ICT': 'B.E', 'FBT': 'B.E' }
  },
  asus: {
    matrix:    ['S_VI_B', 'S_VI_T', 'ICT', 'FT1', 'FT2', 'FVI', 'PACK-QA'],
    smtSts:    ['S_VI_B', 'S_VI_T', 'ICT'],
    beSts:     ['FT1', 'FT2'],
    excludeSt: ['AVI', 'AUTO_OBA', 'AVIPK', 'R_S_VI_T', 'S_INPUT_B', 'S_INPUT_T', 'R_FVI', 'R_ICT', 'REPAIR'],
    colors:    { 'S_VI_B': 'var(--cyan)', 'S_VI_T': 'var(--blue)', 'ICT': 'var(--red)', 'FT1': 'var(--green)', 'FT2': 'var(--amber)', 'FVI': 'var(--purple)', 'PACK-QA': '#7c3aed' },
    groups:    { 'S_VI_B': 'SMT', 'S_VI_T': 'SMT', 'ICT': 'SMT', 'FT1': 'B.E', 'FT2': 'B.E', 'FVI': 'B.E', 'PACK-QA': 'B.E' }
  },
  huawei: {
    matrix:    ['S_VI_B', 'S_VI_T', 'PTH', 'FT2_MP1', 'ST-MP1', 'ST-MP13', 'ST-MP9'],
    smtSts:    ['S_VI_B', 'S_VI_T', 'PTH', 'FT2_MP1'],
    beSts:     ['ST-MP1', 'ST-MP13', 'ST-MP9'],
    excludeSt: [],
    colors:    { 'S_VI_B': 'var(--cyan)', 'S_VI_T': 'var(--blue)', 'PTH': 'var(--green)', 'FT2_MP1': 'var(--purple)', 'ST-MP1': 'var(--amber)', 'ST-MP13': 'var(--red)', 'ST-MP9': '#ff8c42' },
    groups:    { 'S_VI_B': 'SMT', 'S_VI_T': 'SMT', 'PTH': 'SMT', 'FT2_MP1': 'SMT', 'ST-MP1': 'B.E', 'ST-MP13': 'B.E', 'ST-MP9': 'B.E' }
  }
};

/* Fallback de cor/grupo para estações não mapeadas */
var MT_CLR = { 'S_VI_B': 'var(--cyan)', 'S_VI_T': 'var(--blue)', 'ICT': 'var(--red)', 'FBT': 'var(--amber)', 'F1': 'var(--green)', 'F2': 'var(--purple)', 'FVI': 'var(--green)' };
var MT_GRP = { 'S_VI_B': 'SMT', 'S_VI_T': 'SMT', 'ICT': 'B.E', 'FBT': 'B.E', 'F1': 'B.E', 'F2': 'B.E', 'FVI': 'SMT' };

/* Retorna config do cliente atual */
function getCfg() {
  return CLIENT_CFG[CURRENT_CLIENT] || CLIENT_CFG.acer;
}

/* ── Lista de clientes disponíveis no sistema ── */
var CLIENTS = [
  { id: 'acer',   label: 'ACER',   color: '#00d4ff' },
  { id: 'hp',     label: 'HP',     color: '#0096D6' },
  { id: 'huawei', label: 'HUAWEI', color: '#CF0A2C' },
  { id: 'asus',   label: 'ASUS',   color: '#00B9AE' }
];

/* ── Estado de sessão ── */
var IS_ADMIN          = false;
var CURRENT_CLIENT    = CLIENTS[0].id;
var ADMIN_CLIENT      = CLIENTS[0].id;
var RAW_CLIENTS       = {};
var CLIENT_CACHE      = {};
var AUTO_REFRESH_TMR  = null;
var ADMIN_FILTERS     = {};

/* ── Filtros de gráfico ── */
var CHART_FILTER     = { fd: null, itm: null };
var _chartRendering  = false;
var HOUR_FILTER      = null;

/* ── Monitor ── */
var MONITOR_CHART    = null;
var WATERFALL_CHART  = null;
var M_LAST_SER       = '';

/* ── Slideshow (modo fullscreen) ── */
var SLIDESHOW_TMR    = null;
var SLIDESHOW_TICK   = null;
var SLIDESHOW_ACTIVE = false;
var SLIDESHOW_IDX    = 0;
var SLIDESHOW_SECS   = 50;

/* ── Relógio no header ── */
setInterval(function() {
  var n = new Date(), el = document.getElementById('htime');
  if (el) el.textContent = n.toLocaleDateString('pt-BR') + ' ' + n.toLocaleTimeString('pt-BR');
}, 1000);

/* Label de cliente por id */
function c_label(id) {
  var c = CLIENTS.find(function(x) { return x.id === id; });
  return c ? c.label : id.toUpperCase();
}
