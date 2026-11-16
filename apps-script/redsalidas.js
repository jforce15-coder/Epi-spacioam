/* ═══ RED DE SALIDAS (Juan, 16-nov-2026: «que no vuelva a pasar jamás») ═══════════════════════════════════════════
   Qué pasó: el 15-nov salió un huésped de Narama 623 y su limpieza no se hizo ni se programó.
     · 13-nov 18:42 · la sincronización de reservas cortó a media paginación (Hospitable no entregó una página) y GUARDÓ
       lo poco que llegó como si fuera todo: 1 reserva. El motor de las 6 pm programó 0 limpiezas y, como reemplaza todo
       lo no notificado, borró las tentativas del 14 y del 15 (entre ellas Narama 623).
     · 14-nov 18:41 · otra lectura cortada guardó 0 reservas: «No programé nada». El 15 amaneció sin ruta.
     · 15-nov 06:09 · la revisión de la mañana repartió 18, pero ya no cabían 10 (Narama 623 entre ellas): quedaron solo
       en la bitácora. La verificación de las 7:00 mandó un correo («25 sin programar») que nadie vio a tiempo.
   Tres capas para que no se repita:
     1. Lectura confiable (syncReservas → resPagina_ y resLecturaDudosa_): cada página se reintenta (429, 5xx, red) y
        una lectura incompleta o con una caída brusca de salidas NO pisa la copia buena.
     2. Cerrojo de reemplazo (cronProgramar18 → redCerrojoReemplazo_): si el plan nuevo deja sin limpieza muchas
        salidas que el plan anterior cubría, se conserva el plan anterior.
     3. Red de salidas (redSalidas_): la noche anterior (después del reparto de las 6 pm) y la mañana (verificación de
        las 7:00) cada salida del día tiene que tener su limpieza confirmada y con persona. Si falta, el motor la
        propone como TENTATIVA (origen «red», nadie recibe correo hasta que el administrador la confirme) y se avisa:
        correo a los administradores desde aquí, y tarjeta «Necesita tu sí» en Pendientes desde el Hub, que pide la
        acción «redSalidas» a las 7:00 y a las 19:00 (Hub: apps-script/redsalidas.js).
   Check con dobles: .github/red-salidas.js. */

var RES_REINTENTOS_MS_ = [0, 2000, 6000];   // la página se pide hasta 3 veces
var RES_CAIDA_MIN_ = 8;                     // la caída brusca solo cuenta si antes había al menos 8 salidas en 7 días
var RES_CAIDA_PROP_ = "EPI_RES_CAIDA";      // lecturas seguidas con caída brusca (a la 4.ª, ~12 h, se acepta)
var RED_COPIA_MAX_H_ = 12;                  // la última copia buena sirve para programar si tiene menos de 12 h
var RED_FRESCA_H_ = 1.5;                    // con una copia de menos de 1.5 h, la red no vuelve a leer Hospitable

/* ── Capa 1 · lectura confiable ── */

/* Una página de reservas con reintentos. Devuelve el JSON o null si Hospitable no la entregó. */
function resPagina_(url, token) {
  for (var i = 0; i < RES_REINTENTOS_MS_.length; i++) {
    if (RES_REINTENTOS_MS_[i]) Utilities.sleep(RES_REINTENTOS_MS_[i]);
    var res;
    try {
      res = uf_(url, { method: "get", headers: { "Authorization": "Bearer " + token, "Accept": "application/json" }, muteHttpExceptions: true });
    } catch (e) { continue; }   // corte de red o cupo: se reintenta
    var code = res.getResponseCode();
    if (code === 200) { try { return JSON.parse(res.getContentText()); } catch (e2) { return null; } }
    if (code !== 429 && code < 500) return null;   // 4xx: reintentar no lo arregla
  }
  return null;
}

