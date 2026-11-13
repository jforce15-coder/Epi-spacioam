/* ═══ REVERTIR EL PAGO EN LOTE DEL 8-NOV-2026 (una sola vez) ═════════════════════════════════════════════════════
   El domingo 8-nov a las 20:34:25 (Guatemala) se tocó «✓ Marcar todos como pagados» sin rango de fechas: salieron 10
   comprobantes (CP-2026-0199 a CP-2026-0208, tipo «lote») con 98 trabajos, incluidos trabajos viejos y uno posterior.
   Juan decidió (13-nov):
     · Se anulan SOLO los comprobantes del lote que no tienen el depósito cargado (campo «soporte» vacío). Si el
       comprobante tiene su depósito, ese pago sí se hizo: se queda tal cual, con sus trabajos pagados y sus adelantos.
       Cuenta como depósito cargado cualquier archivo adjunto (URL en Drive, base64 o el nombre del archivo que no
       alcanzó a subir): ante la duda, se respeta el pago.
   Qué hace, en este orden (con el candado del script):
     1. Identifica el lote por createdAt (dentro del segundo 20:34:25), generadoPor y tipo. Tienen que ser exactamente
        los 10 folios esperados (contando los que ya estén en «pagos_anulados» por una corrida anterior) o no toca nada.
     2. Copia de respaldo ANTES de cambiar nada: pestaña «Respaldo reversión 2026-11-08» con las filas de Reportes de
        los 98 trabajos tal como estaban y el JSON de los 10 comprobantes.
     3. Pone paid = false en los trabajos de los comprobantes que se anulan y que sigan pagados. No toca «total».
        Se salta los que ya estén en otro comprobante vigente (se volvieron a pagar después).
     4. Guarda esos comprobantes en «pagos_anulados» (con anuladoEn, motivo y anuladoPor) y los saca de «pagos»,
        «pagos_2»… (saveConfigPlano_: candado de dinero + copia en Config_historial).
     5. Adelantos: la cuota semanal se calcula sola con los trabajos (una semana cobra si TODOS sus trabajos quedaron
        pagados), así que al volver a pendiente esos trabajos la cuota de esa semana deja de contar sola. Lo único
        guardado que hay que deshacer es el cierre automático: si un adelanto de esas personas se cerró («pagado») desde
        el 8-nov, se reabre; si de verdad ya estaba saldado, el app lo vuelve a cerrar sola.
     6. Una fila en Bitacora con el resumen (folios y totales, sin nombres).
   Corre sola una vez (propiedad EPI_REVERTIR_LOTE_20261108) desde getConfig (cada apertura del app) y desde
   cronSyncReservas (cada 3 h); también a mano: revertirLote20261108(). Si el lote no cuadra, no toca nada, lo anota en
   la Bitacora y en la propiedad («abortado: …») y ya no lo reintenta solo. */

var RL8_PROP_ = 'EPI_REVERTIR_LOTE_20261108';
var RL8_DESDE_ = 1794191665000, RL8_HASTA_ = 1794191666000;   // el segundo 2026-11-08 20:34:25 (GMT-6)
var RL8_POR_ = 'Juan Ovalle';
var RL8_FOLIOS_ = ['CP-2026-0199', 'CP-2026-0200', 'CP-2026-0201', 'CP-2026-0202', 'CP-2026-0203',
                   'CP-2026-0204', 'CP-2026-0205', 'CP-2026-0206', 'CP-2026-0207', 'CP-2026-0208'];
var RL8_HOJA_ = 'Respaldo reversión 2026-11-08';
var RL8_MOTIVO_ = 'Pago en lote por error del 8-nov; revertido a pedido de Juan';
var RL8_QUIEN_ = 'Claude a pedido de Juan';
var RL8_MARCA_ = '20261108';
var RL8_RX_PAGOS_ = /^pagos(_\d+)?$/;

function revertirLote20261108() { var r = revertirLote20261108_(true); Logger.log(JSON.stringify(r, null, 2)); return r; }

