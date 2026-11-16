/* Prueba de la red de salidas (apps-script/redsalidas.js) con dobles: sin internet ni Google.
   Reconstruye lo del 13–15 nov 2026 (Narama 623) y revisa las tres capas:
   1. resPagina_ reintenta 429/5xx y no reintenta un 404;
   2. syncReservas con una página que no llega NO guarda la copia (antes guardaba 1 reserva como si fuera todo);
   3. una caída brusca de salidas no se guarda; a la 4.ª lectura seguida sí;
   4. el cerrojo de reemplazo detiene un plan nuevo que deja sin limpieza las salidas ya programadas;
   5. cronProgramar18 con ese plan vacío conserva la programación anterior y avisa;
   6. redCubre_: tentativa, sin persona y baja del sistema no cubren; confirmada, manual y baja de una persona sí;
   7. redSalidas_: la salida sin limpieza queda como tentativa (origen «red», sin correo al técnico) y en «faltan»;
      lo que el motor no cubre sale con su razón; sin lectura ni copia reciente no escribe nada;
   8. cronRevisar06 reparte como siempre la tentativa de la red que nadie confirmó.
   node .github/red-salidas.js [carpeta apps-script] */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = process.argv[2] || path.join(__dirname, '..', 'apps-script');
let fallo = 0; const ok = (c, m) => { if (c) console.log('✓ ' + m); else { console.log('::error::' + m); fallo = 1; } };

const AHORA = Date.parse('2026-11-14T00:42:00Z');   // 13-nov 18:42 en Guatemala
function caja(o) {
  o = o || {};
  const props = Object.assign({}, o.props || {}), log = { guardados: [], bit: [], correos: [], configs: [], fetch: [], avisos: [] };
  const ahora = o.ahora || AHORA;
  class D extends Date { constructor(...a) { if (a.length) super(...a); else super(ahora); } static now() { return ahora; } }
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date: D, Math, String, Number, Object, Array, RegExp, isNaN, parseInt, parseFloat, isFinite, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      sleep() {}, formatDate: (d, tz, f) => { const g = new Date(d.getTime() - 6 * 3600000).toISOString(); return f === 'yyyy-MM-dd HH:mm' ? g.slice(0, 10) + ' ' + g.slice(11, 16) : g.slice(0, 10); }
    },
    ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    ScriptApp: { getProjectTriggers: () => [] }
  };
  vm.createContext(ctx);
  ['Código.js', 'redsalidas.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
  let cfg = Object.assign({ reservas: [], reservasSync: '', vendors: [], props: [], schedules: [], ausencias: [] }, o.cfg || {});
  ctx.getConfig = () => JSON.parse(JSON.stringify(cfg));
  ctx.saveConfig = (k, v) => { log.configs.push(k); cfg[k] = v; return { ok: true }; };
  ctx.schedGuardar_ = (lista, motivo) => { log.guardados.push({ lista, motivo }); cfg.schedules = lista; };
  ctx.bitLog_ = (t, d) => { log.bit.push(t + ': ' + d); };
  ctx.notify = p => { log.correos.push(p); };
  ctx.avisarAdmins_ = (v, alertas) => { log.avisos.push(alertas); };
  ctx.notificarDia_ = () => 0;
  ctx.ratingsGuardados_ = () => ({});
  ctx.reportesRecientes_ = () => [];
  ctx.uf_ = (url) => { log.fetch.push(url); const r = o.red ? o.red(url, log.fetch.length) : { code: 200, body: '{"data":[]}' }; if (r.tirar) throw new Error(r.tirar); return { getResponseCode: () => r.code, getContentText: () => r.body }; };
  if (o.listings) ctx.fetchHospitableListings_ = () => ({ ok: true, data: o.listings });
  return { ctx, log, cfg: () => cfg, props };
}

const TEC = { id: 'v1', email: 'tec@x', primerNombre: 'Ana', active: true, isAdmin: false };
const ADM = { id: 'v0', email: 'adm@x', name: 'Admin', active: true, isAdmin: true };
const res = (prop, ci, co) => ({ id: prop + co, propiedad: prop, checkIn: ci, checkOut: co, habitaciones: 1 });
const fila = (id, fecha, prop, x) => Object.assign({ id, fecha, propiedad: prop, vendorEmail: 'tec@x', tipo: 'Limpieza', estado: 'tentativa', origen: 'motor' }, x || {});

