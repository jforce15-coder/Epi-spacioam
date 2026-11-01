/* ═══ ANÁLISIS AUTOMÁTICO DE SOLICITUDES DE REVISIÓN (Hub issue #345) ═════════════════════════════════════
   Cuando un técnico pide revisar una calificación, el sistema junta el contexto y decide solo cuando está CLARO:
     · el huésped se quejó de algo de mantenimiento ......... excluida (no cuenta para el promedio)
     · se quejó de un tercero (recepción, edificio, ingreso) . excluida
     · el equipo ya había reportado eso antes del check-in ... excluida
   Si hay duda (evidencia mixta, o se queja de limpieza) la deja PENDIENTE con su resumen para que Juan apruebe o
   rechace. Todo queda escrito con sus razones y se puede revertir desde «Solicitudes de revisión».
   Primera fase: solo texto (review completo, reportes de mantenimiento y del equipo en la hoja Reportes).
   Pendiente para después: notas privadas de la reserva y fotos de la limpieza.
   La parte de decidir (acAnalizar_) no toca hojas: recibe la solicitud, la review y los reportes. */

var AC_TEMAS_ = [
  { clase: "tercero", tema: "recepción o edificio", pal: ["recepcion", "recepcionista", "lobby", "porteria", "portero", "conserje", "edificio", "ascensor", "elevador", "vecino", "estacionamiento", "parqueo", "seguridad del edificio", "check-in tardio", "llave", "ingreso", "entrada al edificio", "administracion del edificio"] },
  { clase: "mantenimiento", tema: "agua o plomería", pal: ["fuga", "gotea", "goteo", "gotera", "tuberia", "drenaje", "desague", "coladera", "inodoro", "sanitario", "agua caliente", "sin agua", "presion del agua", "regadera", "ducha no", "lavamanos tapado"] },
  { clase: "mantenimiento", tema: "humedad, moho o plagas", pal: ["moho", "hongo", "humedad", "plaga", "cucaracha", "hormiga", "chinche", "mosquito", "insecto", "roedor", "rata", "raton"] },
  { clase: "mantenimiento", tema: "aparatos o instalaciones", pal: ["aire acondicionado", "ac no", "calentador", "refrigerador", "nevera", "lavadora", "secadora", "estufa", "horno", "microondas", "televisor", "tv no", "wifi", "internet", "cerradura", "puerta no", "ventana no", "roto", "rota", "danado", "danada", "no funciona", "no sirve", "descompuesto", "bombillo", "luz no", "electric", "enchufe", "cortina rota"] },
  { clase: "mantenimiento", tema: "ruido u olor del edificio", pal: ["olor a drenaje", "olor a cloaca", "olor a gas", "ruido de obra", "obras", "construccion"] },
  { clase: "limpieza", tema: "limpieza", pal: ["sucio", "sucia", "suciedad", "polvo", "pelo", "cabello", "mancha", "manchado", "manchada", "pegajoso", "grasa", "basura", "sabanas sucias", "toallas sucias", "baño sucio", "bano sucio", "no estaba limpio", "no estaba limpia", "mal olor", "olor desagradable", "telarana", "limpieza"] }
];

