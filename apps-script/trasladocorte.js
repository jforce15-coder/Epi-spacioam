/* ═══ TRASLADO · quién atiende lo de fondo (Hub-Spacioam docs/specs/traslado-workspace.md) ═══
   Mientras dura el traslado a alma@ hay dos proyectos de Epi (el viejo en la cuenta Gmail y el nuevo en alma@) que leen
   la misma hoja (Spacio AM DB). Si los dos corrieran sus activadores, un técnico recibiría dos veces la misma ruta.
   · La pestaña TRASLADO de Spacio AM DB dice qué proyecto es el dueño (B1 = su id). Un activador de cualquier otro
     proyecto sale sin hacer nada (epiSaltarActivador_). Sin la pestaña o con B1 vacío, todos corren como siempre.
   · Solo se saltan las corridas que lanza un ACTIVADOR (traen triggerUid). Lo que pide la app o el Hub por /exec
     («programar», «revisarMatutina», «redSalidas») corre siempre, en el proyecto que lo recibe.
   · La pestaña se lee en cada activador, sin caché: al cambiar B1, el otro proyecto se entera en su siguiente corrida.
     Si la hoja no se puede leer, el activador corre (nunca un día sin rutas).
   · epiTomarActivadores() (lo corre el nuevo al traer las Propiedades, «al_traer»): instala los activadores de Epi y,
     solo si quedaron todos, se anota como dueño. Desde ahí lo de fondo lo hace alma@; el viejo queda de respaldo.
   · Volver atrás: robot { action: "__traslado", token, dueno: "yo" } al proyecto VIEJO (o poner su id en B1 a mano). */
var EPI_TRASLADO_HOJA_ = 'TRASLADO';
/* Los activadores de Epi: [función, cómo]. Los que tenía vivos el viejo el 18-nov-2026 (robot __traslado). */
var EPI_ACTIVADORES_ = [
  ['cronProgramar18', function (b) { return b.atHour(18).everyDays(1); }],        // programa 3 días y avisa al técnico
  ['cronRevisar06', function (b) { return b.atHour(6).everyDays(1); }],           // reservas nuevas de la noche
  ['cronVerificarCheckouts', function (b) { return b.atHour(7).everyDays(1); }],  // salidas contra Hospitable
  ['cronSyncReservas', function (b) { return b.everyHours(3); }],
  ['cronAlertaLimpiezas13', function (b) { return b.atHour(13).everyDays(1); }],
  ['cronRecordatorio19', function (b) { return b.atHour(19).everyDays(1); }],
  ['cronSyncReviews', function (b) { return b.atHour(4).everyDays(1); }],
  ['cronSyncListings', function (b) { return b.atHour(3).everyDays(1); }],      // lista de propiedades (creado a mano en el viejo)
  ['cronSyncProperties', function (b) { return b.atHour(3).everyDays(1); }]     // cuartos, baños y fotos del anuncio (a mano en el viejo)
];
/* En el viejo hay además cronCodigos9am, cronCodigos5pm y cronCodigos8pm: esas funciones ya no existen en el código
   (cada corrida falla sola), así que no se pasan. */

function epiTrasladoHoja_(crear) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(EPI_TRASLADO_HOJA_);
  if (!sh && crear) sh = ss.insertSheet(EPI_TRASLADO_HOJA_);
  return sh;
}
function epiDueno_() {
  var sh = epiTrasladoHoja_(false);
  return sh ? String(sh.getRange('B1').getValue() || '').trim() : '';
}
function epiPonerDueno_(id) {
  var sh = epiTrasladoHoja_(true);
  sh.getRange('A1:C1').setValues([['dueño', id, new Date().toISOString()]]);
  sh.getRange('A2').setValue('El proyecto con este id atiende lo de fondo de Epi (rutas, avisos, sync). Para volver al viejo, pon su id en B1.');
}

/* true = este proyecto NO es el dueño y la corrida viene de un activador: salir sin hacer nada. */
function epiSaltarActivador_(e) {
  if (!e || typeof e !== 'object' || !e.triggerUid) return false;
  var d = '';
  try { d = epiDueno_(); } catch (err) { console.warn('epiSaltarActivador_: ' + err); return false; }
  if (!d || d === ScriptApp.getScriptId()) return false;
  console.log('Traslado: lo de fondo lo atiende el proyecto ' + d.slice(0, 8) + '…; este sale sin hacer nada.');
  return true;
}

function epiActivadoresVivos_() {
  var n = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); n[f] = (n[f] || 0) + 1; });
  return n;
}

function epiTomarActivadores() {
  var nombres = EPI_ACTIVADORES_.map(function (x) { return x[0]; });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (nombres.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  var fallas = [];
  EPI_ACTIVADORES_.forEach(function (x) {
    try { x[1](ScriptApp.newTrigger(x[0]).timeBased()).create(); } catch (e) { fallas.push(x[0] + ': ' + e.message); }
  });
  var n = epiActivadoresVivos_();
  var faltan = nombres.filter(function (f) { return !n[f]; });
  if (faltan.length) {   // sin todos los activadores no se toma nada: el viejo sigue siendo el dueño (ni hueco ni duplicados)
    ScriptApp.getProjectTriggers().forEach(function (t) { if (nombres.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
    throw new Error('Faltaron activadores (' + faltan.join(', ') + '). ' + fallas.join(' · ') + ' El viejo sigue atendiendo lo de fondo. Vuelve a correr epiTomarActivadores.');
  }
  epiPonerDueno_(ScriptApp.getScriptId());
  console.log('Epi: activadores ' + JSON.stringify(n) + '. Dueño de lo de fondo: este proyecto.');
  return n;
}

/* Robot: { action: "__traslado", token } → id de este proyecto, dueño y activadores vivos.
   Con dueno: "yo" este proyecto se vuelve el dueño, solo si ya tiene todos sus activadores (volver atrás sin hueco). */
function epiTrasladoDiag_(body) {
  if (!body || body.action !== '__traslado') return null;
  var out;
  try {
    if (!esRobot_({ robot: String(body.token || '') })) out = { ok: false, error: 'token' };
    else {
      var n = epiActivadoresVivos_(), yo = ScriptApp.getScriptId();
      var faltan = EPI_ACTIVADORES_.map(function (x) { return x[0]; }).filter(function (f) { return !n[f]; });
      if (body.dueno === 'yo') {
        if (faltan.length) out = { ok: false, error: 'faltan_activadores', faltan: faltan };
        else epiPonerDueno_(yo);
      }
      if (!out) { var d = epiDueno_(); out = { ok: true, proyecto: yo, dueno: d, soy_dueno: !d || d === yo, activadores: n, faltan: faltan }; }
    }
  } catch (e) { out = { ok: false, error: String(e.message || e).slice(0, 120) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