/* 1 · resPagina_ */
(() => {
  let n = 0; const c = caja({ red: () => (++n === 1 ? { code: 429, body: '' } : { code: 200, body: '{"data":[1]}' }) });
  const j = c.ctx.resPagina_('u', 't');
  ok(j && j.data.length === 1 && c.log.fetch.length === 2, '429 se reintenta y la segunda vez llega la página');
  const c2 = caja({ red: () => ({ code: 503, body: '' }) });
  ok(c2.ctx.resPagina_('u', 't') === null && c2.log.fetch.length === 3, '5xx tres veces: null después de 3 intentos');
  const c3 = caja({ red: () => ({ code: 404, body: '' }) });
  ok(c3.ctx.resPagina_('u', 't') === null && c3.log.fetch.length === 1, '404 no se reintenta');
  const c4 = caja({ red: (u, i) => (i === 1 ? { tirar: 'Service invoked too many times' } : { code: 200, body: '{"data":[]}' }) });
  ok(!!c4.ctx.resPagina_('u', 't'), 'un corte de red (excepción) se reintenta');
})();

/* 2 · syncReservas con la página 2 caída (lo del 13-nov) */
(() => {
  const listings = Array.from({ length: 3 }, (_, i) => ({ id: 'p' + i, name: 'Z13 - Narama - 6' + i, bedrooms: 1 }));
  const pag1 = { data: [{ id: 'r1', status: 'accepted', arrival_date: '2026-11-12', departure_date: '2026-11-15', property_id: 'p0' }], meta: { pagination: { current_page: 1, total_pages: 2 } } };
  const c = caja({ listings, props: { HOSPITABLE_TOKEN: 'prueba' }, cfg: { reservas: [res('Z13 - Narama - 623', '2026-11-14', '2026-11-15')], reservasSync: '2026-11-13 15:00' },
    red: u => (/page=1&/.test(u) ? { code: 200, body: JSON.stringify(pag1) } : { code: 500, body: '' }) });
  const r = c.ctx.syncReservas(21);
  ok(r.ok === false && r.incompleta, 'una página que no llega: la sincronización sale ok:false (incompleta)');
  ok(c.log.configs.indexOf('reservas') < 0 && c.cfg().reservas.length === 1, 'y NO pisa la copia buena de reservas');
  ok(c.log.bit.some(b => /NO guardada/.test(b)), 'queda en la bitácora');
})();

/* 3 · caída brusca */
(() => {
  const prev = Array.from({ length: 12 }, (_, i) => res('Z' + i, '2026-11-13', '2026-11-1' + (4 + (i % 5))));
  const c = caja({ cfg: { reservas: prev } });
  const hoy = '2026-11-13';
  ok(/bajaron de 12 a 0/.test(c.ctx.resLecturaDudosa_([], [], hoy)), 'de 12 salidas en 7 días a 0: dudosa');
  c.ctx.resLecturaDudosa_([], [], hoy); c.ctx.resLecturaDudosa_([], [], hoy);
  ok(c.ctx.resLecturaDudosa_([], [], hoy) === '', 'a la 4.ª lectura seguida se acepta');
  ok(c.ctx.resLecturaDudosa_(prev, [], hoy) === '' && !c.props.EPI_RES_CAIDA, 'una lectura normal no es dudosa y limpia el contador');
})();

