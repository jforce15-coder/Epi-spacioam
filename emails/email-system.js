/* ══════════════════════════════════════════════════════════════════
   Spacio AM — Sistema de correos transaccionales (EPI App)
   ──────────────────────────────────────────────────────────────────
   UNA sola shell reutilizable: emailShell(opts) → { html, text }.
   Cada tipo de correo solo llama al shell con su contenido.
   CSS 100% inline · tablas role="presentation" · máx 600px · responsive.
   Portable: se adjunta a window (navegador) y a module.exports (Apps Script).
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* Base pública de las imágenes hero — carpeta email-assets/ alojada en el repo.
     (Para ver la vista previa en local con imágenes, usa "email-assets/" en su lugar.) */
  var IMG_BASE = "https://epi.spacioam.com/email-assets/";

  var C = {
    bg:      "#FAFAFA",
    card:    "#FFFFFF",
    ink:     "#3E3F3F",
    earth:   "#938B8A",
    divider: "#D8D4CE",
    peach:   "#E9826A",
    imgbg:   "#EDE7E0"   /* marcador cálido mientras la imagen carga / si falta */
  };

  var SERIF = "Georgia, 'Times New Roman', serif";
  var SANS  = "Helvetica, Arial, sans-serif";
  var SLOGAN = "Hay espacios en donde sueñas con volver a despertar";
  var CONTACT = "hola@spacioam.com  ·  +502 5690 9499";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── La shell ──────────────────────────────────────────────────
     opts = {
       eyebrow, heading, image (nombre de archivo | url completa | null),
       imageAlt, paras:[..], rows:[[label,value],..], cta:{label,url},
       footerNote, signoff, preheader
     }                                                              */
  function emailShell(opts) {
    var o = opts || {};
    var eyebrow    = o.eyebrow    || "";
    var heading    = o.heading    || "";
    var paras      = o.paras      || [];
    var rows       = o.rows       || [];
    var cta        = o.cta        || null;
    var footerNote = o.footerNote || "";
    var signoff    = o.signoff    || "Con cariño,\nEl equipo de Spacio AM";
    var preheader  = o.preheader  || (paras[0] || heading);

    var imgUrl = "";
    if (o.image) imgUrl = /^https?:/.test(o.image) ? o.image : (IMG_BASE + o.image);

    /* ── HTML ── */
    var H = [];
    H.push('<!doctype html><html lang="es"><head><meta charset="utf-8">');
    H.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
    H.push('<meta name="color-scheme" content="light only">');
    H.push('<title>' + esc(heading) + '</title></head>');
    H.push('<body style="margin:0;padding:0;background:' + C.bg + ';">');

    /* preheader oculto (texto de vista previa en la bandeja) */
    H.push('<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + C.bg + ';font-size:1px;line-height:1px;">' + esc(preheader) + '</div>');

    /* wrapper */
    H.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.bg + ';margin:0;padding:0;">');
    H.push('<tr><td align="center" style="padding:32px 16px;">');

    /* tarjeta 600px */
    H.push('<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:' + C.card + ';border-radius:24px;overflow:hidden;border:1px solid ' + C.divider + ';">');

    /* encabezado — wordmark + slogan */
    H.push('<tr><td align="center" style="padding:38px 40px 26px;">');
    H.push('<div style="font-family:' + SERIF + ';font-size:24px;letter-spacing:8px;color:' + C.ink + ';font-weight:400;">SPACIO&nbsp;AM</div>');
    H.push('<div style="font-family:' + SANS + ';font-size:11px;line-height:1.6;color:' + C.earth + ';margin-top:12px;letter-spacing:.3px;max-width:360px;">' + esc(SLOGAN) + '</div>');
    H.push('</td></tr>');

    /* hero opcional (3:2) */
    if (imgUrl) {
      H.push('<tr><td style="padding:0 20px;">');
      H.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
      H.push('<td style="background:' + C.imgbg + ';border-radius:18px;overflow:hidden;">');
      H.push('<img src="' + esc(imgUrl) + '" width="560" alt="' + esc(o.imageAlt || "") + '" style="display:block;width:100%;height:auto;border:0;border-radius:18px;">');
      H.push('</td></tr></table></td></tr>');
    }

    /* cuerpo */
    H.push('<tr><td style="padding:30px 40px 8px;">');
    if (eyebrow) {
      H.push('<div style="font-family:' + SANS + ';font-size:11px;letter-spacing:3px;text-transform:uppercase;color:' + C.earth + ';margin:0 0 14px;">' + esc(eyebrow) + '</div>');
    }
    if (heading) {
      H.push('<h1 style="font-family:' + SERIF + ';font-weight:400;font-size:28px;line-height:1.25;color:' + C.ink + ';margin:0 0 20px;">' + esc(heading) + '</h1>');
    }
    paras.forEach(function (p) {
      H.push('<p style="font-family:' + SANS + ';font-size:15px;line-height:1.7;color:' + C.ink + ';margin:0 0 16px;">' + esc(p) + '</p>');
    });
    H.push('</td></tr>');

    /* tabla de detalles opcional */
    if (rows.length) {
      H.push('<tr><td style="padding:6px 40px 8px;">');
      H.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.bg + ';border-radius:16px;">');
      rows.forEach(function (r, i) {
        var top = i === 0 ? "" : "border-top:1px solid " + C.divider + ";";
        H.push('<tr>');
        H.push('<td style="' + top + 'padding:13px 18px;font-family:' + SANS + ';font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + C.earth + ';vertical-align:top;width:42%;">' + esc(r[0]) + '</td>');
        H.push('<td style="' + top + 'padding:13px 18px;font-family:' + SANS + ';font-size:15px;color:' + C.ink + ';text-align:right;vertical-align:top;">' + esc(r[1]) + '</td>');
        H.push('</tr>');
      });
      H.push('</table></td></tr>');
    }

    /* CTA — un solo botón (acento peach) */
    if (cta && cta.label) {
      H.push('<tr><td style="padding:22px 40px 6px;">');
      H.push('<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>');
      H.push('<td style="border-radius:100px;background:' + C.peach + ';">');
      H.push('<a href="' + esc(cta.url || "#") + '" style="display:inline-block;padding:15px 34px;font-family:' + SANS + ';font-size:14px;font-weight:600;letter-spacing:.4px;color:#FFFFFF;text-decoration:none;border-radius:100px;">' + esc(cta.label) + '</a>');
      H.push('</td></tr></table></td></tr>');
    }

    /* nota al pie opcional */
    if (footerNote) {
      H.push('<tr><td style="padding:20px 40px 0;">');
      H.push('<p style="font-family:' + SANS + ';font-size:12.5px;line-height:1.65;color:' + C.earth + ';margin:0;">' + esc(footerNote) + '</p>');
      H.push('</td></tr>');
    }

    /* firma */
    H.push('<tr><td style="padding:30px 40px 8px;">');
    H.push('<div style="border-top:1px solid ' + C.divider + ';padding-top:22px;">');
    signoff.split("\n").forEach(function (line, i) {
      var style = i === 0
        ? 'font-family:' + SERIF + ';font-size:17px;color:' + C.ink + ';margin:0 0 2px;'
        : 'font-family:' + SANS + ';font-size:13px;color:' + C.earth + ';margin:0;';
      H.push('<div style="' + style + '">' + esc(line) + '</div>');
    });
    H.push('</div></td></tr>');

    /* pie de marca */
    H.push('<tr><td align="center" style="padding:26px 40px 40px;">');
    H.push('<div style="width:24px;height:1px;background:' + C.peach + ';margin:0 auto 18px;"></div>');
    H.push('<div style="font-family:' + SANS + ';font-size:11px;letter-spacing:.4px;color:' + C.earth + ';line-height:1.7;">' + esc(CONTACT) + '</div>');
    H.push('<div style="font-family:' + SANS + ';font-size:10.5px;color:' + C.earth + ';margin-top:8px;opacity:.75;">Guatemala · hospitalidad boutique</div>');
    H.push('</td></tr>');

    H.push('</table></td></tr></table></body></html>');

    /* ── Texto plano (multipart) ── */
    var T = [];
    T.push("SPACIO AM");
    T.push(SLOGAN);
    T.push("");
    if (eyebrow) T.push(eyebrow.toUpperCase());
    if (heading) { T.push(heading); T.push(""); }
    paras.forEach(function (p) { T.push(p); T.push(""); });
    if (rows.length) {
      T.push("— — —");
      rows.forEach(function (r) { T.push(r[0] + ": " + r[1]); });
      T.push("");
    }
    if (cta && cta.label) { T.push(cta.label + ": " + (cta.url || "")); T.push(""); }
    if (footerNote) { T.push(footerNote); T.push(""); }
    signoff.split("\n").forEach(function (l) { T.push(l); });
    T.push("");
    T.push(CONTACT);
    T.push("Guatemala · hospitalidad boutique");

    return { html: H.join(""), text: T.join("\n") };
  }

  /* ══════════════════════════════════════════════════════════════
     LOS 10 TIPOS — cada uno recibe `d` (datos del evento) y llama al shell.
     Los campos de `d` traen valores de ejemplo por defecto para la vista previa.
     ══════════════════════════════════════════════════════════════ */
  var EMAILS = {

    limpiezaAprobada: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Revisión de calidad",
        heading: "Tu limpieza fue aprobada",
        image: "hero-limpieza-aprobada.jpg",
        imageAlt: "Habitación tendida con luz de mañana",
        preheader: "Tu limpieza pasó la revisión de calidad. Gracias por tu trabajo.",
        paras: [
          "Hola " + (d.tecnico || "Caren") + ", tu limpieza pasó la revisión de calidad sin observaciones.",
          "Gracias por el cuidado en cada detalle. Así se siente un espacio al que da gusto volver."
        ],
        rows: [
          ["Propiedad", d.propiedad || "Loft del Cielo"],
          ["Fecha", d.fecha || "18 de julio, 2026"],
          ["Resultado", "Aprobada"]
        ],
        footerNote: "Puedes ver el detalle de esta revisión en la pestaña Calidad de la app.",
        signoff: "Con cariño,\nEl equipo de Spacio AM"
      });
    },

    correccionInmediata: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Corrección para hoy",
        heading: "Un detalle por atender antes de recibir",
        image: "hero-correccion-inmediata.jpg",
        imageAlt: "Superficie cálida por afinar",
        preheader: "Hay un detalle por corregir hoy en la propiedad.",
        paras: [
          "Hola " + (d.tecnico || "Caren") + ", encontramos un detalle que conviene resolver hoy, antes de la llegada del próximo huésped.",
          d.detalle || "Revisar el acabado del baño principal: quedaron marcas de agua en el espejo y la grifería."
        ],
        rows: [
          ["Propiedad", d.propiedad || "Loft del Cielo"],
          ["Fecha de la limpieza", d.fecha || "18 de julio, 2026"],
          ["Prioridad", "Atender hoy"]
        ],
        cta: { label: "Confirmar corrección", url: d.url || "https://epi.spacioam.com" },
        footerNote: "Cuando lo resuelvas, confírmalo en la app para cerrar el seguimiento. Si algo no es posible hoy, escríbenos y lo vemos juntos.",
        signoff: "Gracias por tu pronta atención,\nEl equipo de Spacio AM"
      });
    },

    correccionFutura: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Nota para tus próximas limpiezas",
        heading: "Una observación para tener en cuenta",
        image: "hero-correccion-futura.jpg",
        imageAlt: "Rincón sereno con libreta",
        preheader: "Una observación para tus próximas limpiezas, sin urgencia.",
        paras: [
          "Hola " + (d.tecnico || "Caren") + ", esta limpieza quedó bien. Queremos dejarte una nota para las próximas, sin ninguna urgencia.",
          d.detalle || "Al tender la cama, procura centrar los cojines y dejar el doblez del cobertor hacia la cabecera. Es un detalle pequeño que se nota mucho en foto."
        ],
        rows: [
          ["Propiedad", d.propiedad || "Loft del Cielo"],
          ["Fecha", d.fecha || "18 de julio, 2026"]
        ],
        footerNote: "Encontrarás esta nota en la pestaña Calidad, en tus observaciones para el futuro.",
        signoff: "Con cariño,\nEl equipo de Spacio AM"
      });
    },

    listaSupervision: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Lista para revisar",
        heading: "Hay una limpieza esperando tu revisión",
        image: "hero-supervision.jpg",
        imageAlt: "Habitación terminada y ordenada",
        preheader: (d.tecnico || "Un técnico") + " terminó una limpieza que espera supervisión.",
        paras: [
          "Hola, " + (d.tecnico || "Caren") + " terminó una " + (d.tipoLimpieza || "limpieza") + " y quedó lista para tu revisión.",
          "Cuando tengas un momento, entra a la app para revisarla y dejar tu visto bueno o tus observaciones."
        ],
        rows: [
          ["Propiedad", d.propiedad || "Loft del Cielo"],
          ["Técnico", d.tecnico || "Caren Chacón"],
          ["Tipo", d.tipoLimpieza || "Limpieza estándar"],
          ["Fecha", d.fecha || "18 de julio, 2026"]
        ],
        cta: { label: "Abrir supervisión", url: d.url || "https://epi.spacioam.com" },
        signoff: "Gracias,\nEl equipo de Spacio AM"
      });
    },

    correccionAtendida: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Seguimiento cerrado",
        heading: "La corrección fue atendida",
        image: "hero-correccion-atendida.jpg",
        imageAlt: "Espacio en calma recién ordenado",
        preheader: (d.tecnico || "El técnico") + " confirmó que atendió la corrección inmediata.",
        paras: [
          "Hola, " + (d.tecnico || "Caren") + " confirmó que atendió la corrección inmediata que se había señalado.",
          "Dejamos constancia para tu registro. Puedes verificar el detalle en la app."
        ],
        rows: [
          ["Propiedad", d.propiedad || "Loft del Cielo"],
          ["Técnico", d.tecnico || "Caren Chacón"],
          ["Fecha", d.fecha || "18 de julio, 2026"],
          ["Estado", "Atendida"]
        ],
        cta: { label: "Ver en Calidad", url: d.url || "https://epi.spacioam.com" },
        signoff: "Gracias,\nEl equipo de Spacio AM"
      });
    },

    danoUrgente: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Requiere tu atención",
        heading: "Daño clasificado como urgente",
        image: "hero-dano-urgente.jpg",
        imageAlt: "Detalle de mantenimiento en tono cálido",
        preheader: "Se registró un daño de urgencia alta en una propiedad.",
        paras: [
          "Se clasificó como urgencia alta un daño reportado en " + (d.propiedad || "Loft del Cielo") + ".",
          d.detalle || "La ducha del baño principal no drena y hay filtración hacia el clóset contiguo."
        ],
        rows: [
          ["Propiedad", d.propiedad || "Loft del Cielo"],
          ["Fecha del reporte", d.fecha || "18 de julio, 2026"],
          ["Clasificado por", d.clasificadoPor || "Administración"],
          ["Urgencia", "Alta"]
        ],
        cta: { label: "Revisar en la app", url: d.url || "https://epi.spacioam.com" },
        footerNote: "Este aviso se envía a la administración para coordinar la reparación cuanto antes.",
        signoff: "El sistema EPI,\nSpacio AM"
      });
    },

    solicitudAdelanto: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Solicitud por revisar",
        heading: "Un técnico solicitó un adelanto",
        image: "hero-solicitud-adelanto.jpg",
        imageAlt: "Escritorio con documento y taza",
        preheader: (d.tecnico || "Un técnico") + " envió una solicitud de adelanto.",
        paras: [
          "Hola, " + (d.tecnico || "Caren Chacón") + " envió una solicitud de adelanto y espera tu revisión.",
          "Puedes aprobarla o ajustarla desde la pestaña Adelantos de la app."
        ],
        rows: [
          ["Técnico", d.tecnico || "Caren Chacón"],
          ["Monto solicitado", d.monto || "Q1,200"],
          ["Cuotas", d.cuotas || "8 semanas"],
          ["Cuota semanal", d.cuota || "Q150"]
        ],
        cta: { label: "Revisar solicitud", url: d.url || "https://epi.spacioam.com" },
        signoff: "El sistema EPI,\nSpacio AM"
      });
    },

    adelantoFirma: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Adelanto por firmar",
        heading: "Tienes un adelanto listo para firmar",
        image: "hero-adelanto-firma.jpg",
        imageAlt: "Mesa con pluma y papel, luz dorada",
        preheader: "Sube tu documento y firma para activar tu adelanto.",
        paras: [
          "Hola " + (d.tecnico || "Caren") + ", la administración preparó un adelanto para ti.",
          "Para continuar, entra a la app, sube la foto de tu DPI y firma el contrato. Después se realizará el depósito."
        ],
        rows: [
          ["Monto", d.monto || "Q1,200"],
          ["Cuotas", d.cuotas || "8 semanas"],
          ["Cuota semanal", d.cuota || "Q150"]
        ],
        cta: { label: "Subir DPI y firmar", url: d.url || "https://epi.spacioam.com" },
        footerNote: "El descuento semanal se aplica de forma automática sobre tus pagos, según el contrato que firmes.",
        signoff: "Con cariño,\nEl equipo de Spacio AM"
      });
    },

    adelantoDepositado: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Depósito realizado",
        heading: "Tu adelanto ya fue depositado",
        image: "hero-adelanto-deposito.jpg",
        imageAlt: "Amanecer sereno sobre textil cálido",
        preheader: "Confirmamos el depósito de tu adelanto.",
        paras: [
          "Hola " + (d.tecnico || "Caren") + ", confirmamos que tu adelanto fue depositado.",
          "A partir de tu próxima liquidación se aplicará el descuento semanal acordado, hasta completar el saldo."
        ],
        rows: [
          ["Monto depositado", d.monto || "Q1,200"],
          ["Fecha del depósito", d.fecha || "18 de julio, 2026"],
          ["Cuota semanal", d.cuota || "Q150"],
          ["Cuotas", d.cuotas || "8 semanas"]
        ],
        footerNote: "Puedes seguir el saldo de tu adelanto en la pestaña Adelanto de la app.",
        signoff: "Con cariño,\nEl equipo de Spacio AM"
      });
    },

    comprobantePago: function (d) {
      d = d || {};
      return emailShell({
        eyebrow: "Comprobante de pago",
        heading: "Tu pago de la semana",
        image: "hero-comprobante-pago.jpg",
        imageAlt: "Mesa ordenada con café, luz de mañana",
        preheader: "Adjuntamos el comprobante de tu pago semanal.",
        paras: [
          "Hola " + (d.tecnico || "Caren") + ", este es el detalle de tu pago correspondiente a la semana " + (d.semana || "del 12 al 18 de julio") + "."
        ],
        rows: [
          ["Limpiezas", d.trabajos || "7 trabajos"],
          ["Subtotal", d.subtotal || "Q1,050"],
          ["Descuento adelanto", d.descuento || "− Q150"],
          ["Total a pagar", d.total || "Q900"]
        ],
        cta: { label: "Ver comprobante", url: d.url || "https://epi.spacioam.com" },
        footerNote: "Folio " + (d.folio || "EPI-000128") + ". Conserva este comprobante para tu registro.",
        signoff: "Gracias por tu trabajo,\nEl equipo de Spacio AM"
      });
    }
  };

  /* Metadatos — tipo, disparador, destinatario, objetivo (para vista previa y docs). */
  var META = [
    { id: "limpiezaAprobada",    label: "Limpieza aprobada",            recipient: "Técnico",              trigger: "QA marca la limpieza como aprobada",       goal: "Confirmar trabajo aceptado y reconocer" },
    { id: "correccionInmediata", label: "Corrección inmediata",         recipient: "Técnico",              trigger: "QA marca corrección urgente",              goal: "Pedir corrección hoy con el detalle" },
    { id: "correccionFutura",    label: "Corrección para el futuro",    recipient: "Técnico",              trigger: "QA marca observación futura",              goal: "Nota amable para próximas limpiezas" },
    { id: "listaSupervision",    label: "Lista para supervisión",       recipient: "Encargado / Supervisor", trigger: "Técnico termina una limpieza",           goal: "Avisar que hay una limpieza por revisar" },
    { id: "correccionAtendida",  label: "Corrección atendida",          recipient: "Supervisor + Admin",   trigger: "Técnico confirma que corrigió",            goal: "Cerrar el seguimiento" },
    { id: "danoUrgente",         label: "Daño urgente",                 recipient: "Administrador",        trigger: "Se clasifica un daño como urgencia alta",  goal: "Alertar para coordinar reparación" },
    { id: "solicitudAdelanto",   label: "Nueva solicitud de adelanto",  recipient: "Administrador",        trigger: "Técnico solicita un adelanto",             goal: "Avisar de solicitud por revisar" },
    { id: "adelantoFirma",       label: "Adelanto por firmar",          recipient: "Técnico",              trigger: "Admin inicia un adelanto para el técnico", goal: "Pedir subir DPI y firmar" },
    { id: "adelantoDepositado",  label: "Adelanto depositado",          recipient: "Técnico",              trigger: "Admin realiza el depósito",                goal: "Confirmar depósito realizado" },
    { id: "comprobantePago",     label: "Comprobante de pago semanal",  recipient: "Técnico",              trigger: "Admin genera el comprobante",              goal: "Recibo del pago con detalle" }
  ];

  function buildAll(sample) {
    return META.map(function (m) {
      var built = EMAILS[m.id]((sample && sample[m.id]) || {});
      return { id: m.id, label: m.label, recipient: m.recipient, trigger: m.trigger, goal: m.goal, html: built.html, text: built.text };
    });
  }

  var API = { emailShell: emailShell, EMAILS: EMAILS, META: META, buildAll: buildAll, IMG_BASE: IMG_BASE, C: C };

  if (typeof window !== "undefined") window.SpacioEmails = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