/* ¿Hay que desconfiar de esta lectura? Devuelve el porqué (texto) o "". */
function resLecturaDudosa_(limpias, fallos, hoy) {
  if (fallos && fallos.length) return "Hospitable no entregó " + fallos.length + " página(s) de reservas (" + fallos.slice(0, 3).join(", ") + ").";
  var fin = SCHED.shift(hoy, 7);
  function proximas(lista) {
    return (lista || []).filter(function (r) { var co = String(r && r.checkOut || "").slice(0, 10); return co >= hoy && co <= fin; }).length;
  }
  var prev = [];
  try { var c0 = getConfig(); prev = Array.isArray(c0.reservas) ? c0.reservas : []; } catch (e) {}
  var antes = proximas(prev), ahora = proximas(limpias);
  var P = PropertiesService.getScriptProperties();
  if (antes >= RES_CAIDA_MIN_ && ahora < antes * 0.5) {
    var n = Number(P.getProperty(RES_CAIDA_PROP_) || 0) + 1;
    if (n < 4) {
      P.setProperty(RES_CAIDA_PROP_, String(n));
      return "las salidas de los próximos 7 días bajaron de " + antes + " a " + ahora + " de una lectura a otra.";
    }
    try { bitLog_("error", "Las salidas de los próximos 7 días bajaron de " + antes + " a " + ahora + " en 4 lecturas seguidas: se acepta la lectura nueva.", "sync reservas"); } catch (e3) {}
  }
  if (P.getProperty(RES_CAIDA_PROP_)) P.deleteProperty(RES_CAIDA_PROP_);
  return "";
}

