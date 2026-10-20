function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

var SPREADSHEET_ID   = "1-SfKC-evkK24qfOrrvIrcDs6ckGAmRzSLS_IYB8cYZg";
var FOLDER_ID        = "11odF5bZPpxh_boSg1Emtfh8gA67yFL1j";
/* El token de Hospitable vive SOLO en Propiedades del script (nunca en el código).
   ⚙️ Configuración del proyecto → Propiedades del script → Agregar propiedad:
     HOSPITABLE_TOKEN = <tu token>
   Mientras no exista la propiedad, las funciones que usan Hospitable devuelven
   un error claro en vez de romperse. */
var HOSPITABLE_TOKEN = PropertiesService.getScriptProperties().getProperty("HOSPITABLE_TOKEN") || "";

/* ID del Sheet del dashboard de propietarios (mi-spacioam) — lectura pública.
   De aquí se trae el "Listing link" de cada propiedad. */
var OWNER_SHEET_ID = "1l9wLH8880NlN9ac2jvne2U6cqej6gycqAD77Z25cLF4";

function doGet(e)  { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  try {
    var p = e.postData ? JSON.parse(e.postData.contents) : e.parameter;
    var __diag = accesosDiag_(p); if (__diag) return __diag;   // fase 1b: resumen de accesos (robot)
    var __ses = sesionDe_(p); registrarAcceso_(p.action, !!__ses);   // fase 1b: aún no bloquea
    var r = {};
    /* Webhooks de Hospitable: su payload trae action = "review.created",
       "reservation.changed", etc. (con punto). Se atiende ANTES del router
       normal del app para que no choque con nuestras propias acciones. */
    if (p && typeof p.action === "string" && p.action.indexOf(".") > 0)
      return webhookHospitable_(p);
    if      (p.action === "getAll")         r = getAll({ light: truthy_(p.light), days: Number(p.days || 0), offset: Number(p.offset || 0), limit: Number(p.limit || 0) });
    else if (p.action === "getReport")      r = getReport_(p.id);
    else if (p.action === "saveReport")     r = saveReport(p.data);
    else if (p.action === "deleteReport")   r = deleteReport(p.id);
    else if (p.action === "getConfig")      r = getConfig({ slim: truthy_(p.slim) });
    else if (p.action === "getHeavy")       r = getHeavy_();
    else if (p.action === "saveConfig")     r = saveConfig(p.key, p.value);
    else if (p.action === "uploadFile")     r = uploadFile(p.b64, p.name, p.mime, p.subfolder);
    else if (p.action === "syncHospitable") r = syncHospitable(p.days || 14);
    else if (p.action === "syncReservas")    r = syncReservas(p.days || 21);
    else if (p.action === "programar")       r = cronProgramar18();
    else if (p.action === "revisarMatutina") r = cronRevisar06();
    else if (p.action === "syncProperties") r = syncPropertiesFull_();
    else if (p.action === "syncListings")   r = syncListingsFull_();
    else if (p.action === "syncReviews")    r = syncReviewsFull_(p.days || 365);
    else if (p.action === "diagReviews")    r = diagnosticoReviews();
    else if (p.action === "migrarReviews")  r = migrarReviewsAHoja();
    else if (p.action === "saveReviews")    r = saveReviews_(p.reviews);
    else if (p.action === "saveCasos")      r = saveCasos_(p.casos);
    else if (p.action === "fixEscalas")     r = corregirEscalas();
    else if (p.action === "testDrive")      r = testDrive();
    else if (p.action === "recoverPhotos")  r = recoverPhotos();
    else if (p.action === "notify")         r = notify(p);
    else if (p.action === "getBitacora")    r = bitLeer_(p.limit || 150);
    else if (p.action === "logEvento")      r = bitLog_(p.tipo, p.detalle, p.usuario, p.extra);
    else if (p.action === "ai")             r = aiSummary(p);
    else r = { error: "Unknown action: " + p.action };
    /* Fase 3: las lecturas nunca devuelven contraseñas de técnicos ni el PIN de admin (ya no se usan). */
    if (p.action === "getConfig" || p.action === "getHeavy" || p.action === "getAll") r = sinClaves_(r);
    /* Cualquier acción que escriba invalida el caché de arranque. */
    if (/^(save|delete|sync|migrar|fix|recover|programar|revisar)/.test(String(p.action)))
      cacheBump_();
    return out({ ok: true, data: r });
  } catch (err) {
    return out({ ok: false, error: err.toString() });
  }
}

function truthy_(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

/* ═══ CACHÉ DE ARRANQUE ═══
   La app tardaba minutos en conectar porque cada arranque volvía a leer hojas
   enteras. Ahora las respuestas de arranque se guardan en el caché del script
   por 90 segundos, partidas en trozos (el caché admite ~100 KB por llave), y
   cualquier escritura sube el contador de versión para invalidarlas. */
var CACHE_TTL = 90;
var CACHE_CHUNK = 90000;

function cacheVer_() {
  try { return PropertiesService.getScriptProperties().getProperty("CACHE_VER") || "0"; }
  catch (e) { return "0"; }
}
function cacheBump_() {
  try {
    var pr = PropertiesService.getScriptProperties();
    pr.setProperty("CACHE_VER", String(Number(pr.getProperty("CACHE_VER") || 0) + 1));
  } catch (e) {}
}
function cacheGet_(key) {
  try {
    var c = CacheService.getScriptCache(), k = key + ":" + cacheVer_();
    var n = Number(c.get(k + "_n") || 0);
    if (!n) return null;
    var ks = [];
    for (var i = 0; i < n; i++) ks.push(k + "_" + i);
    var got = c.getAll(ks), s = "";
    for (var j = 0; j < n; j++) {
      var part = got[k + "_" + j];
      if (part === null || part === undefined) return null;
      s += part;
    }
    return JSON.parse(s);
  } catch (e) { return null; }
}
function cachePut_(key, obj) {
  try {
    var s = JSON.stringify(obj);
    if (s.length > CACHE_CHUNK * 40) return;
    var c = CacheService.getScriptCache(), k = key + ":" + cacheVer_();
    var n = Math.ceil(s.length / CACHE_CHUNK), m = {};
    for (var i = 0; i < n; i++) m[k + "_" + i] = s.substr(i * CACHE_CHUNK, CACHE_CHUNK);
    m[k + "_n"] = String(n);
    c.putAll(m, CACHE_TTL);
  } catch (e) {}
}

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ═══ NUEVO — BLOQUE 1: Notificaciones por correo ═══ */
var TPL_PROG = {
  programacion: {
    asunto: function (d) { return "Tu programación del " + (d.dia || "") + " " + (d.fecha || ""); },
    cuerpo: function (d) {
      return "Hola " + (d.tecnico || "") + ",\n\nEsta es tu programación confirmada para el " +
        (d.dia || "") + " " + (d.fecha || "") + " — " + (d.total || "0") + " " +
        ((d.etiqueta || "limpieza") + (String(d.total) === "1" ? "" : "s")) + ", de " +
        (d.hora || "11:00 a 15:00") + ".\n\n" + (d.limpiezas || "") +
        "\n\nLas que dicen TIENE ENTRADA HOY son prioridad: el huésped llega ese mismo día.\n\n" +
        "Si no puedes trabajar ese día, avísanos desde la app cuanto antes.";
    }
  },
  programacionAnticipada: {
    asunto: function (d) { return "Tu programación del " + (d.dia || "") + " " + (d.fecha || "") + " — con anticipación"; },
    cuerpo: function (d) {
      return "Hola " + (d.tecnico || "") + ",\n\nTe adelantamos tu programación del " +
        (d.dia || "") + " " + (d.fecha || "") + " — " + (d.total || "0") + " limpieza(s), de " +
        (d.hora || "11:00 a 15:00") + ".\n\n" + (d.limpiezas || "") +
        "\n\nEs para que puedas organizarte con tiempo. Te la confirmamos el día anterior a las 6:00 pm; si entra una reserva nueva podría cambiar.\n\n" +
        "Si no puedes trabajar ese día, avísanos desde la app cuanto antes.";
    }
  },
  programacionCambio: {
    asunto: function (d) { return "Cambio en tu programación del " + (d.fecha || ""); },
    cuerpo: function (d) {
      return "Hola " + (d.tecnico || "") + ",\n\nTu programación del " + (d.dia || "") + " " +
        (d.fecha || "") + " cambió. Queda así — " + (d.total || "0") + " limpieza(s):\n\n" +
        (d.limpiezas || "") + "\n\nGracias por la flexibilidad.";
    }
  },
  ausencia: {
    asunto: function (d) { return "Ausencia reportada — " + (d.tecnico || "") + " · " + (d.fecha || ""); },
    cuerpo: function (d) {
      return (d.tecnico || "") + " avisó que no podrá trabajar el " + (d.fecha || "") + ".\n\n" +
        "Motivo: " + (d.motivo || "—") + "\n\n" +
        "Entra a Programación para revisar el reajuste que propuso el motor y aprobarlo.";
    }
  }
};

function notify(p) {
  var to = Array.isArray(p.to) ? p.to : [p.to];
  var subject = p.subject, htmlBody = null, textBody = null;

  /* 1º la plantilla de marca (html + texto). Aquí viven programación, calidad,
     adelantos y comprobantes: todos salen con el diseño de Spacio AM. */
  if (p.type) {
    try {
      var built = buildEmailByType_(p.type, p.data || {});
      if (built) { htmlBody = built.html; textBody = built.text; }
      if (!subject) subject = subjectForType_(p.type, p.data || {});
    } catch (eB) { htmlBody = null; }
  }
  /* 2º respaldo, para los avisos internos sin plantilla propia. Ya no sale como
     un bloque de texto con <br>: se arma con el mismo shell de marca, y las
     viñetas y las listas de propiedades se dibujan una por fila. */
  if (htmlBody === null && p.type && TPL_PROG[p.type] && !p.body) {
    var d = p.data || {};
    subject = subject || TPL_PROG[p.type].asunto(d);
    textBody = TPL_PROG[p.type].cuerpo(d);
  }
  if (htmlBody === null && textBody === null) textBody = String(p.body || "");
  subject = subject || "EPI App — Spacio AM";
  if (htmlBody === null) {
    try {
      var arm = emailShellFromText_(subject, textBody);
      htmlBody = arm.html; textBody = arm.text;
    } catch (eS) { htmlBody = String(textBody || "").replace(/\n/g, "<br>"); }
  }

  var sent = 0;
  to.filter(Boolean).forEach(function (t) {
    try {
      GmailApp.sendEmail(String(t), subject, textBody || "", {
        htmlBody: htmlBody, from: "hola@spacioam.com", name: "Spacio AM"
      });
      sent++;
    } catch (e) {
      /* Respaldo: si el alias fallara, enviar desde la cuenta normal */
      try {
        MailApp.sendEmail({ to: String(t), subject: subject, body: textBody || "", htmlBody: htmlBody, name: "Spacio AM" });
        sent++;
      } catch (e2) {}
    }
  });
  return { sent: sent };
}


/* Ejecuta esta función UNA VEZ desde el editor (▶ Ejecutar) para autorizar
   el permiso de enviar correos y probar que llegan. Cambia el correo por el tuyo. */
function testNotify() {
  var r = notify({ to: "hola@spacioam.com", subject: "Prueba EPI App", body: "Las notificaciones funcionan ✓" });
  Logger.log(r);
}

/* ═══ NUEVO — BLOQUE 2: Resumen IA ═══
   Requiere la propiedad de script ANTHROPIC_API_KEY
   (⚙️ Configuración del proyecto → Propiedades del script). */
function aiSummary(p) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en Propiedades del script");
  var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: String(p.prompt || "") }]
    }),
    muteHttpExceptions: true
  });
  var j = JSON.parse(resp.getContentText());
  registrarUsoIA_('Resumen IA', 'claude-sonnet-4-5', j.usage, String(p.contexto || p.tipo || (j.error ? 'error' : '')).slice(0, 100));
  if (j.error) throw new Error(j.error.message || "Error de Anthropic");
  return { text: (j.content && j.content[0] && j.content[0].text) || "" };
}

/* ═══ NUEVO — BLOQUE 3: Tareas programadas ═══
   Crear activadores en ⏰ Activadores (menú izquierdo):
   1) cronSyncHospitable  · por día · 3:00–4:00 a.m.
   2) cronSyncHospitable  · por día · 9:00–10:00 p.m.
   3) cronRecoverPhotos   · por horas · cada hora
   4) cronSyncProperties  · por día · 3:00–4:00 a.m.   (cuartos/baños/fotos del anuncio)
   Verifica zona horaria (GMT-6 Guatemala) en Configuración del proyecto. */
function cronSyncHospitable() {
  try {
    var r = syncHospitable(14);
    if (!r || !r.schedules || !r.schedules.length) return;
    var cfg = getConfig();
    var existing = Array.isArray(cfg.schedules) ? cfg.schedules : [];
    /* Conservar turnos creados a mano y las asignaciones previas de los de Hospitable */
    var manual = existing.filter(function (s) { return String(s.id || "").indexOf("hosp_") !== 0; });
    var prevById = {};
    existing.forEach(function (s) { if (String(s.id || "").indexOf("hosp_") === 0) prevById[s.id] = s; });
    var merged = manual.concat(r.schedules.map(function (s) {
      var prev = prevById[s.id];
      if (prev) {
        if (prev.vendorId)     s.vendorId     = prev.vendorId;
        if (prev.codigoAcceso) s.codigoAcceso = prev.codigoAcceso;
        if (prev.notas && !s.notas) s.notas   = prev.notas;
      }
      return s;
    }));
    schedGuardar_(merged, "Sincronización con Hospitable", "Sistema · sync");
  } catch (e) { console.error("cronSyncHospitable:", e); }
}

function cronRecoverPhotos() {
  try { recoverPhotos(); } catch (e) { console.error("cronRecoverPhotos:", e); }
}

/* ═══ NUEVO — BLOQUE 4: Sincronización de propiedades (cuartos/baños/fotos) ═══
   • Trae el "Listing link" de cada propiedad desde el Sheet del dashboard de
     propietarios (mi-spacioam), emparejando por nombre.
   • Raspa la página pública del anuncio (portfolio.spacioam.com) y extrae
     cuartos, baños y la galería de fotos de referencia. SIN token.
   • Guarda todo en la config "props" del app. Nunca borra ni renombra.
   Corre solo con el activador cronSyncProperties (ver BLOQUE 3). */
function cronSyncProperties() {
  try { syncPropertiesFull_(); } catch (e) { console.error("cronSyncProperties:", e); }
}

function syncPropertiesFull_() {
  var links = getOwnerListingLinks_();
  var cfg   = getConfig();
  var props = Array.isArray(cfg.props) ? cfg.props : [];
  var changed = 0;

  props = props.map(function (p) {
    var np = Object.assign({}, p);
    /* 1) Listing link desde el dashboard de propietarios */
    var lk = links[normName_(p.name)];
    if (lk && p.listingUrl !== lk) { np.listingUrl = lk; changed++; }
    /* 2) Raspar el portafolio (solo si el listingUrl es de portfolio.spacioam.com) */
    try {
      var info = scrapePortfolio_(np.listingUrl);
      if (info) {
        if (info.cuartos && Number(p.cuartos) !== info.cuartos) { np.cuartos = info.cuartos; changed++; }
        if (info.banos   && Number(p.banos)   !== info.banos)   { np.banos   = info.banos;   changed++; }
        if (info.fotos && info.fotos.length) {
          if (JSON.stringify(p.refFotos || []) !== JSON.stringify(info.fotos)) { np.refFotos = info.fotos; changed++; }
        }
      }
    } catch (e) { console.warn("portafolio " + p.name + ": " + e); }
    return np;
  });

  if (changed > 0) saveConfig("props", props);
  return { ok: true, changed: changed, propiedades: props.length };
}

/* ═══ NUEVO — Sincroniza la LISTA de propiedades desde la API de Hospitable ═══
   Trae todas las propiedades de la cuenta y las fusiona con la config "props":
     • AGREGA las que no existían (con cuartos/baños de Hospitable como base).
     • ACTUALIZA nombre, enlace del anuncio y dirección de las que ya existen.
     • CONSERVA intactas las fotos de referencia (refFotos/refImagenes) y los
       conteos de cuartos/baños que ya se cargaron a mano.
   Nunca borra ni renombra a la fuerza. El enlace del anuncio se toma primero del
   dashboard de propietarios (mismo origen que "Importar enlaces") y, si no está
   ahí, del que exponga la propia API. */
function syncListingsFull_() {
  var listings = fetchHospitableListings_();
  if (!listings.ok) return { ok: false, error: listings.error, added: 0, updated: 0 };
  var links = getOwnerListingLinks_();
  var cfg   = getConfig();
  var props = Array.isArray(cfg.props) ? cfg.props : [];

  var byHosp = {}, byName = {};
  props.forEach(function (p, i) {
    if (p.hospId) byHosp[String(p.hospId)] = i;
    byName[normName_(p.name)] = i;
  });

  var added = 0, updated = 0;
  listings.data.forEach(function (l) {
    var idx = (l.id && byHosp[String(l.id)] != null) ? byHosp[String(l.id)]
            : (byName[normName_(l.name)] != null ? byName[normName_(l.name)] : -1);
    var link = links[normName_(l.name)] || l.listingUrl || "";
    if (idx >= 0) {
      var p = props[idx], np = Object.assign({}, p), ch = false;
      if (!p.hospId && l.id)              { np.hospId = String(l.id); ch = true; }
      if (l.name && p.name !== l.name)    { np.name = l.name; ch = true; }
      if (link && p.listingUrl !== link)  { np.listingUrl = link; ch = true; }
      if (l.address && p.address !== l.address) { np.address = l.address; ch = true; }
      /* cuartos/baños/fotos: NO se tocan — son manuales/enriquecidos aparte */
      if (ch) { props[idx] = np; updated++; }
    } else {
      props.push({
        id: "p" + Date.now() + "_" + added,
        hospId: l.id ? String(l.id) : "",
        name: l.name,
        listingUrl: link,
        address: l.address || "",
        cuartos: l.bedrooms || 1,
        banos: l.bathrooms || 1,
        /* Fecha de alta: los dos primeros meses la propiedad no recibe profundas. */
        altaEn: Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd")
      });
      byName[normName_(l.name)] = props.length - 1;
      added++;
    }
  });

  if (added > 0 || updated > 0) saveConfig("props", props);
  return {
    ok: true, added: added, updated: updated, total: props.length, props: props,
    /* Lista CRUDA de Hospitable — la usa el front para las verificaciones
       (Hospitable ↔ dashboard y Hospitable ↔ lista importada). */
    hospitable: listings.data.map(function (l) {
      return { name: l.name, listingUrl: l.listingUrl || "", address: l.address || "" };
    })
  };
}

/* Trae TODAS las propiedades de Hospitable (API pública v2, paginada). */
function fetchHospitableListings_() {
  var token = HOSPITABLE_TOKEN || PropertiesService.getScriptProperties().getProperty("HOSPITABLE_TOKEN") || "";
  if (!token) return { ok: false, error: "Falta HOSPITABLE_TOKEN en Propiedades del script." };
  var out = [], page = 1, guard = 0;
  while (guard++ < 25) {
    var res = UrlFetchApp.fetch("https://public.api.hospitable.com/v2/properties?per_page=100&page=" + page, {
      method: "get",
      headers: { "Authorization": "Bearer " + token, "Accept": "application/json" },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode(), j = {};
    try { j = JSON.parse(res.getContentText()); } catch (e) {}
    if (code !== 200) return { ok: false, error: "Hospitable HTTP " + code + ": " + String((j && (j.message || j.error)) || "").slice(0, 140) };
    var data = j.data || j.properties || [];
    for (var i = 0; i < data.length; i++) out.push(normListing_(data[i]));
    var last = j.meta && (j.meta.last_page || (j.meta.pagination && j.meta.pagination.total_pages));
    if (!data.length || !last || page >= last) break;
    page++;
  }
  return { ok: true, data: out };
}

/* Normaliza una propiedad de Hospitable → {id,name,listingUrl,address,bedrooms,bathrooms}.
   Rutas defensivas: distintas cuentas exponen los campos distinto. */
function normListing_(p) {
  p = p || {};
  var name = p.name || p.public_name || p.private_name || p.nickname || p.internal_name || String(p.id || "");
  var caps = p.capacity || {};
  var bedrooms  = num_(p.bedrooms  != null ? p.bedrooms  : (caps.bedrooms  != null ? caps.bedrooms  : (p.rooms && p.rooms.bedrooms)));
  var bathrooms = num_(p.bathrooms != null ? p.bathrooms : (caps.bathrooms != null ? caps.bathrooms : (p.rooms && p.rooms.bathrooms)));
  var a = p.address || {};
  var address = (typeof a === "string") ? a
    : [a.street, a.line1, a.line2, a.apartment, a.city, a.state, a.country]
        .filter(function (x) { return x && String(x).trim(); }).join(", ");
  return {
    id: p.id ? String(p.id) : "",
    name: name,
    listingUrl: scanListingUrl_(p),
    address: address,
    bedrooms: bedrooms ? Math.round(bedrooms) : 0,
    bathrooms: bathrooms ? Math.ceil(bathrooms) : 0
  };
}
function num_(v) { var n = parseFloat(v); return (isFinite(n) && n > 0) ? n : 0; }
function scanListingUrl_(o) {
  function ok(u) { return typeof u === "string" && /^https?:\/\//.test(u); }
  var direct = o.public_url || o.listing_url || o.url;
  if (ok(direct)) return direct;
  var arrs = [o.listings, o.channels, o.channel_listings];
  for (var a = 0; a < arrs.length; a++) {
    var arr = arrs[a];
    if (Array.isArray(arr)) for (var i = 0; i < arr.length; i++) {
      var u = arr[i] && (arr[i].url || arr[i].public_url || arr[i].listing_url || arr[i].link);
      if (ok(u)) return u;
    }
  }
  return "";
}

/* Cron opcional — sincroniza la lista de propiedades una vez al día.
   Crea el activador: ⏰ Activadores → cronSyncListings · por día · 3-4 a.m. */
function cronSyncListings() {
  try { syncListingsFull_(); } catch (e) { console.error("cronSyncListings:", e); }
}

/* Raspa UNA página de portafolio → {cuartos, banos, fotos[]} */
function scrapePortfolio_(url) {
  if (!url || url.indexOf("portfolio.spacioam.com") < 0) return null;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return null;
  var html = res.getContentText();

  var mB  = html.match(/(\d+)\s*bedrooms?/i);
  var mBa = html.match(/([\d.]+)\s*bathrooms?/i);
  var cuartos = mB  ? parseInt(mB[1], 10)            : 0;
  var banos   = mBa ? Math.ceil(parseFloat(mBa[1]))  : 0; /* 3.5 baños → 4 espacios */

  var fotos = [], seen = {};
  var re = /https:\/\/assets\.hospitable\.com\/property_images\/\d+\/[A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[0]]) { seen[m[0]] = 1; fotos.push(m[0]); }
  }
  fotos = fotos.slice(0, 6); /* máx 6 fotos por propiedad — evita pasar el límite de 50000 caracteres por celda del Sheet */
  return { cuartos: cuartos, banos: banos, fotos: fotos };
}

/* Lee los "Listing link" del Sheet del dashboard de propietarios */
function getOwnerListingLinks_() {
  if (!OWNER_SHEET_ID) return {};
  var url = "https://docs.google.com/spreadsheets/d/" + OWNER_SHEET_ID +
    "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent("SETUP");
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return {};
  var rows = Utilities.parseCsv(res.getContentText());
  if (!rows.length) return {};
  var head = rows[0].map(function (h) { return String(h || "").trim(); });
  var iName = head.indexOf("property_name"), iLink = head.indexOf("Listing link");
  if (iName < 0 || iLink < 0) return {};
  var map = {};
  for (var r = 1; r < rows.length; r++) {
    var nm = String(rows[r][iName] || "").trim(), lk = String(rows[r][iLink] || "").trim();
    if (nm && lk && !map[normName_(nm)]) map[normName_(nm)] = lk;
  }
  return map;
}

function normName_(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
}

/* Prueba manual: selecciona syncPropertiesFull_ y pulsa ▶ Ejecutar.
   La primera vez pide autorizar. El registro dirá cuántos cambios aplicó. */

var COLS = [
  "id", "createdAt", "propiedad", "fecha", "categoria", "reportadoPor",
  "descripcion", "comentarios", "total", "paid", "pagadoPor",
  "fotoAntes", "fotoDespues", "factura", "danios", "hayDanios",
  "inventario", "nombreProducto", "establecimiento", "pais", "ciudad",
  "qaStatus", "qaComentario", "qaFecha", "qaRespuesta", "qaRespuestaFecha",
  "fotosLimpieza"
];

var CLEANING_PHOTO_KEYS = [
  "fotoUniforme", "fotoPisoGeneral",
  "fotosHabitaciones", "fotosBanos", "fotosDrenajes",
  "fotosVentanas", "fotosGavetas", "fotosDetalle",
  "fotosMicroondas", "fotosCafetera", "fotosEcofiltro",
  "fotosLavatrastos", "fotosRefrigerador", "fotosEstufa",
  "fotosTv", "fotosSillon", "fotosInsumos",
  "fotosDebajoCama", "fotosCloset",
  "fotosMicroondas2", "fotosPlatos", "fotosDetrasElect",
  "fotosRegadera", "fotosDucha", "fotosFregadero"
];

/* Columnas pesadas: las que guardan fotos, facturas y daños en JSON. En modo
   "light" ni se leen de la hoja — son las que hacían que el arranque tardara
   minutos. El detalle completo se pide por reporte con la acción getReport. */
var HEAVY_COLS = { fotoAntes: 1, fotoDespues: 1, factura: 1, danios: 1, fotosLimpieza: 1 };

function rowToReport_(row, tz) {
  var out = {};
  for (var j = 0; j < COLS.length; j++) {
    var v = row[j];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, "yyyy-MM-dd");
    if (v === "" || v === null || v === undefined) { out[COLS[j]] = null; continue; }
    if (typeof v === "string" && (v.charAt(0) === "[" || v.charAt(0) === "{")) {
      try { v = JSON.parse(v); } catch (e) {}
    }
    out[COLS[j]] = v;
  }
  if (out.fotosLimpieza && typeof out.fotosLimpieza === "object") {
    Object.keys(out.fotosLimpieza).forEach(function (k) { out[k] = out.fotosLimpieza[k]; });
  }
  return out;
}

