/* ═══════════════════════════════════════════════════════════════
   UTILS.JS — Funções utilitárias compartilhadas
   Dependências: nenhuma (carregado primeiro)
═══════════════════════════════════════════════════════════════ */

/* ── Conversão e formatação ── */
function S(v)   { return String(v === null || v === undefined ? '' : v).trim(); }
function N(v)   { var n = parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; }
function fmt(v) { return Math.round(v).toLocaleString('pt-BR'); }
function pct(v) { return (v !== null && v !== undefined) ? (v * 100).toFixed(2) + '%' : 'N/A'; }
function uniq(a){ return a.filter(function(v, i, s) { return v && s.indexOf(v) === i; }); }
function escAttr(s) { return String(s).replace(/'/g, "&#39;").replace(/"/g, '&quot;'); }

/* ── DOM helpers ── */
function show(id) { var el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; }

/* ── Loading step ── */
function step(msg, ms) {
  var el = document.getElementById('lstep');
  if (el) el.textContent = msg;
  return new Promise(function(r) { setTimeout(r, ms); });
}

/* ── Status dot ── */
function setStatus(t, txt) {
  var dot = document.getElementById('sdot');
  var stxt = document.getElementById('stxt');
  if (dot)  dot.className = 'dot' + (t ? ' ' + t : '');
  if (stxt) stxt.textContent = txt;
}

/* ── Error box ── */
function showErr(m) {
  var b = document.getElementById('errBox');
  if (b) { b.style.display = ''; b.textContent = '⚠ ' + m; }
}

/* ── Toast notification ── */
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
  var colors = { ok: 'rgba(0,180,80,0.92)', err: 'rgba(255,60,90,0.92)', info: 'rgba(0,160,255,0.92)' };
  t.style.opacity = '1';
  t.style.background = colors[type] || colors.info;
  t.style.color = '#fff';
  t.textContent = msg;
  clearTimeout(t._tmr);
  t._tmr = setTimeout(function() { t.style.opacity = '0'; }, 4000);
}

/* ── Typewriter animation ── */
async function typeText(el, txt) {
  var words = txt.split(' '), cur = '';
  for (var i = 0; i < words.length; i++) {
    cur += (i ? ' ' : '') + words[i];
    el.textContent = cur;
    if (i % 15 === 0) await new Promise(function(r) { setTimeout(r, 5); });
  }
}

/* ── Cálculo de turno a partir da data de falha ── */
function getShift(raw) {
  var m = (raw || '').match(/\s(\d{1,2}):(\d{2}):/);
  var h = m ? parseInt(m[1]) : 0, mi = m ? parseInt(m[2]) : 0;
  var mins = h * 60 + mi;
  if (mins >= 360 && mins < 948)   return '1ºT';
  if (mins >= 948 || mins < 69)    return '2ºT';
  return '3ºT';
}

/* ── Busca coluna por nome (PT ou EN) nos headers ── */
function colN(headers, cands) {
  var low = headers.map(function(h) { return h.toLowerCase().trim(); });
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i].toLowerCase().trim();
    var idx = low.indexOf(c);
    if (idx === -1) for (var k = 0; k < low.length; k++) { if (low[k].indexOf(c) !== -1) { idx = k; break; } }
    if (idx !== -1) return headers[idx];
  }
  return headers[0];
}

/* ── Thresholds centralizados — altere aqui para mudar metas em todo o dashboard ── */
var THRESH = {
  green:  0.99,   /* ≥ 99% → verde     */
  warn:   0.98,   /* ≥ 98% → amarelo piscando  */
  amber:  0.95,   /* ≥ 95% → amarelo normal    */
  target: 99
};
