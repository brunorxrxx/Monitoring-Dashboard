/* ═══════════════════════════════════════════════════════════════
   HUAWEI.JS — Pipeline HUAWEI (4 arquivos: L6 e L10)
   Dependências: utils.js, config.js, parser.js, run.js, supabase.js
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
  var btnTemplate =
    '<button onclick="downloadL10Template()" style="flex:1;background:rgba(30,58,95,0.1);border:1px solid var(--cyan);' +
    'color:var(--cyan);padding:5px 10px;border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;">⬇ TEMPLATE</button>' +
    '<button onclick="document.getElementById(\'f-hw-outL10\').click()" style="flex:1;background:rgba(255,255,255,0.06);' +
    'border:1px solid var(--ln2);color:var(--t1);padding:5px 10px;border-radius:6px;font-size:10px;cursor:pointer;">📂 CARREGAR</button>';

  return '<div class="up-grid hw-grid">' +
    buildUploadCard({id:'c-hw-outL6', badge:'01 · OUTPUT L6 · HUAWEI',
      title:'Output_huawei_L6.xlsx',
      subtitle:'Line · Work Order · Model Name · Model Serial<br>Test station · Placa Passou · Placa Falhou · Total · FPY (%)',
      fileId:'f-hw-outL6', accept:'.xlsx,.xls', onChange:'loadHW(this,\'outL6\')',
      iconType:'default'
    }) +
    buildUploadCard({id:'c-hw-defL6', badge:'02 · FALHAS L6 · HUAWEI',
      title:'Falhas_L6_HUAWEI.xlsx',
      subtitle:'Serial · Work Order · Failure Code · Description<br>Test station · Failure date · Item',
      fileId:'f-hw-defL6', accept:'.xlsx,.xls', onChange:'loadHW(this,\'defL6\')',
      optional:true, iconType:'warning', dragText:'Opcional — arraste ou clique'
    }) +
    buildUploadCard({id:'c-hw-outL10', badge:'03 · OUTPUT L10 · HUAWEI',
      title:'OUTPUT_L10_HUAWEI.xlsx',
      subtitle:'ST-MP1 · ST-MP13 · ST-MP9<br>Input · Qty Pass · Qty Fail · First Pass',
      fileId:'f-hw-outL10', accept:'.xlsx,.xls', onChange:'loadHW(this,\'outL10\')',
      iconType:'template', extraBtns:btnTemplate, dragText:'Baixe o template, preencha e carregue'
    }) +
    buildUploadCard({id:'c-hw-defL10', badge:'04 · FALHAS L10 · HUAWEI',
      title:'Falhas_L10_HUAWEI.xls',
      subtitle:'SYSSERIALNO · WORKORDERNO · DESCRIPTION<br>FAILUREEVENTPOINT · REPAIRCOMMENT<br><b>Formato HTML exportado do SFC</b>',
      fileId:'f-hw-defL10', accept:'.xls,.xlsx,.html,.htm', onChange:'loadHWDefL10(this)',
      optional:true, iconType:'warning', dragText:'Opcional — arquivo .xls ou HTML do SFC'
    }) +
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
      if (nEl) nEl.textContent = '✅ '+file.name+' — '+rows.length+' registros';
      if (typeof ucardLoaded !== 'undefined') ucardLoaded('c-hw-'+key, 'f-hw-'+key, file.name, rows.length);
      else if (cEl) cEl.classList.add('done');
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
      if (nEl) nEl.textContent = '✅ '+file.name+' — '+rows.length+' registros';
      if (typeof ucardLoaded !== 'undefined') ucardLoaded('c-hw-defL10', 'f-hw-defL10', file.name, rows.length);
      else if (cEl) cEl.classList.add('done');
      checkReady();
    } catch(err) {
      if (nEl) { nEl.style.color='#ff3d5a'; nEl.textContent='❌ Erro: '+err.message; }
    }
  };
  reader.readAsArrayBuffer(file);
}



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

  /* Sincroniza CURRENT_CLIENT para que switchClient salve RAW.out no cliente correto */
  CURRENT_CLIENT = 'huawei';
  ADMIN_CLIENT   = 'huawei';

  run().then(function(){
    buildClientTabs(); /* ressincroniza aba ativa com CURRENT_CLIENT */
    showPublishBar();
    showToast('✅ Dashboard Huawei gerado!', 'ok');
    if (btnGo) btnGo.disabled = false;
  }).catch(function(e){
    showToast('⚠ Erro: '+e.message,'err');
    if (btnGo) btnGo.disabled = false;
  });
}

/* ── checkReady dispatcher — sem recursão, sem _origCheckReady ── */
/* Sobreescreve as versões de parser.js e supabase.js com um único ponto de entrada */
function checkReady() {
  if (typeof ADMIN_CLIENT !== 'undefined' && ADMIN_CLIENT === 'asus') {
    checkReadyAsus();
    return;
  }
  if (typeof ADMIN_CLIENT !== 'undefined' && ADMIN_CLIENT === 'huawei') {
    var ok = !!(RAW_HW.outL6);
    var btn = document.getElementById('btnGo');
    if (btn) {
      btn.disabled = !ok;
      btn.style.opacity = ok ? '1' : '0.4';
      btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
    }
    var hint = document.getElementById('hint');
    if (hint) {
      if (!ok) {
        hint.textContent = 'Aguardando: Output L6 Huawei (obrigatório)';
      } else {
        var noFiles = [];
        if (!RAW_HW.outL10) noFiles.push('Output L10');
        if (!RAW_HW.defL6)  noFiles.push('Falhas L6');
        if (!RAW_HW.defL10) noFiles.push('Falhas L10');
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
  /* Acer / HP — usa versão padrão do supabase.js */
  checkReadyDefault();
}