function sinClaves_(o) {
  if (!o || typeof o !== "object") return o;
  var c = JSON.parse(JSON.stringify(o));
  (function limpiar(x) {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(limpiar); return; }
    delete x.password; delete x.adminpin; delete x.pin;
    Object.keys(x).forEach(function (k) { limpiar(x[k]); });
  })(c);
  return c;
}

function getAll(opts) {
  opts = opts || {};
  var light = !!opts.light, days = Number(opts.days || 0);
  /* El histórico completo se pide por tramos desde el final (lo más reciente
     primero). Una sola petición de toda la hoja es justo lo que tardaba
     minutos y se quedaba sin tiempo. */
  var offset = Math.max(0, Number(opts.offset || 0));
  var limit  = Math.max(0, Number(opts.limit || 0));
  var ck = "reps:" + (light ? "L" : "F") + ":" + days + ":" + offset + ":" + limit;
  var hit = cacheGet_(ck);
  if (hit) return hit;

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Reportes");
  if (!sheet) return { reports: [] };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { reports: [] };
  var tz = Session.getScriptTimeZone();
  var n  = lastRow - 1;
  var startRow = 2;
  if (limit) {
    /* Tramo contado desde la fila más nueva hacia atrás. */
    var end = n - offset;            /* cuántas filas quedan del principio */
    if (end <= 0) return { reports: [], done: true, offset: offset, limit: limit };
    var take = Math.min(limit, end);
    startRow = 2 + (end - take);
    n = take;
  }
  var data;

  if (light) {
    /* Si la hoja tiene menos columnas de las esperadas, no se arriesga el rango
       partido: se lee completa. */
    if (sheet.getLastColumn() < COLS.length) light = false;
  }
  if (light) {
    /* Dos lecturas de rango en vez de la hoja entera: A..K (datos) y P..Z (meta
       y control de calidad). Las 5 columnas de fotos quedan fuera. */
    var blockA = sheet.getRange(startRow, 1, n, 11).getValues();
    var blockB = sheet.getRange(startRow, 16, n, 11).getValues();
    data = [];
    for (var i = 0; i < n; i++) {
      data.push(blockA[i].concat(["", "", "", ""], blockB[i], [""]));
    }
  } else {
    data = sheet.getRange(startRow, 1, n, COLS.length).getValues();
  }

  var cutoff = 0;
  if (days > 0) {
    var d = new Date(); d.setDate(d.getDate() - days);
    cutoff = d.getTime();
  }

  var reports = [];
  for (var k = 0; k < data.length; k++) {
    var row = rowToReport_(data[k], tz);
    if (!row.id) continue;
    if (cutoff) {
      var t = Number(row.createdAt || 0);
      if (!t && row.fecha) t = new Date(String(row.fecha) + "T12:00:00").getTime() || 0;
      if (t && t < cutoff) continue;
    }
    if (light) row._light = true;
    reports.push(row);
  }
  var res = { reports: reports, light: light, days: days,
              offset: offset, limit: limit,
              done: limit ? (offset + n >= lastRow - 1) : true };
  cachePut_(ck, res);
  return res;
}

/* Detalle completo de UN reporte — lo que el modal necesita cuando la lista se
   cargó en modo light. Una sola fila, no la hoja. */
function getReport_(id) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Reportes");
  if (!sheet) return { report: null };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { report: null };
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var row = sheet.getRange(i + 2, 1, 1, COLS.length).getValues()[0];
      return { report: rowToReport_(row, Session.getScriptTimeZone()) };
    }
  }
  return { report: null };
}

function saveReport(rep) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Reportes");
  if (!sheet) sheet = ss.insertSheet("Reportes");
  if (sheet.getLastRow() === 0) sheet.appendRow(COLS);

  var fotosBlob = {};
  CLEANING_PHOTO_KEYS.forEach(function (k) {
    if (rep[k] !== undefined && rep[k] !== null) fotosBlob[k] = rep[k];
  });
  var repToSave = Object.assign({}, rep);
  repToSave.fotosLimpieza = Object.keys(fotosBlob).length > 0 ? fotosBlob : null;

  var data = sheet.getDataRange().getValues();
  var row = COLS.map(function (col) {
    var v = repToSave[col];
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  });
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(rep.id)) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      cacheBump_();
      return { saved: true, action: "updated" };
    }
  }
  sheet.appendRow(row);
  cacheBump_();
  return { saved: true, action: "created" };
}

function deleteReport(id) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Reportes");
  if (!sheet) return { deleted: false };
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) { sheet.deleteRow(i + 1); cacheBump_(); return { deleted: true }; }
  }
  return { deleted: false };
}

function getConfig(opts) {
  opts = opts || {};
  var slim = !!opts.slim;
  var ck = "cfg:" + (slim ? "S" : "F");
  var hit = cacheGet_(ck);
  if (hit) return hit;
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Config");
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var cfg  = {};
  data.forEach(function (row) {
    if (!row[0]) return;
    var val = row[1];
    if (typeof val === "string" && (val.charAt(0) === "[" || val.charAt(0) === "{")) {
      try { val = JSON.parse(val); } catch (e) {}
    }
    cfg[row[0]] = val;
  });
  /* Las reviews ya NO viven en Config: viven en la hoja "Reviews", una fila
     por review. Se inyectan aquí para que el app las siga leyendo igual. */
  delete cfg.reviews_n;
  for (var s = 2; s <= 12; s++) delete cfg["reviews_" + s];
  /* En modo slim NO se leen Reviews, Casos ni Versiones: son tres hojas enteras
     que nadie necesita para entrar a la app. Llegan después con getHeavy. */
  if (!slim) {
    try { cfg.reviews = rvReadSheet_(); } catch (e) { cfg.reviews = []; }
    try { cfg.rvCasos = rcRead_(); } catch (e) { cfg.rvCasos = []; }
    try { cfg.schedvers = svRead_(); } catch (e) { cfg.schedvers = {}; }
  }
  /* La programación vive en la hoja "Programacion", una fila por limpieza. La
     celda de Config no aguantaba el histórico y el guardado fallaba en silencio:
     el técnico veía una ruta en su teléfono y el administrador otra distinta. */
  try { cfg.schedules = schedRead_(); } catch (e) { }
  cachePut_(ck, cfg);
  return cfg;
}

/* Lo que la app carga en segundo plano, ya con la pantalla arriba: reseñas,
   casos de calidad e historial de versiones de programación. */
function getHeavy_() {
  var hit = cacheGet_("heavy");
  if (hit) return hit;
  var r = {};
  try { r.reviews   = rvReadSheet_(); } catch (e) { r.reviews = []; }
  try { r.rvCasos   = rcRead_(); }     catch (e) { r.rvCasos = []; }
  try { r.schedvers = svRead_(); }     catch (e) { r.schedvers = {}; }
  cachePut_("heavy", r);
  return r;
}

function saveConfig(key, value) {
  /* La programación ya no cabe en una celda: vive en su propia hoja. Todos los
     que llamaban saveConfig("schedules", …) siguen funcionando igual. */
  cacheBump_();
  if (key === "schedules") return schedWrite_(value);
  /* El historial de versiones tampoco cabe en una celda: hoja propia, una fila
     por versión. Ver svWrite_ para el cálculo. */
  if (key === "schedvers")  return svWrite_(value);
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Config");
  if (!sheet) sheet = ss.insertSheet("Config");
  var val  = (typeof value === "object") ? JSON.stringify(value) : String(value);
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      /* ═══ CANDADO ANTI-BORRADO ═══
         No permitir que "vendors" (usuarios) ni "props" (propiedades) pasen de una
         lista grande a una diminuta. Esto es el síntoma de un guardado hecho con los
         datos de respaldo mientras la app estaba sin conexión — la causa del borrado
         de usuarios. Un borrado real de uno o pocos sigue permitido; colapsar la lista
         (p.ej. de 20 a 3) se rechaza. Si alguna vez es intencional, edita el Sheet a mano. */
      if (key === "vendors" || key === "props") {
        var prevArr = null, newArr = null;
        try { prevArr = JSON.parse(String(data[i][1] || "[]")); } catch (e) { prevArr = null; }
        try { newArr = (typeof value === "object") ? value : JSON.parse(val); } catch (e) { newArr = null; }
        if (Array.isArray(prevArr) && Array.isArray(newArr) &&
            prevArr.length >= 5 && newArr.length < Math.max(2, prevArr.length * 0.5)) {
          throw new Error("Guardado bloqueado: intento de reducir '" + key + "' de " +
            prevArr.length + " a " + newArr.length + " elementos. Protección anti-borrado. " +
            "Si es intencional, edita la celda del Sheet directamente.");
        }
      }
      sheet.getRange(i + 1, 2).setValue(val);
      cacheBump_();
      return { saved: true };
    }
  }
  sheet.appendRow([key, val]);
  cacheBump_();
  return { saved: true };
}

function uploadFile(b64, name, mime, subfolder) {
  var root   = DriveApp.getFolderById(FOLDER_ID);
  var folder = root;
  if (subfolder && subfolder.trim() !== "") {
    var subName  = subfolder.charAt(0).toUpperCase() + subfolder.slice(1);
    var existing = root.getFoldersByName(subName);
    folder = existing.hasNext() ? existing.next() : root.createFolder(subName);
  }
  var raw  = (b64.indexOf(",") > -1) ? b64.split(",")[1] : b64;
  var blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, name);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    url:    "https://drive.google.com/uc?id=" + file.getId() + "&export=view",
    fileId: file.getId()
  };
}

function syncHospitable(days) {
  var today   = new Date();
  var endDate = new Date(today);
  endDate.setDate(endDate.getDate() + (days || 14));

  function fmt(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  var startStr = fmt(today);
  var endStr   = fmt(endDate);
  var headers  = {
    "Authorization": "Bearer " + HOSPITABLE_TOKEN,
    "Accept":        "application/json",
    "Content-Type":  "application/json"
  };
  var urls = [
    "https://api.hospitable.com/v1/tasks?start_date="      + startStr + "&end_date=" + endStr + "&limit=100",
    "https://api.hospitable.com/v1/operations?start_date=" + startStr + "&end_date=" + endStr + "&limit=100",
    "https://api.hospitable.com/v1/cleanings?start_date="  + startStr + "&end_date=" + endStr + "&limit=100"
  ];
  var rawTasks = null, usedUrl = "", lastErr = "";
  for (var i = 0; i < urls.length; i++) {
    try {
      var resp = UrlFetchApp.fetch(urls[i], { method: "GET", headers: headers, muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        var body = JSON.parse(resp.getContentText());
        rawTasks = body.data || body.tasks || body.items || body;
        usedUrl  = urls[i];
        break;
      } else {
        lastErr = "HTTP " + resp.getResponseCode() + ": " + resp.getContentText().slice(0, 200);
      }
    } catch (e) { lastErr = e.toString(); }
  }
  if (!rawTasks) {
    try {
      var rRes = UrlFetchApp.fetch(
        "https://api.hospitable.com/v1/reservations?start_date=" + startStr +
        "&end_date=" + endStr + "&limit=100&include=property,guest",
        { method: "GET", headers: headers, muteHttpExceptions: true }
      );
      if (rRes.getResponseCode() === 200) {
        var rData = JSON.parse(rRes.getContentText());
        rawTasks = (rData.data || rData.reservations || []).map(function (res) {
          return {
            id:             res.id,
            type:           "Cleaning",
            scheduled_date: res.checkout || res.end_date || res.check_out,
            listing_name:   res.property ? (res.property.name || "") : "",
            assignee:       null
          };
        });
        usedUrl = "reservations-derived";
      }
    } catch (e2) {
      return { error: "No se pudo conectar: " + lastErr, debug: e2.toString() };
    }
  }
  if (!rawTasks || !rawTasks.length) {
    return { schedules: [], source: usedUrl, message: "Sin tareas " + startStr + " a " + endStr };
  }
  var tipoMap = {
    cleaning:        "Limpieza",
    maintenance:     "Mantenimiento",
    inspection:      "Revisión",
    "deep cleaning": "Limpieza Profunda"
  };
  var schedules = rawTasks.map(function (t, i) {
    var assignee = t.assignee || t.teammate || t.cleaner || {};
    return {
      id:           "hosp_" + (t.id || i),
      fecha:        String(t.scheduled_date || t.start_date || t.date || "").slice(0, 10),
      hora:         String(t.start_time || t.time || "").slice(0, 5),
      propiedad:    t.listing_name || (t.property ? t.property.name : "") || t.listing || "",
      vendorId:     "",
      vendorRaw:    [assignee.first_name || "", assignee.last_name || "", assignee.email || ""].filter(Boolean).join(" "),
      tipo:         tipoMap[(t.type || t.task_type || "Cleaning").toLowerCase()] || "Limpieza",
      codigoAcceso: "",
      notas:        t.notes || t.description || "",
      hospId:       t.id || ""
    };
  });
  return { schedules: schedules, count: schedules.length, source: usedUrl, period: startStr + " a " + endStr };
}

function testDrive() {
  var folder      = DriveApp.getFolderById(FOLDER_ID);
  var directFiles = 0, samples = [];
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    directFiles++;
    if (samples.length < 8) samples.push(f.getName());
  }
  var subfolderCount = 0, totalFiles = directFiles;
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    subfolderCount++;
    samples.push("[📁] " + sub.getName());
    var sf = sub.getFiles();
    while (sf.hasNext()) { sf.next(); totalFiles++; }
  }
  return {
    folderName:  folder.getName(),
    directFiles: directFiles,
    subfolders:  subfolderCount,
    totalFiles:  totalFiles,
    samples:     samples
  };
}

function recoverPhotos() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet  = ss.getSheetByName("Reportes");
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var startTime = new Date().getTime();

  var FIELD_MAP = {
    "inv": "inventario",
    "bano-inodoro": "banoInodoro",
    "bano-ducha":   "banoDucha"
  };
  var ARRAY_FIELDS = ["fotosHabitaciones","fotosDrenajes","fotosVentanas","fotosGavetas","fotosDetalle","fotosBanos"];

  var fileIndex = {}, filesFound = 0;

  function indexFolder(driveFolder) {
    var files = driveFolder.getFiles();
    while (files.hasNext()) {
      if (new Date().getTime() - startTime > 24000) return;
      var file = files.next();
      filesFound++;
      var url = "https://drive.google.com/uc?id=" + file.getId() + "&export=view";
      var m = file.getName().match(/^(.+)-(\d{13,})-?(\d*)\.\w+$/i);
      if (!m) continue;
      var field = FIELD_MAP[m[1]] || m[1];
      var repId = m[2];
      var idx   = m[3] ? parseInt(m[3]) : 0;
      if (!fileIndex[repId]) fileIndex[repId] = {};
      if (!fileIndex[repId][field]) fileIndex[repId][field] = [];
      fileIndex[repId][field][idx] = url;
    }
    var subs = driveFolder.getFolders();
    while (subs.hasNext()) {
      if (new Date().getTime() - startTime > 24000) return;
      indexFolder(subs.next());
    }
  }
  indexFolder(folder);

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {filesFound:filesFound,reportsProcessed:0,reportsUpdated:0,details:[],errors:[]};

  var colMap = {};
  COLS.forEach(function(c,i){ colMap[c]=i; });
  var fotosCol = colMap["fotosLimpieza"] + 1; /* 1-indexed for getRange */

  var processed=0, updated=0, details=[], errors=[];

  for (var i=1; i<data.length; i++) {
    var row   = data[i];
    var repId = String(row[0]);
    if (!repId) continue;

    var files = fileIndex[repId] || fileIndex[String(parseInt(repId))];
    if (!files || !Object.keys(files).length) continue;
    processed++;

    /* Only update if fotosLimpieza is empty */
    var curFotos = String(data[i][fotosCol-1] || "");
    if (curFotos && curFotos !== "" && curFotos !== "null" && curFotos !== "{}") continue;

    /* Build blob */
    var blob = {};
    Object.keys(files).forEach(function(field) {
      var urls = files[field].filter(Boolean);
      if (!urls.length) return;
      blob[field] = ARRAY_FIELDS.indexOf(field) >= 0 ? urls : urls[0];
    });

    if (Object.keys(blob).length === 0) continue;

    try {
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var targetCol = headers.indexOf("fotosLimpieza") + 1;
      if (targetCol === 0) {
        targetCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, targetCol).setValue("fotosLimpieza");
      }
      sheet.getRange(i + 1, targetCol).setValue(JSON.stringify(blob));
      updated++;
      details.push((row[colMap["propiedad"]] || repId) + ": " + Object.keys(blob).join(", "));
    } catch (e) {
      errors.push("Error " + repId + ": " + e.message);
    }
  }

  return {filesFound:filesFound, reportsProcessed:processed, reportsUpdated:updated, details:details, errors:errors};
}


/* ═══════════════════════════════════════════════════════════════════════════
   NUEVO — REVIEWS DE HUÉSPEDES (rating de limpieza por técnico)
   ─────────────────────────────────────────────────────────────────────────
   Trae las reviews de todas las plataformas conectadas a Hospitable y guarda
   SOLO lo necesario en la config: propiedad, check-in, plataforma, nota de
   limpieza, nota general y el comentario. El app liga cada review con la
   limpieza previa al check-in para saber a qué técnico corresponde.

   Se guarda repartido en varios campos (reviews, reviews_2, …) para no
   desbordar el límite de 50 000 caracteres por celda del Sheet.

   Activador recomendado: ⏰ Activadores → cronSyncReviews · por día · 4-5 a.m.
   ═══════════════════════════════════════════════════════════════════════════ */
function syncReviewsFull_(days) {
  var token = HOSPITABLE_TOKEN || PropertiesService.getScriptProperties().getProperty("HOSPITABLE_TOKEN") || "";
  if (!token) return { ok: false, error: "Falta HOSPITABLE_TOKEN en Propiedades del script." };

  /* La API de Hospitable NO tiene un listado global /v2/reviews. Las reviews
     se piden como "include" del listado de reservas:
       GET /v2/reservations?properties[]=…&start_date=…&end_date=…&include=review
     Ese include exige el permiso reviews:read en el token, y el endpoint exige
     properties[]. Si eso falla, se intenta reserva por reserva. */
  var dias = parseInt(days, 10) || 365;
  var props = rvProperties_(token);
  if (!props.uuids.length)
    return { ok: false, error: "No se pudo leer ninguna propiedad. Revisa el token (permiso de lectura de propiedades) en Propiedades del script." };

  var fetched = rvFetchAll_(token, props, dias);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  var out = fetched.reviews, sinLimpieza = fetched.sinLimpieza;
  var lista = { length: fetched.recibidas };

  /* Guarda en la hoja "Reviews" — una fila por review. Conserva lo que ya
     estaba (incluidas las cargadas a mano) y actualiza por ID. */
  var up = rvUpsertSheet_(out);
  saveConfig("reviews_sync", new Date().toISOString());
  return {
    ok: true, added: up.added, updated: up.updated, total: up.total,
    recibidas: lista.length, sinNotaLimpieza: sinLimpieza, aviso: fetched.aviso || "",
    reviews: up.reviews
  };
}

function mergeObj_(a, b) {
  var o = {};
  Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; });
  Object.keys(b || {}).forEach(function (k) { if (b[k] !== null && b[k] !== "" && b[k] !== undefined) o[k] = b[k]; });
  return o;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOJA "Reviews" — una fila por review, legible por una persona
   ─────────────────────────────────────────────────────────────────────────
   Antes esto se guardaba como JSON dentro de la hoja Config, imposible de
   revisar a ojo. Ahora vive en su propia hoja con encabezados.

   El app sigue leyéndolo igual: getConfig() inyecta cfg.reviews desde aquí.
   ═══════════════════════════════════════════════════════════════════════════ */
var RV_SHEET = "Reviews";
var RV_COLS = ["ID", "Propiedad", "Check-in", "Plataforma", "Limpieza", "General",
               "Exactitud", "Llegada", "Comunicación", "Ubicación", "Valor",
               "Huésped", "Fecha review", "Origen", "Comentario", "Escala"];

function rvSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(RV_SHEET);
  var nueva = false;
  if (!sh) { sh = ss.insertSheet(RV_SHEET); nueva = true; }
  /* Si faltan encabezados (versión anterior de la hoja) se reescribe la fila 1.
     Las columnas nuevas sólo se agregan al final, así que los datos no se mueven. */
  var encab = sh.getLastRow() ? sh.getRange(1, 1, 1, RV_COLS.length).getValues()[0] : [];
  var iguales = encab.length === RV_COLS.length && RV_COLS.every(function (c, i) { return String(encab[i]) === c; });
  if (nueva || sh.getLastRow() === 0 || !iguales) {
    sh.getRange(1, 1, 1, RV_COLS.length).setValues([RV_COLS]);
    sh.getRange(1, 1, 1, RV_COLS.length)
      .setFontWeight("bold").setBackground("#F5F3F0").setFontColor("#3E3F3F")
      .setVerticalAlignment("middle");
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 30);
    var anchos = [110, 220, 90, 95, 80, 80, 85, 85, 110, 90, 70, 120, 105, 90, 560, 90];
    for (var c = 0; c < anchos.length; c++) sh.setColumnWidth(c + 1, anchos[c]);
    sh.getRange(2, 5, sh.getMaxRows() - 1, 7).setHorizontalAlignment("center");
  }
  return sh;
}

function rvNum_(v) { var n = parseFloat(v); return (v === "" || v == null || isNaN(n)) ? null : n; }

function rvRow_(r) {
  return [
    r.id || "", r.propiedad || "", r.checkIn || "", r.platform || "",
    r.ratingLimpieza == null ? "" : r.ratingLimpieza,
    r.ratingGeneral == null ? "" : r.ratingGeneral,
    r.exactitud == null ? "" : r.exactitud,
    r.llegada == null ? "" : r.llegada,
    r.comunicacion == null ? "" : r.comunicacion,
    r.ubicacion == null ? "" : r.ubicacion,
    r.valor == null ? "" : r.valor,
    r.guest || "", r.reviewedAt || "", r.source || "", r.comentario || "", r.escala || ""
  ];
}

function rvObj_(row) {
  return {
    id: String(row[0] || ""), propiedad: String(row[1] || ""),
    checkIn: rvDate_(row[2]), platform: String(row[3] || ""),
    ratingLimpieza: rvNum_(row[4]), ratingGeneral: rvNum_(row[5]),
    exactitud: rvNum_(row[6]), llegada: rvNum_(row[7]), comunicacion: rvNum_(row[8]),
    ubicacion: rvNum_(row[9]), valor: rvNum_(row[10]),
    guest: String(row[11] || ""), reviewedAt: rvDate_(row[12]),
    source: String(row[13] || ""), comentario: String(row[14] || ""),
    escala: String(row[15] || "")
  };
}

