/* ═══ RESTAURAR LOS ADELANTOS BORRADOS EL 25-OCT-2026 (una sola vez) ═════════════════════════════════════════════
   El 25-oct a las 14:19 UTC la app guardó su lista de arranque encima de la clave «adelantos» (arreglado en #37) y se
   perdieron 6 adelantos vigentes. Se reconstruyeron con los correos de Epi («Nueva solicitud de adelanto», «Tu adelanto
   ya fue depositado») y los descuentos de los comprobantes (pagos). Juan confirmó (1-nov):
     · Jackeline tiene un tercer adelanto (Q1,500, depositado el 24-oct, sin descuentos todavía).
     · Sucely ya pagó su adelanto de julio: no se restaura.
     · Mirla no se perdonó: se cobran los Q27 que faltan.
   Cada uno vuelve con lo que le FALTA como monto y empieza a descontarse la semana del 2-nov (fechaInicio), así el
   cálculo automático (semanas pagadas desde fechaInicio) no cuenta las semanas en que no se cobró nada. El historial
   va en «restaurado». Se guarda por saveConfig: pasa por el candado y deja copia en Config_historial.
   Corre sola una vez (propiedad ADELANTOS_RESTAURADOS_20261101) desde getConfig; también a mano: adelantosRestaurar(). */

var ADV_RESTAURAR_ = [
  { id: 'adv_rest_caren_20261101', vendorEmail: 'inescahcon@gmail.com', vendorName: 'Caren Chacon', saldo: 478, cobroSemanal: 146, fechaDeposito: '2026-09-07', original: 1600, cuotasOriginales: 11, descontado: 1122 },
  { id: 'adv_rest_joselyn_20261101', vendorEmail: 'andyvas85@gmail.com', vendorName: 'Joselyn Sian', saldo: 825, cobroSemanal: 165, fechaDeposito: '2026-09-07', original: 1980, cuotasOriginales: 12, descontado: 1155 },
  { id: 'adv_rest_jackeline2_20261101', vendorEmail: 'kr9435454@gmail.com', vendorName: 'Jackeline Ruano', saldo: 750, cobroSemanal: 125, fechaDeposito: '2026-09-07', original: 1500, cuotasOriginales: 12, descontado: 750 },
  { id: 'adv_rest_jackeline3_20261101', vendorEmail: 'kr9435454@gmail.com', vendorName: 'Jackeline Ruano', saldo: 1500, cobroSemanal: 125, fechaDeposito: '2026-10-24', original: 1500, cuotasOriginales: 12, descontado: 0 },
  { id: 'adv_rest_flor_20261101', vendorEmail: 'florsamayoa1988@gmail.com', vendorName: 'Flor Samayoa', saldo: 1400, cobroSemanal: 200, fechaDeposito: '2026-10-07', original: 2000, cuotasOriginales: 10, descontado: 600 },
  { id: 'adv_rest_mirla_20261101', vendorEmail: 'allisonchacon1320@gmail.com', vendorName: 'Mirla Chacon', saldo: 27, cobroSemanal: 27, fechaDeposito: '2026-08-27', original: 852, cuotasOriginales: 1, descontado: 825 }
];
var ADV_RESTAURAR_PROP_ = 'ADELANTOS_RESTAURADOS_20261101', ADV_RESTAURAR_INICIO_ = '2026-11-02';

function adelantosRestaurar() { var r = adelantosRestaurar_(true); Logger.log(JSON.stringify(r, null, 2)); return r; }
function adelantosRestaurar_(aMano) {
  var P = PropertiesService.getScriptProperties();
  if (!aMano && P.getProperty(ADV_RESTAURAR_PROP_)) return { ok: true, ya: true };
  /* Desde getConfig: si un intento falló, no se vuelve a intentar en 10 min (no frena cada apertura de la app). */
  if (!aMano && Date.now() - Number(P.getProperty('ADV_RESTAURAR_INTENTO') || 0) < 600000) return { ok: false, espera: true };
  P.setProperty('ADV_RESTAURAR_INTENTO', String(Date.now()));
  var lock = LockService.getScriptLock(); if (!lock.tryLock(aMano ? 20000 : 5000)) return { ok: false, error: 'ocupado' };
  try {
    if (!aMano && P.getProperty(ADV_RESTAURAR_PROP_)) return { ok: true, ya: true };
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Config'); if (!sh) return { ok: false, error: 'sin Config' };
    var fila = sh.getDataRange().getValues().filter(function (r) { return r[0] === 'adelantos'; })[0];
    var lista = []; try { lista = JSON.parse(String(fila ? fila[1] : '[]')); } catch (e) { return { ok: false, error: 'la celda de adelantos no es JSON: no se toca' }; }
    if (!Array.isArray(lista)) return { ok: false, error: 'adelantos no es una lista: no se toca' };
    var ids = {}; lista.forEach(function (a) { if (a && a.id) ids[a.id] = 1; });
    var ahora = Date.now(), agregados = [];
    ADV_RESTAURAR_.forEach(function (x) {
      if (ids[x.id]) return;
      lista.push({
        id: x.id, vendorEmail: x.vendorEmail, vendorName: x.vendorName, dpiNumber: '', dpiPhoto: null,
        monto: x.saldo, cobroSemanal: x.cobroSemanal, cuotas: Math.ceil(x.saldo / x.cobroSemanal),
        fechaInicio: ADV_RESTAURAR_INICIO_, fechaDeposito: x.fechaDeposito, status: 'activo', createdAt: ahora,
        pausas: [], ajustes: [], contractText: '', motivo: 'Restaurado (se borró por error el 25-oct)',
        restaurado: { fecha: new Date(ahora).toISOString(), montoOriginal: x.original, cuotasOriginales: x.cuotasOriginales,
          descontadoAntes: x.descontado, saldoAlRestaurar: x.saldo, fuente: 'correos de Epi + comprobantes de pago' }
      });
      agregados.push(x.vendorName + ' · Q' + x.saldo);
    });
    if (agregados.length) saveConfigPlano_('adelantos', lista, {});   // ya con el candado del script tomado: candado de dinero + copia en Config_historial
    P.setProperty(ADV_RESTAURAR_PROP_, new Date(ahora).toISOString());
    try { cacheBump_(); } catch (e) {}
    console.log('Adelantos restaurados: ' + (agregados.join(' · ') || 'ninguno (ya estaban)'));
    return { ok: true, agregados: agregados };
  } catch (e) { console.error('adelantosRestaurar_: ' + e); return { ok: false, error: String(e && e.message || e) }; }
  finally { lock.releaseLock(); }
}
