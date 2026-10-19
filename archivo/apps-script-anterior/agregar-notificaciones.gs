/**
 * EPI APP — Bloques para agregar al Apps Script
 * ══════════════════════════════════════════
 * 3 bloques: (1) notificaciones por correo, (2) resumen IA,
 * (3) tareas programadas (sync Hospitable 3am/9pm + recuperación de fotos).
 */

/* ── Dentro del switch/if de acciones de doPost, agregar: ── */

if (action === "notify") {
  var to = Array.isArray(data.to) ? data.to : [data.to];
  var sent = 0;
  to.filter(Boolean).forEach(function (t) {
    try {
      MailApp.sendEmail({
        to: String(t),
        subject: data.subject || "EPI App — Spacio AM",
        htmlBody: String(data.body || "").replace(/\n/g, "<br>"),
        name: "EPI App — Spacio AM",
      });
      sent++;
    } catch (e) {
      /* correo inválido o cuota agotada: continuar con los demás */
    }
  });
  return jsonResponse({ ok: true, data: { sent: sent } });
}

/*
 * Si tu doPost usa otra forma de leer el payload, ajusta:
 *   var body = JSON.parse(e.postData.contents);
 *   var action = body.action;
 *   var data = body;              // { to, subject, body }
 * Y si tu función de respuesta se llama distinto a jsonResponse,
 * usa la tuya (la que devuelve {ok:true, data:...} como JSON).
 *
 * Cuota gratuita de Gmail: ~100 correos/día por cuenta — suficiente
 * para el volumen actual de limpiezas.
 */

/* ═══ BLOQUE 2 — RESUMEN IA (acción "ai") ═══
 * Permite que el app genere resúmenes con Claude en producción (Vercel).
 * 1. Crea una API key en https://console.anthropic.com → API Keys.
 * 2. En el editor de Apps Script: ⚙️ Configuración del proyecto →
 *    Propiedades del script → agregar propiedad:
 *      ANTHROPIC_API_KEY = sk-ant-...
 * 3. Pega este bloque dentro del manejador de acciones de doPost:
 */

if (action === "ai") {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) return jsonResponse({ ok: false, error: "Falta ANTHROPIC_API_KEY en Propiedades del script" });
  var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: String(data.prompt || "") }],
    }),
    muteHttpExceptions: true,
  });
  var j = JSON.parse(resp.getContentText());
  if (j.error) return jsonResponse({ ok: false, error: j.error.message || "Error de Anthropic" });
  var texto = (j.content && j.content[0] && j.content[0].text) || "";
  return jsonResponse({ ok: true, data: { text: texto } });
}

/* ═══ BLOQUE 3 — TAREAS PROGRAMADAS ═══
 * Pega estas DOS funciones al final del Apps Script (fuera de doPost).
 * Llaman la misma lógica que ya usan los botones del app.
 */

function cronSyncHospitable() {
  /* Llama tu lógica existente de "syncHospitable" para los próximos 14 días.
     Si tu función interna tiene otro nombre, cámbialo aquí. */
  try { syncHospitable({ days: 14 }); } catch (e) { console.error("cronSync:", e); }
}

function cronRecoverPhotos() {
  /* Ejecuta la recuperación de fotos (la misma lógica de la acción "recoverPhotos"). */
  try { recoverPhotos({}); } catch (e) { console.error("cronRecover:", e); }
}

/*
 * CREAR LOS DISPARADORES (una sola vez):
 * En el editor de Apps Script → ⏰ Activadores (menú izquierdo) → + Agregar activador:
 *
 *  1) cronSyncHospitable · Basado en tiempo · Temporizador por día · 3:00–4:00 a.m.
 *  2) cronSyncHospitable · Basado en tiempo · Temporizador por día · 9:00–10:00 p.m.
 *  3) cronRecoverPhotos  · Basado en tiempo · Temporizador por horas · Cada hora
 *     (respaldo del servidor; el app además recupera fotos 3 min después de cada subida)
 *
 * Zona horaria: verifica que el proyecto esté en (GMT-6) Guatemala
 * (Configuración del proyecto → Zona horaria).
 */