/* Lee la hoja. Por omisión devuelve SOLO las que tienen nota de limpieza (las
   únicas que el app puede atribuir a un técnico). rvReadSheet_(true) trae todas. */
function rvReadSheet_(todas) {
  var sh = rvSheet_();
  if (sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, RV_COLS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    var o = rvObj_(vals[i]);
    if (!todas && o.ratingLimpieza == null) continue;
    out.push(o);
  }
  return out;
}

/* Escribe la lista completa, ordenada por check-in descendente. */
function rvWriteSheet_(list) {
  var sh = rvSheet_();
  list = (list || []).slice().sort(function (a, b) {
    return String(b.checkIn || "").localeCompare(String(a.checkIn || ""));
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, RV_COLS.length).clearContent();
  if (!list.length) return sh;
  sh.getRange(2, 1, list.length, RV_COLS.length).setValues(list.map(rvRow_));
  sh.getRange(2, 15, list.length, 1).setWrap(false);
  return sh;
}

/* Mezcla lo nuevo con lo que ya hay en la hoja, por ID. */
function rvUpsertSheet_(nuevas) {
  var prev = rvReadSheet_(true);
  var byId = {}, orden = [];
  prev.forEach(function (r) { if (!byId[r.id]) orden.push(r.id); byId[r.id] = r; });
  var added = 0, updated = 0;
  (nuevas || []).forEach(function (r) {
    if (!r || !r.id) return;
    if (byId[r.id]) { updated++; byId[r.id] = mergeObj_(byId[r.id], r); }
    else { added++; orden.push(r.id); byId[r.id] = r; }
  });
  var merged = orden.map(function (id) { return byId[id]; });
  rvWriteSheet_(merged);
  return {
    added: added, updated: updated, total: merged.length,
    reviews: merged.filter(function (r) { return r.ratingLimpieza != null; })
  };
}

/* Guarda la lista que manda el app (cargas manuales y ediciones). Conserva las
   filas sin nota de limpieza, que el app no ve y por tanto no puede reenviar. */
function saveReviews_(list) {
  list = Array.isArray(list) ? list : [];
  var byId = {};
  list.forEach(function (r) { if (r && r.id) byId[String(r.id)] = 1; });
  var conservar = rvReadSheet_(true).filter(function (r) {
    return r.ratingLimpieza == null && !byId[r.id];
  });
  rvWriteSheet_(list.concat(conservar));
  return { saved: list.length, total: list.length + conservar.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOJA "Rating - revisiones" — casos de revisión de una calificación
   ─────────────────────────────────────────────────────────────────────────
   El técnico pide revisar una review con la que no está de acuerdo (pide que
   se excluya de su promedio, o deja una aclaración). El administrador decide:

     pendiente   · esperando revisión del administrador
     excluida    · no cuenta para el promedio del técnico (sigue en la BD)
     reasignada  · la limpieza era de otro técnico; se le atribuye a ese
     rechazada   · la calificación se mantiene

   Ninguna decisión borra la review: sólo cambia a quién se le atribuye.
   ═══════════════════════════════════════════════════════════════════════════ */
var RC_SHEET = "Rating - revisiones";
var RC_COLS = ["ID", "Review ID", "Propiedad", "Check-in", "Técnico", "Nota limpieza",
               "Tipo", "Motivo del técnico", "Fecha solicitud", "Estado",
               "Decisión del administrador", "Reasignada a", "Resuelta por", "Fecha resolución"];

function rcSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(RC_SHEET);
  var nueva = false;
  if (!sh) { sh = ss.insertSheet(RC_SHEET); nueva = true; }
  var encab = sh.getLastRow() ? sh.getRange(1, 1, 1, RC_COLS.length).getValues()[0] : [];
  var iguales = encab.length === RC_COLS.length && RC_COLS.every(function (c, i) { return String(encab[i]) === c; });
  if (nueva || !iguales) {
    sh.getRange(1, 1, 1, RC_COLS.length).setValues([RC_COLS]);
    sh.getRange(1, 1, 1, RC_COLS.length)
      .setFontWeight("bold").setBackground("#F5F3F0").setFontColor("#3E3F3F")
      .setVerticalAlignment("middle");
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 30);
    var anchos = [110, 110, 200, 90, 150, 90, 110, 380, 105, 105, 380, 150, 150, 105];
    for (var c = 0; c < anchos.length; c++) sh.setColumnWidth(c + 1, anchos[c]);
  }
  return sh;
}

function rcRead_() {
  var sh = rcSheet_();
  if (sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, RC_COLS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    out.push({
      id: String(r[0]), reviewId: String(r[1] || ""), propiedad: String(r[2] || ""),
      checkIn: rvDate_(r[3]), tecnico: String(r[4] || ""), nota: rvNum_(r[5]),
      tipo: String(r[6] || ""), motivo: String(r[7] || ""), fecha: rvDate_(r[8]),
      estado: String(r[9] || "pendiente"), decision: String(r[10] || ""),
      reasignadaA: String(r[11] || ""), resueltaPor: String(r[12] || ""),
      fechaResol: rvDate_(r[13])
    });
  }
  return out;
}

function saveCasos_(list) {
  list = Array.isArray(list) ? list : [];
  var sh = rcSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, RC_COLS.length).clearContent();
  if (list.length) {
    sh.getRange(2, 1, list.length, RC_COLS.length).setValues(list.map(function (c) {
      return [c.id || "", c.reviewId || "", c.propiedad || "", c.checkIn || "", c.tecnico || "",
              c.nota == null ? "" : c.nota, c.tipo || "", c.motivo || "", c.fecha || "",
              c.estado || "pendiente", c.decision || "", c.reasignadaA || "",
              c.resueltaPor || "", c.fechaResol || ""];
    }));
  }
  return { total: list.length };
}

/* ═══ REPARACIÓN DE ESCALAS — ejecútala UNA vez tras actualizar el código ═══
   Las filas guardadas antes de esta corrección tienen las notas de Booking.com
   en escala 1-10 y ceros donde la plataforma no reportó la categoría. Esto las
   normaliza a 1-5, vacía los ceros y marca la columna Escala.

   Es idempotente: usa la columna Escala como sello, así que correrla dos veces
   no divide nada dos veces. */
function corregirEscalas() {
  var sh = rvSheet_();
  if (sh.getLastRow() < 2) return "La hoja está vacía.";
  var n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, 1, n, RV_COLS.length).getValues();
  var detalle = [5, 7, 8, 9, 10, 11];  /* Limpieza, Exactitud, Llegada, Comunicación, Ubicación, Valor (1-based) */
  var tocadas = 0, ceros = 0, selladas = 0;

  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    if (!row[0]) continue;
    if (String(row[15] || "")) continue;           /* ya tiene sello: no tocar */
    var esBooking = String(row[3] || "").toLowerCase().indexOf("booking") >= 0;
    var div = esBooking ? 2 : 1;
    /* Si algún detalle pasa de 5 en una plataforma que creíamos de 1-5, también
       venía en escala de 10. */
    if (div === 1) for (var d = 0; d < detalle.length; d++) {
      var vv = parseFloat(row[detalle[d] - 1]);
      if (!isNaN(vv) && vv > 5) { div = 2; esBooking = true; break; }
    }
    var cambio = false;
    for (var c = 0; c < detalle.length; c++) {
      var idx = detalle[c] - 1, v = row[idx];
      if (v === "" || v == null) continue;
      var num = parseFloat(v);
      if (isNaN(num) || num === 0) { row[idx] = ""; ceros++; cambio = true; continue; }
      if (div === 2) { row[idx] = Math.round(Math.min(5, num / 2) * 100) / 100; cambio = true; }
    }
    var g = parseFloat(row[5]);
    if (!isNaN(g) && g > 5) { row[5] = Math.round((g / 2) * 100) / 100; cambio = true; }
    if (!isNaN(g) && g === 0) { row[5] = ""; cambio = true; }
    row[15] = (div === 2) ? "1-10 → 1-5" : "1-5";
    selladas++;
    if (cambio) tocadas++;
  }

  sh.getRange(2, 1, n, RV_COLS.length).setValues(vals);
  var r = "OK · " + selladas + " filas revisadas · " + tocadas +
          " corregidas · " + ceros + " ceros vaciados.";
  console.log(r);
  return r;
}

/* ═══ MIGRACIÓN — ejecútala UNA vez desde el editor de Apps Script ═══
   Pasa las reviews que estaban en JSON dentro de Config a la hoja "Reviews"
   y luego BORRA esas filas de Config, para dejar la base ordenada. */
function migrarReviewsAHoja() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var cfgSh = ss.getSheetByName("Config");
  var viejas = [], claves = [];

  if (cfgSh) {
    var data = cfgSh.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      var k = String(data[i][0] || "");
      if (k !== "reviews" && k !== "reviews_n" && !/^reviews_\d+$/.test(k)) continue;
      claves.push({ fila: i + 1, clave: k });
      if (k === "reviews_n") continue;
      try {
        var arr = JSON.parse(String(data[i][1] || "[]"));
        if (Array.isArray(arr)) viejas = viejas.concat(arr);
      } catch (e) { console.warn("No se pudo leer " + k); }
    }
  }
  console.log("reviews encontradas en Config: " + viejas.length + " (en " + claves.length + " celdas)");

  var up = rvUpsertSheet_(viejas);
  console.log("hoja Reviews → " + up.total + " filas (" + up.added + " nuevas, " + up.updated + " actualizadas)");

  /* Borra las celdas viejas de Config, de abajo hacia arriba. */
  claves.sort(function (a, b) { return b.fila - a.fila; });
  claves.forEach(function (c) { cfgSh.deleteRow(c.fila); });
  console.log("Config limpio: " + claves.length + " celdas de reviews eliminadas.");

  return "OK · " + up.total + " reviews en la hoja Reviews · " + claves.length +
         " celdas JSON borradas de Config.";
}

/* Nombre legible de la plataforma. */
function rvPlatform_(p) {
  var m = { airbnb: "Airbnb", homeaway: "Vrbo", booking: "Booking.com", direct: "Directa", manual: "Manual" };
  var k = String(p || "").toLowerCase();
  return m[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : "");
}

/* Convierte una Review de la API al formato que usa el app. */
function rvFromReview_(rv, propNames, resv) {
  if (!rv) return null;

  var res0 = rv.reservation || resv || {};
  if (res0.data) res0 = res0.data;
  var plat = rvPlatform_(rv.platform || res0.platform);

  /* ── las seis sub-calificaciones, normalizadas a escala 1-5 ──
     Booking.com califica de 1 a 10 y sólo reporta algunas categorías; Airbnb
     y Vrbo van de 1 a 5. Sin normalizar, un 10 de Booking le inflaba el
     promedio al técnico y las categorías ausentes entraban como 0. */
  var escala = rvEscala_(plat, rv);
  var det = rvDetalles_(rv, escala);
  var limpieza = det.limpieza;

  var res = rv.reservation || resv || {};
  if (res.data) res = res.data;
  var guest = rv.guest || res.guest || {};
  if (guest.data) guest = guest.data;

  var checkIn = rvDate_(res.arrival_date || res.check_in ||
    (res.dates && (res.dates.arrival_date || res.dates.check_in ||
      (res.dates.arrival && (res.dates.arrival.date || res.dates.arrival)))) || "");

  var propId = String(res.property_id || res.property_uuid ||
    (res.property && (res.property.id || res.property.uuid)) ||
    (Array.isArray(res.properties) && res.properties[0] && (res.properties[0].id || res.properties[0].uuid)) || "");
  var propName = (res.property && (res.property.name || res.property.public_name)) ||
    (Array.isArray(res.properties) && res.properties[0] && (res.properties[0].name || res.properties[0].public_name)) ||
    propNames[propId] || "";

  var general = (rv.public && rv.public.rating != null) ? parseFloat(rv.public.rating)
              : (rv.overall_rating != null ? parseFloat(rv.overall_rating) : null);
  if (general != null && !isNaN(general) && general > 5) general = general / 2;

  var id = String(rv.id != null ? rv.id : (rv.uuid || res.id || res.uuid || ""));
  if (!id) return null;

  return {
    id: "h_" + id,
    propiedad: String(propName || "").slice(0, 90),
    checkIn: checkIn,
    platform: rvPlatform_(rv.platform || res.platform),
    escala: escala === 10 ? "1-10 → 1-5" : "1-5",
    ratingLimpieza: limpieza,
    ratingGeneral: (general != null && !isNaN(general)) ? general : null,
    exactitud: det.exactitud, llegada: det.llegada, comunicacion: det.comunicacion,
    ubicacion: det.ubicacion, valor: det.valor,
    guest: String(guest.first_name || guest.full_name || guest.name || "").slice(0, 40),
    comentario: String((rv.public && rv.public.review) || rv.public_review || "").slice(0, 600),
    reviewedAt: rvDate_(rv.reviewed_at || rv.created_at || ""),
    source: "hospitable"
  };
}

/* Escala nativa de la plataforma: Booking.com va de 1 a 10; Airbnb, Vrbo y las
   reservas directas de 1 a 5. Si algún canal nuevo manda un valor mayor que 5,
   se asume escala de 10 igual. */
function rvEscala_(plat, rv) {
  var k = String(plat || "").toLowerCase();
  if (k.indexOf("booking") >= 0) return 10;
  var det = (rv && rv.private && rv.private.detailed_ratings) || (rv && rv.detailed_ratings) || [];
  if (Array.isArray(det)) for (var i = 0; i < det.length; i++) {
    var v = parseFloat(det[i] && (det[i].rating != null ? det[i].rating : det[i].value));
    if (!isNaN(v) && v > 5) return 10;
  }
  return 5;
}

/* Saca las seis sub-calificaciones de una review, sin importar cómo las nombre
   cada plataforma, y las deja siempre en escala 1-5. Airbnb las manda en
   private.detailed_ratings[] con type = cleanliness / accuracy / checkin /
   communication / location / value; Booking usa cleanliness / staff /
   location / value y omite el resto. */
function rvDetalles_(rv, escala) {
  var div = (escala === 10) ? 2 : 1;
  var mapa = {
    limpieza:     ["clean", "limpie", "propret", "sauber"],
    exactitud:    ["accura", "exact", "precis"],
    llegada:      ["checkin", "check_in", "check-in", "llegada", "arrival"],
    comunicacion: ["communi", "comunica", "staff", "personal"],
    ubicacion:    ["location", "ubicac", "empla"],
    valor:        ["value", "valor", "precio", "price"]
  };
  var claves = Object.keys(mapa), r = {};
  claves.forEach(function (k) { r[k] = null; });

  var det = (rv.private && rv.private.detailed_ratings) || rv.detailed_ratings || [];
  if (Array.isArray(det)) {
    det.forEach(function (d) {
      var t = String((d && (d.type || d.category || d.name || d.key)) || "").toLowerCase();
      var v = d && (d.rating != null ? d.rating : d.value);
      /* Un 0 no es "cero de calificación": es una categoría que la plataforma
         no reportó. Se deja en blanco. */
      if (!t || v == null || v === "" || parseFloat(v) === 0) return;
      claves.forEach(function (k) {
        if (r[k] != null) return;
        for (var n = 0; n < mapa[k].length; n++) if (t.indexOf(mapa[k][n]) >= 0) { r[k] = parseFloat(v) / div; return; }
      });
    });
  }
  claves.forEach(function (k) {
    if (r[k] == null) { var c = rvCat_(rv, mapa[k]); r[k] = (c == null || c === 0) ? null : c / div; }
    if (r[k] == null || isNaN(r[k])) { r[k] = null; return; }
    r[k] = Math.round(Math.min(5, r[k]) * 100) / 100;
  });
  return r;
}

/* ── Trae reviews vía el listado de reservas, por tramos de 90 días y en lotes
      de 25 propiedades (el endpoint limita el largo del query). ── */
function rvFetchAll_(token, props, dias) {
  var hoy = new Date();
  var desde = new Date(hoy.getTime() - dias * 86400000);
  var reviews = [], recibidas = 0, sinLimpieza = 0, vistos = {};
  var lastErr = "", got = false, conReview = 0;

  var tramos = [], cursor = new Date(desde.getTime());
  while (cursor < hoy) {
    var fin = new Date(Math.min(cursor.getTime() + 90 * 86400000, hoy.getTime()));
    tramos.push([rvYmd_(cursor), rvYmd_(fin)]);
    cursor = new Date(fin.getTime() + 86400000);
  }
  var lotes = [];
  for (var i = 0; i < props.uuids.length; i += 25) lotes.push(props.uuids.slice(i, i + 25));

  for (var t = 0; t < tramos.length; t++) {
    for (var l = 0; l < lotes.length; l++) {
      var base = "https://public.api.hospitable.com/v2/reservations?" +
        lotes[l].map(function (u) { return "properties[]=" + encodeURIComponent(u); }).join("&") +
        "&start_date=" + tramos[t][0] + "&end_date=" + tramos[t][1] +
        "&include=review,guest,properties&per_page=100";
      var page = 1, guard = 0;
      while (guard++ < 30) {
        var res = rvGet_(token, base + "&page=" + page);
        if (res.code !== 200) {
          lastErr = "HTTP " + res.code + ": " + res.msg;
          /* Sin el permiso reviews:read el include revienta: reintenta sin él
             para confirmar que el resto del token sí sirve. */
          break;
        }
        got = true;
        var data = (res.json && res.json.data) || [];
        for (var d = 0; d < data.length; d++) {
          var rv = rvExtractReview_(data[d], res.json);
          if (!rv) continue;
          conReview++;
          var norm = rvFromReview_(rv, props.names, data[d]);
          if (!norm) continue;
          if (norm.ratingLimpieza == null) sinLimpieza++;
          if (vistos[norm.id]) continue;
          vistos[norm.id] = 1;
          reviews.push(norm);
        }
        recibidas += data.length;
        var meta = (res.json && res.json.meta) || {};
        if (meta.last_page && page >= meta.last_page) break;
        if (data.length < 100) break;
        page++;
      }
    }
  }

  if (!got) {
    var hint = "";
    if (/\b(401|403)\b/.test(lastErr) || /scope|unauthor|forbidden/i.test(lastErr))
      hint = " — al token le falta el permiso reviews:read (o está vencido: los tokens duran 1 año). " +
             "En my.hospitable.com › Apps › API access › Access tokens genera uno nuevo marcando Reviews y actualízalo en Propiedades del script.";
    else if (/\b422\b/.test(lastErr))
      hint = " — el listado de reservas rechazó los parámetros. Corre diagnosticoReviews() en el editor de Apps Script y revisa el registro.";
    return { ok: false, error: (lastErr || "Hospitable no respondió.") + hint };
  }

  if (!conReview) {
    /* El token sirve pero ninguna reserva trajo review: puede ser que el
       include se ignore por falta de permiso. Se avisa en claro. */
    return {
      ok: true, reviews: [], recibidas: recibidas, sinLimpieza: 0,
      aviso: "Se leyeron " + recibidas + " reservas pero ninguna trajo review. " +
             "Si ya tienes reviews en Hospitable, el token no tiene el permiso Reviews: genera uno nuevo marcándolo."
    };
  }
  return { ok: true, reviews: reviews, recibidas: recibidas, sinLimpieza: sinLimpieza };
}

function rvGet_(token, url) {
  var res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { "Authorization": "Bearer " + token, "Accept": "application/json" },
    muteHttpExceptions: true
  });
  var txt = res.getContentText(), j = null;
  try { j = JSON.parse(txt); } catch (e) {}
  return {
    code: res.getResponseCode(), json: j,
    msg: String((j && (j.message || j.error || (j.errors && JSON.stringify(j.errors)))) || txt).slice(0, 240)
  };
}

function rvYmd_(d) { return Utilities.formatDate(d, "GMT-6", "yyyy-MM-dd"); }

/* La review puede venir en reserva.review, en reserva.relationships.review o
   en el arreglo included[] de la respuesta. */
function rvExtractReview_(resv, envelope) {
  if (!resv) return null;
  var rv = resv.review || (resv.relationships && resv.relationships.review) || null;
  if (rv && rv.data) rv = rv.data;
  if (rv && (rv.id || rv.uuid || rv.public || rv.rating != null)) return rv;
  var inc = (envelope && envelope.included) || [];
  for (var i = 0; i < inc.length; i++) {
    var it = inc[i] || {};
    if (String(it.type || "").toLowerCase().indexOf("review") < 0) continue;
    var at = it.attributes || it;
    var rid = String(at.reservation_id || at.reservation_uuid || (it.relationships && it.relationships.reservation && it.relationships.reservation.data && it.relationships.reservation.data.id) || "");
    if (!rid || rid === String(resv.id || resv.uuid)) return at;
  }
  return null;
}

function rvProperties_(token) {
  var uuids = [], names = {};
  try {
    var page = 1, guard = 0;
    while (guard++ < 25) {
      var res = UrlFetchApp.fetch("https://public.api.hospitable.com/v2/properties?per_page=100&page=" + page, {
        method: "get",
        headers: { "Authorization": "Bearer " + token, "Accept": "application/json" },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) break;
      var j = JSON.parse(res.getContentText());
      var data = j.data || [];
      for (var i = 0; i < data.length; i++) {
        var p = data[i];
        var nm = p.name || p.public_name || (p.address && p.address.display) || "";
        var uu = p.id || p.uuid;
        if (uu) { uuids.push(String(uu)); names[String(uu)] = nm; }
        if (p.uuid) names[String(p.uuid)] = nm;
      }
      var meta = j.meta || {};
      if (meta.last_page && page >= meta.last_page) break;
      if (data.length < 100) break;
      page++;
    }
  } catch (e) {}
  return { uuids: uuids, names: names };
}


/* reservation id → {checkIn, propId} para las reviews que no traen la fecha. */

function rvDate_(v) {
  if (!v) return "";
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try { return Utilities.formatDate(new Date(s), "GMT-6", "yyyy-MM-dd"); } catch (e) { return ""; }
}

/* Extrae la nota de una categoría (limpieza) de las distintas formas en que
   las plataformas la exponen a través de Hospitable. */
function rvCat_(rv, names) {
  var buckets = [rv.rating, rv.ratings, rv.category_ratings, rv.categories, rv.scores,
                 (rv.rating && rv.rating.categories), (rv.review && rv.review.rating)];
  for (var b = 0; b < buckets.length; b++) {
    var bk = buckets[b];
    if (!bk) continue;
    if (Array.isArray(bk)) {
      for (var i = 0; i < bk.length; i++) {
        var it = bk[i] || {};
        var label = String(it.category || it.name || it.type || it.key || "").toLowerCase();
        for (var n = 0; n < names.length; n++) {
          if (label.indexOf(names[n]) >= 0) {
            var val = it.rating != null ? it.rating : (it.value != null ? it.value : it.score);
            if (val != null && val !== "") return parseFloat(val);
          }
        }
      }
    } else if (typeof bk === "object") {
      var keys = Object.keys(bk);
      for (var k = 0; k < keys.length; k++) {
        var lk = keys[k].toLowerCase();
        for (var m = 0; m < names.length; m++) {
          if (lk.indexOf(names[m]) >= 0) {
            var v2 = bk[keys[k]];
            if (v2 != null && v2 !== "" && typeof v2 !== "object") return parseFloat(v2);
            if (v2 && typeof v2 === "object" && v2.rating != null) return parseFloat(v2.rating);
          }
        }
      }
    }
  }
  return null;
}


/* Activador diario recomendado: cronSyncReviews · por día · 4-5 a.m. */
function cronSyncReviews() {
  try {
    var r = syncReviewsFull_(365);
    console.log("cronSyncReviews:", JSON.stringify(r && { ok: r.ok, added: r.added, total: r.total, error: r.error }));
  } catch (e) { console.error("cronSyncReviews:", e); }
}

/* Crea el activador diario automáticamente. Ejecútala UNA vez desde el editor
   de Apps Script (Ejecutar › probarReviews o crearActivadorReviews). */
function crearActivadorReviews() {
  var t = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t.length; i++) if (t[i].getHandlerFunction() === "cronSyncReviews") ScriptApp.deleteTrigger(t[i]);
  ScriptApp.newTrigger("cronSyncReviews").timeBased().atHour(4).everyDays(1).create();
  return "Activador diario creado (4-5 a.m.).";
}

/* Diagnóstico: corre esto en el editor y mira el registro. Dice exactamente
   qué respondió Hospitable y cuántas reviews con nota de limpieza llegaron. */
