/* ═══════════════════════════════════════════════════════════════════════════
   MOTOR DE PROGRAMACIÓN — Spacio AM
   ES5 puro, sin dependencias. El mismo código corre en el navegador (window.SCHED)
   y dentro de Apps Script (pegado en Code.gs) para las corridas de 6pm y 6am.

   Entra: reservas de Hospitable, propiedades, técnicos, rating de 5 semanas,
          ausencias aprobadas y lo ya programado.
   Sale:  una asignación por limpieza, con el motivo de la decisión, más las que
          no se pudieron asignar y las alertas de saturación.

   Reglas que gobiernan el reparto, en orden de fuerza:
     1. Una limpieza con entrada el mismo día va primero, siempre.
     2. Nadie recibe más trabajo del que cabe entre 11:00 y 15:00.
     3. Se agrupa por edificio, luego zona, luego zona de preferencia.
     4. Mejor rating de las últimas 5 semanas = preferencia por más limpiezas.
     5. Quien va abajo en la semana se compensa.
     6. Se rota: la preferencia no es exclusividad.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  /* ─── Jornada ───────────────────────────────────────────────────────────── */
  var HORA_INI = "11:00";
  var HORA_FIN = "15:00";
  var JORNADA_MIN = 240;      /* 11:00 → 15:00 */
  var TOLERANCIA_MIN = 45;    /* jornada extendida, se marca como tal */
  var MAX_DIA_DEF = 2;        /* tope normal */
  var MAX_DIA_TOPE = 4;       /* solo si no queda alternativa */
  /* Primer día que el motor puede programar. Antes de esta fecha la operación
     todavía se coordinaba a mano, así que nada se agenda hacia atrás. */
  var INICIO = "2026-07-31";

  var PROFUNDA_CADA_DIAS = 30;
  var DIAS_HORIZONTE = 3;

  /* Minutos de trabajo según habitaciones. Es lo que hace que dos limpiezas
     grandes no quepan juntas sin que haya que escribir esa regla aparte. */
  function minutosLimpieza(habitaciones, tipo) {
    if (esProfunda(tipo)) return 200;
    var h = Math.max(1, Math.min(6, parseInt(habitaciones, 10) || 1));
    return 45 + 25 * h;
  }
  function esProfunda(tipo) { return String(tipo || "").toLowerCase().indexOf("profunda") >= 0; }

  /* ─── Geografía de Guatemala ────────────────────────────────────────────
     Coordenadas aproximadas del centro de cada zona/municipio. Se usan solo
     para estimar traslados: no hace falta precisión de calle, hace falta no
     mandar a nadie de la zona 16 a Antigua en el mismo turno. */
  var ZONA_COORD = {
    Z1:  [14.6410, -90.5133], Z2:  [14.6470, -90.5170], Z3:  [14.6330, -90.5290],
    Z4:  [14.6220, -90.5150], Z5:  [14.6180, -90.5050], Z6:  [14.6540, -90.5010],
    Z7:  [14.6300, -90.5450], Z8:  [14.6150, -90.5320], Z9:  [14.6060, -90.5180],
    Z10: [14.5960, -90.5120], Z11: [14.6000, -90.5480], Z12: [14.5870, -90.5450],
    Z13: [14.5830, -90.5230], Z14: [14.5830, -90.5060], Z15: [14.5910, -90.4870],
    Z16: [14.6060, -90.4650], Z17: [14.6380, -90.4560], Z18: [14.6600, -90.4700],
    Z19: [14.6520, -90.5560], Z21: [14.5700, -90.5300], Z24: [14.5620, -90.5560],
    MIXCO: [14.6300, -90.6060], SANLUCAS: [14.6120, -90.6570], ANTIGUA: [14.5586, -90.7295],
    CES: [14.5450, -90.4400], FRAIJANES: [14.4700, -90.4400], PINULA: [14.5720, -90.4760],
    VILLANUEVA: [14.5260, -90.5870]
  };
  /* Nombre legible de cada zona para la interfaz — las claves son para el motor. */
  var ZONA_LABEL = {
    MIXCO: "Mixco", SANLUCAS: "San Lucas", ANTIGUA: "Antigua",
    CES: "Carretera a El Salvador", FRAIJANES: "Fraijanes",
    PINULA: "Santa Catarina Pinula", VILLANUEVA: "Villa Nueva"
  };
  function zonaLabel(z) { var k = zonaKey(z); return ZONA_LABEL[k] || k; }
  /* Las zonas en uso son las del portafolio — nunca un catálogo inventado. */
  function zonasEnUso(props) {
    var vistas = {}, out = [];
    for (var i = 0; i < (props || []).length; i++) {
      var n = (props[i] && (props[i].name || props[i].nombre)) || "";
      var z = zonaKey(partes(n).zona);
      if (!z || vistas[z]) continue;
      vistas[z] = 1; out.push(z);
    }
    out.sort(function (a, b) {
      var na = a.match(/^Z(\d+)$/), nb = b.match(/^Z(\d+)$/);
      if (na && nb) return parseInt(na[1], 10) - parseInt(nb[1], 10);
      if (na) return -1;
      if (nb) return 1;
      return a < b ? -1 : 1;
    });
    return out;
  }
  /* Nombres alternativos que aparecen en los nombres de propiedad. */
  var ZONA_ALIAS = {
    "ZONA1":"Z1","ZONA4":"Z4","ZONA9":"Z9","ZONA10":"Z10","ZONA11":"Z11","ZONA13":"Z13",
    "ZONA14":"Z14","ZONA15":"Z15","ZONA16":"Z16","Z013":"Z13","Z010":"Z10",
    "CARRETERAAELSALVADOR":"CES","CARRETERAELSALVADOR":"CES","KM15":"CES","SANTACATARINAPINULA":"PINULA",
    "LAANTIGUA":"ANTIGUA","ANTIGUAGUATEMALA":"ANTIGUA","SANLUCASSACATEPEQUEZ":"SANLUCAS"
  };
  function zonaKey(z) {
    var s = String(z || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return "";
    if (ZONA_ALIAS[s]) return ZONA_ALIAS[s];
    if (ZONA_COORD[s]) return s;
    var m = s.match(/^Z0*(\d{1,2})$/);
    if (m && ZONA_COORD["Z" + parseInt(m[1], 10)]) return "Z" + parseInt(m[1], 10);
    return s;
  }
  function km(a, b) {
    var A = ZONA_COORD[a], B = ZONA_COORD[b];
    if (!A || !B) return null;
    var R = 6371, dLat = (B[0] - A[0]) * Math.PI / 180, dLon = (B[1] - A[1]) * Math.PI / 180;
    var la = A[0] * Math.PI / 180, lb = B[0] * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /* Traslado en minutos entre dos paradas. Mismo edificio casi no cuesta;
     dentro de la zona son 12; fuera se calcula por distancia con tráfico de
     ciudad (4 min/km) y nunca baja de 15. */
  function travelMin(desde, hacia) {
    if (!desde) return 0;
    if (desde.zonasBase) return travelDesdeBase(desde.zonasBase, hacia);
    if (desde.edificio && hacia.edificio && norm(desde.edificio) === norm(hacia.edificio)) return 5;
    var za = zonaKey(desde.zona), zb = zonaKey(hacia.zona);
    if (za && za === zb) return 12;
    var d = km(za, zb);
    if (d === null) return 35;
    return Math.max(15, Math.round(d * 4));
  }
  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  /* Primera parada del día: no hay traslado real que cobrar, pero sí importa qué tan
     lejos queda de las zonas del técnico. Sin esto, la primera limpieza del día parecía
     "cercana" siempre y se podía mandar a alguien de la zona 13 hasta Antigua. */
  function travelDesdeBase(zonas, hacia) {
    var zb = zonaKey(hacia.zona), mejor = null;
    for (var i = 0; i < (zonas || []).length; i++) {
      var z = zonaKey(zonas[i]);
      if (!z) continue;
      if (z === zb) return 0;
      var d = km(z, zb);
      if (d === null) continue;
      var m = Math.round(d * 4);
      if (mejor === null || m < mejor) mejor = m;
    }
    return mejor === null ? 35 : mejor;
  }

  /* ─── Nombre de la propiedad → zona · edificio · unidad ──────────────────
     "Z10 - Airali - 1508" → zona Z10 · edificio Airali · unidad 1508 */
  function partes(nombre) {
    var s = String(nombre || "").trim();
    if (!s) return { zona: "", edificio: "", unidad: "", full: "" };
    var p = s.split(/\s*[-\u2013\u2014]\s*/).filter(function (x) { return x !== ""; });
    if (p.length >= 3) return { zona: p[0], edificio: p[1], unidad: p.slice(2).join(" - "), full: s };
    if (p.length === 2) return { zona: p[0], edificio: p[1], unidad: "", full: s };
    return { zona: "", edificio: p[0] || s, unidad: "", full: s };
  }

  /* ─── Fechas ────────────────────────────────────────────────────────────── */
  function iso(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fecha(s) { return new Date(String(s).slice(0, 10) + "T12:00:00"); }
  function shift(s, n) { var d = fecha(s); d.setDate(d.getDate() + n); return iso(d); }
  function dias(a, b) { return Math.round((fecha(b) - fecha(a)) / 86400000); }
  function diaSemana(s) { return fecha(s).getDay(); }
  /* Hora de Guatemala (UTC-6, sin horario de verano) — el navegador puede estar
     en otra zona y las corridas de 6pm/6am no pueden depender de eso. */
  function ahoraGT() {
    var n = new Date();
    return new Date(n.getTime() + (n.getTimezoneOffset() - 360) * 60000);
  }
  function hoyGT() { return iso(ahoraGT()); }

  /* ─── Limpiezas que exige el calendario ─────────────────────────────────
     Cada checkout genera una limpieza tradicional. Si ese mismo día entra otro
     huésped en la misma propiedad, la limpieza es de entrada el mismo día:
     prioridad absoluta. */
  function limpiezasRequeridas(o) {
    var reservas = o.reservas || [], desde = o.desde, hasta = o.hasta;
    var props = indexarProps(o.props || []);
    var out = [], vistos = {};
    for (var i = 0; i < reservas.length; i++) {
      var r = reservas[i];
      if (!r || !r.checkOut) continue;
      var f = String(r.checkOut).slice(0, 10);
      if (f < desde || f > hasta) continue;
      var nombre = String(r.propiedad || "").trim();
      if (!nombre) continue;
      var k = f + "|" + norm(nombre);
      if (vistos[k]) continue;
      vistos[k] = 1;
      var p = partes(nombre);
      var cfg = props[norm(nombre)] || {};
      /* Propiedad en pausa: no entra al reparto automático. Se usa para estancias
         largas (Mónaco) y para apartamentos fuera de servicio. */
      if (enPausa(cfg, f)) continue;
      out.push({
        key: k,
        fecha: f,
        propiedad: nombre,
        zona: p.zona, edificio: p.edificio, unidad: p.unidad,
        habitaciones: parseInt(r.habitaciones || cfg.cuartos || cfg.habitaciones || 1, 10) || 1,
        tipo: "Limpieza",
        entradaHoy: hayEntrada(reservas, nombre, f),
        codigoAcceso: cfg.codigoAcceso || r.codigoAcceso || "",
        reservaId: r.id || ""
      });
    }
    return out;
  }
  /* ─── Pausa de programación de una propiedad ─────────────────────────────
     pausa:{desde,hasta} — sin fechas es indefinida; solo `desde` es "a partir de";
     solo `hasta` es "hasta esa fecha". Mientras esté en pausa la propiedad no se
     programa: ni limpieza de checkout ni profunda. */
  function enPausa(prop, f) {
    if (!prop) return false;
    var p = prop.pausa;
    if (!p || !p.activa) return false;
    var d = String(f || "").slice(0, 10);
    var desde = String(p.desde || "").slice(0, 10);
    var hasta = String(p.hasta || "").slice(0, 10);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    return true;
  }

  function hayEntrada(reservas, nombre, f) {
    for (var i = 0; i < reservas.length; i++) {
      var r = reservas[i];
      if (!r || !r.checkIn) continue;
      if (norm(r.propiedad) !== norm(nombre)) continue;
      if (String(r.checkIn).slice(0, 10) === f) return true;
    }
    return false;
  }
  function indexarProps(props) {
    var ix = {};
    for (var i = 0; i < props.length; i++) {
      var p = props[i]; if (!p) continue;
      ix[norm(p.name || p.nombre)] = p;
      /* El conteo de cuartos de la propiedad se llama `cuartos` en la ficha. */
    }
    return ix;
  }

  /* ─── Limpiezas profundas ───────────────────────────────────────────────
     Una por propiedad cada ~30 días, montada sobre un día en que ya hay
     limpieza tradicional ahí, para un técnico distinto y en el mismo horario. */
  function agregarProfundas(limpiezas, o) {
    var props = o.props || [], historial = o.historial || [], hoy = o.hoy;
    /* Cada profunda ocupa el turno completo de un técnico: si se programaran todas
       las que "toca" el mismo día, el equipo entero quedaría en profundas y las
       limpiezas de checkout se caerían. Se limitan por día y se atienden primero
       las propiedades que llevan más tiempo sin una. */
    var maxPorDia = Math.max(1, parseInt(o.maxPorDia, 10) || 1);
    /* Y solo en días holgados: si las limpiezas de checkout ya consumen buena parte
       de la capacidad del equipo, ese día no se monta ninguna profunda. */
    var capacidadDia = parseInt(o.capacidadDia, 10) || 0;
    var cargaDia = {};
    for (var ci0 = 0; ci0 < limpiezas.length; ci0++) {
      var lc = limpiezas[ci0];
      cargaDia[lc.fecha] = (cargaDia[lc.fecha] || 0) + minutosLimpieza(lc.habitaciones, lc.tipo);
    }
    function diaHolgado(f) {
      if (!capacidadDia) return true;
      /* Una profunda ocupa un turno completo: debe caber además de lo ya previsto. */
      return (cargaDia[f] || 0) + minutosLimpieza(1, "profunda") <= capacidadDia * 0.85;
    }
    var ultima = {};
    for (var i = 0; i < historial.length; i++) {
      var h = historial[i];
      if (!h || !esProfunda(h.tipo || h.categoria)) continue;
      var k = norm(h.propiedad), f = String(h.fecha || "").slice(0, 10);
      if (!k || !f) continue;
      if (!ultima[k] || f > ultima[k]) ultima[k] = f;
    }
    var extra = [];
    var porProp = {};
    for (var j = 0; j < limpiezas.length; j++) {
      var c = limpiezas[j];
      if (esProfunda(c.tipo)) continue;
      var kk = norm(c.propiedad);
      if (!porProp[kk] || c.fecha < porProp[kk].fecha) porProp[kk] = c;
    }
    var candidatas = [];
    for (var pk in porProp) {
      if (!porProp.hasOwnProperty(pk)) continue;
      var base = porProp[pk];
      var prev = ultima[pk];
      /* Sin historial: se programa la primera. Con historial: cuando ya pasaron
         los ~30 días (se acepta desde el día 26 para poder montarla sobre una
         limpieza real en lugar de esperar una fecha exacta). */
      if (prev && dias(prev, base.fecha) < PROFUNDA_CADA_DIAS - 4) continue;
      candidatas.push({ pk: pk, base: base, prev: prev || "" });
    }
    /* La que lleva más tiempo sin profunda va primero. */
    candidatas.sort(function (a, b) {
      if (a.prev !== b.prev) return a.prev < b.prev ? -1 : 1;
      return a.base.fecha < b.base.fecha ? -1 : 1;
    });
    var porDia = {};
    for (var ci = 0; ci < candidatas.length; ci++) {
      var cand = candidatas[ci];
      var base = cand.base, prev = cand.prev, pk = cand.pk;
      porDia[base.fecha] = (porDia[base.fecha] || 0);
      if (porDia[base.fecha] >= maxPorDia) continue;
      if (!diaHolgado(base.fecha)) continue;
      porDia[base.fecha]++;
      extra.push({
        key: base.fecha + "|" + pk + "|prof",
        fecha: base.fecha, propiedad: base.propiedad,
        zona: base.zona, edificio: base.edificio, unidad: base.unidad,
        habitaciones: base.habitaciones,
        tipo: "Limpieza Profunda",
        entradaHoy: base.entradaHoy,
        codigoAcceso: base.codigoAcceso,
        parDe: base.key,
        ultimaProfunda: prev
      });
    }
    return limpiezas.concat(extra);
  }

  /* ─── Estado de cada técnico ────────────────────────────────────────────── */
  function esLimpieza(v) {
    return !!v && v.tipo === "interno" && v.active !== false &&
           String(v.categoria || "").toLowerCase().indexOf("limpieza") >= 0;
  }
  function zonasDe(v, campo) {
    var z = (v && v[campo]) || [];
    if (typeof z === "string") z = z.split(/[,;]/);
    var out = [];
    for (var i = 0; i < z.length; i++) { var k = zonaKey(z[i]); if (k) out.push(k); }
    return out;
  }
  function ausente(v, f, ausencias) {
    var em = String(v.email || "").toLowerCase();
    for (var i = 0; i < (ausencias || []).length; i++) {
      var a = ausencias[i];
      if (!a || a.estado !== "aprobada") continue;
      if (String(a.vendorEmail || "").toLowerCase() !== em) continue;
      if (String(a.fecha || "").slice(0, 10) === f) return true;
    }
    return false;
  }
  function descansa(v, f) {
    var d = (v && v.descansos) || [];
    return d.indexOf(diaSemana(f)) >= 0;
  }

  /* Rating normalizado 0..1 sobre las últimas 5 semanas. Sin datos → 0.6,
     ni castigo ni premio: nadie debe perder trabajo por falta de reviews. */
  var RATING_MIN_N = 5;   /* reseñas para que una nota valga por sí sola */

  function ratingNorm(email, ratings) {
    var r = (ratings || {})[String(email || "").toLowerCase()];
    if (!r || !r.n) return 0.6;
    /* Un 5.00 sacado de una sola reseña no puede pesar igual que un 5.00 de nueve:
       la nota se encoge hacia el centro del equipo (4.6) según cuántas reseñas la
       respaldan. Protege en los dos sentidos — ni una reseña perfecta suelta gana
       todo el trabajo, ni una mala reseña suelta hunde a alguien. */
    var n = Math.max(0, r.n || 0), score = Number(r.score);
    if (isFinite(score) && n > 0 && n < RATING_MIN_N) {
      var k = RATING_MIN_N - n;
      r = { score: (score * n + 4.6 * k) / RATING_MIN_N, n: n };
    }
    var s = parseFloat(r.score);
    if (isNaN(s)) return 0.6;
    return Math.max(0, Math.min(1, (s - 3) / 2));   /* 3.0★ → 0 · 5.0★ → 1 */
  }

  var ROT_DIAS = 30;   /* ventana de rotación */

  /* Reparto histórico de un técnico en los últimos ROT_DIAS: cuántas veces estuvo
     en cada zona y en cada apartamento. De aquí sale la rotación — que nadie se
     quede pegado a una zona ni repita el mismo apartamento muchas veces.
     Cuenta lo ya programado (existentes) y lo efectivamente trabajado (historial). */
  function rotacionReciente(email, existentes, historial, hoy) {
    var em = String(email || "").toLowerCase();
    var tot = 0, porZona = {}, porProp = {};
    function suma(propiedad, zona, fechaStr) {
      var f = String(fechaStr || "").slice(0, 10);
      if (!f || dias(f, hoy) > ROT_DIAS || f > hoy) return;
      var z = zonaKey(zona || partes(propiedad).zona);
      if (z) porZona[z] = (porZona[z] || 0) + 1;
      var pk = norm(propiedad);
      if (pk) porProp[pk] = (porProp[pk] || 0) + 1;
      tot++;
    }
    for (var i = 0; i < (existentes || []).length; i++) {
      var s = existentes[i];
      if (!s || String(s.vendorEmail || "").toLowerCase() !== em) continue;
      suma(s.propiedad, s.zona, s.fecha);
    }
    for (var j = 0; j < (historial || []).length; j++) {
      var h = historial[j];
      if (!h || String(h.reportadoPor || h.vendorEmail || "").toLowerCase() !== em) continue;
      if (esProfunda(h.tipo || h.categoria)) continue;
      suma(h.propiedad, h.zona, h.fecha);
    }
    return { porZona: porZona, porProp: porProp, total: tot };
  }

  /* Semana ISO (lunes) — la compensación se mide de lunes a domingo. */
  function lunesDe(f) {
    var d = fecha(f), n = d.getDay(), diff = (n === 0 ? -6 : 1 - n);
    d.setDate(d.getDate() + diff); return iso(d);
  }
  function cargaSemana(email, existentes, f) {
    var em = String(email || "").toLowerCase(), lun = lunesDe(f), dom = shift(lun, 6), n = 0;
    for (var i = 0; i < (existentes || []).length; i++) {
      var s = existentes[i];
      if (!s || String(s.vendorEmail || "").toLowerCase() !== em) continue;
      var sf = String(s.fecha).slice(0, 10);
      if (sf >= lun && sf <= dom) n++;
    }
    return n;
  }

  /* Desempate estable: dos corridas del mismo día dan el mismo resultado. */
  function hash(s) {
    var h = 0, t = String(s || "");
    for (var i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
    return Math.abs(h % 1000) / 1000;
  }

  /* ═══ El reparto de un día ═══════════════════════════════════════════════ */
  function planearDia(o) {
    var f = o.fecha;
    var limpiezas = (o.limpiezas || []).slice();
    var vendors = (o.vendors || []).filter(esLimpieza);
    var ratings = o.ratings || {};
    var existentes = o.existentes || [];
    var ausencias = o.ausencias || [];
    var pesoRating = (o.pesoRating == null ? 0.7 : o.pesoRating);

    /* Prioridad: primero las que tienen entrada el mismo día, luego el resto de
       tradicionales de mayor a menor, y las PROFUNDAS al final — nunca deben
       desplazar una limpieza de checkout ni saturar una ruta. Si no caben, se
       posponen: una profunda puede pasar de los 30 días sin problema. */
    limpiezas.sort(function (a, b) {
      var pa = esProfunda(a.tipo), pb = esProfunda(b.tipo);
      if (pa !== pb) return pa ? 1 : -1;
      if (!!b.entradaHoy !== !!a.entradaHoy) return b.entradaHoy ? 1 : -1;
      if (b.habitaciones !== a.habitaciones) return b.habitaciones - a.habitaciones;
      return a.propiedad < b.propiedad ? -1 : 1;
    });

    /* Estado por técnico para este día. */
    var est = {};
    var disponibles = [];
    for (var i = 0; i < vendors.length; i++) {
      var v = vendors[i], em = String(v.email || "").toLowerCase();
      var bloqueado = ausente(v, f, ausencias) || descansa(v, f);
      /* La preferencia se limita a las zonas realmente asignadas: una zona quitada
         no puede seguir dando ventaja ni servir de punto de partida. */
      var zAsig = zonasDe(v, "zonas");
      var zPref = zonasDe(v, "zonasPref").filter(function (z) { return zAsig.indexOf(z) >= 0; });
      est[em] = {
        v: v, email: em,
        zonas: zAsig,
        pref: zPref,
        maxDia: Math.max(1, parseInt(v.maxDia, 10) || MAX_DIA_DEF),
        puedeProfunda: v.puedeProfunda !== false,
        usados: 0, minutos: 0, paradas: [],
        base: { zonasBase: zPref.concat(zAsig) },
        semana: cargaSemana(em, existentes, f),
        rating: ratingNorm(em, ratings),
        rot: rotacionReciente(em, existentes, o.historial, o.hoy || f),
        bloqueado: bloqueado,
        motivoBloqueo: ausente(v, f, ausencias) ? "ausencia aprobada" : (descansa(v, f) ? "día de descanso" : "")
      };
      if (!bloqueado) disponibles.push(est[em]);
    }

    /* Lo que ya está fijado ese día (asignado a mano o ya enviado por correo) ocupa
       cupo real: si no se contara, el motor volvería a llenar a esa persona. */
    var fijos = o.fijos || [];
    for (var fj = 0; fj < fijos.length; fj++) {
      var sf = fijos[fj];
      var efj = est[String(sf.vendorEmail || "").toLowerCase()];
      if (!efj) continue;
      efj.usados++;
      efj.minutos += minutosLimpieza(sf.habitaciones, sf.tipo);
      efj.paradas.push({ zona: sf.zona, edificio: sf.edificio, propiedad: sf.propiedad });
    }

    var avgSemana = 0;
    if (disponibles.length) {
      for (var j = 0; j < disponibles.length; j++) avgSemana += disponibles[j].semana;
      avgSemana = avgSemana / disponibles.length;
    }

    var asignaciones = [], sinAsignar = [], postergadas = [];

    for (var c = 0; c < limpiezas.length; c++) {
      var lim = limpiezas[c];
      /* PRIMERA RONDA ANTES QUE LA SEGUNDA — regla de reparto.
         Nadie recibe una segunda limpieza mientras haya alguien que pueda hacer
         esta y todavía no tenga ninguna. Se calcula el piso de la ronda entre
         quienes realmente podrían tomarla (zona, cupo, jornada) y solo ellos
         compiten. Sin esto, agrupar por edificio hacía que dos o tres técnicos
         se llevaran el día entero y el resto quedara en cero. */
      var piso = rondaMin(lim, disponibles, { asignaciones: asignaciones, permitirExceso: false });
      var res = piso == null ? { tec: null, razon: "" } : elegir(lim, disponibles, {
        avgSemana: avgSemana, pesoRating: pesoRating,
        asignaciones: asignaciones, permitirExceso: false, soloRonda: piso
      });
      if (!res.tec) res = elegir(lim, disponibles, {
        avgSemana: avgSemana, pesoRating: pesoRating,
        asignaciones: asignaciones, permitirExceso: false
      });
      /* Segunda pasada: si nadie cabe con el tope normal, se abre hasta 4 y se
         avisa al administrador. Nunca para una profunda: esa se posterga. */
      if (!res.tec && !esProfunda(lim.tipo)) {
        res = elegir(lim, disponibles, {
          avgSemana: avgSemana, pesoRating: pesoRating,
          asignaciones: asignaciones, permitirExceso: true
        });
      }
      if (!res.tec) {
        /* Una profunda no asignada no es una falta: queda pendiente para el próximo
           día en que haya limpieza en esa propiedad y espacio en la ruta. */
        var razonBase = res.razon || "Sin técnico disponible";
        var conZona = 0;
        for (var cz = 0; cz < disponibles.length; cz++) {
          if (disponibles[cz].zonas.indexOf(zonaKey(lim.zona)) >= 0) conZona++;
        }
        if (!conZona) razonBase = "Ningún técnico tiene " + zonaLabel(lim.zona) + " asignada — asignar a mano";
        if (esProfunda(lim.tipo)) postergadas.push({ lim: lim, razon: res.razon || "Sin espacio en la ruta" });
        else sinAsignar.push({ lim: lim, razon: razonBase });
        continue;
      }

      var t = res.tec;
      var prevParada = t.paradas.length ? t.paradas[t.paradas.length - 1] : t.base;
      var viaje = travelMin(prevParada, lim);
      var mins = minutosLimpieza(lim.habitaciones, lim.tipo);
      var primeraParada = t.paradas.length === 0;
      t.paradas.push({ zona: lim.zona, edificio: lim.edificio, propiedad: lim.propiedad });
      t.usados++;
      t.minutos += mins + (primeraParada ? 0 : viaje);
      asignaciones.push({
        key: lim.key, fecha: f, propiedad: lim.propiedad,
        zona: lim.zona, edificio: lim.edificio, unidad: lim.unidad,
        habitaciones: lim.habitaciones, tipo: lim.tipo,
        entradaHoy: !!lim.entradaHoy,
        codigoAcceso: lim.codigoAcceso || "",
        vendorEmail: t.email, vendorId: t.v.id,
        hora: HORA_INI, horaFin: HORA_FIN,
        orden: t.usados, minutos: mins, viaje: viaje,
        excedeJornada: t.minutos > JORNADA_MIN,
        sobreTope: t.usados > MAX_DIA_DEF,
        motivo: res.motivo,
        parDe: lim.parDe || "", reservaId: lim.reservaId || ""
      });
    }

    /* Alertas del día. */
    var alertas = [];
    var capacidadMin = disponibles.length * JORNADA_MIN;
    var demandaMin = 0;
    for (var q = 0; q < limpiezas.length; q++) demandaMin += minutosLimpieza(limpiezas[q].habitaciones, limpiezas[q].tipo);
    if (sinAsignar.length) {
      alertas.push({
        nivel: "critica", fecha: f, tipo: "saturacion",
        msg: sinAsignar.length + " limpieza" + (sinAsignar.length === 1 ? "" : "s") + " sin técnico el " + f +
             ". Hay que bloquear calendario o traer refuerzo.",
        detalle: sinAsignar.map(function (x) { return x.lim.propiedad + (esProfunda(x.lim.tipo) ? " (profunda)" : ""); })
      });
    } else if (demandaMin > capacidadMin * 0.9 && disponibles.length) {
      alertas.push({
        nivel: "alta", fecha: f, tipo: "saturacion",
        msg: "El " + f + " la carga usa " + Math.round(demandaMin / capacidadMin * 100) +
             "% de la capacidad del equipo. Considera bloquear calendario."
      });
    }
    for (var w = 0; w < asignaciones.length; w++) {
      if (asignaciones[w].sobreTope) {
        alertas.push({
          nivel: "alta", fecha: f, tipo: "tope",
          msg: "A " + nombreDe(asignaciones[w].vendorEmail, vendors) + " se le asignaron " +
               contar(asignaciones, asignaciones[w].vendorEmail) + " limpiezas el " + f +
               " porque no quedaba alternativa."
        });
        break;
      }
    }
    /* La profunda cuya tradicional no se pudo asignar no tiene sentido. */
    asignaciones = asignaciones.filter(function (a) {
      if (!a.parDe) return true;
      for (var z = 0; z < asignaciones.length; z++) if (asignaciones[z].key === a.parDe) return true;
      return false;
    });

    return { fecha: f, asignaciones: asignaciones, sinAsignar: sinAsignar, postergadas: postergadas, alertas: alertas,
             capacidadMin: capacidadMin, demandaMin: demandaMin, disponibles: disponibles.length };
  }

  function contar(asig, email) {
    var n = 0; for (var i = 0; i < asig.length; i++) if (asig[i].vendorEmail === email) n++; return n;
  }
  function nombreDe(email, vendors) {
    for (var i = 0; i < vendors.length; i++) {
      if (String(vendors[i].email || "").toLowerCase() === email) {
        return [vendors[i].primerNombre, vendors[i].primerApellido].filter(Boolean).join(" ") || vendors[i].name || email;
      }
    }
    return email;
  }

  /* ─── Piso de ronda: la menor cantidad de limpiezas que ya lleva alguien que
     PUEDE tomar esta. Devuelve null si nadie puede. Repite los filtros duros de
     elegir() — zona, cupo, jornada y las reglas de profunda. */
  function rondaMin(lim, candidatos, ctx) {
    var min = null, esProf = esProfunda(lim.tipo);
    for (var i = 0; i < candidatos.length; i++) {
      var t = candidatos[i];
      var tope = ctx.permitirExceso ? Math.min(MAX_DIA_TOPE, Math.max(t.maxDia, MAX_DIA_DEF + 2)) : t.maxDia;
      if (t.usados >= tope) continue;
      if (esProf && !t.puedeProfunda) continue;
      if (lim.parDe && yaTieneKey(ctx.asignaciones, t.email, lim.parDe)) continue;
      if (esProf && t.usados > 0) continue;
      if (!esProf && tieneProfunda(ctx.asignaciones, t.email)) continue;
      var z = zonaKey(lim.zona);
      if (!z || t.zonas.indexOf(z) < 0) continue;
      var primera = t.paradas.length === 0;
      var viaje = travelMin(primera ? t.base : t.paradas[t.paradas.length - 1], lim);
      var total = t.minutos + (primera ? 0 : viaje) + minutosLimpieza(lim.habitaciones, lim.tipo);
      if (total > JORNADA_MIN + (ctx.permitirExceso ? TOLERANCIA_MIN : 0)) continue;
      if (min === null || t.usados < min) min = t.usados;
      if (min === 0) return 0;
    }
    return min;
  }

  /* ─── Elegir técnico para una limpieza ──────────────────────────────────── */
  function elegir(lim, candidatos, ctx) {
    var mejor = null, mejorScore = -1e9, razon = "Sin técnico disponible";
    var esProf = esProfunda(lim.tipo);

    for (var i = 0; i < candidatos.length; i++) {
      var t = candidatos[i];
      var tope = ctx.permitirExceso ? Math.min(MAX_DIA_TOPE, Math.max(t.maxDia, MAX_DIA_DEF + 2)) : t.maxDia;
      if (t.usados >= tope) { razon = "Todos con su cupo lleno"; continue; }
      /* Ronda: mientras alguien elegible siga en cero, los que ya tienen esperan. */
      if (ctx.soloRonda != null && t.usados > ctx.soloRonda) continue;
      if (esProf && !t.puedeProfunda) continue;
      /* La profunda va a un técnico distinto del de la tradicional del mismo día. */
      if (lim.parDe && yaTieneKey(ctx.asignaciones, t.email, lim.parDe)) continue;
      if (esProf && t.usados > 0) continue;      /* la profunda ocupa el turno completo */
      if (!esProf && tieneProfunda(ctx.asignaciones, t.email)) continue;

      var prev = t.paradas.length ? t.paradas[t.paradas.length - 1] : t.base;
      var primera = t.paradas.length === 0;
      var viaje = travelMin(prev, lim);
      var mins = minutosLimpieza(lim.habitaciones, lim.tipo);
      /* El viaje desde casa no consume jornada; el de entre paradas sí. */
      var totalMin = t.minutos + (primera ? 0 : viaje) + mins;
      var limite = JORNADA_MIN + (ctx.permitirExceso ? TOLERANCIA_MIN : 0);
      if (totalMin > limite) { razon = "No cabe en la jornada de nadie"; continue; }

      var z = zonaKey(lim.zona);
      var s = 0, notas = [];

      /* REGLA DURA: solo se asigna dentro de las zonas que el técnico tiene
         marcadas. Sin la zona no es candidato — ni por cercanía, ni por falta de
         alternativa, ni en la segunda pasada. Lo que sigue solo ordena entre los
         que ya pueden trabajar ahí. */
      if (!z || t.zonas.indexOf(z) < 0) continue;

      /* Agrupación geográfica de la ruta del día: juntar paradas es lo que ahorra
         traslado, así que pesa más que la preferencia. */
      if (!primera && prev.edificio && lim.edificio && norm(prev.edificio) === norm(lim.edificio)) { s += 40; notas.push("mismo edificio"); }
      else if (!primera && zonaKey(prev.zona) === z && z) { s += 26; notas.push("misma zona"); }

      /* La preferencia da prioridad DENTRO de sus zonas, sin volverse jaula: el
         bono es moderado para que la rotación pueda ganarle. */
      if (t.pref.indexOf(z) >= 0) { s += 14; notas.push("zona de preferencia"); }
      else { s += 6; notas.push("zona asignada"); }

      s -= viaje * 0.5;

      /* Rating de las últimas 5 semanas. */
      s += t.rating * ctx.pesoRating * 34;
      if (t.rating >= 0.8) notas.push("rating alto");

      /* Compensación semanal. */
      var dif = ctx.avgSemana - t.semana;
      s += dif * 8;
      if (dif >= 1) notas.push("va abajo esta semana");

      /* Rotación por zona: cuando una zona ya domina el mes de un técnico, cede el
         turno. Es lo que evita que varios con la misma preferencia se queden
         siempre con la misma zona. */
      if (t.rot.total >= 5 && z) {
        var shareZ = (t.rot.porZona[z] || 0) / t.rot.total;
        if (shareZ > 0.45) { s -= Math.min(26, (shareZ - 0.45) * 70); notas.push("rotación de zona"); }
      }
      /* Rotación por apartamento: repetir el mismo apartamento se penaliza de forma
         creciente. Un apartamento visto muchas veces se deja de mirar con ojo
         fresco, y la supervisión pierde valor. */
      var vecesProp = t.rot.porProp[norm(lim.propiedad)] || 0;
      if (vecesProp >= 2) { s -= Math.min(20, (vecesProp - 1) * 7); notas.push("ya lo limpió " + vecesProp + " veces este mes"); }

      if (ctx.soloRonda != null && t.usados === ctx.soloRonda) notas.push(t.usados === 0 ? "primera limpieza del día" : "ronda " + (t.usados + 1));
      s -= t.usados * 7;
      if (t.usados >= MAX_DIA_DEF) { s -= 40; notas.push("sobre el tope de " + MAX_DIA_DEF); }
      s += hash(t.email + lim.key) * 0.9;

      if (s > mejorScore) { mejorScore = s; mejor = t; razon = ""; mejor.__notas = notas; }
    }
    return {
      tec: mejor, razon: razon,
      motivo: mejor ? (mejor.__notas || []).join(" · ") : ""
    };
  }
  function yaTieneKey(asig, email, key) {
    for (var i = 0; i < asig.length; i++) if (asig[i].vendorEmail === email && asig[i].key === key) return true;
    return false;
  }
  function tieneProfunda(asig, email) {
    for (var i = 0; i < asig.length; i++) if (asig[i].vendorEmail === email && esProfunda(asig[i].tipo)) return true;
    return false;
  }

  /* ═══ Corrida completa: los próximos N días ══════════════════════════════
     Solo el día siguiente se considera firme y se notifica. Los demás quedan
     como tentativos: se validan la noche anterior a las 6pm. */
  function programar(o) {
    var hoy = o.hoy || hoyGT();
    var n = o.dias || DIAS_HORIZONTE;
    /* offset 1 = la corrida normal de las 6pm (mañana en adelante).
       offset 0 = incluir hoy, para simulacros y para la revisión matutina. */
    var off = (o.offset == null ? 1 : o.offset);
    var desde = shift(hoy, off), hasta = shift(hoy, off + n - 1);
    var manuales = (o.existentes || []).filter(function (s) { return s && s.origen === "manual"; });
    var congelados = (o.existentes || []).filter(function (s) {
      /* Lo ya confirmado y notificado no se toca: el técnico ya lo tiene. */
      return s && s.estado === "confirmada" && String(s.fecha).slice(0, 10) <= hoy;
    });
    var previos = (o.existentes || []).filter(function (s) {
      return s && String(s.fecha).slice(0, 10) < desde;
    });

    var base = limpiezasRequeridas({ reservas: o.reservas, props: o.props, desde: desde, hasta: hasta });
    var equipo = (o.vendors || []).filter(esLimpieza).length;
    base = agregarProfundas(base, {
      props: o.props, historial: (o.historial || []).concat(previos), hoy: hoy,
      maxPorDia: Math.max(1, Math.floor(equipo / 5)),
      capacidadDia: equipo * JORNADA_MIN
    });

    var salida = [], alertas = [], sinAsignar = [], postergadas = [], resumen = [];
    var acumulado = previos.slice();

    for (var d = off; d < off + n; d++) {
      var f = shift(hoy, d);
      if (f < INICIO) continue;
      var delDia = base.filter(function (x) { return x.fecha === f; });
      /* Lo que el administrador puso a mano manda: se respeta y ocupa cupo. */
      var manualesDia = manuales.filter(function (s) { return String(s.fecha).slice(0, 10) === f; });
      /* Lo ya notificado no se reparte de nuevo: esa ruta el técnico ya la tiene. */
      var notificadasDia = (o.existentes || []).filter(function (s) {
        return s && s.notificadoEn && s.origen !== "manual" && String(s.fecha).slice(0, 10) === f;
      });
      var fijosDia = manualesDia.concat(notificadasDia);
      var yaCubiertas = {};
      for (var m = 0; m < fijosDia.length; m++) yaCubiertas[norm(fijosDia[m].propiedad) + "|" + fijosDia[m].tipo] = 1;
      delDia = delDia.filter(function (x) { return !yaCubiertas[norm(x.propiedad) + "|" + x.tipo]; });

      var r = planearDia({
        fecha: f, hoy: hoy, limpiezas: delDia, vendors: o.vendors,
        ratings: o.ratings, ausencias: o.ausencias, historial: o.historial,
        fijos: fijosDia,
        existentes: acumulado.concat(fijosDia), pesoRating: o.pesoRating
      });
      /* Solo el día siguiente se confirma y se notifica; los demás son tentativos. */
      var firme = (d <= 1);
      for (var a = 0; a < r.asignaciones.length; a++) {
        r.asignaciones[a].estado = firme ? "confirmada" : "tentativa";
        r.asignaciones[a].origen = "motor";
        r.asignaciones[a].generadoEn = hoy;
        salida.push(r.asignaciones[a]);
        acumulado.push(r.asignaciones[a]);
      }
      alertas = alertas.concat(r.alertas);
      for (var b = 0; b < r.sinAsignar.length; b++) sinAsignar.push(r.sinAsignar[b]);
      for (var pp = 0; pp < (r.postergadas || []).length; pp++) postergadas.push(r.postergadas[pp]);
      resumen.push({ fecha: f, firme: firme, total: r.asignaciones.length,
                     sinAsignar: r.sinAsignar.length, disponibles: r.disponibles,
                     uso: r.capacidadMin ? Math.round(r.demandaMin / r.capacidadMin * 100) : 0 });
    }

    return { generadoEn: hoy, desde: desde, hasta: hasta,
             asignaciones: salida, manuales: manuales, congelados: congelados,
             sinAsignar: sinAsignar, postergadas: postergadas, alertas: alertas, resumen: resumen };
  }

  /* ═══ Revisión de la mañana (6am) ════════════════════════════════════════
     Solo agrega lo que apareció después de la corrida de anoche. No mueve nada
     de lo que el técnico ya tiene confirmado. */
  function revisionMatutina(o) {
    if ((o.hoy || hoyGT()) < INICIO) return { nuevas: [], asignaciones: [], sinAsignar: [], alertas: [] };
    var hoy = o.hoy || hoyGT();
    var existentes = o.existentes || [];
    var base = limpiezasRequeridas({ reservas: o.reservas, props: o.props, desde: hoy, hasta: hoy });
    var yaHay = {};
    for (var i = 0; i < existentes.length; i++) {
      var s = existentes[i];
      if (!s || String(s.fecha).slice(0, 10) !== hoy) continue;
      yaHay[norm(s.propiedad)] = 1;
    }
    var nuevas = base.filter(function (x) { return !yaHay[norm(x.propiedad)]; });
    if (!nuevas.length) return { nuevas: [], alertas: [], sinAsignar: [] };

    var r = planearDia({
      fecha: hoy, hoy: hoy, limpiezas: nuevas, vendors: o.vendors,
      ratings: o.ratings, ausencias: o.ausencias, historial: o.historial, existentes: existentes,
      pesoRating: o.pesoRating
    });
    for (var a = 0; a < r.asignaciones.length; a++) {
      r.asignaciones[a].estado = "confirmada";
      r.asignaciones[a].origen = "motor-am";
      r.asignaciones[a].generadoEn = hoy;
      r.asignaciones[a].nuevaHoy = true;
    }
    return { nuevas: r.asignaciones, alertas: r.alertas, sinAsignar: r.sinAsignar };
  }

  /* ═══ Reajuste por ausencia ══════════════════════════════════════════════
     Reparte solo las limpiezas del técnico que falta, sin tocar a los demás.
     Devuelve la propuesta para que el administrador la apruebe. */
  function reajustePorAusencia(o) {
    var f = String(o.fecha).slice(0, 10);
    var em = String(o.vendorEmail || "").toLowerCase();
    var existentes = o.existentes || [];
    var afectadas = existentes.filter(function (s) {
      return s && String(s.fecha).slice(0, 10) === f && String(s.vendorEmail || "").toLowerCase() === em;
    });
    if (!afectadas.length) return { movimientos: [], sinAsignar: [], alertas: [] };

    var resto = existentes.filter(function (s) {
      return !(String(s.fecha).slice(0, 10) === f && String(s.vendorEmail || "").toLowerCase() === em);
    });
    var libres = (o.vendors || []).filter(function (v) { return String(v.email || "").toLowerCase() !== em; });

    var r = planearDia({
      fecha: f, hoy: o.hoy || hoyGT(),
      limpiezas: afectadas.map(function (s) {
        return { key: s.key || (f + "|" + norm(s.propiedad)), fecha: f, propiedad: s.propiedad,
                 zona: s.zona || partes(s.propiedad).zona, edificio: s.edificio || partes(s.propiedad).edificio,
                 unidad: s.unidad || "", habitaciones: s.habitaciones || 1, tipo: s.tipo,
                 entradaHoy: !!s.entradaHoy, codigoAcceso: s.codigoAcceso || "" };
      }),
      vendors: libres, ratings: o.ratings, historial: o.historial,
      ausencias: (o.ausencias || []).concat([{ vendorEmail: em, fecha: f, estado: "aprobada" }]),
      existentes: resto, pesoRating: o.pesoRating
    });

    var movimientos = [];
    for (var i = 0; i < r.asignaciones.length; i++) {
      var a = r.asignaciones[i];
      var orig = null;
      for (var j = 0; j < afectadas.length; j++) if (norm(afectadas[j].propiedad) === norm(a.propiedad)) { orig = afectadas[j]; break; }
      movimientos.push({
        scheduleId: orig ? orig.id : "", propiedad: a.propiedad, fecha: f, tipo: a.tipo,
        deEmail: em, aEmail: a.vendorEmail, aVendorId: a.vendorId,
        entradaHoy: a.entradaHoy, motivo: a.motivo, orden: a.orden
      });
    }
    return { movimientos: movimientos, sinAsignar: r.sinAsignar, alertas: r.alertas, afectadas: afectadas.length };
  }

  /* ─── Control de limpiezas profundas ───────────────────────────────────
     Por propiedad: cuándo fue la última, cuántos días lleva y cuál es la próxima
     ya programada. Una profunda atrasada no es un error del motor: significa que
     no hubo un día con limpieza en esa propiedad y espacio en la ruta. */
  function estadoProfundas(o) {
    var hoy = o.hoy || hoyGT();
    var props = o.props || [], historial = o.historial || [], programadas = o.programadas || [];
    var ultima = {}, prox = {};
    for (var i = 0; i < historial.length; i++) {
      var h = historial[i];
      if (!h || !esProfunda(h.tipo || h.categoria)) continue;
      var k = norm(h.propiedad), f = String(h.fecha || "").slice(0, 10);
      if (!k || !f || f > hoy) continue;
      if (!ultima[k] || f > ultima[k]) ultima[k] = f;
    }
    for (var j = 0; j < programadas.length; j++) {
      var s = programadas[j];
      if (!s || !esProfunda(s.tipo)) continue;
      var pk = norm(s.propiedad), pf = String(s.fecha || "").slice(0, 10);
      if (!pk || pf < hoy) continue;
      if (!prox[pk] || pf < prox[pk].fecha) prox[pk] = { fecha: pf, vendorEmail: s.vendorEmail || "", estado: s.estado || "" };
    }
    var out = [];
    for (var p = 0; p < props.length; p++) {
      var nombre = props[p].name || props[p].nombre || "";
      if (!nombre) continue;
      /* Una propiedad en pausa no debe salir como profunda vencida: no se programa. */
      if (enPausa(props[p], hoy)) continue;
      var key = norm(nombre);
      var u = ultima[key] || "";
      out.push({
        propiedad: nombre,
        ultima: u,
        diasDesde: u ? dias(u, hoy) : null,
        proxima: prox[key] || null,
        vencida: u ? dias(u, hoy) >= PROFUNDA_CADA_DIAS : true,
        atrasoDias: u ? Math.max(0, dias(u, hoy) - PROFUNDA_CADA_DIAS) : null
      });
    }
    out.sort(function (a, b) {
      if (!!b.vencida !== !!a.vencida) return b.vencida ? 1 : -1;
      var da = a.diasDesde == null ? 9999 : a.diasDesde;
      var db = b.diasDesde == null ? 9999 : b.diasDesde;
      return db - da;
    });
    return out;
  }

  /* ─── Ruta legible de un técnico para un día ─────────────────────────────
     Se usa en el correo, en el mensaje de WhatsApp y en la pantalla del técnico. */
  function rutaTexto(asignaciones, nombre, f) {
    var mias = asignaciones.filter(function (a) { return String(a.fecha).slice(0, 10) === f; })
      .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
    if (!mias.length) return "";
    var L = ["Hola " + (nombre || "") + ", tu programación del " + f + ":", ""];
    for (var i = 0; i < mias.length; i++) {
      var a = mias[i];
      L.push((i + 1) + ". " + a.propiedad + " — " + (a.habitaciones || 1) + " hab · " +
             a.tipo + (a.entradaHoy ? " · TIENE ENTRADA HOY" : "") +
             (a.codigoAcceso ? " · código " + a.codigoAcceso : ""));
    }
    L.push("");
    L.push("Horario: " + HORA_INI + " a " + HORA_FIN + ".");
    return L.join("\n");
  }

  root.SCHED = {
    HORA_INI: HORA_INI, HORA_FIN: HORA_FIN, JORNADA_MIN: JORNADA_MIN,
    MAX_DIA_DEF: MAX_DIA_DEF, MAX_DIA_TOPE: MAX_DIA_TOPE,
    PROFUNDA_CADA_DIAS: PROFUNDA_CADA_DIAS, INICIO: INICIO, ZONA_COORD: ZONA_COORD,
    zonaKey: zonaKey, zonaLabel: zonaLabel, zonasEnUso: zonasEnUso, travelMin: travelMin, minutosLimpieza: minutosLimpieza,
    esProfunda: esProfunda, partes: partes, esLimpieza: esLimpieza, enPausa: enPausa,
    hoyGT: hoyGT, ahoraGT: ahoraGT, shift: shift, lunesDe: lunesDe, dias: dias,
    limpiezasRequeridas: limpiezasRequeridas, agregarProfundas: agregarProfundas,
    planearDia: planearDia, programar: programar,
    revisionMatutina: revisionMatutina, reajustePorAusencia: reajustePorAusencia,
    rutaTexto: rutaTexto, ratingNorm: ratingNorm, cargaSemana: cargaSemana, RATING_MIN_N: RATING_MIN_N,
    rotacionReciente: rotacionReciente, ROT_DIAS: ROT_DIAS,
    estadoProfundas: estadoProfundas
  };
})(typeof window !== "undefined" ? window : this);
