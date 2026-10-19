/**
 * EPI APP — Sincronización de propiedades desde el portafolio público
 * ════════════════════════════════════════════════════════════════════
 * Lee la página pública del anuncio (portfolio.spacioam.com) de cada propiedad
 * y extrae automáticamente —SIN que el técnico escriba nada—:
 *    • cantidad de cuartos        (texto "3 bedrooms")
 *    • cantidad de baños          (texto "3.5 bathrooms")
 *    • galería de fotos de referencia (assets.hospitable.com/property_images/…)
 *
 * También trae el "Listing link" de cada propiedad desde el Sheet del
 * dashboard de propietarios (mi-spacioam), para que ambos proyectos se
 * mantengan sincronizados solos.
 *
 * No requiere token: el portafolio es público. (Si algún día quieres usar la
 * API de Hospitable en su lugar, el token va en Propiedades del script — ver
 * la sección "PROPIEDADES DEL SCRIPT" más abajo.)
 *
 * ─────────────────────────────────────────────────────────────────────
 * PROPIEDADES DEL SCRIPT  (⚙️ Configuración del proyecto → Propiedades del
 * script → Agregar propiedad). Aquí van TODOS los secretos, nunca en el código:
 *
 *    OWNER_SHEET_ID    = 1l9wLH8880NlN9ac2jvne2U6cqej6gycqAD77Z25cLF4
 *                        (ID del Sheet del dashboard de propietarios)
 *    HOSPITABLE_TOKEN  = <token>      (OPCIONAL — solo si usas la API)
 *    ANTHROPIC_API_KEY = sk-ant-...   (si usas los resúmenes con IA)
 *    NOTIFY_FROM       = hola@spacioam.com   (remitente de notificaciones)
 *
 * Para leerlas en el código: PropertiesService.getScriptProperties().getProperty("NOMBRE")
 * ───────────────────────────────────────────────────────────────────── */

/* ── (A) Raspar UNA página de portafolio y devolver {cuartos, banos, fotos[]} ── */
function scrapePortfolio_(url) {
  if (!url || url.indexOf("portfolio.spacioam.com") < 0) return null;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return null;
  var html = res.getContentText();

  var mB = html.match(/(\d+)\s*bedrooms?/i);
  var mBa = html.match(/([\d.]+)\s*bathrooms?/i);
  var cuartos = mB ? parseInt(mB[1], 10) : 0;
  var banos = mBa ? Math.ceil(parseFloat(mBa[1])) : 0; // 3.5 baños → 4 espacios a fotografiar

  // Galería: todas las imágenes de Hospitable que aparecen en la página, sin repetir
  var fotos = [], seen = {};
  var re = /https:\/\/assets\.hospitable\.com\/property_images\/\d+\/[A-Za-z0-9]+\.(?:jpg|jpeg|png|webp)/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[0]]) { seen[m[0]] = 1; fotos.push(m[0]); }
  }
  return { cuartos: cuartos, banos: banos, fotos: fotos };
}