function probarReviews() {
  var r = syncReviewsFull_(365);
  console.log(JSON.stringify({
    ok: r.ok, error: r.error,
    recibidas: r.recibidas, sinNotaLimpieza: r.sinNotaLimpieza,
    added: r.added, updated: r.updated, total: r.total,
    muestra: (r.reviews || []).slice(0, 3)
  }, null, 2));
  if (!r.ok) return "ERROR · " + r.error;
  if (r.aviso) return "AVISO · " + r.aviso;
  return "OK · " + r.recibidas + " reservas leídas · " + (r.recibidas - r.sinNotaLimpieza) +
         " con nota de limpieza · " + r.total + " guardadas en total.";
}

/* Diagnóstico crudo completo: usa diagnosticoReviews(), que prueba todos los
   endpoints e imprime una review tal como la manda Hospitable. */
/* ═══ DIAGNÓSTICO — corre esto en el editor de Apps Script y lee el registro.
   Prueba, una por una, todas las formas en que Hospitable puede exponer las
   reviews y dice exactamente cuál responde 200 y cuál falla y por qué. ═══ */
function diagnosticoReviews() {
  var token = HOSPITABLE_TOKEN || PropertiesService.getScriptProperties().getProperty("HOSPITABLE_TOKEN") || "";
  if (!token) { console.error("Falta HOSPITABLE_TOKEN en Propiedades del script."); return "Falta el token."; }

  var pasos = [], B = "https://public.api.hospitable.com/v2/";
  function paso(nombre, url) {
    var r = rvGet_(token, url);
    pasos.push({ paso: nombre, http: r.code, detalle: r.code === 200 ? "OK" : r.msg });
    console.log("── " + nombre + " → HTTP " + r.code + (r.code === 200 ? "" : "  " + r.msg));
    return r;
  }

  var pr = paso("1 · propiedades", B + "properties?per_page=100");
  var uuids = [], names = {};
  if (pr.code === 200) {
    ((pr.json && pr.json.data) || []).forEach(function (p) {
      var u = p.id || p.uuid; if (u) { uuids.push(String(u)); names[String(u)] = p.name || ""; }
    });
  }
  console.log("   propiedades encontradas: " + uuids.length);
  if (!uuids.length) return "El token no puede leer propiedades. Genera un token nuevo con permisos de lectura.";

  var hoy = rvYmd_(new Date());
  var atras = rvYmd_(new Date(Date.now() - 365 * 86400000));
  var qs = uuids.slice(0, 25).map(function (u) { return "properties[]=" + encodeURIComponent(u); }).join("&");

  paso("2 · reservas SIN include", B + "reservations?" + qs + "&start_date=" + atras + "&end_date=" + hoy + "&per_page=5");
  var r3 = paso("3 · reservas CON include=review", B + "reservations?" + qs + "&start_date=" + atras + "&end_date=" + hoy + "&include=review,guest,properties&per_page=100");
  paso("4 · listado global /v2/reviews (normalmente NO existe)", B + "reviews?per_page=3");

  var conReview = 0, ejemplo = null, total = 0;
  if (r3.code === 200) {
    var data = (r3.json && r3.json.data) || [];
    total = data.length;
    for (var i = 0; i < data.length; i++) {
      var rv = rvExtractReview_(data[i], r3.json);
      if (rv) { conReview++; if (!ejemplo) ejemplo = rv; }
    }
    /* Una reserva concreta, endpoint por reserva. */
    if (data.length) paso("5 · reviews de UNA reserva", B + "reservations/" + (data[0].id || data[0].uuid) + "/reviews");
  }

  console.log("\n══ RESUMEN ══");
  console.log("reservas leídas en el primer lote: " + total);
  console.log("reservas que traen review: " + conReview);
  if (ejemplo) console.log("REVIEW CRUDA (para ver dónde viene la nota de limpieza):\n" + JSON.stringify(ejemplo, null, 2).slice(0, 4000));
  else console.log("Ninguna review llegó. Si en Hospitable SÍ ves reviews, el token no tiene el permiso Reviews.");
  console.log(JSON.stringify(pasos, null, 2));

  return conReview
    ? "OK · " + conReview + " reservas con review en el primer lote. Ya puedes correr probarReviews()."
    : "Sin reviews. Revisa el registro: el paso 3 dice si es permiso (401/403) o si simplemente no hay reviews.";
}

/* ═══════════════════════════════════════════════════════════════════════════
   WEBHOOKS DE HOSPITABLE  (plan B, y el más rápido: llega en tiempo real)
   ─────────────────────────────────────────────────────────────────────────
   Configúralo en my.hospitable.com › Apps › Webhooks › + Add new:
     URL   = la MISMA URL /exec de esta app web
     Tipos = Reviews  (puedes marcar también Reservations si lo quieres)
   Luego pulsa «Test»: manda tu última review y queda guardada al instante.
   Con «Send historic webhooks» (los 3 puntitos) te reenvía el histórico.
   ═══════════════════════════════════════════════════════════════════════════ */
function webhookHospitable_(p) {
  try {
    var accion = String(p.action || "");
    if (accion.indexOf("review") !== 0) return out({ ok: true, ignored: accion });

    var rv = p.data || p.review || p;
    var token = HOSPITABLE_TOKEN || PropertiesService.getScriptProperties().getProperty("HOSPITABLE_TOKEN") || "";
    var names = {};
    try { names = rvProperties_(token).names; } catch (e) {}

    var norm = rvFromReview_(rv, names, rv.reservation || (p.data && p.data.reservation) || null);
    if (!norm) { console.log("webhook review sin ID reconocible: " + JSON.stringify(rv).slice(0, 1500)); return out({ ok: true, skipped: "sin ID" }); }

    var up = rvUpsertSheet_([norm]);
    saveConfig("reviews_sync", new Date().toISOString());
    console.log("webhook " + accion + " guardada: " + norm.id + " · limpieza " + norm.ratingLimpieza);
    return out({ ok: true, saved: norm.id, total: up.total });
  } catch (err) {
    console.error("webhookHospitable_: " + err);
    return out({ ok: true, error: String(err) }); /* 200 siempre, para que no reintente en bucle */
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   PROGRAMACIÓN AUTOMÁTICA — Spacio AM
   ───────────────────────────────────────────────────────────────────────────
   Ya no se importa la programación de Hospitable. De Hospitable entran solo las
   RESERVAS; el reparto lo decide el motor de aquí abajo, que es el MISMO código
   que corre en el navegador (github-pages/sched-engine.js).

   Activadores a crear una sola vez — Ejecutar › crearActivadoresProgramacion:
     · cronProgramar18 · todos los días · 6:00–7:00 p.m.  (programa 3 días y
       notifica solo el día siguiente)
     · cronRevisar06   · todos los días · 6:00–7:00 a.m.  (reservas nuevas de hoy)
   Verifica que la zona horaria del proyecto sea GMT-6 (Guatemala).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════════
   PROGRAMACIÓN PERSISTENTE — hoja "Programacion", una fila por limpieza
   ────────────────────────────────────────────────────────────────────────────
   Estaba en una celda de Config. Una celda de Sheets aguanta 50,000 caracteres:
   al acumularse los días el guardado empezaba a fallar sin avisar, y cada
   dispositivo se quedaba con la última versión que alcanzó a ver. Ahora la
   verdad está en una hoja, se poda sola y el guardado devuelve cuántas filas
   quedáron para que el app pueda verificar.
   ═══════════════════════════════════════════════════════════════════════════ */
var SCHED_SHEET = "Programacion";
var SCHED_DIAS_HIST = 45;   /* lo más viejo se poda: el histórico vive en Reportes */
var SCHED_COLS = ["id", "fecha", "vendorEmail", "vendorId", "propiedad", "zona", "edificio",
  "unidad", "habitaciones", "tipo", "entradaHoy", "hora", "horaFin", "orden", "minutos",
  "viaje", "estado", "origen", "motivo", "notificadoEn", "generadoEn", "key", "parDe",
  "reservaId", "codigoAcceso", "excedeJornada", "sobreTope", "ajustadaPorAdmin", "reajustada"];

function schedSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SCHED_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(SCHED_SHEET);
  sh.appendRow(SCHED_COLS);
  sh.setFrozenRows(1);
  /* Migración única: lo que quedaba en la celda Config "schedules". */
  try {
    var cs = ss.getSheetByName("Config");
    if (cs) {
      var d = cs.getDataRange().getValues();
      for (var i = 0; i < d.length; i++) {
        if (d[i][0] !== "schedules") continue;
        var prev = [];
        try { prev = JSON.parse(String(d[i][1] || "[]")); } catch (e) { prev = []; }
        if (prev.length) schedFilas_(sh, prev);
        cs.getRange(i + 1, 2).setValue("[]");
      }
    }
  } catch (e2) { }
  return sh;
}

function schedRead_() {
  var sh = schedSheet_();
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var head = data[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0] && !data[i][1]) continue;
    var o = {};
    for (var c = 0; c < head.length; c++) {
      var k = head[c], v = data[i][c];
      if (k === "fecha" || k === "notificadoEn" || k === "generadoEn") {
        v = (v instanceof Date) ? Utilities.formatDate(v, "GMT-6", "yyyy-MM-dd") : String(v || "").slice(0, 10);
      } else if (k === "hora" || k === "horaFin") {
        /* Sheets convierte "11:00:00" en una fecha de 1899: se vuelve a HH:mm. */
        v = (v instanceof Date) ? Utilities.formatDate(v, "GMT-6", "HH:mm") : String(v || "");
        if (!/^\d{1,2}:\d{2}$/.test(v)) v = (k === "hora" ? SCHED.HORA_INI : SCHED.HORA_FIN);
      } else if (k === "entradaHoy" || k === "excedeJornada" || k === "sobreTope" ||
                 k === "ajustadaPorAdmin" || k === "reajustada") {
        v = (v === true || v === "TRUE" || v === "true" || v === 1);
      } else if (k === "habitaciones" || k === "orden" || k === "minutos" || k === "viaje") {
        v = parseFloat(v) || 0;
      } else { v = (v === null || v === undefined) ? "" : String(v).replace(/^'/, ""); }
      o[k] = v;
    }
    out.push(o);
  }
  return out;
}

function schedFilas_(sh, list) {
  var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
  var corte = Utilities.formatDate(new Date(Date.now() - SCHED_DIAS_HIST * 86400000), "GMT-6", "yyyy-MM-dd");
  var vistos = {}, filas = [];
  (list || []).forEach(function (s) {
    if (!s) return;
    var f = String(s.fecha || "").slice(0, 10);
    if (!f || f < corte) return;
    var id = String(s.id || (f + "|" + (s.propiedad || "") + "|" + (s.tipo || "")));
    if (vistos[id]) return;
    vistos[id] = 1;
    filas.push(SCHED_COLS.map(function (k) {
      var v = (k === "id") ? id : s[k];
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v;
      /* Apóstrofo delante: si no, Sheets convierte "11:00" en una hora de 1899 y
         el técnico terminaba viendo "Sat Dec 30 1899 11:00:00 GMT-0602". */
      if (k === "hora" || k === "horaFin") return "'" + String(v);
      return v;
    }));
  });
  var ultima = sh.getLastRow();
  if (ultima > 1) sh.getRange(2, 1, ultima - 1, SCHED_COLS.length).clearContent();
  if (filas.length) sh.getRange(2, 1, filas.length, SCHED_COLS.length).setValues(filas);
  return { saved: true, n: filas.length, hoy: hoy };
}

function schedWrite_(list) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { }
  try { return schedFilas_(schedSheet_(), list); }
  finally { try { lock.releaseLock(); } catch (e2) { } }
}

/* ═══ HISTORIAL DE VERSIONES DE LA RUTA ═════════════════════════════════════
   UNA FILA POR VERSIÓN, nunca una celda con todo. Una versión de un día son ~8 KB
   de JSON; el tope del app es 25 por día y 7 días de ventana, o sea hasta 175
   versiones — 1.4 MB. Una celda de Sheets aguanta 50 000 caracteres, así que
   guardar el historial completo en Config revienta el guardado (es exactamente
   por lo que la programación ya tuvo que salir de Config a su propia hoja).
   Cada fila lleva el JSON de UN día en UN momento: 8 KB por celda, con margen.

   El app sigue llamando saveConfig("schedvers", …) y leyendo cfg.schedvers: aquí
   se desarma en filas al escribir y se vuelve a armar al leer. */
var SV_SHEET = "ProgramacionVersiones";
var SV_MAX_FILAS = 400;
function svSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SV_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SV_SHEET);
    sh.appendRow(["fecha", "id", "ts", "autor", "motivo", "n", "filas"]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function svWrite_(hist) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {}
  try {
    var sh = svSheet_();

    /* ═══ UNIÓN, NUNCA REEMPLAZO ═══
       Este guardado recibe el mapa de versiones que tenía QUIEN LLAMA, y ese mapa
       casi siempre está viejo: el app carga `schedvers` una sola vez al abrir y no
       lo vuelve a leer, así que un administrador con la pestaña abierta desde
       ayer manda un mapa sin la versión que el motor escribió a las 6 am.
       Si aquí se limpiara la hoja y se escribiera solo lo recibido, ese guardado
       borraría la versión del motor —y entre dos administradores con la pestaña
       abierta, el último en guardar borraría las del otro—. En silencio, además:
       nadie se entera de que el historial perdió una entrada hasta que la va a
       buscar y no está.
       Por eso lo entrante se MEZCLA con lo que ya hay en la hoja y se deduplica
       por id (que ya es único). Un mapa viejo solo puede agregar, nunca quitar. */
    var actual = {};
    try { actual = svRead_() || {}; } catch (e) { actual = {}; }

    var porDia = {};
    function meter(f, v) {
      if (!f || !v || !v.id) return;
      var m = (porDia[f] = porDia[f] || {});
      /* Ante ids repetidos gana el que ya estaba: lo escrito no se reescribe. */
      if (!m[v.id]) m[v.id] = v;
    }
    Object.keys(actual).forEach(function (f) { (actual[f] || []).forEach(function (v) { meter(f, v); }); });
    Object.keys(hist || {}).forEach(function (f) { (hist[f] || []).forEach(function (v) { meter(f, v); }); });

    /* La poda por ventana se hace AQUÍ, sobre el mapa ya mezclado. Si la hiciera
       el llamador, viajaría en su mapa viejo y borraría por la misma puerta que
       acabamos de cerrar. */
    /* Ventana del historial: anteayer, ayer, hoy y mañana. Cuatro días es lo que
       de verdad se restaura —lo de más atrás ya se pagó y lo de más adelante aún
       se puede rehacer con el motor— y mantiene la hoja chica, que es lo que
       protege el guardado de la programación. */
    var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
    var vivos = {};
    for (var i = -2; i <= 1; i++) vivos[SCHED.shift(hoy, i)] = 1;

    var filas = [], saltadas = 0;
    Object.keys(porDia).forEach(function (f) {
      if (!vivos[f]) return;
      var lista = Object.keys(porDia[f]).map(function (id) { return porDia[f][id]; });
      lista.sort(function (a, b) { return (a.ts - b.ts) || String(a.id).localeCompare(String(b.id)); });
      /* Tope por día conservando la primera: es el punto de partida al que
         siempre se puede volver. */
      if (lista.length > 25) lista = [lista[0]].concat(lista.slice(lista.length - 24));
      lista.forEach(function (v) {
        var json = JSON.stringify(v.filas || []);
        /* Un día con más de ~90 limpiezas no cabe en una celda. Antes que perder
           el guardado entero se salta esa versión y queda constancia. */
        if (json.length > 48000) { saltadas++; return; }
        filas.push([String(f), String(v.id || ""), Number(v.ts || 0),
                    String(v.autor || ""), String(v.motivo || ""),
                    Number(v.n || 0), json]);
      });
    });

    /* Si hay que recortar por el tope global, se van las más viejas. */
    filas.sort(function (a, b) { return b[2] - a[2]; });
    if (filas.length > SV_MAX_FILAS) filas = filas.slice(0, SV_MAX_FILAS);

    var ultima = sh.getLastRow();
    if (ultima > 1) sh.getRange(2, 1, ultima - 1, 7).clearContent();
    if (filas.length) sh.getRange(2, 1, filas.length, 7).setValues(filas);

    /* Se devuelve el mapa ya mezclado para que el app adopte lo que él no tenía
       —la versión que escribió el motor mientras su pestaña estaba abierta— sin
       recargar. Si no, el panel seguiría mostrando su mapa viejo y parecería que
       la corrida de las 6 am no dejó versión. */
    var mapa = {};
    filas.forEach(function (r) {
      var f = String(r[0]);
      var fs = []; try { fs = JSON.parse(String(r[6] || "[]")) || []; } catch (e) { fs = []; }
      (mapa[f] = mapa[f] || []).push({ id: String(r[1]), ts: Number(r[2]), autor: String(r[3]),
                                       motivo: String(r[4]), n: Number(r[5]), filas: fs });
    });
    Object.keys(mapa).forEach(function (f) {
      mapa[f].sort(function (x, y) { return (x.ts - y.ts) || String(x.id).localeCompare(String(y.id)); });
    });
    return { ok: true, n: filas.length, saltadas: saltadas, hist: mapa };
  } catch (e) {
    return { ok: false, error: e.toString() };
  } finally { try { lock.releaseLock(); } catch (e2) {} }
}

/* Guardar la programación DEJANDO CONSTANCIA. Todo lo que el servidor cambia sin
   que nadie mire —las corridas de las 6 pm y 6 am, la cancelación de huérfanas,
   el envío del correo— tiene que dejar su versión, o el historial del día tendría
   agujeros justo donde nadie estaba viendo.

   El app registra sus propias versiones antes de llamar aquí, así que este camino
   es solo para el servidor: por eso los llamadores son las funciones cron. */
function schedGuardar_(next, motivo, autor) {
  var prev = [];
  try { prev = schedRead_() || []; } catch (e) { prev = []; }
  var r = saveConfig("schedules", next);
  try { svRegistrarSrv_(prev, next, motivo, autor); } catch (e) {}
  return r;
}
/* Misma regla que en el app: una versión por día que cambió, ventana de ayer a
   +5 días, tope 25, y la primera se conserva como punto de partida. */
function svHuellaSrv_(filas) {
  return (filas || []).map(function (s) {
    return [String(s.fecha || "").slice(0, 10), nk_(s.propiedad), String(s.tipo || ""),
            String(s.vendorEmail || "").toLowerCase(), String(s.hora || ""), String(s.orden || ""),
            String(s.estado || ""), s.notificadoEn ? "1" : "0"].join("~");
  }).sort().join("|");
}
function svRegistrarSrv_(prev, next, motivo, autor) {
  var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
  var hist = {};
  try { hist = svRead_() || {}; } catch (e) { hist = {}; }
  var dias = [], cambio = false;
  for (var i = -2; i <= 1; i++) dias.push(SCHED.shift(hoy, i));
  function delDia(l, f) { return (l || []).filter(function (s) { return s && String(s.fecha || "").slice(0, 10) === f; }); }
  dias.forEach(function (f) {
    var antes = delDia(prev, f), ahora = delDia(next, f);
    if (svHuellaSrv_(antes) === svHuellaSrv_(ahora)) return;
    cambio = true;
    var lista = (hist[f] || []).slice();
    if (!lista.length && antes.length) {
      lista.push({ id: "v" + (Date.now() - 1), ts: Date.now() - 1, autor: "",
                   motivo: "Como estaba antes de guardar el historial", filas: antes, n: antes.length });
    }
    lista.push({ id: "v" + Date.now() + "_" + Math.floor(Math.random() * 1000), ts: Date.now(),
                 autor: autor || "Sistema", motivo: motivo || "Cambio automático", filas: ahora, n: ahora.length });
    if (lista.length > 25) lista = [lista[0]].concat(lista.slice(lista.length - 24));
    hist[f] = lista;
  });
  if (!cambio) return;
  var vivos = {}; dias.forEach(function (f) { vivos[f] = 1; });
  Object.keys(hist).forEach(function (f) { if (!vivos[f]) delete hist[f]; });
  svWrite_(hist);
}

function svRead_() {
  var sh = svSheet_();
  var n = sh.getLastRow();
  if (n < 2) return {};
  var data = sh.getRange(2, 1, n - 1, 7).getValues();
  var out = {};
  data.forEach(function (r) {
    var f = String(r[0] || ""); if (!f) return;
    var filas = [];
    try { filas = JSON.parse(String(r[6] || "[]")) || []; } catch (e) { return; }
    (out[f] = out[f] || []).push({
      id: String(r[1] || ""), ts: Number(r[2] || 0), autor: String(r[3] || ""),
      motivo: String(r[4] || ""), n: Number(r[5] || 0), filas: filas
    });
  });
  /* En orden cronológico: el app cuenta con que la primera es el punto de partida. */
  /* El id desempata los ts iguales: sin él, dos guardados del mismo milisegundo
     invertirían su orden al recargar y la "primera versión" del día —el punto de
     partida al que siempre se puede volver— podría no ser la correcta. */
  Object.keys(out).forEach(function (f) {
    out[f].sort(function (a, b) { return (a.ts - b.ts) || String(a.id).localeCompare(String(b.id)); });
  });
  return out;
}

/* ═══ BITÁCORA — qué corrió, qué se guardó y a quién se le escribió ════════════ */
var BIT_SHEET = "Bitacora";
var BIT_MAX = 1500;
function bitSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(BIT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BIT_SHEET);
    sh.appendRow(["cuando", "tipo", "detalle", "usuario", "extra"]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function bitLog_(tipo, detalle, usuario, extra) {
  try {
    var sh = bitSheet_();
    sh.appendRow([
      Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd HH:mm:ss"),
      String(tipo || ""), String(detalle || ""), String(usuario || "sistema"),
      (extra && typeof extra === "object") ? JSON.stringify(extra) : String(extra || "")
    ]);
    var n = sh.getLastRow();
    if (n > BIT_MAX + 200) sh.deleteRows(2, n - BIT_MAX);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.toString() }; }
}
function bitLeer_(limit) {
  var sh = bitSheet_();
  var n = sh.getLastRow();
  if (n < 2) return { eventos: [] };
  var cuantas = Math.min(limit || 150, n - 1);
  var data = sh.getRange(n - cuantas + 1, 1, cuantas, 5).getValues();
  var out = [];
  for (var i = data.length - 1; i >= 0; i--) {
    var c = data[i][0];
    out.push({
      cuando: (c instanceof Date) ? Utilities.formatDate(c, "GMT-6", "yyyy-MM-dd HH:mm:ss") : String(c || ""),
      tipo: String(data[i][1] || ""), detalle: String(data[i][2] || ""),
      usuario: String(data[i][3] || ""), extra: String(data[i][4] || "")
    });
  }
  return { eventos: out };
}

/* ─── Reservas de Hospitable: de aquí salen los checkouts que generan limpiezas
   y los check-ins que marcan "tiene entrada hoy". */