function revertirLote20261108_(aMano) {
  var P = PropertiesService.getScriptProperties();
  if (!aMano && P.getProperty(RL8_PROP_)) return { ok: true, ya: true };
  /* Desde getConfig: si un intento falló, no se vuelve a intentar en 10 min (no frena cada apertura de la app). */
  if (!aMano && Date.now() - Number(P.getProperty('EPI_REVERTIR_LOTE_INTENTO') || 0) < 600000) return { ok: false, espera: true };
  P.setProperty('EPI_REVERTIR_LOTE_INTENTO', String(Date.now()));
  var lock = LockService.getScriptLock(); if (!lock.tryLock(aMano ? 20000 : 5000)) return { ok: false, error: 'ocupado' };
  try {
    if (!aMano && P.getProperty(RL8_PROP_)) return { ok: true, ya: true };
    var r = rl8Correr_();
    if (r.ok || r.abortado) P.setProperty(RL8_PROP_, (r.ok ? '' : 'abortado: ' + r.error + ' · ') + new Date().toISOString());
    if (r.abortado) { try { bitLog_('error', 'No se revirtió el pago en lote del 8-nov: ' + r.error + '. No se tocó nada.', RL8_QUIEN_); } catch (e) {} }
    console.log('revertirLote20261108_: ' + JSON.stringify(r));
    return r;
  } catch (e) { console.error('revertirLote20261108_: ' + e); return { ok: false, error: String(e && e.message || e) }; }
  finally { lock.releaseLock(); }
}