/* ── (B) Leer los "Listing link" del Sheet del dashboard de propietarios ── */
function getOwnerListingLinks_() {
  var id = PropertiesService.getScriptProperties().getProperty("OWNER_SHEET_ID");
  if (!id) return {};
  var url = "https://docs.google.com/spreadsheets/d/" + id +
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

/* ── (C) Sincronización completa: corre sola por cron ──
 *   1) trae el listingUrl del dashboard,
 *   2) raspa el portafolio para cuartos/baños/fotos,
 *   3) guarda todo en la config "props" del app. Nunca borra ni renombra.    */
function syncPropertiesFull_() {
  var links = getOwnerListingLinks_();
  var props = readConfig_("props") || [];   // ← usa TU getter de config si se llama distinto
  var changed = 0;

  props = props.map(function (p) {
    var np = Object.assign({}, p);
    // 1) Listing link desde el dashboard de propietarios
    var lk = links[normName_(p.name)];
    if (lk && p.listingUrl !== lk) { np.listingUrl = lk; changed++; }
    // 2) Raspar el portafolio (si el listingUrl es de portfolio.spacioam.com)
    try {
      var info = scrapePortfolio_(np.listingUrl);
      if (info) {
        if (info.cuartos && Number(p.cuartos) !== info.cuartos) { np.cuartos = info.cuartos; changed++; }
        if (info.banos && Number(p.banos) !== info.banos) { np.banos = info.banos; changed++; }
        if (info.fotos && info.fotos.length) {
          var prev = JSON.stringify(p.refFotos || []);
          if (prev !== JSON.stringify(info.fotos)) { np.refFotos = info.fotos; changed++; }
        }
      }
    } catch (e) { console.warn("portafolio " + p.name + ": " + e); }
    return np;
  });

  if (changed > 0) writeConfig_("props", props);  // ← usa TU setter de config si se llama distinto
  return { ok: true, changed: changed, propiedades: props.length };
}

/* ── (D) Config de respaldo (hoja "Config" con filas clave | JSON).
 *   Si tu Apps Script ya tiene getters/setters de config (los de getConfig /
 *   saveConfig), reemplaza estos por los tuyos.                               */
function readConfig_(key) {
  var sh = SpreadsheetApp.getActive().getSheetByName("Config");
  if (!sh) return null;
  var rows = sh.getDataRange().getValues();
  for (var i = 0; i < rows.length; i++)
    if (String(rows[i][0]) === key) { try { return JSON.parse(rows[i][1]); } catch (e) { return null; } }
  return null;
}
function writeConfig_(key, value) {
  var sh = SpreadsheetApp.getActive().getSheetByName("Config");
  if (!sh) sh = SpreadsheetApp.getActive().insertSheet("Config");
  var rows = sh.getDataRange().getValues(), json = JSON.stringify(value);
  for (var i = 0; i < rows.length; i++)
    if (String(rows[i][0]) === key) { sh.getRange(i + 1, 2).setValue(json); return; }
  sh.appendRow([key, json]);
}

/* ── (E) En tu doPost, dentro del manejo de acciones, agrega para poder
 *        dispararla a mano desde el app si quisieras: ── */
//
//   if (action === "syncProperties") { return jsonResponse(syncPropertiesFull_()); }
//

/* ── (F) Cron: corre solo. Crea el activador una sola vez (ver abajo). ── */
function cronSyncProperties() {
  try { syncPropertiesFull_(); } catch (e) { console.error("cronSyncProperties:", e); }
}

/*
 * CREAR EL ACTIVADOR (una sola vez) — Editor de Apps Script → ⏰ Activadores →
 *   + Agregar activador:
 *     Función: cronSyncProperties
 *     Fuente:  Basado en tiempo
 *     Tipo:    Temporizador por día  → 3:00 a 4:00 a.m.
 *   (Con una corrida diaria, cualquier cambio en el dashboard o en el anuncio
 *    queda reflejado al día siguiente. Si lo prefieres cada 3 días, usa
 *    "Temporizador por semana" no aplica; deja el diario — es lo más simple y
 *    cubre de sobra el requisito de "cada 3-5 días".)
 *
 * PRUEBA MANUAL: selecciona syncPropertiesFull_ y pulsa ▶ Ejecutar. La primera
 * vez pide autorizar (acepta). Mira el registro: dirá cuántos cambios aplicó.
 *
 * REQUISITO: el listingUrl de cada propiedad debe ser su página de
 * portfolio.spacioam.com. Si en el app aún no lo tienes, pulsa en
 * Config → Propiedades → "Importar enlaces" (lo trae del dashboard), o pégalo
 * a mano. Las propiedades sin enlace o sin foto aparecen listadas en
 * Config → Propiedades como "Propiedades por completar".
 */
