/* ═══════════════════════════════════════════════════════════════
   RUN.JS — Pipeline principal de processamento e exibição
   Dependências: utils.js, config.js, parser.js, filters.js, charts.js
═══════════════════════════════════════════════════════════════ */

async function run() {
  setStatus('warn', 'Processando...');
  show('ldZone'); hide('dash'); hide('errBox');
  try {
    await step('Mapeando colunas OUT...', 80);

    /* ── Mapa de colunas OUT (PT e EN) ── */
    var oh = RAW.out.headers;
    var O = {
      linha:  colN(oh, ['Line', 'Linha', 'Linha de Produção', 'Production Line']),
      wo:     colN(oh, ['Work Order', 'Ordem de Trabalho', 'WO']),
      modelo: colN(oh, ['Model Name', 'Model name', 'Nome do Modelo', 'Modelo', 'Model']),
      serial: colN(oh, ['Model Serial', 'Model serial', 'Serial do Modelo', 'Serial', 'SKU']),
      st:     colN(oh, ['Test station', 'Test Station', 'Estação de Teste', 'Estação', 'Station']),
      pass:   colN(oh, ['Placa Passou', 'Board Pass', 'Pass', 'Passou', 'Qty Pass', 'QTY Pass']),
      fail:   colN(oh, ['Placa Falhou', 'Board Fail', 'Fail', 'Falhou', 'Qty Fail', 'QTY Fail']),
      total:  colN(oh, ['Total', 'Total Input', 'Input', 'Qty Total']),
      fpy:    colN(oh, ['FPY (%)', 'FPY', 'First Pass Yield', 'First Pass', 'Yield (%)'])
    };

    await step('Mapeando colunas FALHAS...', 80);

    /* ── Mapa de colunas FALHAS ── */
    var fh = RAW.def.headers;
    var F = {
      serial:   colN(fh, ['Serial', 'Serial Number', 'CT Number', 'SN', 'Número Serial']),
      wo:       colN(fh, ['Work Order', 'WO', 'Ordem de Trabalho']),
      failCode: colN(fh, ['Failure Code', 'Código Falha', 'Fail Code', 'Código de Falha']),
      descTec:  colN(fh, ['Description', 'Descrição', 'Desc', 'Descrição Técnica', 'Descrição Categoria']),
      linha:    colN(fh, ['Line', 'Linha', 'Linha de Produção', 'Production Line']),
      st:       colN(fh, ['Test station', 'Test Station', 'Estação de Teste', 'Estação', 'Station']),
      failDate: colN(fh, ['Failure date', 'Failure Date', 'Data Falha', 'Data de Falha', 'Date']),
      repSt:    colN(fh, ['Repair station', 'Repair Station', 'Estação Reparo', 'Repair']),
      reason:   colN(fh, ['Reason Code', 'Código Categoria', 'Reason', 'Motivo']),
      failDesc: colN(fh, ['Description_1', 'Fail Description', 'Fail Reason', 'Descrição Falha', 'Comentário', 'Comentario', 'Fail Desc']),
      item:     colN(fh, ['Item', 'Componente', 'Component', 'Part'])
    };

    await step('Agregando dados...', 100);

    var outRows = RAW.out.rows, defRows = RAW.def.rows;

    /* ── REGRA: NDF / Placa Lavada → Screening Input BE ── */
    defRows.forEach(function(r) {
      var jVal = S(r[F.failDesc]).toUpperCase().trim();
      if (jVal === 'NDF' || jVal.indexOf('NDF') !== -1 || jVal.indexOf('PLACA LAVADA') !== -1) {
        r[F.descTec] = 'Screening Input BE';
      }
    });

    /* ── REGRA HP: CONTAMINAÇÃO → Screening no Fail Description ── */
    if (CURRENT_CLIENT === 'hp') {
      defRows.forEach(function(r) {
        /* 'CONTAMINA' e ASCII puro - encontra CONTAMINACAO independente de encoding */
        var found = Object.keys(r).some(function(k) {
          return String(r[k] == null ? '' : r[k]).toUpperCase().indexOf('CONTAMINA') !== -1;
        });
        if (found) {
          r[F.descTec] = 'Screening Input BE';
        }
      });
    }

    /* ── REGRA ACER / HP: serial repetido → mantém só a penúltima ocorrência ── */
    if (CURRENT_CLIENT === 'acer' || CURRENT_CLIENT === 'hp') {
      var _serIdx = {};
      defRows.forEach(function(r, i) {
        var s = S(r[F.serial]);
        if (!s) return;
        if (!_serIdx[s]) _serIdx[s] = [];
        _serIdx[s].push(i);
      });
      var _keepSet = {};
      Object.keys(_serIdx).forEach(function(s) {
        var idxs = _serIdx[s];
        // serial único → mantém; repetido → pega penúltimo (length-2)
        _keepSet[idxs.length === 1 ? idxs[0] : idxs[idxs.length - 2]] = true;
      });
      defRows = defRows.filter(function(r, i) {
        var s = S(r[F.serial]);
        if (!s || s === '') return true; // sem serial → mantém
        return !!_keepSet[i];
      });
    }

    /* ── WO → modelo/linha (join para tabela pareto) ── */
    var woMap = {};
    outRows.forEach(function(r) {
      var wo = S(r[O.wo]);
      if (wo && !woMap[wo]) woMap[wo] = { modelo: S(r[O.modelo]), serial: S(r[O.serial]), linha: S(r[O.linha]) };
    });

    /* ── Agrega OUT: soma coluna "Total" por estação ── */
    var stOut = {};
    outRows.forEach(function(r) {
      var st = S(r[O.st]) || 'N/A';
      if (!stOut[st]) stOut[st] = { total: 0, pass: 0, fail: 0 };
      stOut[st].total += N(r[O.total]);
      stOut[st].pass  += N(r[O.pass]);
      stOut[st].fail  += N(r[O.fail]);
    });
    if (CURRENT_CLIENT === 'asus' && stOut['AVIPK']) {
      stOut['PACK-QA'] = { total: stOut['AVIPK'].total, pass: stOut['AVIPK'].pass, fail: stOut['AVIPK'].fail };
    }

    /* ── Agrega FALHAS por estação ── */
    var stDef = {};
    defRows.forEach(function(r) { var st = S(r[F.st]) || 'N/A'; stDef[st] = (stDef[st] || 0) + 1; });

    await step('Calculando yields DAX...', 80);

    /* ── Cálculo de parciais e overall ── */
    function parcial(st) { var d = stDef[st] || 0, t = stOut[st] ? stOut[st].total : 0; return t === 0 ? null : 1 - d / t; }
    function prodX(vals) { var v = vals.filter(function(x) { return x !== null && x > 0; }); return v.length ? v.reduce(function(a, x) { return a * x; }, 1) : null; }

    var _cfg   = getCfg();
    var oSMT   = prodX(_cfg.smtSts.map(function(s) { return parcial(s); }));
    var oBE    = prodX(_cfg.beSts.map(function(s)  { return parcial(s); }));
    var overal = prodX([oSMT, oBE]);
    var perda  = overal !== null ? 1 - overal : null;
    var totF   = defRows.length;
    var pack   = stOut['PACKING'] ? stOut['PACKING'].total : 0;

    /* ── Agrega failDesc para IA (stub) ── */
    var fdAgg = {};
    defRows.forEach(function(r) { var v = S(r[F.failDesc]) || 'TBA'; fdAgg[v] = (fdAgg[v] || 0) + 1; });

    /* ── Opções para filtros multi-select ── */
    var opts = {
      wo:  uniq(outRows.map(function(r) { return S(r[O.wo]); }).concat(defRows.map(function(r) { return S(r[F.wo]); }))).filter(Boolean).sort(),
      mod: uniq(outRows.map(function(r) { return S(r[O.modelo]); }).concat(
        defRows.map(function(r) { var wo = S(r[F.wo]); return (woMap[wo] && woMap[wo].modelo) ? woMap[wo].modelo : (S(r['_modelo']) || ''); })
      )).filter(Boolean).sort(),
      ser: uniq(outRows.map(function(r) { return S(r[O.serial]); })).filter(Boolean).sort(),
      lin: uniq(outRows.map(function(r) { return S(r[O.linha]); })).sort(),
      st:  uniq(outRows.map(function(r) { return S(r[O.st]); }).concat(defRows.map(function(r) { return S(r[F.st]); }))).filter(Boolean).sort(),
      fd:  uniq(defRows.map(function(r) { return S(r[F.failDesc]) || 'TBA'; })).sort(),
      itm: uniq(defRows.map(function(r) { return S(r[F.item]) || 'TBA'; })).sort(),
      dtc: uniq(defRows.map(function(r) { var v = S(r[F.descTec]); return v && v !== 'Sem Cadastro' ? v : ''; })).filter(Boolean).sort()
    };

    DATA = {
      outRows: outRows, defRows: defRows, woMap: woMap, O: O, F: F,
      stOut: stOut, stDef: stDef,
      oSMT: oSMT, oBE: oBE, overal: overal, perda: perda,
      totF: totF, pack: pack, fdAgg: fdAgg, _opts: opts,
      _packTotal:    pack,
      _rawOutRows:   outRows,
      _rawDefRows:   defRows,
      defRowsKpi:    defRows,
      _dropDefRows:  defRows
    };

    await step('Construindo filtros...', 80);
    buildMultiSelect('ms-wo',  'wo',  opts.wo,  'Todos');
    buildMultiSelect('ms-mod', 'mod', opts.mod, 'Todos');
    buildMultiSelect('ms-ser', 'ser', opts.ser, 'Todos');
    buildMultiSelect('ms-lin', 'lin', opts.lin, 'Todas');
    buildMultiSelect('ms-st',  'st',  opts.st,  'Todas');
    buildMultiSelect('ms-fd',  'fd',  opts.fd,  'Todas');
    buildMultiSelect('ms-itm', 'itm', opts.itm, 'Todos');
    buildMultiSelect('ms-dtc', 'dtc', opts.dtc, 'Todas');
    buildMultiSelect('ms-trn', 'trn', ['1ºT', '2ºT', '3ºT'], 'Todos');

    await step('Renderizando...', 150);
    render(DATA);

    hide('ldZone'); hide('upZone'); show('dash');
    if (typeof buildClientTabs === 'function') buildClientTabs();
    var hb = document.getElementById('hBtnUpload'); if (hb) hb.style.display = '';
    setStatus('on', 'Dashboard ativo');
    var _fpb = document.getElementById('fixedPublishBtn'); if (_fpb) _fpb.style.display = 'none';
  } catch (err) {
    hide('ldZone');
    showErr('Erro: ' + err.message);
    console.error('[run]', err);
  }
}