/* Horas desde la última copia buena («yyyy-MM-dd HH:mm», hora de Guatemala) o null. */
function redEdadH_(sello) {
  var m = String(sello || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  var t = Date.parse(m[1] + "T" + m[2] + ":" + m[3] + ":00-06:00");
  return isNaN(t) ? null : Math.max(0, (Date.now() - t) / 3600000);
}
function redHoras_(h) { return h == null ? "un tiempo que no sé" : (h < 1 ? "menos de 1 h" : Math.round(h) + " h"); }

/* Lo que dejó la sincronización: { ok, usable, reservas, edadH, error }.
   ok = lectura fresca y completa; usable = falló, pero la copia buena es reciente y no está vacía. */
function redLecturaDe_(sync, cfg) {
  var copia = Array.isArray(cfg && cfg.reservas) ? cfg.reservas : [];
  var edad = redEdadH_(cfg && cfg.reservasSync);
  if (sync && sync.ok) return { ok: true, usable: true, reservas: Array.isArray(sync.reservas) ? sync.reservas : copia, edadH: 0 };
  return { ok: false, usable: copia.length > 0 && edad != null && edad < RED_COPIA_MAX_H_, reservas: copia, edadH: edad,
           error: String((sync && sync.error) || "sin respuesta").slice(0, 200) };
}

/* ── Capa 2 · cerrojo de reemplazo ── */

/* El reparto de las 6 pm reemplaza lo no notificado de los próximos días. Si el plan nuevo deja sin limpieza al menos
   3 salidas (y más del 30 %) que el plan anterior cubría, se detiene. Devuelve el porqué o "". */
function redCerrojoReemplazo_(existentes, conservar, nuevas, hoy) {
  var quedan = {};
  (conservar || []).forEach(function (s) { if (s) quedan[s.id] = 1; });
  var reemplazadas = (existentes || []).filter(function (s) {
    return s && !quedan[s.id] && String(s.fecha || "").slice(0, 10) > hoy && String(s.estado || "") !== "cancelada" && !SCHED.esProfunda(s.tipo);
  });
  if (!reemplazadas.length) return "";
  var cubre = {};
  (nuevas || []).forEach(function (x) { cubre[String(x.fecha).slice(0, 10) + "|" + nk_(x.propiedad)] = 1; });
  var perdidas = reemplazadas.filter(function (s) { return !cubre[String(s.fecha).slice(0, 10) + "|" + nk_(s.propiedad)]; });
  if (perdidas.length >= 3 && perdidas.length > reemplazadas.length * 0.3)
    return "el plan nuevo dejaba sin limpieza " + perdidas.length + " de " + reemplazadas.length + " salidas ya programadas (" +
      perdidas.slice(0, 4).map(function (s) { return s.propiedad + " " + String(s.fecha).slice(0, 10); }).join(", ") + (perdidas.length > 4 ? "…" : "") + ").";
  return "";
}

/* ── Capa 3 · red de salidas ── */

/* ¿Esta fila deja la salida cubierta? Confirmada (o notificada) y con persona; lo que puso una persona cuenta, y una
   cancelación de una persona es una decisión. Una tentativa sin confirmar, una fila sin persona o una baja del
   sistema no cubren. */
function redCubre_(s) {
  if (!s) return false;
  if (String(s.estado || "") === "cancelada") return s.canceladaPor !== "sistema";
  if (!String(s.vendorEmail || s.vendorId || "").trim()) return false;
  if (s.origen === "manual" || s.origen === "hub" || s.origen === "visita") return true;
  return String(s.estado || "") === "confirmada" || !!s.notificadoEn;
}

/* La red de un día. o.lectura (de redLecturaDe_) evita leer Hospitable otra vez; o.tentativas = false no escribe.
   Devuelve { ok, fecha, lectura: {ok, edadH, error}, salidas, faltan: [{ propiedad, entradaHoy, propuesta, razon }], tentativas }. */
function redSalidas_(fecha, o) {
  o = o || {};
  var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
  fecha = /^\d{4}-\d{2}-\d{2}/.test(String(fecha || "")) ? String(fecha).slice(0, 10) : hoy;
  var cfg = getConfig();
  var lec = o.lectura;
  if (!lec) {
    var edad = redEdadH_(cfg.reservasSync);
    lec = (edad != null && edad < RED_FRESCA_H_ && Array.isArray(cfg.reservas) && cfg.reservas.length)
      ? { ok: true, usable: true, reservas: cfg.reservas, edadH: edad }
      : redLecturaDe_(syncReservas(21), cfg);
  }
  var reservas = (lec.reservas || []).filter(function (r) { return r && String(r.propiedad || "").trim(); });
  var props = Array.isArray(cfg.props) ? cfg.props : [];
  var vendors = Array.isArray(cfg.vendors) ? cfg.vendors : [];
  var lectura = { ok: !!lec.ok, edadH: lec.edadH == null ? null : Math.round(lec.edadH * 10) / 10, error: lec.ok ? "" : (lec.error || "") };
  /* Con una copia vieja (o ninguna) no se puede decir qué sale: se avisa de eso. */
  if (!lec.ok && !lec.usable) {
    try { bitLog_("error", "Red de salidas (" + fecha + "): no pude leer Hospitable y no hay copia reciente: no sé qué salidas hay.", "red de salidas"); } catch (e) {}
    return { ok: true, fecha: fecha, lectura: lectura, salidas: null, faltan: [], tentativas: 0 };
  }

  function revisar(schedules) {
    var requeridas = SCHED.limpiezasRequeridas({ reservas: reservas, props: props, desde: fecha, hasta: fecha });
    var cubre = {}, tent = {};
    schedules.forEach(function (s) {
      if (!s || String(s.fecha || "").slice(0, 10) !== fecha) return;
      var k = nk_(s.propiedad);
      if (redCubre_(s)) cubre[k] = 1;
      else if (String(s.estado || "") !== "cancelada" && String(s.vendorEmail || "").trim()) tent[k] = s;
    });
    return { requeridas: requeridas, faltan: requeridas.filter(function (x) { return !cubre[nk_(x.propiedad)]; }), tent: tent };
  }

  var schedules = Array.isArray(cfg.schedules) ? cfg.schedules : [];
  var rv = revisar(schedules), nuevas = [], razones = {};
  /* Tentativa solo con lectura fresca, para hoy o adelante, y solo lo que el motor puede cubrir. Con candado: el Hub y
     el reparto de las 6 pm pueden coincidir. */
  if (rv.faltan.length && lec.ok && fecha >= hoy && o.tentativas !== false) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(15000)) {
      try {
        var cfg2 = getConfig();
        schedules = Array.isArray(cfg2.schedules) ? cfg2.schedules : schedules;
        var r = SCHED.revisionMatutina({
          hoy: fecha, reservas: reservas, props: props, vendors: vendors, ratings: ratingsGuardados_(),
          ausencias: Array.isArray(cfg2.ausencias) ? cfg2.ausencias : [], existentes: schedules, pesoRating: 0.7
        });
        var marca = Date.now().toString(36);
        nuevas = (r.nuevas || []).map(function (x, i) {
          var y = Object.assign({}, x, { id: "sc_red_" + fecha.replace(/-/g, "") + "_" + marca + "_" + i, estado: "tentativa", origen: "red",
            motivo: "red de seguridad: salida sin limpieza" + (x.motivo ? " · " + x.motivo : "") });
          delete y.nuevaHoy;
          return y;
        });
        (r.sinAsignar || []).forEach(function (x) { if (x && x.lim) razones[nk_(x.lim.propiedad)] = x.razon || ""; });
        if (nuevas.length) {
          schedules = schedules.concat(nuevas);
          schedGuardar_(schedules, "Red de salidas — " + nuevas.length + " limpieza(s) tentativa(s) del " + fecha + " para revisar", "Sistema · red de salidas");
        }
      } finally { lock.releaseLock(); }
      rv = revisar(schedules);
    }
  }

  function nombreDe(em) {
    em = String(em || "").toLowerCase();
    for (var i = 0; i < vendors.length; i++) {
      if (String(vendors[i].email || "").toLowerCase() === em)
        return [vendors[i].primerNombre, vendors[i].primerApellido].filter(Boolean).join(" ") || vendors[i].name || em;
    }
    return em;
  }
  var faltan = rv.faltan.map(function (x) {
    var t = rv.tent[nk_(x.propiedad)];
    return { propiedad: x.propiedad, entradaHoy: !!x.entradaHoy, propuesta: t ? nombreDe(t.vendorEmail) : "",
             razon: t ? "" : (razones[nk_(x.propiedad)] || "sin persona") };
  });
  try {
    bitLog_("programacion", "Red de salidas (" + fecha + ") — " + rv.requeridas.length + " salidas · " + faltan.length +
      " sin limpieza confirmada" + (nuevas.length ? " · " + nuevas.length + " tentativa(s) nuevas" : "") +
      (lec.ok ? "" : " · con la copia de hace " + redHoras_(lec.edadH)) +
      (faltan.length ? ": " + faltan.map(function (f) { return f.propiedad + (f.propuesta ? " (tentativa: " + f.propuesta + ")" : " (" + f.razon + ")"); }).join(" | ") : "."),
      "red de salidas", { faltan: faltan.length, tentativas: nuevas.length });
  } catch (eB) {}
  return { ok: true, fecha: fecha, lectura: lectura, salidas: rv.requeridas.length, faltan: faltan, tentativas: nuevas.length };
}