function syncReservas(days) {
  var token = HOSPITABLE_TOKEN || PropertiesService.getScriptProperties().getProperty("HOSPITABLE_TOKEN") || "";
  if (!token) return { ok: false, error: "Falta HOSPITABLE_TOKEN en Propiedades del script.", reservas: [] };

  /* 1 · El catálogo de propiedades se baja UNA vez y se indexa. Pedir la
     propiedad reserva por reserva es lo que ponía lento el sync. */
  var listings = fetchHospitableListings_();
  if (!listings.ok) return { ok: false, error: listings.error, reservas: [] };

  var porId = {}, porClave = {}, propiedades = [];
  listings.data.forEach(function (l) {
    if (l.id) porId[String(l.id)] = l;
    porClave[nk_(l.name)] = l;
    propiedades.push({ nombre: l.name, habitaciones: l.bedrooms || 0, hospId: String(l.id) });
  });

  /* Lo que le importa al motor es el CHECKOUT: la salida es la que genera la
     limpieza. Pero la API de Hospitable solo sabe filtrar por fecha de ENTRADA
     —start_date/end_date se aplican al check-in—, así que no hay forma de pedirle
     "las que salen esta semana". La única manera de no perder una salida es pedir
     hacia atrás al menos lo que dura la estancia más larga y quedarse con las que
     salen de hoy en adelante, que es lo que se hace más abajo. */
  var ESTANCIA_MAX_DIAS = 120;
  var hoy = new Date();
  var desde = new Date(hoy.getTime() - ESTANCIA_MAX_DIAS * 86400000);
  var hasta = new Date(hoy.getTime() + (days || 21) * 86400000);
  function fmt(d) { return Utilities.formatDate(d, "GMT-6", "yyyy-MM-dd"); }
  var d1 = fmt(desde), d2 = fmt(hasta);

  var uuids = Object.keys(porId);
  var reservas = [], sinNombre = 0, porPlataforma = {};

  /* 2 · Reservas por lotes CON include: sin include=properties,listings el
     nombre de la propiedad no viene de ninguna forma. */
  var lotes = [];
  for (var i = 0; i < uuids.length; i += 20) lotes.push(uuids.slice(i, i + 20));

  for (var l = 0; l < lotes.length; l++) {
    var qs = lotes[l].map(function (u) { return "properties[]=" + encodeURIComponent(u); }).join("&");
    /* Todas las páginas del lote: con una ventana de tres meses, quedarse en la
       primera perdía reservas sin avisar. */
    var data = [], pagina = 1, tope = 0;
    while (tope++ < 25) {
      var url = "https://public.api.hospitable.com/v2/reservations?" + qs +
                "&start_date=" + d1 + "&end_date=" + d2 + "&per_page=100&page=" + pagina +
                "&include=guest,properties,listings";
      var res;
      try {
        res = UrlFetchApp.fetch(url, {
          method: "get",
          headers: { "Authorization": "Bearer " + token, "Accept": "application/json" },
          muteHttpExceptions: true
        });
      } catch (e) { break; }
      if (res.getResponseCode() !== 200) break;
      var j = {};
      try { j = JSON.parse(res.getContentText()); } catch (e2) { break; }
      var pag = j.data || [];
      data = data.concat(pag);
      var meta = j.meta && j.meta.pagination ? j.meta.pagination : null;
      var ultima = meta ? (meta.current_page >= meta.total_pages) : (pag.length < 100);
      if (ultima || !pag.length) break;
      pagina++;
    }

    for (var k = 0; k < data.length; k++) {
      var r = data[k];
      var estado = String(r.status || (r.status_history && r.status_history.current) || "").toLowerCase();
      if (estado.indexOf("cancel") >= 0 || estado.indexOf("declin") >= 0) continue;

      var ci = String((r.arrival_date || r.check_in || (r.dates && (r.dates.arrival_date || r.dates.checkin)) || "")).slice(0, 10);
      var co = String((r.departure_date || r.check_out || (r.dates && (r.dates.departure_date || r.dates.checkout)) || "")).slice(0, 10);
      if (!co) continue;

      /* 3 · El id de propiedad vive en seis campos según la plataforma. */
      var pid = r.property_id || r.propertyId || r.property_uuid
        || (r.properties && r.properties[0] && (r.properties[0].id || r.properties[0].property_id))
        || (r.listings && r.listings[0] && (r.listings[0].id || r.listings[0].property_id))
        || (r.property && r.property.id) || (r.listing && r.listing.id) || "";
      pid = String(pid || "");

      var prop = porId[pid] || (r.properties && r.properties[0]) || r.property || r.listing || {};

      /* 4 · El nombre vive en siete campos y el orden importa: el primero es el
         nombre interno (Z7 - Monaco - C2); public_name es el título del anuncio
         y solo sirve de respaldo. */
      var nombre = prop.name || prop.public_name || prop.private_name
        || prop.nickname || prop.internal_name
        || (r.listing && r.listing.name)
        || (r.listings && r.listings[0] && r.listings[0].name)
        || r.property_name || "";
      nombre = String(nombre || "").trim();

      /* 5 · Si el nombre vino del anuncio, se recupera el interno cotejando con
         clave normalizada: Z7 - Monaco - C2 y Z7-Monaco-C2 son el mismo. */
      var enCatalogo = porClave[nk_(nombre)];
      if (enCatalogo) { prop = enCatalogo; nombre = enCatalogo.name; }

      if (!nombre) {
        sinNombre++;
        var plat = String(r.platform || r.channel || (r.source && r.source.name) || "directa").toLowerCase();
        porPlataforma[plat] = (porPlataforma[plat] || 0) + 1;
        continue;
      }

      var habs = prop.bedrooms;
      if (habs == null && prop.capacity) habs = prop.capacity.bedrooms;
      reservas.push({
        id: String(r.id || r.uuid || (nk_(nombre) + "|" + ci + "|" + co)),
        propiedad: nombre,
        hospId: String(prop.id || pid || ""),
        checkIn: ci,
        checkOut: co,
        habitaciones: parseInt(habs, 10) || 0
      });
    }
  }

  /* Aquí manda el checkout: de todo lo que trajo la consulta ancha se guarda solo
     lo que todavía puede generar o explicar una limpieza —lo que sale de hace tres
     días en adelante—. Las estancias ya terminadas se van, por larga que fuera la
     reserva. */
  var corte = fmt(new Date(hoy.getTime() - 3 * 86400000));
  var vigentes = reservas.filter(function (r) { return String(r.checkOut || "") >= corte; });
  var descartadas = reservas.length - vigentes.length;

  /* Una misma reserva no puede entrar dos veces. */
  var vistas = {}, limpias = [];
  for (var v = 0; v < vigentes.length; v++) {
    var kk = nk_(vigentes[v].propiedad) + "|" + vigentes[v].checkIn + "|" + vigentes[v].checkOut;
    if (vistas[kk]) continue;
    vistas[kk] = 1; limpias.push(vigentes[v]);
  }

  /* Una celda de Sheets tope ~50,000 caracteres: si el historial creciera hasta
     ahí, el guardado fallaría entero y el motor se quedaría sin reservas. Antes de
     llegar, se recortan las salidas más lejanas — nunca las próximas. */
  limpias.sort(function (a, b) { return String(a.checkOut).localeCompare(String(b.checkOut)); });
  var recortadas = 0;
  while (JSON.stringify(limpias).length > 45000 && limpias.length > 1) { limpias.pop(); recortadas++; }

  saveConfig("reservas", limpias);
  saveConfig("reservasSync", Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd HH:mm"));
  var sinHab = limpias.filter(function (x) { return !x.habitaciones; }).length;
  if (recortadas) {
    try { bitLog_("error", "La sincronización de reservas recortó " + recortadas + " reservas lejanas para no desbordar la celda del Sheet.", "cron reservas"); } catch (e3) {}
  }
  return { ok: true, reservas: limpias, propiedades: propiedades, total: limpias.length,
    fueraDeVentana: descartadas, recortadas: recortadas,
           descartadas: sinNombre, porPlataforma: porPlataforma,
           consultadas: uuids.length, sinHabitaciones: sinHab };
}

/* Clave normalizada: minúsculas y solo letras y números. Es la causa del 80% de
   los "no encuentro la propiedad" — el mismo apartamento se escribe
   Z7 - Monaco - C2, Z7-Monaco-C2 o Z7 – Mónaco – C2, y con === no coinciden. */
function nk_(s) {
  return String(s || "").toLowerCase()
    .replace(/[áàäâã]/g, "a").replace(/[éèëê]/g, "e").replace(/[íìïî]/g, "i")
    .replace(/[óòöôõ]/g, "o").replace(/[úùüû]/g, "u").replace(/ñ/g, "n")
    .replace(/[^a-z0-9]/g, "");
}

/* Diagnóstico: cuántas reservas quedan sin nombre y de qué plataforma vienen. */
function diagnosticoReservas() {
  var r = syncReservas(21);
  var res = r.reservas || [];
  var cuenta = {};
  res.forEach(function (x) { var n = x.propiedad || "(sin nombre)"; cuenta[n] = (cuenta[n] || 0) + 1; });
  var salida = {
    propiedadesEnCatalogo: (r.propiedades || []).length,
    reservasUtilizables: res.length,
    descartadasSinNombre: r.descartadas || 0,
    porPlataforma: r.porPlataforma || {},
    sinHabitaciones: r.sinHabitaciones || 0,
    porPropiedad: cuenta
  };
  Logger.log(JSON.stringify(salida, null, 2));
  return salida;
}

/* ─── El rating de 5 semanas lo publica el app (config "schedRatings"): el cron
   no puede recalcularlo porque vive en la atribución de reviews del front. */
function ratingsGuardados_() {
  try {
    var cfg = getConfig();
    return (cfg && cfg.schedRatings && typeof cfg.schedRatings === "object") ? cfg.schedRatings : {};
  } catch (e) { return {}; }
}

/* ─── Corrida de las 6:00 pm — programa los próximos 3 días.
   Notifica SOLO el día siguiente; los otros dos quedan tentativos. */
function cronProgramar18() {
  try {
    syncReservas(21);
    var cfg = getConfig();
    var reservas  = Array.isArray(cfg.reservas)  ? cfg.reservas  : [];
    var vendors   = Array.isArray(cfg.vendors)   ? cfg.vendors   : [];
    var props     = Array.isArray(cfg.props)     ? cfg.props     : [];
    var ausencias = Array.isArray(cfg.ausencias) ? cfg.ausencias : [];
    var existentes= Array.isArray(cfg.schedules) ? cfg.schedules : [];
    /* Si un sync falló, cfg.reservas conserva las viejas: programar sobre ellas
       mandaría rutas en blanco a los técnicos. Mejor no programar nada. */
    reservas = reservas.filter(function (r0) { return r0 && String(r0.propiedad || "").trim(); });
    if (!reservas.length || !vendors.length) {
      var falta = "No programé nada: " + (!vendors.length ? "no hay técnicos activos."
        : "ninguna reserva trae la propiedad identificada (revisar la sincronización con Hospitable).");
      try { bitLog_("error", falta, "cron 6pm"); } catch (e3) { }
      try { avisarAdmins_(vendors, [{ msg: falta }], Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd")); } catch (e2) {}
      /* El motor no pudo repartir limpiezas, pero mañana ya hay trabajo puesto a
         mano —mantenimientos, visitas, proveedores externos— y ese no depende de
         Hospitable. A esa gente sí hay que mandarle su ruta esta noche. */
      try {
        var hoyG = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
        notificarDia_(existentes, vendors, SCHED.shift(hoyG, 1), "programacion");
      } catch (eG) {}
      return { ok: false, error: falta };
    }

    var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
    /* Una cancelación de media tarde también tiene que caerse antes de repartir. */
    existentes = cancelarHuerfanas_(existentes, reservas, vendors, hoy).lista;
    var r = SCHED.programar({
      hoy: hoy, dias: 3, reservas: reservas, props: props, vendors: vendors,
      ratings: ratingsGuardados_(), ausencias: ausencias, existentes: existentes,
      historial: reportesRecientes_(), pesoRating: 0.7
    });

    /* Se conserva lo pasado, lo manual y CADA FILA ya notificada: la ruta que un
       técnico ya recibió no se le cambia, aunque el resto del día sí se replanifique. */
    var conservar = existentes.filter(function (s) {
      var sf = String(s.fecha).slice(0, 10);
      return sf <= hoy || s.origen === "manual" || s.notificadoEn;
    });
    var nuevas = r.asignaciones.map(function (x, i) {
      return Object.assign({}, x, { id: "sc_" + hoy.replace(/-/g, "") + "_" + i });
    });
    var todas = conservar.concat(nuevas);
    schedGuardar_(todas, "Reparto automático de las 6:00 pm", "Sistema · motor 6 pm");

    /* Dos oleadas de aviso:
       · el día anterior se le confirma a TODO el que tenga ruta;
       · tres días antes se le adelanta solo a quien está en el grupo de 3 días
         (Antigua, Monterrico, Likin), para que pueda organizar el viaje.
       Quien recibió el adelanto igual recibe la confirmación el día anterior. */
    var manana = SCHED.shift(hoy, 1);
    var enviados = notificarDia_(todas, vendors, manana, "programacion");

    var tresDias = SCHED.shift(hoy, 3);
    var anticipados = vendors.filter(function (v) {
      return v && v.active && parseInt(v.avisoDias, 10) === 3 && v.email;
    }).map(function (v) { return String(v.email).toLowerCase(); });
    var enviados3 = 0;
    if (anticipados.length) {
      var pendientes3 = todas.filter(function (s) {
        return String(s.fecha).slice(0, 10) === tresDias && !s.notificadoEn &&
               anticipados.indexOf(String(s.vendorEmail || "").toLowerCase()) >= 0;
      });
      if (pendientes3.length) enviados3 = notificarDia_(todas, vendors, tresDias, "programacionAnticipada", anticipados);
    }

    /* Lo que quedó fuera se escribe con nombre y razón: sin esto, "no se programó
       tal apartamento" es imposible de reconstruir después. */
    var fuera = (r.sinAsignar || []).map(function (x) {
      return x.lim.fecha + " " + x.lim.propiedad + " — " + (x.razon || "sin razón");
    });
    var pedidas = SCHED.limpiezasRequeridas({
      reservas: reservas, props: props, desde: r.desde, hasta: r.hasta
    }).length;
    bitLog_("programacion", "Corrida automática de las 6:00 pm — " + nuevas.length +
      " limpiezas para los próximos 3 días · " + enviados + " confirmaciones del " + manana +
      (enviados3 ? " · " + enviados3 + " avisos anticipados del " + tresDias : "") +
      (fuera.length ? " · SIN ASIGNAR: " + fuera.join(" | ") : ""),
      "cron 6pm", { alertas: r.alertas.length, sinAsignar: fuera.length, requeridas: pedidas, reservas: reservas.length });

    if (r.alertas.length) avisarAdmins_(vendors, r.alertas, hoy);
    return { ok: true, programadas: nuevas.length, notificados: enviados, alertas: r.alertas.length };
  } catch (e) {
    console.error("cronProgramar18:", e);
    return { ok: false, error: e.toString() };
  }
}

/* ─── Revisión de las 6:00 am — reservas que entraron durante la noche.
   Solo AGREGA limpiezas de hoy; nunca mueve lo que el técnico ya tiene. */
/* ═══ Limpiezas huérfanas ═══════════════════════════════════════════════════
   Una limpieza automática existe porque hay un checkout que la respalda. Si la
   reserva se cancela, la limpieza tiene que caerse con ella: si no, alguien va a
   un apartamento del que no salió nadie (Inara 412).

   PERO esto solo vale si las reservas que tenemos son confiables. "Ningún
   checkout coincide" puede significar dos cosas muy distintas: que se cancelaron
   todas, o que no sabemos nada. El 29 de agosto significó lo segundo —el sync
   estaba congelado en junio— y una versión sin cerrojos de esta misma función
   borró la ruta completa de un día.

   Aquí corre sin nadie mirando, así que los cerrojos son más estrictos que en la
   app: ante la duda no se cancela, se registra en la bitácora y se deja pasar.
   Una limpieza de sobra la resuelve una persona; una ruta borrada, no.

   Solo toca HOY y MAÑANA, y solo lo automático: lo que un administrador puso a
   mano se respeta. La profunda tampoco: no depende de un checkout. */
function cancelarHuerfanas_(existentes, reservas, vendors, hoy) {
  var manana = SCHED.shift(hoy, 1);
  var res = reservas || [];
  var lista = existentes || [];

  function frena(razon) {
    try { bitLog_("programacion", "Cancelación de huérfanas DETENIDA — " + razon, "cerrojo"); } catch (e) {}
    return { lista: lista, canceladas: [], bloqueo: razon };
  }

  /* Cerrojo 1 — sin reservas no hay con qué comparar. */
  if (!res.length) return frena("Hospitable no devolvió reservas.");

  var salidas = {}, maxCo = "", coVentana = 0;
  res.forEach(function (r0) {
    var co = String(r0 && r0.checkOut || "").slice(0, 10);
    if (!co) return;
    salidas[co + "|" + nk_(r0.propiedad)] = 1;
    if (co > maxCo) maxCo = co;
    if (co === hoy || co === manana) coVentana++;
  });

  /* Cerrojo 2 — datos desfasados: la salida más reciente que conocemos ya pasó. */
  if (maxCo && maxCo < hoy) return frena("Las reservas sincronizadas terminan el " + maxCo + ": están desfasadas.");

  var candidatas = lista.filter(function (s0) {
    if (!s0) return false;
    var f = String(s0.fecha || "").slice(0, 10);
    if (f !== hoy && f !== manana) return false;
    if (s0.origen === "manual" || s0.origen === "visita") return false;
    if (s0.estado === "cancelada") return false;
    if (SCHED.esProfunda(s0.tipo)) return false;
    var clave = (s0.cubreCheckout ? String(s0.cubreCheckout).slice(0, 10) : f) + "|" + nk_(s0.propiedad);
    return !salidas[clave];
  });
  if (!candidatas.length) return { lista: lista, canceladas: [] };

  var enVentana = lista.filter(function (s0) {
    var f = String(s0 && s0.fecha || "").slice(0, 10);
    return (f === hoy || f === manana) && s0.estado !== "cancelada" && !SCHED.esProfunda(s0.tipo);
  }).length;

  /* Cerrojo 3 — cancelación masiva: que se caiga más de la mitad apunta a un
     problema de datos, no a una tarde de cancelaciones. */
  if (enVentana >= 3 && candidatas.length > enVentana * 0.5)
    return frena("Se caerían " + candidatas.length + " de " + enVentana + " limpiezas de la ventana.");

  /* Cerrojo 4 — ni un checkout en la ventana: falta información. */
  if (!coVentana && enVentana >= 3)
    return frena("Las reservas no traen ningún checkout de hoy ni de mañana.");

  var ids = {};
  candidatas.forEach(function (s0) { ids[s0.id] = 1; });
  var canceladas = candidatas;
  lista = lista.map(function (s0) {
    if (!s0 || !ids[s0.id]) return s0;
    /* Se guarda el estado anterior: una baja equivocada tiene que poder
       deshacerse desde la app sin adivinar en qué estado estaba la fila. */
    /* Firmada como "sistema": así la app sabe que puede ofrecer deshacerla, y
       no confunde esto con una cancelación del administrador, que lleva media
       tarifa comprometida en la nómina. */
    return Object.assign({}, s0, {
      estado: "cancelada", estadoPrev: s0.estado || "pendiente",
      canceladaEn: hoy, canceladaPor: "sistema",
      motivoCancel: "El checkout ya no existe en Hospitable"
    });
  });

  schedGuardar_(lista, canceladas.length + " limpieza(s) dadas de baja: su checkout desapareció de Hospitable", "Sistema · detector");
  /* Solo se avisa de lo que el técnico ya tenía en la mano. */
  canceladas.forEach(function (s0) {
    if (!s0.notificadoEn) return;
    var v = (vendors || []).filter(function (vv) {
      return String(vv.email || "").toLowerCase() === String(s0.vendorEmail || "").toLowerCase();
    })[0];
    if (!v || !v.email) return;
    try {
      notify([v.notifEmail || v.email], "limpiezaCancelada", {
        tecnico: [v.primerNombre, v.primerApellido].filter(Boolean).join(" ") || v.name || "",
        propiedad: s0.propiedad, fecha: s0.fecha, hora: s0.hora || ""
      });
    } catch (eN) {}
  });
  try {
    bitLog_("programacion", canceladas.length + " limpieza(s) cancelada(s) porque su checkout desapareció de Hospitable: " +
      canceladas.map(function (x) { return x.propiedad + " (" + x.fecha + ")"; }).join(" | ") +
      ". Se puede deshacer desde Programación.", "huérfanas");
  } catch (eB) {}
  return { lista: lista, canceladas: canceladas };
}

function cronRevisar06() {
  try {
    syncReservas(21);
    var cfg = getConfig();
    var reservas  = Array.isArray(cfg.reservas)  ? cfg.reservas  : [];
    var vendors   = Array.isArray(cfg.vendors)   ? cfg.vendors   : [];
    var props     = Array.isArray(cfg.props)     ? cfg.props     : [];
    var ausencias = Array.isArray(cfg.ausencias) ? cfg.ausencias : [];
    var existentes= Array.isArray(cfg.schedules) ? cfg.schedules : [];
    reservas = reservas.filter(function (r0) { return r0 && String(r0.propiedad || "").trim(); });
    var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
    if (!reservas.length) return { ok: false, error: "Sin reservas utilizables: no se agregó nada." };

    var huer = cancelarHuerfanas_(existentes, reservas, vendors, hoy);
    existentes = huer.lista;
    var canceladas = huer.canceladas;

    var r = SCHED.revisionMatutina({
      hoy: hoy, reservas: reservas, props: props, vendors: vendors,
      ratings: ratingsGuardados_(), ausencias: ausencias, existentes: existentes, pesoRating: 0.7
    });
    if (!r.nuevas.length) return { ok: true, nuevas: 0, canceladas: canceladas.length };

    var nuevas = r.nuevas.map(function (x, i) {
      return Object.assign({}, x, { id: "sc_am_" + hoy.replace(/-/g, "") + "_" + i });
    });
    schedGuardar_(existentes.concat(nuevas), "Revisión de las 6:00 am — " + nuevas.length + " limpieza(s) agregada(s)", "Sistema · motor 6 am");
    var enviados = notificarDia_(nuevas, vendors, hoy, "programacionCambio");
    var fueraAM = (r.sinAsignar || []).map(function (x) {
      return x.lim.propiedad + " — " + (x.razon || "sin razón");
    });
    bitLog_("programacion", "Revisión de las 6:00 am — " + nuevas.length +
      " limpiezas nuevas agregadas a hoy, " + enviados + " avisos enviados." +
      (fueraAM.length ? " SIN ASIGNAR: " + fueraAM.join(" | ") : ""), "cron 6am");
    if (r.alertas.length) avisarAdmins_(vendors, r.alertas, hoy);
    return { ok: true, nuevas: nuevas.length, notificados: enviados };
  } catch (e) {
    console.error("cronRevisar06:", e);
    return { ok: false, error: e.toString() };
  }
}

/* ─── Sincronización automática de reservas (cada 3 horas).
   Así el administrador nunca tiene que presionar "Traer reservas": los checkouts
   del día siguiente ya están frescos cuando corre el motor. */
function cronSyncReservas() {
  try {
    var r = syncReservas(21);
    return { ok: !!r.ok, total: r.total || 0, descartadas: r.descartadas || 0 };
  } catch (e) {
    console.error("cronSyncReservas:", e);
    return { ok: false, error: e.toString() };
  }
}

/* La llave con la que el app guarda los códigos por propiedad. Tiene que ser
   idéntica a normalize() del front o el código no aparece en el correo. */
function normProp_(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.+\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/* Un correo de una hoja de cálculo trae espacios y mayúsculas. Si se compara sin
   limpiarlo, el técnico no aparece en `vendors` y su correo simplemente no sale —
   en silencio, que es la peor forma de fallar. */
function mailKey_(x) { return String(x == null ? "" : x).replace(/\s+/g, "").toLowerCase(); }

/* ─── Un correo por técnico con su ruta del día. */
function notificarDia_(asignaciones, vendors, fecha, tipo, soloEmails) {
  var filtro = null;
  if (soloEmails && soloEmails.length) {
    filtro = {};
    soloEmails.forEach(function (e) { filtro[mailKey_(e)] = 1; });
  }
  var porTec = {};
  asignaciones.forEach(function (s) {
    if (String(s.fecha).slice(0, 10) !== fecha) return;
    var k = mailKey_(s.vendorEmail);
    if (filtro && !filtro[k]) return;
    if (!porTec[k]) porTec[k] = [];
    porTec[k].push(s);
  });
  var dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  var nombreDia = dias[new Date(fecha + "T12:00:00").getDay()] || "";
  /* Códigos de acceso de la semana que corresponde a esta fecha. */
  var codSemana = {};
  try {
    var cfgCod = getConfig().codigos;
    if (cfgCod && typeof cfgCod === "object") codSemana = cfgCod[SCHED.lunesDe(fecha)] || {};
  } catch (eC) { }
  var n = 0;
  Object.keys(porTec).forEach(function (em) {
    var v = null;
    for (var i = 0; i < vendors.length; i++) {
      var vi = vendors[i]; if (!vi) continue;
      if (mailKey_(vi.email) === em || mailKey_(vi.notifEmail) === em) { v = vi; break; }
    }
    /* Sin ficha no hay a quién escribirle, pero el turno igual existe: queda en la
       bitácora para que el administrador lo vea, en vez de desaparecer. */
    if (!v) {
      try { bitLog_("programacion", "Ruta de " + fecha + " sin enviar: no hay técnico con el correo " + em + " (" + porTec[em].length + " parada(s))", "aviso"); } catch (eB) {}
      return;
    }
    var lista = porTec[em].sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
    notify({
      to: [v.notifEmail || v.email],
      type: tipo,
      data: {
        tecnico: [v.primerNombre, v.primerApellido].filter(Boolean).join(" ") || v.name || "",
        fecha: fecha, dia: nombreDia, hora: SCHED.HORA_INI + " a " + SCHED.HORA_FIN,
        total: String(lista.length),
        /* Una ruta de mantenimiento no son "limpiezas". La etiqueta la decide
           lo que trae el día, así el mismo correo sirve para todo el equipo. */
        etiqueta: lista.every(function (s) { return !s.tipo || /limpieza/i.test(s.tipo); }) ? "limpieza" : "trabajo",
        /* Estructurado: la plantilla lo dibuja como la ruta, parada por parada. */
        paradas: lista.map(function (s) {
          return {
            propiedad: s.propiedad, habitaciones: s.habitaciones || 1, tipo: s.tipo,
            entrada: !!s.entradaHoy,
            codigo: String(codSemana[normProp_(s.propiedad)] || s.codigoAcceso || "").trim()
          };
        }),
        limpiezas: lista.map(function (s, i) {
          var cod = String(codSemana[normProp_(s.propiedad)] || s.codigoAcceso || "").trim();
          return (i + 1) + ". " + s.propiedad + " — " + (s.habitaciones || 1) + " hab · " + s.tipo +
                 (s.entradaHoy ? " · TIENE ENTRADA HOY" : "") + (cod ? " · código " + cod : "");
        }).join("\n")
      }
    });
    try {
      bitLog_("correo", "Ruta del " + fecha + " enviada a " + (v.notifEmail || v.email) + " — " +
        lista.length + " trabajo" + (lista.length === 1 ? "" : "s") + ": " +
        lista.map(function (s) { return s.propiedad; }).join(", "),
        [v.primerNombre, v.primerApellido].filter(Boolean).join(" ") || v.name || em, { tipo: tipo });
    } catch (eL) { }
    n++;
  });
  /* Marcar como notificadas SOLO las filas de quienes recibieron el correo: con
     avisos de distinta anticipación, el resto del día sigue siendo replanificable. */
  var avisados = Object.keys(porTec);
  if (avisados.length) {
    try {
      var hoyIso = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
      var cfg = getConfig();
      var sc = Array.isArray(cfg.schedules) ? cfg.schedules : [];
      schedGuardar_(sc.map(function (s) {
        if (String(s.fecha).slice(0, 10) !== fecha) return s;
        if (avisados.indexOf(String(s.vendorEmail || "").toLowerCase()) < 0) return s;
        return Object.assign({}, s, { estado: "confirmada", notificadoEn: hoyIso });
      }), "Ruta del " + fecha + " enviada al equipo (" + avisados.length + " técnico(s))", "Sistema · correo");
    } catch (e) {}
  }
  return n;
}

/* ─── Saturación y topes: le llega al administrador, no al equipo. */
function avisarAdmins_(vendors, alertas, hoy) {
  var admins = vendors.filter(function (v) { return v.isAdmin && v.active && v.email; })
                      .map(function (v) { return v.email; });
  if (!admins.length) return;
  var criticas = alertas.filter(function (a) { return a.nivel === "critica"; });
  notify({
    to: admins,
    subject: (criticas.length ? "Programación: hay que bloquear calendario" : "Programación: revisar carga"),
    body: "Corrida del " + hoy + ".\n\n" +
          alertas.map(function (a) { return "• " + a.msg; }).join("\n") +
          "\n\nEntra a Programación para ajustar la ruta, subir un tope o bloquear calendario."
  });
}

/* ─── Historial de limpiezas profundas, para respetar los ~30 días entre una y otra. */
function reportesRecientes_() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName("Reportes");
    if (!sh) return [];
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    var head = data[0].map(function (h) { return String(h).toLowerCase().trim(); });
    var iCat = head.indexOf("categoria"), iProp = head.indexOf("propiedad"), iFec = head.indexOf("fecha");
    if (iCat < 0 || iProp < 0 || iFec < 0) return [];
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var cat = String(data[i][iCat] || "");
      if (cat.toLowerCase().indexOf("profunda") < 0) continue;
      var f = data[i][iFec];
      out.push({
        propiedad: String(data[i][iProp] || ""),
        tipo: cat,
        fecha: (f instanceof Date) ? Utilities.formatDate(f, "GMT-6", "yyyy-MM-dd") : String(f).slice(0, 10)
      });
    }
    return out;
  } catch (e) { return []; }
}

/* ─── Formularios de un día: la constancia de que la limpieza ocurrió.
   Vale el de limpieza tradicional, el de profunda y el de ajuste — cuando el
   técnico no puede llenar el formulario normal, el ajuste es su constancia. */
function formulariosDelDia_(f) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName("Reportes");
    if (!sh) return [];
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    var head = data[0].map(function (h) { return String(h).toLowerCase().trim(); });
    var iCat = head.indexOf("categoria"), iProp = head.indexOf("propiedad"),
        iFec = head.indexOf("fecha"), iQui = head.indexOf("reportadopor");
    if (iCat < 0 || iProp < 0 || iFec < 0) return [];
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var cat = String(data[i][iCat] || "").toLowerCase();
      var vale = cat.indexOf("limpieza tradicional") >= 0 || cat.indexOf("profunda") >= 0 || cat.indexOf("ajuste") >= 0;
      if (!vale) continue;
      var fv = data[i][iFec];
      var fs = (fv instanceof Date) ? Utilities.formatDate(fv, "GMT-6", "yyyy-MM-dd") : String(fv).slice(0, 10);
      if (fs !== f) continue;
      out.push({
        propiedad: String(data[i][iProp] || ""),
        categoria: String(data[i][iCat] || ""),
        reportadoPor: iQui >= 0 ? String(data[i][iQui] || "").toLowerCase() : ""
      });
    }
    return out;
  } catch (e) { return []; }
}