/* 4 y 5 · cerrojo de reemplazo y cronProgramar18 */
(() => {
  const c = caja();
  const ex = ['2026-11-14', '2026-11-15'].flatMap(f => ['A', 'B', 'C', 'Z13 - Narama - 623'].map(p => fila('sc_' + f + p, f, p)));
  ok(/dejaba sin limpieza 8 de 8/.test(c.ctx.redCerrojoReemplazo_(ex, [], [], '2026-11-13')), 'plan nuevo vacío contra 8 programadas: se detiene');
  const nuevas = ex.slice(0, 7).map(s => Object.assign({}, s, { id: 'n' + s.id }));
  ok(c.ctx.redCerrojoReemplazo_(ex, [], nuevas, '2026-11-13') === '', 'el plan nuevo cubre casi todo: sigue');
  ok(c.ctx.redCerrojoReemplazo_(ex, ex, [], '2026-11-13') === '', 'lo que se conserva no cuenta como perdido');

  const reservas = ['A', 'B', 'C', 'Z13 - Narama - 623'].flatMap(p => [res(p, '2026-11-13', '2026-11-14'), res(p, '2026-11-14', '2026-11-15')]);
  const c2 = caja({ cfg: { reservas, reservasSync: '2026-11-13 18:42', vendors: [TEC, ADM], schedules: ex } });
  c2.ctx.syncReservas = () => ({ ok: true, reservas });
  c2.ctx.SCHED.programar = o => ({ asignaciones: [], sinAsignar: [], alertas: [], desde: '2026-11-14', hasta: '2026-11-16' });
  c2.ctx.SCHED.revisionMatutina = () => ({ nuevas: [], sinAsignar: [], alertas: [] });
  const r = c2.ctx.cronProgramar18();
  ok(r.ok && /dejaba sin limpieza/.test(r.cerrojo), 'cronProgramar18: el plan vacío se detiene por el cerrojo');
  ok(!c2.log.guardados.some(g => /Reparto automático/.test(g.motivo)) && c2.cfg().schedules.length === 8, 'y la programación del 14 y 15 sigue completa');
  ok(c2.log.avisos.length > 0, 'y avisa a los administradores');
})();

/* 6 · redCubre_ */
(() => {
  const c = caja(), C = c.ctx.redCubre_;
  ok(!C(fila('a', '2026-11-15', 'X')), 'tentativa sin confirmar: no cubre');
  ok(!C(fila('a', '2026-11-15', 'X', { estado: 'confirmada', vendorEmail: '' })), 'confirmada sin persona: no cubre');
  ok(!C(fila('a', '2026-11-15', 'X', { estado: 'cancelada', canceladaPor: 'sistema' })), 'baja del sistema: no cubre');
  ok(C(fila('a', '2026-11-15', 'X', { estado: 'confirmada' })), 'confirmada con persona: cubre');
  ok(C(fila('a', '2026-11-15', 'X', { estado: '', origen: 'hub' })), 'la puso una persona (Hub): cubre');
  ok(C(fila('a', '2026-11-15', 'X', { estado: 'cancelada', canceladaPor: 'admin' })), 'la canceló una persona: está decidido');
})();