/* El resultado en texto para un correo (vacío si todo está cubierto y la lectura fue buena). */
function redTexto_(red) {
  if (!red || !red.ok) return "";
  var L = [];
  if (!red.lectura.ok) L.push("No pude leer Hospitable (" + (red.lectura.error || "sin respuesta") + ")" +
    (red.salidas == null ? ": no sé qué salidas hay el " + red.fecha + ". Revisa Programación." : "; reviso con la copia de hace " + redHoras_(red.lectura.edadH) + "."));
  if (red.faltan.length) {
    L.push("SALIDAS DEL " + red.fecha + " SIN LIMPIEZA CONFIRMADA (" + red.faltan.length + ")");
    red.faltan.forEach(function (f) {
      L.push("• " + f.propiedad + (f.entradaHoy ? " · TIENE ENTRADA ESE DÍA" : "") + " — " +
        (f.propuesta ? "tentativa con " + f.propuesta + ": confírmala y envía la ruta" : "sin persona (" + f.razon + "): asígnala a mano"));
    });
    L.push("Entra a Programación (" + EMAIL_APP_URL + ") para confirmarlas.");
  }
  return L.join("\n");
}

/* Correo a los administradores con lo que encontró la red (solo si hay algo). */
function redAvisarCorreo_(vendors, red) {
  var txt = redTexto_(red);
  if (!txt) return false;
  var admins = (vendors || []).filter(function (v) { return v && v.isAdmin && v.active && v.email; }).map(function (v) { return v.email; });
  if (!admins.length) return false;
  notify({ to: admins, subject: "Salidas del " + red.fecha + " sin limpieza confirmada" + (red.faltan.length ? " (" + red.faltan.length + ")" : ""), body: txt });
  return true;
}