/* ─── Alerta de la 1:00 pm — quién tiene ruta y no ha registrado nada.
   A media mañana un formulario faltante todavía es "va en camino". A la 1:00 pm
   ya no: o la limpieza no ocurrió, o nadie la está registrando. El administrador
   se entera con tiempo de mover a alguien, no en la noche. */
function cronAlertaLimpiezas13() {
  try {
    var cfg = getConfig();
    var vendors   = Array.isArray(cfg.vendors)   ? cfg.vendors   : [];
    var schedules = Array.isArray(cfg.schedules) ? cfg.schedules : [];
    var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
    var delDia = schedules.filter(function (s) {
      return s && String(s.fecha).slice(0, 10) === hoy && String(s.estado || "") !== "cancelada";
    });
    if (!delDia.length) return { ok: true, sinRuta: true };

    var forms = formulariosDelDia_(hoy);
    var hechas = {};
    forms.forEach(function (r) { hechas[normProp_(r.propiedad)] = 1; });

    var porTec = {}, pendientes = [];
    delDia.forEach(function (s) {
      var em = String(s.vendorEmail || "").toLowerCase();
      if (!porTec[em]) porTec[em] = { total: 0, hechas: 0, faltan: [] };
      porTec[em].total++;
      if (hechas[normProp_(s.propiedad)]) porTec[em].hechas++;
      else { porTec[em].faltan.push(s.propiedad); pendientes.push(s.propiedad); }
    });

    var enCero = Object.keys(porTec).filter(function (em) { return porTec[em].hechas === 0; });
    var admins = vendors.filter(function (v) { return v.isAdmin && v.active && v.email; })
                        .map(function (v) { return v.email; });
    bitLog_("programacion", "Corte de la 1:00 pm — " + (delDia.length - pendientes.length) + " de " +
      delDia.length + " limpiezas con formulario." +
      (enCero.length ? " Sin un solo formulario: " + enCero.join(", ") + "." : ""), "cron 1pm");

    if (!enCero.length || !admins.length) return { ok: true, enCero: enCero.length, pendientes: pendientes.length };

    function nombre(em) {
      for (var i = 0; i < vendors.length; i++) {
        if (String(vendors[i].email || "").toLowerCase() === em) {
          return [vendors[i].primerNombre, vendors[i].primerApellido].filter(Boolean).join(" ") || vendors[i].name || em;
        }
      }
      return em;
    }
    notify({
      to: admins,
      subject: "Corte de la 1:00 pm — " + enCero.length + " técnico" + (enCero.length === 1 ? "" : "s") + " sin formulario",
      body: "Son la 1:00 pm del " + hoy + " y estos técnicos tienen ruta pero no han registrado ni un formulario:\n\n" +
        enCero.map(function (em) {
          return "• " + nombre(em) + " — " + porTec[em].total + " limpieza" + (porTec[em].total === 1 ? "" : "s") +
                 ": " + porTec[em].faltan.join(", ");
        }).join("\n") +
        "\n\nEn total van " + (delDia.length - pendientes.length) + " de " + delDia.length +
        " limpiezas del día con formulario.\n\nEntra a Programación para ver el estado de cada una."
    });
    return { ok: true, enCero: enCero.length, pendientes: pendientes.length };
  } catch (e) {
    console.error("cronAlertaLimpiezas13:", e);
    return { ok: false, error: e.toString() };
  }
}

/* ─── 7:00 pm · recordatorio al técnico que no ha subido su formulario.
   El corte de la 1:00 pm existe para que el administrador reaccione; este es
   para el técnico, y a las 7:00 pm todavía le da tiempo de subirlo el mismo
   día. Solo se le escribe a quien de verdad tiene algo pendiente, y una sola
   vez por día: un recordatorio que llega de más deja de leerse. */
function cronRecordatorio19() {
  try {
    var cfg = getConfig();
    var vendors   = Array.isArray(cfg.vendors)   ? cfg.vendors   : [];
    var props     = Array.isArray(cfg.props)     ? cfg.props     : [];
    var schedules = Array.isArray(cfg.schedules) ? cfg.schedules : [];
    var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
    var delDia = schedules.filter(function (s) {
      return s && String(s.fecha).slice(0, 10) === hoy && String(s.estado || "") !== "cancelada";
    });
    if (!delDia.length) return { ok: true, sinRuta: true };

    var forms = formulariosDelDia_(hoy);
    var hechas = {};
    forms.forEach(function (r) { hechas[normProp_(r.propiedad)] = 1; });

    var porTec = {};
    delDia.forEach(function (s) {
      if (hechas[normProp_(s.propiedad)]) return;
      var em = String(s.vendorEmail || "").toLowerCase();
      if (!em) return;
      if (!porTec[em]) porTec[em] = [];
      porTec[em].push(s);
    });
    var emails = Object.keys(porTec);
    if (!emails.length) {
      bitLog_("programacion", "Recordatorio de las 7:00 pm — todos los formularios del día están arriba.", "cron 7pm");
      return { ok: true, pendientes: 0 };
    }

    var enviados = 0, detalle = [];
    emails.forEach(function (em) {
      var v = null;
      for (var i = 0; i < vendors.length; i++) {
        if (String(vendors[i].email || "").toLowerCase() === em) { v = vendors[i]; break; }
      }
      if (!v || v.active === false) return;
      var nombre = [v.primerNombre, v.primerApellido].filter(Boolean).join(" ") || v.name || em;
      var faltan = porTec[em];
      var paradas = faltan.map(function (s) {
        return { propiedad: s.propiedad, meta: ((s.habitaciones || 1) + " hab · " + (s.tipo || "Limpieza")) };
      });
      notify({
        to: [v.notifEmail || v.email],
        type: "formularioPendiente",
        data: { tecnico: nombre, fecha: hoy, total: String(faltan.length), paradas: paradas }
      });
      enviados++;
      detalle.push(nombre + " (" + faltan.length + ")");
    });
    bitLog_("programacion", "Recordatorio de las 7:00 pm — " + enviados + " técnico(s) con formulario pendiente: " +
      (detalle.join(", ") || "—") + ".", "cron 7pm");
    return { ok: true, enviados: enviados, pendientes: emails.length };
  } catch (e) {
    console.error("cronRecordatorio19:", e);
    return { ok: false, error: e.toString() };
  }
}

function cronVerificarCheckouts() {
  try {
    var cfg = getConfig();
    var vendors   = Array.isArray(cfg.vendors)   ? cfg.vendors   : [];
    var props     = Array.isArray(cfg.props)     ? cfg.props     : [];
    var schedules = Array.isArray(cfg.schedules) ? cfg.schedules : [];
    var hoy = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
    var fin = SCHED.shift(hoy, 2);

    /* Se relee de Hospitable en el momento: si la comparación usara la copia
       guardada, un fallo de sincronización se compararía consigo mismo. */
    var sync = syncReservas(21);
    var reservas = (sync && sync.reservas) ? sync.reservas : (Array.isArray(cfg.reservas) ? cfg.reservas : []);
    if (!sync || !sync.ok) {
      var admins0 = vendors.filter(function (v) { return v.isAdmin && v.active && v.email; }).map(function (v) { return v.email; });
      if (admins0.length) {
        notify({ to: admins0, subject: "Verificación de checkouts — no se pudo leer Hospitable",
          body: "La verificación diaria no pudo consultar Hospitable" + (sync && sync.error ? ": " + sync.error : ".") +
                "\n\nMientras no se resuelva, la programación puede estar trabajando con reservas viejas." });
      }
      bitLog_("error", "Verificación de checkouts: falló la lectura de Hospitable.", "cron verificación");
      return { ok: false };
    }

    function propKey(n) { return nk_(String(n || "")); }
    var enPausaKey = {};
    props.forEach(function (p) {
      var nombre = p && (p.name || p.nombre);
      if (nombre && SCHED.enPausa(p, hoy)) enPausaKey[propKey(nombre)] = true;
    });

    /* Lo que Hospitable dice que sale, día por día, dentro del horizonte. */
    var esperados = {};
    reservas.forEach(function (r) {
      var co = String(r.checkOut || "").slice(0, 10);
      if (!co || co < hoy || co > fin) return;
      if (enPausaKey[propKey(r.propiedad)]) return;
      esperados[co + "|" + propKey(r.propiedad)] = { fecha: co, propiedad: r.propiedad };
    });

    /* Lo que el app tiene programado en ese mismo horizonte. */
    var programado = {};
    schedules.forEach(function (s) {
      var f = String(s.fecha || "").slice(0, 10);
      if (!f || f < hoy || f > fin) return;
      programado[f + "|" + propKey(s.propiedad)] = s;
    });

    var faltan = [], sobran = [];
    for (var k in esperados) {
      if (!esperados.hasOwnProperty(k)) continue;
      if (!programado[k]) faltan.push(esperados[k]);
    }
    for (var k2 in programado) {
      if (!programado.hasOwnProperty(k2)) continue;
      var sp = programado[k2];
      if (SCHED.esProfunda(sp.tipo)) continue;      /* la profunda no nace de un checkout */
      if (sp.origen === "manual") continue;          /* la puso el administrador a propósito */
      if (!esperados[k2]) sobran.push(sp);
    }

    faltan.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    sobran.sort(function (a, b) { return String(a.fecha) < String(b.fecha) ? -1 : 1; });

    bitLog_("programacion", "Verificación con Hospitable — " + Object.keys(esperados).length +
      " checkouts esperados hasta el " + fin + " · " + faltan.length + " sin programar · " +
      sobran.length + " programadas sin checkout.", "cron verificación",
      { faltan: faltan.length, sobran: sobran.length });

    if (!faltan.length && !sobran.length) return { ok: true, faltan: 0, sobran: 0 };

    var admins = vendors.filter(function (v) { return v.isAdmin && v.active && v.email; }).map(function (v) { return v.email; });
    if (!admins.length) return { ok: true, faltan: faltan.length, sobran: sobran.length, sinAdmins: true };

    function nombreTec(em) {
      for (var i = 0; i < vendors.length; i++) {
        if (String(vendors[i].email || "").toLowerCase() === String(em || "").toLowerCase()) {
          return [vendors[i].primerNombre, vendors[i].primerApellido].filter(Boolean).join(" ") || vendors[i].name || em;
        }
      }
      return em || "sin técnico";
    }
    var cuerpo = "Comparación de la programación del app con los checkouts que hoy devuelve Hospitable (del " + hoy + " al " + fin + ").\n\n";
    if (faltan.length) {
      cuerpo += "CHECKOUT SIN LIMPIEZA PROGRAMADA (" + faltan.length + ")\n" +
        faltan.map(function (x) { return "• " + x.fecha + " — " + x.propiedad; }).join("\n") + "\n\n";
    }
    if (sobran.length) {
      cuerpo += "LIMPIEZA PROGRAMADA SIN CHECKOUT EN HOSPITABLE (" + sobran.length + ")\n" +
        sobran.map(function (x) { return "• " + String(x.fecha).slice(0, 10) + " — " + x.propiedad + " · " + nombreTec(x.vendorEmail); }).join("\n") +
        "\nPuede ser una reserva cancelada o movida después de programar.\n\n";
    }
    cuerpo += "Esta revisión NO programa ni cancela nada: solo avisa. Entra a Programación para decidir.";

    notify({
      to: admins,
      subject: "Checkouts vs. programación — " + faltan.length + " sin programar" + (sobran.length ? " · " + sobran.length + " de más" : ""),
      body: cuerpo
    });
    return { ok: true, faltan: faltan.length, sobran: sobran.length };
  } catch (e) {
    console.error("cronVerificarCheckouts:", e);
    try { bitLog_("error", "Verificación de checkouts falló: " + e, "cron verificación"); } catch (e2) {}
    return { ok: false, error: e.toString() };
  }
}

/* ─── Crea los dos activadores. Ejecutar UNA vez desde el editor. */
function crearActivadoresProgramacion() {
  var t = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t.length; i++) {
    var fn = t[i].getHandlerFunction();
    if (fn === "cronProgramar18" || fn === "cronRevisar06" || fn === "cronSyncReservas" || fn === "cronAlertaLimpiezas13" || fn === "cronRecordatorio19" || fn === "cronVerificarCheckouts") ScriptApp.deleteTrigger(t[i]);
  }
  ScriptApp.newTrigger("cronProgramar18").timeBased().atHour(18).everyDays(1).create();
  ScriptApp.newTrigger("cronRevisar06").timeBased().atHour(6).everyDays(1).create();
  /* Reservas frescas sin intervención: el administrador no debe presionar nada. */
  ScriptApp.newTrigger("cronSyncReservas").timeBased().everyHours(3).create();
  /* Corte del mediodía: quién no ha registrado nada. */
  ScriptApp.newTrigger("cronAlertaLimpiezas13").timeBased().atHour(13).everyDays(1).create();
  /* Recordatorio de la noche: le escribe al técnico, no al administrador. */
  ScriptApp.newTrigger("cronRecordatorio19").timeBased().atHour(19).everyDays(1).create();
  /* Contraste diario con Hospitable: avisa discrepancias, no programa nada. */
  ScriptApp.newTrigger("cronVerificarCheckouts").timeBased().atHour(7).everyDays(1).create();
  return "Activadores creados: 6:00 pm programa 3 días · 6:00 am revisa reservas nuevas · 7:00 am verifica checkouts contra Hospitable · 1:00 pm alerta al admin de limpiezas sin formulario · 7:00 pm recordatorio al técnico con formulario pendiente · reservas se sincronizan cada 3 horas. Verifica zona horaria GMT-6.";
}