/* ── La corrida (ya con el candado tomado). ── */
function rl8Correr_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var cfgSh = ss.getSheetByName('Config'); if (!cfgSh) return { ok: false, abortado: true, error: 'no existe la hoja Config' };
  var cfgVals = cfgSh.getDataRange().getValues();

  /* Los campos del historial de pagos y la lista de anulados. Una celda rota = no se toca nada. */
  var shards = [], anulados = [];
  for (var i = 0; i < cfgVals.length; i++) {
    var k = String(cfgVals[i][0] || '');
    if (!RL8_RX_PAGOS_.test(k) && k !== 'pagos_anulados') continue;
    var raw = cfgVals[i][1], arr;
    if (raw === '' || raw === null || raw === undefined) arr = [];
    else { try { arr = JSON.parse(String(raw)); } catch (e) { return { ok: false, abortado: true, error: 'la celda «' + k + '» no es JSON' }; } }
    if (!Array.isArray(arr)) return { ok: false, abortado: true, error: '«' + k + '» no es una lista' };
    if (k === 'pagos_anulados') anulados = arr; else shards.push({ key: k, lista: arr });
  }

  var plan = rl8Plan_(shards, anulados);
  if (plan.error) return { ok: false, abortado: true, error: plan.error };
  if (!plan.anular.length && !plan.quitarDeShards.length) {
    return { ok: true, ya: true, respetados: plan.respetar.map(function (p) { return p.folio; }), nota: 'no quedaba nada por anular' };
  }

  /* Reportes: las filas de los trabajos del lote. */
  var rep = ss.getSheetByName('Reportes'); if (!rep) return { ok: false, abortado: true, error: 'no existe la hoja Reportes' };
  var nRep = rep.getLastRow() - 1;
  var colPaid = COLS.indexOf('paid');
  var anchoRep = Math.min(COLS.length, Math.max(rep.getLastColumn(), colPaid + 1));
  var filas = nRep > 0 ? rep.getRange(2, 1, nRep, anchoRep).getValues() : [];
  filas.forEach(function (f) { while (f.length < COLS.length) f.push(''); });
  var porId = {};
  filas.forEach(function (f, j) { var id = rl8Id_(f[0]); if (id && porId[id] == null) porId[id] = j; });

  /* Qué trabajo se revierte y por qué no los demás. */
  var decision = {}, aRevertir = [];
  plan.lote.forEach(function (p) {
    var anula = !!plan.anulaId[String(p.id)];
    rl8Trabajos_(p).forEach(function (t) {
      var id = rl8Id_(t.repId); if (!id || decision[id]) return;
      var j = porId[id], motivo;
      if (j == null) motivo = 'no: no está en Reportes';
      else if (!anula) motivo = plan.yaAnuladoId[String(p.id)] ? 'no: comprobante ya anulado antes' : 'no: el comprobante tiene depósito';
      else if (plan.pagadoEnOtro[id]) motivo = 'no: pagado en otro comprobante';
      else if (!rl8EsTrue_(filas[j][colPaid])) motivo = 'no: ya estaba pendiente';
      else { motivo = 'sí'; aRevertir.push(j); }
      decision[id] = { j: j, motivo: motivo, folio: p.folio };
    });
  });

  /* 1 · Respaldo ANTES de cambiar nada. */
  var ahora = new Date(), cuando = Utilities.formatDate(ahora, 'GMT-6', 'yyyy-MM-dd HH:mm:ss');
  var bloqueTrab = [], bloqueComp = [];
  Object.keys(decision).forEach(function (id) {
    var d = decision[id];
    var fila = d.j == null ? COLS.map(function (c, n) { return n === 0 ? id : ''; }) : filas[d.j].map(rl8Celda_);
    bloqueTrab.push([d.j == null ? '' : d.j + 2, d.folio, d.motivo].concat(fila));
  });
  plan.lote.forEach(function (p) {
    var accion = plan.anulaId[String(p.id)] ? 'se anula' : (plan.yaAnuladoId[String(p.id)] ? 'ya estaba anulado' : 'se respeta (tiene depósito)');
    var s = JSON.stringify(p), partes = Math.max(1, Math.ceil(s.length / 45000));
    for (var q = 0; q < partes; q++) bloqueComp.push([p.folio || '', String(p.id || ''), accion, q + 1, partes, "'" + s.substr(q * 45000, 45000)]);
  });
  rl8Respaldo_(ss, cuando, bloqueTrab, bloqueComp);

  /* 2 · Los trabajos vuelven a pendiente (celda por celda: no pisa lo que otro guarde en otras filas). */
  aRevertir.forEach(function (j) { rep.getRange(j + 2, colPaid + 1).setValue(false); });

  /* 3 · Los comprobantes pasan a «pagos_anulados» y salen del historial activo. */
  var isoAhora = ahora.toISOString();
  var nuevosAnulados = anulados.concat(plan.anular.map(function (p) {
    return Object.assign({}, p, { anulado: true, anuladoEn: isoAhora, motivo: RL8_MOTIVO_, anuladoPor: RL8_QUIEN_, loteRevertido: RL8_MARCA_ });
  }));
  if (plan.anular.length) saveConfigPlano_('pagos_anulados', nuevosAnulados, {});
  var quitar = {}; nuevosAnulados.forEach(function (p) { if (p && p.loteRevertido === RL8_MARCA_ && p.id != null) quitar[String(p.id)] = 1; });
  shards.forEach(function (sh) {
    var lista = sh.lista.filter(function (p) { return !(p && p.id != null && quitar[String(p.id)]); });
    if (lista.length !== sh.lista.length) saveConfigPlano_(sh.key, lista, {});
  });

  /* 4 · Adelantos cerrados solos desde el 8-nov, de las personas con descuento en un comprobante anulado. */
  var adv = rl8Adelantos_(cfgVals, plan.anular, isoAhora);

  /* 5 · Bitácora (folios y totales, sin nombres). */
  var tot = plan.anular.reduce(function (s, p) {
    s.b += Number(p.totalBruto) || 0; s.d += Number(p.totalDescuento) || 0; s.n += Number(p.totalNeto) || 0; return s;
  }, { b: 0, d: 0, n: 0 });
  var cuenta = function (m) { return Object.keys(decision).filter(function (id) { return decision[id].motivo === m; }).length; };
  var res = {
    ok: true,
    anulados: plan.anular.map(function (p) { return p.folio; }),
    respetados: plan.respetar.map(function (p) { return p.folio; }),
    trabajosRevertidos: aRevertir.length,
    trabajosYaPendientes: cuenta('no: ya estaba pendiente'),
    trabajosPagadosEnOtro: cuenta('no: pagado en otro comprobante'),
    trabajosConDeposito: cuenta('no: el comprobante tiene depósito'),
    trabajosNoEncontrados: cuenta('no: no está en Reportes'),
    totalAnulado: { bruto: rl8Q_(tot.b), descuentoAdelantos: rl8Q_(tot.d), neto: rl8Q_(tot.n) },
    adelantosReabiertos: adv.reabiertos, adelantosARevisar: adv.revisar
  };
  bitLog_('pagos',
    'Reversión del pago en lote del 8-nov (una sola vez): se anularon ' + res.anulados.length + ' comprobante(s) sin depósito (' +
    (res.anulados.join(', ') || '—') + ') y se respetaron ' + res.respetados.length + ' con depósito (' + (res.respetados.join(', ') || '—') + '). ' +
    res.trabajosRevertidos + ' trabajo(s) volvieron a pendiente; ' + res.trabajosYaPendientes + ' ya estaban pendientes; ' +
    res.trabajosPagadosEnOtro + ' pagados en otro comprobante. Anulado: bruto Q' + res.totalAnulado.bruto + ', descuento de adelantos Q' +
    res.totalAnulado.descuentoAdelantos + ', neto Q' + res.totalAnulado.neto + '. Adelantos reabiertos: ' + adv.reabiertos +
    (adv.revisar ? ' · con cuota congelada (revisar a mano): ' + adv.revisar : '') + '. Respaldo en la pestaña «' + RL8_HOJA_ + '».',
    RL8_QUIEN_, { anulados: res.anulados, respetados: res.respetados, trabajos: res.trabajosRevertidos });
  try { cacheBump_(); } catch (e) {}
  return res;
}