function acNorm_(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

/* Qué temas aparecen en un texto: [{clase, tema, palabras:[…]}]. */
function acTemas_(texto) {
  var t = " " + acNorm_(texto) + " ", out = [];
  AC_TEMAS_.forEach(function (g) {
    var hit = g.pal.filter(function (p) { return t.indexOf(acNorm_(p)) >= 0; });
    if (hit.length) out.push({ clase: g.clase, tema: g.tema, palabras: hit });
  });
  return out;
}

function acDias_(a, b) {  /* días entre dos fechas yyyy-MM-dd (b − a) */
  var x = new Date(String(a).slice(0, 10) + "T12:00:00"), y = new Date(String(b).slice(0, 10) + "T12:00:00");
  return (isNaN(x) || isNaN(y)) ? null : Math.round((y - x) / 86400000);
}

/* Decide. caso: la solicitud; review: la fila de «Reviews» (o null); reportes: filas de «Reportes».
   Devuelve { veredicto, auto, razones[], resumen }.
   veredicto: mantenimiento · tercero · reporte_previo · limpieza · dudoso · sin_texto */
function acAnalizar_(caso, review, reportes) {
  var razones = [];
  var texto = review ? (review.comentario || "") : "";
  var temas = acTemas_(texto);
  var cl = {}; temas.forEach(function (x) { cl[x.clase] = x; });
  var ci = String((caso && caso.checkIn) || (review && review.checkIn) || "").slice(0, 10);
  var prop = acNorm_(caso && caso.propiedad).replace(/[^a-z0-9]/g, "");

  /* Lo que ya estaba reportado en esa propiedad en los 30 días antes del check-in. */
  var previos = [];
  (reportes || []).forEach(function (r) {
    if (!r || !r.fecha || acNorm_(r.propiedad).replace(/[^a-z0-9]/g, "") !== prop) return;
    var d = acDias_(r.fecha, ci);
    if (d == null || d < 0 || d > 30) return;
    var cat = acNorm_(r.categoria), esMant = cat.indexOf("manten") >= 0 || cat.indexOf("repar") >= 0;
    var tr = acTemas_([r.descripcion, r.comentarios, typeof r.danios === "string" ? r.danios : JSON.stringify(r.danios || "")].join(" "));
    temas.forEach(function (t) {
      if (t.clase === "limpieza") return;
      var coincide = tr.some(function (x) { return x.tema === t.tema; });
      if (coincide || (esMant && t.clase === "mantenimiento")) previos.push({ r: r, tema: t.tema, mant: esMant, dias: d });
    });
  });

  var hayQuejaNoLimpieza = !!(cl.tercero || cl.mantenimiento);
  var hayLimpieza = !!cl.limpieza;
  var out;

  if (!review || !String(texto).trim()) {
    out = { veredicto: "sin_texto", auto: false };
    razones.push(review ? "La review no trae comentario escrito, no hay de qué agarrarse." : "No se encontró la review en la hoja Reviews.");
  } else if (hayLimpieza && hayQuejaNoLimpieza) {
    out = { veredicto: "dudoso", auto: false };
    razones.push("El huésped mezcla quejas de limpieza con " + [cl.tercero, cl.mantenimiento].filter(Boolean).map(function (x) { return x.tema; }).join(" y ") + ".");
  } else if (hayLimpieza) {
    out = { veredicto: "limpieza", auto: false };
    razones.push("El huésped se queja de limpieza (" + cl.limpieza.palabras.slice(0, 3).join(", ") + "). Lo decides tú.");
  } else if (previos.length) {
    var p = previos[0];
    out = { veredicto: "reporte_previo", auto: true };
    razones.push("El equipo ya había reportado «" + p.tema + "» " + p.dias + " día(s) antes del check-in (reporte " + p.r.id + ", " + (p.mant ? "mantenimiento" : "limpieza") + ").");
  } else if (cl.tercero) {
    out = { veredicto: "tercero", auto: true };
    razones.push("La queja es de un tercero (" + cl.tercero.palabras.slice(0, 3).join(", ") + "), no de la limpieza.");
  } else if (cl.mantenimiento) {
    out = { veredicto: "mantenimiento", auto: true };
    razones.push("La queja es de mantenimiento: " + cl.mantenimiento.tema + " (" + cl.mantenimiento.palabras.slice(0, 3).join(", ") + ").");
  } else {
    out = { veredicto: "dudoso", auto: false };
    razones.push("El comentario no deja claro de qué fue la queja.");
  }
  if (review && review.ratingGeneral != null && review.ratingLimpieza != null && review.ratingLimpieza >= 4)
    razones.push("Ojo: la nota de limpieza fue " + review.ratingLimpieza + " (no es baja).");
  if (caso && caso.motivo) razones.push("El técnico dice: «" + String(caso.motivo).slice(0, 160) + "»");
  out.razones = razones;
  out.resumen = razones.join(" ");
  return out;
}

/* Lee los reportes que sirven de evidencia (solo columnas de texto, sin fotos). */
function acLeerReportes_() {
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Reportes");
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(600, sh.getLastRow() - 1), ini = sh.getLastRow() - n + 1;
  var tz = Session.getScriptTimeZone();
  var vals = sh.getRange(ini, 1, n, 16).getValues();
  return vals.map(function (v) {
    var f = v[3]; if (f instanceof Date) f = Utilities.formatDate(f, tz, "yyyy-MM-dd");
    return { id: String(v[0]), propiedad: String(v[2] || ""), fecha: String(f || "").slice(0, 10), categoria: String(v[4] || ""),
             descripcion: String(v[6] || ""), comentarios: String(v[7] || ""), danios: String(v[14] || "") };
  });
}

/* Se llama al guardar las solicitudes: analiza las nuevas y resuelve solas las claras. Nunca rompe el guardado. */
function acAplicar_(list) {
  try {
    var nuevas = (list || []).filter(function (c) { return c && (c.estado || "pendiente") === "pendiente" && !c.analisis && c.tipo !== "asignacion"; });
    if (!nuevas.length) return list;
    var revs = {}; rvReadSheet_(true).forEach(function (r) { revs[r.id] = r; });
    var reps = acLeerReportes_(), hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    nuevas.forEach(function (c) {
      try {
        var a = acAnalizar_(c, revs[c.reviewId] || null, reps);
        c.analisis = a.resumen; c.veredicto = a.veredicto;
        if (a.auto && c.tipo !== "aclaracion") {
          c.estado = "excluida"; c.automatica = "sí";
          c.decision = "Análisis automático (" + a.veredicto.replace("_", " ") + "): " + a.resumen;
          c.resueltaPor = "Alma · análisis automático"; c.fechaResol = hoy;
        }
      } catch (e) { console.error("acAplicar_ caso " + c.id + ": " + e); }
    });
  } catch (e) { console.error("acAplicar_: " + e); }
  return list;
}

/* Prueba a mano desde el editor: corre acPrueba() y mira el registro. */
function acPrueba() {
  var rev = { comentario: "La recepción tardó una hora en darnos la llave y el aire acondicionado no funciona.", ratingLimpieza: 3 };
  console.log(JSON.stringify(acAnalizar_({ propiedad: "X", checkIn: "2026-10-01", motivo: "no es de limpieza" }, rev, [])));
}