/* 7 · redSalidas_ (la noche del 14 para el 15) */
(() => {
  const ahora = Date.parse('2026-11-15T01:30:00Z');   // 14-nov 19:30
  const reservas = [res('Z13 - Narama - 623', '2026-11-14', '2026-11-15'), res('Z7 - Monaco - D6', '2026-11-13', '2026-11-15'), res('Z10 - Ignacio - 904', '2026-11-12', '2026-11-15')];
  const schedules = [fila('s1', '2026-11-15', 'Z10 - Ignacio - 904', { estado: 'confirmada', notificadoEn: '2026-11-14' })];
  const c = caja({ ahora, cfg: { reservas, reservasSync: '2026-11-14 19:00', vendors: [TEC, ADM], schedules } });
  c.ctx.syncReservas = () => { throw new Error('no debía leer Hospitable con una copia de 30 min'); };
  c.ctx.SCHED.revisionMatutina = o => {
    if (o.existentes.some(s => s.propiedad === 'Z13 - Narama - 623')) return { nuevas: [], sinAsignar: [{ lim: { propiedad: 'Z7 - Monaco - D6' }, razon: 'No cabe en la jornada de nadie' }], alertas: [] };   // como el motor: lo que ya está ese día no se repite
    ok(o.hoy === '2026-11-15', 'el motor reparte para el día de la salida');
    return { nuevas: [{ fecha: '2026-11-15', propiedad: 'Z13 - Narama - 623', vendorEmail: 'tec@x', tipo: 'Limpieza', estado: 'confirmada', origen: 'motor-am', nuevaHoy: true }],
             sinAsignar: [{ lim: { propiedad: 'Z7 - Monaco - D6' }, razon: 'No cabe en la jornada de nadie' }], alertas: [] };
  };
  const r = c.ctx.redSalidas_('2026-11-15');
  ok(r.salidas === 3 && r.faltan.length === 2, '3 salidas, 2 sin limpieza confirmada (la confirmada no cuenta)');
  const g = c.log.guardados[0];
  const t = g && g.lista.filter(s => s.origen === 'red')[0];
  ok(t && t.estado === 'tentativa' && t.propiedad === 'Z13 - Narama - 623' && !t.notificadoEn && !('nuevaHoy' in t), 'Narama 623 queda como tentativa de la red, sin correo al técnico');
  const n = r.faltan.filter(f => /Narama/.test(f.propiedad))[0], m = r.faltan.filter(f => /Monaco/.test(f.propiedad))[0];
  ok(n.propuesta === 'Ana' && m.propuesta === '' && /No cabe/.test(m.razon), 'faltan dice la propuesta (Ana) o la razón (no cabe)');
  ok(/SALIDAS DEL 2026-11-15 SIN LIMPIEZA CONFIRMADA \(2\)/.test(c.ctx.redTexto_(r)), 'el texto del aviso lo dice');
  ok(c.ctx.redAvisarCorreo_([TEC, ADM], r) && c.log.correos[0].to[0] === 'adm@x', 'el correo va solo a los administradores');
  const r2 = c.ctx.redSalidas_('2026-11-15');
  ok(c.log.guardados.length === 1 && r2.faltan.length === 2, 'correrla otra vez no duplica (la tentativa ya está, sigue en faltan)');

  const c2 = caja({ ahora, cfg: { reservas, reservasSync: '2026-11-13 08:00', vendors: [TEC, ADM], schedules } });
  c2.ctx.syncReservas = () => ({ ok: false, error: 'Hospitable no entregó 2 página(s)' });
  const r3 = c2.ctx.redSalidas_('2026-11-15');
  ok(r3.salidas === null && !r3.lectura.ok && c2.log.guardados.length === 0, 'sin lectura ni copia reciente: no escribe y lo dice');
  ok(/No pude leer Hospitable/.test(c2.ctx.redTexto_(r3)), 'y el aviso dice que no pudo leer');
  const c3 = caja({ ahora, cfg: { reservas, reservasSync: '2026-11-14 15:00', vendors: [TEC, ADM], schedules } });
  c3.ctx.syncReservas = () => ({ ok: false, error: 'x' });
  const r4 = c3.ctx.redSalidas_('2026-11-15');
  ok(r4.faltan.length === 2 && c3.log.guardados.length === 0, 'con copia de 4 h: avisa lo que falta pero no deja tentativas');
})();

/* 8 · cronRevisar06 reparte la tentativa de la red */
(() => {
  const ahora = Date.parse('2026-11-15T12:09:00Z');   // 15-nov 06:09
  const reservas = [res('Z13 - Narama - 623', '2026-11-14', '2026-11-15'), res('Q', '2026-11-14', '2026-11-16')];
  const schedules = [fila('sc_red_1', '2026-11-15', 'Z13 - Narama - 623', { origen: 'red' })];
  const c = caja({ ahora, cfg: { reservas, reservasSync: '2026-11-15 06:00', vendors: [TEC, ADM], schedules } });
  c.ctx.syncReservas = () => ({ ok: true, reservas });
  c.ctx.cancelarHuerfanas_ = (ex) => ({ lista: ex, canceladas: [] });
  c.ctx.SCHED.revisionMatutina = o => {
    ok(!o.existentes.some(s => s.origen === 'red'), 'la 6 am no ve la tentativa de la red: la reparte de nuevo');
    return { nuevas: [{ fecha: '2026-11-15', propiedad: 'Z13 - Narama - 623', vendorEmail: 'tec@x', tipo: 'Limpieza', estado: 'confirmada', origen: 'motor-am' }], sinAsignar: [], alertas: [] };
  };
  c.ctx.cronRevisar06();
  const l = c.cfg().schedules;
  ok(l.length === 1 && l[0].origen === 'motor-am' && l[0].estado === 'confirmada', 'y queda confirmada (con su correo), sin la fila de la red repetida');
})();

process.exit(fallo);