/* ── El plan (sin tocar nada): qué es el lote, qué se anula y qué se respeta. ── */
function rl8Plan_(shards, anulados) {
  var enLote = function (p) {
    var c = Number(p && p.createdAt);
    return !!p && p.tipo === 'lote' && String(p.generadoPor || '') === RL8_POR_ && c >= RL8_DESDE_ && c < RL8_HASTA_;
  };
  var lote = [], visto = {};
  shards.forEach(function (sh) { sh.lista.forEach(function (p) { if (enLote(p) && !visto[String(p.id)]) { visto[String(p.id)] = 1; lote.push(p); } }); });
  var yaAnuladoId = {}, previos = [];
  (anulados || []).forEach(function (p) { if (p && p.loteRevertido === RL8_MARCA_ && enLote(p)) { yaAnuladoId[String(p.id)] = 1; if (!visto[String(p.id)]) { visto[String(p.id)] = 1; previos.push(p); } } });
  /* Tienen que ser exactamente los 10 folios, cada uno una sola vez. */
  var folios = lote.concat(previos).map(function (p) { return String(p.folio || ''); }).sort();
  if (folios.join('|') !== RL8_FOLIOS_.slice().sort().join('|'))
    return { error: 'el lote no cuadra: se esperaban ' + RL8_FOLIOS_.length + ' folios (' + RL8_FOLIOS_[0] + ' a ' + RL8_FOLIOS_[RL8_FOLIOS_.length - 1] + ') y se encontraron ' + folios.length + ' (' + (folios.join(', ') || 'ninguno') + ')' };
  var anular = [], respetar = [], anulaId = {}, quitarDeShards = [];
  lote.forEach(function (p) {
    if (yaAnuladoId[String(p.id)]) { quitarDeShards.push(p); return; }   // una corrida anterior se cortó a medias
    if (rl8TieneDeposito_(p.soporte)) respetar.push(p); else { anular.push(p); anulaId[String(p.id)] = 1; }
  });
  /* Trabajos que están en OTRO comprobante vigente: se volvieron a pagar, no se tocan. */
  var pagadoEnOtro = {};
  shards.forEach(function (sh) { sh.lista.forEach(function (p) { if (!p || enLote(p)) return; rl8Trabajos_(p).forEach(function (t) { var id = rl8Id_(t.repId); if (id) pagadoEnOtro[id] = 1; }); }); });
  return { lote: lote.concat(previos), anular: anular, respetar: respetar, anulaId: anulaId, yaAnuladoId: yaAnuladoId, quitarDeShards: quitarDeShards, pagadoEnOtro: pagadoEnOtro };
}

/* ¿El comprobante tiene su depósito cargado? Cualquier archivo cuenta (URL, base64 o el nombre si no alcanzó a subir). */
function rl8TieneDeposito_(s) {
  if (!s) return false;
  if (typeof s === 'string') return !!s.trim();
  if (typeof s !== 'object') return false;
  return !!(String(s.url || '').trim() || String(s.data || '').trim() || String(s.name || '').trim() || String(s.fileId || '').trim());
}

