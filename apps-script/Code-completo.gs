function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

var SPREADSHEET_ID   = "1-SfKC-evkK24qfOrrvIrcDs6ckGAmRzSLS_IYB8cYZg";
var FOLDER_ID        = "11odF5bZPpxh_boSg1Emtfh8gA67yFL1j";
var HOSPITABLE_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5YTYyNGRmMC0xMmYxLTQ0OGUtYjg4NC00MzY3ODBhNWQzY2QiLCJqdGkiOiIyYmM4ZjU4ZWZiYzcwN2IxZDVmMzhhNzk1NTJjNWRlODIwNzllZjZjNWQxMDc5OWY5N2Q2Mzc1NWY0MTk2YWFjODZhZjQ0N2RlOTRiYjJiNyIsImlhdCI6MTc3OTI5NTc3Mi45MzM0ODUsIm5iZiI6MTc3OTI5NTc3Mi45MzM0ODksImV4cCI6MTgxMDgzMTc3Mi45MzA2NTIsInN1YiI6IjY1NzkwIiwic2NvcGVzIjpbInBhdDpyZWFkIiwicGF0OndyaXRlIl19.Vaqwyxcr2zkV-6OoTMyVJrqTnzRMafrxHYFLq7-0wKBoHCFm5R6Cfv5LUOYYpi7KcrfFN_C3LTBxCDbS764FlMmErB1spDreg2cm9Dg7ZdcX6ch9nyFZsjdo_7I_peb0rgk9ux_Gp4REqG5_Vg4oCIx9yNm8K-gjcbve5TYQxeYyZiDVyY_PcLuGixUQ-GYLTkWHOciHnhO_ibuZowp_HyW0x6a5jMRdUaOihOF4t3mxGNFGU_oBJHkjvHsP6J7PNI442u_fLa7FnxW0xcI0y-Uv9F3nRhIwTVvu9UMMJ_JpJfhQw7yZoo0sn48owacfwr9_5J6P4r5VL0w8mQJNlnbAQ_23cOFR6ADkegpj8z2N8UYSucYN8kyn43tZu4USNcOCtKbfRaJB6u7QULEHX9tDXXsXURs-qlnBnpTzUfBbX6Eou97ytTjIMnw87-xRvH20baLOqLbYhdgImoigiqE181rf_cfl9jgEZ8lUU6Vqb7YPcAQ6HkepZMT5ttWRkYgCI-ApeuXwmfqOEwbCS3ElfEIwH0FXUFApdPj423N20kRwPVG3Z_hvZrdeodPmin3EdezgTvAxvKHojAbLRVJ4EATPByxdjEWJg9bIVrIK9WWLTA0LDL7VrmouMS2ISJi37nQgD0LmVYSdgqdK_juKNPwewINswMVLyR2qIzg";

/* ID del Sheet del dashboard de propietarios (mi-spacioam) — lectura pública.
   De aquí se trae el "Listing link" de cada propiedad. */
var OWNER_SHEET_ID = "1l9wLH8880NlN9ac2jvne2U6cqej6gycqAD77Z25cLF4";

function doGet(e)  { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  try {
    var p = e.postData ? JSON.parse(e.postData.contents) : e.parameter;
    var r = {};
    if      (p.action === "getAll")         r = getAll();
    else if (p.action === "saveReport")     r = saveReport(p.data);
    else if (p.action === "deleteReport")   r = deleteReport(p.id);
    else if (p.action === "getConfig")      r = getConfig();
    else if (p.action === "saveConfig")     r = saveConfig(p.key, p.value);
    else if (p.action === "uploadFile")     r = uploadFile(p.b64, p.name, p.mime, p.subfolder);
    else if (p.action === "syncHospitable") r = syncHospitable(p.days || 14);
    else if (p.action === "syncProperties") r = syncPropertiesFull_();
    else if (p.action === "testDrive")      r = testDrive();
    else if (p.action === "recoverPhotos")  r = recoverPhotos();
    else if (p.action === "notify")         r = notify(p);
    else if (p.action === "ai")             r = aiSummary(p);
    else r = { error: "Unknown action: " + p.action };
    return out({ ok: true, data: r });
  } catch (err) {
    return out({ ok: false, error: err.toString() });
  }
}

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ═══ NUEVO — BLOQUE 1: Notificaciones por correo ═══ */
function notify(p) {
  var to = Array.isArray(p.to) ? p.to : [p.to];
  var sent = 0;
  to.filter(Boolean).forEach(function (t) {
    try {
      GmailApp.sendEmail(String(t), p.subject || "EPI App — Spacio AM", "", {
        htmlBody: String(p.body || "").replace(/\n/g, "<br>"),
        from: "hola@spacioam.com",
        name: "EPI App — Spacio AM"
      });
      sent++;
    } catch (e) {
      /* Respaldo: si el alias fallara, enviar desde la cuenta normal */
      try {
        MailApp.sendEmail({
          to: String(t),
          subject: p.subject || "EPI App — Spacio AM",
          htmlBody: String(p.body || "").replace(/\n/g, "<br>"),
          name: "EPI App — Spacio AM"
        });
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
    saveConfig("schedules", merged);
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

function getAll() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Reportes");
  if (!sheet) return { reports: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { reports: [] };
  var tz = Session.getScriptTimeZone();
  var reports = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < COLS.length; j++) {
      var v = data[i][j];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, "yyyy-MM-dd");
      if (v === "" || v === null || v === undefined) { row[COLS[j]] = null; continue; }
      if (typeof v === "string" && (v.charAt(0) === "[" || v.charAt(0) === "{")) {
        try { v = JSON.parse(v); } catch (e) {}
      }
      row[COLS[j]] = v;
    }
    if (row.fotosLimpieza && typeof row.fotosLimpieza === "object") {
      Object.keys(row.fotosLimpieza).forEach(function (k) {
        row[k] = row.fotosLimpieza[k];
      });
    }
    if (row.id) reports.push(row);
  }
  return { reports: reports };
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
      return { saved: true, action: "updated" };
    }
  }
  sheet.appendRow(row);
  return { saved: true, action: "created" };
}

function deleteReport(id) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Reportes");
  if (!sheet) return { deleted: false };
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) { sheet.deleteRow(i + 1); return { deleted: true }; }
  }
  return { deleted: false };
}

function getConfig() {
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
  return cfg;
}

function saveConfig(key, value) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Config");
  if (!sheet) sheet = ss.insertSheet("Config");
  var val  = (typeof value === "object") ? JSON.stringify(value) : String(value);
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) { sheet.getRange(i + 1, 2).setValue(val); return { saved: true }; }
  }
  sheet.appendRow([key, val]);
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