/* ─── Prueba del recordatorio de la noche sin esperar a las 7pm. */
function probarRecordatorio19() {
  var r = cronRecordatorio19();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/* ─── Prueba manual sin esperar a las 6pm. */
function probarProgramacion() {
  var r = cronProgramar18();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

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
var SCHED = (function () {
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
  /* Bono de reparto por zona: la favorita pesa el doble que la preferida. */
  var ZONA_PREF_BONO = 14, ZONA_FAV_BONO = 28;
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
    VILLANUEVA: [14.5260, -90.5870],
    MONTERRICO: [13.8930, -90.4670], LIKIN: [13.9210, -90.7860]
  };
  /* Nombre legible de cada zona para la interfaz — las claves son para el motor. */
  var ZONA_LABEL = {
    MIXCO: "Mixco", SANLUCAS: "San Lucas", ANTIGUA: "Antigua",
    CES: "Carretera a El Salvador", FRAIJANES: "Fraijanes",
    PINULA: "Santa Catarina Pinula", VILLANUEVA: "Villa Nueva",
    MONTERRICO: "Monterrico", LIKIN: "Likín"
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
    "LAANTIGUA":"ANTIGUA","ANTIGUAGUATEMALA":"ANTIGUA","SANLUCASSACATEPEQUEZ":"SANLUCAS",
    "LIKN":"LIKIN","LIQUIN":"LIKIN","CASAMONTERRICO":"MONTERRICO","MONTERICO":"MONTERRICO"
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
      /* Propiedad en pausa: no entra al reparto automático. Se usa para
         apartamentos fuera de servicio. Una pausa "solo profundas" NO frena la
         limpieza de checkout — de eso trata el tercer argumento. */
      if (enPausa(cfg, f, "limpieza")) continue;
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
     solo `hasta` es "hasta esa fecha".
     ALCANCE: por defecto la pausa saca a la propiedad de TODO el reparto. Con
     `soloProfundas` solo frena las profundas y la limpieza de checkout se sigue
     programando — que es el caso real de las estancias largas: el huésped sale,
     hay que limpiar, lo que no toca es la profunda. Antes no existía esa
     distinción y una propiedad pausada "para profundas" amanecía sin nadie
     el día de su checkout. */
  function enPausa(prop, f, ambito) {
    if (!prop) return false;
    var p = prop.pausa;
    if (!p || !p.activa) return false;
    if (p.soloProfundas && ambito && ambito !== "profunda") return false;
    var d = String(f || "").slice(0, 10);
    var desde = String(p.desde || "").slice(0, 10);
    var hasta = String(p.hasta || "").slice(0, 10);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    return true;
  }

  /* ─── Propiedad nueva ───────────────────────────────────────────────────
     Los primeros ARRANQUE_MESES desde la fecha de alta (ficha: altaEn) la
     propiedad no entra al ciclo de profundas: acaba de prepararse y la primera
     profunda automática llegaría sobre un apartamento recién puesto a punto.
     La limpieza de checkout sigue normal. Sin altaEn no aplica. */
  var ARRANQUE_MESES = 2;
  function finArranque(prop) {
    var a = String((prop && prop.altaEn) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) return "";
    var d = fecha(a); d.setMonth(d.getMonth() + ARRANQUE_MESES); return iso(d);
  }
  function enArranque(prop, f) {
    var fin = finArranque(prop);
    return !!fin && String(f || "").slice(0, 10) < fin;
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
    /* Reglas por propiedad: hay apartamentos a los que no se les programa
       profunda automática, y otros cuya profunda siempre la hace la misma
       persona. Se leen de la ficha: sinProfundas / profundaTecnico. */
    var reglas = {};
    for (var rp = 0; rp < props.length; rp++) {
      var pn = props[rp] && (props[rp].name || props[rp].nombre);
      if (pn) reglas[norm(pn)] = props[rp];
    }
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
    /* Solo formularios entregados: una profunda agendada no es una profunda hecha. */
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
    var excluir = o.excluir || {};
    var candidatas = [];
    for (var pk in porProp) {
      if (!porProp.hasOwnProperty(pk)) continue;
      if (excluir[pk]) continue; /* ya tiene una profunda agendada sin hacer */
      if (reglas[pk] && reglas[pk].sinProfundas) continue; /* fuera del ciclo automático */
      /* La limpieza de checkout de una propiedad pausada "solo profundas" SÍ se
         programa, así que aquí hay que frenar la profunda a mano: si no, se
         montaría justo encima de ella. */
      if (reglas[pk] && enPausa(reglas[pk], porProp[pk].fecha, "profunda")) continue;
      /* Propiedad nueva: sin profundas automáticas en sus primeros dos meses. */
      if (reglas[pk] && enArranque(reglas[pk], porProp[pk].fecha)) continue;
      var base = porProp[pk];
      var prev = ultima[pk];
      /* Sin historial: se programa la primera. Con historial: cuando ya pasaron
         los ~30 días (se acepta desde el día 26 para poder montarla sobre una
         limpieza real en lugar de esperar una fecha exacta). */
      if (prev && dias(prev, base.fecha) < PROFUNDA_CADA_DIAS - 4) continue;
      candidatas.push({ pk: pk, base: base, prev: prev || "" });
    }
    /* La que lleva MÁS DÍAS ACUMULADOS sin limpieza profunda va primero. Se mide
       en días reales (no comparando fechas sueltas); la que nunca tuvo, de primera. */
    candidatas.sort(function (a, b) {
      var da = a.prev ? dias(a.prev, a.base.fecha) : 1e9;
      var db = b.prev ? dias(b.prev, b.base.fecha) : 1e9;
      if (da !== db) return db - da;
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
        ultimaProfunda: prev,
        /* Si la propiedad tiene técnico fijo para profundas, la limpieza nace
           amarrada a él: el reparto no la ofrece a nadie más. */
        fijoEmail: (reglas[pk] && reglas[pk].profundaTecnico) ? String(reglas[pk].profundaTecnico).toLowerCase() : ""
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
  /* Una ausencia documentada saca al técnico del reparto de ese día, sin importar
     su estado — las ausencias ya no se autorizan, solo se documentan. Antes solo
     bloqueaba `aprobada`, y una ausencia auto-aplicada (estado "aplicada") dejaba
     de bloquear: la siguiente corrida le volvía a asignar ruta a alguien ausente. */
  function ausente(v, f, ausencias) {
    var em = String(v.email || "").toLowerCase();
    for (var i = 0; i < (ausencias || []).length; i++) {
      var a = ausencias[i];
      if (!a || a.estado === "rechazada") continue;
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
      /* Zona favorita: un escalón arriba de la preferida. Pesa el doble, pero sigue
         siendo ventaja y no exclusividad — la rotación y la carga pueden ganarle. */
      var zTop = zonasDe(v, "zonasTop").filter(function (z) { return zAsig.indexOf(z) >= 0; });
      est[em] = {
        v: v, email: em,
        zonas: zAsig,
        pref: zPref,
        top: zTop,
        maxDia: Math.max(1, parseInt(v.maxDia, 10) || MAX_DIA_DEF),
        puedeProfunda: v.puedeProfunda !== false,
        usados: 0, minutos: 0, paradas: [],
        base: { zonasBase: zTop.concat(zPref, zAsig) },
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

    /* ── Filtros duros: puede este técnico tomar esta limpieza, sí o no. ─────── */
    function factible(lim, t, exceso) {
      var esP = esProfunda(lim.tipo);
      if (lim.fijoEmail && t.email !== lim.fijoEmail) return false;
      var tope = exceso ? Math.min(MAX_DIA_TOPE, Math.max(t.maxDia, MAX_DIA_DEF + 2)) : t.maxDia;
      if (t.usados >= tope) return false;
      if (esP && !t.puedeProfunda) return false;
      if (esP && t.usados > 0) return false;                       /* la profunda ocupa el turno */
      if (!esP && tieneProfunda(asignaciones, t.email)) return false;
      if (lim.parDe && yaTieneKey(asignaciones, t.email, lim.parDe)) return false;
      var z = zonaKey(lim.zona);
      if (!z || t.zonas.indexOf(z) < 0) return false;              /* zona: regla dura */
      var primera = t.paradas.length === 0;
      var prev = primera ? t.base : t.paradas[t.paradas.length - 1];
      var total = t.minutos + (primera ? 0 : travelMin(prev, lim)) + minutosLimpieza(lim.habitaciones, lim.tipo);
      return total <= JORNADA_MIN + (exceso ? TOLERANCIA_MIN : 0);
    }

    /* Piso de la ronda: la menor carga entre quienes PUEDEN tomar esta limpieza.
       Mantiene el reparto parejo también en la tercera y la cuarta vuelta. */
    function pisoRonda(lim) {
      var min = null;
      for (var i = 0; i < disponibles.length; i++) {
        if (!factible(lim, disponibles[i], false)) continue;
        if (min === null || disponibles[i].usados < min) min = disponibles[i].usados;
        if (min === 0) return 0;
      }
      return min;
    }

    function colocar(lim, t, motivo) {
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
        motivo: motivo,
        parDe: lim.parDe || "", reservaId: lim.reservaId || ""
      });
    }

    var pendientes = [];
    for (var pc = 0; pc < limpiezas.length; pc++) pendientes.push(limpiezas[pc]);

    /* ══ PRIMERA RONDA — regla dura, antes que cualquier criterio de calidad ══
       Cada técnico disponible recibe UNA limpieza si existe alguna que pueda
       hacer. Hasta que todos tengan la suya no se reparte una segunda. Que un
       técnico quede en cero significa que no había ni una limpieza en sus zonas
       — nunca que el reparto se lo saltó.
       Se atiende primero a quien tiene MENOS opciones: si a una persona solo le
       sirve una limpieza y a otra le sirven ocho, dársela antes a la de ocho
       dejaría a la primera sin trabajo. */
    var ronda1 = [];
    for (var d1 = 0; d1 < disponibles.length; d1++) ronda1.push(disponibles[d1]);
    for (var r1 = 0; r1 < ronda1.length; r1++) {
      var op = 0;
      for (var r2 = 0; r2 < pendientes.length; r2++) if (factible(pendientes[r2], ronda1[r1], false)) op++;
      ronda1[r1].__opciones = op;
    }
    ronda1.sort(function (a, b) {
      if (a.__opciones !== b.__opciones) return a.__opciones - b.__opciones;
      if (a.semana !== b.semana) return a.semana - b.semana;
      return b.rating - a.rating;
    });
    for (var ri = 0; ri < ronda1.length; ri++) {
      var tr = ronda1[ri];
      if (tr.usados > 0) continue;                 /* ya trae trabajo fijado ese día */
      var elegida = null, mejorS = -1e9, notasR = [];
      for (var rj = 0; rj < pendientes.length; rj++) {
        var cnd = pendientes[rj];
        if (!factible(cnd, tr, false)) continue;
        var zc = zonaKey(cnd.zona), nn = [], sc = 0;
        if (tr.top.indexOf(zc) >= 0) { sc += ZONA_FAV_BONO; nn.push("zona favorita"); }
        else if (tr.pref.indexOf(zc) >= 0) { sc += ZONA_PREF_BONO; nn.push("zona de preferencia"); }
        if (cnd.entradaHoy) sc += 12;
        sc -= travelMin(tr.base, cnd) * 1.1;
        if (tr.rot.total >= 5 && zc) {
          var shZ = (tr.rot.porZona[zc] || 0) / tr.rot.total;
          if (shZ > 0.45) { sc -= Math.min(26, (shZ - 0.45) * 70); nn.push("rotación de zona"); }
        }
        var vp = tr.rot.porProp[norm(cnd.propiedad)] || 0;
        if (vp >= 2) { sc -= Math.min(20, (vp - 1) * 7); nn.push("ya lo limpió " + vp + " veces este mes"); }
        sc += hash(tr.email + cnd.key) * 0.9;
        if (sc > mejorS) { mejorS = sc; elegida = cnd; notasR = nn; }
      }
      if (!elegida) continue;
      notasR.unshift("primera limpieza del día");
      colocar(elegida, tr, notasR.join(" · "));
      pendientes.splice(pendientes.indexOf(elegida), 1);
    }

    /* ══ RONDAS SIGUIENTES — ya con los criterios de siempre ══════════════════
       Cercanía, rating, compensación semanal y rotación. El piso de ronda evita
       que alguien salte a la tercera mientras otro sigue en la primera. */
    for (var c = 0; c < pendientes.length; c++) {
      var lim = pendientes[c];
      var piso = pisoRonda(lim);
      var res = piso == null ? { tec: null, razon: "" } : elegir(lim, disponibles, {
        avgSemana: avgSemana, pesoRating: pesoRating,
        asignaciones: asignaciones, permitirExceso: false, soloRonda: piso
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
      colocar(lim, res.tec, res.motivo);
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
      if (lim.fijoEmail && t.email !== lim.fijoEmail) continue;
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
         traslado — es la prioridad. Mismo edificio es el ideal; misma zona, lo
         siguiente. Los bonos son fuertes para que el rating y la rotación no
         manden a nadie a cruzar la ciudad por una limpieza suelta. */
      if (!primera && prev.edificio && lim.edificio && norm(prev.edificio) === norm(lim.edificio)) { s += 70; notas.push("mismo edificio"); }
      else if (!primera && zonaKey(prev.zona) === z && z) { s += 46; notas.push("misma zona"); }
      else if (!primera) {
        /* Sacar al técnico de la zona donde ya está trabajando cuesta: se penaliza
           según lo lejos que quede, para no romper una ruta compacta. */
        s -= 22; notas.push("fuera de su ruta de hoy");
      }

      /* La preferencia da prioridad DENTRO de sus zonas, sin volverse jaula: el
         bono es moderado para que la rotación pueda ganarle. */
      if (t.top.indexOf(z) >= 0) { s += ZONA_FAV_BONO; notas.push("zona favorita"); }
      else if (t.pref.indexOf(z) >= 0) { s += ZONA_PREF_BONO; notas.push("zona de preferencia"); }
      else { s += 6; notas.push("zona asignada"); }

      s -= viaje * 1.1;

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
    var yaAgendada = {};
    (o.existentes || []).forEach(function (s) {
      if (s && esProfunda(s.tipo) && String(s.fecha).slice(0, 10) >= hoy) yaAgendada[norm(s.propiedad)] = 1;
    });
    base = agregarProfundas(base, {
      props: o.props, historial: o.historial || [], hoy: hoy, excluir: yaAgendada,
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
      /* Una limpieza cancelada por el administrador ocupa su lugar: el motor no la
         puede resucitar en la siguiente corrida. */
      var canceladasDia = (o.existentes || []).filter(function (s) {
        return s && String(s.estado || "") === "cancelada" && String(s.fecha).slice(0, 10) === f;
      });
      var fijosDia = manualesDia.concat(notificadasDia).concat(canceladasDia);
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
      if (enPausa(props[p], hoy, "profunda")) continue;
      /* Ni una a la que se le quitaron las profundas a propósito. */
      if (props[p].sinProfundas) continue;
      /* Ni una propiedad nueva en sus dos primeros meses. */
      if (enArranque(props[p], hoy)) continue;
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

  return {
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
    estadoProfundas: estadoProfundas,
    ARRANQUE_MESES: ARRANQUE_MESES, finArranque: finArranque, enArranque: enArranque,
    ZONA_FAV_BONO: ZONA_FAV_BONO, ZONA_PREF_BONO: ZONA_PREF_BONO
  };
})();







/* ═══════════════════════════════════════════════════════════════════════════
   CORREOS — plantillas
   Se recuperaron aquí tras la incorporación del motor de programación.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Base pública de las imágenes (carpeta email-assets/ del repo). */
var EMAIL_IMG_BASE = "https://epi.spacioam.com/email-assets/";
var EMAIL_LOGO     = EMAIL_IMG_BASE + "logo-wordmark.png";
var EMAIL_SLOGAN   = "Hay espacios en donde sueñas con volver a despertar";
var EMAIL_TEAM     = "SPACIO AM · EQUIPO DE PRIMERA IMPRESIÓN";
/* earth pasó a graphite: en los correos SIEMPRE carga texto (eslogan, eyebrows,
   detalle de parada, pie, firma) y a 9.5–16px el #938B8A daba 3.19:1.
   entrada  = el terracota con el que el app marca "entra huésped": mismo dato,
              mismo color en pantalla y en el correo.
   ctaBg/ctaBd = CTA cálido del sistema. El peach NO carga texto: el botón es
              tinte + borde peach + texto ink, nunca blanco sobre peach (2.56:1). */
var EMAIL_C = { bg:"#FAFAFA", card:"#FFFFFF", ink:"#3E3F3F", earth:"#6F6867", divider:"#D8D4CE", peach:"#E9826A", imgbg:"#EDE7E0", entrada:"#B4553C", ctaBg:"#FCF0ED", ctaBd:"#E9826A" };
/* 'Valky' se carga vía @font-face para clientes que lo soportan (Apple Mail, iOS);
   el resto cae con gracia a Georgia. */
var EMAIL_SERIF = "'Valky', Georgia, 'Times New Roman', serif";
var EMAIL_SANS  = "Helvetica, Arial, sans-serif";

function emailEsc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Shell reutilizable → { html, text } */
function emailShell_(o) {
  o = o || {};
  var C = EMAIL_C;
  var eyebrow = o.eyebrow || "", heading = o.heading || "";
  var paras = o.paras || [], rows = o.rows || [], cta = o.cta || null, stops = o.stops || [];
  var list = o.list || [];
  var footerNote = o.footerNote || "";
  var signoff = o.signoff || "Con cariño,\nEl equipo de Spacio AM";
  var preheader = o.preheader || (paras[0] || heading);
  var imgUrl = o.image ? (/^https?:/.test(o.image) ? o.image : (EMAIL_IMG_BASE + o.image)) : "";

  var H = [];
  H.push('<!doctype html><html lang="es"><head><meta charset="utf-8">');
  H.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  H.push('<meta name="color-scheme" content="light only"><title>' + emailEsc_(heading) + '</title>');
  H.push('<style>@font-face{font-family:"Valky";font-style:normal;font-weight:400;src:url("' + EMAIL_IMG_BASE + 'Valky-Regular.otf") format("opentype");}</style></head>');
  H.push('<body style="margin:0;padding:0;background:' + C.bg + ';">');
  H.push('<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + C.bg + ';font-size:1px;line-height:1px;">' + emailEsc_(preheader) + '</div>');
  H.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.bg + ';margin:0;padding:0;"><tr><td align="center" style="padding:32px 16px;">');
  H.push('<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:' + C.card + ';border-radius:24px;overflow:hidden;border:1px solid ' + C.divider + ';">');
  H.push('<tr><td align="center" style="padding:38px 40px 26px;">');
  H.push('<img src="' + EMAIL_LOGO + '" width="180" alt="Spacio AM" style="display:block;width:180px;max-width:60%;height:auto;border:0;margin:0 auto;">');
  H.push('<div style="font-family:' + EMAIL_SERIF + ';font-size:16px;line-height:1.5;font-style:italic;color:' + C.earth + ';margin-top:18px;letter-spacing:.2px;max-width:380px;">' + emailEsc_(EMAIL_SLOGAN) + '</div></td></tr>');
  if (o.band) {
    H.push('<tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:' + C.imgbg + ';border-radius:18px;overflow:hidden;line-height:0;">');
    H.push('<img src="' + emailEsc_(EMAIL_IMG_BASE + o.band) + '" width="560" alt="" style="display:block;width:100%;max-height:132px;height:auto;object-fit:cover;border:0;border-radius:18px;"></td></tr></table></td></tr>');
  }
  if (imgUrl) {
    H.push('<tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:' + C.imgbg + ';border-radius:18px;overflow:hidden;">');
    H.push('<img src="' + emailEsc_(imgUrl) + '" width="560" alt="' + emailEsc_(o.imageAlt || "") + '" style="display:block;width:100%;height:auto;border:0;border-radius:18px;"></td></tr></table></td></tr>');
  }
  H.push('<tr><td style="padding:30px 40px 8px;">');
  if (eyebrow) H.push('<div style="font-family:' + EMAIL_SANS + ';font-size:11px;letter-spacing:3px;text-transform:uppercase;color:' + C.earth + ';margin:0 0 14px;">' + emailEsc_(eyebrow) + '</div>');
  if (heading) H.push('<h1 style="font-family:' + EMAIL_SERIF + ';font-weight:400;font-size:28px;line-height:1.25;color:' + C.ink + ';margin:0 0 20px;">' + emailEsc_(heading) + '</h1>');
  paras.forEach(function (p) { H.push('<p style="font-family:' + EMAIL_SANS + ';font-size:15px;line-height:1.7;color:' + C.ink + ';margin:0 0 16px;">' + emailEsc_(p) + '</p>'); });
  H.push('</td></tr>');
  /* Paradas de la ruta: número, propiedad, detalle y código. Una tarjeta por
     limpieza, en el orden en que hay que hacerlas. */
  if (stops.length) {
    H.push('<tr><td style="padding:6px 40px 4px;">');
    stops.forEach(function (s) {
      var urgente = !!s.urgente;
      var bg = urgente ? "#FCF4F1" : C.bg;
      var bd = urgente ? "#E5C9BF" : C.divider;
      H.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + bg + ';border:1px solid ' + bd + ';border-radius:16px;margin:0 0 10px;"><tr>');
      H.push('<td width="34" style="padding:15px 0 15px 16px;vertical-align:top;font-family:' + EMAIL_SANS + ';font-size:13px;font-weight:700;color:' + C.earth + ';">' + emailEsc_(s.n || "") + '</td>');
      H.push('<td style="padding:15px 8px;vertical-align:top;">');
      H.push('<div style="font-family:' + EMAIL_SANS + ';font-size:15px;font-weight:600;color:' + C.ink + ';line-height:1.4;">' + emailEsc_(s.titulo || "") + '</div>');
      if (s.meta) H.push('<div style="font-family:' + EMAIL_SANS + ';font-size:12.5px;color:' + C.earth + ';margin-top:4px;line-height:1.5;">' + emailEsc_(s.meta) + '</div>');
      if (urgente) H.push('<div style="font-family:' + EMAIL_SANS + ';font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:' + C.entrada + ';margin-top:7px;">Entra huésped ese día — va primero</div>');
      H.push('</td>');
      if (s.codigo) {
        H.push('<td align="right" style="padding:15px 16px 15px 8px;vertical-align:top;">');
        H.push('<div style="font-family:' + EMAIL_SANS + ';font-size:9.5px;letter-spacing:2px;text-transform:uppercase;color:' + C.earth + ';">Código</div>');
        H.push('<div style="font-family:' + EMAIL_SANS + ';font-size:19px;font-weight:700;letter-spacing:2px;color:' + C.ink + ';margin-top:3px;white-space:nowrap;">' + emailEsc_(s.codigo) + '</div></td>');
      }
      H.push('</tr></table>');
    });
    H.push('</td></tr>');
  }
  /* Lista de hallazgos — uno por línea con viñeta peach. Es lo que hace legible
     una corrección de varios puntos: antes iban todos pegados en un párrafo. */
  if (list.length) {
    H.push('<tr><td style="padding:0 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">');
    list.forEach(function (it, i) {
      var t = (it && it.t) ? String(it.t) : String(it || "");
      var n = (it && it.nota) ? String(it.nota) : "";
      var top = i === 0 ? "" : "padding-top:12px;";
      H.push('<tr><td style="' + top + 'padding-bottom:12px;border-bottom:1px solid ' + C.divider + ';font-family:' + EMAIL_SANS + ';">');
      H.push('<span style="display:inline-block;width:7px;height:7px;border-radius:100px;background:' + C.peach + ';vertical-align:middle;margin-right:9px;"></span>');
      H.push('<span style="font-size:14.5px;font-weight:600;color:' + C.ink + ';">' + emailEsc_(t) + '</span>');
      if (n) H.push('<div style="font-size:14px;line-height:1.65;color:' + C.earth + ';margin:5px 0 0 16px;">' + emailEsc_(n) + '</div>');
      /* Varias propiedades no caben en una frase: cada una en su propia fila. */
      var subs = (it && it.items && it.items.length) ? it.items : [];
      subs.forEach(function (si) {
        H.push('<div style="font-size:14px;line-height:1.5;color:' + C.ink + ';margin:6px 0 0 16px;">' +
               '<span style="display:inline-block;width:4px;height:4px;border-radius:100px;background:' + C.divider + ';vertical-align:middle;margin-right:8px;"></span>' +
               emailEsc_(String(si)) + '</div>');
      });
      H.push('</td></tr>');
    });
    H.push('</table></td></tr>');
  }
  if (rows.length) {
    H.push('<tr><td style="padding:6px 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.bg + ';border-radius:16px;">');
    rows.forEach(function (r, i) {
      var top = i === 0 ? "" : "border-top:1px solid " + C.divider + ";";
      H.push('<tr><td style="' + top + 'padding:13px 18px;font-family:' + EMAIL_SANS + ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + C.earth + ';vertical-align:top;width:42%;">' + emailEsc_(r[0]) + '</td>');
      H.push('<td style="' + top + 'padding:13px 18px;font-family:' + EMAIL_SANS + ';font-size:15px;color:' + C.ink + ';text-align:right;vertical-align:top;">' + emailEsc_(r[1]) + '</td></tr>');
    });
    H.push('</table></td></tr>');
  }
  if (cta && cta.label) {
    H.push('<tr><td style="padding:22px 40px 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:999px;background:' + C.ctaBg + ';border:1.5px solid ' + C.ctaBd + ';">');
    H.push('<a href="' + emailEsc_(cta.url || "#") + '" style="display:inline-block;padding:15px 34px;font-family:' + EMAIL_SANS + ';font-size:14px;font-weight:600;letter-spacing:.4px;color:' + C.ink + ';text-decoration:none;border-radius:999px;">' + emailEsc_(cta.label) + '</a></td></tr></table></td></tr>');
  }
  if (footerNote) H.push('<tr><td style="padding:20px 40px 0;"><p style="font-family:' + EMAIL_SANS + ';font-size:12.5px;line-height:1.65;color:' + C.earth + ';margin:0;">' + emailEsc_(footerNote) + '</p></td></tr>');
  H.push('<tr><td style="padding:30px 40px 8px;"><div style="border-top:1px solid ' + C.divider + ';padding-top:22px;">');
  signoff.split("\n").forEach(function (line, i) {
    var st = i === 0 ? 'font-family:' + EMAIL_SERIF + ';font-size:17px;color:' + C.ink + ';margin:0 0 2px;' : 'font-family:' + EMAIL_SANS + ';font-size:13px;color:' + C.earth + ';margin:0;';
    H.push('<div style="' + st + '">' + emailEsc_(line) + '</div>');
  });
  H.push('</div></td></tr>');
  H.push('<tr><td align="center" style="padding:26px 40px 40px;"><div style="width:24px;height:1px;background:' + C.peach + ';margin:0 auto 18px;"></div>');
  H.push('<div style="font-family:' + EMAIL_SANS + ';font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:' + C.earth + ';line-height:1.7;">' + emailEsc_(EMAIL_TEAM) + '</div></td></tr>');
  H.push('</table></td></tr></table></body></html>');

  var T = [];
  T.push("SPACIO AM"); T.push(EMAIL_SLOGAN); T.push("");
  if (eyebrow) T.push(eyebrow.toUpperCase());
  if (heading) { T.push(heading); T.push(""); }
  paras.forEach(function (p) { T.push(p); T.push(""); });
  if (list.length) { list.forEach(function (it) { var t=(it&&it.t)?String(it.t):String(it||""); var n=(it&&it.nota)?String(it.nota):""; T.push("· " + t + (n ? ": " + n : "")); ((it&&it.items)||[]).forEach(function(si){ T.push("    - " + si); }); }); T.push(""); }
  if (stops.length) {
    T.push("— — —");
    stops.forEach(function (s) {
      T.push((s.n || "") + " " + (s.titulo || "") + (s.meta ? " — " + s.meta : "") +
             (s.codigo ? " · código " + s.codigo : "") + (s.urgente ? " · ENTRA HUÉSPED ESE DÍA" : ""));
    });
    T.push("");
  }
  if (rows.length) { T.push("— — —"); rows.forEach(function (r) { T.push(r[0] + ": " + r[1]); }); T.push(""); }
  if (cta && cta.label) { T.push(cta.label + ": " + (cta.url || "")); T.push(""); }
  if (footerNote) { T.push(footerNote); T.push(""); }
  signoff.split("\n").forEach(function (l) { T.push(l); });
  T.push(""); T.push(EMAIL_TEAM);

  return { html: H.join(""), text: T.join("\n") };
}

/* Convierte un aviso de texto plano en el correo de marca. Lo que venía como
   "• Ana — 3 limpiezas: Inara 412, Casa Uno, Loft 3" se vuelve una fila por
   viñeta y una fila por propiedad: es la diferencia entre un párrafo que hay
   que descifrar y una lista que se lee de un vistazo. */
function emailShellFromText_(subject, texto) {
  var lineas = String(texto || "").split("\n");
  var paras = [], list = [], cierre = [];
  function esVineta(l) { return /^[•·\-\*]\s+/.test(l) || /^\d+[.)]\s+/.test(l); }
  lineas.forEach(function (raw) {
    var t = String(raw).trim();
    if (!t) return;
    if (!esVineta(t)) { (list.length ? cierre : paras).push(t); return; }
    var cuerpo = t.replace(/^[•·\-\*]\s+/, "").replace(/^\d+[.)]\s+/, "");
    var titulo = cuerpo, nota = "", items = [];
    var iDos = cuerpo.lastIndexOf(": ");
    if (iDos > 0) { titulo = cuerpo.slice(0, iDos).trim(); nota = cuerpo.slice(iDos + 2).trim(); }
    else {
      var m = cuerpo.split(" — ");
      if (m.length > 1) { titulo = m.shift().trim(); nota = m.join(" — ").trim(); }
    }
    if (nota.indexOf(", ") >= 0) {
      items = nota.split(/\s*,\s*/).filter(Boolean);
      if (items.length > 1) nota = ""; else items = [];
    }
    list.push({ t: titulo, nota: nota, items: items });
  });
  return emailShell_({
    eyebrow: "Aviso de operación",
    heading: String(subject || "").replace(/^EPI App\s*—\s*/, ""),
    paras: paras, list: list,
    footerNote: cierre.join(" "),
    signoff: "Con cariño,\nEl equipo de Spacio AM"
  });
}

var EMAIL_APP_URL = "https://epi.spacioam.com";

/* Construye el correo por tipo. d = datos del evento. */
function buildEmailByType_(type, d) {
  d = d || {};
  var url = d.url || EMAIL_APP_URL;
  /* La ruta llega como arreglo de paradas; si no, se arma desde el texto. */
  function nTrab_(d2) {
    var n = String(d2.total || "0");
    var e = d2.etiqueta || "limpieza";
    return n + " " + e + (n === "1" ? "" : "s");
  }
  function paradas_(d2) {
    if (Array.isArray(d2.paradas) && d2.paradas.length) {
      return d2.paradas.map(function (s, i) {
        return {
          n: String(i + 1), titulo: s.propiedad || "",
          meta: [(s.habitaciones || 1) + " hab", s.tipo || "Limpieza"].filter(Boolean).join(" · "),
          codigo: s.codigo || "", urgente: !!s.entrada
        };
      });
    }
    return String(d2.limpiezas || "").split("\n").filter(Boolean).map(function (l, i) {
      return { n: String(i + 1), titulo: String(l).replace(/^\s*\d+\.\s*/, ""), meta: "", codigo: "", urgente: /ENTRADA/i.test(l) };
    });
  }

  switch (type) {
    case "programacion":
      return emailShell_({
        band: "band-programacion.jpg",
        eyebrow: "Tu ruta del día", heading: "Tu programación de " + (d.dia || "") + " está lista",
        preheader: nTrab_(d) + " el " + (d.dia || "") + " " + (d.fecha || "") + ", de " + (d.hora || "11:00 a 15:00") + ".",
        paras: ["Hola " + (d.tecnico || "") + ", esta es tu ruta confirmada para el " + (d.dia || "") + " " + (d.fecha || "") + ".",
                "Son " + nTrab_(d) + ", de " + (d.hora || "11:00 a 15:00") + ", en este orden."],
        stops: paradas_(d),
        footerNote: "Si no puedes trabajar ese día, avísanos desde la app cuanto antes: entre más temprano lo sepamos, mejor reacomodamos al equipo.",
        cta: { label: "Ver mi programación", url: url },
        signoff: "Gracias por tu cuidado,\nEl equipo de Spacio AM" });
    /* El corte de la 1:00 pm avisa al ADMINISTRADOR; este avisa al TÉCNICO, que
       es quien puede resolverlo todavía esa noche. */
    case "formularioPendiente":
      return emailShell_({
        band: "band-programacion.jpg",
        eyebrow: "Te falta cerrar el día", heading: "Aún no recibimos tu formulario de hoy",
        preheader: "Falta " + (d.total || "1") + " formulario del " + (d.fecha || "") + ".",
        paras: ["Hola " + (d.tecnico || "") + ", son las 7:00 pm y todavía no nos llegó el formulario de " +
                ((d.total || "1") === "1" ? "esta limpieza" : "estas " + d.total + " limpiezas") + " de hoy.",
                "Si ya la hiciste, solo falta subirlo. Es lo que nos deja revisar la calidad y pagarte la semana completa."],
        stops: (d.paradas || []).map(function (s, i) {
          return { n: String(i + 1), titulo: s.propiedad || "", meta: s.meta || "", codigo: "", urgente: false };
        }),
        footerNote: "Si hubo algún problema para entrar o no pudiste terminar, cuéntanos por aquí o por la app: es mejor saberlo hoy que mañana.",
        cta: { label: "Subir mi formulario", url: url },
        signoff: "Gracias por cerrar bien el día,\nEl equipo de Spacio AM" });
    case "programacionAnticipada":
      return emailShell_({
        band: "band-programacion-anticipada.jpg",
        eyebrow: "Con anticipación", heading: "Tu ruta del " + (d.dia || "") + ", por adelantado",
        preheader: "Te adelantamos tu ruta del " + (d.dia || "") + " " + (d.fecha || "") + " para que te organices.",
        paras: ["Hola " + (d.tecnico || "") + ", te adelantamos tu ruta del " + (d.dia || "") + " " + (d.fecha || "") + " para que puedas organizar tu viaje con tiempo.",
                "Son " + nTrab_(d) + ", de " + (d.hora || "11:00 a 15:00") + "."],
        stops: paradas_(d),
        footerNote: "Te la confirmamos el día anterior a las 6:00 pm. Si entra una reserva nueva podría cambiar, y en ese caso te avisamos.",
        cta: { label: "Ver mi programación", url: url },
        signoff: "Con cariño,\nEl equipo de Spacio AM" });
    case "programacionCambio":
      return emailShell_({
        band: "band-programacion-cambio.jpg",
        eyebrow: "Cambio en tu ruta", heading: "Tu programación del " + (d.dia || "") + " cambió",
        preheader: "Tu ruta del " + (d.fecha || "") + " cambió. Queda así.",
        paras: ["Hola " + (d.tecnico || "") + ", tu ruta del " + (d.dia || "") + " " + (d.fecha || "") + " cambió.",
                "Queda así — " + (d.total || "0") + " limpieza(s), de " + (d.hora || "11:00 a 15:00") + "."],
        stops: paradas_(d),
        footerNote: "Gracias por la flexibilidad. Esta es la versión que manda: si tenías otra, ignórala.",
        cta: { label: "Ver mi programación", url: url },
        signoff: "Gracias por la flexibilidad,\nEl equipo de Spacio AM" });
    case "correccionDuda":
      return emailShell_({
        eyebrow: "Espera tu aclaración", heading: "Un técnico no entendió la corrección",
        image: "hero-supervision.jpg", imageAlt: "Habitación terminada y ordenada",
        preheader: (d.tecnico || "Un técnico") + " pidió que le aclaren una corrección de calidad.",
        paras: ["Hola, " + (d.tecnico || "un técnico") + " leyó la corrección de " + (d.propiedad || "una limpieza") + " y no le quedó clara.",
                d.detalle ? ("Lo que preguntó: “" + d.detalle + "”") : "No dejó detalle: solo pidió que se le explique mejor.",
                "Respóndele desde Calidad › Limpiezas, en el bloque «Esperan tu aclaración». En cuanto la escribas le llega, y la corrección vuelve a quedar pendiente de su respuesta."],
        rows: [["Técnico", d.tecnico || ""], ["Propiedad", d.propiedad || ""], ["Fecha de la limpieza", d.fecha || ""], ["Estado", "Espera aclaración"]],
        cta: { label: "Escribir la aclaración", url: url },
        footerNote: "Mientras no la aclares, al técnico no se le vuelve a insistir: la pelota está de este lado.",
        signoff: "Gracias,\nEl equipo de Spacio AM" });
    case "limpiezaCancelada":
      return emailShell_({
        band: "band-programacion-cambio.jpg",
        eyebrow: "Cambio en tu ruta", heading: "Se canceló una limpieza de tu ruta",
        preheader: "La limpieza de " + (d.propiedad || "") + " del " + (d.fecha || "") + " fue cancelada.",
        paras: ["Hola " + (d.tecnico || "") + ", la administración canceló la limpieza de " + (d.propiedad || "") +
                " que tenías programada para el " + (d.dia || "") + " " + (d.fecha || "") + ".",
                d.detalle || ""],
        rows: [["Propiedad", d.propiedad || ""], ["Fecha", d.fecha || ""],
               ["Hora de la cancelación", d.hora || ""],
               ["¿Se te paga?", (String(d.paga) === "sí" ? "Sí — " + (d.monto || "") + " (media tarifa)" : "No")]]
               .concat(d.motivo ? [["Motivo", d.motivo]] : []),
        cta: { label: "Ver mi programación", url: url },
        footerNote: "El resto de tu ruta de ese día no cambia. Si tienes alguna duda sobre el pago, escríbenos.",
        signoff: "Gracias por tu comprensión,\nEl equipo de Spacio AM" });
    case "limpiezaAprobada":
      return emailShell_({
        eyebrow: "Revisión de calidad", heading: "Tu limpieza fue aprobada",
        image: "hero-limpieza-aprobada.jpg", imageAlt: "Habitación tendida con luz de mañana",
        preheader: "Tu limpieza pasó la revisión de calidad. Gracias por tu trabajo.",
        paras: ["Hola " + (d.tecnico || "") + ", tu limpieza pasó la revisión de calidad sin observaciones.",
                "Gracias por el cuidado en cada detalle. Así se siente un espacio al que da gusto volver."],
        rows: [["Propiedad", d.propiedad || ""], ["Fecha", d.fecha || ""], ["Resultado", "Aprobada"]],
        footerNote: "Puedes ver el detalle de esta revisión en la pestaña Calidad de la app.",
        signoff: "Con cariño,\nEl equipo de Spacio AM" });
    case "correccionInmediata":
      return emailShell_({
        eyebrow: "Corrección para hoy", heading: "Un detalle por atender antes de recibir",
        image: "hero-correccion-inmediata.jpg", imageAlt: "Superficie cálida por afinar",
        preheader: "Hay un detalle por corregir hoy en la propiedad.",
        paras: ["Hola " + (d.tecnico || "") + ", encontramos un detalle que conviene resolver hoy, antes de la llegada del próximo huésped.",
                (d.lista && d.lista.length) ? "Esto fue lo que encontramos:" : (d.detalle || "(Ver el detalle en la app.)")],
        list: d.lista || [],
        rows: [["Propiedad", d.propiedad || ""], ["Fecha de la limpieza", d.fecha || ""], ["Prioridad", "Atender hoy"]],
        cta: { label: "Confirmar corrección", url: url },
        footerNote: "Cuando lo resuelvas, confírmalo en la app para cerrar el seguimiento. Si algo no es posible hoy, escríbenos y lo vemos juntos.",
        signoff: "Gracias por tu pronta atención,\nEl equipo de Spacio AM" });
    case "correccionFutura":
      return emailShell_({
        eyebrow: "Nota para tus próximas limpiezas", heading: "Una observación para tener en cuenta",
        image: "hero-correccion-futura.jpg", imageAlt: "Rincón sereno con libreta",
        preheader: "Una observación para tus próximas limpiezas, sin urgencia.",
        paras: ["Hola " + (d.tecnico || "") + ", esta limpieza quedó bien. Queremos dejarte una nota para las próximas, sin ninguna urgencia.",
                (d.lista && d.lista.length) ? "Lo que vimos:" : (d.detalle || "(Ver el detalle en la app.)")],
        list: d.lista || [],
        rows: [["Propiedad", d.propiedad || ""], ["Fecha", d.fecha || ""]],
        footerNote: "Encontrarás esta nota en la pestaña Calidad, en tus observaciones para el futuro.",
        signoff: "Con cariño,\nEl equipo de Spacio AM" });
    case "listaSupervision":
      return emailShell_({
        eyebrow: "Lista para revisar", heading: "Hay una limpieza esperando tu revisión",
        image: "hero-supervision.jpg", imageAlt: "Habitación terminada y ordenada",
        preheader: (d.tecnico || "Un técnico") + " terminó una limpieza que espera supervisión.",
        paras: ["Hola, " + (d.tecnico || "el técnico") + " terminó una " + (d.tipoLimpieza || "limpieza").toLowerCase() + " y quedó lista para tu revisión.",
                "Cuando tengas un momento, entra a la app para revisarla y dejar tu visto bueno o tus observaciones."],
        rows: [["Propiedad", d.propiedad || ""], ["Técnico", d.tecnico || ""], ["Tipo", d.tipoLimpieza || "Limpieza"], ["Fecha", d.fecha || ""]],
        cta: { label: "Abrir supervisión", url: url },
        signoff: "Gracias,\nEl equipo de Spacio AM" });
    case "correccionAtendida":
      return emailShell_({
        eyebrow: "Seguimiento cerrado", heading: "La corrección fue atendida",
        image: "hero-correccion-atendida.jpg", imageAlt: "Espacio en calma recién ordenado",
        preheader: (d.tecnico || "El técnico") + " confirmó que atendió la corrección inmediata.",
        paras: ["Hola, " + (d.tecnico || "el técnico") + " confirmó que atendió la corrección inmediata que se había señalado.",
                "Dejamos constancia para tu registro. Puedes verificar el detalle en la app."],
        rows: [["Propiedad", d.propiedad || ""], ["Técnico", d.tecnico || ""], ["Fecha", d.fecha || ""], ["Estado", "Atendida"]],
        cta: { label: "Ver en Calidad", url: url },
        signoff: "Gracias,\nEl equipo de Spacio AM" });
    case "ratingRevision":
      return emailShell_({
        eyebrow: "Solicitud por revisar", heading: "Un técnico pidió revisar una calificación",
        image: "hero-rating-revision.jpg", imageAlt: "Escritorio con anteojos sobre un cuaderno cerrado",
        preheader: (d.tecnico || "Un técnico") + " pidió revisar una nota de limpieza de un huésped.",
        paras: ["Hola, " + (d.tecnico || "un técnico") + " pidió revisar la calificación de limpieza que un huésped dejó en " + (d.propiedad || "una propiedad") + ".",
                "En Calidad › Rating huéspedes puedes leer su motivo y decidir: excluirla de su promedio, reasignarla al técnico que sí hizo la limpieza, o mantenerla. La review nunca se borra de la base."],
        rows: [["Técnico", d.tecnico || ""], ["Propiedad", d.propiedad || ""], ["Check-in del huésped", d.fecha || ""], ["Estado", "En revisión"]],
        cta: { label: "Revisar en Calidad", url: url },
        signoff: "Gracias,\nEl equipo de Spacio AM" });
    case "danoUrgente":
      return emailShell_({
        eyebrow: "Requiere tu atención", heading: "Daño clasificado como urgente",
        image: "hero-dano-urgente.jpg", imageAlt: "Detalle de mantenimiento en tono cálido",
        preheader: "Se registró un daño de urgencia alta en una propiedad.",
        paras: ["Se clasificó como urgencia alta un daño reportado en " + (d.propiedad || "una propiedad") + ".",
                d.detalle || "(Ver el detalle en la app.)"],
        rows: [["Propiedad", d.propiedad || ""], ["Fecha del reporte", d.fecha || ""], ["Clasificado por", d.clasificadoPor || "Administración"], ["Urgencia", "Alta"]],
        cta: { label: "Revisar en la app", url: url },
        footerNote: "Este aviso se envía a la administración para coordinar la reparación cuanto antes.",
        signoff: "Atentamente,\nEl equipo de Spacio AM" });
    case "solicitudAdelanto":
      return emailShell_({
        eyebrow: "Solicitud por revisar", heading: "Un técnico solicitó un adelanto",
        image: "hero-solicitud-adelanto.jpg", imageAlt: "Escritorio con documento y taza",
        preheader: (d.tecnico || "Un técnico") + " envió una solicitud de adelanto.",
        paras: ["Hola, " + (d.tecnico || "un técnico") + " envió una solicitud de adelanto y espera tu revisión.",
                "Puedes aprobarla o ajustarla desde la pestaña Adelantos de la app."],
        rows: [["Técnico", d.tecnico || ""], ["Monto solicitado", d.monto || ""], ["Cuotas", d.cuotas || ""], ["Cuota semanal", d.cuota || ""]],
        cta: { label: "Revisar solicitud", url: url },
        signoff: "Atentamente,\nEl equipo de Spacio AM" });
    case "adelantoFirma":
      return emailShell_({
        eyebrow: "Adelanto por firmar", heading: "Tienes un adelanto listo para firmar",
        image: "hero-adelanto-firma.jpg", imageAlt: "Mesa con pluma y papel, luz dorada",
        preheader: "Sube tu documento y firma para activar tu adelanto.",
        paras: ["Hola " + (d.tecnico || "") + ", la administración preparó un adelanto para ti.",
                "Para continuar, entra a la app, sube la foto de tu DPI y firma el contrato. Después se realizará el depósito."],
        rows: [["Monto", d.monto || ""], ["Cuotas", d.cuotas || ""], ["Cuota semanal", d.cuota || ""]],
        cta: { label: "Subir DPI y firmar", url: url },
        footerNote: "El descuento semanal se aplica de forma automática sobre tus pagos, según el contrato que firmes.",
        signoff: "Con cariño,\nEl equipo de Spacio AM" });
    case "adelantoFirmado":
      return emailShell_({
        eyebrow: "Contrato firmado", heading: "Un adelanto está listo para depositar",
        image: "hero-solicitud-adelanto.jpg", imageAlt: "Escritorio con documento y taza",
        preheader: (d.tecnico || "El técnico") + " firmó su contrato de adelanto. Ya puedes hacer el depósito.",
        paras: ["Hola, " + (d.tecnico || "el técnico") + " firmó su contrato de adelanto en Docs.",
                "Haz el depósito y sube el comprobante en la pestaña Adelantos para activarlo. Hasta entonces no se descuenta nada."],
        rows: [["Técnico", d.tecnico || ""], ["Monto", d.monto || ""], ["Cuota", d.cuota || ""], ["Folio", d.folio || ""]],
        cta: { label: "Registrar el depósito", url: url },
        signoff: "Atentamente,\nEl equipo de Spacio AM" });
    case "adelantoDepositado":
      return emailShell_({
        eyebrow: "Depósito realizado", heading: "Tu adelanto ya fue depositado",
        image: "hero-adelanto-deposito.jpg", imageAlt: "Amanecer sereno sobre textil cálido",
        preheader: "Confirmamos el depósito de tu adelanto.",
        paras: ["Hola " + (d.tecnico || "") + ", confirmamos que tu adelanto fue depositado.",
                "A partir de tu próxima liquidación se aplicará el descuento semanal acordado, hasta completar el saldo."],
        rows: [["Monto depositado", d.monto || ""], ["Fecha del depósito", d.fecha || ""], ["Cuota semanal", d.cuota || ""], ["Cuotas", d.cuotas || ""]],
        footerNote: "Puedes seguir el saldo de tu adelanto en la pestaña Adelanto de la app.",
        signoff: "Con cariño,\nEl equipo de Spacio AM" });
    case "comprobantePago":
      return emailShell_({
        eyebrow: "Comprobante de pago", heading: "Tu pago de la semana",
        image: "hero-comprobante-pago.jpg", imageAlt: "Mesa ordenada con café, luz de mañana",
        preheader: "Este es el detalle de tu pago semanal.",
        paras: ["Hola " + (d.tecnico || "") + ", este es el detalle de tu pago" + (d.semana ? " correspondiente a la semana " + d.semana : "") + "."],
        rows: [["Limpiezas", d.trabajos || ""], ["Subtotal", d.subtotal || ""], ["Descuento adelanto", d.descuento || "− Q0"], ["Total a pagar", d.total || ""]],
        cta: { label: "Ver comprobante", url: url },
        footerNote: "Folio " + (d.folio || "") + ". Conserva este comprobante para tu registro.",
        signoff: "Gracias por tu trabajo,\nEl equipo de Spacio AM" });
    case "mantenimientoProgramado":
      return emailShell_({
        band: "band-programacion.jpg",
        eyebrow: "Una reparación para ti", heading: "Tienes un mantenimiento programado",
        preheader: "Reparación en " + (d.propiedad || "") + " el " + (d.fecha || "") + ".",
        paras: ["Hola " + (d.tecnico || "") + ", te asignamos la reparación de un daño reportado en " + (d.propiedad || "") + ".",
                "Queda para el " + (d.dia || "") + " " + (d.fecha || "") + ", de " + (d.hora || "11:00 a 15:00") + " — es un día de salida, así que el apartamento estará vacío.",
                d.dano ? ("Esto es lo que hay que atender:\n" + d.dano) : ""],
        rows: [["Propiedad", d.propiedad || ""], ["Fecha", d.fecha || ""], ["Horario", d.hora || ""],
               ["Daño reportado el", d.reportadoEl || ""]]
               .concat(d.nota ? [["Nota", d.nota]] : []),
        cta: { label: "Ver el resumen del daño", url: d.url || url },
        footerNote: "En el enlace está el detalle completo con fotos. Si algo no se puede resolver ese día, avísanos antes de ir.",
        signoff: "Gracias por tu cuidado,\nEl equipo de Spacio AM" });
    default:
      return null;
  }
}

/* Asunto por tipo (cálido, sin emojis). */
function subjectForType_(type, d) {
  d = d || {};
  if (type === "programacion")           return "Tu programación del " + (d.dia || "") + " " + (d.fecha || "");
  if (type === "programacionAnticipada") return "Tu programación del " + (d.dia || "") + " " + (d.fecha || "") + " — con anticipación";
  if (type === "programacionCambio")     return "Cambio en tu programación del " + (d.fecha || "");
  if (type === "formularioPendiente")    return "Te falta subir el formulario de hoy" + (d.total && d.total !== "1" ? " (" + d.total + ")" : "");
  if (type === "limpiezaCancelada")      return "Se canceló tu limpieza de " + (d.propiedad || "") + " del " + (d.fecha || "");
  var prop = d.propiedad ? (" — " + d.propiedad) : "";
  switch (type) {
    case "limpiezaAprobada":    return "Tu limpieza fue aprobada" + prop;
    case "correccionInmediata": return "Una corrección para hoy" + prop;
    case "correccionFutura":    return "Una nota para tus próximas limpiezas" + prop;
    case "listaSupervision":    return "Una limpieza espera tu revisión" + prop;
    case "correccionAtendida":  return "Corrección atendida" + prop;
    case "correccionDuda":      return "Un técnico pide aclarar una corrección" + prop;
    case "ratingRevision":      return "Revisión de calificación" + (d.tecnico ? " — " + d.tecnico : "");
    case "danoUrgente":         return "Daño urgente" + prop;
    case "solicitudAdelanto":   return "Nueva solicitud de adelanto" + (d.tecnico ? " — " + d.tecnico : "");
    case "adelantoFirma":       return "Tienes un adelanto por firmar";
    case "adelantoDepositado":  return "Tu adelanto ya fue depositado";
    case "adelantoFirmado":     return "Adelanto firmado · listo para depositar" + (d.tecnico ? " — " + d.tecnico : "");
    case "comprobantePago":     return "Tu comprobante de pago" + (d.folio ? " — " + d.folio : "");
    case "mantenimientoProgramado": return "Mantenimiento programado" + prop;
    default:                    return "EPI App — Spacio AM";
  }
}

/* ═══ REEMPLAZA tu notify(p) por esta versión ═══ */
/* ══════════════════════════════════════════════════════════════════════
   REGISTRO DE CONSUMO DE IA → hub (Consumo de IA, en Mi cuenta del admin principal)
   Para: EPI (Apps Script) y el backend de Hola (Apps Script).

   1. En el Apps Script de ALMA ejecuta UNA vez claveUsoIA(). El registro muestra USO_KEY y ALMA_URL.
   2. En el Apps Script de esta app: ⚙️ Configuración del proyecto → Propiedades del script → agrega
        ALMA_URL = (la URL /exec de ALMA)
        USO_KEY  = (la clave del paso 1)
        USO_APP  = EPI   (o Hola)
   3. Pega la función registrarUsoIA_ al final del archivo.
   4. Justo después de cada llamada a https://api.anthropic.com/v1/messages, agrega UNA línea:
        registrarUsoIA_('Resumen IA', 'claude-sonnet-4-5', j.usage, 'detalle opcional');
      (j = la respuesta ya parseada con JSON.parse)
   ══════════════════════════════════════════════════════════════════════ */

function registrarUsoIA_(funcion, modelo, usage, detalle, ref) {
  try {
    var p = PropertiesService.getScriptProperties(), url = p.getProperty('ALMA_URL') || 'https://script.google.com/macros/s/AKfycbzTdkEpRPgnwaUIHWbQmrysPEqGYqTqDKYwMaQlnun-OT7B2hIa6KdSNS-aedWN-I0cZQ/exec', k = p.getProperty('USO_KEY');
    if (!url || !k) return;
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ usoIA: 1, k: k, app: p.getProperty('USO_APP') || 'EPI', funcion: funcion || 'IA', modelo: modelo || '',
        usage: usage || {}, detalle: detalle || '', ref: ref || '' })
    });
  } catch (e) { console.warn('registrarUsoIA_: ' + e); }
}