function rl8Trabajos_(p) {
  var out = [];
  ((p && p.tecnicos) || []).forEach(function (t) { ((t && t.trabajos) || []).forEach(function (x) { if (x) out.push(x); }); });
  return out;
}
/* El id de Reportes llega como número (a veces 1.79e12 con decimales de la hoja): se compara como entero. */
function rl8Id_(v) {
  if (v === null || v === undefined || v === '') return '';
  var n = Number(v);
  return isFinite(n) && String(v).trim() !== '' ? String(Math.round(n)) : String(v).trim();
}
function rl8EsTrue_(v) { return v === true || v === 1 || /^(true|verdadero|1)$/i.test(String(v == null ? '' : v).trim()); }
function rl8Celda_(v) { return (typeof v === 'string' && /^[=+@]/.test(v)) ? "'" + v : v; }
function rl8Q_(n) { return (Math.round(n * 100) / 100).toFixed(2); }

/* La pestaña de respaldo. Si ya existe (corrida a medias), agrega otro bloque abajo. */
function rl8Respaldo_(ss, cuando, bloqueTrab, bloqueComp) {
  var sh = ss.getSheetByName(RL8_HOJA_) || ss.insertSheet(RL8_HOJA_);
  var ancho = Math.max(3 + COLS.length, 6);
  if (sh.getMaxColumns() < ancho) sh.insertColumnsAfter(sh.getMaxColumns(), ancho - sh.getMaxColumns());
  var escribir = function (filas) {
    if (!filas.length) return;
    var w = filas[0].length, desde = sh.getLastRow() + 1;
    if (sh.getMaxRows() < desde + filas.length) sh.insertRowsAfter(sh.getMaxRows(), desde + filas.length - sh.getMaxRows());
    sh.getRange(desde, 1, filas.length, w).setValues(filas);
  };
  var antes = sh.getLastRow();
  escribir([['Respaldo de la reversión del pago en lote del 8-nov-2026 · ' + cuando + ' (GMT-6) · antes de cambiar nada', '', '']]);
  escribir([['Trabajos: filas de Reportes tal como estaban', '', '']]);
  escribir([['fila en Reportes', 'folio', 'se revierte'].concat(COLS)].concat(bloqueTrab));
  escribir([['Comprobantes del lote: JSON tal como estaba', '', '', '', '', '']]);
  escribir([['folio', 'id', 'acción', 'parte', 'partes', 'json']].concat(bloqueComp));
  SpreadsheetApp.flush();
  var esperadas = 5 + bloqueTrab.length + bloqueComp.length;
  if (sh.getLastRow() - antes < esperadas) throw new Error('el respaldo no quedó completo: no se cambió nada');
}

/* Reabre los adelantos semanales que el app cerró solo desde el 8-nov, de las personas con descuento en un comprobante
   anulado. Devuelve cuántos reabrió y cuántos tienen cuota congelada (frozenWeeks) y conviene mirar a mano. */
function rl8Adelantos_(cfgVals, anular, isoAhora) {
  var correos = {};
  anular.forEach(function (p) { (p.tecnicos || []).forEach(function (t) { if (Number(t.adelanto) > 0 && t.vendorEmail) correos[String(t.vendorEmail).toLowerCase().trim()] = 1; }); });
  if (!Object.keys(correos).length) return { reabiertos: 0, revisar: 0 };
  var fila = cfgVals.filter(function (r) { return r[0] === 'adelantos'; })[0];
  var lista; try { lista = JSON.parse(String(fila ? fila[1] : '[]')); } catch (e) { return { reabiertos: 0, revisar: 0, error: 'adelantos no es JSON: no se tocó' }; }
  if (!Array.isArray(lista)) return { reabiertos: 0, revisar: 0, error: 'adelantos no es una lista: no se tocó' };
  var reabiertos = 0, revisar = 0;
  var nueva = lista.map(function (a) {
    if (!a || a.modo === 'quincenal' || !correos[String(a.vendorEmail || '').toLowerCase().trim()]) return a;
    if (Number(a.frozenWeeks) > 0 && (a.status === 'activo' || a.status === 'pagado')) revisar++;
    if (a.status !== 'pagado' || String(a.fechaLiquidacion || '') < '2026-11-08') return a;
    reabiertos++;
    var b = Object.assign({}, a, { status: 'activo', reabierto: { fecha: isoAhora, motivo: RL8_MOTIVO_, fechaLiquidacionAnterior: a.fechaLiquidacion || '', montoLiquidadoAnterior: a.montoLiquidado || 0 } });
    delete b.fechaLiquidacion; delete b.montoLiquidado;
    return b;
  });
  if (reabiertos) saveConfigPlano_('adelantos', nueva, {});
  return { reabiertos: reabiertos, revisar: revisar };
}
