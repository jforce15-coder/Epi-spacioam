const {useState,useEffect,useRef,Component}=React;
const {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,LineChart,Line,CartesianGrid}=(window.Recharts||{});

/* ─── Responsive hook */
function useScreen() {
  var [w,setW] = useState(typeof window!=="undefined"?window.innerWidth:1024);
  useEffect(function(){
    function h(){setW(window.innerWidth);}
    window.addEventListener("resize",h);
    return function(){window.removeEventListener("resize",h);};
  },[]);
  return {w:w, mobile:w<640, tablet:w>=640&&w<1024, desktop:w>=1024};
}

/* ═══ TOKENS */
const C = {
  alabaster:"#FAFAFA", beige:"#F5F3F0",   earth:"#938B8A",
  gray:"#D8D4CE",      black:"#3E3F3F",   peach:"#E9826A",
  green:"#3d6b52",     red:"#8a3030",     orange:"#9a5020",
  sand:"#E8E4DF",      taupe:"#938B8A",   accent:"#E9826A",
  surface:"#FFFFFF",   surfaceWarm:"#F5F3F0", line:"#EAE6E0",
};
const CATS = ["Limpieza tradicional","Limpieza profunda","Mantenimiento","Nuevo Producto","Ajuste","Reporte de Daños"];
const BADGE = {
  "Limpieza tradicional":{bg:"#E8EDE9",tx:"#4a7a60"},
  "Limpieza profunda":   {bg:"#DDE8DF",tx:"#3a6b50"},
  "Mantenimiento":       {bg:"#E8EAF0",tx:"#4a5a7a"},
  "Nuevo Producto":      {bg:"#EDE8E2",tx:"#7a5a3a"},
  "Ajuste":             {bg:"#EDEAE3",tx:"#7a7050"},
  "Reporte de Daños":   {bg:"#EDE4E4",tx:"#9b3a3a"},
  "Supervisión":        {bg:"#E9E4ED",tx:"#5a4a7a"},
};
const ALT = {
  red:    {label:"Trabajo de hace 3+ semanas", clr:"#9b3a3a", bg:"#EDE4E4"},
  orange: {label:"Trabajo de hace 2 semanas",  clr:"#b5622a", bg:"#EDE7E0"},
  yellow: {label:"Trabajo de la semana anterior", clr:"#8a7040", bg:"#F5F2EC"},
};
const PERIODS   = [[3,"3 días"],[5,"5 días"],[7,"7 días"],[14,"14 días"],[30,"30 días+"]];
const PAGADORES   = ["Spacio AM","Dueño"];
const CLEAN_CATS  = ["Limpieza tradicional","Limpieza profunda"];
/* Toda limpieza tradicional la cubre Spacio AM — se aplica automáticamente al cargar
   (corrige también los reportes previos que quedaron sin pagador o mal clasificados). */
function withAutoPagador(list){
  return (list||[]).map(function(r){
    if(r && r.categoria==="Limpieza tradicional" && r.pagadoPor!=="Spacio AM"){
      return Object.assign({},r,{pagadoPor:"Spacio AM"});
    }
    return r;
  });
}

/* ─── Auto-tariff helper — shared across all form types */
function autoTarifa(email, vendors) {
  if (!email||!vendors) return {tarifa:"",locked:false};
  var v = vendors.find(function(x){return x.email===email;});
  if (!v) return {tarifa:"",locked:false};
  var isEPI = v.tipo==="interno"&&(v.categoria==="EPI Limpieza"||v.categoria==="EPI Mantenimiento");
  if (!isEPI) return {tarifa:"",locked:false};
  var hasTarifa = v.tarifaLimpieza && parseFloat(v.tarifaLimpieza)>0;
  return {tarifa: hasTarifa ? String(v.tarifaLimpieza) : "", locked: hasTarifa};
}


function isCleaning(cat){return CLEAN_CATS.indexOf(cat)>=0;}
/* Reporte de Daños = solo seguimiento. NUNCA genera pago al técnico. */
function isDanos(cat){return cat==="Reporte de Daños";}
function isPayable(r, vendors){
  if(!r||isDanos(r.categoria)) return false;
  return !!(r.total||autoTarifa(r.reportadoPor||"",vendors||[]).tarifa);
}
const INTERNAL_CATS = ["Administrativo","EPI Limpieza","EPI Mantenimiento"];

/* ─── Convert any Google Drive URL to inline-displayable thumbnail */
function driveThumb(url, size) {
  if (!url||typeof url!=="string") return url;
  if (url.startsWith("data:")) return url;
  size = size || 400;
  var m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) ||
          url.match(/\/d\/([a-zA-Z0-9_-]{20,})\//);
  if (!m) return url;
  return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w" + size;
}

function vendorDisplay(v) {
  if (!v) return "—";
  if (v.primerNombre) return [v.primerNombre, v.primerApellido].filter(Boolean).join(" ");
  return v.name||v.email||"—";
}

/* ─── Identidad de usuario
   Un técnico puede haber cambiado de correo. Sus reportes antiguos guardan el correo
   viejo en `reportadoPor`; los nuevos guardan además `vendorId`. Estas funciones
   emparejan un reporte con su técnico por id O por cualquiera de sus correos
   (actual, de notificaciones, o anteriores guardados en `prevEmails`). */
function vendorEmailSet(v) {
  if (!v) return [];
  var arr = [v.email, v.notifEmail].concat(v.prevEmails || []);
  var out = [];
  arr.forEach(function(e){ if(e){ var le=String(e).toLowerCase().trim(); if(le && out.indexOf(le)<0) out.push(le); } });
  return out;
}
function repMatchesVendor(rep, v) {
  if (!rep || !v) return false;
  if (rep.vendorId && v.id && rep.vendorId===v.id) return true;
  var rp = (rep.reportadoPor||"").toLowerCase().trim();
  if (!rp) return false;
  return vendorEmailSet(v).indexOf(rp) >= 0;
}

/* Correos huérfanos: los que aparecen en reportes pero no pertenecen a ningún técnico actual
   (normalmente el correo viejo de alguien que cambió de correo). Solo se exponen los CORREOS
   distintos (con su conteo), nunca el contenido de los reportes. */
function orphanEmailList(reps, vendors) {
  var known = {};
  (vendors||[]).forEach(function(v){ vendorEmailSet(v).forEach(function(e){ known[e]=true; }); });
  var counts = {};
  (reps||[]).forEach(function(r){
    var e=(r.reportadoPor||"").toLowerCase().trim();
    if(e && !known[e]) counts[e]=(counts[e]||0)+1;
  });
  return Object.keys(counts).map(function(e){return {email:e,count:counts[e]};}).sort(function(a,b){return b.count-a.count;});
}

/* ─── Agrupación de técnicos para los filtros del dashboard.
   Devuelve UNA entrada por PERSONA (nombre y apellido), nunca un correo:
     • unifica varios registros del mismo técnico (mismo nombre) y
     • unifica todos los correos de cada uno (actual, de notificaciones y anteriores).
   Los correos "huérfanos" (aparecen en reportes pero sin dueño, típicamente un correo viejo
   que se cambió) se ligan a la persona por nombre cuando el correo lo permite; si no se puede
   identificar, se agrupan en una sola entrada "Sin técnico asignado".
   Cada entrada: {value, label, emails:[...], vendorIds:[...], primaryEmail}.
   `filterFn(rep)` limita el universo de reportes considerado (p.ej. solo limpiezas). */
function techFilterGroups(reps, vendors, filterFn) {
  var inScope = function(r){ return filterFn ? filterFn(r) : true; };
  var scoped = (reps||[]).filter(inScope);
  var groups = [];
  var byName = {};
  /* Crear un grupo candidato para CADA técnico —aunque todavía no tenga reportes que
     empaten directamente. Así un técnico cuyos reportes llegaron todos bajo un correo
     distinto (un typo o un correo viejo) conserva un grupo al que ligar esos correos.
     Al final se descartan los grupos que quedaron sin reportes. */
  (vendors||[]).forEach(function(v){
    var name = vendorDisplay(v);
    var nk = normalize(name) || ("id:"+(v.id||v.email||""));
    var g = byName[nk];
    if(!g){ g={value:"g:"+nk, label:name, emails:[], vendorIds:[], primaryEmail:(v.email||vendorEmailSet(v)[0]||"")}; byName[nk]=g; groups.push(g); }
    vendorEmailSet(v).forEach(function(e){ if(g.emails.indexOf(e)<0) g.emails.push(e); });
    if(v.id && g.vendorIds.indexOf(v.id)<0) g.vendorIds.push(v.id);
    if(!g.primaryEmail && v.email) g.primaryEmail=v.email;
  });
  groups.sort(function(a,b){return a.label.localeCompare(b.label);});
  /* Correos huérfanos → ligar por nombre o agrupar en "Sin técnico asignado" */
  var known={}; groups.forEach(function(g){g.emails.forEach(function(e){known[e]=true;});});
  var orphans = uniq(scoped.map(function(r){return (r.reportadoPor||"").toLowerCase().trim();}).filter(Boolean))
    .filter(function(e){return !known[e];});
  var unassigned=null;
  orphans.forEach(function(e){
    var local = normalize(e.split("@")[0]);
    var best=null, bestScore=0;
    groups.forEach(function(g){
      if(g.value==="g:__unassigned") return;
      var s = similarity(local, normalize(g.label));
      var toks = normalize(g.label).split(" ").filter(function(t){return t.length>=3;});
      if(toks.length && toks.every(function(t){return local.indexOf(t)>=0;})) s=Math.max(s,0.9);
      else if(toks.some(function(t){return local.indexOf(t)>=0;})) s=Math.max(s,0.7);
      if(s>bestScore){bestScore=s;best=g;}
    });
    if(best && bestScore>=0.7){ if(best.emails.indexOf(e)<0) best.emails.push(e); }
    else {
      if(!unassigned){ unassigned={value:"g:__unassigned", label:"Sin técnico asignado", emails:[], vendorIds:[], primaryEmail:""}; groups.push(unassigned); }
      unassigned.emails.push(e);
    }
  });
  /* Conservar solo los grupos que realmente tienen reportes (por vendorId o por cualquiera
     de sus correos, incluidos los huérfanos recién ligados por nombre). */
  return groups.filter(function(g){
    return scoped.some(function(r){return repInGroup(r,g);});
  });
}
/* Un reporte pertenece a un grupo de técnicos (por vendorId o por cualquiera de sus correos) */
function repInGroup(rep, g){
  if(!rep||!g) return false;
  if(rep.vendorId && g.vendorIds.indexOf(rep.vendorId)>=0) return true;
  var rp=(rep.reportadoPor||"").toLowerCase().trim();
  return !!rp && g.emails.indexOf(rp)>=0;
}

/* ─── Fuzzy vendor matcher
   Matches by email, phone, or name similarity.
   Returns the best-matching vendor and a confidence score 0-1.
*/
function normalize(s) {
  if (!s) return "";
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g,"")  /* remove accents */
    .replace(/[^a-z0-9@.+\s]/g," ")
    .replace(/\s+/g," ").trim();
}

function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a||!b) return 0;
  if (a===b) return 1;
  if (a.includes(b)||b.includes(a)) return 0.9;
  /* Count matching words */
  var wa = a.split(" ").filter(Boolean);
  var wb = b.split(" ").filter(Boolean);
  var matches = wa.filter(function(w){ return w.length>2&&wb.some(function(x){return x.includes(w)||w.includes(x)||levenshtein(w,x)<=2;}); });
  return matches.length / Math.max(wa.length, wb.length);
}

function levenshtein(a, b) {
  var m=a.length, n=b.length;
  var dp=[];
  for(var i=0;i<=m;i++){dp[i]=[i];for(var j=1;j<=n;j++){if(i===0){dp[i][j]=j;}else{var cost=a[i-1]===b[j-1]?0:1;dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+cost);}}}
  return dp[m][n];
}

function fuzzyMatchVendor(query, vendors) {
  /* query: raw text from Hospitable — could be email, name, phone, or any combo */
  if (!query||!vendors||!vendors.length) return {vendor:null, score:0};
  var q = normalize(query);

  var scored = vendors.map(function(v){
    var scores = [];
    /* Email match */
    var em = normalize(v.email||"");
    if (em&&q.includes(em.split("@")[0])) scores.push(0.95);
    else if (em&&similarity(q,em)>0.5) scores.push(similarity(q,em));

    /* Phone match — normalize digits only */
    var ph = (v.phone||"").replace(/\D/g,"");
    var qph = q.replace(/\D/g,"");
    if (ph&&qph&&qph.includes(ph.slice(-8))) scores.push(0.9);

    /* Full name match */
    var fullName = [v.primerNombre,v.segundoNombre,v.primerApellido,v.segundoApellido].filter(Boolean).join(" ");
    var oldName  = v.name||"";
    var ns1 = similarity(q, fullName);
    var ns2 = similarity(q, oldName);
    scores.push(Math.max(ns1,ns2));

    return {vendor:v, score:scores.length?Math.max.apply(null,scores):0};
  });

  scored.sort(function(a,b){return b.score-a.score;});
  var best = scored[0];
  return best&&best.score>0.25 ? best : {vendor:null, score:0};
}

function vendorTipo(v) {
  if (!v) return "";
  var t = v.tipo==="interno" ? "Interno" : v.tipo==="externo" ? "Externo" : "";
  return t + (v.categoria ? " · "+v.categoria : "");
}



const MOTIVOS_AJUSTE = ["Tokens de lavado","Transporte","Limpieza pendiente","Día doble","Servicio adicional","Compras adicionales","Otro"];

const GEO = {
  Guatemala: ["Ciudad de Guatemala","Antigua Guatemala","Puerto San José","Quetzaltenango"],
  Perú:      ["Lima","Cusco","Arequipa","Miraflores"],
};

const INV_DEFAULT = [
  {id:"inv1",  name:"Tarjetas de acceso",              requirePhoto:true,  cantidad:1},
  {id:"inv2",  name:"Juegos de sábanas en buen estado",requirePhoto:false, cantidad:1, countAlways:true, note:"Cuenta TODOS los juegos (sábana con elástico, sábana plana y fundas)"},
  {id:"inv3",  name:"Cubrecama / Edredón / Duvet",     requirePhoto:false, cantidad:1},
  {id:"inv4",  name:"Toallas de cuerpo",               requirePhoto:false, cantidad:2, countAlways:true, note:"Cuenta TODAS las toallas que haya"},
  {id:"inv5",  name:"Toallas de mano",                 requirePhoto:false, cantidad:2, countAlways:true, note:"Cuenta TODAS las toallas que haya"},
  {id:"inv6",  name:"Toallas desmaquillante",          requirePhoto:false, cantidad:2, countAlways:true, note:"Cuenta TODAS las toallas que haya"},
  {id:"inv7",  name:"Alfombra de baño",                requirePhoto:false, cantidad:1},
  {id:"inv8",  name:"Plancha",                         requirePhoto:false, cantidad:1},
  {id:"inv9",  name:"Ventilador",                      requirePhoto:false, cantidad:1},
  {id:"inv10", name:"Secadora",                        requirePhoto:false, cantidad:1},
  {id:"inv11", name:"Cafetera",                        requirePhoto:false, cantidad:1},
  {id:"inv12", name:"Bombillos (generales y lámparas)",requirePhoto:false, cantidad:1},
  {id:"inv13", name:"Objetos olvidados",               requirePhoto:true,  optionalPhoto:true, cantidad:0},
];

const TRAD_SINGLE_PHOTOS = [
  ["fotosCocinaGeneral","Cocina — general"],
  ["fotosMicroondas","Cocina — microondas"],
  ["fotosCafetera","Cocina — cafetera"],
  ["fotosEcofiltro","Cocina — ecofiltro"],
  ["fotosLavatrastos","Cocina — lavaplatos"],
  ["fotosRefrigerador","Cocina — refrigerador"],
  ["fotosInsumosLimpieza","Cocina — insumos de limpieza"],
  ["fotosSalaGeneral","Sala — general"],
  ["fotosComedorGeneral","Comedor — general"],
  ["fotosPrimeraImpresion","Detalles — primera impresión"],
  ["fotosPisoComun","Detalles — piso de área común"],
  ["fotosTrapeadores","Detalles — trapeadores y trapos"],
  ["fotosTarjetas","Detalles — tarjetas de acceso"],
  ["fotosCloset","Detalles — blancos en clóset"],
];


/* ═══ UTILS */
function fmtDate(d) {
  if (!d) return "—";
  try {
    var dt = (typeof d==="string"&&d.length===10&&/^\d{4}-\d{2}-\d{2}$/.test(d))
      ? new Date(d+"T12:00:00")
      : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString("es-GT",{day:"2-digit",month:"short",year:"numeric"});
  } catch(e) { return String(d)||"—"; }
}
function todayStr() { return new Date().toISOString().split("T")[0]; }
function relDate(days) { return new Date(Date.now()-days*86400000).toISOString().split("T")[0]; }
/* Rangos de período rápido (compartido por todos los filtros). Semanas lunes→domingo. */
function presetRange(val){
  var now=new Date(); now.setHours(12,0,0,0);
  function iso(d){ return d.toISOString().split("T")[0]; }
  var to=iso(now);
  var lunes=new Date(now); lunes.setDate(now.getDate()-((now.getDay()+6)%7)); /* lunes de esta semana */
  if(val==="hoy")        return {from:to,to:to};
  if(val==="semana")     return {from:iso(lunes), to:to};
  if(val==="semana_ant"){ var lAnt=new Date(lunes); lAnt.setDate(lunes.getDate()-7); var dAnt=new Date(lunes); dAnt.setDate(lunes.getDate()-1); return {from:iso(lAnt), to:iso(dAnt)}; }
  if(val==="semanas_ant"){ var dPrev=new Date(lunes); dPrev.setDate(lunes.getDate()-1); return {from:"", to:iso(dPrev)}; } /* todas las semanas antes de la actual */
  if(val==="mes")        return {from:iso(new Date(now.getFullYear(),now.getMonth(),1)), to:to};
  if(val==="3meses"){ var t3=new Date(now); t3.setMonth(t3.getMonth()-3); return {from:iso(t3), to:to}; }
  if(val==="7d")  return {from:relDate(6),  to:to};
  if(val==="14d") return {from:relDate(13), to:to};
  if(val==="30d") return {from:relDate(29), to:to};
  return {from:"", to:""};
}
/* Opciones del menú "Período rápido" — orden y etiquetas uniformes */
var PRESET_OPTS = [
  ["hoy","Hoy"],
  ["semana","Semana en curso"],
  ["semana_ant","Semana anterior"],
  ["mes","Este mes"],
  ["semanas_ant","Semanas anteriores"],
  ["todo","Todo"],
];
function daysSince(ts) { return Math.floor((Date.now()-ts)/86400000); }
function alertLvl(r) {
  if (r.paid || !r.total || isDanos(r.categoria)) return null;
  var d = daysSince(r.createdAt||r.id);
  if (d>=21) return "red"; if (d>=14) return "orange"; if (d>=7) return "yellow";
  return null;
}
function uniq(arr) { return [...new Set(arr)]; }
function compress(file) {
  return new Promise(function(res) {
    var fr = new FileReader();
    fr.onload = function(ev) {
      var img = new Image();
      img.onload = function() {
        var rt = Math.min(900/img.width, 1);
        var cv = document.createElement("canvas");
        cv.width  = Math.round(img.width*rt);
        cv.height = Math.round(img.height*rt);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL("image/jpeg", 0.75));
      };
      img.src = ev.target.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ═══ STORAGE — auto-detects environment */
var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxzYpBaTI_1S0VepOi810zrzB-fyC4R2Flug0ZEOOxNzZ9F7CLiSWaKXEtk1C17sfsX/exec";

/* ═══ CANDADO ANTI-BORRADO DE USUARIOS ═══
   Solo es `true` cuando la lista REAL de usuarios se cargó desde Google Sheets.
   Mientras sea `false` (sin conexión, o mostrando los 3 usuarios de respaldo DEF_V),
   `svV` NO guarda usuarios — así una edición hecha en modo desconectado nunca puede
   sobrescribir y borrar la lista real de técnicos en el Sheet. */
var VENDORS_SAFE = false;

/* Lista de técnicos disponible para el cálculo de adelantos (se mantiene sincronizada
   con el estado `vendors`). Permite que advanceState reconozca TODOS los correos de
   un técnico — actual, de notificaciones y anteriores — aunque el adelanto se haya
   creado con un correo que la persona ya cambió. */
var ADV_VENDORS = [];

/* Detect if running inside Claude sandbox — strict check */
var IS_CLAUDE_SANDBOX = false;

/* ─── GOOGLE SHEETS API (used when deployed to Vercel / custom domain) */
async function apiCall(action, payload) {
  /* Reintentos con espera progresiva — el Apps Script tiene "arranque en frío":
     la primera llamada tras un rato inactivo suele fallar o devolver una página
     de error (no JSON). Antes eso obligaba a recargar varias veces hasta que
     conectaba. Ahora reintentamos hasta 3 veces (con timeout por intento) y solo
     al agotar los intentos se reporta "sin conexión". */
  var body = JSON.stringify(Object.assign({action:action}, payload||{}));
  var lastErr;
  for (var attempt=0; attempt<3; attempt++) {
    if (attempt>0) { await new Promise(function(res){ setTimeout(res, attempt*800); }); }
    var ctl = (typeof AbortController!=="undefined") ? new AbortController() : null;
    var tid = ctl ? setTimeout(function(){ try{ctl.abort();}catch(_){} }, 12000) : null;
    var r;
    try {
      r = await fetch(SCRIPT_URL, {
        method:"POST",
        headers:{"Content-Type":"text/plain"},
        body:body,
        mode:"cors",
        redirect:"follow",
        signal: ctl ? ctl.signal : undefined
      });
    } catch(e) { if(tid)clearTimeout(tid); lastErr=e; continue; /* red caída o timeout → reintentar */ }
    if(tid)clearTimeout(tid);
    if (!r.ok) {
      if (r.status>=500 || r.status===429) { lastErr=new Error("HTTP "+r.status); continue; }
      throw new Error("HTTP "+r.status);
    }
    var text = await r.text();
    var j; try { j=JSON.parse(text); } catch(e) { lastErr=new Error("Respuesta inválida del servidor"); continue; /* arranque en frío → reintentar */ }
    if (!j.ok) throw new Error(j.error||"Error servidor");
    return j.data;
  }
  throw lastErr || new Error("Sin conexión");
}

/* ─── NOTIFICACIONES — correo vía Apps Script (acción "notify").
   Fire-and-forget: si el Apps Script aún no tiene la acción, no rompe nada.
   Los teléfonos de Config quedan listos para SMS en el futuro. */
function notifyEmail(to, subject, body) {
  var list = (Array.isArray(to)?to:[to]).filter(Boolean);
  if (!list.length) return;
  apiCall("notify",{to:list, subject:subject, body:body}).catch(function(e){
    console.warn("Notificación no enviada (agrega la acción 'notify' al Apps Script):", e&&e.message);
  });
}
function supervisorEmails(vendors, exceptEmail){
  return (vendors||[]).filter(function(v){return v.isSupervisor&&v.active&&v.email&&v.email!==exceptEmail;}).map(function(v){return v.email;});
}
function adminEmails(vendors){
  return (vendors||[]).filter(function(v){return v.isAdmin&&v.active&&v.email;}).map(function(v){return v.email;});
}
function notifyQAResult(rep, status, comment, vendors){
  if(!rep||!rep.reportadoPor) return;
  if(status==="aprobada"){
    notifyEmail(rep.reportadoPor, "✓ Limpieza aprobada — "+rep.propiedad,
      "Hola,\n\nTu limpieza en "+rep.propiedad+" del "+fmtDate(rep.fecha)+" fue APROBADA. ¡Buen trabajo!\n\nEPI App — Spacio AM");
  } else if(status==="correccion"){
    if(rep.qaTipo==="inmediata"){
      notifyEmail(rep.reportadoPor, "🔴 CORRECCIÓN INMEDIATA — "+rep.propiedad,
        "Hola,\n\nTu limpieza en "+rep.propiedad+" del "+fmtDate(rep.fecha)+" necesita una CORRECCIÓN INMEDIATA (urgente):\n\n"+(comment||"(ver detalle en el app)")+"\n\nDebes atenderla HOY y confirmar en la pestaña ★ Calidad del app cuando esté corregida.\n\nEPI App — Spacio AM");
    } else {
      notifyEmail(rep.reportadoPor, "⚠ Corrección para el futuro — "+rep.propiedad,
        "Hola,\n\nTu limpieza en "+rep.propiedad+" del "+fmtDate(rep.fecha)+" tiene una observación para tus PRÓXIMAS limpiezas:\n\n"+(comment||"(ver detalle en el app)")+"\n\nConfírmala en la pestaña ★ Calidad del app.\n\nEPI App — Spacio AM");
    }
  }
}

/* ─── LOCAL STORAGE FALLBACK (used inside Claude published artifact) */
function ls_get(k){ try{var v=localStorage.getItem("sam_"+k);return v?JSON.parse(v):null;}catch(e){return null;} }
function ls_set(k,v){ try{localStorage.setItem("sam_"+k,JSON.stringify(v));}catch(e){} }
function ls_del(k){ try{localStorage.removeItem("sam_"+k);}catch(e){} }

/* ─── BORRADORES DE FORMULARIO (IndexedDB)
   Los formularios de limpieza traen fotos en base64 (varios MB), por lo que no caben
   en localStorage. IndexedDB sí los soporta. Si IndexedDB falla (modo privado, etc.)
   las funciones degradan en silencio y simplemente no se guarda borrador. */
var DRAFT_DB="epi_drafts", DRAFT_STORE="drafts";
function _draftDB(){
  return new Promise(function(res,rej){
    try{
      var rq=indexedDB.open(DRAFT_DB,1);
      rq.onupgradeneeded=function(){ try{rq.result.createObjectStore(DRAFT_STORE);}catch(_){} };
      rq.onsuccess=function(){res(rq.result);};
      rq.onerror=function(){rej(rq.error);};
    }catch(e){rej(e);}
  });
}
function draftSave(key,val){
  return _draftDB().then(function(db){return new Promise(function(res,rej){
    var tx=db.transaction(DRAFT_STORE,"readwrite");
    tx.objectStore(DRAFT_STORE).put(val,key);
    tx.oncomplete=function(){res(true);}; tx.onerror=function(){rej(tx.error);};
  });}).catch(function(){});
}
function draftLoad(key){
  return _draftDB().then(function(db){return new Promise(function(res,rej){
    var tx=db.transaction(DRAFT_STORE,"readonly");
    var g=tx.objectStore(DRAFT_STORE).get(key);
    g.onsuccess=function(){res(g.result||null);}; g.onerror=function(){rej(g.error);};
  });}).catch(function(){return null;});
}
function draftDel(key){
  return _draftDB().then(function(db){return new Promise(function(res){
    var tx=db.transaction(DRAFT_STORE,"readwrite");
    tx.objectStore(DRAFT_STORE).delete(key);
    tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);};
  });}).catch(function(){});
}

function ls_loadAll(){
  var keys=Object.keys(localStorage).filter(function(k){return k.startsWith("sam_m:");}).map(function(k){return k.replace("sam_","");});
  var reps=[];
  for(var i=0;i<keys.length;i++){var r=ls_get(keys[i]);if(r)reps.push(r);}
  var cfg={
    vendors: ls_get("c:v")||null,
    props:   ls_get("c:p")||null,
    adminpin:ls_get("c:pin")||null,
    company: ls_get("c:co")||null,
    extcats:   ls_get("c:ec")||null,
    schedules: ls_get("c:sched")||null,
    hospurlday:  ls_get("c:hospday")||null,
    hospurlweek: ls_get("c:hospweek")||null,
    feedback:  ls_get("c:fb")||null,
  };
  return {reports:reps.sort(function(a,b){return (b.createdAt||b.id)-(a.createdAt||a.id);}), ...cfg};
}
function ls_saveReport(rep){ls_set("m:"+rep.id,rep);}
function ls_deleteReport(id){ls_del("m:"+id);}
function ls_saveConfig(key,value){var km={vendors:"c:v",props:"c:p",adminpin:"c:pin",company:"c:co",extcats:"c:ec"};ls_set(km[key]||key,value);}

/* Rescate de arreglos JSON dañados. Si una celda de Config quedó con JSON válido
   seguido de basura (p.ej. una restauración que dejó '...]" por "[...]'), extrae el
   PRIMER arreglo [...] balanceado y lo parsea. Así la app se auto-repara y muestra
   los usuarios reales aunque la celda tenga texto extra pegado al final. */
function salvageArray(v){
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;
  try { var p = JSON.parse(v); if (Array.isArray(p)) return p; } catch(e){}
  var s = v.indexOf("[");
  if (s < 0) return null;
  var depth=0, inStr=false, esc=false;
  for (var i=s; i<v.length; i++) {
    var c = v.charAt(i);
    if (inStr) { if (esc) esc=false; else if (c==="\\") esc=true; else if (c==='"') inStr=false; }
    else if (c==='"') inStr=true;
    else if (c==="[") depth++;
    else if (c==="]") { depth--; if (depth===0) { try { var q=JSON.parse(v.slice(s,i+1)); if (Array.isArray(q)) return q; } catch(e){} return null; } }
  }
  return null;
}

async function loadAllData() {
  if (IS_CLAUDE_SANDBOX) {
    var d = ls_loadAll();
    return {
      reports:   d.reports,
      vendors:   d.vendors   || DEF_V,
      props:     d.props     || DEF_P,
      pin:       d.adminpin  || "spacio2024",
      company:   d.company   || {name:"Spacio AM S.A.",nit:"118287796"},
      extcats:   d.extcats   || [],
      schedules: d.schedules || [],
      feedback:  d.feedback  || [],
      adelantos: adv_load(),
      pagos:     pg_load(),
    };
  }
  /* Carga SECUENCIAL (no Promise.all): el Apps Script ocasionalmente mezcla las
     respuestas cuando getAll y getConfig llegan a la vez, devolviendo getConfig sin
     "vendors". Pedir config primero (crítico para el login) y luego los reportes
     elimina esa condición de carrera. */
  var cfg = await apiCall("getConfig") || {};
  var _v0 = salvageArray(cfg.vendors);
  if (!_v0 || !_v0.length) {
    for (var attempt=0; attempt<2; attempt++) {
      try {
        var retry = await apiCall("getConfig");
        var _vr = retry && salvageArray(retry.vendors);
        if (_vr && _vr.length) { cfg = retry; break; }
      } catch(e){ /* sigue intentando */ }
    }
  }
  var rd = await apiCall("getAll") || {};
  var _vFinal = salvageArray(cfg.vendors);
  var _pFinal = salvageArray(cfg.props);
  return {
    reports: (rd.reports||[]).sort(function(a,b){return (b.createdAt||b.id)-(a.createdAt||a.id);}),
    vendors: (_vFinal && _vFinal.length) ? _vFinal : DEF_V,
    props:   (_pFinal && _pFinal.length) ? _pFinal : DEF_P,
    pin:     cfg.adminpin|| "spacio2024",
    company: cfg.company || {name:"Spacio AM S.A.",nit:"118287796"},
    extcats: cfg.extcats || [],
    adelantos: Array.isArray(cfg.adelantos) ? cfg.adelantos : null,
    pagos: Array.isArray(cfg.pagos) ? cfg.pagos : null,
  };
}

async function uploadMedia(b64, name, mime, subfolder) {
  if (!b64||typeof b64!=="string"||!b64.startsWith("data:")) return b64;
  var r = await apiCall("uploadFile", {b64:b64, name:name, mime:mime, subfolder:subfolder||""});
  return r.url;
}

async function processMedia(rep) {
  var r = Object.assign({}, rep);
  var id = r.id;
  r._upFail = 0;
  /* Subida tolerante: si una foto falla se conserva el base64 para reintentar después,
     en lugar de abortar todo (causa de reportes con fotos en Drive pero 0% en el app). */
  async function safeUp(b64, name, mime, subfolder) {
    try { return await uploadMedia(b64, name, mime, subfolder); }
    catch(e) { r._upFail++; return b64; }
  }

  /* Upload in parallel batches of 3 to reduce total time */
  async function upArr(arr, prefix) {
    if (!arr||!arr.length) return arr||[];
    var out = new Array(arr.length);
    /* Batch size 3 — parallel within batch, sequential across batches */
    for (var i=0;i<arr.length;i+=3) {
      var batch = arr.slice(i,i+3);
      var results = await Promise.all(batch.map(function(f,j){
        return f&&f.startsWith&&f.startsWith("data:")
          ? safeUp(f, prefix+"-"+id+"-"+(i+j)+".jpg","image/jpeg")
          : Promise.resolve(f);
      }));
      for (var j=0;j<results.length;j++) out[i+j]=results[j];
    }
    return out;
  }
  async function upOne(val, name) {
    return val&&val.startsWith&&val.startsWith("data:") ? await safeUp(val, name+"-"+id+".jpg","image/jpeg") : val;
  }

  /* Build safe filename prefix: apt-name + date + category */
  var safeApt  = (rep.propiedad||"sin-apto").replace(/[^a-zA-Z0-9\u00C0-\u017E]/g,"").replace(/\s+/g,"-").slice(0,30);
  var safeDate = (rep.fecha||todayStr()).replace(/-/g,"");
  var safeCat  = (rep.categoria||"trabajo").split(" ")[0].toLowerCase();
  var prefix   = safeApt+"_"+safeDate+"_"+safeCat;

  r.fotoAntes   = r.fotoAntes   ? await Promise.all(r.fotoAntes.map(function(f,i){  return f&&f.startsWith&&f.startsWith("data:")?safeUp(f,prefix+"_antes-"+(i+1)+".jpg","image/jpeg",safeCat):Promise.resolve(f); })) : [];
  r.fotoDespues = r.fotoDespues ? await Promise.all(r.fotoDespues.map(function(f,i){return f&&f.startsWith&&f.startsWith("data:")?safeUp(f,prefix+"_despues-"+(i+1)+".jpg","image/jpeg",safeCat):Promise.resolve(f);})) : [];

  if (r.factura&&r.factura.data&&r.factura.data.startsWith("data:")) {
    var ext = r.factura.type==="application/pdf"?"pdf":"jpg";
    var fu  = await safeUp(r.factura.data,"factura-"+id+"."+ext, r.factura.type);
    r.factura = {name:r.factura.name, type:r.factura.type, data:fu};
  }

  /* Upload single fields in parallel */
  var singleFields = ["fotoUniforme","fotoPisoGeneral","fotosRegadera","fotosDucha","fotosEstufa","fotosFregadero",
    "fotosMicroondas","fotosCafetera","fotosEcofiltro","fotosLavatrastos","fotosRefrigerador",
    "fotosTv","fotosSillon","fotosInsumos","fotosDebajoCama","fotosCloset",
    "fotosMicroondas2","fotosPlatos","fotosDetrasElect"];
  await Promise.all(singleFields.map(async function(sf){
    if(r[sf]&&r[sf].startsWith&&r[sf].startsWith("data:"))
      r[sf] = await upOne(r[sf],sf);
  }));

  /* Upload array fields in parallel */
  var arrFields = ["fotosHabitaciones","fotosDrenajes","fotosVentanas","fotosGavetas","fotosDetalle"];
  await Promise.all(arrFields.map(async function(af){
    if(r[af]) r[af]=await upArr(r[af],af);
  }));

  if (r.fotosBanos&&r.fotosBanos.length) {
    var nb=[];
    for (var bi=0;bi<r.fotosBanos.length;bi++) {
      var bn=Object.assign({},r.fotosBanos[bi]);
      if(bn.ducha&&bn.ducha.startsWith&&bn.ducha.startsWith("data:")) bn.ducha=await safeUp(bn.ducha,"bano-ducha-"+id+"-"+bi+".jpg","image/jpeg");
      if(bn.inodoro&&bn.inodoro.startsWith&&bn.inodoro.startsWith("data:")) bn.inodoro=await safeUp(bn.inodoro,"bano-inodoro-"+id+"-"+bi+".jpg","image/jpeg");
      nb.push(bn);
    }
    r.fotosBanos=nb;
  }

  if (r.inventario&&r.inventario.length) {
    var ni=r.inventario.map(function(item){return Object.assign({},item);});
    for(var ii=0;ii<ni.length;ii++){
      if(ni[ii].foto&&ni[ii].foto.startsWith&&ni[ii].foto.startsWith("data:"))
        ni[ii].foto=await safeUp(ni[ii].foto,"inv-"+id+"-"+ii+".jpg","image/jpeg");
    }
    r.inventario=ni;
  }

  if (r.danios&&r.danios.length) {
    var nd=[];
    for(var di=0;di<r.danios.length;di++){
      var dobj=Object.assign({},r.danios[di]);
      dobj.fotos  = await upArr(dobj.fotos,  "danio-"+di);
      dobj.fotos2 = await upArr(dobj.fotos2, "danio2-"+di);
      nd.push(dobj);
    }
    r.danios=nd;
  }

  return r;
}

async function saveReportFull(rep) {
  if (IS_CLAUDE_SANDBOX) {
    var r = Object.assign({},rep);
    ls_saveReport(r);
    return r;
  }
  /* STEP 1: Save report immediately without photos (fast, ensures record exists) */
  /* Strip ALL base64 photo fields — they're too large for Sheets and will be uploaded in step 2 */
  function stripBase64(v) {
    if(!v) return v;
    if(typeof v==="string"&&v.startsWith("data:")) return null;
    if(Array.isArray(v)) return v.map(function(x){return stripBase64(x);});
    if(typeof v==="object"){var c=Object.assign({},v);Object.keys(c).forEach(function(k){c[k]=stripBase64(c[k]);});return c;}
    return v;
  }
  var photoFields=["fotoAntes","fotoDespues","factura","fotoUniforme","fotoPisoGeneral",
    "fotosHabitaciones","fotosBanos","fotosDrenajes","fotosVentanas","fotosGavetas","fotosDetalle",
    "fotosMicroondas","fotosCafetera","fotosEcofiltro","fotosLavatrastos","fotosRefrigerador",
    "fotosEstufa","fotosTv","fotosSillon","fotosInsumos","fotosDebajoCama","fotosCloset",
    "fotosMicroondas2","fotosPlatos","fotosDetrasElect","fotosRegadera","fotosDucha","fotosFregadero","inventario","danios"];
  var stub = Object.assign({},rep,{_uploading:true});
  photoFields.forEach(function(k){if(stub[k]!==undefined)stub[k]=stripBase64(stub[k]);});
  /* Also clear simple array fields */
  stub.fotoAntes=[]; stub.fotoDespues=[]; stub.factura=null;
  try { await apiCall("saveReport",{data:stub}); } catch(e) { console.error("Stub save failed:",e); throw e; }

  /* STEP 2: Subir fotos y actualizar el reporte.
     RESUMIBLE: las fotos ya subidas (URL) no se vuelven a subir; solo se reintentan
     las que quedaron en base64. NUNCA se sobreescribe el reporte borrando URLs ya
     subidas (causa original de "fotos en Drive pero 0% en el app"). */
  var working = rep;
  for (var attempt=0; attempt<=2; attempt++) {
    working = await processMedia(working); /* tolerante: nunca lanza */
    if (!working._upFail) break;
    await new Promise(function(rs){setTimeout(rs, 2000*(attempt+1));});
  }
  var pendingPhotos = !!working._upFail;
  var final = Object.assign({},working);
  delete final._upFail;
  /* Quitar cualquier base64 restante (muy grande para Sheets) pero CONSERVAR las URLs */
  photoFields.forEach(function(k){ if(final[k]!==undefined) final[k]=stripBase64(final[k]); });
  final._uploading = false;
  final._photoError = pendingPhotos;
  for (var sAt=0; sAt<3; sAt++) {
    try {
      await apiCall("saveReport",{data:final});
      if (pendingPhotos) { try{ rq_add(working); }catch(_){} } /* reintenta solo lo que faltó */
      return final;
    } catch(e) {
      console.error("saveReport (fotos) intento "+(sAt+1)+" falló:", e&&e.message?e.message:String(e));
      if (sAt<2) await new Promise(function(rs){setTimeout(rs, 1500*(sAt+1));});
    }
  }
  /* No se pudieron guardar las URLs — encolar para reintento automático (el stub ya existe) */
  try{ rq_add(working); }catch(_){}
  return final;
}

async function deleteReportById(id) {
  if(IS_CLAUDE_SANDBOX){ls_deleteReport(id);return;}
  await apiCall("deleteReport",{id:id});
}

async function saveConfigItem(key, value) {
  if(IS_CLAUDE_SANDBOX){
    var ls_km={vendors:"c:v",props:"c:p",pin:"c:pin",company:"c:co",extcats:"c:ec"};
    ls_set(ls_km[key]||key,value);
    return;
  }
  var km={vendors:"vendors",props:"props",pin:"adminpin",company:"company",extcats:"extcats"};
  try {
    await apiCall("saveConfig",{key:km[key]||key,value:value});
  } catch(e) {
    console.error("saveConfig failed for key "+key+":", e.message);
    /* Fallback to localStorage so data isn't lost */
    var ls_km2={vendors:"c:v",props:"c:p",pin:"c:pin",company:"c:co",extcats:"c:ec"};
    ls_set(ls_km2[key]||key,value);
  }
}


/* ═══ OFFLINE RETRY QUEUE */
var RETRY_KEY = "sam_retry_q";

function rq_get() { try{return JSON.parse(localStorage.getItem(RETRY_KEY)||"[]");}catch(e){return[];} }
function rq_set(q) { try{localStorage.setItem(RETRY_KEY,JSON.stringify(q));}catch(e){} }
function rq_add(rep) {
  var q=rq_get(); if(q.find(function(x){return x.rep.id===rep.id;})) return;
  q.push({rep:rep,attempts:0,nextTry:Date.now()+30000});
  rq_set(q);
}
function rq_remove(id) { rq_set(rq_get().filter(function(x){return x.rep.id!==id;})); }
function rq_pending() { return rq_get().filter(function(x){return x.attempts>=3;}); }

async function rq_process(onSuccess) {
  var q=rq_get(); if(!q.length) return false;
  var now=Date.now(); var changed=false;
  var delays=[30000,120000,300000];
  for(var i=q.length-1;i>=0;i--) {
    var item=q[i];
    if(item.attempts>=3||now<item.nextTry) continue;
    try {
      var r=await saveReportFull(item.rep);
      q.splice(i,1); changed=true;
      if(onSuccess) onSuccess(r);
    } catch(e) {
      q[i].attempts++;
      q[i].nextTry=now+(delays[Math.min(q[i].attempts-1,2)]);
      changed=true;
    }
  }
  if(changed) rq_set(q);
  return changed;
}


/* ─── Error Boundary — catches any render crash and shows friendly screen */
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = {hasError:false, msg:""}; }
  static getDerivedStateFromError(err) { return {hasError:true, msg:err&&err.message?err.message:String(err)}; }
  componentDidCatch(err, info) { console.error("App crash:", err, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#FAFAFA",gap:20,padding:30,fontFamily:"Montserrat,sans-serif"}}>
          <div style={{fontSize:32}}>⚠</div>
          <div style={{fontSize:18,fontWeight:600,color:"#3E3F3F",textAlign:"center"}}>Algo salió mal</div>
          <div style={{fontSize:12,color:"#938B8A",textAlign:"center",maxWidth:320,lineHeight:1.6}}>{this.state.msg||"Error inesperado al cargar la aplicación."}</div>
          <button onClick={function(){window.location.reload();}} style={{marginTop:8,padding:"12px 28px",borderRadius:8,border:"none",background:"#3E3F3F",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",letterSpacing:".06em"}}>Recargar →</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ═══ DEFAULTS (fallback si Sheets aún no tiene config) */
var DEF_V = [
  {id:"v1",name:"Jorge Mantenimiento",primerNombre:"Jorge",segundoNombre:"",primerApellido:"Mantenimiento",segundoApellido:"",empresa:"",tipo:"interno",categoria:"EPI Mantenimiento",email:"jorge@spacioam.com",password:"jorge123",phone:"",active:true,tarifaLimpieza:75,isAdmin:false},
  {id:"v2",name:"Luis Electricidad",  primerNombre:"Luis", segundoNombre:"",primerApellido:"Electricidad", segundoApellido:"",empresa:"",tipo:"interno",categoria:"EPI Mantenimiento",email:"luis@spacioam.com", password:"luis123", phone:"",active:true,tarifaLimpieza:100,isAdmin:false},
  {id:"v3",name:"María Limpieza",     primerNombre:"María",segundoNombre:"",primerApellido:"Limpieza",     segundoApellido:"",empresa:"",tipo:"interno",categoria:"EPI Limpieza",    email:"maria@spacioam.com",password:"maria123",phone:"",active:true,tarifaLimpieza:75,isAdmin:false},
];
var DEF_P = [
  {id:"p1",name:"Narama – Apto 725",cuartos:1,banos:1},
  {id:"p2",name:"Narama – Apto 801",cuartos:1,banos:1},
  {id:"p3",name:"Narama – Apto 612",cuartos:1,banos:1},
  {id:"p4",name:"Casa San Ignacio – Apto 506",cuartos:2,banos:1},
  {id:"p5",name:"Casa San Ignacio – Apto 312",cuartos:1,banos:1},
  {id:"p6",name:"Edificio Principal – Apto 1508",cuartos:2,banos:2},
  {id:"p7",name:"Edificio Principal – Apto 210",cuartos:1,banos:1},
];

/* ═══ ROOT */
function App() {
  const [sess,     setSess]     = useState(null);
  const [onbDone,  setOnbDone]  = useState(false);
  const [reps,     setReps]     = useState([]);
  const [vendors,  setVendors]  = useState(DEF_V);
  const [props,    setProps]    = useState(DEF_P);
  const [pin,      setPin]      = useState("spacio2024");
  const [company,  setCompany]  = useState({name:"Spacio AM S.A.",nit:"118287796"});
  const [extCats,   setExtCats]   = useState([]);
  const [hospUrlDay,  setHospUrlDay]  = useState("https://share.hospitable.com/metrics/1d1aabad-db5f-4f7a-847d-0de50c9dedc4");
  const [hospUrlWeek, setHospUrlWeek] = useState("https://share.hospitable.com/metrics/c914e6fc-94b9-4c1b-89c6-7722cf2315d6");
  const [schedules, setSchedules] = useState([]);
  const [feedback,  setFeedback]  = useState([]);
  const [ready,    setReady]    = useState(false);
  const [syncing,  setSyncing]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState("");
  const [sheetsOk, setSheetsOk] = useState(null);
  const [retryQ,   setRetryQ]   = useState([]);
  const [adelantos, setAdelantos] = useState([]);
  const [pagos, setPagos] = useState([]);

  /* Adelantos (advances): se cargan vía loadAllData (localStorage en demo, Sheets en vivo)
     y se migran/ligan a su técnico en el .then de carga. */
  async function svAdelantos(v){ setAdelantos(v); adv_persist(v); }
  /* Comprobantes de pago — historial consultable por admin y técnico. */
  async function svPagos(v){ setPagos(v); pg_persist(v); }

  useEffect(function(){
    /* Restore session from localStorage */
    try {
      var saved = localStorage.getItem("sam_sess");
      if (saved) {
        var ps = JSON.parse(saved);
        /* Only restore if session has a valid role */
        if (ps && (ps.role==="admin"||ps.role==="vendor")) setSess(ps);
        else localStorage.removeItem("sam_sess");
      }
    } catch(e){ try{localStorage.removeItem("sam_sess");}catch(_){} }
    try { setRetryQ(rq_pending()); } catch(e){}

    setSyncing(true); setSyncMsg("Conectando…");

    /* Hard timeout: 15s — show app no matter what (carga secuencial + cold start) */
    var timeoutId = setTimeout(function(){
      console.warn("Sheets timeout — loading with localStorage fallback");
      VENDORS_SAFE = false;
      try {
        var fb = ls_loadAll();
        if(fb.vendors&&fb.vendors.length) setVendors(fb.vendors);
        if(fb.props&&fb.props.length)     setProps(fb.props);
        if(fb.reports)                    setReps(withAutoPagador(fb.reports));
        if(fb.adminpin)                   setPin(fb.adminpin);
      } catch(lsErr){ console.error("localStorage fallback failed:", lsErr); }
      setSheetsOk(false); setReady(true); setSyncing(false);
    }, 15000);

    loadAllData().then(function(d){
      clearTimeout(timeoutId);
      setReps(withAutoPagador(d.reports||[]));
      setVendors(d.vendors||DEF_V);
      /* Conexión exitosa → permitir guardar usuarios. (Estando sin conexión el candado
         queda en false y svV no guarda, para no borrar la lista real del Sheet.) */
      VENDORS_SAFE = true;
      setProps(d.props||DEF_P);
      setPin(d.pin||"spacio2024");
      setCompany(d.company||{name:"Spacio AM S.A.",nit:"118287796"});
      if(d.extcats)   setExtCats(d.extcats);
      if(d.schedules) setSchedules(d.schedules);
      if(d.hospurlday)  setHospUrlDay(d.hospurlday||"");
      if(d.hospurlweek) setHospUrlWeek(d.hospurlweek||"");
      if(d.feedback)  setFeedback(d.feedback);
      /* Adelantos: tomar de la fuente (Sheets/local) o sembrar; luego ligar a técnicos. */
      var advRaw=(d.adelantos && d.adelantos.length)?d.adelantos:adv_seed();
      var mig=adv_migrate(advRaw, d.vendors||DEF_V);
      setAdelantos(mig.list);
      if(mig.changed || !(d.adelantos && d.adelantos.length)) { try{ adv_persist(mig.list); }catch(_){} }
      setPagos((d.pagos && d.pagos.length) ? d.pagos : []);
      setSheetsOk(!IS_CLAUDE_SANDBOX);
      setReady(true); setSyncing(false);
    }).catch(function(e){
      clearTimeout(timeoutId);
      console.error("Load failed:",e);
      VENDORS_SAFE = false;
      try {
        var fb = ls_loadAll();
        if(fb.vendors) setVendors(fb.vendors);
        if(fb.props)   setProps(fb.props);
        if(fb.reports) setReps(withAutoPagador(fb.reports));
      } catch(_){}
      setSheetsOk(false); setReady(true); setSyncing(false);
    });

    /* Retry queue — every 45s */
    var retryInterval = setInterval(function(){
      rq_process(function(r){
        setReps(function(prev){
          var i=prev.findIndex(function(x){return x.id===r.id;});
          if(i>=0){var n=[...prev];n[i]=r;return n;}
          return [r,...prev];
        });
      }).then(function(ch){if(ch)setRetryQ(rq_pending());}).catch(function(){});
    }, 45000);

    /* Recuperación automática de fotos — cada 10 min, solo si hay reportes con fotos pendientes */
    var recInterval = setInterval(function(){
      if(!IS_CLAUDE_SANDBOX && (window.__photoErrCount||0)>0 && document.visibilityState==="visible"){
        apiCall("recoverPhotos",{}).catch(function(){});
      }
    }, 600000);

    return function(){ clearTimeout(timeoutId); clearInterval(retryInterval); clearInterval(recInterval); };
  },[]);

  /* Contador de reportes con fotos pendientes (para la recuperación automática) */
  useEffect(function(){
    window.__photoErrCount = (reps||[]).filter(function(r){return r._photoError;}).length;
  },[reps]);

  /* Mantener ADV_VENDORS sincronizado: el cálculo de adelantos debe reconocer todos
     los correos de cada técnico (incluye los anteriores tras un cambio de correo). */
  useEffect(function(){ ADV_VENDORS = vendors || []; },[vendors]);

  /* Unificación automática (una sola vez tras la carga): si un técnico tiene ≥2 adelantos
     ACTIVOS, se combinan en uno solo con saldo y control unificados. */
  var unifiedOnce = useRef(false);
  useEffect(function(){
    if(unifiedOnce.current) return;
    if(!adelantos || !adelantos.length || !reps) return;
    var r=autoUnify(adelantos, reps);
    unifiedOnce.current=true;
    if(r.changed) svAdelantos(r.list);
  },[adelantos, reps]);

  async function upsert(r) {
    /* Vincular el reporte a su técnico por id — robusto ante futuros cambios de correo */
    try {
      if (r && !r.vendorId && r.reportadoPor) {
        var _rp=(r.reportadoPor||"").toLowerCase().trim();
        var rv=vendors.find(function(v){return vendorEmailSet(v).indexOf(_rp)>=0;});
        if (rv) r=Object.assign({},r,{vendorId:rv.id});
      }
    } catch(_){}
    setSyncing(true); setSyncMsg("Subiendo a Google Drive…");
    try {
      var processed = await saveReportFull(r);
      setReps(function(prev){
        var i=prev.findIndex(function(x){return x.id===r.id;});
        if(i>=0){var n=[...prev];n[i]=processed;return n;}
        return [processed,...prev];
      });
      /* Recuperación automática: 3 min después de subir, re-vincular desde Drive lo que falte */
      if(!IS_CLAUDE_SANDBOX && processed && processed._photoError){
        setTimeout(function(){
          apiCall("recoverPhotos",{}).then(function(){ refresh(); }).catch(function(){});
        }, 180000);
      }
    } catch(e) {
      console.error("Upsert failed, adding to retry queue:", e);
      rq_add(r);
      /* Still show locally so the user sees it */
      setReps(function(prev){
        var i=prev.findIndex(function(x){return x.id===r.id;});
        if(i>=0){var n=[...prev];n[i]=r;return n;}
        return [r,...prev];
      });
      setRetryQ(rq_pending());
    } finally { setSyncing(false); setSyncMsg(""); }
  }
  async function del(id) {
    await deleteReportById(id);
    setReps(function(p){return p.filter(function(r){return r.id!==id;});});
  }
  async function svV(v) {
    /* Candado anti-borrado: nunca sobrescribir usuarios si no cargamos la lista real
       desde Sheets. Así un cambio hecho sin conexión (mostrando los 3 de respaldo) no
       puede borrar a todos los técnicos del Sheet. */
    if (!VENDORS_SAFE) {
      try { alert("⚠ No se guardaron los cambios de usuarios.\n\nLa app todavía no cargó la lista real de usuarios desde Google Sheets (puede estar sin conexión o cargando). Para proteger tus técnicos de borrarse, no se guarda nada hasta que la conexión muestre “● SHEETS” en verde.\n\nRecarga la página hasta ver “● SHEETS” y vuelve a intentar."); } catch(_){}
      return;
    }
    setVendors(v); saveConfigItem("vendors",v);
  }
  async function svP(v) { setProps(v);   saveConfigItem("props",v); }
  async function svPin(v) { setPin(v);     saveConfigItem("pin",v); }
  async function svCo(v)  { setCompany(v); saveConfigItem("company",v); }
  async function svExtCats(v)   { setExtCats(v);   saveConfigItem("extcats",v); }
  async function svSchedules(v) { setSchedules(v); saveConfigItem("schedules",v); }
  async function svHospUrlDay(v)  { setHospUrlDay(v);  saveConfigItem("hospurlday",v); }
  /* Preset Hospitable URLs already configured */
  async function svHospUrlWeek(v) { setHospUrlWeek(v); saveConfigItem("hospurlweek",v); }
  async function svFeedback(v)  { setFeedback(v);  saveConfigItem("feedback",v); }

  async function refresh() {
    setSyncing(true); setSyncMsg("Actualizando…");
    try {
      var d = await loadAllData();
      setReps(withAutoPagador(d.reports));
      setVendors(d.vendors);
      VENDORS_SAFE = true;
      setProps(d.props);
      setPin(d.pin);
      setCompany(d.company);
      if(d.extcats)   setExtCats(d.extcats);
      if(d.schedules) setSchedules(d.schedules);
      if(d.hospurlday)  setHospUrlDay(d.hospurlday||"");
      if(d.hospurlweek) setHospUrlWeek(d.hospurlweek||"");
      if(d.feedback)  setFeedback(d.feedback);
      setSheetsOk(true);
    } catch(e) { setSheetsOk(false); }
    finally { setSyncing(false); setSyncMsg(""); }
  }
  function login(s) {
    try { localStorage.setItem("sam_sess",JSON.stringify(s)); } catch(e){}
    setSess(s);
  }
  function logout() {
    try { localStorage.removeItem("sam_sess"); } catch(e){}
    setSess(null);
  }

  var inner;
  if (!ready) {
    inner = <Loader/>;
  } else if (!sess) {
    inner = <Login vendors={vendors} adminPin={pin} onLogin={login} sheetsOk={sheetsOk}/>;
  } else if (sess.role==="vendor"&&sess.vendor) {
    /* Resolver el vendor FRESCO desde config (la sesión guarda un snapshot; así los permisos
       de supervisión asignados después del login aplican sin re-loguear) */
    var freshV = vendors.find(function(x){return x.id===sess.vendor.id;}) || vendors.find(function(x){return x.email===sess.vendor.email;}) || sess.vendor;
    var needsOnb = isEpiLimpieza(freshV) && !freshV.notifSetupDone && !onbDone;
    try{ if(localStorage.getItem("epi_onboard_done_"+freshV.id)) needsOnb=false; }catch(_){}
    inner = (<><VendorApp vendor={freshV} allVendors={vendors} allReps={reps} reps={reps.filter(function(r){return repMatchesVendor(r,freshV);})} props={props} company={company} schedules={schedules} hospUrlDay={hospUrlDay} hospUrlWeek={hospUrlWeek} adelantos={adelantos} onSvAdelantos={svAdelantos} pagos={pagos} onSvPagos={svPagos} onSubmit={upsert} onUpdate={upsert} onSvV={svV} onSvFeedback={function(fb){ svFeedback((feedback||[]).concat([fb])); }} onLogout={logout}/>{needsOnb&&<OnboardModal vendor={freshV} allVendors={vendors} onSvV={svV} onClose={function(){setOnbDone(true);}}/>}</>);
  } else {
    inner = <AdminApp reps={reps} vendors={vendors} props={props} adminPin={pin} company={company} extCats={extCats} schedules={schedules} hospUrlDay={hospUrlDay} hospUrlWeek={hospUrlWeek} feedback={feedback} adelantos={adelantos} onSvAdelantos={svAdelantos} pagos={pagos} onSvPagos={svPagos} syncing={syncing} syncMsg={syncMsg} sheetsOk={sheetsOk} retryQ={retryQ} setRetryQ={setRetryQ} setReps={setReps} adminVendor={sess&&sess.vendor?sess.vendor:null} onUpsert={upsert} onDelete={del} onSvV={svV} onSvP={svP} onSvPin={svPin} onSvCo={svCo} onSvExtCats={svExtCats} onSvSchedules={svSchedules} onSvHospUrlDay={svHospUrlDay} onSvHospUrlWeek={svHospUrlWeek} onSvFeedback={svFeedback} onRefresh={refresh} onLogout={logout}/>;
  }
  return <ErrorBoundary>{inner}</ErrorBoundary>;
}

/* ═══ LOGIN */
function LoginField({label,type,value,onChange,ph,err,onEnter,autoFocus}) {
  const [show,setShow]=useState(false);
  var isPass=type==="password";
  return (
    <label style={{display:"flex",flexDirection:"column",gap:9}}>
      <span style={{fontSize:10,fontWeight:600,letterSpacing:".26em",textTransform:"uppercase",color:C.earth}}>{label}</span>
      <div style={{position:"relative",display:"flex",alignItems:"center"}}>
        <input value={value} onChange={function(e){onChange(e.target.value);}} placeholder={ph} type={isPass&&!show?"password":(isPass?"text":type)} autoCapitalize="none" autoCorrect="off" autoFocus={autoFocus} onKeyDown={function(e){if(e.key==="Enter"&&onEnter)onEnter();}}
          style={{width:"100%",boxSizing:"border-box",fontFamily:"Montserrat,sans-serif",fontSize:15,letterSpacing:".04em",color:C.black,padding:"15px 16px",paddingRight:isPass?52:16,background:C.alabaster,border:"1px solid "+(err?C.peach:C.gray),borderRadius:14,outline:"none",transition:"border-color .18s"}}
          onFocus={function(e){e.target.style.borderColor=C.black;}} onBlur={function(e){e.target.style.borderColor=err?C.peach:C.gray;}}/>
        {isPass&&<button type="button" onClick={function(){setShow(function(s){return !s;});}} aria-label={show?"Ocultar contraseña":"Ver contraseña"} style={{position:"absolute",right:12,border:"none",background:"transparent",cursor:"pointer",color:C.earth,padding:4,display:"flex"}}><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={show?"M3 3l18 18M10.6 10.7a3 3 0 004.2 4.2M9.4 5.7A9.5 9.5 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-2.6 3.3M6.2 6.3A16 16 0 002.5 12S6 18.5 12 18.5a9 9 0 003.6-.7":"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 100-6 3 3 0 000 6z"}></path></svg></button>}
      </div>
    </label>
  );
}
function LoginBtn({onClick,dis,children}) {
  return <button onClick={onClick} disabled={dis} style={{marginTop:6,width:"100%",border:"none",cursor:dis?"default":"pointer",background:dis?C.gray:C.black,color:C.alabaster,borderRadius:14,padding:"16px",fontFamily:"Montserrat,sans-serif",fontSize:11.5,fontWeight:600,letterSpacing:".24em",textTransform:"uppercase",opacity:dis?.6:1,transition:"opacity .18s",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}><svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 11V8a5 5 0 0110 0v3M5.5 11h13a1 1 0 011 1v8a1 1 0 01-1 1h-13a1 1 0 01-1-1v-8a1 1 0 011-1z"></path></svg>{children}</button>;
}
/* ═══ ONBOARDING — primer ingreso EPI Limpieza interno: define correo de notificaciones + nueva contraseña */
function OnboardModal({vendor, allVendors, onSvV, onClose}) {
  const [step,  setStep]  = useState(0);
  const [email, setEmail] = useState(vendor.email||"");
  const [pass,  setPass]  = useState("");
  const [pass2, setPass2] = useState("");
  const [err,   setErr]   = useState("");

  function goEmail(){
    var e=(email||"").trim().toLowerCase();
    if(!e||e.indexOf("@")<1||e.indexOf(".")<0){ setErr("Escribe un correo electrónico válido."); return; }
    var conflict=(allVendors||[]).find(function(v){return v.id!==vendor.id&&(v.email||"").toLowerCase()===e;});
    if(conflict){ setErr("Ese correo ya está en uso por otro usuario."); return; }
    setErr(""); setStep(1);
  }
  function goPass(){
    if((pass||"").length<4){ setErr("La contraseña debe tener al menos 4 caracteres."); return; }
    if(pass!==pass2){ setErr("Las contraseñas no coinciden."); return; }
    setErr(""); setStep(2);
  }
  function commit(){
    var e=(email||"").trim();
    var updated=(allVendors||[]).map(function(v){
      if(v.id!==vendor.id) return v;
      /* Conservar correos anteriores para no perder el historial de reportes */
      var prev=(v.prevEmails||[]).slice();
      [v.email,v.notifEmail].forEach(function(old){ if(old&&String(old).toLowerCase().trim()!==e.toLowerCase()&&prev.indexOf(old)<0) prev.push(old); });
      return Object.assign({},v,{email:e,notifEmail:e,password:pass,notifSetupDone:true,prevEmails:prev});
    });
    try{ onSvV(updated); }catch(_){}
    vendor.email=e; vendor.notifEmail=e; vendor.password=pass; vendor.notifSetupDone=true;
    try{ localStorage.setItem("epi_onboard_done_"+vendor.id,"1"); }catch(_){}
    onClose();
  }

  var card={width:"100%",maxWidth:430,background:"#fff",borderRadius:22,padding:"32px 28px",boxShadow:"0 28px 80px rgba(62,63,63,.22)",maxHeight:"92vh",overflowY:"auto"};
  var primaryBtn={width:"100%",border:"none",cursor:"pointer",background:C.black,color:C.alabaster,borderRadius:13,padding:"15px",fontFamily:"Montserrat,sans-serif",fontSize:11.5,fontWeight:600,letterSpacing:".18em",textTransform:"uppercase"};
  var ghostBtn={width:"100%",border:"1.5px solid "+C.gray,cursor:"pointer",background:"#fff",color:C.earth,borderRadius:13,padding:"13px",fontSize:13,fontWeight:600};
  var titleStyle={fontFamily:"'Valky','Cormorant Garamond',serif",fontWeight:400,fontSize:25,lineHeight:1.18,color:C.black,margin:"0 0 8px"};

  return (
    <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(62,63,63,.55)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:18,fontFamily:"Montserrat,sans-serif"}}>
      <div style={card}>
        <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:18}}>
          <svg viewBox="0 0 100 100" width={18} height={18} fill={C.peach} aria-hidden="true"><path d="M50 4 C 52 32, 58 42, 96 50 C 58 58, 52 68, 50 96 C 48 68, 42 58, 4 50 C 42 42, 48 32, 50 4 Z"></path></svg>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:".24em",textTransform:"uppercase",color:C.earth}}>Configura tu cuenta</span>
        </div>

        {step===0&&(
          <>
            <h2 style={titleStyle}>¿A qué correo electrónico podemos enviarte las notificaciones?</h2>
            <p style={{fontSize:13,lineHeight:1.6,color:C.earth,margin:"0 0 22px"}}>Este será también el correo con el que iniciarás sesión de ahora en adelante.</p>
            <F label="Correo electrónico"><input type="email" value={email} placeholder="tu@correo.com" onChange={function(e){setEmail(e.target.value);setErr("");}}/></F>
            {err&&<div style={{fontSize:12,color:C.peach,fontWeight:600,margin:"10px 0 0"}}>⚠ {err}</div>}
            <div style={{marginTop:22}}><button onClick={goEmail} style={primaryBtn}>Continuar</button></div>
          </>
        )}

        {step===1&&(
          <>
            <h2 style={titleStyle}>Escoge una nueva contraseña</h2>
            <p style={{fontSize:13,lineHeight:1.6,color:C.earth,margin:"0 0 22px"}}>Mínimo 4 caracteres. La usarás junto con tu correo para entrar.</p>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <F label="Nueva contraseña"><input type="password" value={pass} placeholder="••••••••" onChange={function(e){setPass(e.target.value);setErr("");}}/></F>
              <F label="Confirma la contraseña"><input type="password" value={pass2} placeholder="••••••••" onChange={function(e){setPass2(e.target.value);setErr("");}}/></F>
            </div>
            {err&&<div style={{fontSize:12,color:C.peach,fontWeight:600,margin:"10px 0 0"}}>⚠ {err}</div>}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:22}}>
              <button onClick={goPass} style={primaryBtn}>Continuar</button>
              <button onClick={function(){setErr("");setStep(0);}} style={ghostBtn}>← Atrás</button>
            </div>
          </>
        )}

        {step===2&&(
          <>
            <h2 style={titleStyle}>Confirma tus datos</h2>
            <p style={{fontSize:13,lineHeight:1.6,color:C.earth,margin:"0 0 18px"}}>De ahora en adelante, para iniciar sesión usa estos datos. Guárdalos bien.</p>
            <div style={{background:C.surfaceWarm,borderRadius:14,padding:"16px 18px",border:"1px solid "+C.line,display:"flex",flexDirection:"column",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:4}}>Correo electrónico</div>
                <div style={{fontSize:15,fontWeight:600,color:C.black,wordBreak:"break-all"}}>{(email||"").trim()}</div>
              </div>
              <div style={{height:1,background:C.line}}></div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:4}}>Contraseña</div>
                <div style={{fontSize:15,fontWeight:600,color:C.black,fontFamily:"monospace",letterSpacing:".05em"}}>{pass}</div>
              </div>
            </div>
            <div style={{fontSize:11.5,color:C.taupe,lineHeight:1.6,marginBottom:18}}>¿Te equivocaste? Presiona “Regresar y corregir”.</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button onClick={commit} style={primaryBtn}>Continuar</button>
              <button onClick={function(){setStep(0);}} style={ghostBtn}>← Regresar y corregir</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Login({vendors, adminPin, onLogin, sheetsOk}) {
  const [email,    setEmail]    = useState("");
  const [pass,     setPass]     = useState("");
  const [err,      setErr]      = useState("");
  const [adminPin2,setAdminPin2]= useState("");
  const [adminErr, setAdminErr] = useState("");
  const [showAdmin,setShowAdmin]= useState(false);

  function loginUser() {
    var input = email.toLowerCase().trim();
    var v = vendors.find(function(x){
      var em = x.email.toLowerCase();
      var user = em.split("@")[0];
      return (em===input||user===input) && x.password===pass && x.active;
    });
    if (v) onLogin({role:v.isAdmin?"admin":"vendor",vendor:v});
    else setErr("Correo o contraseña incorrectos.");
  }
  function loginAdmin() {
    if(adminPin2===adminPin) onLogin({role:"admin"});
    else setAdminErr("Contraseña incorrecta.");
  }

  return (
    <div className="epi-login" style={{minHeight:"100dvh",background:C.alabaster,display:"grid",gridTemplateColumns:"1fr",fontFamily:"Montserrat,sans-serif"}}>
      <GS/>
      <style>{"@media(min-width:880px){.epi-login{grid-template-columns:1.05fr 1fr!important}.epi-login-aside{display:flex!important}}"}</style>

      {/* Sheets badge + hidden admin gear — top right, fixed */}
      <div style={{position:"fixed",top:14,right:14,display:"flex",alignItems:"center",gap:8,zIndex:200}}>
        {sheetsOk===false&&<div style={{fontSize:10,fontWeight:700,background:"#F5EDEC",color:"#8a3030",padding:"4px 10px",borderRadius:6,border:"1px solid #DBC8C4",letterSpacing:".06em"}}>⚠ Sin Sheets</div>}
        {sheetsOk===true&&<div style={{fontSize:10,fontWeight:700,background:"#EDF5EF",color:"#3d6b52",padding:"4px 10px",borderRadius:6,letterSpacing:".06em"}}>● Sheets OK</div>}
        <button onClick={function(){setShowAdmin(function(p){return !p;});setAdminErr("");setAdminPin2("");setErr("");}} title="Acceso administrador" style={{background:"none",border:"none",cursor:"pointer",padding:"4px",color:C.gray,fontSize:15,lineHeight:1,opacity:.45}}>⚙</button>
      </div>

      {/* Brand aside — editorial */}
      <aside className="epi-login-aside" style={{display:"none",position:"relative",overflow:"hidden",background:C.surfaceWarm,flexDirection:"column",justifyContent:"space-between",padding:"56px 56px 48px"}}>
        <img src={BRUSHSTROKE} alt="" aria-hidden="true" style={{position:"absolute",top:"18%",left:"-20%",width:"150%",opacity:.55,pointerEvents:"none",transform:"rotate(-4deg)"}}/>
        <div style={{position:"relative",zIndex:2}}><img src={LOGO_BADGE} alt="Spacio AM" style={{height:62,width:"auto",display:"block"}}/></div>
        <div style={{position:"relative",zIndex:2,maxWidth:460}}>
          <svg viewBox="0 0 100 100" width={22} height={22} fill={C.peach} aria-hidden="true" style={{display:"block"}}><path d="M50 4 C 52 32, 58 42, 96 50 C 58 58, 52 68, 50 96 C 48 68, 42 58, 4 50 C 42 42, 48 32, 50 4 Z"></path></svg>
          <p style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontWeight:300,fontStyle:"italic",fontSize:"clamp(26px,3vw,40px)",lineHeight:1.18,color:C.black,margin:"20px 0 0",textWrap:"balance"}}>“Hay espacios en donde sueñas con volver a despertar.”</p>
          <div style={{width:38,height:1,background:C.black,margin:"26px 0 14px"}}/>
          <div style={{fontSize:10.5,letterSpacing:".24em",textTransform:"uppercase",color:C.earth,fontWeight:600}}>Spacio AM · Equipo de primera impresión</div>
        </div>
        <div style={{position:"relative",zIndex:2,fontSize:10.5,letterSpacing:".18em",textTransform:"uppercase",color:C.earth}}>Guatemala · ¿Necesitas ayuda? hola@spacioam.com</div>
      </aside>

      {/* Form side */}
      <main style={{display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:"48px 24px"}}>
        <div style={{width:"100%",maxWidth:380}}>
          <div style={{marginBottom:28}}><LogoWordmark width={172}/></div>
          {!showAdmin?(
            <>
              <div style={{fontSize:10,fontWeight:600,letterSpacing:".28em",textTransform:"uppercase",color:C.earth,marginBottom:14}}>Equipo de primera impresión — EPI</div>
              <h1 style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontWeight:400,fontSize:36,letterSpacing:"-.01em",lineHeight:1.1,color:C.black,margin:0}}>Bienvenido(a) de Vuelta</h1>
              <p style={{fontSize:13,letterSpacing:".03em",lineHeight:1.7,color:C.earth,margin:"12px 0 28px"}}>Ingresa con tu correo para registrar y dar seguimiento a tus trabajos.</p>
              <div style={{display:"flex",flexDirection:"column",gap:18}}>
                <LoginField label="Correo electrónico" type="email" value={email} onChange={function(v){setEmail(v);setErr("");}} ph="tu@correo.com" err={!!err} onEnter={loginUser} autoFocus/>
                <LoginField label="Contraseña" type="password" value={pass} onChange={function(v){setPass(v);setErr("");}} ph="••••••••" err={!!err} onEnter={loginUser}/>
                {err&&<div style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:C.peach,marginTop:-4}}>⚠ {err}</div>}
                <LoginBtn onClick={loginUser} dis={!email||!pass}>Ingresar</LoginBtn>
              </div>
            </>
          ):(
            <>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:".26em",textTransform:"uppercase",color:C.peach,marginBottom:14}}>Acceso administrador</div>
              <h1 style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontWeight:400,fontSize:34,letterSpacing:"-.01em",lineHeight:1.1,color:C.black,margin:0}}>Panel de administración</h1>
              <p style={{fontSize:13,letterSpacing:".03em",lineHeight:1.7,color:C.earth,margin:"12px 0 28px"}}>Ingresa la contraseña de administrador para acceder al panel completo.</p>
              <div style={{display:"flex",flexDirection:"column",gap:18}}>
                <LoginField label="Contraseña de administrador" type="password" value={adminPin2} onChange={function(v){setAdminPin2(v);setAdminErr("");}} ph="••••••••" err={!!adminErr} onEnter={loginAdmin} autoFocus/>
                {adminErr&&<div style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:C.peach,marginTop:-4}}>⚠ {adminErr}</div>}
                <LoginBtn onClick={loginAdmin} dis={!adminPin2}>Ingresar como admin</LoginBtn>
                <button onClick={function(){setShowAdmin(false);setAdminErr("");}} style={{background:"none",border:"none",color:C.earth,fontSize:12,cursor:"pointer",letterSpacing:".04em"}}>← Volver al ingreso normal</button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ═══ ADMIN */
function AdminApp({reps,vendors,props,adminPin,company,extCats,schedules,hospUrlDay,hospUrlWeek,feedback,adelantos,onSvAdelantos,pagos,onSvPagos,syncing,syncMsg,sheetsOk,retryQ,setRetryQ,setReps,adminVendor,onUpsert,onDelete,onSvV,onSvP,onSvPin,onSvCo,onSvExtCats,onSvSchedules,onSvHospUrlDay,onSvHospUrlWeek,onSvFeedback,onRefresh,onLogout}) {
  const [tab,    setTab]    = useState("dash");
  const [detail, setDetail] = useState(null);
  const [cDel,   setCDel]   = useState(null);
  const [pagoDetail, setPagoDetail] = useState(null);

  var adminName = adminVendor ? vendorDisplay(adminVendor) : "Admin";
  /* Registra un comprobante nuevo en el historial y lo abre. */
  function pushComprobante(pago){
    var next=[pago].concat(pagos||[]);
    if(onSvPagos) onSvPagos(next);
    setPagoDetail(pago);
  }
  /* Pago en LOTE: marca todos como pagados y genera UN comprobante con todos los técnicos. */
  function markPaidBatch(repsToMark, meta){
    meta=meta||{};
    var updated=(repsToMark||[]).map(function(r){
      var at=autoTarifa(r.reportadoPor||"",vendors);
      return Object.assign({},r,{paid:true,total:r.total||at.tarifa});
    });
    updated.forEach(function(r){ onUpsert(r); });
    if(!updated.length) return;
    var afterReps=reps.map(function(r){ var u=updated.find(function(x){return x.id===r.id;}); return u||r; });
    var pago=buildComprobante(updated,{vendors:vendors,adelantos:adelantos,allReps:afterReps,applyAdelanto:true,tipo:"lote",generadoPor:adminName,folio:pgFolio(pagos),rangoDesde:meta.rangoDesde||"",rangoHasta:meta.rangoHasta||""});
    pushComprobante(pago);
  }

  function markPaid(idOrRep,p) {
    /* markPaid(id, bool) — toggle paid    |    markPaid(repObj) — update any field */
    var prev=reps.find(function(x){return x.id===(typeof idOrRep==="object"?idOrRep.id:idOrRep);});
    var base;
    if (typeof idOrRep==="object") { base=Object.assign({},reps.find(function(x){return x.id===idOrRep.id;})||{},idOrRep); }
    else { base=Object.assign({},reps.find(function(x){return x.id===idOrRep;})||{},{paid:p}); }
    onUpsert(base);
    /* Transición a "pagado" de un solo trabajo → comprobante individual. */
    try {
      var wasPaid = prev && prev.paid;
      if (!wasPaid && base.paid && isPayable(base, vendors)) {
        var afterReps=reps.map(function(x){return x.id===base.id?base:x;});
        var pago=buildComprobante([base],{vendors:vendors,adelantos:adelantos,allReps:afterReps,applyAdelanto:false,tipo:"individual",generadoPor:adminName,folio:pgFolio(pagos),rangoDesde:base.fecha,rangoHasta:base.fecha});
        pushComprobante(pago);
      }
    } catch(_){}
  }
  function qaUpdate(id,status,comment,tipo) {
    var r=reps.find(function(x){return x.id===id;}); if(!r) return;
    var upd=Object.assign({},r,{qaStatus:status,qaComentario:comment||"",qaFecha:todayStr(),qaTipo:status==="correccion"?(tipo||"inmediata"):r.qaTipo});
    onUpsert(upd);
    /* Solo refrescar el modal si ya estaba abierto con este reporte (no abrirlo) */
    setDetail(function(d){return d&&d.id===id?upd:d;});
    /* Notificar al técnico (aprobada / corrección) */
    try{ notifyQAResult(upd,status,comment,vendors); }catch(_){}
  }
  var alerts    = reps.filter(function(r){return !!alertLvl(r);});
  var pendingQA = reps.filter(function(r){return isCleaning(r.categoria)&&r.qaStatus==="pendiente";}).length;
  /* Extraer daños embebidos en un reporte de limpieza → reporte de daños independiente */
  function extractDanios(r) {
    var nid=Date.now();
    var dmgDesc=(r.danios||[]).map(function(d,i){return "Daño "+(i+1)+": "+(d.desc||"");}).join(" | ");
    var dmg={id:nid,createdAt:nid,categoria:"Reporte de Daños",propiedad:r.propiedad,fecha:r.fecha,reportadoPor:r.reportadoPor,
      descripcion:dmgDesc||"Daños encontrados durante limpieza",
      comentarios:"Extraído del reporte de limpieza #"+r.id,
      total:"",paid:false,pagadoPor:"",fotoAntes:[],fotoDespues:[],factura:null,
      danios:(r.danios||[]).map(function(d){return Object.assign({},d);}),hayDanios:true,_linkedToReport:String(r.id)};
    onUpsert(dmg);
    setDetail(dmg);
  }

  return (
    <div style={{background:C.alabaster,minHeight:"100vh",fontFamily:"Montserrat,sans-serif"}}>
      <GS/>
      {syncing&&<SyncBanner msg={syncMsg}/>}
      {sheetsOk===false&&(
        <div style={{background:"#F5EDEC",borderBottom:"1px solid #DBC8C4",padding:"10px 20px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:700,color:C.red}}>⚠ Sin conexión a Google Sheets</span>
          <span style={{fontSize:12,color:C.earth}}>Los datos se guardan localmente. Se reintentará automáticamente.</span>
        </div>
      )}
      {retryQ&&retryQ.length>0&&<RetryBanner retryQ={retryQ} setRetryQ={setRetryQ} reps={reps} setReps={setReps} onSyncing={function(b,m){}}/>}
      <ResponsiveHeader
        tab={tab} setTab={setTab}
        alertCount={alerts.length} pendingQA={pendingQA} sheetsOk={sheetsOk} adminLabel={adminVendor?vendorDisplay(adminVendor):"Admin"}
        navItems={[["dash","Dashboard","dash"],["form","Formulario","edit"],["sched","Programa","calendar"],["qa","Calidad","star"],["adv","Adelantos","coins"],["cfg","Config","settings"]]}
        onLogout={onLogout}
        role="Admin"
      />

      <div style={{display:tab==="dash"?"block":"none"}}><DashView reps={reps} vendors={vendors} alerts={alerts} adelantos={adelantos} pagos={pagos} onSvPagos={onSvPagos} company={company} onMarkPaidBatch={markPaidBatch} onSelect={setDetail} onMarkPaid={markPaid} onRefresh={onRefresh}/></div>
      <div style={{display:tab==="form"?"block":"none"}}><RepForm  vendors={vendors} props={props} company={company} defaultVendor={adminVendor?adminVendor.email:""} onSubmit={function(r){onUpsert(r);setTab("dash");}}/></div>
      <div style={{display:tab==="sched"?"block":"none"}}>
        <ScheduleCfg schedules={schedules||[]} vendors={vendors||[]} props={props||[]} hospUrlDay={hospUrlDay||""} hospUrlWeek={hospUrlWeek||""} onSave={onSvSchedules} onSaveHospUrlDay={onSvHospUrlDay} onSaveHospUrlWeek={onSvHospUrlWeek}/>
        {/* Hospitable iframes — reference view for admin */}
        {(hospUrlDay||hospUrlWeek)&&(
          <div style={{padding:"0 16px 60px",fontFamily:"Montserrat,sans-serif",maxWidth:700,margin:"0 auto"}}>
            {hospUrlDay&&(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:9.5,fontWeight:700,color:"#938B8A",letterSpacing:".18em",textTransform:"uppercase",marginBottom:8}}>Programa de hoy (Hospitable)</div>
                <div style={{borderRadius:10,overflow:"hidden",border:"1px solid #D8D4CE"}}>
                  <iframe src={hospUrlDay} title="Hoy" style={{width:"100%",height:420,border:"none",display:"block"}} sandbox="allow-scripts allow-same-origin allow-popups allow-forms"/>
                </div>
                <a href={hospUrlDay} target="_blank" rel="noopener noreferrer" style={{display:"block",textAlign:"center",marginTop:8,fontSize:11.5,color:"#938B8A",textDecoration:"none"}}>↗ Abrir en pantalla completa</a>
              </div>
            )}
            {hospUrlWeek&&(
              <div>
                <div style={{fontSize:9.5,fontWeight:700,color:"#938B8A",letterSpacing:".18em",textTransform:"uppercase",marginBottom:8}}>Programa semanal (Hospitable)</div>
                <div style={{borderRadius:10,overflow:"hidden",border:"1px solid #D8D4CE"}}>
                  <iframe src={hospUrlWeek} title="Semana" style={{width:"100%",height:460,border:"none",display:"block"}} sandbox="allow-scripts allow-same-origin allow-popups allow-forms"/>
                </div>
                <a href={hospUrlWeek} target="_blank" rel="noopener noreferrer" style={{display:"block",textAlign:"center",marginTop:8,fontSize:11.5,color:"#938B8A",textDecoration:"none"}}>↗ Abrir en pantalla completa</a>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{display:tab==="qa"?"block":"none"}}>
        <AdminQAPanel reps={reps} vendors={vendors} onQA={qaUpdate} onSelect={setDetail} onUpdate={onUpsert} isAdmin={true} me={adminVendor}/>
      </div>
      <div style={{display:tab==="adv"?"block":"none"}}><AdvancesAdmin adelantos={adelantos} reps={reps} vendors={vendors} onSvAdelantos={onSvAdelantos}/></div>
      <div style={{display:tab==="cfg" ?"block":"none"}}><CfgView  reps={reps} vendors={vendors} props={props} adminPin={adminPin} company={company} extCats={extCats||[]} onSvV={onSvV} onSvP={onSvP} onSvPin={onSvPin} onSvCo={onSvCo} onSvExtCats={onSvExtCats}/></div>

      {detail&&<DetailModal rep={detail} vendors={vendors} props={props} hasLinkedDmg={reps.some(function(x){return isDanos(x.categoria)&&String(x._linkedToReport||"")===String(detail.id);})} onExtract={extractDanios} onClose={function(){setDetail(null);}} onMarkPaid={function(p){markPaid(detail.id,p);setDetail(function(x){return Object.assign({},x,{paid:p});});}} onSave={function(r){onUpsert(r);setDetail(r);}} onQA={qaUpdate} onDelete={function(){setCDel(detail.id);}}/>}
      {cDel&&<Overlay><ConfirmDel onCancel={function(){setCDel(null);}} onConfirm={function(){onDelete(cDel);setCDel(null);setDetail(null);}}/></Overlay>}
      {pagoDetail&&<PagoComprobanteModal pago={pagoDetail} company={company} isAdmin={true} focusEmail={null} pagos={pagos} onSvPagos={onSvPagos} onClose={function(){setPagoDetail(null);}}/>}
    </div>
  );
}

/* ─── Dashboard container */
function DashView({reps,vendors,alerts,adelantos,pagos,onSvPagos,company,onMarkPaidBatch,onSelect,onMarkPaid,onRefresh}) {
  const [sub,setSub] = useState("ops");
  return (
    <div>
      {alerts.length>0&&<div style={{background:"#EDE4E4",padding:"10px 22px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",borderBottom:"1px solid #D6C8C8"}}><span>⚠️</span><span style={{fontSize:13,fontWeight:600,color:C.red}}>{alerts.length} trabajo{alerts.length!==1?"s":""} con pago pendiente</span></div>}
      <div style={{background:"#fff",borderBottom:"1px solid "+C.gray,padding:"0 22px",display:"flex",gap:4}}>
        {[["ops","Dashboard Operativo"],["exec","Dashboard Ejecutivo"],["pagos","Historial de pagos"]].map(function(it){ var k=it[0],l=it[1]; return (
          <button key={k} onClick={function(){setSub(k);}} style={{padding:"14px 16px",border:"none",borderBottom:"1.5px solid "+(sub===k?C.black:"transparent"),background:"none",fontSize:13,fontWeight:600,cursor:"pointer",color:sub===k?C.black:C.taupe,transition:"all .2s"}}>{l}</button>
        ); })}
      </div>
      <div style={{display:sub==="ops" ?"block":"none"}}><OpsDash  reps={reps} vendors={vendors} adelantos={adelantos} onMarkPaidBatch={onMarkPaidBatch} onSelect={onSelect} onMarkPaid={onMarkPaid} onRefresh={onRefresh}/></div>
      <div style={{display:sub==="exec"?"block":"none"}}><ExecDash reps={reps} vendors={vendors}/></div>
      <div style={{display:sub==="pagos"?"block":"none"}}><PagosHistory pagos={pagos} vendors={vendors} company={company} isAdmin={true} onSvPagos={onSvPagos}/></div>
    </div>
  );
}

/* ─── Operational Dashboard */
function OpsDash({reps,vendors,adelantos,onMarkPaidBatch,onSelect,onMarkPaid,onRefresh}) {
  const [view,     setView]     = useState("table");
  const [fVend,    setFVend]    = useState("Todos");
  const [fStatus,  setFStatus]  = useState("Todos");
  const [fCat,     setFCat]     = useState("Todos");
  const [fPagador, setFPagador] = useState("Todos");
  const [fDesde,   setFDesde]   = useState("");
  const [fHasta,   setFHasta]   = useState("");
  const [showAll,  setShowAll]  = useState(false);

  function applyPreset(val) {
    var r = presetRange(val); setFDesde(r.from); setFHasta(r.to);
  }

  function reset() { setFVend("Todos"); setFStatus("Todos"); setFCat("Todos"); setFPagador("Todos"); setFDesde(""); setFHasta(""); setShowAll(false); }

  var techOpts = techFilterGroups(reps, vendors);
  var selGroup = (fVend!=="Todos") ? techOpts.find(function(o){return o.value===fVend;}) : null;
  var fReps = reps.filter(function(r) {
    if (fVend!=="Todos") {
      if (selGroup) { if(!repInGroup(r, selGroup)) return false; }
      else return false;
    }
    if (fStatus==="✓ Pagado"&&!(r.paid&&r.total)) return false;
    if (fStatus==="● Pendiente"&&(r.paid||!r.total)) return false;
    if (fCat!=="Todos"&&r.categoria!==fCat) return false;
    if (fPagador!=="Todos"&&(r.pagadoPor||"")!==fPagador) return false;
    if (fDesde&&r.fecha<fDesde) return false;
    if (fHasta&&r.fecha>fHasta) return false;
    return true;
  });
  var shown  = showAll ? fReps : fReps.slice(0,10);
  /* Use auto-tariff as fallback when r.total is not yet saved */
  function effT(r){
    if(isDanos(r.categoria)) return 0; /* daños = seguimiento, no genera pago */
    var t=parseFloat(r.total||0);
    if(t>0) return t;
    var at=autoTarifa(r.reportadoPor||"",vendors||[]);
    return at.tarifa?parseFloat(at.tarifa)||0:0;
  }
  var tot    = fReps.reduce(function(s,r){return s+effT(r);},0);
  var cob    = fReps.filter(function(r){return r.paid;}).reduce(function(s,r){return s+effT(r);},0);
  var unp    = fReps.filter(function(r){return isPayable(r,vendors)&&!r.paid;}).length;
  /* Separar semanas anteriores (pagables) de la semana en curso — la empresa paga a internos con 1 semana de atraso */
  var wk     = splitPayableWeeks(fReps, effT);
  var adel   = selGroup
    ? selGroup.emails.reduce(function(s,e){return s+advanceChargeFor(adelantos, reps, e);},0)
    : advanceChargeFor(adelantos, reps, "Todos");
  var netoPrev = Math.max(0, wk.prev.porCobrar - adel);
  /* Build vendor map: email → display name */
  var vMap = {};
  (vendors||[]).forEach(function(v){if(v.email)vMap[v.email]=vendorDisplay(v);});
  /* Opciones del filtro Técnico: UNA entrada por técnico, mostrada solo con su nombre y
     apellido, unificando todos sus correos (actuales y anteriores). */
  var actF   = [fVend!=="Todos",fStatus!=="Todos",fCat!=="Todos",fPagador!=="Todos",!!fDesde,!!fHasta].filter(Boolean).length;

  var IS = {border:"1.5px solid "+C.gray,borderRadius:9,padding:"7px 10px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none",background:"#fff",color:C.black,cursor:"pointer",transition:"all .2s"};
  var IS_A = Object.assign({},IS,{border:"1.5px solid "+C.black,fontWeight:600});
  var LBL = {fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".13em",textTransform:"uppercase",display:"block",marginBottom:5};

  return (
    <div>
      {/* Stats bar */}
      <StatsSummary
        heroLabel="A depositar"
        heroValue={"Q"+netoPrev.toLocaleString()}
        heroGreen={netoPrev<=0}
        enCursoCount={wk.cur.reps.length}
        enCursoMonto={wk.cur.monto}
        items={[
          {label:"Trabajos", value:wk.prev.pndCount, sub:"pendientes"},
          {label:"Facturado", value:"Q"+Math.round(wk.prev.porCobrar).toLocaleString(), sub:"sin pagar"},
          {label:"Cobrado", value:"Q"+Math.round(wk.prev.cob).toLocaleString(), green:true},
          adel>0?{label:"Adelanto / sem"+(fVend!=="Todos"?"":" (todos)"), value:"−Q"+adel.toLocaleString(), peach:true, sub:"descuento auto"}:null,
        ]}
      />

      {/* Filter panel */}
      <div style={{background:"#fff",borderBottom:"1px solid "+C.gray,padding:"14px 20px"}}>
        {/* Row 1: dropdowns */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:12}}>
          <div>
            <span style={LBL}>Técnico</span>
            <select value={fVend} onChange={function(e){setFVend(e.target.value);setShowAll(false);}} style={fVend!=="Todos"?IS_A:IS}>
              <option value="Todos">Todos</option>
              {techOpts.map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>;})}
            </select>
          </div>
          <div>
            <span style={LBL}>Categoría</span>
            <select value={fCat} onChange={function(e){setFCat(e.target.value);setShowAll(false);}} style={fCat!=="Todos"?IS_A:IS}>
              {["Todos"].concat(CATS).concat(["Supervisión"]).map(function(c){return <option key={c}>{c}</option>;})}
            </select>
          </div>
          <div>
            <span style={LBL}>Estado de pago</span>
            <select value={fStatus} onChange={function(e){setFStatus(e.target.value);setShowAll(false);}} style={fStatus!=="Todos"?IS_A:IS}>
              <option>Todos</option>
              <option>✓ Pagado</option>
              <option>● Pendiente</option>
            </select>
          </div>
          <div>
            <span style={LBL}>Pagador</span>
            <select value={fPagador} onChange={function(e){setFPagador(e.target.value);setShowAll(false);}} style={fPagador!=="Todos"?IS_A:IS}>
              <option>Todos</option>
              <option>Spacio AM</option>
              <option>Dueño</option>
            </select>
          </div>
        </div>

        {/* Row 2: date range + presets + actions */}
        {/* Bulk paid action — only shows when there are pending reps */}
        {fReps.filter(function(r){return !r.paid&&isPayable(r,vendors);}).length>0&&(
          <div style={{background:"#EDF5EF",borderRadius:8,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div style={{fontSize:12.5,color:C.green,fontWeight:600}}>
              {fReps.filter(function(r){return !r.paid&&isPayable(r,vendors);}).length} trabajo{fReps.filter(function(r){return !r.paid;}).length!==1?"s":""} pendientes de pago{selGroup?" de "+selGroup.label:""}
            </div>
            <button onClick={function(){
              var toMark = fReps.filter(function(r){return !r.paid&&isPayable(r,vendors);});
              if(onMarkPaidBatch) onMarkPaidBatch(toMark,{rangoDesde:fDesde,rangoHasta:fHasta});
            }} style={{padding:"7px 16px",borderRadius:7,border:"none",background:"#3d6b52",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
              ✓ Marcar todos como pagados
            </button>
          </div>
        )}
        <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div>
            <span style={LBL}>Período rápido</span>
            <select onChange={function(e){applyPreset(e.target.value);e.target.value="";}} style={IS} defaultValue="">
              <option value="" disabled>Seleccionar…</option>
              <option value="hoy">Hoy</option>
              <option value="semana">Semana en curso</option>
              <option value="semana_ant">Semana anterior</option>
              <option value="mes">Este mes</option>
              <option value="semanas_ant">Semanas anteriores</option>
              <option value="todo">Todo</option>
            </select>
          </div>
          <div>
            <span style={LBL}>Período</span>
            <DateRangePicker from={fDesde} to={fHasta} baseStyle={IS} activeStyle={IS_A} onChange={function(a,b){setFDesde(a);setFHasta(b);setShowAll(false);}}/>
          </div>
          <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
            {actF>0&&(
              <button onClick={reset} style={{padding:"7px 14px",borderRadius:9,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                ✕ Limpiar
                <span style={{background:C.peach,color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{actF}</span>
              </button>
            )}
            <button onClick={onRefresh} title="Actualizar" style={{padding:"7px 11px",borderRadius:8,border:"1px solid "+C.gray,background:"#fff",color:C.earth,fontSize:15,cursor:"pointer",fontWeight:600,lineHeight:1}}>↻</button>
            <div style={{display:"flex",background:C.surfaceWarm,borderRadius:100,overflow:"hidden",border:"1px solid "+C.line,padding:2,gap:2}}>
              {[["table","Lista","list"],["cal","Cal","calendar"]].map(function(it){ var k=it[0],l=it[1],ic=it[2]; return <button key={k} onClick={function(){setView(k);}} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 13px",borderRadius:100,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",background:view===k?C.black:"transparent",color:view===k?"#fff":C.earth,transition:"all .2s",whiteSpace:"nowrap"}}><Icon name={ic} size={14} stroke={view===k?"#fff":C.earth}/>{l}</button>; })}
            </div>
          </div>
        </div>
      </div>

      {fReps.length===0&&<div style={{textAlign:"center",padding:"52px 20px",color:C.earth,fontSize:14}}>No hay trabajos con estos filtros.<br/><button onClick={reset} style={{marginTop:14,padding:"9px 22px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:13,fontWeight:600,cursor:"pointer"}}>Limpiar filtros</button></div>}
      {fReps.length>0&&(view==="table"
        ?<TableView reps={shown} total={fReps.length} showAll={showAll} onToggleAll={function(){setShowAll(function(p){return !p;});}} onSelect={onSelect} onMarkPaid={onMarkPaid} vendors={vendors}/>
        :<CalView   reps={fReps} onSelect={onSelect} onMarkPaid={onMarkPaid} vendors={vendors}/>
      )}
    </div>
  );
}

/* ─── Table View */
function TableView({reps,total,showAll,onToggleAll,onSelect,onMarkPaid,vendors}) {
  return (
    <div style={{padding:"20px 16px 80px"}}>
      <div style={{background:"#fff",borderRadius:16,border:"1px solid "+C.gray,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 88px 1fr 88px 108px",padding:"11px 18px",background:C.surface,borderBottom:"1px solid "+C.line}}>
          {["Propiedad","Fecha","Trabajo realizado","Total","Estado de pago"].map(function(h,i){return <div key={i} style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>{h}</div>;})}
        </div>
        {reps.map(function(r,i) {
          var b=BADGE[r.categoria]||BADGE["Mantenimiento"]; var al=alertLvl(r);
          return (
            <div key={r.id} className="rh" onClick={function(){onSelect(r);}} style={{display:"grid",gridTemplateColumns:"1fr 88px 1fr 88px 108px",padding:"14px 18px",borderBottom:i<reps.length-1?"1px solid "+C.gray:"none",alignItems:"start",background:al?ALT[al].bg+"88":"#fff",cursor:"pointer",transition:"background .15s"}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:C.black,marginBottom:4}}>{r.propiedad}</div>
                <span style={{padding:"2px 7px",borderRadius:20,fontSize:9.5,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",background:b.bg,color:b.tx}}>{r.categoria}</span>
                {al&&<div style={{fontSize:10,color:ALT[al].clr,fontWeight:600,marginTop:3}}>⚠ {ALT[al].label}</div>}
                <div style={{fontSize:11,color:C.earth,marginTop:3}}>{(function(){var v=(vendors||[]).find(function(x){return repMatchesVendor(r,x);});return v?vendorDisplay(v):(r.reportadoPor||"—");})()}</div>
              </div>
              <div style={{fontSize:12,color:C.earth,paddingTop:2}}>{fmtDate(r.fecha)}</div>
              <div style={{fontSize:13,color:C.black,lineHeight:1.55,paddingRight:12}}>{r.descripcion}</div>
              <QuickEditTotal rep={r} vendors={vendors} onSave={function(val){onMarkPaid(Object.assign({},r,{total:val}));}}/>
              <div onClick={function(e){e.stopPropagation();}} style={{display:"flex",flexDirection:"column",gap:5}}>
                {isDanos(r.categoria) ? <span style={{padding:"4px 9px",borderRadius:100,fontSize:9.5,fontWeight:700,letterSpacing:".08em",background:"#F0EDE8",color:C.earth,whiteSpace:"nowrap"}}>SEGUIMIENTO</span> : (r.total||autoTarifa(r.reportadoPor||"",vendors).tarifa) ? <button onClick={function(e){e.stopPropagation();onMarkPaid(r.id,!r.paid);}} style={{padding:"5px 10px",borderRadius:100,border:"none",fontSize:11,fontWeight:700,cursor:"pointer",background:r.paid?"#EDF5EF":"#F5EDEC",color:r.paid?C.green:C.red,whiteSpace:"nowrap"}}>{r.paid?"✓ Pagado":"● Pendiente"}</button> : <span style={{fontSize:12,color:C.gray}}>—</span>}
                {r.pagadoPor&&<span style={{fontSize:9.5,fontWeight:700,letterSpacing:".08em",padding:"2px 7px",borderRadius:100,whiteSpace:"nowrap",background:r.pagadoPor==="Spacio AM"?"#EEF3FA":"#FEF0EC",color:r.pagadoPor==="Spacio AM"?"#4a7fa5":"#E9826A"}}>{r.pagadoPor}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {total>10&&<button onClick={onToggleAll} style={{marginTop:12,width:"100%",padding:"12px",borderRadius:10,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>{showAll?"Mostrar solo últimos 10":"Ver todos los "+total+" registros →"}</button>}
    </div>
  );
}

/* ─── Calendar View */
function CalView({reps,onSelect,onMarkPaid,vendors}) {
  const [month,setMonth] = useState(function(){
    if (reps.length>0&&reps[0].fecha) { var p=reps[0].fecha.split("-"); return new Date(parseInt(p[0]),parseInt(p[1])-1,1); }
    return new Date();
  });
  const [dayP,setDayP] = useState(null);

  var yr=month.getFullYear(), mo=month.getMonth();
  var fd=(new Date(yr,mo,1).getDay()+6)%7, dim=new Date(yr,mo+1,0).getDate();
  var today=todayStr();
  var byDate={};
  reps.forEach(function(r){ if(!byDate[r.fecha]) byDate[r.fecha]=[]; byDate[r.fecha].push(r); });
  var cells=[];
  for(var i=0;i<fd;i++) cells.push(null);
  for(var d=1;d<=dim;d++) { var ds=yr+"-"+String(mo+1).padStart(2,"0")+"-"+String(d).padStart(2,"0"); cells.push({d:d,ds:ds,reps:byDate[ds]||[]}); }
  var moKey=String(mo+1).padStart(2,"0");
  var mTot=Object.entries(byDate).filter(function(e){return e[0].startsWith(yr+"-"+moKey);}).reduce(function(s,e){return s+e[1].length;},0);

  return (
    <div style={{padding:"20px 16px 80px",maxWidth:720,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
        <button onClick={function(){setMonth(new Date(yr,mo-1,1));}} style={{background:C.beige,border:"none",borderRadius:8,width:34,height:34,fontSize:20,cursor:"pointer",color:C.black,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
        <span style={{fontSize:15,fontWeight:600,color:C.black,textTransform:"capitalize",flex:1,textAlign:"center"}}>
          {month.toLocaleDateString("es-GT",{month:"long",year:"numeric"})}
          {mTot>0&&<span style={{fontSize:12,color:C.earth,fontWeight:400,marginLeft:8}}>— {mTot} trabajo{mTot!==1?"s":""}</span>}
        </span>
        <button onClick={function(){setMonth(new Date(yr,mo+1,1));}} style={{background:C.beige,border:"none",borderRadius:8,width:34,height:34,fontSize:20,cursor:"pointer",color:C.black,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
        {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(function(d){return <div key={d} style={{textAlign:"center",fontSize:10.5,fontWeight:700,color:C.earth,padding:"5px 0"}}>{d}</div>;})}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {cells.map(function(cell,idx) {
          if (!cell) return <div key={idx}/>;
          var isT=cell.ds===today, hw=cell.reps.length>0, ha=cell.reps.some(function(r){return !!alertLvl(r);}), isO=dayP&&dayP.date===cell.ds;
          return (
            <div key={idx} onClick={function(){if(hw)setDayP(isO?null:{date:cell.ds,reps:cell.reps});}} style={{minHeight:62,borderRadius:10,padding:"8px 7px",background:isO?C.black:(hw?(ha?"#F5EDEC":"#fff"):C.surfaceWarm),border:"1.5px solid "+(isT?C.peach:(isO?C.black:(hw?C.gray:"transparent"))),cursor:hw?"pointer":"default",transition:"all .18s"}}>
              <div style={{fontSize:12,fontWeight:isT?700:400,color:isO?"#fff":(isT?C.peach:C.black),marginBottom:4}}>{cell.d}</div>
              {hw&&<div style={{display:"flex",flexWrap:"wrap",gap:2,marginBottom:2}}>{cell.reps.slice(0,4).map(function(r,j){var b=BADGE[r.categoria]||BADGE["Mantenimiento"];var al=alertLvl(r);return <div key={j} style={{width:7,height:7,borderRadius:"50%",background:al?ALT[al].clr:(isO?"rgba(255,255,255,.6)":b.tx)}}/>;})}</div>}
              {hw&&<div style={{fontSize:9.5,color:isO?"rgba(255,255,255,.55)":C.earth}}>{cell.reps.length} trab.</div>}
            </div>
          );
        })}
      </div>
      {dayP&&(
        <div style={{marginTop:16,background:"#fff",borderRadius:14,border:"1px solid "+C.gray,overflow:"hidden"}}>
          <div style={{padding:"12px 18px",background:C.beige,borderBottom:"1px solid "+C.gray,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:13,fontWeight:600,color:C.black}}>{fmtDate(dayP.date)} — {dayP.reps.length} trabajo{dayP.reps.length!==1?"s":""}</div>
            <button onClick={function(){setDayP(null);}} style={{background:"none",border:"none",fontSize:18,color:C.earth,cursor:"pointer"}}>×</button>
          </div>
          {dayP.reps.map(function(r,i){return (
            <div key={r.id} className="rh" onClick={function(){onSelect(r);}} style={{padding:"13px 18px",borderBottom:i<dayP.reps.length-1?"1px solid "+C.gray:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13.5,fontWeight:600,color:C.black}}>{r.propiedad}</div>
                <div style={{fontSize:12,color:C.earth,marginTop:3}}>{r.descripcion.slice(0,65)}{r.descripcion.length>65?"…":""}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0,marginLeft:14}}>
                <QuickEditTotal rep={r} vendors={vendors} onSave={function(val){onMarkPaid(Object.assign({},r,{total:val}));}} />
                {r.total&&<div style={{fontSize:10,fontWeight:700,color:r.paid?C.green:C.red,marginTop:3}}>{r.paid?"✓ Pagado":"● Pendiente"}</div>}
              </div>
            </div>
          );})}
        </div>
      )}
      {mTot===0&&<div style={{textAlign:"center",padding:"32px 20px",color:C.earth,fontSize:13}}>No hay trabajos en este mes. Usa las flechas para navegar.</div>}
    </div>
  );
}

/* ─── Executive Dashboard */
function ExecDash({reps,vendors}) {
  const [fProp,  setFProp]   = useState("Todas");
  const [fDesde, setFDesde]  = useState("");
  const [fHasta, setFHasta]  = useState("");
  const [exp,    setExp]     = useState(false);
  const [dSt,    setDSt]     = useState(null);

  function applyPreset(val) {
    var r = presetRange(val); setFDesde(r.from); setFHasta(r.to);
  }

  var base = reps.filter(function(r){
    if (fDesde&&r.fecha<fDesde) return false;
    if (fHasta&&r.fecha>fHasta) return false;
    return true;
  });
  var fil  = fProp==="Todas" ? base : base.filter(function(r){return r.propiedad===fProp;});
  var pNames   = ["Todas"].concat(uniq(reps.map(function(r){return r.propiedad;}).filter(Boolean)).sort());
  var byCat    = CATS.map(function(c){return {name:c.slice(0,6),count:fil.filter(function(r){return r.categoria===c;}).length};}).filter(function(d){return d.count>0;});
  var tMap     = {};
  var spanDays = (fDesde&&fHasta) ? Math.round((new Date(fHasta)-new Date(fDesde))/86400000) : 60;
  fil.forEach(function(r){
    var d=new Date(r.fecha+"T12:00:00"); if(isNaN(d)) return;
    var k = spanDays<=21 ? r.fecha.slice(5) : r.fecha.slice(0,7);
    if(!tMap[k]) tMap[k]={label:k,count:0}; tMap[k].count++;
  });
  var tData    = Object.values(tMap).sort(function(a,b){return a.label.localeCompare(b.label);});
  var pRank    = uniq(base.map(function(r){return r.propiedad;}).filter(Boolean)).map(function(p){
    var pr=base.filter(function(r){return r.propiedad===p;});
    return {name:p,count:pr.length,total:pr.reduce(function(s,r){return s+(isDanos(r.categoria)?0:parseFloat(r.total||0));},0),pending:pr.filter(function(r){return r.total&&!r.paid&&!isDanos(r.categoria);}).length};
  }).sort(function(a,b){return b.count-a.count;});
  var maxC     = pRank.length>0 ? pRank[0].count : 1;
  var RED_T    = 3;
  function execT(r){ return isDanos(r.categoria)?0:(parseFloat(r.total||0)||0); }
  var tFact    = fil.reduce(function(s,r){return s+execT(r);},0);
  var tCobr    = fil.filter(function(r){return r.paid;}).reduce(function(s,r){return s+execT(r);},0);
  var tPend    = fil.filter(function(r){return r.total&&!r.paid&&!isDanos(r.categoria);}).reduce(function(s,r){return s+execT(r);},0);

  async function exportDrive() {
    setExp(true); setDSt(null);
    try {
      var header = "Propiedad,Fecha,Tecnico,Categoria,Total,Estado";
      var rows   = reps.map(function(r){return '"'+r.propiedad+'","'+r.fecha+'","'+r.reportadoPor+'","'+r.categoria+'","Q'+(r.total||0)+'","'+(r.paid?"Pagado":"Pendiente")+'"';});
      var csv    = [header].concat(rows).join("\n");
      var res    = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:"Sube este CSV a Google Drive como Reporte_SpacioAM_"+todayStr()+".csv:\n\n"+csv}],mcp_servers:[{type:"url",url:"https://drivemcp.googleapis.com/mcp/v1",name:"google-drive"}]})});
      var data   = await res.json();
      var ok     = data.content&&data.content.some(function(x){return x.type==="mcp_tool_result"||x.type==="text";});
      setDSt({ok:ok,msg:ok?"✓ Reporte exportado a Google Drive correctamente.":"No se recibió confirmación. Intenta de nuevo."});
    } catch(e) { setDSt({ok:false,msg:"Error al exportar. Verifica tu conexión."}); }
    setExp(false);
  }

  var IS  = {border:"1.5px solid "+C.gray,borderRadius:9,padding:"7px 10px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none",background:"#fff",color:C.black,cursor:"pointer",width:"100%"};
  var ISA = Object.assign({},IS,{border:"1.5px solid "+C.black,fontWeight:600});
  var LBL = {fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".13em",textTransform:"uppercase",display:"block",marginBottom:5};
  var hasDate = !!(fDesde||fHasta);
  var actF = [fProp!=="Todas",hasDate].filter(Boolean).length;

  return (
    <div style={{padding:"20px 22px 80px",maxWidth:900,margin:"0 auto"}}>

      {/* ── Filter panel */}
      <div style={{background:"#fff",borderRadius:14,border:"1px solid "+C.gray,padding:"16px 18px",marginBottom:20}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:14}}>
          <div>
            <span style={LBL}>Propiedad</span>
            <select value={fProp} onChange={function(e){setFProp(e.target.value);}} style={fProp!=="Todas"?ISA:IS}>
              {pNames.map(function(n){return <option key={n}>{n}</option>;})}
            </select>
          </div>
          <div>
            <span style={LBL}>Período rápido</span>
            <select onChange={function(e){applyPreset(e.target.value);e.target.value="";}} style={IS} defaultValue="">
              <option value="" disabled>Seleccionar…</option>
              <option value="hoy">Hoy</option>
              <option value="semana">Semana en curso</option>
              <option value="semana_ant">Semana anterior</option>
              <option value="mes">Este mes</option>
              <option value="semanas_ant">Semanas anteriores</option>
              <option value="todo">Todo el historial</option>
            </select>
          </div>
          <div>
            <span style={LBL}>Período</span>
            <DateRangePicker from={fDesde} to={fHasta} baseStyle={IS} activeStyle={ISA} onChange={function(a,b){setFDesde(a);setFHasta(b);}}/>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {actF>0&&<button onClick={function(){setFProp("Todas");setFDesde("");setFHasta("");}} style={{padding:"6px 14px",borderRadius:8,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>✕ Limpiar <span style={{background:C.peach,color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{actF}</span></button>}
            {fDesde&&fHasta&&<span style={{fontSize:12,color:C.earth,fontWeight:500}}>{fDesde} → {fHasta} ({fil.length} registros)</span>}
          </div>
          <button onClick={exportDrive} disabled={exp} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:9,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12,fontWeight:600,cursor:exp?"not-allowed":"pointer"}}>📁 {exp?"Exportando…":"Exportar a Drive"}</button>
        </div>
      </div>
      {dSt&&<div style={{marginBottom:16,padding:"10px 14px",borderRadius:9,fontSize:13,fontWeight:600,background:dSt.ok?"#EDF5EF":"#F5EDEC",color:dSt.ok?C.green:C.red}}>{dSt.msg}</div>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {[{l:"Trabajos",v:fil.length},{l:"Facturado",v:"Q"+tFact.toLocaleString(),a:true},{l:"Cobrado",v:"Q"+tCobr.toLocaleString(),g:true},{l:"Pendiente",v:"Q"+tPend.toLocaleString(),w:tPend>0}].map(function(s,i){
          return <div key={i} style={{background:"#fff",borderRadius:14,padding:"16px",border:"1px solid "+C.line}}><div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>{s.l}</div><div style={{fontSize:22,fontWeight:600,color:s.g?C.green:s.w?C.red:s.a?C.peach:C.black}}>{s.v}</div></div>;
        })}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <div style={{background:"#fff",borderRadius:14,padding:"18px",border:"1px solid "+C.line}}>
          <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:14}}>Trabajos por tipo</div>
          {byCat.length>0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byCat} margin={{top:0,right:0,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.gray}/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:C.earth}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10,fill:C.earth}} axisLine={false} tickLine={false} allowDecimals={false}/>
                <Tooltip contentStyle={{borderRadius:8,fontSize:12}}/>
                <Bar dataKey="count" fill={C.sand} radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart/>}
        </div>
        <div style={{background:"#fff",borderRadius:14,padding:"18px",border:"1px solid "+C.line}}>
          <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:14}}>Trabajos en el tiempo</div>
          {tData.length>1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={tData} margin={{top:0,right:10,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.gray}/>
                <XAxis dataKey="label" tick={{fontSize:10,fill:C.earth}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10,fill:C.earth}} axisLine={false} tickLine={false} allowDecimals={false}/>
                <Tooltip contentStyle={{borderRadius:8,fontSize:12}}/>
                <Line type="monotone" dataKey="count" stroke={C.peach} strokeWidth={2.5} dot={{r:4,fill:C.peach}} name="Trabajos"/>
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart/>}
        </div>
      </div>

      <div style={{background:"#fff",borderRadius:14,padding:"18px",border:"1px solid "+C.line}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>Actividad por propiedad</div>
          {pRank.filter(function(p){return p.count>=RED_T;}).length>0&&<span style={{fontSize:11,fontWeight:700,color:C.red,background:"#F5EDEC",padding:"3px 10px",borderRadius:100}}>🔴 {pRank.filter(function(p){return p.count>=RED_T;}).length} con alta actividad</span>}
        </div>
        {pRank.length===0&&<EmptyChart label="Sin datos en este período"/>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {pRank.map(function(p,i){
            var pct=(p.count/maxC)*100; var isR=p.count>=RED_T;
            return (
              <div key={i}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {isR&&<span style={{fontSize:14}}>🔴</span>}
                    <span style={{fontSize:13,fontWeight:isR?700:500,color:isR?C.red:C.black}}>{p.name}</span>
                  </div>
                  <div style={{display:"flex",gap:14,alignItems:"center",flexShrink:0,marginLeft:12}}>
                    <span style={{fontSize:12,color:C.earth}}>{p.count} trabajo{p.count!==1?"s":""}</span>
                    {p.total>0&&<span style={{fontSize:12,fontWeight:600,color:C.black}}>{"Q"+p.total.toLocaleString()}</span>}
                    {p.pending>0&&<span style={{fontSize:11,fontWeight:700,color:C.red,background:"#F5EDEC",padding:"2px 7px",borderRadius:100}}>{p.pending} pend.</span>}
                  </div>
                </div>
                <div style={{background:C.beige,borderRadius:100,height:6}}><div style={{width:pct+"%",height:"100%",borderRadius:100,background:isR?C.red:C.taupe,transition:"width .4s"}}/></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Pagos semanales de limpieza */}
      <PagosLimpieza reps={reps} vendors={vendors}/>

    </div>
  );
}
function EmptyChart({label}) { return <div style={{height:160,display:"flex",alignItems:"center",justifyContent:"center",color:C.earth,fontSize:13}}>{label||"Sin datos"}</div>; }

/* ─── Pagos semanales de limpieza */
function PagosLimpieza({reps,vendors}) {
  const [semana,setSemana] = useState(0); /* 0=esta semana, 1=semana pasada, etc */
  var CATS_LIMPIEZA = ["Limpieza tradicional","Limpieza profunda"];

  /* Build week window */
  var now   = Date.now();
  var wStart = new Date(now - semana*7*86400000);
  wStart.setHours(0,0,0,0);
  wStart.setDate(wStart.getDate() - ((wStart.getDay()+6)%7)); /* Monday */
  var wEnd  = new Date(wStart.getTime() + 7*86400000);

  var inWindow = reps.filter(function(r){
    if (!CATS_LIMPIEZA.includes(r.categoria)) return false;
    var d = new Date(r.fecha+"T12:00:00");
    return d>=wStart && d<wEnd;
  });

  /* Group by cleaner (resolviendo correos anteriores al mismo técnico) */
  var byVend = {};
  inWindow.forEach(function(r){
    var owner = (vendors||[]).find(function(v){return repMatchesVendor(r,v);});
    var key = owner ? ("v:"+owner.id) : (r.reportadoPor||"—");
    if (!byVend[key]) byVend[key]={email:(owner&&owner.email)||r.reportadoPor, vendor:owner||null, count:0,totalQ:0,paid:0,pendiente:0};
    var t = parseFloat(r.total||0);
    byVend[key].count++;
    byVend[key].totalQ += t;
    if (r.paid) byVend[key].paid += t; else byVend[key].pendiente += t;
  });

  var rows = Object.values(byVend).sort(function(a,b){return b.totalQ-a.totalQ;});

  /* Format week label */
  var opts = {day:"2-digit",month:"short"};
  var wLabel = wStart.toLocaleDateString("es-GT",opts)+" – "+new Date(wEnd.getTime()-86400000).toLocaleDateString("es-GT",opts);

  /* Total pendiente this week */
  var totalPend = rows.reduce(function(s,r){return s+r.pendiente;},0);

  return (
    <div style={{background:"#fff",borderRadius:14,padding:"18px",border:"1px solid "+C.gray,marginTop:24}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:4}}>Pagos de limpieza por semana</div>
          <div style={{fontSize:12,color:C.earth}}>{wLabel}</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button onClick={function(){setSemana(function(s){return s+1;});}} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,cursor:"pointer"}}>‹ Anterior</button>
          {semana>0&&<button onClick={function(){setSemana(0);}} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid "+C.gray,background:C.black,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Esta semana</button>}
          {semana>0&&<button onClick={function(){setSemana(function(s){return s-1;});}} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,cursor:"pointer"}}>Siguiente ›</button>}
        </div>
      </div>

      {totalPend>0&&<div style={{background:"#F2F0EC",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,fontWeight:600,color:C.orange}}>💰 Pendiente de pago esta semana: Q{totalPend.toLocaleString()}</div>}

      {rows.length===0&&<div style={{textAlign:"center",padding:"24px",color:C.earth,fontSize:13}}>No hay limpiezas registradas esta semana.</div>}

      {rows.length>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 56px 80px 80px 80px 96px",padding:"9px 14px",background:C.surface,borderRadius:6,marginBottom:6,border:"1px solid "+C.line}}>
            {["Cleaner","Limpiezas","Tarifa","Total","Cobrado","Pendiente"].map(function(h,i){return <div key={i} style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".12em",textTransform:"uppercase",textAlign:i>0?"center":"left"}}>{h}</div>;})}
          </div>
          {rows.map(function(row,i){
            var vend = row.vendor || (vendors&&vendors.find(function(v){return v.email===row.email;}));
            var name = vend?vend.name:row.email;
            var tarifa = vend&&vend.tarifaLimpieza?"Q"+vend.tarifaLimpieza:"—";
            return (
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 56px 80px 80px 80px 96px",padding:"12px 12px",borderBottom:i<rows.length-1?"1px solid "+C.gray:"none",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:C.black}}>{name}</div>
                  <div style={{fontSize:11,color:C.earth}}>{row.email}</div>
                </div>
                <div style={{textAlign:"center",fontSize:14,fontWeight:700,color:C.black}}>{row.count}</div>
                <div style={{textAlign:"center",fontSize:12,color:C.earth,fontWeight:600}}>{tarifa}</div>
                <div style={{textAlign:"center",fontSize:13,fontWeight:700,color:C.black}}>{"Q"+row.totalQ.toLocaleString()}</div>
                <div style={{textAlign:"center",fontSize:12,fontWeight:700,color:C.green}}>{row.paid>0?"Q"+row.paid.toLocaleString():"—"}</div>
                <div style={{textAlign:"center"}}>
                  {row.pendiente>0
                    ?<span style={{fontSize:12,fontWeight:700,color:C.red,background:"#F5EDEC",padding:"3px 8px",borderRadius:100}}>Q{row.pendiente.toLocaleString()}</span>
                    :<span style={{fontSize:12,fontWeight:700,color:C.green}}>✓ Al día</span>
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary footer */}
      {rows.length>0&&(
        <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid "+C.gray,display:"flex",gap:20,flexWrap:"wrap"}}>
          <Stat label="Limpiezas" value={rows.reduce(function(s,r){return s+r.count;},0)}/>
          <Sep/>
          <Stat label="Total semana" value={"Q"+rows.reduce(function(s,r){return s+r.totalQ;},0).toLocaleString()}/>
          <Sep/>
          <Stat label="Por pagar" value={"Q"+totalPend.toLocaleString()} warn={totalPend>0}/>
        </div>
      )}
    </div>
  );
}



/* ─── Report Form — dispatcher (all hooks before any return) */
function RepForm({vendors,props,company,onSubmit,defaultVendor,onSaveFeedback,myReps}) {
  /* Determine allowed cats by vendor type */
  var vend = vendors&&vendors.find(function(v){return v.email===defaultVendor;});
  var isEPILimpieza = vend&&vend.tipo==="interno"&&vend.categoria==="EPI Limpieza";
  var isEPIMant = vend&&vend.tipo==="interno"&&vend.categoria==="EPI Mantenimiento";
  var allowedCats = isEPILimpieza
    ? ["Limpieza tradicional","Limpieza profunda","Ajuste","Reporte de Daños"]
    : isEPIMant
    ? ["Mantenimiento","Nuevo Producto","Ajuste","Reporte de Daños"]
    : CATS; /* Admin + Administrativo + External: all categories */
  /* El formulario de Supervisión solo existe para usuarios con la función activada */
  if (vend&&vend.isSupervisor&&allowedCats.indexOf("Supervisión")<0) allowedCats = allowedCats.concat(["Supervisión"]);
  /* Start with null (selector screen) so user always picks category first */
  const [cat,setCat] = useState(null);
  function goBack(){setCat(null);}
  var shared = {vendors:vendors,props:props,company:company,onSubmit:onSubmit,defaultVendor:defaultVendor,onBack:goBack,onSaveFeedback:onSaveFeedback};
  if (cat==="Limpieza tradicional") return <LimpiezaTradForm {...shared}/>;
  if (cat==="Limpieza profunda")    return <LimpiezaProfForm  {...shared}/>;
  if (cat==="Ajuste")               return <AjusteForm           {...shared}/>;
  if (cat==="Reporte de Daños")     return <DanosFormSolo         {...shared}/>;
  if (cat==="Nuevo Producto")       return <NuevoProductoForm      {...shared}/>;
  if (cat==="Supervisión")          return <SupervisionRepForm      {...shared} myReps={myReps||[]}/>;
  return <StandardRepForm cat={cat} setCat={setCat} allowedCats={allowedCats} {...shared}/>;
}

/* ─── Formulario de Supervisión — solo supervisores. Cuenta como trabajo con la tarifa
   del usuario. Máximo 1 por día. */
function SupervisionRepForm({vendors,onSubmit,defaultVendor,onBack,myReps}) {
  var vend = (vendors||[]).find(function(v){return v.email===defaultVendor;})||{};
  const [fecha,setFecha] = useState(todayStr());
  const [coment,setComent] = useState("");
  const [busy,setBusy] = useState(false);
  const [done,setDone] = useState(false);
  const [err,setErr]   = useState("");
  var tarifa = vend.tarifaLimpieza?String(vend.tarifaLimpieza):"";
  var yaHoy = (myReps||[]).some(function(r){return r.categoria==="Supervisión"&&r.fecha===fecha&&r.reportadoPor===defaultVendor;});
  async function sub(){
    if(yaHoy){ setErr("Ya registraste un trabajo de supervisión para esta fecha — solo se permite 1 por día."); return; }
    setBusy(true); setErr("");
    try{
      await onSubmit({
        id:Date.now(), createdAt:Date.now(),
        categoria:"Supervisión", propiedad:"Supervisión de calidad",
        fecha:fecha, reportadoPor:defaultVendor,
        descripcion:"Jornada de supervisión de calidad"+(coment?" — "+coment:""),
        comentarios:coment||"",
        total:tarifa, paid:false, pagadoPor:"",
        fotoAntes:[], fotoDespues:[], factura:null,
      });
      setDone(true);
    }catch(e){ setErr("Error al enviar: "+(e&&e.message?e.message:"verifica tu conexión.")); }
    finally{ setBusy(false); }
  }
  if(done) return <SuccessScreen msg="Supervisión registrada" sub="Tu jornada de supervisión quedó guardada y cuenta como un trabajo con tu tarifa asignada."/>;
  return (
    <div style={{maxWidth:480,margin:"0 auto",padding:"24px 16px 80px",fontFamily:"Montserrat,sans-serif",display:"flex",flexDirection:"column",gap:16}}>
      <button onClick={onBack} style={{alignSelf:"flex-start",background:"none",border:"none",color:C.earth,fontSize:12.5,fontWeight:600,cursor:"pointer",padding:0}}>← Volver</button>
      <div>
        <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".24em",textTransform:"uppercase",marginBottom:6}}>Formulario de Supervisión</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:26,fontWeight:400,color:C.black}}>Jornada de supervisión</div>
        <div style={{fontSize:12.5,color:C.earth,lineHeight:1.6,marginTop:8}}>Registra tu día de supervisión de calidad. Cuenta como un trabajo con tu tarifa asignada{tarifa?" (Q"+tarifa+")":""} — máximo 1 por día.</div>
      </div>
      <F label="Fecha"><input type="date" value={fecha} onChange={function(e){setFecha(e.target.value);setErr("");}}/></F>
      <F label="Comentarios (opcional)"><textarea rows={4} placeholder="Observaciones generales de la jornada…" value={coment} onChange={function(e){setComent(e.target.value);}}/></F>
      {yaHoy&&<div style={{background:"#F7EFE2",border:"1px solid #E3D5B8",borderRadius:8,padding:"10px 13px",fontSize:12,color:"#9a6b2f",fontWeight:600}}>⚠ Ya existe un registro de supervisión para esta fecha.</div>}
      {err&&<div style={{background:"#F5EDEC",border:"1px solid #DBC8C4",borderRadius:8,padding:"10px 13px",fontSize:12,color:C.red,fontWeight:600}}>{err}</div>}
      <button onClick={sub} disabled={busy||yaHoy} style={{padding:"14px",borderRadius:10,border:"none",background:busy||yaHoy?C.gray:C.black,color:"#fff",fontSize:13.5,fontWeight:700,cursor:busy||yaHoy?"default":"pointer",letterSpacing:".04em"}}>{busy?"Enviando…":"Registrar supervisión →"}</button>
    </div>
  );
}

/* ─── Standard Rep Form (Mantenimiento / Producto) */
function StandardRepForm({cat,setCat,vendors,props,company,onSubmit,defaultVendor,allowedCats}) {
  allowedCats = allowedCats||CATS;
  var initAT = autoTarifa(defaultVendor||"", vendors);
  var blank={propiedad:"",fecha:todayStr(),categoria:cat,reportadoPor:defaultVendor||"",descripcion:"",comentarios:"",total:initAT.tarifa,paid:false,pagadoPor:"",fotoAntes:[],fotoDespues:[],factura:null};
  const [form,setForm] = useState(blank);
  const [busy,setBusy] = useState(false);
  const [done,setDone] = useState(false);

  async function addPics(files,field,max){var c=await Promise.all(Array.from(files).map(function(f){return compress(f);}));setForm(function(p){var merged=p[field].concat(c).slice(0,max);var u=Object.assign({},p);u[field]=merged;return u;});}
  function rmPic(field,idx){setForm(function(p){var u=Object.assign({},p);u[field]=p[field].filter(function(_,j){return j!==idx;});return u;});}
  function setF(key,val){setForm(function(p){var u=Object.assign({},p);u[key]=val;return u;});}

  async function sub(){
    if(!form.propiedad||!form.reportadoPor||!form.descripcion)return;
    setBusy(true);
    try {
      await onSubmit(Object.assign({},form,{id:Date.now(),createdAt:Date.now(),categoria:cat}));
      setDone(true);
      setTimeout(function(){setDone(false);setForm(Object.assign({},blank,{reportadoPor:defaultVendor||""}));},2600);
    } catch(e) {
      console.error("Error al enviar");
    } finally { setBusy(false); }
  }

  if(done) return <SuccessScreen msg="¡Reporte enviado!" sub="El trabajo quedó registrado correctamente."/>;

  var coName=company&&company.name?company.name:"Spacio AM S.A.";
  var coNit =company&&company.nit?company.nit:"118287796";

  return (
    <div style={{width:"100%",maxWidth:560,margin:"0 auto",padding:"24px 16px 90px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:9.5,fontWeight:600,color:C.earth,letterSpacing:".28em",textTransform:"uppercase",marginBottom:8}}>Nuevo reporte</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:28,fontWeight:400,color:C.black,letterSpacing:".04em"}}>¿Qué trabajo se realizó?</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Card title="Tipo de trabajo">
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {allowedCats.map(function(c){var b=BADGE[c]||BADGE["Mantenimiento"];var s=cat===c;return <button key={c} onClick={function(){setCat(c);}} style={{padding:"7px 14px",borderRadius:100,cursor:"pointer",border:"1.5px solid "+(s?b.tx:C.gray),background:s?b.bg:"#fff",color:s?b.tx:C.earth,fontSize:12.5,fontWeight:600,transition:"all .18s"}}>{c}</button>;})}
          </div>
        </Card>
        <Card title="Responsable">
          {defaultVendor
            ?<div style={{fontSize:14,fontWeight:600,color:C.black,background:C.surfaceWarm,padding:"11px 14px",borderRadius:10}}>{vendors.find(function(v){return v.email===defaultVendor;})?vendorDisplay(vendors.find(function(v){return v.email===defaultVendor;})):defaultVendor}</div>
            :<F label="Técnico / Proveedor"><select value={form.reportadoPor} onChange={function(e){
                    var email = e.target.value;
                    setF("reportadoPor",email);
                    var at = autoTarifa(email, vendors);
                    if(at.tarifa) setF("total",at.tarifa);
                  }}><option value="">Seleccionar…</option>{vendors.filter(function(v){return v.active;}).map(function(v){return <option key={v.id} value={v.email}>{v.name}</option>;})}</select></F>
          }
        </Card>
        <Card title="Propiedad">
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Propiedad"><select value={form.propiedad} onChange={function(e){setF("propiedad",e.target.value);}}><option value="">Seleccionar…</option>{props.map(function(p){return <option key={p.id}>{p.name}</option>;})}</select></F>
            <F label="Fecha"><input type="date" value={form.fecha} onChange={function(e){setF("fecha",e.target.value);}}/></F>
          </div>
        </Card>
        <Card title="Descripción"><F label="¿Qué se hizo?"><textarea rows={4} placeholder="Describe brevemente el trabajo realizado…" value={form.descripcion} onChange={function(e){setF("descripcion",e.target.value);}}/></F></Card>
        <Card title="Evidencia fotográfica">
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <PicUp label="ANTES"   max={2} photos={form.fotoAntes}   accent={C.earth} onAdd={function(f){addPics(f,"fotoAntes",2);}}   onDel={function(i){rmPic("fotoAntes",i);}}/>
            <div style={{height:1,background:C.gray}}/>
            <PicUp label="DESPUÉS" max={3} photos={form.fotoDespues} accent={C.peach} onAdd={function(f){addPics(f,"fotoDespues",3);}} onDel={function(i){rmPic("fotoDespues",i);}}/>
          </div>
        </Card>
        <Card title="Factura">
          <div style={{marginBottom:12,padding:"12px 14px",borderRadius:10,background:C.surfaceWarm,border:"1px solid "+C.line,fontSize:12.5,color:C.black,lineHeight:1.65}}>
            📋 Favor emitir su factura a nombre de <strong>{coName}</strong><br/>
            <span style={{color:C.earth}}>NIT: <strong style={{color:C.black}}>{coNit}</strong></span>
          </div>
          <InvoiceUp factura={form.factura} onAdd={function(file){var r=new FileReader();r.onload=function(ev){setF("factura",{name:file.name,type:file.type,data:ev.target.result});};r.readAsDataURL(file);}} onDel={function(){setF("factura",null);}}/>
        </Card>
        <Card title="Detalles finales">
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Comentarios"><textarea rows={3} placeholder="Observaciones, materiales, pendientes…" value={form.comentarios} onChange={function(e){setF("comentarios",e.target.value);}}/></F>
            <F label="Total cobrado (Q)"><input type="number" placeholder="Ej. 850" value={form.total} onChange={function(e){setF("total",e.target.value);}}/></F>
          </div>
        </Card>
        <BigBtn onClick={sub} dis={busy||!form.propiedad||!form.reportadoPor||!form.descripcion}>{busy?"Enviando…":"Enviar reporte →"}</BigBtn>
      </div>
    </div>
  );
}


/* ─── Nuevo Producto Form */
function NuevoProductoForm({vendors,props,onSubmit,defaultVendor,onBack}) {
  const [nombre,  setNombre]  = useState("");
  const [desc,    setDesc]    = useState("");
  const [precio,  setPrecio]  = useState("");
  const [prop,    setProp]    = useState("");
  const [fecha,   setFecha]   = useState(todayStr());
  const [establec,setEstablec]= useState("");
  const [fotos,   setFotos]   = useState([]);
  const [factura, setFactura] = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [done,    setDone]    = useState(false);
  const facRef = useRef(null);

  async function addFotos(files) {
    var c = await Promise.all(Array.from(files).slice(0,4-fotos.length).map(function(f){return compress(f);}));
    setFotos(function(p){return p.concat(c).slice(0,4);});
  }

  async function sub() {
    if(!nombre||!precio) return;
    setBusy(true);
    try {
      await onSubmit({
        id:Date.now(), createdAt:Date.now(),
        categoria:"Nuevo Producto",
        propiedad:prop||"General",
        fecha:fecha,
        reportadoPor:defaultVendor||"admin",
        descripcion:desc?nombre+" — "+desc:nombre,
        establecimiento:establec,
        comentarios:desc,
        total:precio,
        paid:false, pagadoPor:"",
        fotoAntes:[], fotoDespues:fotos, factura:factura,
        nombreProducto:nombre,
      });
      setDone(true);
    } catch(e) { console.error("Error al guardar"); }
    finally { setBusy(false); }
  }

  if(done) return <SuccessScreen msg="¡Producto registrado!" sub="El nuevo mobiliario quedó guardado en el inventario."/>;

  return (
    <div style={{maxWidth:520,margin:"0 auto",padding:"24px 16px 90px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:10}}><button onClick={onBack} style={{background:"none",border:"none",color:C.earth,fontSize:12.5,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>← Cambiar tipo</button></div>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:11,color:C.peach,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase",marginBottom:6}}>Nuevo Producto</div>
        <div style={{fontSize:22,fontWeight:400,color:C.black}}>Registrar nuevo mobiliario</div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Card title="Información del producto">
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Nombre del producto o mobiliario">
              <input placeholder="Ej. Sillón de lectura, Mesa de centro…" value={nombre} onChange={function(e){setNombre(e.target.value);}}/>
            </F>
            <F label="Descripción">
              <textarea rows={3} placeholder="Material, color, dimensiones, uso previsto…" value={desc} onChange={function(e){setDesc(e.target.value);}}/>
            </F>
          </div>
        </Card>

        <Card title="Ubicación y fecha">
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Propiedad / Apartamento donde va">
              <select value={prop} onChange={function(e){setProp(e.target.value);}}>
                <option value="">Sin asignar (general)</option>
                {props.map(function(p){return <option key={p.id}>{p.name}</option>;})}
              </select>
            </F>
            <F label="Fecha de compra">
              <input type="date" value={fecha} onChange={function(e){setFecha(e.target.value);}}/>
            </F>
          </div>
        </Card>

        <Card title="Fotos del producto">
          <div style={{fontSize:12,color:C.earth,marginBottom:12}}>Sube entre 3 y 4 fotos del producto — frente, detalle, empaque y ubicación final si ya está instalado.</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {fotos.map(function(src,i){return (
              <div key={i} style={{position:"relative",width:96,height:96,borderRadius:11,overflow:"hidden",border:"2px solid "+C.gray}}>
                <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                <button onClick={function(){setFotos(function(p){return p.filter(function(_,j){return j!==i;});});}} style={{position:"absolute",top:4,right:4,width:22,height:22,borderRadius:"50%",border:"none",background:"rgba(0,0,0,.6)",color:"#fff",fontSize:15,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
              </div>
            );})}
            {fotos.length<4&&(
              <label style={{width:96,height:96,borderRadius:10,border:"1.5px dashed "+C.line,background:C.surface,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",transition:"background .2s"}}>
                <span style={{fontSize:28,color:C.peach}}>+</span>
                <span style={{fontSize:10,color:C.earth,fontWeight:600}}>Foto</span>
                <input type="file" accept="image/*" multiple style={{display:"none"}} onChange={function(e){if(e.target.files)addFotos(e.target.files);e.target.value="";}}/>
              </label>
            )}
          </div>
          <div style={{marginTop:10,fontSize:11,color:C.earth}}>{fotos.length}/4 fotos — {fotos.length<3?"Se recomiendan mínimo 3":"✓ Suficientes fotos"}</div>
        </Card>

        <Card title="Precio y factura">
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Precio de compra (Q)">
              <input type="number" placeholder="Ej. 1500" value={precio} onChange={function(e){setPrecio(e.target.value);}}/>
            </F>
            <F label="Establecimiento / Tienda">
              <input placeholder="Ej. IKEA, Mercado La Terminal, Amazon…" value={establec} onChange={function(e){setEstablec(e.target.value);}}/>
            </F>
            <div>
              <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Factura de compra</div>
              {factura ? (
                <div style={{display:"flex",alignItems:"center",gap:12,background:C.surface,borderRadius:8,padding:"12px 14px",border:"1px solid "+C.line}}>
                  <span style={{fontSize:20}}>{factura.type&&factura.type.startsWith("image/")?"🖼️":"📄"}</span>
                  <span style={{fontSize:13,fontWeight:600,color:C.black,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{factura.name}</span>
                  <button onClick={function(){setFactura(null);}} style={{background:"none",border:"none",color:C.red,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
                </div>
              ) : (
                <button onClick={function(){if(facRef.current)facRef.current.click();}} style={{width:"100%",padding:"14px",borderRadius:8,border:"1.5px dashed "+C.line,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",fontSize:12.5,color:C.earth,fontWeight:600,fontFamily:"Montserrat,sans-serif",letterSpacing:".04em",transition:"background .2s"}}>
                  <span style={{fontSize:20}}>📎</span>Adjuntar factura (PDF o imagen)
                </button>
              )}
              <input ref={facRef} type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files[0]){var f=e.target.files[0];var r=new FileReader();r.onload=function(ev){setFactura({name:f.name,type:f.type,data:ev.target.result});};r.readAsDataURL(f);}e.target.value="";}}/>
            </div>
          </div>
        </Card>

        <BigBtn onClick={sub} dis={busy||!nombre||!precio}>{busy?"Guardando…":"Registrar producto →"}</BigBtn>
      </div>
    </div>
  );
}

/* ─── Ajuste Form (simplified, no photos) */
function AjusteForm({vendors,props,onSubmit,defaultVendor,onBack}) {
  const [motivo,  setMotivo]  = useState("");
  const [prop,    setProp]    = useState("");
  const [fecha,   setFecha]   = useState(todayStr());
  const [monto,   setMonto]   = useState("");
  const [coment,  setComent]  = useState("");
  const [busy,    setBusy]    = useState(false);
  const [done,    setDone]    = useState(false);

  async function sub() {
    if(!motivo||!prop)return;
    setBusy(true);
    await onSubmit({id:Date.now(),createdAt:Date.now(),categoria:"Ajuste",propiedad:prop,fecha:fecha,reportadoPor:defaultVendor||"",descripcion:coment?motivo+" — "+coment:motivo,comentarios:coment,total:monto,paid:false,pagadoPor:"",fotoAntes:[],fotoDespues:[],factura:null});
    setBusy(false);setDone(true);
  }

  if(done) return <SuccessScreen msg="¡Ajuste registrado!" sub="El ajuste quedó registrado correctamente."/>;

  return (
    <div style={{maxWidth:480,margin:"0 auto",padding:"24px 16px 90px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:10}}><button onClick={onBack} style={{background:"none",border:"none",color:C.earth,fontSize:12.5,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>← Cambiar tipo</button></div>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:9.5,fontWeight:600,color:C.earth,letterSpacing:".28em",textTransform:"uppercase",marginBottom:8}}>Ajuste</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:28,fontWeight:400,color:C.black}}>Nuevo registro de ajuste</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Card title="Motivo del ajuste">
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {MOTIVOS_AJUSTE.map(function(m){var s=motivo===m;return <button key={m} onClick={function(){setMotivo(s?"":m);}} style={{padding:"8px 14px",borderRadius:100,cursor:"pointer",border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:12.5,fontWeight:600,transition:"all .18s"}}>{s?"✓ ":""}{m}</button>;})}
          </div>
        </Card>
        <Card title="Detalles">
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Apartamento"><select value={prop} onChange={function(e){setProp(e.target.value);}}><option value="">Seleccionar…</option>{props.map(function(p){return <option key={p.id}>{p.name}</option>;})}</select></F>
            <F label="Fecha"><input type="date" value={fecha} onChange={function(e){setFecha(e.target.value);}}/></F>
            <F label="Monto (Q)"><input type="number" placeholder="Ej. 120" value={monto} onChange={function(e){setMonto(e.target.value);}}/></F>
          </div>
        </Card>
        <Card title="Comentarios">
          <F label="Notas adicionales"><textarea rows={3} placeholder="Detalles del ajuste, razón, observaciones…" value={coment} onChange={function(e){setComent(e.target.value);}}/></F>
        </Card>
        <BigBtn onClick={sub} dis={busy||!motivo||!prop}>{busy?"Guardando…":"Registrar ajuste →"}</BigBtn>
      </div>
    </div>
  );
}

/* ─── Reporte de Daños — standalone form */
function DanosFormSolo({vendors,props,onSubmit,defaultVendor,onBack}) {
  const [prop,    setProp]    = useState("");
  const [fecha,   setFecha]   = useState(todayStr());
  const [resp,    setResp]    = useState(defaultVendor||"");
  const [danios,  setDanios]  = useState([{desc:"",fotos:[],origen:"",reparacion:"",comentarios:"",fotos2:[],cobrado:false,quienPaga:""}]);
  const [busy,    setBusy]    = useState(false);
  const [done,    setDone]    = useState(false);

  function addDanio(){setDanios(function(p){return p.concat([{desc:"",fotos:[],origen:"",reparacion:"",comentarios:"",fotos2:[],cobrado:false,quienPaga:""}]);});}
  function rmDanio(idx){setDanios(function(p){return p.filter(function(_,j){return j!==idx;});});}
  function setD(idx,k,v){setDanios(function(p){return p.map(function(d,j){if(j!==idx)return d;var u=Object.assign({},d);u[k]=v;return u;});});}

  async function sub(){
    if(!prop||!resp)return;
    setBusy(true);
    var desc = danios.map(function(d,i){return "Daño "+(i+1)+": "+d.desc;}).join(" | ");
    try {
      await onSubmit({id:Date.now(),createdAt:Date.now(),categoria:"Reporte de Daños",propiedad:prop,fecha:fecha,reportadoPor:resp,descripcion:desc||"Reporte de daños",comentarios:"",total:"",paid:false,pagadoPor:"",fotoAntes:[],fotoDespues:[],factura:null,danios:danios,hayDanios:true});
      setDone(true);
    } catch(e) { console.error("Error al enviar reporte de daños"); }
    finally { setBusy(false); }
  }

  if(done) return <SuccessScreen msg="¡Reporte de daños enviado!" sub="El equipo de Spacio AM ha sido notificado."/>;

  return (
    <div style={{maxWidth:580,margin:"0 auto",padding:"24px 16px 90px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:10}}><button onClick={onBack} style={{background:"none",border:"none",color:C.earth,fontSize:12.5,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>← Cambiar tipo</button></div>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:11,color:C.red,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase",marginBottom:6}}>Reporte de Daños</div>
        <div style={{fontSize:22,fontWeight:400,color:C.black}}>Documentar daño encontrado</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Card title="Información básica">
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {defaultVendor
              ?<div style={{fontSize:14,fontWeight:600,color:C.black,background:C.surfaceWarm,padding:"11px 14px",borderRadius:10}}>{vendors.find(function(v){return v.email===defaultVendor;})?vendorDisplay(vendors.find(function(v){return v.email===defaultVendor;})):defaultVendor}</div>
              :<F label="Quien reporta"><select value={resp} onChange={function(e){setResp(e.target.value);}}><option value="">Seleccionar…</option>{vendors.filter(function(v){return v.active;}).map(function(v){return <option key={v.id} value={v.email}>{v.name}</option>;})}</select></F>
            }
            <F label="Propiedad"><select value={prop} onChange={function(e){setProp(e.target.value);}}><option value="">Seleccionar…</option>{props.map(function(p){return <option key={p.id}>{p.name}</option>;})}</select></F>
            <F label="Fecha"><input type="date" value={fecha} onChange={function(e){setFecha(e.target.value);}}/></F>
          </div>
        </Card>

        {danios.map(function(d,idx){return (
          <div key={idx} style={{background:"#fff",borderRadius:14,padding:"18px",border:"2px solid #f5c6a0"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,color:C.red,letterSpacing:".12em",textTransform:"uppercase"}}>Daño {idx+1}</div>
              {danios.length>1&&<button onClick={function(){rmDanio(idx);}} style={{background:"none",border:"none",color:C.gray,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <F label="Describe el daño"><textarea rows={3} placeholder="¿Qué fue dañado y cómo?" value={d.desc} onChange={function(e){setD(idx,"desc",e.target.value);}}/></F>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Fotos del daño</div>
                <MultiPhotoUp label="Fotos" photos={d.fotos} max={5} accent={C.peach} onAdd={function(files){var c=[...d.fotos];Promise.all(Array.from(files).slice(0,5-c.length).map(compress)).then(function(ds){setD(idx,"fotos",c.concat(ds).slice(0,5));});}} onDel={function(i){setD(idx,"fotos",d.fotos.filter(function(_,j){return j!==i;}));}}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Origen del daño</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["Estaba antes","Lo dejó el huésped","No estoy seguro"].map(function(op){return <ChipBtn key={op} active={d.origen===op} onClick={function(){setD(idx,"origen",op);}} color={C.earth}>{op}</ChipBtn>;})}</div>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>¿Se puede reparar?</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["Se puede reparar","Hay que reemplazar","No estoy seguro"].map(function(op){return <ChipBtn key={op} active={d.reparacion===op} onClick={function(){setD(idx,"reparacion",op);}} color={C.earth}>{op}</ChipBtn>;})}</div>
              </div>
              <div style={{borderTop:"1px solid "+C.gray,paddingTop:12}}>
                <F label="Notas internas / Acciones tomadas"><textarea rows={2} placeholder="Comentarios para el equipo…" value={d.comentarios} onChange={function(e){setD(idx,"comentarios",e.target.value);}}/></F>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Evidencia adicional</div>
                <MultiPhotoUp label="Fotos adicionales" photos={d.fotos2} max={3} accent={C.earth} onAdd={function(files){var c=[...d.fotos2];Promise.all(Array.from(files).slice(0,3-c.length).map(compress)).then(function(ds){setD(idx,"fotos2",c.concat(ds).slice(0,3));});}} onDel={function(i){setD(idx,"fotos2",d.fotos2.filter(function(_,j){return j!==i;}));}}/>
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:160}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>¿Ya se cobró?</div>
                  <div style={{display:"flex",gap:6}}>
                    <ChipBtn active={d.cobrado}  onClick={function(){setD(idx,"cobrado",true);}}  color={C.green}>✓ Cobrado</ChipBtn>
                    <ChipBtn active={!d.cobrado} onClick={function(){setD(idx,"cobrado",false);}} color={C.red}>Pendiente</ChipBtn>
                  </div>
                </div>
                <div style={{flex:1,minWidth:160}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>¿Quién paga?</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{["Airbnb","Seguro","Dueño","Spacio AM"].map(function(op){return <ChipBtn key={op} active={d.quienPaga===op} onClick={function(){setD(idx,"quienPaga",op);}} color={C.earth}>{op}</ChipBtn>;})}</div>
                </div>
              </div>
            </div>
          </div>
        );})}

        <button onClick={addDanio} style={{padding:"12px",borderRadius:12,border:"2px dashed "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Agregar otro daño</button>
        <BigBtn onClick={sub} dis={busy||!prop||!resp||!danios[0].desc}>{busy?"Enviando…":"Enviar reporte de daños →"}</BigBtn>
      </div>
    </div>
  );
}

/* ═══════════════ GATE DE FOTO DE REFERENCIA ═══════════════════════════
   Antes de fotografiar habitaciones, cocina y sala se obliga al técnico a
   ver la foto de referencia del anuncio. La decoración debe quedar idéntica. */
function ReferenciaGate({titulo, propObj, refKey, onContinue}) {
  var img = propObj && propObj.refImagenes ? propObj.refImagenes[refKey] : null;
  var fotos = refPhotosOf(propObj);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:"#FFF9E6",border:"1px solid #E6D88A",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#7a6000",marginBottom:6}}>Antes de fotografiar {titulo}</div>
        <div style={{fontSize:12.5,color:"#6b5a00",lineHeight:1.65}}>Revisa la <strong>foto de referencia</strong> del anuncio. Toda la decoración debe quedar <strong>idéntica</strong> a la referencia: cojines, mantas, objetos decorativos y su disposición exacta.</div>
      </div>
      {img
        ? <img src={img} alt={"Referencia — "+titulo} style={{width:"100%",borderRadius:14,border:"1px solid "+C.line,display:"block"}}/>
        : fotos.length
          ? <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{fotos.map(function(f,i){return <img key={i} src={f} alt={"Referencia "+(i+1)} loading="lazy" style={{width:"100%",height:140,objectFit:"cover",borderRadius:10,border:"1px solid "+C.line,display:"block"}}/>;})}</div>
          : <div style={{background:C.beige,borderRadius:12,padding:"14px 16px",fontSize:12.5,color:C.earth,lineHeight:1.6}}>Aún no hay foto de referencia cargada para esta propiedad. Asegúrate de dejar la decoración igual al estándar de la propiedad antes de continuar.</div>
      }
      <button onClick={onContinue} style={{padding:"14px",borderRadius:12,border:"none",background:C.black,color:"#fff",fontSize:13.5,fontWeight:700,cursor:"pointer",letterSpacing:".02em"}}>Ya he visualizado la foto de referencia, avanzar →</button>
    </div>
  );
}

/* Devuelve todas las fotos de referencia disponibles para una propiedad:
   refFotos (galería de Hospitable/portfolio) o las 3 imágenes subidas a mano. */
function refPhotosOf(propObj){
  if(!propObj) return [];
  if(Array.isArray(propObj.refFotos)&&propObj.refFotos.length) return propObj.refFotos;
  if(propObj.refImagenes){ var a=Object.keys(propObj.refImagenes).map(function(k){return propObj.refImagenes[k];}).filter(Boolean); if(a.length) return a; }
  return [];
}
function RefGallery({propObj, acked, onAck}){
  var fotos=refPhotosOf(propObj);
  if(!fotos.length) return null;
  return (
    <div style={{marginTop:8,background:"#FFF9E6",border:"1px solid #E6D88A",borderRadius:12,padding:"14px 16px"}}>
      <div style={{fontSize:12,fontWeight:700,color:"#7a6000",marginBottom:6}}>Fotos de referencia del anuncio</div>
      <div style={{fontSize:12,color:"#6b5a00",lineHeight:1.6,marginBottom:fotos.length?12:0}}>Revisa cómo debe quedar la propiedad. Toda la decoración debe quedar <strong>idéntica</strong> a estas fotos antes de empezar a limpiar.</div>
      {fotos.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{fotos.map(function(f,i){return <img key={i} src={f} alt={"Referencia "+(i+1)} loading="lazy" style={{width:"100%",height:120,objectFit:"cover",borderRadius:10,border:"1px solid "+C.line,display:"block"}}/>;})}</div>}
      {typeof onAck==="function"&&(acked
        ? <div style={{marginTop:12,display:"flex",alignItems:"center",gap:8,fontSize:12.5,fontWeight:700,color:C.green}}>✓ Referencia visualizada</div>
        : <button onClick={onAck} style={{marginTop:12,width:"100%",padding:"13px",borderRadius:10,border:"none",background:C.black,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",letterSpacing:".02em"}}>Ya he visualizado las fotos de referencia, avanzar</button>
      )}
    </div>
  );
}

/* ═══════════════ LIMPIEZA TRADICIONAL WIZARD ══════════════════════════ */
function LimpiezaTradForm({vendors,props,onSubmit,defaultVendor,onBack,onSaveFeedback}) {
  const STEPS = ["Bienvenida","País","Ciudad","Responsable","Propiedad","Habitaciones","Baños","Cocina","Sala y Comedor","Detalles finales","Inventario","Daños","Foto uniforme","Confirmación"];
  var TOTAL_STEPS_F = STEPS.length - 1;
  const [step,setStep]   = useState(0);
  const [errMsg,setErrMsg] = useState("");
  const [form,setForm] = useState({
    pais:"Guatemala", ciudad:"Ciudad de Guatemala",
    reportadoPor:defaultVendor||"", propiedad:"",
    fecha:todayStr(),
    fotosHabitaciones:[], fotoPisoGeneral:null,
    fotosBanos:[],
    fotosCocinaGeneral:null, fotosMicroondas:null, fotosCafetera:null, fotosEcofiltro:null, fotosLavatrastos:null, fotosRefrigerador:null, fotosInsumosLimpieza:null,
    fotosSalaGeneral:null, fotosComedorGeneral:null, fotosVasos:null, fotosPlatos:null,
    fotosTv:null, fotosSillon:null, fotosInsumos:null,
    fotosPrimeraImpresion:null, fotosPisoComun:null, fotosTrapeadores:null, fotosTarjetas:null,
    fotosDebajoCama:null, fotosCloset:null,
    inventario:INV_DEFAULT.map(function(i){return Object.assign({},i,{cantidad:i.countAlways?"":i.cantidad,malEstado:i.countAlways?"":undefined,estado:"ok",foto:null});}),
    hayDanios:false, danios:[], fotoUniforme:null,
    comentarios:"",
  });
  const [done,setDone]=useState(false);
  const [busy,setBusy]=useState(false);
  const [cuartosOv,setCuartosOv]=useState(null);
  const [banosOv,setBanosOv]=useState(null);
  const [refAck,setRefAck]=useState({gallery:false,hab:false,cocina:false,sala:false});
  const [fixMode,setFixMode]=useState(false);
  const [invOnlyPend,setInvOnlyPend]=useState(false);
  /* Al cambiar de propiedad, los conteos vuelven a tomar el valor de la propiedad */
  useEffect(function(){ setCuartosOv(null); setBanosOv(null); setRefAck({gallery:false,hab:false,cocina:false,sala:false}); setFixMode(false); setInvOnlyPend(false); }, [form.propiedad]);

  /* ── Borrador automático: recuperar si recargan o cambian de pestaña a medio formulario */
  var draftKey = "trad:"+(defaultVendor||"anon");
  const [resumeData,setResumeData] = useState(null);
  const [draftReady,setDraftReady] = useState(false);
  useEffect(function(){
    var alive=true;
    draftLoad(draftKey).then(function(d){ if(!alive) return; if(d&&d.form&&d.step>0) setResumeData(d); setDraftReady(true); });
    return function(){alive=false;};
  },[]);
  useEffect(function(){
    if(!draftReady||done||resumeData||step===0) return;
    var t=setTimeout(function(){ draftSave(draftKey,{form:form,step:step,ts:Date.now()}); },600);
    return function(){clearTimeout(t);};
  },[form,step,done,draftReady,resumeData]);
  useEffect(function(){ if(done) draftDel(draftKey); },[done]);
  function doResume(){ var d=resumeData; if(d){ setForm(d.form); setStep(d.step); } setResumeData(null); }
  function doFresh(){ draftDel(draftKey); setResumeData(null); }

  function sf(k,v){setForm(function(p){var u=Object.assign({},p);u[k]=v;return u;});}

  var propObj = props.find(function(p){return p.name===form.propiedad;})||{};
  var cuartos  = cuartosOv!=null ? cuartosOv : (propObj.cuartos||1);
  var banos    = banosOv!=null ? banosOv : (propObj.banos||1);
  var stepBtnStyle={width:34,height:34,borderRadius:9,border:"1px solid "+C.line,background:"#fff",fontSize:20,fontWeight:700,color:C.earth,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"};

  /* Fotos obligatorias por espacio (paridad con el checklist Turno; la decoración debe igualar la referencia) */
  var okHab    = Array.from({length:cuartos}).every(function(_,i){return !!form.fotosHabitaciones[i];});
  var okBanos  = Array.from({length:banos}).every(function(_,i){var b=form.fotosBanos[i]||{};return !!(b.ducha&&b.inodoro);});
  var okCocina = !!(form.fotosCocinaGeneral&&form.fotosMicroondas&&form.fotosCafetera&&form.fotosEcofiltro&&form.fotosLavatrastos&&form.fotosRefrigerador&&form.fotosInsumosLimpieza);
  var okSala   = !!(form.fotosSalaGeneral&&form.fotosComedorGeneral);
  var okDetalles = !!(form.fotosPrimeraImpresion&&form.fotosPisoComun&&form.fotosTrapeadores&&form.fotosTarjetas&&form.fotosCloset);
  var invPend  = form.inventario.filter(function(it){
    if(!it.countAlways) return false;
    if(it.cantidad===""||it.cantidad===null||it.cantidad===undefined||isNaN(parseInt(it.cantidad))) return true;
    if(parseInt(it.malEstado||0)>0 && !it.foto) return true;
    return false;
  });
  function missingPhotoList(){
    var m=[];
    Array.from({length:cuartos}).forEach(function(_,i){if(!form.fotosHabitaciones[i])m.push("Cuarto "+(i+1));});
    Array.from({length:banos}).forEach(function(_,i){var b=form.fotosBanos[i]||{};if(!b.ducha)m.push("Baño "+(i+1)+" — ducha");if(!b.inodoro)m.push("Baño "+(i+1)+" — inodoro");});
    if(!form.fotosCocinaGeneral)m.push("Cocina — general");
    if(!form.fotosMicroondas)m.push("Cocina — microondas");
    if(!form.fotosCafetera)m.push("Cocina — cafetera");
    if(!form.fotosEcofiltro)m.push("Cocina — ecofiltro");
    if(!form.fotosLavatrastos)m.push("Cocina — lavaplatos");
    if(!form.fotosRefrigerador)m.push("Cocina — refrigerador");
    if(!form.fotosInsumosLimpieza)m.push("Cocina — insumos de limpieza");
    if(!form.fotosSalaGeneral)m.push("Sala — general");
    if(!form.fotosComedorGeneral)m.push("Comedor — general");
    if(!form.fotosPrimeraImpresion)m.push("Detalles — primera impresión");
    if(!form.fotosPisoComun)m.push("Detalles — piso de área común");
    if(!form.fotosTrapeadores)m.push("Detalles — trapeadores y trapos");
    if(!form.fotosTarjetas)m.push("Detalles — tarjetas de acceso");
    if(!form.fotosCloset)m.push("Detalles — blancos en clóset");
    return m;
  }

  function buildPendientes(){
    var out=[];
    Array.from({length:cuartos}).forEach(function(_,i){
      if(!form.fotosHabitaciones[i]) out.push({id:"hab"+i,label:"Habitaciones — cuarto "+(i+1)+" (foto general)",
        node:<SinglePhotoUp foto={form.fotosHabitaciones[i]||null} accent={C.earth} onAdd={function(f){compress(f).then(function(d){var arr=[...form.fotosHabitaciones];arr[i]=d;sf("fotosHabitaciones",arr);});}} onDel={function(){var arr=[...form.fotosHabitaciones];arr[i]=null;sf("fotosHabitaciones",arr);}}/>});
    });
    Array.from({length:banos}).forEach(function(_,i){
      var b=form.fotosBanos[i]||{};
      function updB(field,val){var arr=[...form.fotosBanos];arr[i]=Object.assign({},form.fotosBanos[i]||{},{[field]:val});sf("fotosBanos",arr);}
      if(!b.ducha) out.push({id:"banoD"+i,label:"Baño "+(i+1)+" — ducha",
        node:<SinglePhotoUp foto={(form.fotosBanos[i]||{}).ducha||null} accent="#3a8fa3" onAdd={function(f){compress(f).then(function(d){updB("ducha",d);});}} onDel={function(){updB("ducha",null);}}/>});
      if(!b.inodoro) out.push({id:"banoI"+i,label:"Baño "+(i+1)+" — inodoro",
        node:<SinglePhotoUp foto={(form.fotosBanos[i]||{}).inodoro||null} accent="#3a8fa3" onAdd={function(f){compress(f).then(function(d){updB("inodoro",d);});}} onDel={function(){updB("inodoro",null);}}/>});
    });
    TRAD_SINGLE_PHOTOS.forEach(function(p){
      if(!form[p[0]]) out.push({id:p[0],label:p[1],
        node:<SinglePhotoUp foto={form[p[0]]||null} accent={C.earth} onAdd={function(f){compress(f).then(function(d){sf(p[0],d);});}} onDel={function(){sf(p[0],null);}}/>});
    });
    form.inventario.forEach(function(it,idx){
      if(!it.countAlways) return;
      function setInv(k,v){var arr=form.inventario.map(function(x,j){if(j!==idx)return x;var u=Object.assign({},x);u[k]=v;return u;});sf("inventario",arr);}
      var noCount=it.cantidad===""||it.cantidad===null||it.cantidad===undefined||isNaN(parseInt(it.cantidad));
      if(noCount){ out.push({id:"invc"+idx,label:"Inventario — "+it.name+" (conteo)",
        node:<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <F label="¿Cuántas hay en total?"><input type="number" min="0" placeholder="0" value={it.cantidad} onChange={function(e){setInv("cantidad",e.target.value===""?"":(parseInt(e.target.value)||0));}}/></F>
          <F label="¿Cuántas en mal estado?"><input type="number" min="0" placeholder="0" value={it.malEstado===undefined?"":it.malEstado} onChange={function(e){setInv("malEstado",e.target.value===""?"":(parseInt(e.target.value)||0));}}/></F>
        </div>});
      } else if(parseInt(it.malEstado||0)>0 && !it.foto){ out.push({id:"invf"+idx,label:"Inventario — "+it.name+" (foto de piezas en mal estado)",
        node:<SinglePhotoUp foto={it.foto} accent={C.red} onAdd={function(f){compress(f).then(function(d){setInv("foto",d);});}} onDel={function(){setInv("foto",null);}}/>});
      }
    });
    return out;
  }
  var pendientes = buildPendientes();

  function next(){if(step<STEPS.length-1)setStep(function(s){return s+1;});}
  function prev(){if(step>0)setStep(function(s){return s-1;});}

  async function submitTrad() {
    if (pendientes.length>0) { setErrMsg("Te faltan algunos datos obligatorios. Complétalos abajo para poder finalizar tu reporte."); setFixMode(true); return; }
    var missing = missingPhotoList();
    if (missing.length>0) {
      setErrMsg("⚠ Faltan fotos obligatorias (1 por espacio): "+missing.join(", ")+". Regresa y súbelas para poder enviar el reporte.");
      try{ alert("No se puede enviar el reporte.\n\nFaltan fotos obligatorias de: "+missing.join(", ")+".\n\nSe requiere al menos 1 foto de cada espacio."); }catch(_){}
      return;
    }
    if (invPend.length>0) {
      setErrMsg("⚠ Completa el conteo de blancos en el inventario: "+invPend.map(function(x){return x.name;}).join(", ")+".");
      try{ alert("No se puede enviar el reporte.\n\nCompleta el conteo de toallas y sábanas (y la foto si hay piezas en mal estado)."); }catch(_){}
      return;
    }
    setBusy(true);
    var vend = vendors.find(function(v){return v.email===form.reportadoPor;});
    var tarifa = vend&&vend.tarifaLimpieza ? String(vend.tarifaLimpieza) : "";
    var rep = Object.assign({},form,{
      id:Date.now(), createdAt:Date.now(),
      cuartos:cuartos, banos:banos,
      categoria:"Limpieza tradicional",
      descripcion:"Limpieza tradicional — "+form.propiedad,
      total:tarifa, paid:false, pagadoPor:"Spacio AM",
      fotoAntes:[], fotoDespues:[], factura:null,
      qaStatus:"pendiente", qaComentario:"", qaFecha:"", qaRespuesta:null, qaRespuestaFecha:"",
    });
    try {
      await onSubmit(rep);
      /* Notificar a supervisión: limpieza terminada, requiere revisión */
      try{
        var supsT=supervisorEmails(vendors, form.reportadoPor);
        if(supsT.length){
          var tnT=(vendors.find(function(v){return v.email===form.reportadoPor;})||{}).name||form.reportadoPor;
          notifyEmail(supsT, "Limpieza lista para supervisión — "+form.propiedad, tnT+" terminó una limpieza en "+form.propiedad+" ("+fmtDate(form.fecha)+").\n\nEntra a la pestaña Supervisión del app para revisarla.\n\nEPI App — Spacio AM");
        }
      }catch(_){}
      /* Auto-crear SIEMPRE el reporte de daños independiente cuando se reportó daño */
      if (form.hayDanios && form.danios && form.danios.length>0) {
        var baseId = rep.id;
        var dmgDesc = form.danios.map(function(d,i){return "Daño "+(i+1)+": "+d.desc;}).join(" | ");
        /* El reporte de daños lleva sus propias fotos (se suben de forma independiente) */
        var dmgDanios = (form.danios||[]).map(function(d){ return Object.assign({},d); });
        var dmgRep = {
          id: baseId+1, createdAt: baseId+1,
          categoria:"Reporte de Daños",
          propiedad: form.propiedad,
          fecha: form.fecha,
          reportadoPor: form.reportadoPor,
          descripcion: dmgDesc||"Daños encontrados durante limpieza",
          comentarios: "Generado automáticamente desde reporte de limpieza #"+baseId,
          total:"", paid:false, pagadoPor:"",
          fotoAntes:[], fotoDespues:[], factura:null,
          danios: dmgDanios, hayDanios:true,
          _linkedToReport: String(baseId),
        };
        try { await onSubmit(dmgRep); }
        catch(dmgErr) {
          /* Nunca perder el reporte de daños: si falla, se encola y se reintenta solo */
          console.error("Damage report failed, queued for retry:",dmgErr);
          try{ rq_add(dmgRep); }catch(_){}
        }
      }
      setDone(true);
    } catch(e) {
      setErrMsg("Error al enviar: "+(e&&e.message?e.message:"verifica tu conexión e intenta de nuevo."));
    } finally { setBusy(false); }
  }

  if (done) return <SuccessScreen msg="¡Reporte de limpieza enviado!" sub="Gracias por tu compromiso. Este reporte nos ayuda a mantener el estándar de excelencia de Spacio AM."/>;

  var pct = Math.round((step/(STEPS.length-1))*100);

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"0 0 80px",fontFamily:"Montserrat,sans-serif"}}>
      <ResumeDraftModal data={resumeData} stepLabel={resumeData?STEPS[resumeData.step]:""} onResume={doResume} onFresh={doFresh}/>
      {/* Progress bar */}
      {step>0&&step<STEPS.length-1&&(
        <div style={{position:"sticky",top:58,zIndex:20,background:"#fff",borderBottom:"1px solid "+C.gray,padding:"12px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>{STEPS[step]}</span>
            <span style={{fontSize:10,color:C.earth}}>{step} / {STEPS.length-2}</span>
          </div>
          <div style={{background:C.gray,borderRadius:2,height:3}}><div style={{width:pct+"%",height:"100%",borderRadius:2,background:C.earth,transition:"width .3s"}}/></div>
        </div>
      )}

      <div style={{padding:"28px 18px"}}>

        {/* STEP 0: Bienvenida */}
        {step===0&&(
          <div style={{textAlign:"center",padding:"20px 0 40px"}}>
            <div style={{fontSize:48,marginBottom:20}}>🧹</div>
            <div style={{fontSize:11,color:C.peach,fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",marginBottom:10}}>Spacio AM</div>
            <div style={{fontSize:24,fontWeight:400,color:C.black,marginBottom:14,lineHeight:1.4}}>Bienvenido al Reporte de Limpieza</div>
            <div style={{fontSize:14,color:C.earth,lineHeight:1.7,marginBottom:32}}>Gracias por tu dedicación. Vamos a guiarte paso a paso para completar el control de calidad de esta limpieza.</div>
            <button onClick={next} style={{padding:"14px 36px",borderRadius:100,border:"none",background:C.black,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",letterSpacing:".08em"}}>Empezar →</button>
            <div style={{marginTop:16}}><button onClick={onBack} style={{background:"none",border:"none",color:C.earth,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>← Volver al formulario general</button></div>
          </div>
        )}

        {/* STEP 1: País */}
        {step===1&&(
          <WizStep title="¿En qué país estás realizando la limpieza?" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={!!form.pais}>
            <F label="País">
              <select value={form.pais} onChange={function(e){sf("pais",e.target.value);sf("ciudad",Object.keys(GEO).indexOf(e.target.value)>=0?GEO[e.target.value][0]:"");}}>
                {Object.keys(GEO).map(function(p){return <option key={p}>{p}</option>;})}
              </select>
            </F>
          </WizStep>
        )}

        {/* STEP 2: Ciudad */}
        {step===2&&(
          <WizStep title="¿En qué ciudad estás trabajando hoy?" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={!!form.ciudad}>
            <F label="Ciudad">
              <select value={form.ciudad} onChange={function(e){sf("ciudad",e.target.value);}}>
                {(GEO[form.pais]||[]).map(function(c){return <option key={c}>{c}</option>;})}
              </select>
            </F>
          </WizStep>
        )}

        {/* STEP 3: Responsable */}
        {step===3&&(
          <WizStep title="¿Quién está realizando esta limpieza?" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={!!form.reportadoPor}>
            {defaultVendor
              ?<div style={{fontSize:14,fontWeight:600,color:C.black,background:C.beige,padding:"14px",borderRadius:12}}>{vendors.find(function(v){return v.email===defaultVendor;})?vendors.find(function(v){return v.email===defaultVendor;}).name:defaultVendor}</div>
              :<F label="Cleaner / Responsable"><select value={form.reportadoPor} onChange={function(e){sf("reportadoPor",e.target.value);}}><option value="">Seleccionar…</option>{vendors.filter(function(v){return v.active;}).map(function(v){return <option key={v.id} value={v.email}>{v.name}</option>;})}</select></F>
            }
          </WizStep>
        )}

        {/* STEP 4: Propiedad */}
        {step===4&&(
          <WizStep title="¿Qué propiedad estás limpiando?" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={!!form.propiedad&&(refPhotosOf(propObj).length===0?true:refAck.gallery)}>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <F label="Propiedad"><select value={form.propiedad} onChange={function(e){sf("propiedad",e.target.value);}}><option value="">Seleccionar…</option>{props.map(function(p){return <option key={p.id}>{p.name}</option>;})}</select></F>
              <F label="Fecha de limpieza"><input type="date" value={form.fecha} onChange={function(e){sf("fecha",e.target.value);}}/></F>
            </div>
            {form.propiedad&&<RefGallery propObj={propObj} acked={refAck.gallery} onAck={function(){setRefAck(function(p){return Object.assign({},p,{gallery:true});});}}/>}
          </WizStep>
        )}

        {/* STEP 5: Habitaciones */}
        {step===5&&(
          <WizStep title="Fotos de habitaciones" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={refAck.hab&&okHab}>
            {!refAck.hab
              ? <ReferenciaGate titulo="las habitaciones" propObj={propObj} refKey="habitacion" onContinue={function(){setRefAck(function(p){return Object.assign({},p,{hab:true});});}}/>
              : <>
              {!okHab&&<PhotoReqWarn msg="Falta la foto general de al menos un cuarto — es obligatoria para continuar."/>}
              <div style={{display:"flex",flexDirection:"column",gap:20}}>
                <div style={{fontSize:13,color:C.earth,lineHeight:1.6,background:C.surfaceWarm,padding:"11px 14px",borderRadius:8,border:"1px solid "+C.line}}>Sube una foto general de cada habitación mostrando la cama completa y un ángulo abierto del cuarto.</div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:C.beige,borderRadius:10,padding:"10px 14px"}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.black}}>¿Cuántos cuartos tiene la propiedad?</div>
                  <div style={{display:"flex",alignItems:"center",gap:14}}>
                    <button type="button" onClick={function(){setCuartosOv(Math.max(1,cuartos-1));}} style={stepBtnStyle}>−</button>
                    <div style={{fontSize:17,fontWeight:700,minWidth:22,textAlign:"center",color:C.black}}>{cuartos}</div>
                    <button type="button" onClick={function(){setCuartosOv(Math.min(12,cuartos+1));}} style={stepBtnStyle}>+</button>
                  </div>
                </div>
                {Array.from({length:cuartos},function(_,i){
                  var foto=form.fotosHabitaciones[i]||null;
                  var debajo=(form.fotosDebajoCamaArr||[])[i]||null;
                  return (
                    <div key={i} style={{background:C.beige,borderRadius:12,padding:"14px"}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.black,marginBottom:12}}>Cuarto {i+1}</div>
                      <div style={{fontSize:11,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase",marginBottom:8}}>Foto general (obligatoria)</div>
                      <SinglePhotoUp foto={foto} accent={C.earth} onAdd={function(f){compress(f).then(function(d){var arr=[...form.fotosHabitaciones];arr[i]=d;sf("fotosHabitaciones",arr);});}} onDel={function(){var arr=[...form.fotosHabitaciones];arr[i]=null;sf("fotosHabitaciones",arr);}}/>
                      <div style={{fontSize:11,color:C.earth,fontWeight:600,margin:"14px 0 8px"}}>Debajo de la cama (opcional)</div>
                      <SinglePhotoUp foto={debajo} accent={C.earth} onAdd={function(f){compress(f).then(function(d){var arr=[...(form.fotosDebajoCamaArr||[])];arr[i]=d;sf("fotosDebajoCamaArr",arr);});}} onDel={function(){var arr=[...(form.fotosDebajoCamaArr||[])];arr[i]=null;sf("fotosDebajoCamaArr",arr);}}/>
                    </div>
                  );
                })}
              </div>
              </>
            }
          </WizStep>
        )}

        {/* STEP 6: Baños */}
        {step===6&&(
          <WizStep title="Fotos de baños" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={okBanos}>
            {!okBanos&&<PhotoReqWarn msg="Cada baño necesita foto de ducha y de inodoro — son obligatorias para continuar."/>}
            <div style={{display:"flex",flexDirection:"column",gap:24}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:C.beige,borderRadius:10,padding:"10px 14px"}}>
                <div style={{fontSize:12,fontWeight:700,color:C.black}}>¿Cuántos baños tiene la propiedad?</div>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <button type="button" onClick={function(){setBanosOv(Math.max(1,banos-1));}} style={stepBtnStyle}>−</button>
                  <div style={{fontSize:17,fontWeight:700,minWidth:22,textAlign:"center",color:C.black}}>{banos}</div>
                  <button type="button" onClick={function(){setBanosOv(Math.min(12,banos+1));}} style={stepBtnStyle}>+</button>
                </div>
              </div>
              {Array.from({length:banos},function(_,i){
                var bano=form.fotosBanos[i]||{ducha:null,inodoro:null};
                function updateBano(field,val){var arr=[...form.fotosBanos];arr[i]=Object.assign({},bano,{[field]:val});sf("fotosBanos",arr);}
                return (
                  <div key={i} style={{background:C.beige,borderRadius:12,padding:"14px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.black,marginBottom:14}}>Baño {i+1}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      <div>
                        <div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Ducha</div>
                        <SinglePhotoUp foto={bano.ducha} accent="#3a8fa3" onAdd={function(f){compress(f).then(function(d){updateBano("ducha",d);});}} onDel={function(){updateBano("ducha",null);}}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Inodoro</div>
                        <SinglePhotoUp foto={bano.inodoro} accent="#3a8fa3" onAdd={function(f){compress(f).then(function(d){updateBano("inodoro",d);});}} onDel={function(){updateBano("inodoro",null);}}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Papel toilet que estás dejando <span style={{color:C.taupe,fontWeight:500}}>(opcional)</span></div>
                        <SinglePhotoUp foto={bano.papel} accent="#3a8fa3" onAdd={function(f){compress(f).then(function(d){updateBano("papel",d);});}} onDel={function(){updateBano("papel",null);}}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </WizStep>
        )}

        {/* STEP 7: Cocina */}
        {step===7&&(
          <WizStep title="Cocina" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={refAck.cocina&&okCocina}>
            {!refAck.cocina
              ? <ReferenciaGate titulo="la cocina" propObj={propObj} refKey="cocina" onContinue={function(){setRefAck(function(p){return Object.assign({},p,{cocina:true});});}}/>
              : <>
              {!okCocina&&<PhotoReqWarn msg="Todas las fotos de cocina son obligatorias — súbelas para continuar."/>}
              <div style={{fontSize:12,color:C.earth,background:C.surfaceWarm,padding:"9px 13px",borderRadius:8,border:"1px solid "+C.line,marginBottom:14}}>Sube cada foto de la cocina. Todas son obligatorias.</div>
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {[
                  ["fotosCocinaGeneral","Foto general de la cocina"],
                  ["fotosMicroondas","Microondas limpio (puerta abierta)"],
                  ["fotosCafetera", "Cafetera limpia (recipiente y filtro)"],
                  ["fotosEcofiltro", "Ecofiltro lleno"],
                  ["fotosLavatrastos","Lavaplatos limpio y seco"],
                  ["fotosRefrigerador","Refrigerador abierto y sin vacío"],
                  ["fotosInsumosLimpieza","Insumos de limpieza (en donde se miren todos)"],
                ].map(function(item){
                  var key=item[0]; var lbl=item[1];
                  return (
                    <div key={key}>
                      <div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>{lbl} {!form[key]&&<span style={{color:C.peach,fontWeight:700}}>·obligatoria</span>}</div>
                      <SinglePhotoUp foto={form[key]} accent={C.peach} onAdd={function(f){compress(f).then(function(d){sf(key,d);});}} onDel={function(){sf(key,null);}}/>
                    </div>
                  );
                })}
              </div>
              </>
            }
          </WizStep>
        )}

        {/* STEP 8: Sala y Comedor */}
        {step===8&&(
          <WizStep title="Sala y Comedor" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={refAck.sala&&okSala}>
            {!refAck.sala
              ? <ReferenciaGate titulo="la sala y el comedor" propObj={propObj} refKey="sala" onContinue={function(){setRefAck(function(p){return Object.assign({},p,{sala:true});});}}/>
              : <>
              {!okSala&&<PhotoReqWarn msg="La foto general de la sala y la del comedor son obligatorias para continuar."/>}
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {[
                  ["fotosSalaGeneral","Foto general de la sala (sala completa y ángulo abierto)",true],
                  ["fotosComedorGeneral","Foto general del comedor",true],
                  ["fotosSillon","Sillón visto desde arriba (para ver manchas)",false],
                  ["fotosTv","TV encendida",false],
                  ["fotosVasos","Vasos disponibles en la propiedad",false],
                  ["fotosPlatos","Platos disponibles en la propiedad",false],
                  ["fotosInsumos","Insumos de cortesía (café, azúcar, jabón, papel, etc.)",false],
                ].map(function(item){
                  var key=item[0]; var lbl=item[1]; var req=item[2];
                  return (
                    <div key={key}>
                      <div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>{lbl} {req?(!form[key]&&<span style={{color:C.peach,fontWeight:700}}>·obligatoria</span>):<span style={{color:C.taupe,fontWeight:500}}>(opcional)</span>}</div>
                      <SinglePhotoUp foto={form[key]} accent={C.earth} onAdd={function(f){compress(f).then(function(d){sf(key,d);});}} onDel={function(){sf(key,null);}}/>
                    </div>
                  );
                })}
              </div>
              </>
            }
          </WizStep>
        )}

        {/* STEP 9: Detalles finales */}
        {step===9&&(
          <WizStep title="Detalles finales" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={okDetalles}>
            {!okDetalles&&<PhotoReqWarn msg="Faltan fotos obligatorias de detalles — súbelas para continuar."/>}
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {[
                ["fotosPrimeraImpresion","Primera impresión al entrar (desde la puerta de entrada)",true],
                ["fotosPisoComun","Piso de un área común (sala, comedor o cocina)",true],
                ["fotosTrapeadores","Trapeadores y trapos limpios",true],
                ["fotosTarjetas","Tarjetas de acceso (en el locker o lugar asignado)",true],
                ["fotosCloset","Clóset con los blancos ordenados (toallas y sábanas)",true],
              ].map(function(item){
                var key=item[0]; var lbl=item[1];
                return (
                  <div key={key}>
                    <div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>{lbl} {!form[key]&&<span style={{color:C.peach,fontWeight:700}}>·obligatoria</span>}</div>
                    <SinglePhotoUp foto={form[key]} accent={C.earth} onAdd={function(f){compress(f).then(function(d){sf(key,d);});}} onDel={function(){sf(key,null);}}/>
                  </div>
                );
              })}
            </div>
          </WizStep>
        )}

        {/* STEP 10: Inventario */}
        {step===10&&(
          <WizStep title="Inventario de la propiedad" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext={invPend.length===0}
            pendingHint={"Aún falta el conteo de: "+invPend.map(function(x){return x.name;}).join(", ")+(invPend.some(function(x){return parseInt(x.malEstado||0)>0&&!x.foto;})?" (y la foto de las piezas en mal estado)":"")+". Toca el botón para ir directo a esos campos."}
            onFillPending={function(){setInvOnlyPend(true);}}>
            {invPend.length>0&&<PhotoReqWarn msg={"Completa el conteo de: "+invPend.map(function(x){return x.name;}).join(", ")+(invPend.some(function(x){return parseInt(x.malEstado||0)>0&&!x.foto;})?" — incluye la foto de las piezas en mal estado":"")+"."}/>}
            {invOnlyPend&&invPend.length>0&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:"#FEF0EC",border:"1px solid #e9c2a0",borderRadius:8,padding:"9px 13px"}}><span style={{fontSize:12,fontWeight:700,color:"#b5622a"}}>Mostrando solo lo que falta</span><button onClick={function(){setInvOnlyPend(false);}} style={{background:"none",border:"none",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>Ver todo el inventario</button></div>}
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              <div style={{fontSize:13,color:C.earth,lineHeight:1.6,background:C.surfaceWarm,padding:"11px 14px",borderRadius:8,border:"1px solid "+C.line,marginBottom:10}}>Verifica que todos los ítems estén presentes y en buen estado. Marca los que faltan o están dañados.</div>
              {form.inventario.map(function(item,idx){
                function setInv(k,v){var arr=form.inventario.map(function(x,j){if(j!==idx)return x;var u=Object.assign({},x);u[k]=v;return u;});sf("inventario",arr);}
                var isOk=item.estado==="ok";
                if(invOnlyPend&&invPend.length>0&&!invPend.some(function(p){return p.id===item.id;})) return null;
                return (
                  <div key={item.id} style={{background:"#fff",borderRadius:12,padding:"13px 15px",border:"1.5px solid "+(isOk?C.gray:"#e9826a"),marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:isOk?0:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:600,color:C.black}}>{item.name}</div>
                        {item.note&&<div style={{fontSize:11,color:C.earth,marginTop:2}}>{item.note}</div>}
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={function(){setInv("estado","ok");}} style={{padding:"5px 11px",borderRadius:100,border:"none",fontSize:11,fontWeight:700,cursor:"pointer",background:isOk?C.surfaceWarm:"#f5f5f5",color:isOk?C.green:C.taupe}}>✓ OK</button>
                        <button onClick={function(){setInv("estado","falta");}} style={{padding:"5px 11px",borderRadius:100,border:"none",fontSize:11,fontWeight:700,cursor:"pointer",background:!isOk?"#FEF0EC":"#f5f5f5",color:!isOk?C.peach:C.gray}}>✗ Falta</button>
                      </div>
                    </div>
                    {item.countAlways&&<div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <F label="¿Cuántas hay en total?"><input type="number" min="0" placeholder="0" value={item.cantidad} onChange={function(e){setInv("cantidad",e.target.value===""?"":(parseInt(e.target.value)||0));}}/></F>
                      <F label="¿Cuántas en mal estado?"><input type="number" min="0" placeholder="0" value={item.malEstado===undefined?"":item.malEstado} onChange={function(e){setInv("malEstado",e.target.value===""?"":(parseInt(e.target.value)||0));}}/></F>
                    </div>}
                    {item.countAlways&&parseInt(item.malEstado||0)>0&&<div style={{marginTop:10}}>
                      <div style={{fontSize:10,color:C.red,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>Foto de las piezas en mal estado (obligatoria)</div>
                      <SinglePhotoUp foto={item.foto} accent={C.red} onAdd={function(f){compress(f).then(function(d){setInv("foto",d);});}} onDel={function(){setInv("foto",null);}}/>
                    </div>}
                    {!isOk&&!item.countAlways&&<div style={{marginTop:8}}>
                      <F label="Cantidad"><input type="number" min="0" value={item.cantidad} onChange={function(e){setInv("cantidad",parseInt(e.target.value)||0);}}/></F>
                    </div>}
                    {item.requirePhoto&&<div style={{marginTop:10}}><div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>{item.optionalPhoto?"Foto (opcional) — solo si hay objetos olvidados":"Foto requerida"}</div><SinglePhotoUp foto={item.foto} accent={C.earth} onAdd={function(f){compress(f).then(function(d){setInv("foto",d);});}} onDel={function(){setInv("foto",null);}}/></div>}
                  </div>
                );
              })}
            </div>
          </WizStep>
        )}

        {/* STEP 11: Daños */}
        {step===11&&(
          <WizStep title="Reporte de daños" step={step} total={STEPS.length-2} onPrev={prev} onNext={next} canNext>
            <DaniosSection form={form} sf={sf}/>
          </WizStep>
        )}

        {/* STEP 12: Foto uniforme */}
        {step===12&&(
          <WizStep title="Foto en uniforme" step={step} total={STEPS.length-2} onPrev={prev} onNext={function(){
            if(!form.fotoUniforme){sf("_uniWarn","noPhoto");}
            next();
          }} canNext>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{background:"#EDF5EF",borderRadius:8,padding:"12px 14px",border:"1px solid #c8dfc8",fontSize:13,color:C.black,lineHeight:1.7,fontWeight:500}}>
                📸 Tómate una foto con la <strong>cámara</strong> usando tu uniforme completo:<br/>
                <span style={{fontSize:11.5,color:C.earth}}>✓ Playera Spacio AM &nbsp;·&nbsp; ✓ Gorra Spacio AM</span>
              </div>
              <SinglePhotoUp
                foto={form.fotoUniforme}
                accent={C.earth}
                cameraOnly={true}
                label="Tomar foto con uniforme"
                onAdd={function(f){compress(f).then(function(d){sf("fotoUniforme",d);sf("_uniWarn",null);});}}
                onDel={function(){sf("fotoUniforme",null);}}
              />
              {form.fotoUniforme&&(
                <div style={{background:"#FFF9E6",borderRadius:8,padding:"10px 14px",border:"1px solid #E6D88A"}}>
                  <div style={{fontSize:12.5,fontWeight:700,color:"#7a6000",marginBottom:4}}>¿Llevas la gorra?</div>
                  <div style={{display:"flex",gap:8}}>
                    {[["si","✓ Sí, llevo gorra"],["no","✗ No llevo gorra"]].map(function(it){
                      var sel=form._gorraOk===it[0];
                      return <button key={it[0]} onClick={function(){sf("_gorraOk",it[0]);}} style={{flex:1,padding:"8px",borderRadius:7,border:"1.5px solid "+(sel?C.black:C.gray),background:sel?C.black:"#fff",color:sel?"#fff":C.earth,fontSize:12,fontWeight:600,cursor:"pointer"}}>{it[1]}</button>;
                    })}
                  </div>
                  {form._gorraOk==="no"&&<div style={{marginTop:8,fontSize:12,color:"#b5622a",fontWeight:600}}>⚠ Recuerda que el uniforme consiste en playera y gorra. No olvides llevar tu gorra pues es parte esencial del uniforme.</div>}
                </div>
              )}
              {!form.fotoUniforme&&<div style={{fontSize:11.5,color:"#b5622a",textAlign:"center",fontWeight:600}}>⚠ La foto es obligatoria antes de continuar</div>}
            </div>
          </WizStep>
        )}

        {/* STEP 13: Confirmación */}
        {step===13&&(fixMode?(
          <div>
            <div style={{textAlign:"center",marginBottom:22}}>
              <div style={{fontSize:11,color:C.peach,fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",marginBottom:10}}>Completa lo que falta</div>
              <div style={{fontSize:21,fontWeight:600,color:C.black,marginBottom:8}}>{pendientes.length>0?("Te faltan "+pendientes.length+" dato"+(pendientes.length===1?"":"s")+" por llenar"):"¡Todo listo!"}</div>
              <div style={{fontSize:13.5,color:C.earth,lineHeight:1.7}}>{pendientes.length>0?"Llena únicamente los campos de abajo y luego presiona Finalizar. No tienes que repasar todo el formulario.":"Ya completaste todos los datos pendientes. Presiona Finalizar para enviar tu reporte."}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {pendientes.map(function(p){return (
                <div key={p.id} style={{background:C.beige,borderRadius:12,padding:"14px"}}>
                  <div style={{fontSize:12.5,fontWeight:700,color:C.black,marginBottom:10}}>{p.label}</div>
                  {p.node}
                </div>
              );})}
            </div>
            {errMsg&&pendientes.length===0&&<div style={{marginTop:14,padding:"12px 14px",borderRadius:8,background:"#F5EDEC",color:C.red,fontSize:13,fontWeight:600,border:"1px solid #DBC8C4"}}>{errMsg}</div>}
            <div style={{display:"flex",gap:10,flexDirection:"column",marginTop:24}}>
              <BigBtn onClick={submitTrad} dis={busy||pendientes.length>0}>{busy?"Subiendo… puede tardar unos segundos":(pendientes.length>0?("Aún faltan "+pendientes.length+" dato"+(pendientes.length===1?"":"s")):"Finalizar y enviar →")}</BigBtn>
              <button onClick={function(){setFixMode(false);}} style={{padding:"12px",borderRadius:12,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>← Volver al resumen</button>
            </div>
          </div>
        ):(
          <div>
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{fontSize:48,marginBottom:12}}>📋</div>
              <div style={{fontSize:22,fontWeight:600,color:C.black,marginBottom:8}}>¡Reporte Completado!</div>
              <div style={{fontSize:14,color:C.earth,lineHeight:1.7}}>Gracias por tu compromiso. Este reporte nos ayuda a mantener el estándar de excelencia que distingue a Spacio AM.</div>
            </div>
            <div style={{background:C.beige,borderRadius:14,padding:"16px 18px",marginBottom:20}}>
              {[["Propiedad",form.propiedad],["Ciudad",form.ciudad],["Fecha",fmtDate(form.fecha)],["Responsable",form.reportadoPor]].map(function(r,i){return <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:i<3?"1px solid "+C.gray:"none"}}><span style={{fontSize:12,color:C.earth,fontWeight:600}}>{r[0]}</span><span style={{fontSize:13,color:C.black,fontWeight:500}}>{r[1]||"—"}</span></div>;})}
            </div>
            {pendientes.length>0?(
              <div>
                <div style={{padding:"14px 16px",borderRadius:12,background:"#FEF0EC",border:"1px solid #e9c2a0",marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#b5622a",marginBottom:8}}>⚠ Te faltan {pendientes.length} dato{pendientes.length===1?"":"s"} obligatorio{pendientes.length===1?"":"s"} antes de finalizar:</div>
                  <ul style={{margin:0,paddingLeft:18,display:"flex",flexDirection:"column",gap:5}}>
                    {pendientes.map(function(p){return <li key={p.id} style={{fontSize:12.5,color:"#8a5a2a",lineHeight:1.5}}>{p.label}</li>;})}
                  </ul>
                </div>
                <div style={{display:"flex",gap:10,flexDirection:"column"}}>
                  <BigBtn onClick={function(){setErrMsg("");setFixMode(true);}}>Completar lo que falta →</BigBtn>
                  <button onClick={prev} style={{padding:"12px",borderRadius:12,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>← Revisar paso a paso</button>
                </div>
              </div>
            ):(
              <div style={{display:"flex",gap:10,flexDirection:"column"}}>
                {errMsg&&<div style={{padding:"12px 14px",borderRadius:8,background:"#F5EDEC",color:C.red,fontSize:13,fontWeight:600,border:"1px solid #DBC8C4"}}>{errMsg}</div>}
                <button onClick={prev} style={{padding:"12px",borderRadius:12,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>← Revisar</button>
                <BigBtn onClick={submitTrad} dis={busy}>{busy?"Subiendo… puede tardar unos segundos":"Enviar limpieza →"}</BigBtn>
              </div>
            )}
          </div>
        ))}

      </div>
    </div>
  );
}

/* ═══════════════ LIMPIEZA PROFUNDA WIZARD ═════════════════════════════ */
function LimpiezaProfForm({vendors,props,onSubmit,defaultVendor,onBack}) {
  const STEPS_P = ["Bienvenida","Propiedad","Regadera y Ducha","Ventanas","Cocina profunda","Gavetas y Detrás","Detalle extra","Inventario","Foto uniforme","Confirmación"];
  const [step,setStep]   = useState(0);
  const [errMsg,setErrMsg] = useState("");
  const [form,setForm] = useState({
    reportadoPor:defaultVendor||"", propiedad:"", fecha:todayStr(),
    fotosRegadera:null, fotosDucha:null, fotosDrenajes:[],
    fotosVentanas:[], 
    fotosEstufa:null, fotosFregadero:null, fotosMicroondas2:null, fotosPlatos:null,
    fotosGavetas:[], fotosDetrasElect:null,
    fotosDetalle:[],
    inventario:INV_DEFAULT.map(function(i){return Object.assign({},i,{cantidad:i.countAlways?"":i.cantidad,malEstado:i.countAlways?"":undefined,estado:"ok",foto:null});}),
    comentarios:"",
  });
  const [done,setDone]=useState(false);
  const [busy,setBusy]=useState(false);
  const [invOnlyPendP,setInvOnlyPendP]=useState(false);

  /* ── Borrador automático (igual que limpieza tradicional) */
  var draftKeyP = "prof:"+(defaultVendor||"anon");
  const [resumeDataP,setResumeDataP] = useState(null);
  const [draftReadyP,setDraftReadyP] = useState(false);
  useEffect(function(){
    var alive=true;
    draftLoad(draftKeyP).then(function(d){ if(!alive) return; if(d&&d.form&&d.step>0) setResumeDataP(d); setDraftReadyP(true); });
    return function(){alive=false;};
  },[]);
  useEffect(function(){
    if(!draftReadyP||done||resumeDataP||step===0) return;
    var t=setTimeout(function(){ draftSave(draftKeyP,{form:form,step:step,ts:Date.now()}); },600);
    return function(){clearTimeout(t);};
  },[form,step,done,draftReadyP,resumeDataP]);
  useEffect(function(){ if(done) draftDel(draftKeyP); },[done]);
  function doResumeP(){ var d=resumeDataP; if(d){ setForm(d.form); setStep(d.step); } setResumeDataP(null); }
  function doFreshP(){ draftDel(draftKeyP); setResumeDataP(null); }

  function sf(k,v){setForm(function(p){var u=Object.assign({},p);u[k]=v;return u;});}
  function next(){if(step<STEPS_P.length-1)setStep(function(s){return s+1;});}
  function prev(){if(step>0)setStep(function(s){return s-1;});}
  var propObj=props.find(function(p){return p.name===form.propiedad;})||{};
  var banos=propObj.banos||1;
  /* Fotos obligatorias — 1 por espacio */
  var okDuchaP  = !!(form.fotosRegadera||form.fotosDucha);
  var okCocinaP = !!(form.fotosEstufa||form.fotosFregadero||form.fotosMicroondas2||form.fotosPlatos);
  var invPendP  = form.inventario.filter(function(it){
    if(!it.countAlways) return false;
    if(it.cantidad===""||it.cantidad===null||it.cantidad===undefined||isNaN(parseInt(it.cantidad))) return true;
    if(parseInt(it.malEstado||0)>0 && !it.foto) return true;
    return false;
  });

  async function submit(){
    if(!okDuchaP||!okCocinaP){
      var missP=[];
      if(!okDuchaP) missP.push("Regadera / Ducha");
      if(!okCocinaP) missP.push("Cocina profunda");
      setErrMsg("⚠ Faltan fotos obligatorias: "+missP.join(", ")+". Regresa y súbelas para poder enviar.");
      try{ alert("No se puede enviar el reporte.\n\nFaltan fotos obligatorias de: "+missP.join(", ")+"."); }catch(_){}
      return;
    }
    if(invPendP.length>0){
      setErrMsg("⚠ Completa el conteo de blancos en el inventario: "+invPendP.map(function(x){return x.name;}).join(", ")+".");
      try{ alert("No se puede enviar el reporte.\n\nCompleta el conteo de toallas y sábanas (y la foto si hay piezas en mal estado)."); }catch(_){}
      return;
    }
    setBusy(true);
    var vP=vendors.find(function(v){return v.email===form.reportadoPor;});
    var tarifaP=vP&&vP.tarifaLimpieza?String(vP.tarifaLimpieza):"";
    var rep=Object.assign({},form,{id:Date.now(),createdAt:Date.now(),categoria:"Limpieza profunda",descripcion:"Limpieza profunda — "+form.propiedad,total:tarifaP,paid:false,pagadoPor:"",fotoAntes:[],fotoDespues:[],factura:null,qaStatus:"pendiente",qaComentario:"",qaFecha:"",qaRespuesta:null,qaRespuestaFecha:""});
    try {
      await onSubmit(rep);
      try{
        var supsP=supervisorEmails(vendors, form.reportadoPor);
        if(supsP.length){
          var tnP=(vendors.find(function(v){return v.email===form.reportadoPor;})||{}).name||form.reportadoPor;
          notifyEmail(supsP, "Limpieza profunda lista para supervisión — "+form.propiedad, tnP+" terminó una limpieza profunda en "+form.propiedad+" ("+fmtDate(form.fecha)+").\n\nEntra a la pestaña Supervisión del app para revisarla.\n\nEPI App — Spacio AM");
        }
      }catch(_){}
      setDone(true);
    } catch(e) {
      setErrMsg("Error al enviar: "+(e&&e.message?e.message:"verifica tu conexión."));
    } finally { setBusy(false); }
  }

  if(done) return <SuccessScreen msg="¡Limpieza profunda registrada!" sub="Excelente trabajo. Cada detalle cuenta para Spacio AM."/>;
  var pct=Math.round((step/(STEPS_P.length-1))*100);

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"0 0 80px",fontFamily:"Montserrat,sans-serif"}}>
      <ResumeDraftModal data={resumeDataP} stepLabel={resumeDataP?STEPS_P[resumeDataP.step]:""} accent="#2e7d52" onResume={doResumeP} onFresh={doFreshP}/>
      {step>0&&step<STEPS_P.length-1&&(
        <div style={{position:"sticky",top:58,zIndex:20,background:"#fff",borderBottom:"1px solid "+C.gray,padding:"12px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>{STEPS_P[step]}</span>
            <span style={{fontSize:10,color:C.earth}}>{step} / {STEPS_P.length-2}</span>
          </div>
          <div style={{background:C.gray,borderRadius:2,height:3}}><div style={{width:pct+"%",height:"100%",borderRadius:2,background:C.taupe,transition:"width .3s"}}/></div>
        </div>
      )}
      <div style={{padding:"28px 18px"}}>

        {step===0&&(
          <div style={{textAlign:"center",padding:"20px 0 40px"}}>
            <div style={{fontSize:48,marginBottom:20}}>🫧</div>
            <div style={{fontSize:11,color:"#2e7d52",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",marginBottom:10}}>Spacio AM</div>
            <div style={{fontSize:24,fontWeight:400,color:C.black,marginBottom:14,lineHeight:1.4}}>Limpieza Profunda</div>
            <div style={{fontSize:14,color:C.earth,lineHeight:1.7,marginBottom:32,textAlign:"left",background:C.beige,padding:"16px",borderRadius:12}}>
              Hoy nos enfocamos en todo lo que normalmente no da tiempo en la rutina diaria:<br/><br/>
              Duchas · Regaderas · Drenajes · Ventanas · Cocina profunda · Organización
            </div>
            <button onClick={next} style={{padding:"14px 36px",borderRadius:100,border:"none",background:C.black,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>Empezar →</button>
            <div style={{marginTop:16}}><button onClick={onBack} style={{background:"none",border:"none",color:C.earth,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>← Volver al formulario general</button></div>
          </div>
        )}

        {step===1&&(
          <WizStep title="¿Qué propiedad estás limpiando?" step={step} total={STEPS_P.length-2} onPrev={prev} onNext={next} canNext={!!form.propiedad&&!!form.reportadoPor} color="#2e7d52">
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {defaultVendor
                ?<div style={{fontSize:14,fontWeight:600,color:C.black,background:C.beige,padding:"11px 14px",borderRadius:10,marginBottom:4}}>{vendors.find(function(v){return v.email===defaultVendor;})?vendors.find(function(v){return v.email===defaultVendor;}).name:defaultVendor}</div>
                :<F label="Responsable"><select value={form.reportadoPor} onChange={function(e){sf("reportadoPor",e.target.value);}}><option value="">Seleccionar…</option>{vendors.filter(function(v){return v.active;}).map(function(v){return <option key={v.id} value={v.email}>{v.name}</option>;})}</select></F>
              }
              <F label="Propiedad"><select value={form.propiedad} onChange={function(e){sf("propiedad",e.target.value);}}><option value="">Seleccionar…</option>{props.map(function(p){return <option key={p.id}>{p.name}</option>;})}</select></F>
              <F label="Fecha"><input type="date" value={form.fecha} onChange={function(e){sf("fecha",e.target.value);}}/></F>
            </div>
          </WizStep>
        )}

        {step===2&&(
          <WizStep title="Regadera, Ducha y Drenajes" step={step} total={STEPS_P.length-2} onPrev={prev} onNext={next} canNext={okDuchaP} color="#2e7d52">
            {!okDuchaP&&<PhotoReqWarn msg="Sube al menos 1 foto (regadera o ducha) — es obligatoria para continuar."/>}
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div><div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Regadera — Ojitos (que no estén tapados)</div><SinglePhotoUp foto={form.fotosRegadera} accent="#2e7d52" onAdd={function(f){compress(f).then(function(d){sf("fotosRegadera",d);});}} onDel={function(){sf("fotosRegadera",null);}}/></div>
              <div><div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Ducha / Mampara (vidrio o cortina)</div><SinglePhotoUp foto={form.fotosDucha} accent="#2e7d52" onAdd={function(f){compress(f).then(function(d){sf("fotosDucha",d);});}} onDel={function(){sf("fotosDucha",null);}}/></div>
              <div>
                <div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Drenajes — 1 foto por baño</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {Array.from({length:banos},function(_,i){var foto=form.fotosDrenajes[i]||null;return <div key={i}><div style={{fontSize:11,color:C.earth,marginBottom:6}}>Drenaje baño {i+1}</div><SinglePhotoUp foto={foto} accent="#2e7d52" onAdd={function(f){compress(f).then(function(d){var arr=[...form.fotosDrenajes];arr[i]=d;sf("fotosDrenajes",arr);});}} onDel={function(){var arr=[...form.fotosDrenajes];arr[i]=null;sf("fotosDrenajes",arr);}}/></div>;})}
                </div>
              </div>
            </div>
          </WizStep>
        )}

        {step===3&&(
          <WizStep title="Ventanas" step={step} total={STEPS_P.length-2} onPrev={prev} onNext={next} canNext color="#2e7d52">
            <div><div style={{fontSize:13,color:C.earth,marginBottom:12}}>Al menos 1 ventana limpia por apartamento.</div>
            <MultiPhotoUp label="Ventanas" photos={form.fotosVentanas} max={4} accent="#2e7d52" onAdd={function(files){var copies=[...form.fotosVentanas];Promise.all(Array.from(files).slice(0,4-copies.length).map(compress)).then(function(ds){sf("fotosVentanas",copies.concat(ds).slice(0,4));});}} onDel={function(i){sf("fotosVentanas",form.fotosVentanas.filter(function(_,j){return j!==i;}));}}/>
            </div>
          </WizStep>
        )}

        {step===4&&(
          <WizStep title="Cocina profunda" step={step} total={STEPS_P.length-2} onPrev={prev} onNext={next} canNext={okCocinaP} color="#2e7d52">
            {!okCocinaP&&<PhotoReqWarn msg="Sube al menos 1 foto de la cocina profunda — es obligatoria para continuar."/>}
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {[["fotosEstufa","Estufa limpia"],["fotosFregadero","Fregadero limpio"],["fotosMicroondas2","Interior del microondas"],["fotosPlatos","Platos, vasos y cubiertos ordenados"]].map(function(item){var key=item[0];var lbl=item[1];return <div key={key}><div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>{lbl}</div><SinglePhotoUp foto={form[key]} accent="#2e7d52" onAdd={function(f){compress(f).then(function(d){sf(key,d);});}} onDel={function(){sf(key,null);}}/></div>;})}
            </div>
          </WizStep>
        )}

        {step===5&&(
          <WizStep title="Gavetas y detrás de electrodomésticos" step={step} total={STEPS_P.length-2} onPrev={prev} onNext={next} canNext color="#2e7d52">
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div><div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Organización de gavetas / utensilios (1-2 ejemplos)</div><MultiPhotoUp label="Gavetas" photos={form.fotosGavetas} max={3} accent="#2e7d52" onAdd={function(files){var c=[...form.fotosGavetas];Promise.all(Array.from(files).slice(0,3-c.length).map(compress)).then(function(ds){sf("fotosGavetas",c.concat(ds).slice(0,3));});}} onDel={function(i){sf("fotosGavetas",form.fotosGavetas.filter(function(_,j){return j!==i;}));}}/></div>
              <div><div style={{fontSize:11,color:C.earth,fontWeight:600,marginBottom:8}}>Detrás de electrodomésticos (si se movieron)</div><SinglePhotoUp foto={form.fotosDetrasElect} accent="#2e7d52" onAdd={function(f){compress(f).then(function(d){sf("fotosDetrasElect",d);});}} onDel={function(){sf("fotosDetrasElect",null);}}/></div>
            </div>
          </WizStep>
        )}

        {step===6&&(
          <WizStep title="Detalle extra" step={step} total={STEPS_P.length-2} onPrev={prev} onNext={next} canNext color="#2e7d52">
            <div>
              <div style={{fontSize:13,color:C.earth,marginBottom:12}}>Cualquier detalle adicional que hayas corregido — antes/después si aplica.</div>
              <MultiPhotoUp label="Detalles extra" photos={form.fotosDetalle} max={6} accent="#2e7d52" onAdd={function(files){var c=[...form.fotosDetalle];Promise.all(Array.from(files).slice(0,6-c.length).map(compress)).then(function(ds){sf("fotosDetalle",c.concat(ds).slice(0,6));});}} onDel={function(i){sf("fotosDetalle",form.fotosDetalle.filter(function(_,j){return j!==i;}));}}/>
              <div style={{marginTop:16}}><F label="Comentarios adicionales"><textarea rows={3} placeholder="Observaciones del equipo…" value={form.comentarios} onChange={function(e){sf("comentarios",e.target.value);}}/></F></div>
            </div>
          </WizStep>
        )}

        {step===7&&(
          <WizStep title="Inventario de la propiedad" step={step} total={STEPS_P.length-2} onPrev={prev} onNext={next} canNext={invPendP.length===0} color="#2e7d52"
            pendingHint={"Aún falta el conteo de: "+invPendP.map(function(x){return x.name;}).join(", ")+(invPendP.some(function(x){return parseInt(x.malEstado||0)>0&&!x.foto;})?" (y la foto de las piezas en mal estado)":"")+". Toca el botón para ir directo a esos campos."}
            onFillPending={function(){setInvOnlyPendP(true);}}>
            {invPendP.length>0&&<PhotoReqWarn msg={"Completa el conteo de: "+invPendP.map(function(x){return x.name;}).join(", ")+(invPendP.some(function(x){return parseInt(x.malEstado||0)>0&&!x.foto;})?" — incluye la foto de las piezas en mal estado":"")+"."}/>}
            {invOnlyPendP&&invPendP.length>0&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:"#FEF0EC",border:"1px solid #e9c2a0",borderRadius:8,padding:"9px 13px"}}><span style={{fontSize:12,fontWeight:700,color:"#b5622a"}}>Mostrando solo lo que falta</span><button onClick={function(){setInvOnlyPendP(false);}} style={{background:"none",border:"none",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>Ver todo el inventario</button></div>}
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              <div style={{fontSize:13,color:C.earth,lineHeight:1.6,background:C.surfaceWarm,padding:"11px 14px",borderRadius:8,border:"1px solid "+C.line,marginBottom:10}}>Verifica que todos los ítems estén presentes.</div>
              {form.inventario.map(function(item,idx){
                function setInv(k,v){var arr=form.inventario.map(function(x,j){if(j!==idx)return x;var u=Object.assign({},x);u[k]=v;return u;});sf("inventario",arr);}
                var isOk=item.estado==="ok";
                if(invOnlyPendP&&invPendP.length>0&&!invPendP.some(function(p){return p.id===item.id;})) return null;
                return (
                  <div key={item.id} style={{background:"#fff",borderRadius:12,padding:"13px 15px",border:"1.5px solid "+(isOk?C.gray:"#e9826a"),marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.black}}>{item.name}</div>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={function(){setInv("estado","ok");}} style={{padding:"5px 11px",borderRadius:100,border:"none",fontSize:11,fontWeight:700,cursor:"pointer",background:isOk?C.surfaceWarm:"#f5f5f5",color:isOk?C.green:C.taupe}}>✓</button>
                        <button onClick={function(){setInv("estado","falta");}} style={{padding:"5px 11px",borderRadius:100,border:"none",fontSize:11,fontWeight:700,cursor:"pointer",background:!isOk?"#FEF0EC":"#f5f5f5",color:!isOk?C.peach:C.gray}}>✗</button>
                      </div>
                    </div>
                    {item.countAlways&&<div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <F label="¿Cuántas hay en total?"><input type="number" min="0" placeholder="0" value={item.cantidad} onChange={function(e){setInv("cantidad",e.target.value===""?"":(parseInt(e.target.value)||0));}}/></F>
                      <F label="¿Cuántas en mal estado?"><input type="number" min="0" placeholder="0" value={item.malEstado===undefined?"":item.malEstado} onChange={function(e){setInv("malEstado",e.target.value===""?"":(parseInt(e.target.value)||0));}}/></F>
                    </div>}
                    {item.countAlways&&parseInt(item.malEstado||0)>0&&<div style={{marginTop:10}}>
                      <div style={{fontSize:10,color:C.red,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>Foto de las piezas en mal estado (obligatoria)</div>
                      <SinglePhotoUp foto={item.foto} accent={C.red} onAdd={function(f){compress(f).then(function(d){setInv("foto",d);});}} onDel={function(){setInv("foto",null);}}/>
                    </div>}
                    {item.requirePhoto&&<div style={{marginTop:8}}><SinglePhotoUp foto={item.foto} accent="#2e7d52" onAdd={function(f){compress(f).then(function(d){setInv("foto",d);});}} onDel={function(){setInv("foto",null);}}/></div>}
                  </div>
                );
              })}
            </div>
          </WizStep>
        )}

        {step===8&&(
          <div>
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{fontSize:48,marginBottom:12}}>🫧</div>
              <div style={{fontSize:22,fontWeight:600,color:C.black,marginBottom:8}}>¡Limpieza registrada!</div>
              <div style={{fontSize:14,color:C.earth,lineHeight:1.7}}>Excelente trabajo. Cada detalle cuenta.</div>
            </div>
            <div style={{background:C.beige,borderRadius:14,padding:"16px 18px",marginBottom:20}}>
              {[["Propiedad",form.propiedad],["Fecha",fmtDate(form.fecha)],["Responsable",form.reportadoPor]].map(function(r,i){return <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:i<2?"1px solid "+C.gray:"none"}}><span style={{fontSize:12,color:C.earth,fontWeight:600}}>{r[0]}</span><span style={{fontSize:13,color:C.black}}>{r[1]||"—"}</span></div>;})}
            </div>
            {errMsg&&<div style={{padding:"12px 14px",borderRadius:8,background:"#F5EDEC",color:C.red,fontSize:13,fontWeight:600,border:"1px solid #DBC8C4"}}>{errMsg}</div>}
            <div style={{display:"flex",gap:10,flexDirection:"column"}}>
              <button onClick={prev} style={{padding:"12px",borderRadius:12,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>← Revisar</button>
              <BigBtn onClick={submit} dis={busy}>{busy?"Subiendo… puede tardar unos segundos":"Enviar limpieza →"}</BigBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════ SHARED WIZARD HELPERS ════════════════════════════════ */
function WizStep({title,step,total,onPrev,onNext,canNext,children,color,pendingHint,onFillPending}) {
  var ac = color||C.peach;
  const [hint,setHint] = useState(false);
  useEffect(function(){ if(canNext) setHint(false); },[canNext]);
  function go(){ if(canNext){ setHint(false); onNext(); } else { setHint(true); } }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{fontSize:20,fontWeight:500,color:C.black,lineHeight:1.4}}>{title}</div>
      {children}
      {hint&&!canNext&&(
        <div style={{background:"#FEF0EC",border:"1px solid #e9c2a0",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#b5622a",marginBottom:onFillPending?12:0,lineHeight:1.5}}>{pendingHint||"Aún faltan algunos datos obligatorios en esta sección antes de continuar."}</div>
          {onFillPending&&<button onClick={function(){setHint(false);onFillPending();}} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:ac,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",letterSpacing:".03em"}}>Llenar pendientes ahora →</button>}
        </div>
      )}
      <div style={{display:"flex",gap:10,marginTop:8}}>
        {step>1&&<button onClick={onPrev} style={{flex:1,padding:"13px",borderRadius:12,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>← Anterior</button>}
        <button onClick={go} aria-disabled={!canNext} style={{flex:2,padding:"13px",borderRadius:12,border:"none",background:canNext?ac:"#D8CFC8",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",transition:"background .2s"}}>Siguiente →</button>
      </div>
    </div>
  );
}

function SuccessScreen({msg,sub}) {
  return (
    <div style={{textAlign:"center",padding:"80px 20px",fontFamily:"Montserrat,sans-serif",maxWidth:400,margin:"0 auto"}}>
      <div style={{fontSize:64,marginBottom:20}}>✓</div>
      <div style={{fontSize:22,fontWeight:600,color:C.black,marginBottom:12}}>{msg}</div>
      <div style={{fontSize:14,color:C.earth,lineHeight:1.7}}>{sub}</div>
    </div>
  );
}

/* Modal de reanudar borrador — aparece si hay un formulario guardado a medias */
function ResumeDraftModal({data, stepLabel, accent, onResume, onFresh}) {
  if(!data) return null;
  var f=data.form||{};
  var ac=accent||C.peach;
  var when=data.ts?new Date(data.ts):null;
  var rows=[["Propiedad",f.propiedad||"—"],["Vas en",stepLabel||"—"]];
  if(when) rows.push(["Guardado",when.toLocaleDateString("es-GT",{day:"numeric",month:"short"})+" · "+when.toLocaleTimeString("es-GT",{hour:"2-digit",minute:"2-digit"})]);
  return (
    <div style={{position:"fixed",inset:0,zIndex:9200,background:"rgba(62,63,63,.55)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:18,fontFamily:"Montserrat,sans-serif"}}>
      <div style={{width:"100%",maxWidth:400,background:"#fff",borderRadius:22,padding:"30px 26px",boxShadow:"0 28px 80px rgba(62,63,63,.22)"}}>
        <div style={{fontSize:30,marginBottom:12,textAlign:"center"}}>📝</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontWeight:400,fontSize:24,lineHeight:1.2,color:C.black,textAlign:"center",marginBottom:10}}>Tienes un reporte sin terminar</div>
        <div style={{fontSize:13.5,color:C.earth,lineHeight:1.65,textAlign:"center",marginBottom:18}}>Guardamos tu avance automáticamente. ¿Deseas continuar donde lo dejaste o empezar uno desde cero?</div>
        <div style={{background:C.beige,borderRadius:12,padding:"12px 16px",marginBottom:20}}>
          {rows.map(function(r,i){return <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:i<rows.length-1?"1px solid "+C.gray:"none"}}><span style={{fontSize:11.5,color:C.earth,fontWeight:600}}>{r[0]}</span><span style={{fontSize:12.5,color:C.black,fontWeight:500}}>{r[1]}</span></div>;})}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button onClick={onResume} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",background:ac,color:"#fff",fontSize:13.5,fontWeight:700,cursor:"pointer",letterSpacing:".03em"}}>Continuar donde lo dejé →</button>
          <button onClick={onFresh} style={{width:"100%",padding:"12px",borderRadius:12,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>Empezar uno desde cero</button>
        </div>
      </div>
    </div>
  );
}

/* Alerta de foto obligatoria faltante (1 por espacio) */
function PhotoReqWarn({msg}) {
  return <div style={{background:"#F5EDEC",border:"1px solid #DBC8C4",borderRadius:8,padding:"10px 14px",fontSize:12.5,fontWeight:600,color:C.red,lineHeight:1.5}}>⚠ {msg}</div>;
}

function DaniosSection({form,sf}) {
  function addDanio() {
    sf("danios",form.danios.concat([{desc:"",fotos:[],origen:"",reparacion:"",comentarios:"",fotos2:[],factura:null,cobrado:false,quienPaga:""}]));
  }
  function setDanio(idx,k,v) {
    sf("danios",form.danios.map(function(d,j){if(j!==idx)return d;var u=Object.assign({},d);u[k]=v;return u;}));
  }
  function rmDanio(idx) { sf("danios",form.danios.filter(function(_,j){return j!==idx;})); }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{fontSize:15,fontWeight:500,color:C.black}}>¿Encontraste algún daño en la propiedad?</div>
      <div style={{display:"flex",gap:8}}>
        <ChipBtn active={!form.hayDanios} onClick={function(){sf("hayDanios",false);sf("danios",[]);}} color={C.green}>No</ChipBtn>
        <ChipBtn active={form.hayDanios}  onClick={function(){sf("hayDanios",true);if(form.danios.length===0)addDanio();}} color={C.red}>Sí</ChipBtn>
      </div>
      {form.hayDanios&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {form.danios.map(function(d,idx){
            return (
              <div key={idx} style={{background:"#fff",borderRadius:14,padding:"16px",border:"2px solid #f5c6a0"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.peach,letterSpacing:".1em",textTransform:"uppercase"}}>Daño {idx+1}</div>
                  {form.danios.length>1&&<button onClick={function(){rmDanio(idx);}} style={{background:"none",border:"none",color:C.gray,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <F label="Describe el daño"><textarea rows={3} placeholder="¿Qué fue dañado y cómo?" value={d.desc} onChange={function(e){setDanio(idx,"desc",e.target.value);}}/></F>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Fotos del daño</div>
                    <MultiPhotoUp label="Fotos del daño" photos={d.fotos} max={5} accent={C.peach} onAdd={function(files){var c=[...d.fotos];Promise.all(Array.from(files).slice(0,5-c.length).map(compress)).then(function(ds){setDanio(idx,"fotos",c.concat(ds).slice(0,5));});}} onDel={function(i){setDanio(idx,"fotos",d.fotos.filter(function(_,j){return j!==i;}));}}/>
                  </div>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>¿Origen del daño?</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {["Estaba antes","Lo dejó el huésped","No estoy seguro"].map(function(op){return <ChipBtn key={op} active={d.origen===op} onClick={function(){setDanio(idx,"origen",op);}} color={C.earth}>{op}</ChipBtn>;})}
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>¿Se puede reparar?</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {["Se puede reparar","Hay que reemplazar","No estoy seguro"].map(function(op){return <ChipBtn key={op} active={d.reparacion===op} onClick={function(){setDanio(idx,"reparacion",op);}} color={C.earth}>{op}</ChipBtn>;})}
                    </div>
                  </div>
                  <div style={{borderTop:"1px solid "+C.gray,paddingTop:14,marginTop:4}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:10}}>Seguimiento del daño</div>
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      <F label="Comentarios / Notas internas"><textarea rows={2} placeholder="Acciones tomadas, notas para el equipo…" value={d.comentarios} onChange={function(e){setDanio(idx,"comentarios",e.target.value);}}/></F>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase",marginBottom:8}}>Evidencia adicional / Factura</div>
                        <MultiPhotoUp label="Fotos adicionales" photos={d.fotos2} max={3} accent={C.earth} onAdd={function(files){var c=[...d.fotos2];Promise.all(Array.from(files).slice(0,3-c.length).map(compress)).then(function(ds){setDanio(idx,"fotos2",c.concat(ds).slice(0,3));});}} onDel={function(i){setDanio(idx,"fotos2",d.fotos2.filter(function(_,j){return j!==i;}));}}/>
                      </div>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase",marginBottom:8}}>¿Ya se cobró?</div>
                        <div style={{display:"flex",gap:6}}>
                          <ChipBtn active={d.cobrado} onClick={function(){setDanio(idx,"cobrado",true);}} color={C.green}>✓ Cobrado</ChipBtn>
                          <ChipBtn active={!d.cobrado} onClick={function(){setDanio(idx,"cobrado",false);}} color={C.red}>Pendiente</ChipBtn>
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase",marginBottom:8}}>¿Quién paga el daño?</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {["Airbnb","Seguro","Dueño","Spacio AM"].map(function(op){return <ChipBtn key={op} active={d.quienPaga===op} onClick={function(){setDanio(idx,"quienPaga",op);}} color={C.earth}>{op}</ChipBtn>;})}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <button onClick={addDanio} style={{padding:"12px",borderRadius:12,border:"2px dashed "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Agregar otro daño</button>
        </div>
      )}
    </div>
  );
}

function SinglePhotoUp({foto,accent,onAdd,onDel,cameraOnly,label}) {
  var ref=useRef(null);
  return (
    <div>
      {foto
        ?<div style={{position:"relative",width:"100%",maxWidth:280,borderRadius:12,overflow:"hidden"}}>
          <img src={foto} alt="" style={{width:"100%",maxHeight:220,objectFit:"cover",display:"block"}}/>
          <button onClick={onDel} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,.6)",color:"#fff",border:"none",borderRadius:"50%",width:28,height:28,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>×</button>
        </div>
        :<label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",width:"100%",maxWidth:280,minHeight:130,borderRadius:12,border:"2px dashed "+(accent||C.earth),cursor:"pointer",background:C.surfaceWarm,gap:6}}>
          <span style={{fontSize:26}}>📷</span>
          <span style={{fontSize:12,color:C.earth,fontWeight:600,textAlign:"center",padding:"0 12px"}}>{label||"Toca para añadir foto"}</span>
          {cameraOnly&&<span style={{fontSize:10,color:C.taupe}}>Solo cámara</span>}
          <input ref={ref} type="file" accept="image/*" capture={cameraOnly?"environment":undefined} style={{display:"none"}} onChange={function(e){var f=e.target.files&&e.target.files[0];if(f)onAdd(f);e.target.value="";}}/>
        </label>
      }
    </div>
  );
}

function MultiPhotoUp({label,photos,max,accent,onAdd,onDel}) {
  var ref=useRef(null);
  return (
    <div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {photos.map(function(src,i){return <div key={i} style={{position:"relative",width:84,height:84,borderRadius:10,overflow:"hidden",border:"2px solid "+(accent+"30")}}><img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/><button onClick={function(){onDel(i);}} style={{position:"absolute",top:3,right:3,width:20,height:20,borderRadius:"50%",border:"none",background:"rgba(0,0,0,.55)",color:"#fff",fontSize:14,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button></div>;})}
        {photos.length<max&&<button onClick={function(){if(ref.current)ref.current.click();}} style={{width:84,height:84,borderRadius:10,border:"1.5px dashed "+C.line,background:C.surface,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",transition:"background .2s"}}><span style={{fontSize:20,color:C.earth}}>+</span><span style={{fontSize:9.5,color:C.earth,fontWeight:600,letterSpacing:".1em",textTransform:"uppercase"}}>Foto</span></button>}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files.length)onAdd(e.target.files);e.target.value="";}}/>
    </div>
  );
}


/* ─── Admin: vincular correos anteriores (huérfanos) a un técnico.
   Solo el administrador ve esto. Muestra únicamente los CORREOS sin dueño (no los reportes)
   y permite asignar cada uno al técnico correcto; el correo se agrega a su `prevEmails` y sus
   registros quedan ligados a su cuenta actual. */
function OrphanEmailLinker({reps, vendors, onSvV}) {
  const [sel,setSel] = useState({});
  const [msg,setMsg] = useState(null);
  var orphans = orphanEmailList(reps, vendors);
  var activeVendors = (vendors||[]).filter(function(v){return v.active!==false;});
  function link(email, count){
    var vid = sel[email];
    if(!vid){ setMsg({ok:false,t:"Elige a qué técnico pertenece "+email+"."}); return; }
    var v=(vendors||[]).find(function(x){return x.id===vid;});
    var nm = v?vendorDisplay(v):"";
    onSvV((vendors||[]).map(function(x){
      if(x.id!==vid) return x;
      var prev=(x.prevEmails||[]).slice();
      if(prev.indexOf(email)<0) prev.push(email);
      return Object.assign({},x,{prevEmails:prev});
    }));
    setSel(function(p){var u=Object.assign({},p);delete u[email];return u;});
    setMsg({ok:true,t:"✓ "+email+" → "+nm+". Sus "+count+" registro"+(count===1?"":"s")+" ya aparecen en la cuenta de "+nm+"."});
  }
  return (
    <div style={{marginTop:22}}>
      <Card title="Vincular correos anteriores">
        <div style={{fontSize:12.5,color:C.earth,lineHeight:1.65,marginBottom:14}}>
          Estos correos aparecen en reportes pero ya no pertenecen a ningún técnico —normalmente porque la persona cambió de correo. Asigna cada uno al técnico correcto y sus registros se ligarán a su cuenta actual.
        </div>
        {orphans.length===0
          ? <div style={{padding:"12px 14px",borderRadius:8,background:"#EDF5EF",fontSize:12.5,color:C.green,fontWeight:600}}>✓ No hay correos sin vincular.</div>
          : <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {orphans.map(function(o){return (
                <div key={o.email} style={{background:C.surfaceWarm,border:"1px solid "+C.line,borderRadius:12,padding:"13px 15px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:13.5,fontWeight:600,color:C.black,wordBreak:"break-all"}}>{o.email}</div>
                    <div style={{fontSize:11,fontWeight:600,color:C.earth,whiteSpace:"nowrap"}}>{o.count} registro{o.count===1?"":"s"}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
                    <div style={{flex:"1 1 200px"}}>
                      <F label="Pertenece a">
                        <select value={sel[o.email]||""} onChange={function(e){var val=e.target.value;setSel(function(p){var u=Object.assign({},p);u[o.email]=val;return u;});setMsg(null);}}>
                          <option value="">Seleccionar técnico…</option>
                          {activeVendors.map(function(v){return <option key={v.id} value={v.id}>{vendorDisplay(v)} — {v.email}</option>;})}
                        </select>
                      </F>
                    </div>
                    <button onClick={function(){link(o.email,o.count);}} disabled={!sel[o.email]} style={{padding:"11px 18px",borderRadius:10,border:"none",background:sel[o.email]?C.black:C.gray,color:"#fff",fontSize:12.5,fontWeight:600,cursor:sel[o.email]?"pointer":"default",whiteSpace:"nowrap"}}>Vincular</button>
                  </div>
                </div>
              );})}
            </div>
        }
        {msg&&<div style={{marginTop:12,padding:"10px 13px",borderRadius:8,fontSize:12.5,fontWeight:600,background:msg.ok?"#EDF5EF":"#F5EDEC",color:msg.ok?C.green:C.red,lineHeight:1.5}}>{msg.t}</div>}
      </Card>
    </div>
  );
}

/* ─── Config */
function CfgView({reps,vendors,props,adminPin,company,extCats,schedules,hospUrlDay,hospUrlWeek,feedback,onSvV,onSvP,onSvPin,onSvCo,onSvExtCats,onSvSchedules,onSvHospUrlDay,onSvHospUrlWeek,onSvFeedback}) {
  const [tab,setTab] = useState("vendors");
  return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"28px 18px 60px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:20}}><div style={{fontSize:9.5,fontWeight:600,color:C.earth,letterSpacing:".28em",textTransform:"uppercase",marginBottom:8}}>Configuración</div><div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:28,fontWeight:400,color:C.black}}>Ajustes del sistema</div></div>
      <div style={{display:"flex",background:"#fff",borderRadius:10,padding:4,gap:3,marginBottom:18,border:"1px solid "+C.gray,flexWrap:"wrap"}}>
        {[["vendors","Equipo"],["props","Propiedades"],["feedback","Sugerencias"],["company","Empresa"],["security","Seguridad"]].map(function(it){ var k=it[0],l=it[1]; return <button key={k} onClick={function(){setTab(k);}} style={{flex:1,minWidth:90,padding:"9px 6px",borderRadius:8,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",background:tab===k?C.black:"transparent",color:tab===k?"#fff":C.taupe,fontSize:12,letterSpacing:".06em",transition:"all .2s"}}>{l}</button>; })}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18,background:C.surfaceWarm,border:"1px solid "+C.line,borderRadius:8,padding:"9px 13px",fontSize:11.5,color:C.earth,lineHeight:1.5}}>
        ℹ La <strong>programación</strong> se gestiona en su propia pestaña. La <strong>recuperación de fotos</strong> ahora es automática (3 min después de cada limpieza y revisión periódica).
      </div>
      <div style={{display:tab==="vendors"  ?"block":"none"}}><VendorsCfg  vendors={vendors} extCats={extCats||[]} onSave={onSvV} onSaveExtCats={onSvExtCats}/><OrphanEmailLinker reps={reps} vendors={vendors} onSvV={onSvV}/></div>
      <div style={{display:tab==="feedback"?"block":"none"}}><FeedbackCfg feedback={feedback||[]} onSave={onSvFeedback}/></div>
      <div style={{display:tab==="props"   ?"block":"none"}}><PropsCfg    props={props}     onSave={onSvP}/></div>
      <div style={{display:tab==="company" ?"block":"none"}}><CompanyCfg  company={company} onSave={onSvCo}/></div>
      <div style={{display:tab==="security"?"block":"none"}}><SecurityCfg adminPin={adminPin} onSave={onSvPin}/></div>
    </div>
  );
}


function VendorsCfg({vendors, extCats, onSave, onSaveExtCats}) {
  const blankNew = {primerNombre:"",segundoNombre:"",primerApellido:"",segundoApellido:"",empresa:"",tipo:"interno",categoria:"EPI Limpieza",email:"",password:"",phone:"",tarifaLimpieza:""};
  const [newV,     setNewV]     = useState(blankNew);
  const [newExtCat,setNewExtCat]= useState("");
  const [editId,   setEditId]   = useState(null);
  const [editFld,  setEFld]     = useState(null);
  const [editVal,  setEVal]     = useState("");

  function startEdit(id,fld,cur){setEditId(id);setEFld(fld);setEVal(fld==="password"?"":cur||"");}
  function cancelEdit(){setEditId(null);setEFld(null);setEVal("");}
  function confirmEdit(){
    if(editVal!==null&&editVal!==""){
      var val=editFld==="tarifaLimpieza"?parseFloat(editVal)||0:editVal;
      var updated=vendors.map(function(v){if(v.id===editId){var u=Object.assign({},v);u[editFld]=val;u.name=vendorDisplay(u);return u;}return v;});
      onSave(updated);
    }
    cancelEdit();
  }

  function addExtCat(){
    var cat=newExtCat.trim().split(/\s+/).slice(0,3).join(" ");
    if(!cat||(extCats||[]).includes(cat)) return;
    var updated=(extCats||[]).concat([cat]);
    if(onSaveExtCats) onSaveExtCats(updated);
    setNewExtCat("");
  }

  function addVendor(){
    if(!newV.primerNombre||!newV.primerApellido||!newV.email||!newV.password)return;
    var name=[newV.primerNombre,newV.primerApellido].filter(Boolean).join(" ");
    onSave(vendors.concat([Object.assign({},newV,{id:"v"+Date.now(),name:name,active:true,isAdmin:false,tarifaLimpieza:parseFloat(newV.tarifaLimpieza)||0})]));
    setNewV(blankNew);
  }

  var allExtCats=(extCats||[]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>

      {/* Existing vendors */}
      {vendors.map(function(v){
        function EditRow(field,label,cur,type){
          var isMe=editId===v.id&&editFld===field;
          return (
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase",minWidth:72}}>{label}</span>
              {isMe?(
                <div style={{display:"flex",gap:6,alignItems:"center",flex:1}}>
                  <input value={editVal} onChange={function(e){setEVal(e.target.value);}} type={type||"text"} style={{flex:1,maxWidth:200,border:"1.5px solid "+C.earth,borderRadius:6,padding:"4px 9px",fontSize:12,fontFamily:"Montserrat,sans-serif",outline:"none"}}/>
                  <button onClick={confirmEdit} style={{fontSize:11,fontWeight:700,color:C.green,background:"#EDF5EF",border:"none",borderRadius:6,padding:"4px 9px",cursor:"pointer"}}>OK</button>
                  <button onClick={cancelEdit}  style={{fontSize:11,color:C.earth,background:"none",border:"none",cursor:"pointer"}}>✕</button>
                </div>
              ):(
                <div style={{display:"flex",gap:8,alignItems:"center",flex:1}}>
                  <span style={{fontSize:12,color:C.black,background:field==="tarifaLimpieza"?"#EDF5EF":C.surfaceWarm,padding:"3px 9px",borderRadius:6,fontWeight:field==="tarifaLimpieza"?700:400,color:field==="tarifaLimpieza"?C.green:C.black}}>
                    {field==="password"?"••••••••":field==="tarifaLimpieza"?(cur?"Q"+cur:"Sin tarifa"):cur||"—"}
                  </span>
                  <button onClick={function(){startEdit(v.id,field,cur);}} style={{fontSize:11,color:C.earth,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Editar</button>
                </div>
              )}
            </div>
          );
        }
        return (
          <div key={v.id} style={{background:"#fff",borderRadius:10,padding:"16px",border:"1px solid "+C.line}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:14}}>
              <div>
                <div style={{fontSize:15,fontWeight:600,color:C.black}}>{vendorDisplay(v)}</div>
                {v.primerApellido&&v.segundoApellido&&<div style={{fontSize:11.5,color:C.earth}}>{[v.segundoNombre,v.segundoApellido].filter(Boolean).join(" ")}</div>}
                <div style={{fontSize:11,color:C.taupe,marginTop:2}}>{vendorTipo(v)}</div>
                {v.empresa&&<div style={{fontSize:11,color:C.taupe}}>{v.empresa}</div>}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0,marginLeft:8}}>
                <span style={{fontSize:10,fontWeight:700,color:v.active?C.green:C.red,background:v.active?"#EDF5EF":"#F5EDEC",padding:"3px 8px",borderRadius:100}}>{v.active?"Activo":"Inactivo"}</span>
                <button onClick={function(){var u=vendors.map(function(x){if(x.id===v.id){var r=Object.assign({},x);r.active=!x.active;return r;}return x;});onSave(u);}} style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.gray,background:"#fff",color:C.black,fontSize:11,cursor:"pointer"}}>{v.active?"Desactivar":"Activar"}</button>
                <button onClick={function(){if(confirm("¿Eliminar a "+vendorDisplay(v)+" permanentemente?")){onSave(vendors.filter(function(x){return x.id!==v.id;}));}}} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #DBC8C4",background:"#fff",color:C.red,fontSize:11,cursor:"pointer",fontWeight:600}}>Eliminar</button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {EditRow("email",          "Email",       v.email)}
              {EditRow("password",       "Password",    v.password, "password")}
              {EditRow("phone",          "Tel.",        v.phone)}
              {EditRow("empresa",        "Empresa",     v.empresa)}
              {EditRow("tarifaLimpieza", "Tarifa (Q)",  v.tarifaLimpieza||0, "number")}
              {EditRow("primerNombre",   "1er nombre",  v.primerNombre)}
              {EditRow("primerApellido", "1er apellido",v.primerApellido)}
              {/* Tipo + Categoria inline */}
              <div style={{paddingTop:6,borderTop:"1px solid "+C.line}}>
                <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:6}}>Tipo de proveedor</div>
                <div style={{display:"flex",gap:6,marginBottom:8}}>
                  {["interno","externo"].map(function(t){var s=v.tipo===t;return(
                    <button key={t} onClick={function(){var u=vendors.map(function(x){if(x.id===v.id){var r=Object.assign({},x);r.tipo=t;r.categoria=t==="interno"?"EPI Limpieza":allExtCats[0]||"";return r;}return x;});onSave(u);}} style={{padding:"5px 14px",borderRadius:6,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{t}</button>
                  );})}
                </div>
                <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:6}}>Categoría</div>
                {v.tipo==="interno"?(
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {INTERNAL_CATS.map(function(c){var s=v.categoria===c;return(
                      <button key={c} onClick={function(){var u=vendors.map(function(x){if(x.id===v.id){var r=Object.assign({},x);r.categoria=c;return r;}return x;});onSave(u);}} style={{padding:"4px 10px",borderRadius:100,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:11,fontWeight:600,cursor:"pointer"}}>{c}</button>
                    );})}
                  </div>
                ):(
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {(allExtCats||[]).map(function(c){var s=v.categoria===c;return(
                      <button key={c} onClick={function(){var u=vendors.map(function(x){if(x.id===v.id){var r=Object.assign({},x);r.categoria=c;return r;}return x;});onSave(u);}} style={{padding:"4px 10px",borderRadius:100,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:11,fontWeight:600,cursor:"pointer"}}>{c}</button>
                    );})}
                  </div>
                )}
              </div>
              {/* Admin toggle for internal */}
              {v.tipo==="interno"&&(
                <div style={{display:"flex",alignItems:"center",gap:10,paddingTop:6,borderTop:"1px solid "+C.line}}>
                  <span style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase",minWidth:72}}>Acceso Admin</span>
                  <button onClick={function(){var u=vendors.map(function(x){if(x.id===v.id){var r=Object.assign({},x);r.isAdmin=!x.isAdmin;return r;}return x;});onSave(u);}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:6,border:"1px solid "+C.gray,background:v.isAdmin?"#1E1E1E":"#fff",color:v.isAdmin?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer",transition:"all .2s"}}>
                    <span style={{width:14,height:14,borderRadius:"50%",background:v.isAdmin?C.green:"#ccc",display:"inline-block",flexShrink:0}}/>
                    {v.isAdmin?"Admin activo":"Sin acceso admin"}
                  </button>
                </div>
              )}
              {/* Supervision toggle for internal */}
              {v.tipo==="interno"&&(
                <div style={{display:"flex",alignItems:"center",gap:10,paddingTop:6,borderTop:"1px solid "+C.line}}>
                  <span style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase",minWidth:72}}>Supervisión</span>
                  <button onClick={function(){var u=vendors.map(function(x){if(x.id===v.id){var r=Object.assign({},x);r.isSupervisor=!x.isSupervisor;return r;}return x;});onSave(u);}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:6,border:"1px solid "+C.gray,background:v.isSupervisor?"#3d6b52":"#fff",color:v.isSupervisor?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer",transition:"all .2s"}}>
                    <span style={{width:14,height:14,borderRadius:"50%",background:v.isSupervisor?"#fff":"#ccc",display:"inline-block",flexShrink:0}}/>
                    {v.isSupervisor?"Supervisión activa":"Sin supervisión"}
                  </button>
                  {v.isSupervisor&&<span style={{fontSize:10.5,color:C.taupe}}>Revisa limpiezas del equipo y clasifica daños</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Custom external categories */}
      <div style={{background:"#fff",borderRadius:10,padding:"14px",border:"1px solid "+C.line}}>
        <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".16em",textTransform:"uppercase",marginBottom:10}}>Categorías externas guardadas</div>
        {allExtCats.length===0&&<div style={{fontSize:12,color:C.taupe,marginBottom:8}}>Ninguna aún — agrégalas abajo.</div>}
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
          {allExtCats.map(function(c,i){return <span key={i} style={{padding:"4px 10px",borderRadius:100,background:C.surfaceWarm,fontSize:12,color:C.black,border:"1px solid "+C.line,display:"flex",alignItems:"center",gap:6}}>{c}<button onClick={function(){var u=allExtCats.filter(function(_,j){return j!==i;});if(onSaveExtCats)onSaveExtCats(u);}} style={{background:"none",border:"none",color:C.gray,fontSize:14,cursor:"pointer",lineHeight:1}}>×</button></span>;})}
        </div>
        <div style={{display:"flex",gap:8}}>
          <input placeholder="Ej. Servicios Múltiples (máx 3 palabras)" value={newExtCat} onChange={function(e){setNewExtCat(e.target.value);}} style={{flex:1,border:"1px solid "+C.gray,borderRadius:6,padding:"8px 12px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none"}}/>
          <button onClick={addExtCat} style={{padding:"8px 14px",borderRadius:6,border:"none",background:C.black,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>+ Agregar</button>
        </div>
      </div>

      {/* Add new vendor */}
      <div style={{background:"#fff",borderRadius:10,padding:"16px",border:"1.5px dashed "+C.gray}}>
        <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".16em",textTransform:"uppercase",marginBottom:14}}>Agregar proveedor</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <F label="Primer nombre *"><input placeholder="María" value={newV.primerNombre} onChange={function(e){setNewV(function(p){return Object.assign({},p,{primerNombre:e.target.value});})}}/></F>
            <F label="Segundo nombre"><input placeholder="José" value={newV.segundoNombre} onChange={function(e){setNewV(function(p){return Object.assign({},p,{segundoNombre:e.target.value});})}}/></F>
            <F label="Primer apellido *"><input placeholder="García" value={newV.primerApellido} onChange={function(e){setNewV(function(p){return Object.assign({},p,{primerApellido:e.target.value});})}}/></F>
            <F label="Segundo apellido"><input placeholder="López" value={newV.segundoApellido} onChange={function(e){setNewV(function(p){return Object.assign({},p,{segundoApellido:e.target.value});})}}/></F>
          </div>
          <F label="Empresa / Razón social"><input placeholder="Servicios XYZ S.A." value={newV.empresa} onChange={function(e){setNewV(function(p){return Object.assign({},p,{empresa:e.target.value});})}}/></F>
          <div>
            <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:8}}>Tipo de proveedor</div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {["interno","externo"].map(function(t){var s=newV.tipo===t;return <button key={t} onClick={function(){setNewV(function(p){return Object.assign({},p,{tipo:t,categoria:t==="interno"?"EPI Limpieza":allExtCats[0]||""});});}} style={{padding:"8px 18px",borderRadius:6,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:12.5,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{t}</button>;})}
            </div>
            <div>
              <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:6}}>Categoría</div>
              {newV.tipo==="interno"?(
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {INTERNAL_CATS.map(function(c){var s=newV.categoria===c;return <button key={c} onClick={function(){setNewV(function(p){return Object.assign({},p,{categoria:c});});}} style={{padding:"6px 14px",borderRadius:100,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:12,fontWeight:600,cursor:"pointer"}}>{c}</button>;})}
                </div>
              ):(
                <div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                    {allExtCats.map(function(c){var s=newV.categoria===c;return <button key={c} onClick={function(){setNewV(function(p){return Object.assign({},p,{categoria:c});});}} style={{padding:"6px 14px",borderRadius:100,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:12,fontWeight:600,cursor:"pointer"}}>{c}</button>;})}
                  </div>
                  {allExtCats.length===0&&<div style={{fontSize:12,color:C.taupe}}>Agrega primero una categoría externa arriba.</div>}
                </div>
              )}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <F label="Correo electrónico *"><input type="email" placeholder="correo@empresa.com" value={newV.email} onChange={function(e){setNewV(function(p){return Object.assign({},p,{email:e.target.value});})}}/></F>
            <F label="Contraseña inicial *"><input type="password" placeholder="••••••••" value={newV.password} onChange={function(e){setNewV(function(p){return Object.assign({},p,{password:e.target.value});})}}/></F>
            <F label="WhatsApp"><input placeholder="+502 9999 9999" value={newV.phone} onChange={function(e){setNewV(function(p){return Object.assign({},p,{phone:e.target.value});})}}/></F>
            <F label="Tarifa limpieza (Q)"><input type="number" placeholder="75" value={newV.tarifaLimpieza} onChange={function(e){setNewV(function(p){return Object.assign({},p,{tarifaLimpieza:e.target.value});})}}/></F>
          </div>
          <button onClick={addVendor} style={{width:"100%",padding:"13px",borderRadius:8,border:"none",background:C.black,color:"#fff",fontSize:12.5,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",cursor:"pointer"}}>+ Agregar proveedor</button>
        </div>
      </div>
    </div>
  );
}



/* ─── PropList — property list with safe delete + inline note about existing reports */
function PropList({props, onSave}) {
  const [confirmId, setConfirmId] = useState(null);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {props.map(function(p,i){
        var isConfirming = confirmId===p.id;
        return (
          <div key={p.id} style={{background:"#fff",borderRadius:10,padding:"12px 16px",border:"1px solid "+(isConfirming?"#DBC8C4":C.line)}}>
            {/* Name + delete area */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:isConfirming?10:8}}>
              <span style={{fontSize:13.5,fontWeight:500,color:C.black,flex:1}}>{p.name}</span>
              {!isConfirming&&(
                <button onClick={function(){setConfirmId(p.id);}} style={{flexShrink:0,padding:"5px 12px",borderRadius:6,border:"1px solid #DBC8C4",background:"#FFF9F9",color:C.red,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
                  Eliminar
                </button>
              )}
            </div>

            {/* Confirm delete */}
            {isConfirming&&(
              <div style={{background:"#FFF9F9",borderRadius:8,padding:"11px 13px",border:"1px solid #E8D0D0",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:600,color:C.red,marginBottom:4}}>¿Eliminar "{p.name}"?</div>
                <div style={{fontSize:11.5,color:C.earth,lineHeight:1.6,marginBottom:10}}>
                  Los trabajos ya creados con esta propiedad <strong>no se verán afectados</strong> — seguirán mostrando el nombre original. Solo desaparecerá del selector al crear nuevos reportes.
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={function(){onSave(props.filter(function(x){return x.id!==p.id;}));setConfirmId(null);}} style={{flex:1,padding:"9px",borderRadius:7,border:"none",background:C.red,color:"#fff",fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Sí, eliminar</button>
                  <button onClick={function(){setConfirmId(null);}} style={{flex:1,padding:"9px",borderRadius:7,border:"1px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
                </div>
              </div>
            )}

            {/* Cuartos / Baños */}
            {!isConfirming&&(
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".12em",textTransform:"uppercase",display:"block",marginBottom:4}}>Cuartos</label>
                  <input type="number" min="1" max="10" value={p.cuartos||1} onChange={function(e){var v=parseInt(e.target.value)||1;onSave(props.map(function(x,j){if(j!==i)return x;return Object.assign({},x,{cuartos:v});}));}} style={{width:"100%",border:"1px solid "+C.gray,borderRadius:6,padding:"6px 10px",fontSize:13,fontFamily:"Montserrat,sans-serif",outline:"none"}}/>
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".12em",textTransform:"uppercase",display:"block",marginBottom:4}}>Baños</label>
                  <input type="number" min="1" max="10" value={p.banos||1} onChange={function(e){var v=parseInt(e.target.value)||1;onSave(props.map(function(x,j){if(j!==i)return x;return Object.assign({},x,{banos:v});}));}} style={{width:"100%",border:"1px solid "+C.gray,borderRadius:6,padding:"6px 10px",fontSize:13,fontFamily:"Montserrat,sans-serif",outline:"none"}}/>
                </div>
              </div>
            )}

            {/* Anuncio + fotos de referencia (Hospitable / enlace del anuncio) */}
            {!isConfirming&&(
              <div style={{marginTop:10,borderTop:"1px solid "+C.gray,paddingTop:10}}>
                <label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".12em",textTransform:"uppercase",display:"block",marginBottom:4}}>Enlace del anuncio (referencia)</label>
                <input type="url" placeholder="https://… (Airbnb / Hospitable)" value={p.listingUrl||""} onChange={function(e){var v=e.target.value;onSave(props.map(function(x,j){if(j!==i)return x;return Object.assign({},x,{listingUrl:v});}));}} style={{width:"100%",border:"1px solid "+C.gray,borderRadius:6,padding:"6px 10px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none",boxSizing:"border-box"}}/>
                <div style={{fontSize:10.5,color:C.taupe,marginTop:5,lineHeight:1.5}}>El técnico verá este enlace como referencia antes de fotografiar cada espacio. Opcionalmente sube fotos de referencia por espacio:</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:8}}>
                  {[["habitacion","Habitación"],["cocina","Cocina"],["sala","Sala"]].map(function(rk){
                    var key=rk[0]; var img=(p.refImagenes||{})[key];
                    function setRef(val){onSave(props.map(function(x,j){if(j!==i)return x;var ri=Object.assign({},x.refImagenes||{});if(val)ri[key]=val;else delete ri[key];return Object.assign({},x,{refImagenes:ri});}));}
                    return (
                      <div key={key}>
                        <div style={{fontSize:9.5,fontWeight:700,color:C.earth,marginBottom:4}}>{rk[1]}</div>
                        {img
                          ? <div style={{position:"relative"}}><img src={img} alt={rk[1]} style={{width:"100%",height:54,objectFit:"cover",borderRadius:6,border:"1px solid "+C.gray}}/><button onClick={function(){setRef(null);}} style={{position:"absolute",top:2,right:2,width:18,height:18,borderRadius:9,border:"none",background:"rgba(0,0,0,.55)",color:"#fff",fontSize:11,cursor:"pointer",lineHeight:1}}>×</button></div>
                          : <label style={{display:"flex",alignItems:"center",justifyContent:"center",height:54,borderRadius:6,border:"1px dashed "+C.gray,cursor:"pointer",fontSize:9.5,color:C.taupe,textAlign:"center"}}>+ Subir<input type="file" accept="image/*" style={{display:"none"}} onChange={function(e){var f=e.target.files&&e.target.files[0];if(f)compress(f).then(setRef);}}/></label>
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


/* ─── Compartir datos con el dashboard de propietarios (mi-spacioam)
   Lee la pestaña SETUP del Sheet del dashboard (lectura pública vía gviz) y
   trae el "Listing link" de cada propiedad, emparejando por nombre. Así ambos
   proyectos comparten los enlaces de los anuncios sin backend adicional. */
var OWNER_SHEET_ID = "1l9wLH8880NlN9ac2jvne2U6cqej6gycqAD77Z25cLF4";
function parseCSVrows(text){
  var rows=[],row=[],cur="",q=false;
  for(var i=0;i<text.length;i++){var c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}
    else{if(c==='"')q=true;else if(c===","){row.push(cur);cur="";}else if(c==="\n"){row.push(cur);rows.push(row);row=[];cur="";}else if(c==="\r"){}else cur+=c;}
  }
  if(cur.length||row.length){row.push(cur);rows.push(row);}
  return rows;
}
async function fetchOwnerListings(){
  var url="https://docs.google.com/spreadsheets/d/"+OWNER_SHEET_ID+"/gviz/tq?tqx=out:csv&sheet="+encodeURIComponent("SETUP");
  var res=await fetch(url);
  if(!res.ok) throw new Error("No se pudo leer el Sheet del dashboard ("+res.status+")");
  var rows=parseCSVrows(await res.text());
  if(!rows.length) return {};
  var head=rows[0].map(function(h){return (h||"").trim();});
  var iName=head.indexOf("property_name"), iLink=head.indexOf("Listing link");
  if(iName<0||iLink<0) throw new Error("El Sheet no tiene las columnas property_name / Listing link");
  var map={};
  for(var r=1;r<rows.length;r++){
    var nm=(rows[r][iName]||"").trim(), lk=(rows[r][iLink]||"").trim();
    if(nm&&lk&&!map[normNm(nm)]) map[normNm(nm)]=lk;
  }
  return map;
}

function PropsCfg({props,onSave}) {
  const [newP, setNewP] = useState("");
  const [msg,  setMsg]  = useState(null);
  const [impMsg, setImpMsg] = useState(null);
  const [impBusy,setImpBusy]= useState(false);
  const ref = useRef(null);
  async function importLinks(silent){
    setImpBusy(true);if(!silent)setImpMsg(null);
    try{
      var map=await fetchOwnerListings();
      var matched=0;
      var merged=props.map(function(p){
        var lk=map[normNm(p.name)];
        if(lk&&p.listingUrl!==lk){matched++;return Object.assign({},p,{listingUrl:lk});}
        return p;
      });
      if(matched>0) onSave(merged);
      try{ localStorage.setItem("epi_lastLinkImport", String(Date.now())); }catch(_){}
      if(!silent) setImpMsg(matched>0?(matched+" enlaces de anuncios importados del dashboard de propietarios."):"No se encontraron enlaces nuevos (revisa que los nombres de las propiedades coincidan con los del dashboard).");
    }catch(e){ if(!silent) setImpMsg("No se pudo importar: "+(e&&e.message?e.message:"error de lectura.")); }
    finally{ setImpBusy(false); if(!silent) setTimeout(function(){setImpMsg(null);},7000); }
  }
  /* Importación recurrente: si pasó más de 3 días desde la última, vuelve a
     traer los enlaces automáticamente al abrir esta pestaña (silencioso). */
  useEffect(function(){
    if(IS_CLAUDE_SANDBOX) return;
    try{
      var last=parseInt(localStorage.getItem("epi_lastLinkImport")||"0",10);
      if(Date.now()-last > 3*86400000){ importLinks(true); }
    }catch(_){}
  }, []);
  function handleTxt(e) {
    var file=e.target.files&&e.target.files[0]; if(!file) return;
    var reader=new FileReader();
    reader.onload=function(ev){
      var lines=ev.target.result.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);
      var added=0,sk=0,merged=props.slice();
      lines.forEach(function(name,i){if(merged.some(function(p){return p.name.toLowerCase()===name.toLowerCase();})){sk++;return;} merged.push({id:"p"+Date.now()+"_"+i,name:name,cuartos:1,banos:1});added++;});
      onSave(merged);
      setMsg(added+" propiedades agregadas"+(sk>0?", "+sk+" omitidas":"")+".");
      setTimeout(function(){setMsg(null);},4000);
    };
    reader.readAsText(file); e.target.value="";
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:"#fff",borderRadius:12,padding:18,border:"1px solid "+C.line}}>
        <div style={{fontSize:10.5,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:10}}>Cargar desde archivo .txt</div>
        <div style={{background:C.beige,borderRadius:10,padding:"11px 14px",marginBottom:12,fontSize:12,color:C.earth,fontFamily:"monospace",lineHeight:1.8}}>Narama – Apto 725<br/>Casa San Ignacio – Apto 506</div>
        <button onClick={function(){if(ref.current)ref.current.click();}} style={{padding:"11px 18px",borderRadius:10,border:"1.5px solid "+C.gray,background:C.black,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>📄 Seleccionar .txt</button>
        <input ref={ref} type="file" accept=".txt,text/plain" style={{display:"none"}} onChange={handleTxt}/>
        {msg&&<div style={{marginTop:10,fontSize:13,fontWeight:600,color:C.green,background:"#EDF5EF",padding:"9px 13px",borderRadius:9}}>{msg}</div>}
      </div>
      <div style={{fontSize:10.5,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",paddingLeft:2}}>Lista — {props.length} propiedades</div>
      <div style={{background:"#fff",borderRadius:12,padding:14,border:"1px solid "+C.line}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 200px"}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.black}}>Enlaces de anuncios (dashboard de propietarios)</div>
            <div style={{fontSize:11,color:C.taupe,marginTop:3,lineHeight:1.5}}>Trae automáticamente el enlace del anuncio de cada propiedad desde el dashboard de propietarios, emparejando por nombre.</div>
          </div>
          <button onClick={importLinks} disabled={impBusy} style={{padding:"10px 16px",borderRadius:9,border:"1.5px solid "+C.gray,background:impBusy?C.gray:C.black,color:"#fff",fontSize:12.5,fontWeight:600,cursor:impBusy?"wait":"pointer",flexShrink:0}}>{impBusy?"Importando…":"↧ Importar enlaces"}</button>
        </div>
        {impMsg&&<div style={{marginTop:10,fontSize:12.5,fontWeight:600,color:impMsg.indexOf("No se")===0?C.red:C.green,background:impMsg.indexOf("No se")===0?"#F5EDEC":"#EDF5EF",padding:"9px 13px",borderRadius:9,lineHeight:1.5}}>{impMsg}</div>}
      </div>
      {(function(){
        var problemas=props.filter(function(p){ return !p.listingUrl || refPhotosOf(p).length===0; });
        if(!problemas.length) return null;
        return (
          <div style={{background:"#FFF9F2",borderRadius:12,padding:14,border:"1px solid #E6C9A8"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:13,fontWeight:700,color:"#9a6b2f"}}>⚠ Propiedades por completar ({problemas.length})</span>
            </div>
            <div style={{fontSize:11.5,color:C.earth,lineHeight:1.55,marginBottom:10}}>Estas propiedades aún no tienen enlace de anuncio o foto de referencia. Sin esto, el técnico no ve la referencia al limpiar. Resuélvelo importando los enlaces, sincronizando con Hospitable, o subiendo las fotos en cada propiedad.</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {problemas.map(function(p){
                var falta=[]; if(!p.listingUrl)falta.push("enlace del anuncio"); if(refPhotosOf(p).length===0)falta.push("foto de referencia");
                return <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,background:"#fff",borderRadius:8,padding:"8px 12px",border:"1px solid "+C.line}}>
                  <span style={{fontSize:12.5,fontWeight:600,color:C.black}}>{p.name}</span>
                  <span style={{fontSize:10.5,fontWeight:700,color:"#9a6b2f",letterSpacing:".04em",textAlign:"right"}}>Falta: {falta.join(" + ")}</span>
                </div>;
              })}
            </div>
          </div>
        );
      })()}
      <PropList props={props} onSave={onSave}/>
      <div style={{background:"#fff",borderRadius:12,padding:14,border:"1.5px dashed "+C.gray}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"end"}}>
          <F label="Agregar propiedad"><input placeholder="Ej. Torre Norte – Apto 304" value={newP} onChange={function(e){setNewP(e.target.value);}}/></F>
          <button onClick={function(){if(!newP)return;onSave(props.concat([{id:"p"+Date.now(),name:newP,cuartos:1,banos:1}]));setNewP("");}} style={{height:44,padding:"0 18px",borderRadius:10,border:"none",background:C.black,color:"#fff",fontSize:12.5,fontWeight:600,cursor:"pointer"}}>+ Agregar</button>
        </div>
      </div>
    </div>
  );
}

function CompanyCfg({company,onSave}) {
  const [name, setName] = useState(company&&company.name?company.name:"");
  const [nit,  setNit]  = useState(company&&company.nit?company.nit:"");
  const [ok,   setOk]   = useState(false);
  function save() { if(!name||!nit) return; onSave({name:name,nit:nit}); setOk(true); setTimeout(function(){setOk(false);},2500); }
  return (
    <Card title="Datos de la empresa (para facturas)">
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{fontSize:13,color:C.earth,lineHeight:1.6,background:C.beige,padding:"12px 14px",borderRadius:10}}>Estos datos aparecen en la nota de facturación del formulario.</div>
        <F label="Nombre de la empresa"><input placeholder="Spacio AM S.A." value={name} onChange={function(e){setName(e.target.value);}}/></F>
        <F label="NIT"><input placeholder="118287796" value={nit} onChange={function(e){setNit(e.target.value);}}/></F>
        {ok&&<div style={{padding:"10px 13px",borderRadius:9,fontSize:13,fontWeight:600,background:"#EDF5EF",color:C.green}}>✓ Datos actualizados.</div>}
        <BigBtn onClick={save} dis={!name||!nit}>Guardar →</BigBtn>
      </div>
    </Card>
  );
}

function SecurityCfg({adminPin,onSave}) {
  const [cur,  setCur]  = useState("");
  const [np,   setNp]   = useState("");
  const [cp,   setCp]   = useState("");
  const [msg,  setMsg]  = useState(null);
  function save() {
    if(cur!==adminPin) { setMsg({ok:false,t:"PIN actual incorrecto."}); return; }
    if(np.length<4)    { setMsg({ok:false,t:"El nuevo PIN debe tener al menos 4 caracteres."}); return; }
    if(np!==cp)        { setMsg({ok:false,t:"Los PINs nuevos no coinciden."}); return; }
    onSave(np); setCur(""); setNp(""); setCp("");
    setMsg({ok:true,t:"✓ PIN actualizado correctamente."}); setTimeout(function(){setMsg(null);},3000);
  }
  return (
    <Card title="Cambiar PIN de administrador">
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <F label="PIN actual"><input type="password" placeholder="••••••••" value={cur} onChange={function(e){setCur(e.target.value);}}/></F>
        <div style={{height:1,background:C.gray}}/>
        <F label="Nuevo PIN"><input type="password" placeholder="Mínimo 4 caracteres" value={np} onChange={function(e){setNp(e.target.value);}}/></F>
        <F label="Confirmar nuevo PIN"><input type="password" placeholder="Repite el PIN" value={cp} onChange={function(e){setCp(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")save();}}/></F>
        {msg&&<div style={{padding:"10px 13px",borderRadius:9,fontSize:13,fontWeight:600,background:msg.ok?"#EDF5EF":"#F5EDEC",color:msg.ok?C.green:C.red}}>{msg.t}</div>}
        <BigBtn onClick={save} dis={!cur||!np||!cp}>Actualizar PIN →</BigBtn>
      </div>
    </Card>
  );
}

/* ─── Detail Modal */
function DetailModal({rep,vendors,props,onClose,onMarkPaid,onDelete,onSave,onQA,hasLinkedDmg,onExtract,readOnly}) {
  const [editing, setEditing] = useState(false);
  /* Auto-fill total from tariff if empty — NUNCA para reportes de daños (no generan pago) */
  var initAT2 = autoTarifa(rep.reportadoPor||"", vendors);
  var initTotal = rep.total || (isDanos(rep.categoria)?"":initAT2.tarifa);
  const [form,    setForm]    = useState({
    propiedad:    rep.propiedad,
    fecha:        rep.fecha,
    reportadoPor: rep.reportadoPor,
    categoria:    rep.categoria,
    descripcion:  rep.descripcion,
    comentarios:  rep.comentarios||"",
    total:        initTotal,
    pagadoPor:    rep.pagadoPor||"",
    fotoAntes:    rep.fotoAntes||[],
    fotoDespues:  rep.fotoDespues||[],
    factura:      rep.factura||null,
  });
  const [saved, setSaved] = useState(false);

  function setF(k,v) { setForm(function(p){var u=Object.assign({},p);u[k]=v;return u;}); }

  function resetForm() {
    var rAT=autoTarifa(rep.reportadoPor||"",vendors);
    setForm({propiedad:rep.propiedad,fecha:rep.fecha,reportadoPor:rep.reportadoPor,categoria:rep.categoria,descripcion:rep.descripcion,comentarios:rep.comentarios||"",total:rep.total||(isDanos(rep.categoria)?"":rAT.tarifa),pagadoPor:rep.pagadoPor||"",fotoAntes:rep.fotoAntes||[],fotoDespues:rep.fotoDespues||[],factura:rep.factura||null});
  }

  async function addPics(files,field,max) {
    var c = await Promise.all(Array.from(files).map(function(f){return compress(f);}));
    setForm(function(p){var merged=p[field].concat(c).slice(0,max);var u=Object.assign({},p);u[field]=merged;return u;});
  }
  function rmPic(field,idx) { setForm(function(p){var u=Object.assign({},p);u[field]=p[field].filter(function(_,j){return j!==idx;});return u;}); }

  function saveEdit() {
    var updated = Object.assign({},rep,form);
    onSave(updated);
    setSaved(true);
    setEditing(false);
    setTimeout(function(){setSaved(false);},2500);
  }

  var vend = vendors&&vendors.find(function(v){return v.email===rep.reportadoPor;});
  var ph   = vend&&vend.phone ? vend.phone.replace(/\D/g,"") : "";
  var vn   = vend&&vend.name  ? vend.name : rep.reportadoPor;
  var al   = alertLvl(rep);
  var b    = BADGE[rep.categoria]||BADGE["Mantenimiento"];

  function waLink(type) {
    var base = ph ? "https://wa.me/"+ph+"?text=" : "https://wa.me/?text=";
    var txt;
    if (type==="paid") {
      txt = "Hola "+vn+"\n\nTe confirmamos que el pago por el trabajo en "+rep.propiedad+" ("+fmtDate(rep.fecha)+") por Q"+rep.total+" ya fue procesado.\n\nGracias - Spacio AM";
    } else {
      var d = daysSince(rep.createdAt||rep.id);
      txt = "Hola "+vn+"\n\nTe recordamos que el pago del trabajo en "+rep.propiedad+" ("+fmtDate(rep.fecha)+") por Q"+rep.total+" lleva "+d+" dia"+(d!==1?"s":"")+" pendiente.\n\nSpacio AM";
    }
    return base+encodeURIComponent(txt);
  }

  return (
    <Overlay onClick={onClose}>
      <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:580,maxHeight:"90vh",overflow:"auto",boxShadow:"0 32px 80px rgba(0,0,0,.22)"}} onClick={function(e){e.stopPropagation();}}>

        {/* Header */}
        <div style={{padding:"18px 24px",borderBottom:"1px solid "+C.gray,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#fff",zIndex:10}}>
          <div>
            <div style={{fontSize:10,color:editing?C.peach:C.earth,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase",marginBottom:3}}>{editing?"Modo edición":"Detalle del trabajo"}</div>
            <div style={{fontSize:15,fontWeight:600,color:C.black}}>{rep.propiedad}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {saved&&<span style={{fontSize:11,fontWeight:700,color:C.green,background:"#EDF5EF",padding:"4px 10px",borderRadius:100}}>✓ Guardado</span>}
            {!editing&&!readOnly&&<button onClick={function(){setEditing(true);}} style={{padding:"7px 13px",borderRadius:8,border:"1.5px solid "+C.earth,background:"none",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer"}}>✏ Editar</button>}
            {!editing&&!readOnly&&<button onClick={onDelete} style={{padding:"7px 13px",borderRadius:8,border:"1.5px solid #e0cece",background:"none",color:C.red,fontSize:12,fontWeight:600,cursor:"pointer"}}>Eliminar</button>}
            {editing&&<button onClick={function(){setEditing(false);resetForm();}} style={{padding:"7px 13px",borderRadius:8,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancelar</button>}
            {editing&&<button onClick={saveEdit} style={{padding:"7px 13px",borderRadius:8,border:"none",background:C.peach,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Guardar cambios →</button>}
            {!editing&&<button onClick={onClose} style={{padding:"7px 13px",borderRadius:8,border:"none",background:C.black,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cerrar</button>}
          </div>
        </div>

        <div style={{padding:"22px 24px",display:"flex",flexDirection:"column",gap:18}}>

          {/* ── EDIT MODE ── */}
          {editing&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{background:"#FEF0EC",borderRadius:10,padding:"10px 14px",fontSize:12.5,color:C.peach,fontWeight:600}}>✏ Editando registro — los cambios se guardan al presionar "Guardar cambios"</div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <F label="Propiedad">
                  <select value={form.propiedad} onChange={function(e){setF("propiedad",e.target.value);}}>
                    {props&&props.map(function(p){return <option key={p.id}>{p.name}</option>;})}
                    {!(props&&props.some(function(p){return p.name===form.propiedad;}))&&<option>{form.propiedad}</option>}
                  </select>
                </F>
                <F label="Fecha">
                  <input type="date" value={form.fecha} onChange={function(e){setF("fecha",e.target.value);}}/>
                </F>
              </div>

              <F label="Proveedor / Técnico responsable">
                <select value={form.reportadoPor} onChange={function(e){
                    var email = e.target.value;
                    setF("reportadoPor",email);
                    var at = autoTarifa(email, vendors);
                    if(at.tarifa) setF("total",at.tarifa);
                  }}>
                  {vendors&&vendors.map(function(v){return <option key={v.id} value={v.email}>{vendorDisplay(v)} ({v.email})</option>;})}
                  {!(vendors&&vendors.some(function(v){return v.email===form.reportadoPor;}))&&<option value={form.reportadoPor}>{form.reportadoPor}</option>}
                </select>
              </F>

              <div>
                <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:10}}>Categoría</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {CATS.map(function(c){var bx=BADGE[c];var s=form.categoria===c;return <button key={c} onClick={function(){setF("categoria",c);}} style={{padding:"7px 14px",borderRadius:100,cursor:"pointer",border:"1.5px solid "+(s?bx.tx:C.gray),background:s?bx.bg:"#fff",color:s?bx.tx:C.earth,fontSize:12.5,fontWeight:600,transition:"all .18s"}}>{c}</button>;})}
                </div>
              </div>

              <F label="Descripción / Trabajo realizado">
                <textarea rows={4} value={form.descripcion} onChange={function(e){setF("descripcion",e.target.value);}}/>
              </F>

              <F label="Notas / Comentarios internos">
                <textarea rows={3} placeholder="Observaciones, materiales usados, pendientes…" value={form.comentarios} onChange={function(e){setF("comentarios",e.target.value);}}/>
              </F>

              {(function(){
                var at = autoTarifa(form.reportadoPor, vendors);
                return (
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",flex:1}}>Total cobrado (Q)</div>
                      {at.locked&&<span style={{fontSize:10,color:C.green,fontWeight:600}}>Tarifa fija: Q{at.tarifa}</span>}
                    </div>
                    <input type="number" placeholder="Ej. 850" value={form.total} onChange={function(e){setF("total",e.target.value);}}
                      style={{border:"1.5px solid "+(at.locked&&form.total===at.tarifa?"#c8dfc8":C.gray),borderRadius:8,padding:"10px 14px",fontSize:14,fontFamily:"Montserrat,sans-serif",outline:"none",fontWeight:at.locked&&form.total===at.tarifa?700:400,color:at.locked&&form.total===at.tarifa?C.green:C.black}}/>
                    {at.locked&&form.total!==at.tarifa&&form.total!==""&&<div style={{fontSize:11,color:"#7a6000"}}>⚠ Modificado — tarifa fija es Q{at.tarifa}</div>}
                  </div>
                );
              })()}

              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>¿Quién paga este trabajo?</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Spacio AM","Dueño"].map(function(v){
                    var colors={"Spacio AM":{bg:"#EEF3FA",tx:"#4a7fa5",bd:"#4a7fa5"},"Dueño":{bg:"#FEF0EC",tx:"#E9826A",bd:"#E9826A"}};
                    var cx=colors[v]; var s=form.pagadoPor===v;
                    return <button key={v} onClick={function(){setF("pagadoPor",s?"":v);}} style={{padding:"8px 18px",borderRadius:100,cursor:"pointer",border:"1.5px solid "+(s?cx.bd:C.gray),background:s?cx.bg:"#fff",color:s?cx.tx:C.earth,fontSize:13,fontWeight:600,transition:"all .18s"}}>{s?"✓ ":""}{v}</button>;
                  })}
                  {form.pagadoPor&&<button onClick={function(){setF("pagadoPor","");}} style={{padding:"8px 14px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.gray,fontSize:12,cursor:"pointer"}}>✕ Sin clasificar</button>}
                </div>
              </div>

              {!isCleaning(rep.categoria)&&(
                <div style={{borderTop:"1px solid "+C.gray,paddingTop:16,display:"flex",flexDirection:"column",gap:16}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>Evidencia fotográfica</div>
                  <PicUp label="ANTES"   max={2} photos={form.fotoAntes}   accent={C.earth} onAdd={function(f){addPics(f,"fotoAntes",2);}}   onDel={function(i){rmPic("fotoAntes",i);}}/>
                  <div style={{height:1,background:C.gray}}/>
                  <PicUp label="DESPUÉS" max={3} photos={form.fotoDespues} accent={C.peach} onAdd={function(f){addPics(f,"fotoDespues",3);}} onDel={function(i){rmPic("fotoDespues",i);}}/>
                </div>
              )}
              {!isCleaning(rep.categoria)&&(
                <div style={{borderTop:"1px solid "+C.gray,paddingTop:16,display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>Factura</div>
                  <InvoiceUp
                    factura={form.factura}
                    onAdd={function(file){var r=new FileReader();r.onload=function(ev){setF("factura",{name:file.name,type:file.type,data:ev.target.result});};r.readAsDataURL(file);}}
                    onDel={function(){setF("factura",null);}}
                  />
                </div>
              )}
              {isCleaning(rep.categoria)&&(
                <div style={{borderTop:"1px solid "+C.gray,paddingTop:16}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:12}}>Fotos de la limpieza</div>
                  <CleaningPhotoGallery rep={rep}/>
                </div>
              )}

              <button onClick={saveEdit} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",background:C.black,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",letterSpacing:".05em"}}>Guardar cambios →</button>
            </div>
          )}

          {/* ── VIEW MODE ── */}
          {!editing&&(
            <div style={{display:"flex",flexDirection:"column",gap:18}}>
              {al&&<div style={{background:ALT[al].bg,borderRadius:10,padding:"10px 14px",fontSize:13,fontWeight:600,color:ALT[al].clr}}>⚠ {ALT[al].label}</div>}
              <ExecSummary rep={rep} vendors={vendors}/>
              <div><div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Categoría</div><span style={{padding:"5px 13px",borderRadius:100,fontSize:12,fontWeight:700,background:b.bg,color:b.tx}}>{rep.categoria}</span></div>
              <div><div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Trabajo realizado</div><div style={{fontSize:14,color:C.black,lineHeight:1.65,background:C.beige,padding:"13px 15px",borderRadius:10}}>{rep.descripcion}</div></div>
              {rep.comentarios&&<div><div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>Notas / Comentarios</div><div style={{fontSize:13.5,color:C.earth,lineHeight:1.65,background:C.beige,padding:"11px 14px",borderRadius:10}}>{rep.comentarios}</div></div>}
              {/* ── Cleaning: full photo gallery organized by section */}
              {isCleaning(rep.categoria)&&<CleaningPhotoGallery rep={rep}/>}
              {/* ── Non-cleaning: simple before/after */}
              {!isCleaning(rep.categoria)&&rep.fotoAntes&&rep.fotoAntes.length>0&&<PicsRow title="Fotos ANTES" photos={rep.fotoAntes}/>}
              {!isCleaning(rep.categoria)&&rep.fotoDespues&&rep.fotoDespues.length>0&&<PicsRow title="Fotos DESPUÉS" photos={rep.fotoDespues} accent={C.peach}/>}
              {/* ── Inventory summary */}
              {isCleaning(rep.categoria)&&rep.inventario&&rep.inventario.length>0&&(
                <InventorySummary inventario={rep.inventario}/>
              )}
              {/* ── Damage summary */}
              {isCleaning(rep.categoria)&&rep.hayDanios&&rep.danios&&rep.danios.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <DamageSummary danios={rep.danios}/>
                  {hasLinkedDmg
                    ? <div style={{padding:"9px 13px",borderRadius:8,background:"#EDF5EF",fontSize:12,color:C.green,fontWeight:600}}>✓ Ya existe un reporte de daños independiente para este trabajo</div>
                    : (onExtract&&!readOnly&&<button onClick={function(){onExtract(rep);}} style={{padding:"11px 14px",borderRadius:10,border:"1.5px solid #DBC8C4",background:"#fff",color:C.red,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>↪ Extraer daños como reporte independiente →</button>)}
                </div>
              )}
              {isCleaning(rep.categoria)&&!rep.hayDanios&&(
                <div style={{padding:"10px 14px",borderRadius:8,background:"#EDF5EF",fontSize:13,color:C.green,fontWeight:600}}>✓ Sin daños reportados</div>
              )}
              {rep.factura ? (
                <div>
                  <div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:10}}>Factura adjunta</div>
                  {rep.factura.type&&rep.factura.type.startsWith("image/")
                    ? <img src={rep.factura.data} alt="factura" style={{width:"100%",maxHeight:280,objectFit:"contain",borderRadius:10,border:"1px solid "+C.gray}}/>
                    : <a href={rep.factura.data} download={rep.factura.name} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"11px 16px",borderRadius:10,background:C.beige,border:"1px solid "+C.gray,color:C.black,fontSize:13,fontWeight:600,textDecoration:"none"}}>📄 {rep.factura.name}</a>}
                </div>
              ) : <div style={{fontSize:12,color:C.gray,padding:"10px 14px",borderRadius:9,border:"1px dashed "+C.gray,textAlign:"center"}}>Sin factura adjunta</div>}
              {isCleaning(rep.categoria)&&onQA&&<QASection rep={rep} onQA={onQA}/>}
              {isDanos(rep.categoria)&&(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {rep.danios&&rep.danios.length>0&&<DamageSummary danios={rep.danios}/>}
                  <div style={{background:C.surfaceWarm,border:"1px solid "+C.line,borderRadius:10,padding:"12px 14px",fontSize:12.5,color:C.earth,lineHeight:1.6}}>
                  ℹ Los <strong>reportes de daños</strong> son de seguimiento — no generan pago al técnico ni se cuentan en “A depositar”.
                  </div>
                </div>
              )}
              {rep.total&&!isDanos(rep.categoria)&&!readOnly&&(
                <div style={{borderTop:"1px solid "+C.gray,paddingTop:16}}>
                  <div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:10}}>Estado de pago</div>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
                    <div style={{flex:1,padding:"11px 14px",borderRadius:10,background:rep.paid?"#EDF5EF":"#F5EDEC",fontSize:14,fontWeight:700,color:rep.paid?C.green:C.red}}>{rep.paid?"✓ Pagado":"● Pendiente"}</div>
                    <button onClick={function(){onMarkPaid(!rep.paid);}} style={{padding:"11px 16px",borderRadius:10,border:"1.5px solid "+C.gray,background:"#fff",fontSize:12.5,fontWeight:600,cursor:"pointer",color:C.black,whiteSpace:"nowrap"}}>{rep.paid?"Marcar pendiente":"Marcar pagado ✓"}</button>
                  </div>
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>¿Quién paga este trabajo?</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {["Spacio AM","Dueño"].map(function(v){
                        var colors={"Spacio AM":{bg:"#EEF3FA",tx:"#4a7fa5"},"Dueño":{bg:"#FEF0EC",tx:"#E9826A"}};
                        var cx=colors[v]; var s=rep.pagadoPor===v;
                        return <button key={v} onClick={function(){onSave(Object.assign({},rep,{pagadoPor:s?"":v}));}} style={{padding:"7px 16px",borderRadius:100,cursor:"pointer",border:"1.5px solid "+(s?cx.tx:C.gray),background:s?cx.bg:"#fff",color:s?cx.tx:C.earth,fontSize:12.5,fontWeight:600,transition:"all .18s"}}>{s?"✓ ":""}{v}</button>;
                      })}
                    </div>
                    {!rep.pagadoPor&&<div style={{fontSize:11,color:C.earth,marginTop:6}}>Sin clasificar — selecciona quién cubre este trabajo.</div>}
                  </div>
                  {!ph&&<div style={{fontSize:12,color:C.earth,background:C.beige,padding:"9px 12px",borderRadius:8,marginBottom:8}}>💡 Agrega el número del proveedor en Configuración para enviar por WhatsApp.</div>}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <a href={waLink("paid")} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",borderRadius:10,background:"#25D366",color:"#fff",fontSize:12.5,fontWeight:600,textDecoration:"none"}}>💬 Confirmar pago</a>
                    {!rep.paid&&<a href={waLink("reminder")} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",borderRadius:10,background:"#F2F0EC",border:"1.5px solid "+C.orange,color:C.orange,fontSize:12.5,fontWeight:600,textDecoration:"none"}}>⏰ Recordatorio de cobro</a>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/* ═══ VENDOR APP */
function VendorApp({vendor,allVendors,allReps,reps,props,company,schedules,hospUrlDay,hospUrlWeek,adelantos,onSvAdelantos,pagos,onSvPagos,onSubmit,onUpdate,onSvV,onSvFeedback,onLogout}) {
  const [view,setView] = useState("jobs");
  var tot=reps.reduce(function(s,r){return s+(isDanos(r.categoria)?0:parseFloat(r.total||0));},0);
  var cob=reps.filter(function(r){return r.paid;}).reduce(function(s,r){return s+parseFloat(r.total||0);},0);
  var pnd=reps.filter(function(r){return r.total&&!r.paid;});
  var cleaningReps = reps.filter(function(r){return isCleaning(r.categoria);});
  var pendingCorrections = cleaningReps.filter(function(r){return r.qaStatus==="correccion";}).length;

  async function vendorRespond(repId, response) {
    var r = reps.find(function(x){return x.id===repId;}); if(!r) return;
    var upd = Object.assign({},r,{qaStatus:response,qaRespuesta:response,qaRespuestaFecha:todayStr()});
    if(onUpdate) await onUpdate(upd);
    /* Avisar a supervisión y admin que el técnico respondió una corrección inmediata */
    if(r.qaTipo==="inmediata"&&response==="corregido"){
      try{ notifyEmail(supervisorEmails(allVendors,vendor.email).concat(adminEmails(allVendors)), "✓ Corrección inmediata atendida — "+r.propiedad, vendorDisplay(vendor)+" confirmó la corrección inmediata en "+r.propiedad+" ("+fmtDate(r.fecha)+").\n\nEPI App — Spacio AM"); }catch(_){}
    }
  }
  return (
    <div style={{background:C.alabaster,minHeight:"100vh",fontFamily:"Montserrat,sans-serif"}}>
      <GS/>
      <ResponsiveHeader
        tab={view} setTab={setView}
        alertCount={0}
        navItems={(function(){
    var isInternal = vendor.tipo==="interno";
    var navItems = [["jobs","Mis trabajos","list"],["new","Nuevo reporte","edit"]];
    if(isInternal) navItems.push(["sched","Programa","calendar"]);
    if(isInternal) navItems.push(["hist","Calidad","star"]);
    if(vendor.isSupervisor) navItems.push(["sup","Supervisión","settings"]);
    if(isInternal) navItems.push(["adv","Adelanto","coins"]);
    navItems.push(["pagos","Mis pagos","receipt"]);
    navItems.push(["account","Cuenta","user"]);
    return navItems;
  })()}
        onLogout={onLogout}
        role={vendorDisplay(vendor)}
        feedbackVendor={vendor}
        onSaveFeedback={function(fb){onSvFeedback&&onSvFeedback(fb);}}
      />
      <div style={{display:view==="jobs"   ?"block":"none"}}><VendorJobsView reps={reps} tot={tot} cob={cob} pnd={pnd} adelantos={adelantos} pendingCorrections={pendingCorrections} onNew={function(){setView("new");}} onGoAccount={function(){setView("account");}} vendor={vendor} allVendors={allVendors}/></div>
      <div style={{display:view==="new"    ?"block":"none"}}><RepForm vendors={allVendors||[]} props={props} company={company} defaultVendor={vendor.email} myReps={reps} onSubmit={async function(r){await onSubmit(r);setView("jobs");}} onSaveFeedback={function(fb){onSvFeedback&&onSvFeedback(fb);}}/></div>
      <div style={{display:view==="sched"  ?"block":"none"}}><VendorSchedule vendor={vendor} schedules={schedules} hospUrlDay={hospUrlDay} hospUrlWeek={hospUrlWeek}/></div>
      <div style={{display:view==="hist"   ?"block":"none"}}><VendorHistory reps={cleaningReps} onRespond={vendorRespond} vendor={vendor} onSaveFeedback={function(fb){onSvFeedback&&onSvFeedback(fb);}}/></div>
      {vendor.isSupervisor&&<div style={{display:view==="sup"?"block":"none"}}><SupervisionPanel me={vendor} reps={allReps||[]} vendors={allVendors||[]} props={props} onUpdate={onUpdate}/></div>}
      <div style={{display:view==="account"?"block":"none"}}><VendorAccount vendor={vendor} allVendors={allVendors} allReps={allReps} onSvV={onSvV}/></div>
      {isInternalVendor(vendor)&&<div style={{display:view==="adv"?"block":"none"}}><AdvanceRequest vendor={vendor} reps={reps} adelantos={adelantos} onSvAdelantos={onSvAdelantos}/></div>}
      <div style={{display:view==="pagos"?"block":"none"}}><PagosHistory pagos={pagos} vendors={allVendors} company={company} isAdmin={false} meEmails={vendorEmailSet(vendor)}/></div>
    </div>
  );
}



/* ─── Vendor Jobs View — with filters */
function VendorJobsView({reps, tot, cob, pnd, adelantos, pendingCorrections, onNew, vendor, allVendors, onGoAccount}) {
  const [fCat,    setFCat]    = useState("Todos");
  const [fStatus, setFStatus] = useState("Todos");
  const [fDesde,  setFDesde]  = useState("");
  const [fHasta,  setFHasta]  = useState("");
  const [showAll, setShowAll] = useState(false);

  function applyPreset(val) {
    var r = presetRange(val); setFDesde(r.from); setFHasta(r.to);
  }

  function reset() { setFCat("Todos"); setFStatus("Todos"); setFDesde(""); setFHasta(""); setShowAll(false); }

  var fReps = reps.filter(function(r) {
    if (fCat!=="Todos"&&r.categoria!==fCat) return false;
    if (fStatus==="✓ Pagado"&&!(r.paid&&r.total)) return false;
    if (fStatus==="● Pendiente"&&(r.paid||!r.total)) return false;
    if (fDesde&&r.fecha<fDesde) return false;
    if (fHasta&&r.fecha>fHasta) return false;
    return true;
  });
  var shown  = showAll ? fReps : fReps.slice(0,15);
  var actF   = [fCat!=="Todos",fStatus!=="Todos",!!fDesde,!!fHasta].filter(Boolean).length;

  var IS  = {border:"1px solid "+C.gray,borderRadius:6,padding:"7px 10px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none",background:"#fff",color:C.black,width:"100%",minHeight:40};
  var ISA = Object.assign({},IS,{border:"1.5px solid "+C.black,fontWeight:600});
  var LBL = {fontSize:9,fontWeight:600,color:C.earth,letterSpacing:".2em",textTransform:"uppercase",display:"block",marginBottom:5};

  return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"0 0 100px"}}>
      {/* Stats */}
      {(function(){
        var miAdv=(adelantos||[]).find(function(a){return a.vendorEmail===vendor.email && a.status==="activo";});
        var stAdv= miAdv ? advanceState(miAdv, reps) : null;
        var advSem = stAdv ? stAdv.weeklyCharge : 0;
        var wk = splitPayableWeeks(reps);
        var neto = Math.max(0, wk.prev.porCobrar - advSem);
        return (
          <StatsSummary
            heroLabel="Neto a recibir"
            heroValue={"Q"+Math.round(neto).toLocaleString()}
            heroGreen={neto>0}
            enCursoCount={wk.cur.reps.length}
            enCursoMonto={wk.cur.monto}
            items={[
              {label:"Mis trabajos", value:wk.prev.pndCount, sub:"pendientes"},
              {label:"Facturado", value:"Q"+Math.round(wk.prev.porCobrar).toLocaleString(), sub:"sin pagar"},
              {label:"Cobrado", value:"Q"+Math.round(wk.prev.cob).toLocaleString(), green:true},
              (advSem>0?{label:"Adelanto / sem", value:"−Q"+advSem.toLocaleString(), peach:true, sub:"saldo Q"+stAdv.saldo.toLocaleString()}:null),
            ]}
          />
        );
      })()}

      {/* Correction alert */}
      {pendingCorrections>0&&(
        <div style={{background:"#F5EDEC",padding:"13px 16px",borderBottom:"1.5px solid #DBC8C4"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:3}}>⚠ {pendingCorrections} limpieza{pendingCorrections!==1?"s":""} requiere{pendingCorrections===1?"":"n"} corrección</div>
          <div style={{fontSize:11.5,color:C.earth}}>Revisa la pestaña ★ Calidad para responder.</div>
        </div>
      )}

      {/* Filters */}
      <div style={{background:"#fff",padding:"14px 16px",borderBottom:"1px solid "+C.line}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <span style={LBL}>Categoría</span>
            <select value={fCat} onChange={function(e){setFCat(e.target.value);setShowAll(false);}} style={fCat!=="Todos"?ISA:IS}>
              {(function(){
                var isEPIL = vendor&&vendor.tipo==="interno"&&vendor.categoria==="EPI Limpieza";
                var isEPIM = vendor&&vendor.tipo==="interno"&&vendor.categoria==="EPI Mantenimiento";
                var cats = isEPIL
                  ? ["Todos","Limpieza tradicional","Limpieza profunda","Ajuste","Reporte de Daños"]
                  : isEPIM
                  ? ["Todos","Mantenimiento","Nuevo Producto","Ajuste","Reporte de Daños"]
                  : ["Todos"].concat(CATS);
                return cats.map(function(c){return <option key={c}>{c}</option>;});
              })()}
            </select>
          </div>
          <div>
            <span style={LBL}>Estado de pago</span>
            <select value={fStatus} onChange={function(e){setFStatus(e.target.value);setShowAll(false);}} style={fStatus!=="Todos"?ISA:IS}>
              <option>Todos</option><option>✓ Pagado</option><option>● Pendiente</option>
            </select>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,alignItems:"flex-end"}}>
          <div>
            <span style={LBL}>Período rápido</span>
            <select onChange={function(e){applyPreset(e.target.value);e.target.value="";}} style={IS} defaultValue="">
              <option value="" disabled>Seleccionar…</option>
              <option value="hoy">Hoy</option>
              <option value="semana">Semana en curso</option>
              <option value="semana_ant">Semana anterior</option>
              <option value="mes">Este mes</option>
              <option value="semanas_ant">Semanas anteriores</option>
              <option value="todo">Todo</option>
            </select>
          </div>
          <div>
            <span style={LBL}>Período</span>
            <DateRangePicker from={fDesde} to={fHasta} baseStyle={IS} activeStyle={ISA} onChange={function(a,b){setFDesde(a);setFHasta(b);setShowAll(false);}}/>
          </div>
        </div>
        {actF>0&&<button onClick={reset} style={{marginTop:10,padding:"6px 14px",borderRadius:6,border:"1px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>✕ Limpiar filtros <span style={{background:C.peach,color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{actF}</span></button>}
      </div>

      {/* List */}
      <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
        {fReps.length===0&&(
          <div style={{textAlign:"center",padding:"48px 20px",color:C.earth,fontSize:13}}>
            Sin resultados.{actF>0&&<><br/><button onClick={reset} style={{marginTop:12,padding:"9px 20px",borderRadius:6,border:"1px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Limpiar filtros</button></>}
            {!actF&&reps.length===0&&<><br/><button onClick={onNew} style={{marginTop:14,padding:"10px 24px",borderRadius:6,border:"none",background:C.black,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Crear primer reporte →</button>
            <div style={{marginTop:22,paddingTop:18,borderTop:"1px solid "+C.line,maxWidth:380,marginLeft:"auto",marginRight:"auto"}}>
              <div style={{fontSize:12.5,color:C.earth,lineHeight:1.6,marginBottom:10}}>¿Cambiaste de correo hace poco? Tus reportes anteriores pueden estar ligados a tu correo viejo.</div>
              {onGoAccount&&<button onClick={onGoAccount} style={{padding:"9px 18px",borderRadius:8,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Recuperar mis registros →</button>}
            </div></>}
          </div>
        )}
        {shown.map(function(r) {
          var b  = BADGE[r.categoria]||BADGE["Mantenimiento"];
          var qa = r.qaStatus;
          var qaColors = {correccion:{bg:"#F5EDEC",tx:C.red,label:"⚠ Corrección"},aprobada:{bg:"#EDF5EF",tx:C.green,label:"✓ Aprobada"},pendiente:{bg:"#F0F0EE",tx:C.taupe,label:"En revisión"}};
          var qac = isCleaning(r.categoria)&&qa ? qaColors[qa]||null : null;
          return (
            <div key={r.id} style={{background:"#fff",borderRadius:10,padding:"15px 16px",border:"1px solid "+(qa==="correccion"?"#DBC8C4":C.line),boxShadow:qa==="correccion"?"0 2px 8px rgba(155,58,58,.06)":"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:C.black,marginBottom:4}}>{r.propiedad}</div>
                  <span style={{padding:"2px 8px",borderRadius:20,fontSize:9.5,fontWeight:700,textTransform:"uppercase",background:b.bg,color:b.tx}}>{r.categoria}</span>
                  {qac&&<span style={{marginLeft:6,padding:"2px 8px",borderRadius:20,fontSize:9.5,fontWeight:700,background:qac.bg,color:qac.tx}}>{qac.label}</span>}
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                  <div style={{fontSize:15,fontWeight:700,color:r.total&&!isDanos(r.categoria)?C.black:C.gray}}>{isDanos(r.categoria)?"—":(r.total?"Q"+r.total:"—")}</div>
                  {r.total&&!isDanos(r.categoria)&&<div style={{fontSize:10,fontWeight:700,marginTop:4,padding:"2px 8px",borderRadius:5,background:r.paid?"#EDF5EF":"#F5EDEC",color:r.paid?C.green:C.red}}>{r.paid?"✓ Pagado":"● Pendiente"}</div>}
                </div>
              </div>
              <div style={{fontSize:12.5,color:C.earth,lineHeight:1.5,marginBottom:5}}>{r.descripcion&&r.descripcion.slice(0,80)}{r.descripcion&&r.descripcion.length>80?"…":""}</div>
              <div style={{fontSize:11,color:C.taupe}}>{fmtDate(r.fecha)}</div>
            </div>
          );
        })}
        {fReps.length>15&&<button onClick={function(){setShowAll(function(p){return !p;});}} style={{padding:"12px",borderRadius:8,border:"1px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>{showAll?"Ver menos":"Ver todos los "+fReps.length+" registros →"}</button>}
      </div>
    </div>
  );
}


/* ─── Cuadro de sugerencias — arriba de la pestaña Calidad */
function SuggestionBox({vendor, onSaveFeedback}) {
  const [text,setText] = useState("");
  const [sent,setSent] = useState(false);
  function send(){
    var t=text.trim(); if(!t) return;
    onSaveFeedback&&onSaveFeedback({
      id:Date.now(), fecha:todayStr(),
      hora:new Date().toLocaleTimeString("es-GT",{hour:"2-digit",minute:"2-digit"}),
      usuario:vendor?vendor.email:"anon", tipo:"mejora", mensaje:t, visto:false,
    });
    setText(""); setSent(true); setTimeout(function(){setSent(false);},3500);
  }
  return (
    <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:10,padding:"14px 16px",marginBottom:18}}>
      <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase",marginBottom:6}}>💡 Tu opinión nos ayuda</div>
      <div style={{fontSize:12,color:C.earth,lineHeight:1.5,marginBottom:10}}>¿Qué mejorarías de la plataforma? Deja tus comentarios y sugerencias — el administrador los revisa todos.</div>
      {sent
        ? <div style={{padding:"10px 14px",borderRadius:8,background:"#EDF5EF",fontSize:12.5,fontWeight:700,color:C.green}}>✓ ¡Gracias! Tu sugerencia fue enviada.</div>
        : <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <textarea rows={2} placeholder="Escribe tu sugerencia de mejora…" value={text} onChange={function(e){setText(e.target.value);}} style={{width:"100%",border:"1px solid "+C.gray,borderRadius:8,padding:"9px 11px",fontSize:13,fontFamily:"Montserrat,sans-serif",outline:"none",resize:"none",boxSizing:"border-box"}}/>
            <button onClick={send} disabled={!text.trim()} style={{alignSelf:"flex-end",padding:"9px 18px",borderRadius:7,border:"none",background:text.trim()?C.black:C.gray,color:"#fff",fontSize:12,fontWeight:700,cursor:text.trim()?"pointer":"default"}}>Enviar →</button>
          </div>}
    </div>
  );
}

/* ─── Vendor History — Historial de calidad de limpiezas */
function VendorHistory({reps, onRespond, vendor, onSaveFeedback}) {
  var cleanReps = (reps||[]).filter(function(r){return isCleaning(r.categoria);})
    .sort(function(a,b){return (b.createdAt||b.id)-(a.createdAt||a.id);});

  var pendCnt = cleanReps.filter(function(r){return r.qaStatus==="correccion";}).length;

  var qaLabel = {
    pendiente:  {label:"En revisión", bg:"#F0F0EE", tx:C.taupe},
    aprobada:   {label:"✓ Aprobada",  bg:"#EDF5EF", tx:C.green},
    correccion: {label:"⚠ Corrección",bg:"#F5EDEC", tx:C.red},
    corregido:  {label:"✓ Corregida", bg:"#EDF5EF", tx:C.green},
    futuro:     {label:"→ A futuro",  bg:"#EDEAE3", tx:C.taupe},
  };

  return (
    <div style={{maxWidth:600,margin:"0 auto",padding:"22px 16px 100px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".24em",textTransform:"uppercase",marginBottom:6}}>Historial de Calidad</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:24,fontWeight:400,color:C.black}}>Revisiones de limpieza</div>
      </div>

      <SuggestionBox vendor={vendor} onSaveFeedback={onSaveFeedback}/>

      {pendCnt>0&&(
        <div style={{background:"#F5EDEC",borderRadius:8,padding:"14px 16px",marginBottom:18,border:"1.5px solid #DBC8C4"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:4}}>⚠ {pendCnt} corrección{pendCnt!==1?"es":""} pendiente{pendCnt!==1?"s":""}</div>
          <div style={{fontSize:12,color:C.earth}}>Responde a los comentarios del administrador abajo.</div>
        </div>
      )}

      {cleanReps.length===0&&(
        <div style={{textAlign:"center",padding:"52px 20px",color:C.taupe,fontSize:13}}>
          No hay limpiezas registradas aún.
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {cleanReps.map(function(r){
          var ql  = qaLabel[r.qaStatus] || qaLabel["pendiente"];
          var isCorr = r.qaStatus==="correccion";
          var isInm  = isCorr && r.qaTipo!=="futuro";
          return (
            <div key={r.id} style={{background:"#fff",borderRadius:10,border:"1.5px solid "+(isCorr?"#DBC8C4":C.line),overflow:"hidden",boxShadow:isCorr?"0 2px 8px rgba(155,58,58,.08)":"none"}}>
              {/* Header row */}
              <div style={{padding:"13px 16px",borderBottom:"1px solid "+C.line,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                <div>
                  <div style={{fontSize:13.5,fontWeight:600,color:C.black}}>{r.propiedad}</div>
                  <div style={{fontSize:11,color:C.taupe,marginTop:2}}>{fmtDate(r.fecha)} · {r.categoria}</div>
                </div>
                <span style={{padding:"4px 10px",borderRadius:100,fontSize:11,fontWeight:700,background:ql.bg,color:ql.tx}}>{isCorr?(isInm?"🔴 Corrección INMEDIATA":"→ Corrección a futuro"):ql.label}</span>
              </div>

              {/* Admin comment */}
              {r.qaComentario&&(
                <div style={{padding:"12px 16px",background:C.surfaceWarm,borderBottom:"1px solid "+C.line}}>
                  <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>Comentario del admin</div>
                  <div style={{fontSize:13,color:C.black,lineHeight:1.6}}>{r.qaComentario}</div>
                </div>
              )}

              {/* Vendor response buttons — only when correction pending */}
              {isCorr&&(
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:8}}>
                  {isInm&&<div style={{fontSize:11.5,fontWeight:700,color:C.red}}>⚠ Urgente: corrige hoy y confirma aquí. El administrador ve si respondiste o no.</div>}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={function(){onRespond(r.id,"corregido");}} style={{flex:1,minWidth:140,padding:"11px 12px",borderRadius:7,border:"none",background:isInm?C.red:C.black,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",letterSpacing:".04em"}}>
                      ✓ Corrección realizada
                    </button>
                    {!isInm&&<button onClick={function(){onRespond(r.id,"futuro");}} style={{flex:1,minWidth:140,padding:"11px 12px",borderRadius:7,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer",letterSpacing:".04em"}}>
                      → Lo tomo en cuenta
                    </button>}
                  </div>
                </div>
              )}

              {/* Response shown */}
              {(r.qaStatus==="corregido"||r.qaStatus==="futuro")&&(
                <div style={{padding:"10px 16px",background:qaLabel[r.qaStatus].bg}}>
                  <span style={{fontSize:11,fontWeight:700,color:qaLabel[r.qaStatus].tx}}>
                    {r.qaStatus==="corregido"?"Tu respuesta: Corrección realizada":"Tu respuesta: Tomado en cuenta para próximas limpiezas"}
                  </span>
                  {r.qaRespuestaFecha&&<span style={{fontSize:10,color:C.taupe,marginLeft:8}}>{fmtDate(r.qaRespuestaFecha)}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VendorAccount({vendor,allVendors,allReps,onSvV}) {
  /* Contact info */
  const [phone,   setPhone]   = useState(vendor.phone||"");
  const [email,   setEmail]   = useState(vendor.email||"");
  const [ctMsg,   setCtMsg]   = useState(null);

  /* Password change */
  const [cur,  setCur]  = useState("");
  const [np,   setNp]   = useState("");
  const [cp,   setCp]   = useState("");
  const [pwMsg,setPwMsg]= useState(null);

  function saveContact() {
    if (!email.trim()) { setCtMsg({ok:false,t:"El correo no puede estar vacío."}); return; }
    /* Check email not used by another vendor */
    var conflict = allVendors.find(function(v){return v.id!==vendor.id&&v.email.toLowerCase()===email.toLowerCase().trim();});
    if (conflict) { setCtMsg({ok:false,t:"Ese correo ya está en uso por otro usuario."}); return; }
    onSvV(allVendors.map(function(v){
      if(v.id!==vendor.id) return v;
      var ne=email.trim();
      /* Conservar el correo anterior para no perder el historial de reportes */
      var prev=(v.prevEmails||[]).slice();
      if(v.email&&String(v.email).toLowerCase()!==ne.toLowerCase()&&prev.indexOf(v.email)<0) prev.push(v.email);
      return Object.assign({},v,{phone:phone.trim(),email:ne,prevEmails:prev});
    }));
    vendor.phone=phone.trim(); vendor.email=email.trim();
    setCtMsg({ok:true,t:"✓ Datos de contacto actualizados."}); setTimeout(function(){setCtMsg(null);},3000);
  }

  function savePass() {
    if(cur!==vendor.password) { setPwMsg({ok:false,t:"Contraseña actual incorrecta."}); return; }
    if(np.length<6) { setPwMsg({ok:false,t:"Mínimo 6 caracteres."}); return; }
    if(np!==cp) { setPwMsg({ok:false,t:"Las contraseñas no coinciden."}); return; }
    onSvV(allVendors.map(function(v){if(v.id===vendor.id){var u=Object.assign({},v);u.password=np;return u;}return v;}));
    vendor.password=np; setCur(""); setNp(""); setCp("");
    setPwMsg({ok:true,t:"✓ Contraseña actualizada."}); setTimeout(function(){setPwMsg(null);},3000);
  }

  return (
    <div style={{maxWidth:480,margin:"0 auto",padding:"28px 18px 100px",fontFamily:"Montserrat,sans-serif",display:"flex",flexDirection:"column",gap:18}}>
      {/* Header */}
      <div>
        <div style={{fontSize:9.5,fontWeight:600,color:C.earth,letterSpacing:".28em",textTransform:"uppercase",marginBottom:8}}>Mi cuenta</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:26,fontWeight:400,color:C.black}}>{vendorDisplay(vendor)}</div>
        {vendor.tipo&&<div style={{fontSize:11.5,color:C.taupe,marginTop:3}}>{vendorTipo(vendor)}</div>}
      </div>

      {/* Contact info — editable by all */}
      <Card title="Datos de contacto">
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <F label="Correo electrónico">
            <input type="email" placeholder="tu@correo.com" value={email} onChange={function(e){setEmail(e.target.value);}}/>
          </F>
          <F label="WhatsApp / Teléfono">
            <input type="tel" placeholder="+502 9999 9999" value={phone} onChange={function(e){setPhone(e.target.value);}}/>
          </F>
          {ctMsg&&<div style={{padding:"10px 13px",borderRadius:8,fontSize:13,fontWeight:600,background:ctMsg.ok?"#EDF5EF":"#F5EDEC",color:ctMsg.ok?C.green:C.red}}>{ctMsg.t}</div>}
          <BigBtn onClick={saveContact} dis={!email.trim()}>Guardar datos de contacto →</BigBtn>
        </div>
      </Card>

      {/* Password change */}
      <Card title="Cambiar contraseña">
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <F label="Contraseña actual"><input type="password" placeholder="••••••••" value={cur} onChange={function(e){setCur(e.target.value);}}/></F>
          <div style={{height:1,background:C.gray}}/>
          <F label="Nueva contraseña"><input type="password" placeholder="Mínimo 6 caracteres" value={np} onChange={function(e){setNp(e.target.value);}}/></F>
          <F label="Confirmar nueva contraseña"><input type="password" placeholder="Repite la contraseña" value={cp} onChange={function(e){setCp(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")savePass();}}/></F>
          {pwMsg&&<div style={{padding:"10px 13px",borderRadius:8,fontSize:13,fontWeight:600,background:pwMsg.ok?"#EDF5EF":"#F5EDEC",color:pwMsg.ok?C.green:C.red}}>{pwMsg.t}</div>}
          <BigBtn onClick={savePass} dis={!cur||!np||!cp}>Actualizar contraseña →</BigBtn>
        </div>
      </Card>

    </div>
  );
}

/* ─── Vincular un correo anterior
   Si un técnico cambió de correo antes de que la app conservara el historial, sus
   reportes viejos quedaron ligados al correo viejo. Aquí puede recuperarlos
   ingresando ese correo: se añade a `prevEmails` y sus registros reaparecen. */
function LinkPrevEmail({vendor,allVendors,allReps,onSvV}) {
  const [open,setOpen] = useState(false);
  const [val,setVal]   = useState("");
  const [msg,setMsg]   = useState(null);
  var already = vendorEmailSet(vendor);
  function link(){
    var e=(val||"").toLowerCase().trim();
    if(!e||e.indexOf("@")<1){ setMsg({ok:false,t:"Escribe un correo válido."}); return; }
    if(already.indexOf(e)>=0){ setMsg({ok:false,t:"Ese correo ya está ligado a tu cuenta."}); return; }
    /* Seguridad: no permitir reclamar el correo activo de OTRO usuario */
    var owner=(allVendors||[]).find(function(v){return v.id!==vendor.id&&(v.email||"").toLowerCase().trim()===e;});
    if(owner){ setMsg({ok:false,t:"Ese correo pertenece a otra cuenta activa. Contacta al administrador."}); return; }
    var hits=(allReps||[]).filter(function(r){return (r.reportadoPor||"").toLowerCase().trim()===e;}).length;
    if(hits===0){ setMsg({ok:false,t:"No encontramos registros con ese correo. Revisa que esté bien escrito."}); return; }
    var prev=(vendor.prevEmails||[]).slice(); if(prev.indexOf(val.trim())<0) prev.push(val.trim());
    onSvV((allVendors||[]).map(function(v){ return v.id===vendor.id ? Object.assign({},v,{prevEmails:prev}) : v; }));
    vendor.prevEmails=prev;
    setMsg({ok:true,t:"✓ Listo — vinculamos "+hits+" registro"+(hits===1?"":"s")+". Ya aparecen en “Mis trabajos”."});
    setVal("");
  }
  return (
    <Card title="¿Te faltan registros anteriores?">
      <div style={{fontSize:12.5,color:C.earth,lineHeight:1.65,marginBottom:open?14:0}}>
        Si antes usabas otro correo, tus reportes pueden estar guardados con él. Vincúlalo para recuperar tu historial.
        {already.length>1&&<div style={{marginTop:8,fontSize:11.5,color:C.taupe}}>Correos vinculados: {already.join(", ")}</div>}
      </div>
      {open
        ? <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <F label="Tu correo anterior"><input type="email" placeholder="correo.anterior@ejemplo.com" value={val} onChange={function(e){setVal(e.target.value);setMsg(null);}} onKeyDown={function(e){if(e.key==="Enter")link();}}/></F>
            {msg&&<div style={{padding:"10px 13px",borderRadius:8,fontSize:12.5,fontWeight:600,background:msg.ok?"#EDF5EF":"#F5EDEC",color:msg.ok?C.green:C.red,lineHeight:1.5}}>{msg.t}</div>}
            <BigBtn onClick={link} dis={!val.trim()}>Vincular y recuperar →</BigBtn>
          </div>
        : <div style={{marginTop:14}}><button onClick={function(){setOpen(true);}} style={{width:"100%",padding:"12px",borderRadius:12,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>Vincular un correo anterior</button></div>
      }
    </Card>
  );
}

/* ═══ SHARED */

/* ═══ LOGO COMPONENTS — official brand images ═══════════════════════════ */
var BRUSHSTROKE = "data:image/svg+xml;base64,CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgMTIwMCA2MDAiIGFyaWEtaGlkZGVuPSJ0cnVlIj4KICA8ZGVmcz4KICAgIAogICAgPGxpbmVhckdyYWRpZW50IGlkPSJicnVzaEZhZGUiIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIwIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjRjVGM0YwIiBzdG9wLW9wYWNpdHk9IjAiPjwvc3RvcD4KICAgICAgPHN0b3Agb2Zmc2V0PSIwLjA2IiBzdG9wLWNvbG9yPSIjRjVGM0YwIiBzdG9wLW9wYWNpdHk9IjAuNiI+PC9zdG9wPgogICAgICA8c3RvcCBvZmZzZXQ9IjAuNSIgc3RvcC1jb2xvcj0iI0Y1RjNGMCIgc3RvcC1vcGFjaXR5PSIxIj48L3N0b3A+CiAgICAgIDxzdG9wIG9mZnNldD0iMC45NCIgc3RvcC1jb2xvcj0iI0Y1RjNGMCIgc3RvcC1vcGFjaXR5PSIwLjYiPjwvc3RvcD4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjRjVGM0YwIiBzdG9wLW9wYWNpdHk9IjAiPjwvc3RvcD4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8ZmlsdGVyIGlkPSJicnVzaFRleHR1cmUiPgogICAgICA8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC45IiBudW1PY3RhdmVzPSIyIiBzZWVkPSIzIj48L2ZlVHVyYnVsZW5jZT4KICAgICAgPGZlRGlzcGxhY2VtZW50TWFwIGluPSJTb3VyY2VHcmFwaGljIiBzY2FsZT0iNiI+PC9mZURpc3BsYWNlbWVudE1hcD4KICAgIDwvZmlsdGVyPgogIDwvZGVmcz4KICAKICA8ZyBmaWx0ZXI9InVybCgjYnJ1c2hUZXh0dXJlKSI+CiAgICA8cGF0aCBkPSJNIDYwIDM4MCBDIDIyMCAxMjAsIDUyMCA4MCwgNzYwIDI0MCBTIDEwODAgNTIwLCAxMTQwIDIyMCIgc3Ryb2tlPSJ1cmwoI2JydXNoRmFkZSkiIHN0cm9rZS13aWR0aD0iNzgiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCI+PC9wYXRoPgogICAgCiAgICA8cGF0aCBkPSJNIDYwIDM4MCBDIDIyMCAxMjAsIDUyMCA4MCwgNzYwIDI0MCBTIDEwODAgNTIwLCAxMTQwIDIyMCIgc3Ryb2tlPSIjRjVGM0YwIiBzdHJva2Utd2lkdGg9IjQyIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIG9wYWNpdHk9IjAuNDUiPjwvcGF0aD4KICA8L2c+Cjwvc3ZnPg==";
var LOGO_WORDMARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAvgAAAGtCAYAAABjiQA6AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAC+KADAAQAAAABAAABrQAAAAA989YJAABAAElEQVR4Aey9CZykVXnvX2tv0z37xjDAMCwKA4oCArINiwsq6EVBk5hINmNMjCb+Y8ziZTQxud7rNYs3GkmiqIkmjGIUBUFgZhgYGJAdRkAYhmGcfe2Z3ruq/t/f6apOTdPdU9X1dndV9e/9TE29/db7nuV7znnOc57znPPGYj5MwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwARMwATGi0B8vAJ2uCZgAiZgAtVDIFE9SXFKTMAETMAExpGAlftxhOugTcAETKCaCCSrKTFOiwmYgAmYwLgQiC9fvrzx9DlzGp7btq1vXGJwoCZgAiZgAlVDwBb8qikKJ8QETMAExoWAlPtkXzo9e9/MmYvzMdiaPy6oHagJmIAJVAeBVHUkw6kwARMwARMYLwIHDx6MNzc3N8Xj8dZ8HFLwc+MVn8M1ARMwAROYXAJW8CeXv2M3ARMwgQkhkEgk5JJZUPAnJE5HYgImYAImMDkE7KIzOdwdqwmYgAlMFIF4Q0NDKpZKHZVLJE4l0vg111xjF52Jou94TMAETGASCFjBnwTojtIETMAEJohAfMWKFTGs9ymma4/GhF/wwZ+g6B2NCZiACZjAZBCwgj8Z1B2nCZiACUwgAfzvE7n+/nQuHrfMn0DujsoETMAEJouAhf1kkXe8JmACJjBBBA6m07m+eDyXy2Qs8yeIuaMxARMwgckkYGE/mfQdtwmYgAmMM4Gnn346Htu7V7E083k1n8TKlSuzfNsPHwg+TMAETKAeCVjBr8dSdZ5MwARM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sPvR0Fy6ppyncV1D97GuV4iK0KI1lyhETAFUxPpyXxXyRc2u2+gRMgw860PKM7XWYLwCUnxRUHEoPry1unO7/vFkAiZgAiZQkgT07O/0rBeFglI6mPeCvl6MqAgZK74L5J3v4g3WNr8PAiH/qTIC4d5SdIU6wyvvQ72/dEzxHiveX1qne6wQDWEhLyCeTMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETMAETEAE4sbQjYB45Lut8T8mYAImYAImYAImUBkEBqv7KkELDTavXUu2EvLdNT9VvxxfunRpCgoJ5qMxiKoHaAAmYAImYAImYAIVQUA6SHqonCfloar1nERtNU8S9snGxsacIFxzzTUTDh482M7/LdUMxXk3ARMwARMwAROoKALxxYsXpxoaGmqZc62trX2K30OHDuVqa2ulheTNLkuPtrQd+azpL5/F0iWvIY/79u3LF/KdKW4r599yr6EdLfuixz6GIWt5Sjafv3v/gQONuVzuCp30pptuSh7tyX2cCZiACZiACZiACZQQgXx9ff3ZeDOfPnDw4Nstra2vNre0bO02t7ZuYf1vUun0OtJ9HXM5evJVkUnn8/kVOGx/1trW9noz+eqWz675Zhs8XmV+PVVTswENeLPyfd9995W9Pi77DAz15imG4kjY47E/fkJDw5/l8vmX0qnU/6XmdmY8Hr9DhXv66aeXZa11qDy8vwmYgAmYgAmYQEUTCII1lUptq0mlVqeSyelonTnJZHJ2tzmRmJNIJGay7rxYPP7H6KWFUMmXkdiN45xNTJo0aUEynb4tmUotIh8nJMlXt3x2zXciMZsKzSfS6fTU2nS6JpZI9NmyUW4WUjEZGST40EQ1efLkWZlM5i4K/ssU+oxsNhuj1qYmGewgcbC2pubsZ5555i3+VwUohO8M8vzezQRMwARMwARMwARKjUAcr3bs4osvXoSg/SsE/ufQPtI33aIVWB+cm/weRiM9uH3btj/fvn27wpalF0vZ8Rn0LJWSCYj028nr38Ty+QbSjA8330vrFvOJ5tuXy2Z/yH4PtrW1vc/vRy+++GIzv6WeX5LY/1RVMfin33RTevzu3fe2ZzL3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";
var LOGO_MONOGRAM = "data:image/png;base64,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0wB0pH7wfwHy3XffzbvvvktOTg59fX2Ew2HWrl3LN998g67rdpuJBDOZWNV1HSEEr7zyCjfeeCMvvfSS4z3UyXjpyaSlE52pMiheunQp8+bN48svv2T79u0cPnyYZ599lu+++47q6mrKysoIBAJD/jcWi9HV1cUPP/zA3Llz7YK80y3AyRumTzYeSxVE2Vz08MMPc99999mkwS+//EJdXR1btmyhpKSEwsJCLrroIrKysmzJrKioICcnx3Y8TjMxowLopB1JPjXu8/koKyujrKzMXktPTw+RSARFUewCvNfrtcFyi30Z3ietD//SSUOczMIkdydomkZubi65ubmnLd423i71cg8Pt/ThxtGpkGakzGL4Ooanb26o62jOY1Q+MJFIpB1AaR7SeVvGWBKSqYM5I/GN+mgvmy5VFkLg9Xod6xSQjaJ+vz+tII526FsfaxfToS5er5empibq6uocqZTJYH3fvn2sXLkyY7bPNimjHXdNV9tvPB5n//79DA4OOmqvDMOguLgYn8+XFtUdLVgf87xwOtTO7XMdqWYp8gT9aEMfj0FOBQBpU90YqTpDu5F8jKGPR3xTvdbpXD1/N54qn5qOXTgfx0htdpMC8L8I4lhOY1IAjseYni9jore6Tcg4ne8gmqY5YYc3YetuWda4L6U5X9U2JQCTbeL5AKIs1E82XlRTnditGC9dQXaq2pQyhy+5PFmjPVekLl1XgOrp2kknz2akutZ03uab1iqS3FU3roxyGriMAJjsYJJ7/c5H4DIG4EhAOn2juSwJOHHzpe7EyyRfJpspMJ0EzVEAxwJzpGe8vzPS48b4H/w7shHIdxECAAAAAElFTkSuQmCC";
var LOGO_BADGE    = "data:image/png;base64,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m6MJVgJKoN0IYP3IjAm7iQybR5m3j35JRXKxUlx0fGR8WZeRguTeAKatsCORx2gnIpDODjGsEHNKOW/z5Q5qCg/KPtpuJBR0UQJKoIMQEMGxKd9CBDOU0fP1Z7ShSwCDzJPUIbKYqbmQdDtTp04tRoDWYxXJTIf/CcZiD68qLX1e7kw8ik9ddR3iMdVMKAElcAwBtww8ZlvGf3XHe8vUXIwaNSpc39BQxcCDjxFh99BKAhiwktAnI6nT7mYqP023ElACGUtABCljPVwZS72lhEt7UnwfafCzxDJq6Rj9XQkoASXQAQhkqoerA6A/cRasJsJ04j31VyWgBJSAElAC7UEgbhFpTaE94Oo5lYASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAplLwCDpxty5c83MzYKmXAkoASWgBNKdgIjNCZepU6cWh0Kh3IaGhr0zZsyIIUwOB8iqixJQAkpACSiBNiNwXKtn5syZllwlFot9zh8I/KmoqGjiM+XlRWw31VpqM/56IiWgBJSAEogTOK4gDR8+XKwgw3Gcrn6//yzbcZ7IcZw7Dhw4cNGSJUty5TcVJn2OlIASUAJKoK0ItOiy40LGZZddNjaQlXVHdnb2ZUEW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J++IMrUYMZ3Msexak1HdRwkoASWgBNKbgDsuKdF1xqZNmzxlZWW7uhUXL0FzXqJtqYgIvIkoz0z+P4Pgh4MD+/evH/jXv8o4eSJIJzSCTvhjejPR1CkBJaAElECKCYiGWLQteQgDjxGdl52dnz+W/kuf95rmGNx3HjsW+xdtTQ9hMW3p169f9YlG3FELKcV3Uy+vBJSAEshwArZYP4iSheBEn33mmc0FQ4c+bYbDr9F/6QzcdtOwnm7AYvIhSm9s3bqVwLzmLSW1kDL8SdDkKwEloATSiEDTAbNjMoCrCJLJyOL0YZJ57r7C2KTbESiMptPvt5RG+dakKAEloASUQJoSEGHyyjBwkr6Zw4f7p156aXGaplWTpQSUgBJQAp2AQFNhEo+ceuU6wU3XLCoBJaAE0pmACJHM2KCLElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASUAJKQAkoASWgBJSAElACSkAJKAEloASUgBJQAkpACSgBJaAElIASaC8CVnudOFnnnTt3rsm1rG3bttnJuqZeRwkoASWgBNqeQMYLEkis7Oxsa9OmTSpIbf986BmVgBJQAkkjINZFRi5xy8iMRCIX1jU03CiZcBzHyMjMaKKVgBJQ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";
var LOGO_STAMP    = "data:image/png;base64,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xFYylFqPk8tdMzk+/k4jDugLehFNsltUvFn9/eeMjY19obbpkgAJ1BLAzPX7MIH00do9kUJkvtcciQlRuDOJ9c8TER9A2QooC9FOPf3FiRAeoU0zy3ptoli8MeQwBpNAzxOoundQ68EyMn+NCgUvgaq+hxf2Cj9qelHiJSM+qPU0ysyaNWvOKk9Pf1vPaP/Q8XpxuY8EeokAPif+MG7mB1WeG91vKt7o6Ojin2dmPlfbykXLYxde5cuYoo79EuvzaZQDv/Do8AD2XoB9vDJ2IRHBbGQv95OASQR04YF/bRTbpKYE4fFHHcMbsjsxOfUz/464t40Qn6rqInKoC49kGAr8BPqB9kCNP4gbANMjgSwQgOAcwv2xXPKC/pp36+UJD/PtiH+XP47vvkOUzv4Se9UOgQlsUjUSHpV9AJ1SfrokQALVBHB/uJ9frjeaGYuL5eV+8wsPttf6hKc68Q5tJVnzOcsVGsv6K5pPe6HSMvdkVM9XNwDo56efBNJMwH2bXCrVjGZev359/3+PHfsZi4tVZw/3Il7i3F4dmNxWx6tWKiv+Go4KV24U4ZE0osRTadIlgV4ngHtmHxis8nE4gfuo6ysaJlbzkWHe6MT60gdBNvcDxIUB4VVBeBV4GwIOVwVygwRIoIrA6pGRi3O2/TFqFV4fkB7hm6+/PuPAgQNlPaxb/sRqPiqDEJFVfTK3y7KOoMr3mApv5LLW04gQ95PAKQJBrQwMU7kVKxzuMIlRYjUflWkMfNoPf8PBhio+xOomCNUr2P5EhdElARIIJ4BWxi/QyvheYkgNSHVGhx/RnT2J13yiZLMyrmcQca9X8dnXo0jQJYHGBFD7kS4OmVWQeAWjsXWnYiT2qj2qQRIPiijr/HjCg4moZzZzPOOSQK8TgOjIUhpjJnMwsuYD1ZZm1k0CjjUeky8f2kYCGSSAD58ty2C2mCUSIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAESIAGDCPQ3Y8vw8PCGJb/+9f8tWbr0p//8+997mjmWcUmABEhAJ2DpG1H9w/m8I3Fx8G9LpdJU1OMYjwRIgAQUgZzyNONOlEpWn+P8EQr0gRKiZo5nXBIgARJoqeajYxvK5yeRyGqEvQlRWqfvo58ESIAEwgi0LT4qYVUDQoKb0BR7VoXTJQESIIEgArGJjyR++cjI8n7b/tQ9keNcODExsT/opAwjARIggVjFR+HEW7E/9FnW07Lt9g+pHXRJgARIoEKgI+Kj6Gr9QW9DhK5T4XRJgARIIBEC0h8kf0OFwg2JnJAnIQESaEgA9+QrhUJhbsOIHYrQ0qv2Zm2RppeTy11jOc5O1THdbBqMTwIkEDMByzpiO8733bonO9rsCkKF/qBH0R90H058CG/FLgiKwzASIIHkCEB8duNsV+LvOCoKi5I6c+LiozIGESpChGSo9J8nS6WHVDhdEiCB7hCACP0TZ74IorAXFYNLOm1F18Sn0xlj+iRAAq0RgAh9gyPn4W8MNaErWkul8VEUn8aMGIMEepKA1xdkWY9MFIsPxA2B4hM3UaZHAhkiMDg4OGf2wMCPkiWIxT1ojj0VV/YoPnGRZDokkGECQyMjecu2i24WHedGzF54rd3sUnzaJcjjSaCHCOTz+UFZzUKynLOsoWKx2PK6XhSfHrpwmFUSiIsAROh6iNAbkh5E6HyI0OFm06b4NEuM8UmABDwC+jzO6XL5zKmpqZPeTnpIgARIoNMEhguFF7y3Y50+GdMnARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIggTYJDOfz+9pMgoeTAAkYTCBnsG2rVq5cOWCwfTSNBEigDQJGig9qPY7kaf6CBT+1kTceSgIkYDAByyTbIDofwJ7BKpsc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";

/* Full wordmark — for login screen (light bg) */
function LogoWordmark({width}) {
  return <img src={LOGO_WORDMARK} alt="Spacio AM" style={{width:width||180,height:"auto",display:"block"}}/>;
}

/* S monogram — for header */
function LogoMark({size}) {
  var h = size || 36;
  return <img src={LOGO_MONOGRAM} alt="Spacio AM" style={{width:h,height:h,objectFit:"contain",display:"block",filter:"brightness(0)"}}/>;
}

/* Badge variant — circular seal */
function LogoBadge({size}) {
  return <img src={LOGO_BADGE} alt="Spacio AM" style={{width:size||40,height:size||40,objectFit:"contain",display:"block"}}/>;
}

/* Slim text row — SPACIO / A—M for header companion to LogoMark */
function LogoText({color}) {
  var c = color || "#FAFAFA";
  return (
    <div style={{display:"flex",flexDirection:"column",lineHeight:1.1}}>
      <span style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:16,fontWeight:400,letterSpacing:".18em",color:c}}>SPACIO</span>
      <div style={{display:"flex",alignItems:"center",gap:3}}>
        <span style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:9,fontWeight:400,letterSpacing:".12em",color:c,opacity:.7}}>A</span>
        <div style={{flex:1,height:.5,background:c,opacity:.5,minWidth:24}}/>
        <span style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:9,fontWeight:400,letterSpacing:".12em",color:c,opacity:.7}}>M</span>
      </div>
    </div>
  );
}


/* ─── Line icons (Lucide-style, stroke 1.5, editorial) — replaces emoji */
var ICONS = {
  dash:"M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  grid:"M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list:"M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  edit:"M4 20h4L18.5 9.5a2 2 0 00-2.8-2.8L5 17.2V20zM14.5 6.5l3 3",
  pencil:"M4 20h4L18.5 9.5a2 2 0 00-2.8-2.8L5 17.2V20zM14.5 6.5l3 3",
  calendar:"M8 2v4M16 2v4M3.5 9h17M5 5h14a1.5 1.5 0 011.5 1.5v12A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-12A1.5 1.5 0 015 5z",
  star:"M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 16.8 6.6 19.6l1.2-6L3.3 9.4l6.1-.8L12 3z",
  settings:"M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.6 7.6 0 000-2l1.7-1.3-1.7-3-2 .8a7.6 7.6 0 00-1.7-1l-.3-2.1h-3.4l-.3 2.1a7.6 7.6 0 00-1.7 1l-2-.8-1.7 3L6 11a7.6 7.6 0 000 2l-1.7 1.3 1.7 3 2-.8a7.6 7.6 0 001.7 1l.3 2.1h3.4l.3-2.1a7.6 7.6 0 001.7-1l2 .8 1.7-3z",
  coins:"M9 8.5a4.5 2.5 0 109 0 4.5 2.5 0 10-9 0zM4.5 15.5a4.5 2.5 0 109 0M4.5 11.5a4.5 2.5 0 109 0M4.5 11.5v8c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5M18 8.5v8",
  home:"M3.5 11L12 4l8.5 7M5.5 9.5V20h13V9.5",
  file:"M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 13h6M9 17h4",
  receipt:"M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21zM8.5 8h7M8.5 12h7M8.5 16h4",
  upload:"M12 16V4M7 9l5-5 5 5M5 20h14",
  download:"M12 4v12M7 11l5 5 5-5M5 20h14",
  trash:"M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13",
  check:"M5 12.5l4.5 4.5L19 7",
  x:"M6 6l12 12M18 6L6 18",
  plus:"M12 5v14M5 12h14",
  alert:"M12 3.2L2.4 19.6a1 1 0 00.87 1.5h17.46a1 1 0 00.87-1.5L12 3.2zM12 9v5M12 17.2v.05",
  refresh:"M20 11a8 8 0 10-2.3 6M20 5v6h-6",
  logout:"M9 21H5a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 015 3h4M16 17l5-5-5-5M21 12H9",
  search:"M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  arrowRight:"M5 12h14M13 6l6 6-6 6",
  chevronDown:"M6 9l6 6 6-6",
  chevronLeft:"M15 6l-6 6 6 6",
  chevronRight:"M9 6l6 6-6 6",
  camera:"M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  user:"M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0",
  clip:"M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8",
};
function Icon({name, size, stroke, width, style}) {
  var d = ICONS[name] || "";
  return (
    <svg width={size||20} height={size||20} viewBox="0 0 24 24" fill="none" stroke={stroke||"currentColor"} strokeWidth={width||1.5} strokeLinecap="round" strokeLinejoin="round" style={Object.assign({display:"block",flexShrink:0},style||{})} aria-hidden="true">
      {d.split("M").filter(Boolean).map(function(seg,i){return <path key={i} d={"M"+seg}/>;})}
    </svg>
  );
}

/* ─── Combined date-range picker — pick start & end in one calendar popover */
function fmtRangeShort(ds){ if(!ds) return ""; var p=ds.split("-"); return p[2]+"/"+p[1]; }
function DateRangePicker({from,to,onChange,activeStyle,baseStyle}){
  const [open,setOpen]=useState(false);
  const [month,setMonth]=useState(function(){ return from?new Date(from+"T12:00:00"):new Date(); });
  const ref=useRef(null);
  useEffect(function(){ function h(e){ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); } document.addEventListener("mousedown",h); return function(){document.removeEventListener("mousedown",h);}; },[]);
  var yr=month.getFullYear(), mo=month.getMonth();
  var fd=(new Date(yr,mo,1).getDay()+6)%7, dim=new Date(yr,mo+1,0).getDate();
  var cells=[]; for(var i=0;i<fd;i++)cells.push(null);
  for(var d=1;d<=dim;d++){ cells.push(yr+"-"+String(mo+1).padStart(2,"0")+"-"+String(d).padStart(2,"0")); }
  function pick(ds){
    if(!from || (from&&to)){ onChange(ds,""); }
    else if(ds<from){ onChange(ds,from); setOpen(false); }
    else { onChange(from,ds); setOpen(false); }
  }
  var label = from&&to ? fmtRangeShort(from)+" – "+fmtRangeShort(to) : from ? fmtRangeShort(from)+" – …" : "Rango de fechas";
  var btnStyle = Object.assign({}, (from||to)?(activeStyle||{}):(baseStyle||{}), {display:"flex",alignItems:"center",gap:8,minWidth:150});
  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={function(){setOpen(function(p){return !p;});}} style={btnStyle}>
        <Icon name="calendar" size={15} stroke={(from||to)?C.black:C.earth}/>
        <span style={{flex:1,textAlign:"left",color:(from||to)?C.black:C.earth}}>{label}</span>
        <Icon name="chevronDown" size={13} stroke={C.earth} style={{transform:open?"rotate(180deg)":"none",transition:"transform .18s"}}/>
      </button>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,zIndex:80,background:"#fff",border:"1px solid "+C.line,borderRadius:16,boxShadow:"0 12px 40px rgba(62,63,63,.14)",padding:14,width:268}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <button onClick={function(){setMonth(new Date(yr,mo-1,1));}} style={{background:C.surfaceWarm,border:"none",borderRadius:8,width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="chevronLeft" size={16} stroke={C.black}/></button>
            <span style={{fontSize:12.5,fontWeight:600,color:C.black,textTransform:"capitalize"}}>{month.toLocaleDateString("es-GT",{month:"long",year:"numeric"})}</span>
            <button onClick={function(){setMonth(new Date(yr,mo+1,1));}} style={{background:C.surfaceWarm,border:"none",borderRadius:8,width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="chevronRight" size={16} stroke={C.black}/></button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
            {["L","M","M","J","V","S","D"].map(function(w,i){return <div key={i} style={{textAlign:"center",fontSize:9.5,fontWeight:700,color:C.earth,padding:"3px 0"}}>{w}</div>;})}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {cells.map(function(ds,idx){
              if(!ds) return <div key={idx}/>;
              var isFrom=ds===from, isTo=ds===to, inRange=from&&to&&ds>=from&&ds<=to;
              var end=isFrom||isTo;
              return <button key={idx} onClick={function(){pick(ds);}} style={{height:32,border:"none",borderRadius:end?9:(inRange?0:9),cursor:"pointer",fontSize:11.5,fontWeight:end?700:400,background:end?C.black:(inRange?C.peach12||"rgba(233,130,106,.14)":"transparent"),color:end?"#fff":C.black,transition:"background .12s"}}>{parseInt(ds.split("-")[2],10)}</button>;
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:10,borderTop:"1px solid "+C.line}}>
            <button onClick={function(){onChange("","");}} style={{background:"none",border:"none",color:C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>Limpiar</button>
            <button onClick={function(){setOpen(false);}} style={{background:C.black,border:"none",color:"#fff",fontSize:11.5,fontWeight:600,borderRadius:100,padding:"6px 16px",cursor:"pointer"}}>Listo</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Botón de comentario en la barra superior (reemplaza la burbuja flotante invasiva) */
function HeaderFeedback({vendor, onSaveFeedback, isMobile}) {
  const [open,setOpen]=useState(false);
  const [sent,setSent]=useState(false);
  const [text,setText]=useState("");
  const [type,setType]=useState("mejora");
  function submit(){
    if(!text.trim())return;
    var fb={id:Date.now(),fecha:todayStr(),hora:new Date().toLocaleTimeString("es-GT",{hour:"2-digit",minute:"2-digit"}),usuario:vendor?vendor.email:"anon",tipo:type,mensaje:text.trim(),visto:false};
    try{onSaveFeedback&&onSaveFeedback(fb);}catch(_){}
    setText("");setSent(true);
    setTimeout(function(){setOpen(false);setSent(false);},1800);
  }
  var wrap = isMobile
    ? {position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)"}
    : {position:"relative"};
  return (
    <div style={wrap}>
      <button onClick={function(){setOpen(function(o){return !o;});setSent(false);}} aria-label="Enviar un comentario" style={{display:"flex",alignItems:"center",gap:7,padding:"7px 13px",borderRadius:100,background:open?C.black:C.surfaceWarm,border:"1px solid "+(open?C.black:C.line),color:open?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",letterSpacing:".02em"}}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
        Comentario
      </button>
      {open&&(
        <>
          <div onClick={function(){setOpen(false);}} style={{position:"fixed",inset:0,zIndex:60}}></div>
          <div style={{position:"fixed",top:isMobile?60:70,left:"50%",transform:"translateX(-50%)",zIndex:61,width:"min(340px,calc(100vw - 32px))",background:"#fff",borderRadius:16,padding:"16px",boxShadow:"0 18px 50px rgba(62,63,63,.20)",border:"1px solid "+C.line,fontFamily:"Montserrat,sans-serif"}}>
            {sent
              ? <div style={{padding:"14px 6px",textAlign:"center",fontSize:13,fontWeight:700,color:C.green}}>✓ ¡Gracias! Tu comentario fue enviado.</div>
              : <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.black}}>Tu opinión nos ayuda</div>
                  <button onClick={function(){setOpen(false);}} style={{background:"none",border:"none",color:C.gray,fontSize:16,cursor:"pointer",lineHeight:1}}>×</button>
                </div>
                <div style={{display:"flex",gap:6,marginBottom:12}}>
                  {[["mejora","💡 Sugerencia"],["error","🐛 Error"]].map(function(it){return <button key={it[0]} onClick={function(){setType(it[0]);}} style={{flex:1,padding:"7px",borderRadius:7,border:"1.5px solid "+(type===it[0]?C.black:C.gray),background:type===it[0]?C.black:"#fff",color:type===it[0]?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>{it[1]}</button>;})}
                </div>
                <textarea rows={3} placeholder={type==="error"?"Describe el error que encontraste…":"¿Qué mejorarías en el app?"} value={text} onChange={function(e){setText(e.target.value);}} style={{width:"100%",border:"1px solid "+C.gray,borderRadius:8,padding:"9px 11px",fontSize:13,fontFamily:"Montserrat,sans-serif",outline:"none",resize:"none",boxSizing:"border-box"}}/>
                <button onClick={submit} disabled={!text.trim()} style={{marginTop:10,width:"100%",padding:"10px",borderRadius:8,border:"none",background:text.trim()?C.black:C.gray,color:"#fff",fontSize:12.5,fontWeight:600,cursor:text.trim()?"pointer":"default",letterSpacing:".04em"}}>Enviar comentario →</button>
              </>
            }
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Responsive Header Component */
function ResponsiveHeader({tab, setTab, alertCount, pendingQA, navItems, onLogout, role, sheetsOk, adminLabel, feedbackVendor, onSaveFeedback}) {
  var sc = useScreen();
  var isMobile = sc.mobile;

  return (
    <>
      {/* Top bar */}
      <header style={{background:"#fff",height:isMobile?54:62,display:"flex",alignItems:"center",justifyContent:"space-between",padding:isMobile?"0 16px":"0 24px",position:"sticky",top:0,zIndex:50,borderBottom:"1px solid "+C.line}}>
        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:isMobile?8:12}}>
          <img src={LOGO_STAMP} alt="Spacio AM" style={{width:isMobile?38:44,height:isMobile?38:44,objectFit:"contain",display:"block",flexShrink:0}}/>
          {IS_CLAUDE_SANDBOX&&<span style={{fontSize:9,fontWeight:700,background:"#F0EDE8",color:"#938B8A",padding:"2px 6px",borderRadius:4,letterSpacing:".08em",display:isMobile?"none":"block"}}>LOCAL</span>}
          
          {!isMobile&&<div style={{width:1,height:20,background:C.line,margin:"0 6px"}}/>}
          {!isMobile&&<span style={{fontSize:11,color:C.taupe,letterSpacing:".06em"}}>{adminLabel||role}</span>}
          {sheetsOk===false&&!isMobile&&<span style={{fontSize:9,fontWeight:700,background:"#F5EDEC",color:C.red,padding:"2px 6px",borderRadius:4,letterSpacing:".06em"}}>SIN SHEETS</span>}
          {sheetsOk===true&&!isMobile&&<span style={{fontSize:9,fontWeight:700,background:"#EDF5EF",color:C.green,padding:"2px 6px",borderRadius:4,letterSpacing:".06em"}}>● SHEETS</span>}
          {alertCount>0&&<button onClick={function(e){e.stopPropagation();setTab&&setTab("dash");}} title={alertCount+" trabajo"+(alertCount!==1?"s":"")+" con pago pendiente"} style={{background:C.red,color:"#fff",fontSize:9,fontWeight:700,borderRadius:100,padding:"2px 6px",border:"none",cursor:"pointer",lineHeight:1.4}}>{"⚠ "+alertCount}</button>}{pendingQA>0&&<button onClick={function(e){e.stopPropagation();setTab&&setTab("qa");}} title={pendingQA+" limpieza"+(pendingQA!==1?"s":"")+" pendiente"+(pendingQA!==1?"s":"")+" de revisión QA"} style={{background:"#4a5a7a",color:"#fff",fontSize:9,fontWeight:700,borderRadius:100,padding:"2px 6px",marginLeft:2,border:"none",cursor:"pointer",lineHeight:1.4}}>{"★ "+pendingQA}</button>}
        </div>

        {/* Comentario — barra superior, no invasivo (antes burbuja flotante) */}
        {onSaveFeedback&&<HeaderFeedback vendor={feedbackVendor} onSaveFeedback={onSaveFeedback} isMobile={isMobile}/>}

        {/* Desktop nav */}
        {!isMobile&&(
          <nav style={{display:"flex",background:C.surfaceWarm,borderRadius:100,padding:3,gap:2,border:"1px solid "+C.line}}>
            {navItems.map(function(it){ var k=it[0],l=it[1],ic=it[2]; return (
              <button key={k} onClick={function(){setTab(k);}} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 15px",borderRadius:100,border:"none",fontSize:11.5,fontWeight:600,letterSpacing:".04em",cursor:"pointer",background:tab===k?C.black:"transparent",color:tab===k?"#fff":C.taupe,transition:"all .2s"}}><Icon name={ic} size={15} stroke={tab===k?"#fff":C.taupe}/>{l}</button>
            ); })}
          </nav>
        )}

        {/* Logout */}
        <button onClick={onLogout} style={{background:"none",border:"none",color:C.earth,fontSize:isMobile?12:11.5,cursor:"pointer",fontWeight:500,letterSpacing:".04em",padding:"8px 0"}}>Salir</button>
      </header>

      {/* Mobile bottom tab bar */}
      {isMobile&&(
        <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:50,background:"#fff",borderTop:"1px solid "+C.line,display:"flex",height:56,paddingBottom:"env(safe-area-inset-bottom)"}}>
          {navItems.map(function(it){ var k=it[0],l=it[1],ic=it[2]; return (
            <button key={k} onClick={function(){setTab(k);}} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,border:"none",background:"transparent",cursor:"pointer",padding:"6px 0",transition:"all .15s"}}>
              <Icon name={ic} size={20} stroke={tab===k?C.black:C.taupe}/>
              <span style={{fontSize:9,fontWeight:tab===k?700:500,letterSpacing:".08em",color:tab===k?C.black:C.taupe,textTransform:"uppercase",transition:"all .15s"}}>{l.split(" ")[0]}</span>
              {tab===k&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:24,height:2,background:C.black,borderRadius:100}}/>}
            </button>
          ); })}
        </div>
      )}
    </>
  );
}




/* ─── Inventory Summary — full list with OK + issues */
function InventorySummary({inventario}) {
  const [expanded, setExpanded] = useState(false);
  var all    = inventario||[];
  function hasMal(x){ return parseInt(x.malEstado||0)>0; }
  var issues = all.filter(function(x){return x.estado!=="ok"||hasMal(x);});
  var ok     = all.filter(function(x){return x.estado==="ok"&&!hasMal(x);});
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase"}}>Inventario ({all.length} ítems)</div>
        <button onClick={function(){setExpanded(function(p){return !p;});}} style={{fontSize:11,color:C.earth,fontWeight:600,background:"none",border:"1px solid "+C.gray,borderRadius:6,padding:"3px 10px",cursor:"pointer"}}>
          {expanded?"Ver menos ▲":"Ver completo ▼"}
        </button>
      </div>
      {/* Issues always visible */}
      {issues.map(function(item,i){return (
        <div key={i} style={{padding:"11px 14px",borderRadius:8,background:"#FEF0EC",border:"1px solid #e9c2a0",display:"flex",flexDirection:"column",gap:4}}>
          <div style={{fontSize:13,fontWeight:600,color:"#b5622a"}}>✗ {item.name}</div>
          {item.countAlways&&item.cantidad!==""&&item.cantidad!==undefined?<div style={{fontSize:12,color:C.earth}}>Contadas: {item.cantidad}</div>:(item.cantidad>0&&<div style={{fontSize:12,color:C.earth}}>Cantidad: {item.cantidad}</div>)}
          {hasMal(item)&&<div style={{fontSize:12,fontWeight:700,color:C.red}}>En mal estado (inutilizables): {item.malEstado}</div>}
          {item.foto&&(item.foto.startsWith("http")||item.foto.startsWith("data:"))&&(
            <a href={item.foto} target="_blank" rel="noopener noreferrer">
              <img src={item.foto} alt={item.name} style={{width:80,height:70,objectFit:"cover",borderRadius:6,marginTop:4,border:"1px solid "+C.line}}/>
            </a>
          )}
        </div>
      );})}
      {issues.length===0&&<div style={{padding:"8px 14px",borderRadius:8,background:"#EDF5EF",fontSize:12,color:C.green,fontWeight:600}}>✓ Todo en buen estado</div>}
      {/* Full list only when expanded */}
      {expanded&&ok.map(function(item,i){return (
        <div key={i} style={{padding:"9px 14px",borderRadius:8,background:C.surfaceWarm,border:"1px solid "+C.line,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:12.5,color:C.black}}>{item.name}</span>
          <span style={{fontSize:11,fontWeight:600,color:C.green}}>{item.countAlways&&item.cantidad!==""&&item.cantidad!==undefined?"✓ "+item.cantidad+" contadas":"✓ OK"}</span>
        </div>
      );})}
    </div>
  );
}

/* ─── Damage Summary — shown in detail view */
function DamageSummary({danios}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{fontSize:10,fontWeight:700,color:C.red,letterSpacing:".18em",textTransform:"uppercase"}}>⚠ Daños reportados ({danios.length})</div>
      {(danios||[]).map(function(d,i){return (
        <div key={i} style={{padding:"12px 14px",borderRadius:8,background:"#F5EDEC",border:"1px solid #DBC8C4",display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:13,fontWeight:700,color:C.red}}>Daño {i+1}: {d.desc||d.tipo||"Sin descripción"}</div>
          {d.origen&&<div style={{fontSize:12,color:C.earth}}>Origen: {d.origen}</div>}
          {d.quienPaga&&<div style={{fontSize:12,color:C.earth}}>Cubre: {d.quienPaga}</div>}
          {d.fotos&&d.fotos.length>0&&(
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
              {d.fotos.map(function(src,pi){return (
                src&&(src.startsWith("http")||src.startsWith("data:"))
                  ? <a key={pi} href={src} target="_blank" rel="noopener noreferrer">
                      <img src={driveThumb(src,300)} alt={"daño "+i+" foto "+pi} style={{width:80,height:70,objectFit:"cover",borderRadius:6,border:"1px solid "+C.line}} onError={function(e){e.target.src=src;}}/>
                    </a>
                  : null
              );})}
            </div>
          )}
        </div>
      );})}
    </div>
  );
}


/* ─── RetryBanner — discrete expandable pending sync */
function RetryBanner({retryQ, setRetryQ, reps, setReps, onSyncing}) {
  const [open, setOpen] = useState(false);
  var q = rq_get();
  return (
    <div style={{background:"#F7F5F2",borderBottom:"1px solid "+C.line,fontFamily:"Montserrat,sans-serif"}}>
      <div style={{padding:"8px 20px",display:"flex",alignItems:"center",gap:10}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#b5622a",flexShrink:0,display:"inline-block"}}/>
        <span style={{fontSize:11.5,color:"#8a5020",fontWeight:600}}>{retryQ.length} trabajo{retryQ.length!==1?"s":""} pendiente{retryQ.length!==1?"s":""} de sincronizar</span>
        <button onClick={function(){setOpen(function(p){return !p;});}} style={{fontSize:10.5,color:C.earth,fontWeight:600,background:"none",border:"1px solid "+C.gray,borderRadius:5,padding:"2px 9px",cursor:"pointer",marginLeft:"auto"}}>{open?"Cerrar ▲":"Ver ▼"}</button>
      </div>
      {open&&(
        <div style={{padding:"0 20px 14px",display:"flex",flexDirection:"column",gap:8}}>
          {q.map(function(item,i){
            var r=item.rep;
            return (
              <div key={i} style={{background:"#fff",borderRadius:8,padding:"12px 14px",border:"1px solid "+C.line,display:"flex",gap:10,alignItems:"center"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.black,marginBottom:2}}>{r.propiedad||"Sin propiedad"}</div>
                  <div style={{fontSize:11,color:C.earth}}>{r.categoria} · {fmtDate(r.fecha)} · {item.attempts} intento{item.attempts!==1?"s":""}</div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={async function(){
                    onSyncing(true,"Reintentando…");
                    await rq_process(function(r2){setReps(function(p){var ix=p.findIndex(function(x){return x.id===r2.id;});if(ix>=0){var n=[...p];n[ix]=r2;return n;}return[r2,...p];});});
                    setRetryQ(rq_pending()); onSyncing(false,"");
                  }} style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:5,border:"none",background:C.black,color:"#fff",cursor:"pointer"}}>↻</button>
                  <button onClick={function(){rq_remove(r.id);setRetryQ(rq_pending());}} style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.red,cursor:"pointer"}}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Executive Summary + PDF export */
function ExecSummary({rep, vendors}) {
  var vn = (function(){var v=vendors&&vendors.find(function(x){return x.email===rep.reportadoPor;});return v?vendorDisplay(v):rep.reportadoPor||"—";})();
  var isCl = isCleaning(rep.categoria);
  var inv = rep.inventario||[];
  var okItems  = inv.filter(function(x){return x.estado==="ok"&&!(parseInt(x.malEstado||0)>0);});
  var badItems = inv.filter(function(x){return x.estado!=="ok"||parseInt(x.malEstado||0)>0;});
  var danios   = rep.danios||[];

  function exportPDF() {
    function isP(v){return v&&typeof v==="string"&&(v.startsWith("http")||v.startsWith("data:"));}
    function imgTag(src){
    if(!isP(src)) return "";
    /* Use thumbnail URL for Drive images to render inline in PDF */
    var dSrc=src;
    var fm=src.match(/[?&/]id=([a-zA-Z0-9_-]{20,})/);
    if(!fm)fm=src.match(/\/d\/([a-zA-Z0-9_-]{20,})\//);
    if(fm)dSrc="https://drive.google.com/thumbnail?id="+fm[1]+"&sz=w300";
    return "<img src='" + dSrc + "' style='max-width:150px;max-height:120px;object-fit:cover;border-radius:5px;border:1px solid #E2E2E0;margin:3px'/>";
  }
    function sec(title,html){return "<h2 style='font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#8C8C8A;margin:24px 0 8px;border-bottom:1px solid #E2E2E0;padding-bottom:5px'>"+title+"</h2>"+html;}
    function row(label,val){return "<div style='display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F4F4F2;font-size:13px'><span style='color:#8C8C8A'>"+label+"</span><span>"+val+"</span></div>";}
    function badge(txt,green){return "<span style='padding:2px 10px;border-radius:100px;font-size:11px;font-weight:600;background:"+(green?"#EDF5EF":"#F5EDEC")+";color:"+(green?"#3d6b52":"#8a3030")+"'>"+txt+"</span>";}
    function photoRow(arr){if(!arr||!arr.length)return "";var imgs=arr.map(imgTag).join("");return imgs?"<div style='display:flex;flex-wrap:wrap;gap:4px;margin-top:6px'>"+imgs+"</div>":"";}
    function cleanSlot(title, val, isArr){var p=isArr?(Array.isArray(val)?val.filter(isP):[]):(isP(val)?[val]:[]);return p.length?"<div style='margin-bottom:10px'><div style='font-size:9px;color:#8C8C8A;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px'>"+title+"</div>"+photoRow(p)+"</div>":"";}

    var L = [
      "<html><head><meta charset='UTF-8'><style>",
      "body{font-family:Georgia,serif;max-width:800px;margin:30px auto;color:#1E1E1E;line-height:1.6}",
      "h1{font-size:24px;font-weight:400;margin:0 0 4px}",
      ".sub{font-size:11px;color:#8C8C8A;letter-spacing:.2em;text-transform:uppercase;margin-bottom:24px}",
      "@media print{body{margin:15px}.no-break{page-break-inside:avoid}}",
      "</style><title>"+rep.propiedad+"</title></head><body>",
      "<h1>"+rep.propiedad+"</h1>",
      "<div class='sub'>"+rep.categoria+" · "+fmtDate(rep.fecha)+"</div>",
      sec("Resumen general",
        row("Técnico", vn)+
        row("Fecha", fmtDate(rep.fecha))+
        row("Total", rep.total?"Q"+rep.total:"Sin tarifa")+
        row("Estado de pago", badge(rep.paid?"✓ Pagado":"● Pendiente", rep.paid))+
        (rep.pagadoPor?row("Pagador", rep.pagadoPor):"")+
        (rep.comentarios?row("Notas", rep.comentarios):"")
      ),
      rep.descripcion?sec("Trabajo realizado","<p style='font-size:13px;margin:0'>"+rep.descripcion+"</p>"):"",
    ];

    /* QA */
    var qaLabels={pendiente:"En revisión",aprobada:"✓ Aprobada",correccion:"⚠ Corrección requerida",corregido:"✓ Corregida",futuro:"→ Tomado en cuenta"};
    if(rep.qaStatus){
      L.push(sec("Control de calidad",
        row("Estado", qaLabels[rep.qaStatus]||rep.qaStatus)+
        (rep.qaComentario?row("Comentario admin", rep.qaComentario):"")+
        (rep.qaRespuesta?row("Respuesta técnico", rep.qaRespuesta):"")
      ));
    }

    /* Inventario */
    if(isCl&&inv.length>0){
      var invHtml="";
      inv.forEach(function(x){
        var ok=x.estado==="ok";
        invHtml+=row(x.name,"<span style='color:"+(ok?"#3d6b52":"#8a3030")+";font-weight:600'>"+(ok?"✓ OK":"✗ Falta")+(x.cantidad>0?" ("+x.cantidad+")":"")+"</span>");
        if(isP(x.foto))invHtml+=photoRow([x.foto]);
      });
      L.push(sec("Inventario ("+inv.length+" ítems)",invHtml));
    }

    /* Daños */
    if(isCl&&rep.hayDanios&&danios.length>0){
      var dmgHtml="";
      danios.forEach(function(d,i){
        dmgHtml+="<div class='no-break' style='background:#FFF5F5;border:1px solid #e8d0d0;border-radius:6px;padding:12px;margin-bottom:10px'>";
        dmgHtml+="<div style='color:#8a3030;font-weight:700;margin-bottom:4px'>Daño "+(i+1)+": "+d.desc+"</div>";
        if(d.origen)dmgHtml+=row("Origen",d.origen);
        if(d.reparacion)dmgHtml+=row("Reparación",d.reparacion);
        if(d.quienPaga)dmgHtml+=row("Cubre",d.quienPaga);
        if(d.comentarios)dmgHtml+=row("Notas",d.comentarios);
        var allFotos=(d.fotos||[]).concat(d.fotos2||[]).filter(isP);
        if(allFotos.length)dmgHtml+=photoRow(allFotos);
        dmgHtml+="</div>";
      });
      L.push(sec("Daños reportados ("+danios.length+")",dmgHtml));
    }
    if(isCl&&!rep.hayDanios) L.push(sec("Daños","<p style='color:#3d6b52;font-weight:600;font-size:13px;margin:0'>✓ Sin daños reportados</p>"));

    /* All cleaning photos */
    if(isCl){
      var photoHtml="";
      photoHtml+=cleanSlot("Foto en uniforme", rep.fotoUniforme, false);
      photoHtml+=cleanSlot("Piso general", rep.fotoPisoGeneral, false);
      if(rep.fotosHabitaciones)rep.fotosHabitaciones.forEach(function(f,i){photoHtml+=cleanSlot("Cuarto "+(i+1),f,false);});
      if(rep.fotosBanos)rep.fotosBanos.forEach(function(b,i){if(b){photoHtml+=cleanSlot("Baño "+(i+1)+" – Ducha",b.ducha,false);photoHtml+=cleanSlot("Baño "+(i+1)+" – Inodoro",b.inodoro,false);}});
      ["fotosMicroondas","fotosCafetera","fotosEcofiltro","fotosLavatrastos","fotosRefrigerador","fotosEstufa","fotosTv","fotosSillon","fotosInsumos","fotosDebajoCama","fotosCloset","fotosRegadera","fotosDucha","fotosMicroondas2","fotosPlatos","fotosDetrasElect"].forEach(function(k){
        var lbl={"fotosMicroondas":"Microondas","fotosCafetera":"Cafetera","fotosEcofiltro":"Ecofiltro","fotosLavatrastos":"Lavatrastos","fotosRefrigerador":"Refrigerador","fotosEstufa":"Estufa","fotosTv":"Televisor","fotosSillon":"Sillón","fotosInsumos":"Insumos de cortesía","fotosDebajoCama":"Debajo de la cama","fotosCloset":"Clóset / Blancos","fotosRegadera":"Regadera","fotosDucha":"Ducha / Mampara","fotosMicroondas2":"Microondas interior","fotosPlatos":"Platos y cubiertos","fotosDetrasElect":"Detrás electrodomésticos"}[k]||k;
        photoHtml+=cleanSlot(lbl,rep[k],false);
      });
      if(rep.fotosVentanas)photoHtml+=cleanSlot("Ventanas",rep.fotosVentanas,true);
      if(rep.fotosGavetas)photoHtml+=cleanSlot("Gavetas",rep.fotosGavetas,true);
      if(rep.fotosDrenajes)rep.fotosDrenajes.forEach(function(f,i){photoHtml+=cleanSlot("Drenaje baño "+(i+1),f,false);});
      if(rep.fotosDetalle)photoHtml+=cleanSlot("Detalle extra",rep.fotosDetalle,true);
      if(photoHtml) L.push(sec("Evidencia fotográfica de limpieza",photoHtml));
    }

    L.push("<div style='margin-top:36px;padding-top:10px;border-top:1px solid #E2E2E0;font-size:10px;color:#aaa;text-align:center'>Spacio AM · Generado "+new Date().toLocaleString("es-GT")+"</div></body></html>");
    var w=window.open("","_blank","width=900,height=750");
    if(!w) return;
    w.document.write(L.join(""));
    w.document.close();
    setTimeout(function(){w.print();},700);
  }

  return (
    <div style={{background:C.surfaceWarm,borderRadius:10,padding:"16px",border:"1px solid "+C.line}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".2em",textTransform:"uppercase"}}>Resumen ejecutivo</div>
        <button onClick={exportPDF} style={{padding:"6px 13px",borderRadius:6,border:"1px solid "+C.gray,background:"#fff",color:C.black,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>📄 PDF</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:isCl&&inv.length>0?12:0}}>
        <Tile label="Técnico" value={vn}/>
        <Tile label="Fecha"   value={fmtDate(rep.fecha)}/>
        <Tile label="Total"   value={isDanos(rep.categoria)?"Sin pago":(rep.total?"Q"+rep.total:"—")} accent={!!rep.total&&!isDanos(rep.categoria)}/>
        <Tile label="Pago"    value={isDanos(rep.categoria)?"No aplica":(rep.paid?"✓ Pagado":"● Pendiente")}/>
      </div>
      {/* Uniform photo check — only for cleanings */}
      {isCl&&(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {rep.fotoUniforme&&(rep.fotoUniforme.startsWith("http")||rep.fotoUniforme.startsWith("data:")) ? (
            <div style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",borderRadius:8,background:rep._gorraOk==="no"?"#FFF9E6":"#EDF5EF",border:"1px solid "+(rep._gorraOk==="no"?"#E6D88A":"#c8dfc8")}}>
              <a href={rep.fotoUniforme} target="_blank" rel="noopener noreferrer">
                <img src={driveThumb(rep.fotoUniforme,200)} alt="uniforme" style={{width:44,height:44,objectFit:"cover",borderRadius:6,border:"1px solid "+C.line,flexShrink:0}} onError={function(e){e.target.src=rep.fotoUniforme;}}/>
              </a>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:rep._gorraOk==="no"?"#7a6000":C.green}}>
                  {rep._gorraOk==="no"?"⚠ Sin gorra en foto":"✓ Foto de uniforme"}
                </div>
                <div style={{fontSize:10.5,color:C.earth,marginTop:2}}>
                  {rep._gorraOk==="no"?"Proveedor reportó no llevar gorra":"Uniforme documentado"}
                </div>
              </div>
            </div>
          ) : (
            <div style={{padding:"8px 12px",borderRadius:8,background:"#F5EDEC",border:"1px solid #DBC8C4",fontSize:12,fontWeight:700,color:C.red}}>
              ⚠ Sin foto de uniforme — proveedor no subió evidencia
            </div>
          )}
        </div>
      )}
      {isCl&&inv.length>0&&(
        <div style={{display:"flex",gap:8}}>
          {[[okItems.length,"OK","#EDF5EF",C.green],[badItems.length,"Faltantes","#F5EDEC",C.red],[danios.length,"Daños","#F5EDEC",C.red]].map(function(it,i){
            var val=it[0],lbl=it[1],bg=val>0||i>0?it[2]:C.surfaceWarm,cl=val>0||i>0?it[3]:C.taupe;
            return <div key={i} style={{flex:1,padding:"9px 8px",borderRadius:8,background:val>0?bg:C.surfaceWarm,textAlign:"center"}}><div style={{fontSize:18,fontWeight:700,color:val>0?cl:C.taupe}}>{val}</div><div style={{fontSize:9,color:val>0?cl:C.taupe,letterSpacing:".1em",textTransform:"uppercase"}}>{lbl}</div></div>;
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Cleaning Photo Gallery — shows all cleaning-specific photos in admin view */
function CleaningPhotoGallery({rep}) {
  const [light, setLight] = useState(null);
  /* Helper to check if a value is a valid photo URL */
  function isPhoto(v) { return v&&typeof v==="string"&&(v.startsWith("http")||v.startsWith("data:")); }
  function validArr(arr) { return Array.isArray(arr)?arr.filter(isPhoto):[]; }
  function validOne(v) { return isPhoto(v)?[v]:[]; }

  /* Build sections array — ALL expected cleaning photo slots */
  var sections   = [];
  var expected   = 0; /* total expected photo slots */
  var uploaded   = 0; /* slots that have a photo */

  function slot(title, val, isArr) {
    expected++;
    var photos = isArr ? validArr(val) : validOne(val);
    if(photos.length>0){ uploaded++; sections.push({title:title,photos:photos}); }
  }
  function slotArr(title, arr) {
    if(!arr||!arr.length) return;
    arr.forEach(function(v,i){
      expected++;
      var p = isArr2(v)?validArr(v):validOne(v);
      if(p.length>0){ uploaded++; sections.push({title:title+" "+(i+1),photos:p}); }
    });
  }
  function isArr2(v){return Array.isArray(v);}

  /* Selfie */
  slot("Foto en uniforme",       rep.fotoUniforme,       false);

  /* Trad — rooms */
  if(rep.fotosHabitaciones&&rep.fotosHabitaciones.length){
    rep.fotosHabitaciones.forEach(function(f,i){expected++;var p=validOne(f);if(p.length){uploaded++;sections.push({title:"Cuarto "+(i+1),photos:p});}});
  } else { expected++; } /* at least 1 room expected */

  slot("Piso general",           rep.fotoPisoGeneral,    false);

  /* Bathrooms */
  if(rep.fotosBanos&&rep.fotosBanos.length){
    rep.fotosBanos.forEach(function(b,i){
      if(!b) return;
      expected+=2;
      var d=validOne(b.ducha),in2=validOne(b.inodoro);
      if(d.length){ uploaded++; sections.push({title:"Baño "+(i+1)+" – Ducha",photos:d}); }
      if(in2.length){ uploaded++; sections.push({title:"Baño "+(i+1)+" – Inodoro",photos:in2}); }
    });
  } else { expected+=2; }

  /* Kitchen */
  slot("Microondas",             rep.fotosMicroondas,    false);
  slot("Cafetera",               rep.fotosCafetera,      false);
  slot("Ecofiltro",              rep.fotosEcofiltro,     false);
  slot("Lavatrastos",            rep.fotosLavatrastos,   false);
  slot("Refrigerador",           rep.fotosRefrigerador,  false);
  slot("Estufa",                 rep.fotosEstufa,        false);

  /* Sala */
  slot("Televisor",              rep.fotosTv,            false);
  slot("Sillón",                 rep.fotosSillon,        false);
  slot("Insumos de cortesía",    rep.fotosInsumos,       false);

  /* Detail */
  slot("Debajo de la cama",      rep.fotosDebajoCama,    false);
  slot("Clóset / Blancos",       rep.fotosCloset,        false);

  /* Prof-only */
  slot("Regadera",               rep.fotosRegadera,      false);
  slot("Ducha / Mampara",        rep.fotosDucha,         false);
  slot("Microondas (interior)",  rep.fotosMicroondas2,   false);
  slot("Platos y cubiertos",     rep.fotosPlatos,        false);
  slot("Detrás electrodomésticos",rep.fotosDetrasElect,  false);

  if(rep.fotosDrenajes&&rep.fotosDrenajes.length)
    rep.fotosDrenajes.forEach(function(f,i){expected++;var p=validOne(f);if(p.length){uploaded++;sections.push({title:"Drenaje baño "+(i+1),photos:p});}});
  if(rep.fotosVentanas&&rep.fotosVentanas.length){expected++;var vw=validArr(rep.fotosVentanas);if(vw.length){uploaded++;sections.push({title:"Ventanas",photos:vw});}}
  if(rep.fotosGavetas&&rep.fotosGavetas.length){expected++;var gv=validArr(rep.fotosGavetas);if(gv.length){uploaded++;sections.push({title:"Gavetas",photos:gv});}}
  if(rep.fotosDetalle&&rep.fotosDetalle.length){expected++;var dt=validArr(rep.fotosDetalle);if(dt.length){uploaded++;sections.push({title:"Detalle extra",photos:dt});}}

  /* Inventory photos */
  if(rep.inventario&&rep.inventario.length){
    rep.inventario.forEach(function(item){
      if(isPhoto(item.foto)) sections.push({title:"Inventario: "+item.name, photos:[item.foto]});
    });
  }

  /* Damage photos */
  if(rep.danios&&rep.danios.length){
    rep.danios.forEach(function(d,i){
      var p=validArr(d.fotos).concat(validArr(d.fotos2));
      if(p.length) sections.push({title:"Daño "+(i+1)+(d.desc?" – "+d.desc.slice(0,30):""), photos:p});
    });
  }

  var pct = expected>0 ? Math.round(uploaded/expected*100) : 100;
  var lowPhotos = pct < 50;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Photo coverage indicator */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:lowPhotos?"#F5EDEC":C.surfaceWarm,border:"1px solid "+(lowPhotos?"#DBC8C4":C.line)}}>
        <div>
          <div style={{fontSize:12.5,fontWeight:600,color:lowPhotos?C.red:C.black}}>
            {lowPhotos?"⚠ Fotos insuficientes":"📷 Evidencia fotográfica"}
          </div>
          <div style={{fontSize:11,color:C.earth,marginTop:2}}>
            {uploaded} de {expected} secciones con foto ({pct}%)
            {lowPhotos&&" — el proveedor no subió suficientes fotos"}
          </div>
        </div>
        <div style={{fontSize:18,fontWeight:700,color:lowPhotos?C.red:C.green}}>{pct}%</div>
      </div>

      {sections.length===0&&(
        <div style={{padding:"14px",background:"#F5EDEC",borderRadius:8,fontSize:13,color:C.red,fontWeight:600,textAlign:"center"}}>
          ⚠ No se subió ninguna foto en este reporte
        </div>
      )}

      {/* Gallery */}
      {/* Build flat list of ALL photos for global navigation */}
      {(function(){
        var allPhotos = [];
        sections.forEach(function(sec){ sec.photos.forEach(function(p){ allPhotos.push(p); }); });
        return (
          <>
            {light&&<PhotoLightbox photos={light.photos} initialIdx={light.idx} onClose={function(){setLight(null);}}/>}
            {(function(){
              var gIdx = 0;
              return sections.map(function(sec,si) {
                var sectionStart = gIdx;
                gIdx += sec.photos.length;
                return (
                  <div key={si} style={{marginBottom:12}}>
                    <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:6}}>{sec.title}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {sec.photos.map(function(src,pi){
                        var globalPhotoIdx = sectionStart + pi;
                        return (
                          <div key={pi} onClick={function(){ setLight({photos:allPhotos,idx:globalPhotoIdx}); }} style={{cursor:"zoom-in",flexShrink:0}}>
                            <img src={driveThumb(src,300)} alt={sec.title}
                              style={{width:100,height:84,objectFit:"cover",borderRadius:7,border:"1px solid "+C.line,cursor:"zoom-in",background:"#f0f0f0"}}
                              onError={function(e){e.target.src=src;}}/>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </>
        );
      })()}
    </div>
  );
}

/* ─── QA Review Section — shown in admin DetailModal for cleaning reports */
function QASection({rep, onQA}) {
  const [mode,    setMode]    = useState(null); /* null | "corregir" */
  const [comment, setComment] = useState("");
  const [corrTipo,setCorrTipo]= useState("inmediata");
  const [busy,    setBusy]    = useState(false);

  var st = rep.qaStatus;

  async function approve() {
    setBusy(true);
    await onQA(rep.id,"aprobada","");
    setBusy(false);
  }
  async function flagCorrection() {
    if (!comment.trim()) return;
    setBusy(true);
    await onQA(rep.id,"correccion",comment.trim(),corrTipo);
    setBusy(false); setMode(null); setComment("");
  }

  var statusColors = {
    pendiente:  {bg:"#F0F0EE",tx:C.taupe,  label:"Pendiente de revisión"},
    aprobada:   {bg:"#EDF5EF",tx:C.green,  label:"✓ Limpieza aprobada"},
    correccion: {bg:"#F5EDEC",tx:C.red,    label:"⚠ Necesita corrección"},
    corregido:  {bg:"#EDF5EF",tx:C.green,  label:"✓ Corrección realizada"},
    futuro:     {bg:"#EDEAE3",tx:C.taupe,  label:"→ Tomado en cuenta"},
  };
  var sc = statusColors[st] || statusColors["pendiente"];

  return (
    <div style={{borderTop:"1px solid "+C.line,paddingTop:16,display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:10,color:C.earth,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase"}}>Control de Calidad</div>

      {/* Status badge */}
      <div style={{padding:"10px 14px",borderRadius:8,background:sc.bg,fontSize:13,fontWeight:700,color:sc.tx}}>{sc.label}{st==="correccion"&&rep.qaTipo?(rep.qaTipo==="inmediata"?" · 🔴 INMEDIATA":" · para el futuro"):""}</div>

      {/* Sin respuesta del técnico */}
      {st==="correccion"&&rep.qaFecha&&(function(){
        var days=Math.floor((Date.now()-new Date(rep.qaFecha+"T12:00:00").getTime())/86400000);
        return <div style={{padding:"8px 12px",borderRadius:8,background:"#F7EFE2",fontSize:12,color:"#9a6b2f",fontWeight:600}}>⏳ El técnico aún no responde{days>0?" — "+days+" día"+(days!==1?"s":"")+" sin respuesta":""}</div>;
      })()}

      {/* Admin comment if flagged */}
      {(st==="correccion"||st==="corregido"||st==="futuro")&&rep.qaComentario&&(
        <div style={{background:C.surfaceWarm,borderRadius:8,padding:"11px 14px",border:"1px solid "+C.line}}>
          <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".16em",textTransform:"uppercase",marginBottom:5}}>Comentario admin</div>
          <div style={{fontSize:13,color:C.black,lineHeight:1.6}}>{rep.qaComentario}</div>
          <div style={{fontSize:10,color:C.taupe,marginTop:4}}>{fmtDate(rep.qaFecha)}</div>
        </div>
      )}

      {/* Vendor response */}
      {(st==="corregido"||st==="futuro")&&(
        <div style={{padding:"8px 12px",borderRadius:8,background:statusColors[st].bg,fontSize:12,color:statusColors[st].tx,fontWeight:600}}>
          Respuesta del proveedor: {st==="corregido"?"Corrección realizada":"Tomado en cuenta para próximas limpiezas"}
          {rep.qaRespuestaFecha&&<span style={{fontWeight:400,marginLeft:6,opacity:.7}}>({fmtDate(rep.qaRespuestaFecha)})</span>}
        </div>
      )}

      {/* Admin action buttons */}
      {(st==="pendiente"||st==="correccion")&&!mode&&(
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={approve} disabled={busy} style={{flex:1,padding:"11px 14px",borderRadius:7,border:"none",background:C.green,color:"#fff",fontSize:12.5,fontWeight:600,cursor:"pointer",letterSpacing:".04em"}}>
            {busy?"…":"✓ Aprobar limpieza"}
          </button>
          <button onClick={function(){setMode("corregir");}} style={{flex:1,padding:"11px 14px",borderRadius:7,border:"1.5px solid "+C.red,background:"#fff",color:C.red,fontSize:12.5,fontWeight:600,cursor:"pointer",letterSpacing:".04em"}}>
            ⚠ Necesita corrección
          </button>
        </div>
      )}

      {/* Comment input for correction */}
      {mode==="corregir"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <div style={{fontSize:9.5,color:C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:6}}>Tipo de corrección</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={function(){setCorrTipo("inmediata");}} style={{flex:1,padding:"9px 8px",borderRadius:7,border:"1.5px solid "+(corrTipo==="inmediata"?"#8a3030":C.gray),background:corrTipo==="inmediata"?"#F5EDEC":"#fff",color:corrTipo==="inmediata"?"#8a3030":C.earth,fontSize:11.5,fontWeight:700,cursor:"pointer"}}>🔴 Inmediata (urgente)</button>
              <button onClick={function(){setCorrTipo("futuro");}} style={{flex:1,padding:"9px 8px",borderRadius:7,border:"1.5px solid "+(corrTipo==="futuro"?C.black:C.gray),background:corrTipo==="futuro"?"#EDEAE3":"#fff",color:corrTipo==="futuro"?C.black:C.earth,fontSize:11.5,fontWeight:700,cursor:"pointer"}}>→ Para el futuro</button>
            </div>
            <div style={{fontSize:10.5,color:C.taupe,marginTop:5,lineHeight:1.5}}>{corrTipo==="inmediata"?"El técnico debe atenderla hoy y confirmar cuando esté corregida.":"Observación para sus próximas limpiezas — debe confirmarla."}</div>
          </div>
          <F label="Comentario para el proveedor">
            <textarea rows={3} placeholder="Describe qué debe corregirse o mejorar…" value={comment} onChange={function(e){setComment(e.target.value);}}/>
          </F>
          <div style={{display:"flex",gap:8}}>
            <button onClick={function(){setMode(null);setComment("");}} style={{flex:1,padding:"10px",borderRadius:7,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
            <button onClick={flagCorrection} disabled={!comment.trim()||busy} style={{flex:2,padding:"10px",borderRadius:7,border:"none",background:busy||!comment.trim()?C.gray:C.red,color:"#fff",fontSize:12.5,fontWeight:600,cursor:"pointer"}}>
              {busy?"Enviando…":"Enviar corrección →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════
   FEEDBACK BUBBLE — non-invasive corner popup during forms
   Shows around step 5-7 of any wizard
   ══════════════════════════════════════════════════════════ */
function FeedbackBubble({vendor, onSaveFeedback, currentStep, totalSteps}) {
  const [open,    setOpen]    = useState(false);
  const [sent,    setSent]    = useState(false);
  const [text,    setText]    = useState("");
  const [type,    setType]    = useState("mejora"); /* mejora | error */
  const [visible, setVisible] = useState(false);

  /* Show bubble around the middle of the form */
  useEffect(function(){
    if (!sent && totalSteps && currentStep >= Math.floor(totalSteps/2)) {
      var t = setTimeout(function(){ setVisible(true); }, 1500);
      return function(){ clearTimeout(t); };
    }
  }, [currentStep, totalSteps, sent]);

  function submit() {
    if (!text.trim()) return;
    var fb = {
      id:        Date.now(),
      fecha:     todayStr(),
      hora:      new Date().toLocaleTimeString("es-GT",{hour:"2-digit",minute:"2-digit"}),
      usuario:   vendor ? vendor.email : "anon",
      tipo:      type,
      mensaje:   text.trim(),
      visto:     false,
    };
    onSaveFeedback(fb);
    setText(""); setSent(true); setOpen(false);
  }

  if (!visible || sent) return null;

  return (
    <div style={{position:"fixed",bottom:80,right:16,zIndex:500,maxWidth:280,fontFamily:"Montserrat,sans-serif"}}>
      {!open&&(
        <button onClick={function(){setOpen(true);}} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 14px",borderRadius:100,background:"#fff",border:"1px solid "+C.line,boxShadow:"0 2px 12px rgba(0,0,0,.12)",color:C.earth,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
          💬 ¿Tienes un comentario?
          <button onClick={function(e){e.stopPropagation();setVisible(false);}} style={{background:"none",border:"none",color:C.gray,fontSize:14,cursor:"pointer",padding:"0 0 0 4px",lineHeight:1}}>×</button>
        </button>
      )}
      {open&&(
        <div style={{background:"#fff",borderRadius:14,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.14)",border:"1px solid "+C.line}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:C.black}}>Tu opinión nos ayuda</div>
            <button onClick={function(){setOpen(false);}} style={{background:"none",border:"none",color:C.gray,fontSize:16,cursor:"pointer",lineHeight:1}}>×</button>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {[["mejora","💡 Sugerencia"],["error","🐛 Error"]].map(function(it){
              return <button key={it[0]} onClick={function(){setType(it[0]);}} style={{flex:1,padding:"6px",borderRadius:6,border:"1.5px solid "+(type===it[0]?C.black:C.gray),background:type===it[0]?C.black:"#fff",color:type===it[0]?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>{it[1]}</button>;
            })}
          </div>
          <textarea rows={3} placeholder={type==="error"?"Describe el error que encontraste…":"¿Qué mejorarías en el app?"} value={text} onChange={function(e){setText(e.target.value);}} style={{width:"100%",border:"1px solid "+C.gray,borderRadius:8,padding:"9px 11px",fontSize:13,fontFamily:"Montserrat,sans-serif",outline:"none",resize:"none",boxSizing:"border-box"}}/>
          <button onClick={submit} disabled={!text.trim()} style={{marginTop:10,width:"100%",padding:"10px",borderRadius:7,border:"none",background:text.trim()?C.black:C.gray,color:"#fff",fontSize:12.5,fontWeight:600,cursor:text.trim()?"pointer":"default",letterSpacing:".04em"}}>Enviar comentario →</button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SCHEDULE SYSTEM
   ══════════════════════════════════════════════════════════ */
function blankSched() {
  return {id:"",fecha:todayStr(),hora:"09:00",propiedad:"",vendorId:"",tipo:"Limpieza",codigoAcceso:"",notas:""};
}

/* Admin: Schedule management */

/* Hospitable URL config widget — shown in ScheduleCfg */

/* ─── CSV Importer — parses Hospitable export format */
function CSVImporter({vendors, props, onImport, onClose}) {
  const [raw,     setRaw]     = useState("");
  const [preview, setPreview] = useState(null);
  const [err,     setErr]     = useState("");
  const [busy,    setBusy]    = useState(false);

  function parseCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return {error:"El archivo está vacío o tiene formato incorrecto."};

    /* Detect separator */
    var sep = lines[0].includes("\t") ? "\t" : ",";

    function splitLine(line) {
      /* Handle quoted fields */
      var result=[]; var cur=""; var inQ=false;
      for(var i=0;i<line.length;i++){
        var c=line[i];
        if(c==='"') {inQ=!inQ; continue;}
        if(c===sep&&!inQ){result.push(cur.trim());cur="";}
        else cur+=c;
      }
      result.push(cur.trim());
      return result;
    }

    var headers = splitLine(lines[0]).map(function(h){return h.toLowerCase().replace(/[^a-z0-9]/g,"");});

    /* Column detection */
    function col(keys) {
      for(var i=0;i<keys.length;i++){
        var idx=headers.indexOf(keys[i]);
        if(idx>=0) return idx;
      }
      return -1;
    }

    var idxDate  = col(["startdate","start","startdatetime","scheduleddate","date"]);
    var idxEnd   = col(["enddate","end","enddatetime"]);
    var idxType  = col(["type","tasktype","cleaningtype"]);
    var idxFName = col(["teammatefirstname","firstname","assigneefirstname","technicianfirst"]);
    var idxLName = col(["teammatelastname","lastname","assigneelastname","technicianlast"]);
    var idxEmail = col(["teammateemail","email","assigneeemail","technicianaemail"]);
    var idxProp  = col(["listing","listingname","property","propertyname","unit","apartment"]);
    var idxTime  = col(["starttime","time","hour"]);
    var idxNote  = col(["notes","note","comment","comments","description"]);

    if (idxDate<0) return {error:"No se encontró columna de fecha. Verifica que el CSV tenga 'Start Date'."};

    var entries = [];
    for(var r=1;r<lines.length;r++){
      var cols = splitLine(lines[r]);
      if(!cols[idxDate]||cols[idxDate].trim()==="") continue;

      var dateRaw = cols[idxDate]||"";
      /* Normalize date to yyyy-MM-dd */
      var fecha = dateRaw.replace(/\//g,"-").replace(/(\d{4})-(\d{1,2})-(\d{1,2}).*/, function(_,y,m,d){
        return y+"-"+m.padStart(2,"0")+"-"+d.padStart(2,"0");
      });
      if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        /* Try MM/DD/YYYY or DD-MM-YYYY */
        var parts = dateRaw.split(/[\/-]/);
        if(parts.length===3){
          if(parts[0].length===4) fecha=parts[0]+"-"+parts[1].padStart(2,"0")+"-"+parts[2].padStart(2,"0");
          else fecha=parts[2]+"-"+parts[0].padStart(2,"0")+"-"+parts[1].padStart(2,"0");
        }
      }

      var fname  = idxFName>=0 ? (cols[idxFName]||"").trim() : "";
      var lname  = idxLName>=0 ? (cols[idxLName]||"").trim() : "";
      var email  = idxEmail>=0 ? (cols[idxEmail]||"").trim() : "";
      var prop   = idxProp>=0  ? (cols[idxProp]||"").trim()  : "";
      var tipo   = idxType>=0  ? (cols[idxType]||"Limpieza").trim() : "Limpieza";
      var hora   = idxTime>=0  ? (cols[idxTime]||"").trim()  : "";
      var notas  = idxNote>=0  ? (cols[idxNote]||"").trim()  : "";

      /* Normalize tipo */
      var tipoMap = {cleaning:"Limpieza",maintenance:"Mantenimiento",inspection:"Revisión","deep cleaning":"Limpieza Profunda","limpieza profunda":"Limpieza Profunda"};
      tipo = tipoMap[tipo.toLowerCase()] || tipo || "Limpieza";

      /* Fuzzy match vendor */
      var query = [fname,lname,email].filter(Boolean).join(" ");
      var match = fuzzyMatchVendor(query, vendors.filter(function(v){return v.active;}));

      /* Fuzzy match property */
      var propMatch = null;
      if(prop) {
        var bestProp=null,bestScore=0;
        (props||[]).forEach(function(p){
          var s=similarity(prop, p.name);
          if(s>bestScore){bestScore=s;bestProp=p;}
        });
        if(bestProp&&bestScore>0.4) propMatch={prop:bestProp,score:bestScore};
      }

      entries.push({
        fecha:      fecha,
        hora:       hora,
        tipo:       tipo,
        rawProp:    prop,
        propMatch:  propMatch,
        rawVendor:  query,
        vendorMatch:match,
        notas:      notas,
        email:      email,
      });
    }

    return {entries:entries};
  }

  function handlePaste(text) {
    setErr(""); setPreview(null);
    var result = parseCSV(text);
    if(result.error) { setErr(result.error); return; }
    if(!result.entries.length) { setErr("No se encontraron filas con datos."); return; }
    setPreview(result.entries);
  }

  function doImport() {
    if(!preview||!preview.length) return;
    setBusy(true);
    var newScheds = preview.map(function(e,i){
      return {
        id:          "csv"+Date.now()+i,
        fecha:       e.fecha,
        hora:        e.hora,
        propiedad:   e.propMatch ? e.propMatch.prop.name : e.rawProp,
        vendorId:    e.vendorMatch.vendor ? e.vendorMatch.vendor.id : "",
        vendorRaw:   e.rawVendor,
        tipo:        e.tipo,
        codigoAcceso:"",
        notas:       e.notas,
      };
    });
    onImport(newScheds);
    setBusy(false);
    onClose();
  }

  var IS = {border:"1px solid "+C.gray,borderRadius:6,padding:"8px 11px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none",width:"100%",boxSizing:"border-box",background:"#fff"};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:14,padding:"20px",maxWidth:640,width:"100%",maxHeight:"90vh",overflow:"auto",fontFamily:"Montserrat,sans-serif",display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:C.black}}>Importar desde Hospitable</div>
            <div style={{fontSize:11.5,color:C.earth,marginTop:3}}>Pega el CSV de la vista "Detalles" de Hospitable</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:C.gray,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        {/* Instructions */}
        <div style={{background:"#EDF5EF",borderRadius:8,padding:"11px 14px",fontSize:12,lineHeight:1.7}}>
          <div style={{fontWeight:700,color:C.green,marginBottom:4}}>Cómo exportar de Hospitable:</div>
          <div style={{color:C.black}}>1. Ve a <b>Metrics → Operations → Details</b></div>
          <div style={{color:C.black}}>2. Selecciona el rango de fechas que quieres importar</div>
          <div style={{color:C.black}}>3. Presiona <b>Export / CSV</b> arriba a la derecha</div>
          <div style={{color:C.black}}>4. Abre el archivo y copia todo el contenido (Ctrl+A, Ctrl+C)</div>
          <div style={{color:C.black}}>5. Pega aquí abajo</div>
        </div>

        {/* Paste area */}
        {!preview&&(
          <div>
            <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:6}}>Pega el contenido del CSV</div>
            <textarea
              rows={8}
              placeholder={"Start Date,End Date,Type,Teammate First Name,Teammate Last Name,Teammate Email\n2026-05-20,2026-05-20,Cleaning,Lilia,Del Cid,dubonmar20@gmail.com\n..."}
              value={raw}
              onChange={function(e){setRaw(e.target.value);}}
              style={{width:"100%",border:"1.5px solid "+C.gray,borderRadius:8,padding:"10px 12px",fontSize:12,fontFamily:"monospace",outline:"none",resize:"vertical",boxSizing:"border-box",minHeight:140}}
            />
            {err&&<div style={{color:C.red,fontSize:12,marginTop:6,fontWeight:600}}>{err}</div>}
            <button onClick={function(){handlePaste(raw);}} disabled={!raw.trim()} style={{marginTop:10,width:"100%",padding:"12px",borderRadius:7,border:"none",background:raw.trim()?C.black:C.gray,color:"#fff",fontSize:13,fontWeight:600,cursor:raw.trim()?"pointer":"default"}}>
              Analizar CSV →
            </button>
          </div>
        )}

        {/* Preview */}
        {preview&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:13.5,fontWeight:700,color:C.black}}>{preview.length} turnos detectados</div>
              <button onClick={function(){setPreview(null);setRaw("");}} style={{fontSize:11.5,color:C.earth,background:"none",border:"1px solid "+C.gray,borderRadius:5,padding:"3px 9px",cursor:"pointer"}}>← Editar</button>
            </div>
            <div style={{display:"flex",gap:8,fontSize:11.5}}>
              <span style={{padding:"3px 10px",borderRadius:100,background:"#EDF5EF",color:C.green,fontWeight:700}}>✓ {preview.filter(function(e){return e.vendorMatch.score>0.7;}).length} técnicos identificados</span>
              <span style={{padding:"3px 10px",borderRadius:100,background:"#FFF9E6",color:"#7a6000",fontWeight:700}}>⚠ {preview.filter(function(e){return e.vendorMatch.score<=0.7&&e.vendorMatch.vendor;}).length} coincidencia baja</span>
              <span style={{padding:"3px 10px",borderRadius:100,background:"#F5EDEC",color:C.red,fontWeight:700}}>✕ {preview.filter(function(e){return !e.vendorMatch.vendor;}).length} sin match</span>
            </div>

            {/* Preview list */}
            <div style={{maxHeight:320,overflow:"auto",display:"flex",flexDirection:"column",gap:6}}>
              {preview.map(function(e,i){
                var vm=e.vendorMatch; var pm=e.propMatch;
                var bg=vm.score>0.7?"#fff":vm.vendor?"#FFF9E6":"#FFF5F5";
                return (
                  <div key={i} style={{background:bg,borderRadius:7,padding:"10px 12px",border:"1px solid "+C.line,fontSize:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,color:C.black,marginBottom:2}}>
                          {pm?pm.prop.name:<span style={{color:C.red}}>{e.rawProp||"Sin propiedad"}</span>}
                        </div>
                        <div style={{color:C.earth}}>{fmtDate(e.fecha)} {e.hora&&"· "+e.hora} · {e.tipo}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        {vm.vendor?(
                          <div style={{color:vm.score>0.7?C.green:"#7a6000",fontWeight:600}}>
                            {vm.score>0.7?"✓":"⚠"} {vendorDisplay(vm.vendor)}
                            <div style={{fontSize:10,color:C.taupe,fontWeight:400}}>{Math.round(vm.score*100)}% match</div>
                          </div>
                        ):(
                          <div style={{color:C.red,fontWeight:600}}>✕ {e.rawVendor||"Sin técnico"}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={doImport} disabled={busy} style={{padding:"13px",borderRadius:7,border:"none",background:busy?C.gray:C.black,color:"#fff",fontSize:13,fontWeight:600,cursor:busy?"default":"pointer",letterSpacing:".04em"}}>
              {busy?"Importando…":"✓ Importar "+preview.length+" turnos →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}



/* ─── Hospitable live sync button */
function HospSyncButton({onImport}) {
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState(null);
  const [err,    setErr]    = useState("");

  async function sync() {
    setBusy(true); setErr(""); setResult(null);
    try {
      var r = await apiCall("syncHospitable", {days:14});
      if (!r.schedules||!r.schedules.length) {
        setErr("Sin tareas encontradas en Hospitable para los próximos 14 días. " + (r.message||""));
        return;
      }
      onImport(r.schedules);
      setResult({count:r.schedules.length, source:r.source, period:r.period});
    } catch(e) {
      setErr("Error: "+(e&&e.message?e.message:"No se pudo conectar con Hospitable"));
    } finally { setBusy(false); }
  }

  return (
    <div style={{background:"#EDF5EF",borderRadius:8,padding:"12px 14px",border:"1px solid #c8dfc8"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div>
          <div style={{fontSize:9.5,fontWeight:700,color:C.green,letterSpacing:".16em",textTransform:"uppercase",marginBottom:3}}>Sincronizar con Hospitable</div>
          <div style={{fontSize:11.5,color:C.earth}}>Importa automáticamente los próximos 14 días de limpiezas y mantenimientos</div>
        </div>
        <button onClick={sync} disabled={busy} style={{flexShrink:0,padding:"9px 16px",borderRadius:7,border:"none",background:busy?C.gray:"#3d6b52",color:"#fff",fontSize:12.5,fontWeight:700,cursor:busy?"default":"pointer",whiteSpace:"nowrap"}}>
          {busy?"Sincronizando…":"↻ Sync"}
        </button>
      </div>
      {result&&(
        <div style={{marginTop:8,fontSize:12,color:C.green,fontWeight:600}}>
          ✓ {result.count} turno{result.count!==1?"s":""} importado{result.count!==1?"s":""} · {result.period}
        </div>
      )}
      {err&&<div style={{marginTop:8,fontSize:12,color:C.red,fontWeight:600}}>{err}</div>}
    </div>
  );
}


/* ─── Fila editable de URL (top-level: si se define adentro del componente,
   React la remonta en cada tecla y el input pierde el foco — por eso "no se podía escribir") */
function HospUrlRow({label, val, editing, setEditing, curVal, setCurVal, onSave, placeholder}) {
  return (
    <div style={{borderBottom:"1px solid "+C.line,paddingBottom:10,marginBottom:10}}>
      <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:5}}>{label}</div>
      {!editing&&(
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{flex:1,fontSize:11.5,color:val?C.black:C.taupe,fontStyle:val?"normal":"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {val||"Sin configurar"}
          </div>
          <button onClick={function(){setCurVal(val||"");setEditing(true);}} style={{flexShrink:0,fontSize:11,padding:"3px 9px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,cursor:"pointer",fontWeight:600}}>
            {val?"✏":"+ Agregar"}
          </button>
        </div>
      )}
      {editing&&(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <input value={curVal} onChange={function(e){setCurVal(e.target.value);}} placeholder={placeholder} style={{border:"1.5px solid "+C.earth,borderRadius:6,padding:"7px 10px",fontSize:12,fontFamily:"Montserrat,sans-serif",outline:"none",width:"100%",boxSizing:"border-box"}}/>
          <div style={{display:"flex",gap:6}}>
            <button onClick={function(){if(onSave)onSave(curVal.trim());setEditing(false);}} style={{flex:1,padding:"7px",borderRadius:5,border:"none",background:C.black,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Guardar</button>
            <button onClick={function(){setEditing(false);}} style={{padding:"7px 12px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,cursor:"pointer"}}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

function HospUrlConfig({hospUrlDay, hospUrlWeek, onSaveDay, onSaveWeek}) {
  const [editD, setEditD] = useState(false);
  const [editW, setEditW] = useState(false);
  const [valD,  setValD]  = useState(hospUrlDay||"");
  const [valW,  setValW]  = useState(hospUrlWeek||"");

  return (
    <div style={{background:C.surfaceWarm,borderRadius:8,padding:"12px 14px",border:"1px solid "+C.line}}>
      <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:10}}>Enlaces de Hospitable</div>
      <HospUrlRow label="Programa de hoy" val={hospUrlDay} editing={editD} setEditing={setEditD} curVal={valD} setCurVal={setValD} onSave={onSaveDay} placeholder="https://share.hospitable.com/metrics/..."/>
      <HospUrlRow label="Programa semanal" val={hospUrlWeek} editing={editW} setEditing={setEditW} curVal={valW} setCurVal={setValW} onSave={onSaveWeek} placeholder="https://share.hospitable.com/metrics/..."/>
      <div style={{fontSize:10.5,color:C.taupe}}>Los proveedores ven estos programas como respaldo cuando no tienen turnos asignados.</div>
    </div>
  );
}


function ScheduleCfg({schedules, vendors, props, hospUrlDay, hospUrlWeek, onSave, onSaveHospUrlDay, onSaveHospUrlWeek}) {
  const [form,       setForm]       = useState(blankSched());
  const [editId,     setEditId]     = useState(null);
  const [showForm,   setShowForm]   = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filter,     setFilter]     = useState("week"); /* today|week|all */

  var today = todayStr();
  var weekEnd = (function(){var d=new Date();d.setDate(d.getDate()+7);return d.toISOString().split("T")[0];})();

  var filtered = (schedules||[]).filter(function(s){
    if(filter==="today") return s.fecha===today;
    if(filter==="week")  return s.fecha>=today&&s.fecha<=weekEnd;
    return true;
  }).sort(function(a,b){return a.fecha>b.fecha?1:a.fecha<b.fecha?-1:a.hora>b.hora?1:-1;});

  var intVendors = vendors.filter(function(v){
    return v.tipo==="interno"&&v.active&&(v.categoria==="EPI Limpieza"||v.categoria==="EPI Mantenimiento"||v.categoria==="Administrativo");
  });

  function sf(k,v){setForm(function(p){return Object.assign({},p,{[k]:v});});}

  function save() {
    if(!form.fecha||!form.propiedad||!form.vendorId) return;
    var id = editId || "s"+Date.now();
    var entry = Object.assign({},form,{id:id,vendorRaw:form.vendorRaw||""});
    var updated = editId
      ? (schedules||[]).map(function(s){return s.id===editId?entry:s;})
      : (schedules||[]).concat([entry]);
    onSave(updated);
    setForm(blankSched()); setEditId(null); setShowForm(false);
  }

  function del(id){ onSave((schedules||[]).filter(function(s){return s.id!==id;})); }

  function edit(s){ setForm(Object.assign({},s)); setEditId(s.id); setShowForm(true); window.scrollTo(0,0); }

  var IS = {border:"1px solid "+C.gray,borderRadius:6,padding:"9px 11px",fontSize:13,fontFamily:"Montserrat,sans-serif",outline:"none",width:"100%",background:"#fff"};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* Hospitable sync */}
      <HospSyncButton onImport={function(newS){onSave((schedules||[]).filter(function(s){return !s.hospId;}).concat(newS));}}/>
      {/* Hospitable URL config */}
      <HospUrlConfig hospUrlDay={hospUrlDay} hospUrlWeek={hospUrlWeek} onSaveDay={onSaveHospUrlDay} onSaveWeek={onSaveHospUrlWeek}/>

      {/* Filter tabs */}
      <div style={{display:"flex",background:C.surfaceWarm,borderRadius:7,padding:3,gap:2,border:"1px solid "+C.line}}>
        {[["today","Hoy"],["week","Esta semana"],["all","Todo"]].map(function(it){var k=it[0],l=it[1];return(
          <button key={k} onClick={function(){setFilter(k);}} style={{flex:1,padding:"7px",borderRadius:5,border:"none",background:filter===k?C.black:"transparent",color:filter===k?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>{l}</button>
        );})}
      </div>

      {/* Add button */}
      <div style={{display:"flex",gap:8}}>
        <button onClick={function(){setForm(blankSched());setEditId(null);setShowForm(!showForm);}} style={{flex:1,padding:"11px",borderRadius:7,border:"1px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer",textAlign:"left"}}>
          {showForm?"✕ Cancelar":"+ Agregar turno"}
        </button>
        <button onClick={function(){setShowImport(true);}} style={{padding:"11px 14px",borderRadius:7,border:"1.5px solid "+C.earth,background:C.surfaceWarm,color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
          ↓ CSV
        </button>
      </div>
      {showImport&&<CSVImporter vendors={vendors} props={props} onImport={function(newS){onSave((schedules||[]).concat(newS));}} onClose={function(){setShowImport(false);}}/>}

      {/* Form */}
      {showForm&&(
        <div style={{background:"#fff",borderRadius:10,padding:"16px",border:"1.5px solid "+C.black,display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase"}}>{editId?"Editar turno":"Nuevo turno"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",display:"block",marginBottom:5}}>Fecha *</label><input type="date" value={form.fecha} onChange={function(e){sf("fecha",e.target.value);}} style={IS}/></div>
            <div><label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",display:"block",marginBottom:5}}>Hora</label><input type="time" value={form.hora} onChange={function(e){sf("hora",e.target.value);}} style={IS}/></div>
          </div>
          <div><label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",display:"block",marginBottom:5}}>Propiedad *</label>
            <select value={form.propiedad} onChange={function(e){sf("propiedad",e.target.value);}} style={IS}>
              <option value="">Seleccionar…</option>
              {(props||[]).map(function(p){return <option key={p.id} value={p.name}>{p.name}</option>;})}
            </select>
          </div>
          <div>
            <label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",display:"block",marginBottom:5}}>Técnico *</label>
            <div style={{position:"relative"}}>
              <input
                placeholder="Nombre, correo o teléfono del técnico…"
                value={form.vendorRaw||""}
                onChange={function(e){
                  sf("vendorRaw",e.target.value);
                  /* Auto fuzzy-match */
                  var match = fuzzyMatchVendor(e.target.value, intVendors);
                  if(match.vendor) sf("vendorId", match.vendor.id);
                  else sf("vendorId","");
                }}
                style={IS}
              />
              {form.vendorRaw&&(function(){
                var m = fuzzyMatchVendor(form.vendorRaw, intVendors);
                if(!m.vendor) return <div style={{fontSize:11,color:C.red,marginTop:4}}>⚠ Sin coincidencia — verifica el nombre</div>;
                return (
                  <div style={{marginTop:5,padding:"7px 11px",borderRadius:6,background:m.score>0.7?"#EDF5EF":"#FFF9E6",border:"1px solid "+(m.score>0.7?"#c8dfc8":"#e6d88a"),fontSize:12}}>
                    <span style={{fontWeight:600,color:m.score>0.7?C.green:"#7a6000"}}>
                      {m.score>0.7?"✓":"⚠"} {vendorDisplay(m.vendor)}
                    </span>
                    <span style={{color:C.taupe,marginLeft:6}}>{m.vendor.categoria} · {Math.round(m.score*100)}% coincidencia</span>
                    {m.score<0.7&&<div style={{fontSize:10.5,color:"#7a6000",marginTop:2}}>Coincidencia baja — confirma que es el técnico correcto</div>}
                  </div>
                );
              })()}
              {/* Also show dropdown as fallback */}
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:10.5,color:C.taupe}}>O selecciona directamente:</span>
                <select value={form.vendorId} onChange={function(e){sf("vendorId",e.target.value);var v=intVendors.find(function(x){return x.id===e.target.value;});if(v)sf("vendorRaw",vendorDisplay(v));}} style={{fontSize:12,padding:"4px 8px",border:"1px solid "+C.gray,borderRadius:5,background:"#fff",fontFamily:"Montserrat,sans-serif",outline:"none"}}>
                  <option value="">—</option>
                  {intVendors.map(function(v){return <option key={v.id} value={v.id}>{vendorDisplay(v)}</option>;})}
                </select>
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",display:"block",marginBottom:5}}>Tipo</label>
              <select value={form.tipo} onChange={function(e){sf("tipo",e.target.value);}} style={IS}>
                <option>Limpieza</option><option>Limpieza Profunda</option><option>Mantenimiento</option><option>Revisión</option>
              </select>
            </div>
            <div><label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",display:"block",marginBottom:5}}>Código de acceso</label>
              <input placeholder="Ej. 1234#" value={form.codigoAcceso} onChange={function(e){sf("codigoAcceso",e.target.value);}} style={IS}/>
            </div>
          </div>
          <div><label style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",display:"block",marginBottom:5}}>Notas</label>
            <input placeholder="Instrucciones especiales…" value={form.notas} onChange={function(e){sf("notas",e.target.value);}} style={IS}/>
          </div>
          <button onClick={save} disabled={!form.fecha||!form.propiedad||!form.vendorId} style={{padding:"12px",borderRadius:7,border:"none",background:form.fecha&&form.propiedad&&form.vendorId?C.black:C.gray,color:"#fff",fontSize:12.5,fontWeight:600,cursor:"pointer"}}>
            {editId?"Guardar cambios →":"Agregar turno →"}
          </button>
        </div>
      )}

      {/* Schedule list */}
      {filtered.length===0&&<div style={{textAlign:"center",padding:"32px",color:C.taupe,fontSize:13}}>Sin turnos {filter==="today"?"hoy":filter==="week"?"esta semana":"programados"}.</div>}
      {filtered.map(function(s){
        var v=vendors.find(function(x){return x.id===s.vendorId;});
        var isToday=s.fecha===today;
        return (
          <div key={s.id} style={{background:"#fff",borderRadius:9,padding:"13px 15px",border:"1px solid "+(isToday?"#B2A193":C.line),display:"flex",flexDirection:"column",gap:5}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
              <div>
                <div style={{fontSize:13.5,fontWeight:600,color:C.black}}>{s.propiedad}</div>
                <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>{fmtDate(s.fecha)} {s.hora&&"· "+s.hora} · {s.tipo}</div>
                {v?<div style={{fontSize:11,color:C.taupe,marginTop:1}}>{vendorDisplay(v)}</div>:s.vendorRaw?<div style={{fontSize:11,color:C.taupe,marginTop:1}}>{s.vendorRaw}</div>:null}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={function(){edit(s);}} style={{fontSize:11,padding:"4px 9px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,cursor:"pointer"}}>✏</button>
                <button onClick={function(){del(s.id);}} style={{fontSize:11,padding:"4px 9px",borderRadius:5,border:"1px solid #DBC8C4",background:"#fff",color:C.red,cursor:"pointer"}}>✕</button>
              </div>
            </div>
            {s.codigoAcceso&&<div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
              <span style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase"}}>Código:</span>
              <span style={{fontSize:13,fontWeight:700,color:C.black,background:C.surfaceWarm,padding:"2px 10px",borderRadius:5,letterSpacing:".1em"}}>{s.codigoAcceso}</span>
            </div>}
            {s.notas&&<div style={{fontSize:12,color:C.taupe,fontStyle:"italic"}}>{s.notas}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* Admin: Feedback viewer */
function FeedbackCfg({feedback, onSave}) {
  var items = (feedback||[]).slice().sort(function(a,b){return b.id-a.id;});
  function markRead(id){ onSave((feedback||[]).map(function(f){return f.id===id?Object.assign({},f,{visto:true}):f;})); }
  var unread = items.filter(function(f){return !f.visto;}).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {unread>0&&<div style={{padding:"9px 13px",borderRadius:7,background:"#EDF5EF",fontSize:12.5,fontWeight:600,color:C.green}}>✓ {unread} comentario{unread!==1?"s":""} nuevo{unread!==1?"s":""} sin leer</div>}
      {items.length===0&&<div style={{textAlign:"center",padding:"32px",color:C.taupe,fontSize:13}}>Sin comentarios aún.</div>}
      {items.map(function(f){return (
        <div key={f.id} style={{background:"#fff",borderRadius:9,padding:"13px 15px",border:"1px solid "+(f.visto?C.line:"#B2A193"),opacity:f.visto?.7:1}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{padding:"2px 10px",borderRadius:100,fontSize:10,fontWeight:700,background:f.tipo==="error"?"#F5EDEC":"#EDF5EF",color:f.tipo==="error"?C.red:C.green}}>{f.tipo==="error"?"🐛 Error":"💡 Sugerencia"}</span>
            <span style={{fontSize:10.5,color:C.taupe}}>{f.fecha} {f.hora} · {f.usuario}</span>
          </div>
          <div style={{fontSize:13.5,color:C.black,lineHeight:1.6,marginBottom:8}}>{f.mensaje}</div>
          {!f.visto&&<button onClick={function(){markRead(f.id);}} style={{fontSize:11,padding:"4px 12px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,cursor:"pointer",fontWeight:600}}>Marcar como leído</button>}
        </div>
      );})}
    </div>
  );
}

/* Vendor: Schedule for today + week — custom table first, Hospitable as fallback */
function VendorSchedule({vendor, schedules, hospUrlDay, hospUrlWeek}) {
  const [view, setView] = useState("today");
  var today    = todayStr();
  var weekEnd  = (function(){var d=new Date();d.setDate(d.getDate()+7);return d.toISOString().split("T")[0];})();
  /* Match by vendorId, OR by fuzzy name/email/phone on vendorRaw */
  var myScheds = (schedules||[]).filter(function(s){
    if(!s) return false;
    /* Exact vendorId match */
    if(s.vendorId&&s.vendorId===vendor.id) return true;
    /* Fuzzy match on vendorRaw text (name from Hospitable) */
    if(s.vendorRaw&&s.vendorRaw.trim()) {
      var m = fuzzyMatchVendor(s.vendorRaw, [vendor]);
      if(m.score > 0.4) return true;
    }
    /* Also match if vendor email appears in vendorRaw */
    var vEmail = (vendor.email||"").toLowerCase();
    var raw = (s.vendorRaw||"").toLowerCase();
    if(vEmail&&raw&&raw.includes(vEmail.split("@")[0])) return true;
    return false;
  }).sort(function(a,b){return a.fecha>b.fecha?1:a.fecha<b.fecha?-1:a.hora>b.hora?1:-1;});
  var todayList = myScheds.filter(function(s){return s.fecha===today;});
  var weekList  = myScheds.filter(function(s){return s.fecha>=today&&s.fecha<=weekEnd;});
  var shown     = view==="today" ? todayList : weekList;

  return (
    <div style={{maxWidth:600,margin:"0 auto",padding:"0 0 100px",fontFamily:"Montserrat,sans-serif"}}>
      {/* Today highlight */}
      {todayList.length>0&&(
        <div style={{background:"#3E3F3F",padding:"14px 18px",marginBottom:0}}>
          <div style={{fontSize:9.5,color:"rgba(255,255,255,.6)",letterSpacing:".2em",textTransform:"uppercase",marginBottom:4}}>Hoy · {todayList.length} turno{todayList.length!==1?"s":""}</div>
          {todayList.map(function(s,i){return(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:i>0?8:0}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{s.propiedad}</div>
                <div style={{fontSize:11.5,color:"rgba(255,255,255,.6)"}}>{s.hora&&s.hora+" · "}{s.tipo}</div>
              </div>
              {s.codigoAcceso&&(
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,color:"rgba(255,255,255,.5)",letterSpacing:".1em",textTransform:"uppercase"}}>Código</div>
                  <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:".15em"}}>{s.codigoAcceso}</div>
                </div>
              )}
            </div>
          );})}
        </div>
      )}
      {todayList.length===0&&(
        <div style={{background:"#F7F5F2",padding:"13px 18px",borderBottom:"1px solid "+C.line}}>
          <div style={{fontSize:12.5,color:C.taupe}}>Sin turnos asignados hoy en el sistema.</div>
          {(hospUrlDay||hospUrlWeek)&&<div style={{fontSize:11,color:C.earth,marginTop:3}}>Revisa el programa completo abajo →</div>}
        </div>
      )}

      {/* Toggle */}
      <div style={{padding:"14px 16px",background:"#fff",borderBottom:"1px solid "+C.line}}>
        <div style={{display:"flex",background:C.surfaceWarm,borderRadius:7,padding:3,gap:2,border:"1px solid "+C.line}}>
          {[["today","Hoy"],["week","Esta semana"]].map(function(it){var k=it[0],l=it[1];return(
            <button key={k} onClick={function(){setView(k);}} style={{flex:1,padding:"8px",borderRadius:5,border:"none",background:view===k?C.black:"transparent",color:view===k?"#fff":C.earth,fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>
          );})}
        </div>
      </div>

      {/* List */}
      <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
        {shown.length===0&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{textAlign:"center",padding:"16px",color:C.taupe,fontSize:13}}>
              {(schedules||[]).length===0
                ? "Sin turnos cargados en el sistema aún."
                : "Sin turnos asignados "+(view==="today"?"para hoy":"esta semana")+"."}
            </div>
            {(function(){
              /* Show iframe only when the system has no schedules loaded yet */
              var hasSystemScheds = (schedules||[]).length > 0;
              var url = view==="today" ? hospUrlDay : hospUrlWeek;
              var lbl = view==="today" ? "Programa de hoy (Hospitable)" : "Programa semanal (Hospitable)";
              if (hasSystemScheds && shown.length===0) return (
                <div style={{padding:"12px 14px",borderRadius:8,background:C.surfaceWarm,fontSize:12.5,color:C.taupe,textAlign:"center",border:"1px dashed "+C.gray}}>
                  No tienes turnos asignados {view==="today"?"hoy":"esta semana"}. Si crees que es un error, contacta al administrador.
                </div>
              );
              if (!url) return (
                <div style={{padding:"14px",borderRadius:8,background:C.surfaceWarm,fontSize:12,color:C.taupe,textAlign:"center",border:"1px dashed "+C.gray}}>
                  El administrador puede configurar los enlaces de Hospitable en Configuración → Programación
                </div>
              );
              return (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase"}}>{lbl}</div>
                  <div style={{borderRadius:10,overflow:"hidden",border:"1px solid "+C.line,background:"#fff",boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                    <iframe
                      src={url}
                      title={lbl}
                      style={{width:"100%",height:560,border:"none",display:"block"}}
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    />
                  </div>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:C.earth,textAlign:"center",textDecoration:"none",fontWeight:600,padding:"10px",borderRadius:7,border:"1px solid "+C.gray,background:"#fff",display:"block",textAlign:"center"}}>
                    ↗ Abrir en pantalla completa
                  </a>
                </div>
              );
            })()}
          </div>
        )}
        {shown.map(function(s,i){
          var isToday=s.fecha===today;
          return (
            <div key={i} style={{background:"#fff",borderRadius:10,padding:"14px 16px",border:"1.5px solid "+(isToday?C.black:C.line)}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
                <div>
                  {!isToday&&<div style={{fontSize:10.5,fontWeight:700,color:C.earth,letterSpacing:".08em",textTransform:"uppercase",marginBottom:3}}>{fmtDate(s.fecha)}</div>}
                  <div style={{fontSize:14.5,fontWeight:600,color:C.black}}>{s.propiedad}</div>
                  <div style={{fontSize:12,color:C.earth,marginTop:2}}>{s.hora&&s.hora+" · "}{s.tipo}</div>
                  {s.notas&&<div style={{fontSize:11.5,color:C.taupe,marginTop:3,fontStyle:"italic"}}>{s.notas}</div>}
                </div>
                {s.codigoAcceso&&(
                  <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                    <div style={{fontSize:9,color:C.taupe,letterSpacing:".12em",textTransform:"uppercase",marginBottom:2}}>Código acceso</div>
                    <div style={{fontSize:20,fontWeight:700,color:C.black,letterSpacing:".15em",background:C.surfaceWarm,padding:"4px 12px",borderRadius:6}}>{s.codigoAcceso}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ─── Quick inline total editor in dashboard list */
function QuickEditTotal({rep, vendors, onSave}) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState(rep.total||"");
  var at = autoTarifa(rep.reportadoPor||"", vendors);

  if (isDanos(rep.categoria)) return <span style={{fontSize:12,color:C.gray,fontWeight:600}} title="Los reportes de daños no generan pago">—</span>;

  function save() {
    if(onSave) onSave(val);
    setEditing(false);
  }

  if (editing) return (
    <div style={{display:"flex",gap:4,alignItems:"center"}}>
      <input
        type="number"
        value={val}
        onChange={function(e){setVal(e.target.value);}}
        onKeyDown={function(e){if(e.key==="Enter")save();if(e.key==="Escape")setEditing(false);}}
        autoFocus
        style={{width:72,border:"1.5px solid "+C.black,borderRadius:6,padding:"4px 8px",fontSize:13,fontFamily:"Montserrat,sans-serif",outline:"none",fontWeight:600}}
      />
      <button onClick={save} style={{padding:"4px 8px",borderRadius:5,border:"none",background:C.black,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>✓</button>
      <button onClick={function(){setEditing(false);setVal(rep.total||"");}} style={{padding:"4px 6px",borderRadius:5,border:"none",background:"#eee",color:C.gray,fontSize:11,cursor:"pointer"}}>✕</button>
    </div>
  );

  return (
    <div onClick={function(){setVal(rep.total||at.tarifa||"");setEditing(true);}} style={{cursor:"pointer",display:"flex",alignItems:"center",gap:4,borderRadius:6,padding:"2px 4px",transition:"background .15s"}}
      onMouseEnter={function(e){e.currentTarget.style.background=C.surfaceWarm;}}
      onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}
      title="Toca para editar total">
      <span style={{fontSize:14,fontWeight:700,color:rep.total?C.black:C.gray}}>
        {rep.total?"Q"+rep.total:at.tarifa?"Q"+at.tarifa:"—"}
      </span>
      <span style={{fontSize:9,color:C.gray}}>✏</span>
    </div>
  );
}



/* ─── Admin QA Panel — full quality review across all cleanings + daños + resumen */
function AdminQAPanel({reps, vendors, onQA, onSelect, onUpdate, isAdmin, me}) {
  const [sec,      setSec]      = useState("limpiezas"); /* limpiezas | danios | resumen */
  const [filter,   setFilter]   = useState("all"); /* all | pendiente | aprobada | correccion */
  const [selVend,  setSelVend]  = useState("Todos");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkN,    setBulkN]    = useState(0);
  const [preset,   setPreset]   = useState("todo");
  const [dFrom,    setDFrom]    = useState("");
  const [dTo,      setDTo]      = useState("");
  function applyPreset(val){ setPreset(val); var r=presetRange(val); setDFrom(r.from); setDTo(r.to); }

  var cleanReps = (reps||[]).filter(function(r){return isCleaning(r.categoria);});
  var vMap = {};
  (vendors||[]).forEach(function(v){if(v.email)vMap[v.email]=vendorDisplay(v);});
  /* Opciones por Técnico (un perfil agrupa todos sus correos, actuales y anteriores). */
  var techOptsQA = [{value:"Todos",label:"Todos los técnicos"}].concat(techFilterGroups(reps, vendors, isCleaning ? function(r){return isCleaning(r.categoria);} : null));
  var selGroupQA = (selVend!=="Todos") ? techOptsQA.find(function(o){return o.value===selVend;}) : null;

  function inScope(r){
    if(selVend!=="Todos"){
      if(selGroupQA){ if(!repInGroup(r,selGroupQA)) return false; }
      else return false;
    }
    if(dFrom&&(r.fecha||"")<dFrom) return false;
    if(dTo&&(r.fecha||"")>dTo) return false;
    return true;
  }
  var scoped = cleanReps.filter(inScope);
  var filtered = scoped.filter(function(r){
    if(filter!=="all"&&(r.qaStatus||"pendiente")!==filter) return false;
    return true;
  }).sort(function(a,b){return (b.createdAt||b.id)-(a.createdAt||a.id);});

  var pendScope = scoped.filter(function(r){return !r.qaStatus||r.qaStatus==="pendiente";});
  var counts = {
    pendiente:  pendScope.length,
    aprobada:   scoped.filter(function(r){return r.qaStatus==="aprobada";}).length,
    correccion: scoped.filter(function(r){return r.qaStatus==="correccion"||r.qaStatus==="corregido";}).length,
  };

  var IS = {border:"1px solid "+C.gray,borderRadius:6,padding:"7px 10px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none",background:"#fff",width:"100%"};

  var daniosAll = (reps||[]).filter(function(r){return isDanos(r.categoria);});
  var urgAlta   = daniosAll.filter(function(r){return r.urgencia==="alta"&&r.dmgStatus!=="resuelto";}).length;

  async function approveAll(){
    var pend = pendScope;
    if(!pend.length) return;
    if(!window.confirm("¿Aprobar las "+pend.length+" limpiezas pendientes que coinciden con el filtro actual?\n\nCada técnico recibirá su notificación de aprobación.")) return;
    setBulkBusy(true);
    for(var i=0;i<pend.length;i++){
      try{ onQA&&onQA(pend[i].id,"aprobada",""); }catch(_){}
      setBulkN(i+1);
      await new Promise(function(rs){setTimeout(rs,700);}); /* secuencial: no saturar Sheets */
    }
    setBulkBusy(false); setBulkN(0);
  }

  return (
    <div style={{maxWidth:700,margin:"0 auto",padding:"16px 16px 100px",fontFamily:"Montserrat,sans-serif",display:"flex",flexDirection:"column",gap:14}}>
      {/* Secciones */}
      <div style={{display:"flex",gap:8}}>
        {[["limpiezas","★ Limpiezas"],["danios","⚠ Daños"+(urgAlta>0?" · "+urgAlta:"")]].concat(isAdmin?[["mant","🔧 Mantenimiento"],["resumen","Resumen técnicos"]]:[]).map(function(it){
          var s=sec===it[0];
          return <button key={it[0]} onClick={function(){setSec(it[0]);}} style={{flex:1,padding:"11px 8px",borderRadius:9,border:"1.5px solid "+(s?C.black:C.line),background:s?C.black:"#fff",color:s?"#fff":(it[0]==="danios"&&urgAlta>0?C.red:C.earth),fontSize:12.5,fontWeight:700,cursor:"pointer"}}>{it[1]}</button>;
        })}
      </div>

      {sec==="danios"&&<DamageBoard reps={reps} vendors={vendors} me={me} isAdmin={isAdmin} onUpdate={onUpdate} onSelect={onSelect}/>}
      {sec==="mant"&&isAdmin&&<MaintBoard reps={reps} vendors={vendors} me={me} onUpdate={onUpdate} onSelect={onSelect}/>}
      {sec==="resumen"&&isAdmin&&<TechSummary reps={reps} vendors={vendors}/>}

      {sec==="limpiezas"&&<>
      {/* Filtro de período rápido (igual al dashboard) */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",background:"#fff",border:"1px solid "+C.line,borderRadius:10,padding:"10px 12px"}}>
        <span style={{fontSize:10,fontWeight:700,color:C.taupe,letterSpacing:".1em",textTransform:"uppercase"}}>Período</span>
        <select value={preset} onChange={function(e){applyPreset(e.target.value);}} style={Object.assign({},IS,{width:"auto",flex:"1 1 150px"})}>
          {PRESET_OPTS.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}
          {preset==="custom"&&<option value="custom">Personalizado</option>}
        </select>
        <input type="date" value={dFrom} onChange={function(e){setDFrom(e.target.value);setPreset("custom");}} style={Object.assign({},IS,{width:"auto",flex:"1 1 130px"})}/>
        <input type="date" value={dTo} onChange={function(e){setDTo(e.target.value);setPreset("custom");}} style={Object.assign({},IS,{width:"auto",flex:"1 1 130px"})}/>
      </div>
      {/* Summary stats */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[["all","Todas","#fff",C.black,cleanReps.length],["pendiente","En revisión",C.surfaceWarm,C.earth,counts.pendiente],["aprobada","Aprobadas","#EDF5EF",C.green,counts.aprobada],["correccion","Correcciones","#F5EDEC",C.red,counts.correccion]].map(function(it){
          var k=it[0],l=it[1],bg=it[2],cl=it[3],n=it[4];
          return (
            <button key={k} onClick={function(){setFilter(k);}} style={{flex:1,minWidth:80,padding:"10px 8px",borderRadius:8,border:"1.5px solid "+(filter===k?cl:C.line),background:filter===k?bg:"#fff",cursor:"pointer",textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:700,color:filter===k?cl:C.earth}}>{n}</div>
              <div style={{fontSize:9.5,color:filter===k?cl:C.taupe,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase"}}>{l}</div>
            </button>
          );
        })}
      </div>

      {/* Aprobar las pendientes del filtro actual — solo admin */}
      {isAdmin&&pendScope.length>0&&(
        <button onClick={approveAll} disabled={bulkBusy} style={{padding:"13px",borderRadius:10,border:"none",background:bulkBusy?"#9CA89F":"#3d6b52",color:"#fff",fontSize:13.5,fontWeight:700,cursor:bulkBusy?"wait":"pointer"}}>
          {bulkBusy?("Aprobando… "+bulkN):((preset==="todo"&&selVend==="Todos")?("✓ Aprobar todas las pendientes ("+pendScope.length+")"):("✓ Aprobar pendientes del filtro ("+pendScope.length+")"))}
        </button>
      )}

      {/* Vendor filter */}
      <select value={selVend} onChange={function(e){setSelVend(e.target.value);}} style={IS}>
        {techOptsQA.map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>;})}
      </select>

      {/* List */}
      {filtered.length===0&&<div style={{textAlign:"center",padding:"32px",color:C.taupe,fontSize:13}}>Sin limpiezas en esta categoría.</div>}
      {filtered.map(function(r,i){
        var vn  = vMap[r.reportadoPor]||r.reportadoPor||"—";
        var qs  = r.qaStatus||"pendiente";
        var qcl = {pendiente:C.earth, aprobada:C.green, correccion:C.red, corregido:C.green, futuro:C.earth}[qs]||C.earth;
        var qlbl= {pendiente:"En revisión",aprobada:"✓ Aprobada",correccion:"⚠ Corrección",corregido:"✓ Corregida",futuro:"→ Tomado en cuenta"}[qs]||qs;
        return (
          <div key={r.id} style={{background:"#fff",borderRadius:10,padding:"14px 16px",border:"1.5px solid "+(qs==="pendiente"?C.line:qs==="aprobada"?"#c8dfc8":"#DBC8C4"),display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:C.black}}>{r.propiedad}</div>
                <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>{vn} · {fmtDate(r.fecha)} · {r.categoria}</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
                <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:100,background:qs==="aprobada"?"#EDF5EF":qs==="correccion"?"#F5EDEC":C.surfaceWarm,color:qcl}}>{qlbl}</span>
                <button onClick={function(){onSelect&&onSelect(r);}} style={{fontSize:11,padding:"4px 10px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,cursor:"pointer",fontWeight:600}}>Ver detalle →</button>
              </div>
            </div>
            {/* QA action buttons */}
            {(qs==="pendiente"||qs==="corregido")&&(
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button onClick={function(){onQA&&onQA(r.id,"aprobada","");}} style={{flex:1,padding:"9px",borderRadius:7,border:"none",background:"#3d6b52",color:"#fff",fontSize:12.5,fontWeight:700,cursor:"pointer"}}>✓ Aprobar</button>
                <button onClick={function(){var c=prompt("Comentario para el técnico:");if(c!==null)onQA&&onQA(r.id,"correccion",c);}} style={{flex:1,padding:"9px",borderRadius:7,border:"none",background:"#8a3030",color:"#fff",fontSize:12.5,fontWeight:700,cursor:"pointer"}}>⚠ Corrección</button>
              </div>
            )}
            {qs==="aprobada"&&(
              <div style={{fontSize:11.5,color:C.green,fontWeight:600}}>✓ Limpieza aprobada {r.qaFecha?("el "+fmtDate(r.qaFecha)):""}</div>
            )}
            {qs==="correccion"&&r.qaComentario&&(
              <div style={{fontSize:11.5,color:C.red,background:"#F5EDEC",padding:"8px 12px",borderRadius:6}}>Corrección: {r.qaComentario}</div>
            )}
            {r.qaRespuesta&&(
              <div style={{fontSize:11.5,color:C.earth,background:C.surfaceWarm,padding:"8px 12px",borderRadius:6}}>Respuesta: {r.qaRespuesta}</div>
            )}
          </div>
        );
      })}
      </>}
    </div>
  );
}


/* ═══ SUPERVISIÓN — panel para el usuario con función de supervisión.
   Revisa limpiezas del equipo (no las propias) y clasifica daños.
   Solo lectura del detalle: ve reporte y fotos, no edita ni gestiona pagos. */
function SupervisionPanel({me, reps, vendors, props, onUpdate}) {
  const [detail, setDetail] = useState(null);
  function qaSup(id,status,comment,tipo){
    var r=(reps||[]).find(function(x){return x.id===id;}); if(!r) return;
    var upd=Object.assign({},r,{qaStatus:status,qaComentario:comment||"",qaFecha:todayStr(),qaPor:vendorDisplay(me),qaTipo:status==="correccion"?(tipo||"inmediata"):r.qaTipo});
    onUpdate&&onUpdate(upd);
    setDetail(function(d){return d&&d.id===id?upd:d;});
    try{ notifyQAResult(upd,status,comment,vendors); }catch(_){}
  }
  /* Sus propias limpiezas las revisa el administrador — se excluyen aquí */
  var visibles=(reps||[]).filter(function(r){return r.reportadoPor!==me.email||isDanos(r.categoria);});
  return (
    <div>
      <div style={{maxWidth:700,margin:"0 auto",padding:"16px 16px 0"}}>
        <div style={{background:C.surfaceWarm,border:"1px solid "+C.line,borderRadius:10,padding:"11px 14px",fontSize:12,color:C.earth,lineHeight:1.6}}>
          ★ <strong>Función de supervisión</strong> — revisas las limpiezas del equipo y clasificas los daños. Tus propias limpiezas las revisa el administrador.
        </div>
      </div>
      <AdminQAPanel reps={visibles} vendors={vendors} onQA={qaSup} onSelect={setDetail} onUpdate={onUpdate} isAdmin={false} me={me}/>
      {detail&&<DetailModal rep={detail} vendors={vendors} props={props} readOnly={true} onClose={function(){setDetail(null);}} onQA={isCleaning(detail.categoria)?qaSup:undefined}/>}
    </div>
  );
}


/* ═══ TABLERO DE DAÑOS — clasificación por urgencia, estado y comentarios.
   Compartido: supervisión y administrador. */
var DMG_URG = [["alta","Alta","#8a3030","#F5EDEC"],["media","Media","#9a6b2f","#F7EFE2"],["baja","Baja","#3d6b52","#EDF5EF"]];
var DMG_STA = [["pendiente","Pendiente"],["proceso","En proceso"],["resuelto","Resuelto"]];
function DamageBoard({reps, vendors, me, isAdmin, onUpdate, onSelect}) {
  const [fU,  setFU]  = useState("todas");
  const [com, setCom] = useState({});
  var vMap={}; (vendors||[]).forEach(function(v){if(v.email)vMap[v.email]=vendorDisplay(v);});
  var danios=(reps||[]).filter(function(r){return isDanos(r.categoria);});
  var rank={alta:0,media:1,baja:2};
  var sorted=danios.slice().sort(function(a,b){
    var ra=(a.dmgStatus==="resuelto")?10:(rank[a.urgencia]!==undefined?rank[a.urgencia]:3);
    var rb=(b.dmgStatus==="resuelto")?10:(rank[b.urgencia]!==undefined?rank[b.urgencia]:3);
    if(ra!==rb)return ra-rb;
    return (b.createdAt||b.id)-(a.createdAt||a.id);
  });
  var list=sorted.filter(function(r){
    if(fU==="todas")return true;
    if(fU==="resuelto")return r.dmgStatus==="resuelto";
    if(fU==="sin")return !r.urgencia&&r.dmgStatus!=="resuelto";
    return r.urgencia===fU&&r.dmgStatus!=="resuelto";
  });
  var cnt={
    alta:  danios.filter(function(r){return r.urgencia==="alta"&&r.dmgStatus!=="resuelto";}).length,
    media: danios.filter(function(r){return r.urgencia==="media"&&r.dmgStatus!=="resuelto";}).length,
    baja:  danios.filter(function(r){return r.urgencia==="baja"&&r.dmgStatus!=="resuelto";}).length,
    sin:   danios.filter(function(r){return !r.urgencia&&r.dmgStatus!=="resuelto";}).length,
    res:   danios.filter(function(r){return r.dmgStatus==="resuelto";}).length,
  };
  function upd(r,patch){ onUpdate&&onUpdate(Object.assign({},r,patch)); }
  function setUrg(r,u){
    upd(r,{urgencia:u});
    if(u==="alta"){
      try{ notifyEmail(adminEmails(vendors), "🔴 Daño URGENTE — "+r.propiedad,
        "Se clasificó como URGENCIA ALTA el daño en "+r.propiedad+" ("+fmtDate(r.fecha)+"):\n\n"+(r.descripcion||"")+"\n\nClasificado por: "+(me?vendorDisplay(me):"Administración")+"\n\nRevisa Calidad → Daños en el app.\n\nEPI App — Spacio AM"); }catch(_){}
    }
  }
  function addCom(r){
    var t=(com[r.id]||"").trim(); if(!t)return;
    var c={id:"c"+Date.now(),autor:me?vendorDisplay(me):"Administración",rol:isAdmin?"Admin":"Supervisión",fecha:todayStr(),texto:t};
    upd(r,{dmgComments:(r.dmgComments||[]).concat([c])});
    setCom(function(p){var u=Object.assign({},p);u[r.id]="";return u;});
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {[["todas","Todos ("+danios.length+")"],["alta","🔴 Alta ("+cnt.alta+")"],["media","🟡 Media ("+cnt.media+")"],["baja","🟢 Baja ("+cnt.baja+")"],["sin","Sin clasificar ("+cnt.sin+")"],["resuelto","✓ Resueltos ("+cnt.res+")"]].map(function(it){
          var s=fU===it[0];
          return <button key={it[0]} onClick={function(){setFU(it[0]);}} style={{padding:"6px 12px",borderRadius:100,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>{it[1]}</button>;
        })}
      </div>
      {list.length===0&&<div style={{textAlign:"center",padding:"32px",color:C.taupe,fontSize:13}}>Sin reportes de daños en esta categoría.</div>}
      {list.map(function(r){
        var u=DMG_URG.find(function(x){return x[0]===r.urgencia;});
        var st=r.dmgStatus||"pendiente";
        var comments=r.dmgComments||[];
        return (
          <div key={r.id} style={{background:"#fff",borderRadius:12,border:"1.5px solid "+(st==="resuelto"?C.line:u?u[2]+"44":C.line),overflow:"hidden",opacity:st==="resuelto"?.7:1}}>
            {u&&st!=="resuelto"&&<div style={{height:4,background:u[2]}}></div>}
            <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.black}}>{r.propiedad}</div>
                  <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>{vMap[r.reportadoPor]||r.reportadoPor} · {fmtDate(r.fecha)}</div>
                </div>
                <button onClick={function(){onSelect&&onSelect(r);}} style={{fontSize:11,padding:"5px 10px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,cursor:"pointer",fontWeight:600,flexShrink:0}}>Ver fotos →</button>
              </div>
              {r.descripcion&&<div style={{fontSize:12.5,color:C.black,lineHeight:1.55,background:C.surfaceWarm,padding:"9px 12px",borderRadius:8}}>{r.descripcion}</div>}
              <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>Urgencia</div>
                  <div style={{display:"flex",gap:5}}>
                    {DMG_URG.map(function(x){var s=r.urgencia===x[0];return <button key={x[0]} onClick={function(){setUrg(r,s?"":x[0]);}} style={{padding:"5px 12px",borderRadius:100,border:"1.5px solid "+(s?x[2]:C.gray),background:s?x[3]:"#fff",color:s?x[2]:C.earth,fontSize:11,fontWeight:700,cursor:"pointer"}}>{x[1]}</button>;})}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>Estado</div>
                  <div style={{display:"flex",gap:5}}>
                    {DMG_STA.map(function(x){var s=st===x[0];return <button key={x[0]} onClick={function(){upd(r,{dmgStatus:x[0]});}} style={{padding:"5px 12px",borderRadius:100,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:11,fontWeight:600,cursor:"pointer"}}>{x[1]}</button>;})}
                  </div>
                </div>
              </div>
              {comments.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {comments.map(function(c){return (
                    <div key={c.id} style={{background:c.rol==="Admin"?"#F0EDE8":C.surfaceWarm,borderRadius:8,padding:"8px 12px"}}>
                      <div style={{fontSize:10,fontWeight:700,color:C.earth}}>{c.autor} · {c.rol} · {fmtDate(c.fecha)}</div>
                      <div style={{fontSize:12.5,color:C.black,lineHeight:1.5,marginTop:2}}>{c.texto}</div>
                    </div>
                  );})}
                </div>
              )}
              <div style={{display:"flex",gap:7}}>
                <input placeholder={isAdmin?"Responder a supervisión…":"Comentario para el administrador…"} value={com[r.id]||""} onChange={function(e){var v=e.target.value;setCom(function(p){var x=Object.assign({},p);x[r.id]=v;return x;});}} onKeyDown={function(e){if(e.key==="Enter")addCom(r);}} style={{flex:1,border:"1px solid "+C.gray,borderRadius:7,padding:"8px 11px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none"}}/>
                <button onClick={function(){addCom(r);}} style={{padding:"8px 14px",borderRadius:7,border:"none",background:C.black,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Enviar</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}


/* ═══ MANTENIMIENTOS EN CALIDAD — asignar pagador + comentarios para el proveedor (solo admin) */
var MANT_PAGADORES = ["Spacio AM","Dueño","Airbnb","Seguro"];
function MaintBoard({reps, vendors, me, onUpdate, onSelect}) {
  const [fP,  setFP]  = useState("todos");
  const [com, setCom] = useState({});
  var vMap={}; (vendors||[]).forEach(function(v){if(v.email)vMap[v.email]=vendorDisplay(v);});
  var mants=(reps||[]).filter(function(r){return r.categoria==="Mantenimiento";})
    .sort(function(a,b){return (b.createdAt||b.id)-(a.createdAt||a.id);});
  var list=mants.filter(function(r){
    if(fP==="todos")return true;
    if(fP==="sin")return !r.pagadoPor;
    return r.pagadoPor===fP;
  });
  var cntSin=mants.filter(function(r){return !r.pagadoPor;}).length;
  function upd(r,patch){ onUpdate&&onUpdate(Object.assign({},r,patch)); }
  function addCom(r){
    var t=(com[r.id]||"").trim(); if(!t)return;
    var c={id:"c"+Date.now(),autor:me?vendorDisplay(me):"Administración",fecha:todayStr(),texto:t};
    upd(r,{provComments:(r.provComments||[]).concat([c])});
    setCom(function(p){var u=Object.assign({},p);u[r.id]="";return u;});
  }
  var pagColors={"Spacio AM":{bg:"#EEF3FA",tx:"#4a7fa5"},"Dueño":{bg:"#FEF0EC",tx:"#E9826A"},"Airbnb":{bg:"#FDEEF0",tx:"#b14a5a"},"Seguro":{bg:"#EDF0E8",tx:"#5a7a3a"}};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:12,color:C.earth,background:C.surfaceWarm,padding:"10px 13px",borderRadius:8,border:"1px solid "+C.line,lineHeight:1.55}}>Asigna rápidamente quién paga cada trabajo de mantenimiento y deja comentarios para el proveedor. Solo tú (administrador) ves estos comentarios.</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {[["todos","Todos ("+mants.length+")"],["sin","Sin pagador ("+cntSin+")"]].concat(MANT_PAGADORES.map(function(p){return [p,p];})).map(function(it){
          var s=fP===it[0];
          return <button key={it[0]} onClick={function(){setFP(it[0]);}} style={{padding:"6px 12px",borderRadius:100,border:"1.5px solid "+(s?C.black:C.gray),background:s?C.black:"#fff",color:s?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>{it[1]}</button>;
        })}
      </div>
      {list.length===0&&<div style={{textAlign:"center",padding:"32px",color:C.taupe,fontSize:13}}>Sin mantenimientos en esta categoría.</div>}
      {list.map(function(r){
        var comments=r.provComments||[];
        return (
          <div key={r.id} style={{background:"#fff",borderRadius:12,border:"1.5px solid "+(r.pagadoPor?C.line:"#E6D88A"),overflow:"hidden"}}>
            {!r.pagadoPor&&<div style={{height:4,background:"#E6D88A"}}></div>}
            <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.black}}>{r.propiedad}</div>
                  <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>{vMap[r.reportadoPor]||r.reportadoPor} · {fmtDate(r.fecha)}{r.total?" · Q"+r.total:""}</div>
                </div>
                <button onClick={function(){onSelect&&onSelect(r);}} style={{fontSize:11,padding:"5px 10px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,cursor:"pointer",fontWeight:600,flexShrink:0}}>Ver detalle →</button>
              </div>
              {(r.descripcion||r.comentarios)&&<div style={{fontSize:12.5,color:C.black,lineHeight:1.55,background:C.surfaceWarm,padding:"9px 12px",borderRadius:8}}>{r.descripcion||r.comentarios}</div>}
              <div>
                <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>¿Quién paga?</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {MANT_PAGADORES.map(function(p){var s=r.pagadoPor===p;var cx=pagColors[p];return <button key={p} onClick={function(){upd(r,{pagadoPor:s?"":p});}} style={{padding:"5px 13px",borderRadius:100,border:"1.5px solid "+(s?cx.tx:C.gray),background:s?cx.bg:"#fff",color:s?cx.tx:C.earth,fontSize:11,fontWeight:700,cursor:"pointer"}}>{p}</button>;})}
                </div>
              </div>
              {comments.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>Comentarios para el proveedor</div>
                  {comments.map(function(c){return (
                    <div key={c.id} style={{background:"#F0EDE8",borderRadius:8,padding:"8px 12px"}}>
                      <div style={{fontSize:10,fontWeight:700,color:C.earth}}>{c.autor} · {fmtDate(c.fecha)}</div>
                      <div style={{fontSize:12.5,color:C.black,lineHeight:1.5,marginTop:2}}>{c.texto}</div>
                    </div>
                  );})}
                </div>
              )}
              <div style={{display:"flex",gap:7}}>
                <input placeholder="Comentario para el proveedor…" value={com[r.id]||""} onChange={function(e){var v=e.target.value;setCom(function(p){var x=Object.assign({},p);x[r.id]=v;return x;});}} onKeyDown={function(e){if(e.key==="Enter")addCom(r);}} style={{flex:1,border:"1px solid "+C.gray,borderRadius:7,padding:"8px 11px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none"}}/>
                <button onClick={function(){addCom(r);}} style={{padding:"8px 14px",borderRadius:7,border:"none",background:C.black,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Enviar</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}


/* ═══ RESUMEN POR TÉCNICO — correcciones de supervisión, desglose + análisis (solo admin) */
var QA_THEMES=[
  ["Polvo / sacudido",["polvo","sacud"]],
  ["Baños",["baño","bano","inodoro","ducha","regadera","sarro","lavamanos"]],
  ["Cocina / trastes",["cocina","traste","refri","microondas","estufa","fregadero","plato"]],
  ["Blancos (sábanas / toallas)",["sábana","sabana","toalla","duvet","edred","cama","funda","cubrecama"]],
  ["Pisos",["piso","trapear","barrer","alfombra"]],
  ["Vidrios / espejos",["vidrio","espejo","ventana"]],
  ["Basura / olores",["basura","olor"]],
  ["Insumos / cortesía",["insumo","papel","jabón","jabon","shampoo","café","cafe","agua"]],
  ["Orden / detalles",["orden","acomod","detalle","doblez","doblar","coloca"]],
];
function TechSummary({reps, vendors}) {
  const [ai,    setAi]    = useState(null);
  const [busy,  setBusy]  = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [open,  setOpen]  = useState(null);
  var vMap={}; (vendors||[]).forEach(function(v){if(v.email)vMap[v.email]=vendorDisplay(v);});
  var cleans=(reps||[]).filter(function(r){return isCleaning(r.categoria);});
  var byTech={};
  cleans.forEach(function(r){
    var owner=(vendors||[]).find(function(v){return repMatchesVendor(r,v);});
    var key=owner?("v:"+owner.id):(r.reportadoPor||"?");
    if(!byTech[key])byTech[key]={email:(owner&&owner.email)||r.reportadoPor||"?",name:owner?vendorDisplay(owner):(r.reportadoPor||"?"),total:0,apr:0,corr:[]};
    var t=byTech[key]; t.total++;
    if(r.qaStatus==="aprobada")t.apr++;
    if((r.qaStatus==="correccion"||r.qaStatus==="corregido"||r.qaStatus==="futuro")&&r.qaComentario)t.corr.push(r);
  });
  var techs=Object.keys(byTech).map(function(k){return byTech[k];}).sort(function(a,b){return b.corr.length-a.corr.length||b.total-a.total;});
  function themesFor(t){
    var counts=[];
    QA_THEMES.forEach(function(th){
      var n=t.corr.filter(function(r){var txt=(r.qaComentario||"").toLowerCase();return th[1].some(function(w){return txt.indexOf(w)>=0;});}).length;
      if(n>0)counts.push({name:th[0],n:n});
    });
    return counts.sort(function(a,b){return b.n-a.n;}).slice(0,3);
  }
  async function genAI(){
    setBusy(true); setAiErr("");
    /* 1º intento: IA del entorno de Claude; 2º: acción "ai" del Apps Script (producción) */
    async function complete(prompt){
      if(window.claude&&window.claude.complete) return await window.claude.complete(prompt);
      var r=await apiCall("ai",{prompt:prompt});
      return (r&&r.text)||"";
    }
    try{
      var out={};
      for(var i=0;i<techs.length;i++){
        var t=techs[i]; if(!t.corr.length) continue;
        var lines=t.corr.map(function(r){return "- "+fmtDate(r.fecha)+" · "+r.propiedad+": "+r.qaComentario;}).join("\n");
        var prompt="Eres supervisor de calidad de limpieza de apartamentos de renta corta. Correcciones registradas para "+(t.name||vMap[t.email]||t.email)+":\n"+lines+"\n\nEscribe en español un resumen de 2-3 frases: los patrones más recurrentes y una recomendación concreta de coaching. Responde SOLO el resumen, sin preámbulo.";
        out[t.email]=await complete(prompt);
      }
      setAi(out);
    }catch(e){ setAiErr("Resumen IA no disponible ("+(e&&e.message?e.message:e)+") — se muestra el análisis automático de temas recurrentes. Para activarlo en producción, agrega la acción 'ai' al Apps Script con tu API key de Anthropic."); }
    finally{ setBusy(false); }
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={{fontSize:12.5,color:C.earth,lineHeight:1.5,flex:1,minWidth:200}}>Correcciones hechas por supervisión, desglosadas por técnico, con sus temas más recurrentes.</div>
        <button onClick={genAI} disabled={busy} style={{padding:"10px 16px",borderRadius:9,border:"none",background:busy?"#9CA89F":C.black,color:"#fff",fontSize:12,fontWeight:700,cursor:busy?"wait":"pointer"}}>{busy?"Analizando…":"✦ Generar resumen IA"}</button>
      </div>
      {aiErr&&<div style={{background:"#F7EFE2",border:"1px solid #E3D5B8",borderRadius:8,padding:"9px 13px",fontSize:11.5,color:"#9a6b2f"}}>{aiErr}</div>}
      {techs.length===0&&<div style={{textAlign:"center",padding:"32px",color:C.taupe,fontSize:13}}>Sin limpiezas registradas.</div>}
      {techs.map(function(t){
        var th=themesFor(t);
        var isOpen=open===t.email;
        return (
          <div key={t.email} style={{background:"#fff",borderRadius:12,border:"1px solid "+C.line,padding:"15px 16px",display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <div>
                <div style={{fontSize:14.5,fontWeight:700,color:C.black}}>{t.name||vMap[t.email]||t.email}</div>
                <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>{t.total} limpiezas · {t.apr} aprobadas · <span style={{color:t.corr.length>0?C.red:C.green,fontWeight:700}}>{t.corr.length} correcci{t.corr.length===1?"ón":"ones"}</span></div>
              </div>
              {t.corr.length>0&&<button onClick={function(){setOpen(isOpen?null:t.email);}} style={{fontSize:11,padding:"5px 11px",borderRadius:5,border:"1px solid "+C.gray,background:"#fff",color:C.earth,cursor:"pointer",fontWeight:600,flexShrink:0}}>{isOpen?"Ocultar ▴":"Desglose ▾"}</button>}
            </div>
            {th.length>0&&(
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".1em",textTransform:"uppercase"}}>Recurrentes:</span>
                {th.map(function(x){return <span key={x.name} style={{padding:"4px 11px",borderRadius:100,background:"#F5EDEC",color:C.red,fontSize:11,fontWeight:700}}>{x.name} ×{x.n}</span>;})}
              </div>
            )}
            {ai&&ai[t.email]&&(
              <div style={{background:C.surfaceWarm,borderRadius:9,padding:"11px 14px",fontSize:12.5,color:C.black,lineHeight:1.65,borderLeft:"3px solid "+C.taupe}}>
                <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>✦ Resumen IA</div>
                {ai[t.email]}
              </div>
            )}
            {isOpen&&(
              <div style={{display:"flex",flexDirection:"column",gap:6,borderTop:"1px solid "+C.line,paddingTop:10}}>
                {t.corr.map(function(r){return (
                  <div key={r.id} style={{background:"#F5EDEC",borderRadius:8,padding:"9px 12px"}}>
                    <div style={{fontSize:10.5,fontWeight:700,color:C.earth}}>{fmtDate(r.fecha)} · {r.propiedad}{r.qaPor?" · por "+r.qaPor:""}</div>
                    <div style={{fontSize:12.5,color:C.black,lineHeight:1.5,marginTop:3}}>{r.qaComentario}</div>
                    {r.qaRespuesta&&<div style={{fontSize:11.5,color:C.green,marginTop:4,fontWeight:600}}>↳ Respuesta: {r.qaRespuesta==="corregido"?"Corrección realizada":r.qaRespuesta}</div>}
                  </div>
                );})}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}



/* ═══════════════════════════════════════════════════════
   PHOTO RECOVERY TOOL
   Scans Drive folder, matches photos to reports by ID
   and updates Sheets with the missing URLs
   ═══════════════════════════════════════════════════════ */
function PhotoRecoveryTool() {
  const [status,   setStatus]   = useState("idle"); /* idle|scanning|done|error */
  const [log,      setLog]      = useState([]);
  const [results,  setResults]  = useState(null);

  function addLog(msg, type) {
    setLog(function(p){ return [...p, {msg:msg, type:type||"info", ts:new Date().toLocaleTimeString("es-GT")}]; });
  }

  async function runTest() {
    setStatus("scanning"); setLog([]);
    addLog("Probando conexión con Drive…");
    try {
      var r = await apiCall("testDrive", {});
      addLog("Carpeta Drive: " + (r.folderName||"?"), "detail");
      addLog("Archivos directos en carpeta: " + (r.directFiles||0), "detail");
      addLog("Subcarpetas: " + (r.subfolders||0), "detail");
      addLog("Total archivos (incluyendo subfolders): " + (r.totalFiles||0), r.totalFiles>0?"success":"error");
      if(r.samples&&r.samples.length) {
        r.samples.forEach(function(s){ addLog("  → " + s, "detail"); });
      }
      setStatus("idle");
    } catch(e) {
      addLog("Error: " + (e&&e.message?e.message:String(e)), "error");
      setStatus("error");
    }
  }

  async function runRecovery() {
    setStatus("scanning"); setLog([]); setResults(null);
    addLog("Iniciando recuperación de fotos…");
    try {
      addLog("Llamando al servidor para escanear Google Drive…");
      var r = await apiCall("recoverPhotos", {});
      addLog("Escaneo completado.", "success");
      addLog("Archivos encontrados en Drive: " + (r.filesFound||0));
      addLog("Reportes procesados: " + (r.reportsProcessed||0));
      addLog("Reportes actualizados con fotos recuperadas: " + (r.reportsUpdated||0));
      if(r.details&&r.details.length) {
        r.details.forEach(function(d){ addLog("↳ " + d, "detail"); });
      }
      if(r.errors&&r.errors.length) {
        r.errors.forEach(function(e){ addLog("⚠ " + e, "error"); });
      }
      setResults(r);
      setStatus("done");
      addLog("✓ Recuperación finalizada.", "success");
    } catch(e) {
      addLog("Error: " + (e&&e.message?e.message:String(e)), "error");
      setStatus("error");
    }
  }

  var logColors = {info:C.earth, success:C.green, error:C.red, detail:C.taupe};

  return (
    <div style={{maxWidth:600,margin:"0 auto",padding:"20px 16px",fontFamily:"Montserrat,sans-serif",display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:C.surfaceWarm,borderRadius:10,padding:"16px",border:"1px solid "+C.line}}>
        <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:8}}>Herramienta de recuperación de fotos</div>
        <div style={{fontSize:13,color:C.earth,lineHeight:1.7,marginBottom:14}}>
          Esta herramienta escanea tu carpeta de Google Drive, identifica las fotos ya subidas y las vincula a sus reportes correspondientes en Google Sheets.
          <br/><span style={{fontSize:11.5,color:C.taupe}}>Útil para reportes que muestran 0% de fotos aunque las fotos sí llegaron a Drive.</span>
        </div>
        <button
          onClick={runTest}
          disabled={status==="scanning"}
          style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12.5,fontWeight:600,cursor:status==="scanning"?"default":"pointer",marginBottom:8}}
        >
          🔌 Probar conexión con Drive primero
        </button>
        <button
          onClick={runRecovery}
          disabled={status==="scanning"}
          style={{width:"100%",padding:"13px",borderRadius:8,border:"none",background:status==="scanning"?C.gray:C.black,color:"#fff",fontSize:13,fontWeight:700,cursor:status==="scanning"?"default":"pointer",letterSpacing:".04em"}}
        >
          {status==="scanning"?"⏳ Escaneando Drive… (puede tardar 30-60 seg)":"🔍 Iniciar recuperación de fotos"}
        </button>
      </div>

      {/* Log output */}
      {log.length>0&&(
        <div style={{background:"#1E1E1E",borderRadius:10,padding:"14px 16px",fontFamily:"monospace",fontSize:11.5,lineHeight:1.9,maxHeight:340,overflow:"auto",display:"flex",flexDirection:"column",gap:2}}>
          {log.map(function(l,i){
            return <div key={i} style={{color:l.type==="success"?"#7fba7f":l.type==="error"?"#e08080":l.type==="detail"?"#aaa":"#e0d8c8"}}>
              <span style={{color:"#666",marginRight:8}}>[{l.ts}]</span>{l.msg}
            </div>;
          })}
        </div>
      )}

      {/* Results summary */}
      {results&&(
        <div style={{background:"#EDF5EF",borderRadius:10,padding:"14px 16px",border:"1px solid #c8dfc8"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:8}}>Resultado de la recuperación</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <div style={{textAlign:"center",padding:"10px",background:"#fff",borderRadius:8}}>
              <div style={{fontSize:22,fontWeight:700,color:C.black}}>{results.filesFound||0}</div>
              <div style={{fontSize:10,color:C.taupe,textTransform:"uppercase",letterSpacing:".1em"}}>Fotos en Drive</div>
            </div>
            <div style={{textAlign:"center",padding:"10px",background:"#fff",borderRadius:8}}>
              <div style={{fontSize:22,fontWeight:700,color:C.earth}}>{results.reportsProcessed||0}</div>
              <div style={{fontSize:10,color:C.taupe,textTransform:"uppercase",letterSpacing:".1em"}}>Reportes revisados</div>
            </div>
            <div style={{textAlign:"center",padding:"10px",background:"#fff",borderRadius:8}}>
              <div style={{fontSize:22,fontWeight:700,color:C.green}}>{results.reportsUpdated||0}</div>
              <div style={{fontSize:10,color:C.taupe,textTransform:"uppercase",letterSpacing:".1em"}}>Reportes recuperados</div>
            </div>
          </div>
          {results.reportsUpdated>0&&(
            <div style={{marginTop:12,fontSize:12,color:C.earth,fontWeight:600}}>
              ✓ Recarga el dashboard para ver las fotos recuperadas (botón ↻).
            </div>
          )}
        </div>
      )}
    </div>
  );
}



/* ─── Photo Lightbox — full screen photo viewer */
function PhotoLightbox({photos, initialIdx, onClose}) {
  const [idx, setIdx] = useState(initialIdx||0);
  var total = photos.length;
  function prev(e){e.stopPropagation();setIdx(function(i){return(i-1+total)%total;});}
  function next(e){e.stopPropagation();setIdx(function(i){return(i+1)%total;});}
  useEffect(function(){
    function onKey(e){if(e.key==="Escape")onClose();if(e.key==="ArrowLeft")setIdx(function(i){return(i-1+total)%total;});if(e.key==="ArrowRight")setIdx(function(i){return(i+1)%total;});}
    window.addEventListener("keydown",onKey);
    return function(){window.removeEventListener("keydown",onKey);};
  },[]);
  var src = photos[idx];
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
      <div style={{position:"absolute",top:16,right:20,color:"#fff",fontSize:24,cursor:"pointer",fontWeight:300,lineHeight:1}} onClick={onClose}>×</div>
      <div style={{position:"relative",maxWidth:"90vw",maxHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {total>1&&<button onClick={prev} style={{position:"absolute",left:-48,background:"rgba(255,255,255,.15)",border:"none",color:"#fff",fontSize:28,width:40,height:40,borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>‹</button>}
        <img
          src={driveThumb(src,1200)}
          alt={"foto "+(idx+1)}
          style={{maxWidth:"85vw",maxHeight:"78vh",objectFit:"contain",borderRadius:8}}
          onError={function(e){e.target.src=src;}}
          onClick={function(e){e.stopPropagation();}}
        />
        {total>1&&<button onClick={next} style={{position:"absolute",right:-48,background:"rgba(255,255,255,.15)",border:"none",color:"#fff",fontSize:28,width:40,height:40,borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2}}>›</button>}
      </div>
      <div style={{color:"rgba(255,255,255,.6)",fontSize:12,letterSpacing:".1em"}}>{idx+1} / {total}</div>
      <a href={src} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{color:"rgba(255,255,255,.5)",fontSize:11,textDecoration:"none"}}>↗ Abrir en Drive</a>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════════
   ADELANTOS — payment advances for EPI Limpieza technicians
   Local store (Sheets-ready via saveConfig key "adelantos").
   ════════════════════════════════════════════════════════════════════ */
function adv_load(){ try{var v=localStorage.getItem("sam_adelantos");return v?JSON.parse(v):null;}catch(e){return null;} }
function adv_persist(list){
  try{ localStorage.setItem("sam_adelantos", JSON.stringify(list)); }catch(e){}
  if(!IS_CLAUDE_SANDBOX){ try{ apiCall("saveConfig",{key:"adelantos",value:list}); }catch(e){} }
}
function normNm(s){ return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim(); }
/* Todos los adelantos legacy iniciaron el 1 de junio 2026 */
var ADV_DEFAULT_START = "2026-06-01";
function advStart(adv){ return adv.fechaInicio || adv.fechaDeposito || ADV_DEFAULT_START; }
/* Adelantos ligados a su técnico real (por correo) */
function adv_seed(){
  function mk(name,email,saldo,semanal){ return {id:"adv_"+normNm(name).replace(/[^a-z]/g,"")+"_"+Date.now()+Math.floor(Math.random()*1000), vendorEmail:email, vendorName:name, dpiNumber:"", dpiPhoto:null, monto:saldo, cobroSemanal:semanal, cuotas:Math.ceil(saldo/semanal), fechaInicio:ADV_DEFAULT_START, fechaDeposito:ADV_DEFAULT_START, status:"activo", createdAt:Date.now(), pausas:[], contractText:""}; }
  return [
    mk("Joselyn Sian","andyvas85@gmail.com",1950,250),
    mk("Lilia del Cid","dubonmar20@gmail.com",575,525),
    mk("Jackeline Ruano","kr9435454@gmail.com",900,100),
  ];
}
/* Normaliza/migra: liga adelantos legacy a su técnico por nombre, agrega fechaInicio y pausas */
function adv_migrate(list, vendors){
  var changed=false;
  var out=(list||[]).map(function(a){
    var b=Object.assign({},a);
    if(!Array.isArray(b.pausas)){ b.pausas=[]; changed=true; }
    if(!b.vendorEmail && b.vendorName){
      var target=normNm(b.vendorName);
      var v=(vendors||[]).find(function(x){ return normNm(x.name)===target || normNm(vendorDisplay(x))===target; });
      if(v){ b.vendorEmail=v.email; changed=true; }
    }
    if(!b.fechaInicio){ b.fechaInicio=b.fechaDeposito||ADV_DEFAULT_START; changed=true; }
    if(b.legacy){ b.legacy=false; changed=true; } /* ahora participan en el débito automático */
    return b;
  });
  return {list:out, changed:changed};
}
function isEpiLimpieza(v){ return !!v && v.tipo==="interno" && v.categoria==="EPI Limpieza"; }
function mondayOf(d){ var x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
function weekKeyOf(d){ return mondayOf(d).toISOString().slice(0,10); }
function last8WeeksSum(reps,email){
  if(!email) return 0;
  var start=mondayOf(new Date()); start.setDate(start.getDate()-7*7); /* covers current + 7 prior weeks */
  var s=0;
  (reps||[]).forEach(function(r){ if(r.reportadoPor!==email||isDanos(r.categoria)) return; var d=new Date((r.fecha||"")+"T12:00:00"); if(isNaN(d.getTime())) return; if(d>=start) s+=parseFloat(r.total||0)||0; });
  return s;
}
function maxAdvanceFor(reps,email){ return Math.floor(last8WeeksSum(reps,email)/2); }
/* Suma de ingresos de las últimas 8 semanas considerando TODOS los correos del técnico
   (actual, de notificaciones y anteriores). Robusto ante cambios de correo. */
function incomeLast8(reps, emails){
  if(!emails||!emails.length) return 0;
  var set={}; emails.forEach(function(e){ if(e) set[String(e).toLowerCase().trim()]=true; });
  var start=mondayOf(new Date()); start.setDate(start.getDate()-7*7);
  var s=0;
  (reps||[]).forEach(function(r){
    var rp=(r.reportadoPor||"").toLowerCase().trim();
    if(!set[rp]||isDanos(r.categoria)) return;
    var d=new Date((r.fecha||"")+"T12:00:00"); if(isNaN(d.getTime())) return;
    if(d>=start) s+=parseFloat(r.total||0)||0;
  });
  return s;
}
/* Límite dinámico de adelanto de un técnico = ½ de sus ingresos de las últimas 8 semanas. */
function maxAdvanceForVendor(reps, vendor){ return Math.floor(incomeLast8(reps, vendorEmailSet(vendor))/2); }
function isInternalVendor(v){ return !!v && v.tipo==="interno"; }
/* Pago semanal promedio del técnico (semanas con trabajos) — para el % de adelanto */
function avgWeekPay(reps,email){
  if(!email) return 0;
  var weeks={};
  (reps||[]).forEach(function(r){ if(r.reportadoPor!==email||isDanos(r.categoria)) return; var d=new Date((r.fecha||"")+"T12:00:00"); if(isNaN(d.getTime()))return; var k=weekKeyOf(d); weeks[k]=(weeks[k]||0)+(parseFloat(r.total||0)||0); });
  var vals=Object.keys(weeks).map(function(k){return weeks[k];}).filter(function(x){return x>0;});
  if(!vals.length) return 0;
  return Math.round(vals.reduce(function(a,b){return a+b;},0)/vals.length);
}
/* Estado derivado de un adelanto. El cobro es AUTOMÁTICO: cada semana (desde fechaInicio)
   en la que el técnico tuvo ≥1 trabajo y TODOS quedaron pagados cuenta como una cuota
   debitada — salvo las semanas en `pausas`, que se saltan. */
function advanceState(adv, reps){
  var monto=parseFloat(adv.monto||0)||0, semanal=parseFloat(adv.cobroSemanal||0)||0;
  /* Ledger congelado: Q ya debitado (`frozenDebited`) + nº de semanas ya contabilizadas
     (`frozenWeeks`). Cambiar la cuota semanal congela lo debitado hasta ese momento con la
     cuota vieja y solo aplica la nueva cuota a las semanas FUTURAS — el saldo nunca cambia
     por un ajuste de cuota. */
  var frozenDebited=Math.max(0, parseFloat(adv.frozenDebited||0)||0);
  var frozenWeeks=Math.max(0, parseInt(adv.frozenWeeks||0)||0);
  var pausas=adv.pausas||[];
  var startMon=mondayOf(new Date(advStart(adv)+"T12:00:00"));
  /* Correos de la PERSONA dueña del adelanto (actual + anteriores). Robusto ante
     cambios de correo: si el técnico cambió de correo, sus trabajos nuevos siguen
     contando para el cobro. */
  var emails=advPersonEmails(adv);
  var weeks={};
  if(emails.length){
    (reps||[]).forEach(function(r){
      if(emails.indexOf((r.reportadoPor||"").toLowerCase().trim())<0) return;
      if(isDanos(r.categoria)) return; /* daños no generan pago: no bloquean la semana */
      var d=new Date((r.fecha||"")+"T12:00:00"); if(isNaN(d.getTime())) return;
      var m=mondayOf(d); if(m<startMon) return;
      var k=m.toISOString().slice(0,10);
      if(!weeks[k]) weeks[k]={n:0,paid:0};
      weeks[k].n++; if(r.paid) weeks[k].paid++;
    });
  }
  var fullyPaid=Object.keys(weeks).filter(function(k){return weeks[k].n>0 && weeks[k].paid===weeks[k].n;}).sort();
  var charged=fullyPaid.filter(function(k){return pausas.indexOf(k)<0;});       /* semanas que SÍ cobran */
  var pausedDone=fullyPaid.filter(function(k){return pausas.indexOf(k)>=0;});   /* semanas pausadas ya completadas */
  var chargedWeeks=charged.length;
  /* Ajustes manuales del admin: reversiones de cobros previos (regresan al saldo) */
  var revertido=(adv.ajustes||[]).reduce(function(s,x){return s+(parseFloat(x.monto)||0);},0);
  /* Solo cobra si está activo. Semanas nuevas = las cobrables desde el último ajuste. */
  var active = adv.status==="activo";
  var newWeeksTotal = active ? Math.max(0, chargedWeeks - frozenWeeks) : 0;
  /* Principal que aún puede debitarse tras lo congelado. La última cuota es el remanente:
     nunca se cobra más que el saldo (bug #7). */
  var remainingPrincipal = Math.max(0, monto - Math.min(monto, frozenDebited));
  var maxNewWeeks = semanal>0 ? Math.ceil(remainingPrincipal/semanal) : 0;
  var newWeeks = Math.min(newWeeksTotal, maxNewWeeks);
  var grossDebited = Math.min(monto, frozenDebited + newWeeks*semanal);
  var debited = Math.max(0, Math.min(monto, grossDebited - revertido));
  var saldo = Math.max(0, monto - debited);
  var futureCuotas = semanal>0 ? Math.ceil(remainingPrincipal/semanal) : 0;
  var cuotas = Math.max(1, frozenWeeks + futureCuotas);
  var paidWeeks = active ? Math.min(frozenWeeks + newWeeks, cuotas) : 0;
  /* El cobro de la semana se topa en el saldo restante: la última cuota es el remanente. */
  var weeklyCharge = (active && saldo>0) ? Math.min(semanal, saldo) : 0;
  return { monto:monto, semanal:semanal, cuotas:cuotas, paidWeeks:paidWeeks, debited:debited, saldo:saldo, revertido:revertido,
           weeklyCharge:weeklyCharge, done:saldo<=0, pausas:pausas, weeks:weeks,
           frozenDebited:frozenDebited, frozenWeeks:frozenWeeks, chargedWeeks:chargedWeeks,
           fullyPaidWeeks:fullyPaid, pausedDone:pausedDone, startMon:startMon };
}
/* Clave estable de la PERSONA dueña de un adelanto (agrupa varios adelantos del mismo técnico). */
function advPersonKey(adv){
  var email=((adv&&adv.vendorEmail)||"").toLowerCase().trim();
  if(email){
    var v=(ADV_VENDORS||[]).find(function(x){ return vendorEmailSet(x).indexOf(email)>=0; });
    if(v) return "v:"+(v.id||vendorEmailSet(v)[0]||email);
    return "e:"+email;
  }
  return "n:"+normNm((adv&&adv.vendorName)||"");
}
/* Une varios adelantos ACTIVOS de una misma persona en un solo registro unificado.
   - monto = suma de montos ; el saldo combinado se preserva congelando lo ya debitado
   - UNA sola cuota semanal (suma de las cuotas; el admin puede ajustarla después)
   - conserva cada contrato y cada comprobante de depósito en `contracts[]` para poder verlos */
function mergeAdvances(list, reps){
  var src=(list||[]).slice().sort(function(a,b){return advStart(a).localeCompare(advStart(b));});
  if(src.length<=1) return src[0];
  var base=src[0];
  var earliest=src.reduce(function(m,a){var s=advStart(a);return (!m||s<m)?s:m;},null);
  var pausas=[]; src.forEach(function(a){(a.pausas||[]).forEach(function(k){if(pausas.indexOf(k)<0)pausas.push(k);});});
  var monto=0, frozenDebited=0, cobroSemanal=0, contracts=[];
  src.forEach(function(a){
    var st=advanceState(a, reps||[]);
    monto+=st.monto;
    frozenDebited+=Math.min(st.monto, st.debited + st.revertido);
    cobroSemanal+=(parseFloat(a.cobroSemanal||0)||0);
    var subs=(a.contracts&&a.contracts.length)?a.contracts:[{
      monto:st.monto, cuotas:a.cuotas, cobroSemanal:a.cobroSemanal, dpiNumber:a.dpiNumber,
      dpiPhoto:a.dpiPhoto, firma:a.firma, firmadoEn:a.firmadoEn, fechaDeposito:a.fechaDeposito,
      fechaInicio:advStart(a), contractText:a.contractText||buildContractText(a), comprobanteDeposito:a.comprobanteDeposito||null,
    }];
    subs.forEach(function(c){ contracts.push(c); });
  });
  var probe=advanceState({vendorEmail:base.vendorEmail, vendorName:base.vendorName, fechaInicio:earliest, status:"activo", pausas:pausas}, reps||[]);
  return {
    id: base.id, vendorEmail: base.vendorEmail, vendorName: base.vendorName,
    dpiNumber: base.dpiNumber||"", dpiPhoto: base.dpiPhoto||null, firma: base.firma||null, firmadoEn: base.firmadoEn||null,
    monto: monto, cobroSemanal: cobroSemanal,
    frozenDebited: Math.min(monto, frozenDebited), frozenWeeks: probe.chargedWeeks,
    fechaInicio: earliest, fechaDeposito: earliest, status: "activo",
    pausas: pausas, ajustes: [], contracts: contracts, unified: true,
    createdAt: src.reduce(function(m,a){return Math.min(m, a.createdAt||Date.now());}, Date.now()),
    contractText: base.contractText||buildContractText(base),
  };
}
/* Detecta grupos de ≥2 adelantos ACTIVOS de la misma persona y los unifica en uno. */
function autoUnify(list, reps){
  var groups={};
  (list||[]).forEach(function(a){ if(a.status!=="activo") return; var k=advPersonKey(a); (groups[k]||(groups[k]=[])).push(a); });
  var changed=false, mergedById={};
  Object.keys(groups).forEach(function(k){
    if(groups[k].length>=2){
      changed=true;
      var merged=mergeAdvances(groups[k], reps);
      mergedById[merged.id]=merged;
      groups[k].forEach(function(a){ if(a.id!==merged.id) mergedById["__drop_"+a.id]=true; });
    }
  });
  if(!changed) return {list:list, changed:false};
  var out=[];
  (list||[]).forEach(function(a){
    if(mergedById["__drop_"+a.id]) return;
    if(mergedById[a.id]){ out.push(mergedById[a.id]); return; }
    out.push(a);
  });
  return {list:out, changed:true};
}
/* Lista de contratos individuales de un adelanto (unificado o no) para visualizarlos. */
function advContracts(adv){
  if(adv&&adv.contracts&&adv.contracts.length) return adv.contracts;
  return [{
    monto:parseFloat(adv&&adv.monto||0)||0, cuotas:adv&&adv.cuotas, cobroSemanal:adv&&adv.cobroSemanal,
    dpiNumber:adv&&adv.dpiNumber, dpiPhoto:adv&&adv.dpiPhoto, firma:adv&&adv.firma, firmadoEn:adv&&adv.firmadoEn,
    fechaDeposito:adv&&adv.fechaDeposito, fechaInicio:advStart(adv), contractText:(adv&&adv.contractText)||buildContractText(adv||{}),
    comprobanteDeposito:(adv&&adv.comprobanteDeposito)||null,
  }];
}
/* Comprobantes de depósito de un adelanto (unificado o no). */
function advDeposits(adv){
  return advContracts(adv).map(function(c){return c.comprobanteDeposito;}).filter(Boolean);
}
/* Correos de la persona dueña de un adelanto: el correo del adelanto más todos los del
   técnico que lo posee (actual, notificaciones y anteriores). */
function advPersonEmails(adv){
  var primary=((adv&&adv.vendorEmail)||"").toLowerCase().trim();
  var out=primary?[primary]:[];
  var v=(ADV_VENDORS||[]).find(function(x){ return vendorEmailSet(x).indexOf(primary)>=0; });
  if(v){ vendorEmailSet(v).forEach(function(e){ if(out.indexOf(e)<0) out.push(e); }); }
  return out;
}
/* Próxima semana cobrable: la semana pendiente más próxima (no completada y no pausada).
   Nunca se queda "atascada" en una semana pasada vacía: una semana ya transcurrida solo
   sigue pendiente si aún tiene trabajos SIN pagar (que al pagarse dispararan el cobro).
   Las semanas pasadas sin trabajos, o ya resueltas, se saltan — el cobro no es retroactivo. */
function nextChargeableWeek(adv, reps){
  var st=advanceState(adv, reps);
  var curMon=mondayOf(new Date());
  var curK=curMon.toISOString().slice(0,10);
  var cursor=new Date(st.startMon);
  var limit=new Date(curMon); limit.setDate(limit.getDate()+7*5);
  while(cursor<=limit){
    var k=cursor.toISOString().slice(0,10);
    var w=st.weeks[k];
    var paused=(adv.pausas||[]).indexOf(k)>=0;
    var fullyPaid=w&&w.n>0&&w.paid===w.n;
    if(!paused && !fullyPaid){
      if(k<curK){
        var hasPending=w&&w.n>0&&w.paid<w.n;
        if(hasPending) return k;
      } else {
        return k;
      }
    }
    cursor.setDate(cursor.getDate()+7);
  }
  return null;
}
/* Cobro semanal de adelantos para un técnico (o "Todos") — respeta el filtro del dashboard */
function advanceChargeFor(adelantos, reps, email){
  return (adelantos||[]).reduce(function(s,a){
    if(email && email!=="Todos" && a.vendorEmail!==email) return s;
    return s + advanceState(a, reps).weeklyCharge;
  },0);
}
/* Cobro semanal total (company-wide) */
function weeklyAdvanceCharge(adelantos, reps){ return advanceChargeFor(adelantos, reps, "Todos"); }
/* Etiqueta corta de una semana: "1–7 jun" */
function weekLabel(k){
  if(!k) return "—";
  var a=new Date(k+"T12:00:00"); var b=new Date(a); b.setDate(b.getDate()+6);
  var M=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return a.getDate()+"–"+b.getDate()+" "+M[b.getMonth()];
}
/* Separa trabajos en "semanas anteriores" (PAGABLES — la empresa paga a internos con una
   semana de atraso) y "semana en curso" (aún no pagable). Semana = lunes→domingo. */
function splitPayableWeeks(reps, effFn){
  var curMon = mondayOf(new Date());
  function amt(r){ return effFn ? effFn(r) : (parseFloat(r.total||0)||0); }
  var prev={reps:[],fact:0,cob:0,pndCount:0}, cur={reps:[],monto:0,cob:0};
  (reps||[]).forEach(function(r){
    var d=new Date((r.fecha||"")+"T12:00:00");
    var isCur = !isNaN(d.getTime()) && mondayOf(d)>=curMon;
    if(isCur){ cur.reps.push(r); cur.monto+=amt(r); if(r.paid) cur.cob+=amt(r); }
    else { prev.reps.push(r); prev.fact+=amt(r); if(r.paid) prev.cob+=amt(r); else if(amt(r)>0) prev.pndCount++; }
  });
  prev.porCobrar = prev.fact - prev.cob;
  return {prev:prev, cur:cur, curMon:curMon};
}
/* Spanish number-to-words (integers up to 999,999) for the contract */
function numToWordsEs(num){
  num=Math.floor(Math.abs(num||0)); if(num===0) return "cero";
  var U=["","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve","veinte"];
  var D=["","","","treinta","cuarenta","cincuenta","sesenta","setenta","ochenta","noventa"];
  var H=["","ciento","doscientos","trescientos","cuatrocientos","quinientos","seiscientos","setecientos","ochocientos","novecientos"];
  function b100(n){ if(n<=20) return U[n]; if(n<30) return "veinti"+U[n-20]; var d=Math.floor(n/10),u=n%10; return D[d]+(u?" y "+U[u]:""); }
  function b1000(n){ if(n===100) return "cien"; var c=Math.floor(n/100),r=n%100; return (c?H[c]:"")+(c&&r?" ":"")+(r?b100(r):""); }
  if(num<1000) return b1000(num);
  var miles=Math.floor(num/1000),resto=num%1000;
  return ((miles===1?"mil":b1000(miles)+" mil")+(resto?" "+b1000(resto):"")).trim();
}
var ADV_MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function fmtLongDateEs(ds){ if(!ds) return "____"; var d=new Date(ds+"T12:00:00"); if(isNaN(d.getTime())) return ds; return d.getDate()+" de "+ADV_MESES[d.getMonth()]+" de "+d.getFullYear(); }
function fmtDMY(ds){ if(!ds) return "__/__/____"; var p=ds.split("-"); return p.length===3?p[2]+"/"+p[1]+"/"+p[0]:ds; }
function payoffDateEs(ds,cuotas){ var d=new Date((ds||todayStr())+"T12:00:00"); d.setDate(d.getDate()+7*(cuotas||1)); return fmtLongDateEs(d.toISOString().slice(0,10)); }
function buildContractText(adv){
  var monto=parseFloat(adv.monto||0)||0, fecha=adv.fechaDeposito||todayStr();
  return [
    "Guatemala, "+fmtLongDateEs(fecha)+".","",
    "Por este medio, yo, "+(adv.vendorName||"________")+", quien se identifica con el Documento Personal de Identificación número "+(adv.dpiNumber||"____ _____ ____")+" extendido por el Registro Nacional de las Personas de la República de Guatemala, quien actúa en su calidad de PERSONA INDIVIDUAL y quien es proveedor activo de Spacio AM, solicito y acepto un adelanto de pago conforme a las condiciones detalladas a continuación.","",
    "1.  Monto total solicitado: Q. "+monto.toLocaleString("es-GT")+"  ("+numToWordsEs(monto)+" quetzales exactos)",
    "2.  Fecha del depósito: "+fmtDMY(fecha),
    "3.  Número de cuotas: "+(adv.cuotas||"—"),
    "4.  Periodicidad del descuento: Semanal  (Q"+(adv.cobroSemanal||0)+" por semana)",
    "5.  Fecha de finalización del pago: "+payoffDateEs(fecha,adv.cuotas)+".","",
    "Este adelanto será descontado automáticamente de mi pago en las fechas de pago correspondientes, conforme al calendario laboral. Autorizo expresamente a Spacio AM a realizar dichos descuentos sin necesidad de autorización adicional.","",
    "Declaro haber recibido el monto indicado y me comprometo a devolverlo en su totalidad bajo las condiciones acordadas, incluso en caso de terminación anticipada de mi relación con Spacio AM. En dicho caso, acepto que el saldo pendiente podrá descontarse de cualquier pago pendiente.","",
    "Reconozco que este adelanto no constituye un derecho adquirido ni recurrente, y que es una excepción otorgada de buena fe por la empresa."
  ].join("\n");
}
function printContract(adv){
  var cons = advContracts(adv);
  function depHtml(dep){
    if(!dep) return "";
    var src=dep.url?dep.url:dep.data;
    if((dep.type||"").indexOf("image/")===0) return "<div class='dep'><div class='dep-t'>Comprobante de depósito</div><img src='"+src+"'/></div>";
    return "<div class='dep'><div class='dep-t'>Comprobante de depósito</div><div class='dep-f'>📄 "+String(dep.name||"Documento adjunto").replace(/</g,"&lt;")+"</div></div>";
  }
  var sections = cons.map(function(c,i){
    var av=Object.assign({vendorName:adv.vendorName},c);
    var txt=c.contractText||buildContractText(av);
    var body=txt.split("\n").map(function(l){ return l.trim()? "<p style='margin:0 0 10px'>"+l.replace(/</g,"&lt;")+"</p>" : "<div style='height:8px'></div>"; }).join("");
    var head=cons.length>1?"<div class='cn'>Contrato "+(i+1)+" · Q"+(c.monto||0).toLocaleString("es-GT")+"</div>":"";
    var firma=c.firma?"<img class='fsig' src='"+c.firma+"'/>":"";
    return "<section class='c'>"+head+"<h1>SOLICITUD Y RECIBO DE ADELANTO DE PAGO</h1>"+body+firma+"<div class='sig'>"+(adv.vendorName||"")+"</div>"+depHtml(c.comprobanteDeposito)+"</section>";
  }).join("<div class='pb'></div>");
  var html = "<html><head><meta charset='UTF-8'><title>Adelanto — "+(adv.vendorName||"")+"</title>"
    + "<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 28px;color:#3E3F3F;line-height:1.65}h1{font-size:22px;font-weight:400;letter-spacing:.04em;text-align:center;margin:0 0 30px}p{font-size:14px}.cn{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#E9826A;font-weight:700;margin-bottom:14px}.fsig{max-height:60px;display:block;margin:54px 0 2px}.sig{margin-top:6px;border-top:1px solid #3E3F3F;width:300px;padding-top:6px;font-size:13px}.dep{margin-top:28px;border-top:1px solid #D8D4CE;padding-top:14px}.dep-t{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#938B8A;font-weight:700;margin-bottom:10px}.dep img{max-width:100%;border:1px solid #D8D4CE;border-radius:8px}.dep-f{font-size:13px;background:#F5F3F0;border:1px solid #D8D4CE;border-radius:8px;padding:12px 14px}.pb{page-break-after:always}@media print{body{margin:20px}}</style>"
    + "</head><body>"+sections+"</body></html>";
  var w=window.open("","_blank","width=820,height=900"); if(!w) return; w.document.write(html); w.document.close();
}

/* ═════════════════════════════════════════════════════════════════
   COMPROBANTES DE PAGO — recibos de pago (lote e individual)
   Se guardan como historial: localStorage "sam_pagos" + saveConfig "pagos".
   Cada comprobante agrupa por técnico, refleja el descuento de adelanto
   (cuota semanal) y admite un soporte adjunto (imagen/PDF de la transferencia,
   subido por el administrador después del pago).
   ═════════════════════════════════════════════════════════════════ */
function pg_load(){ try{var v=localStorage.getItem("sam_pagos");return v?JSON.parse(v):null;}catch(e){return null;} }
function pg_persist(list){
  try{ localStorage.setItem("sam_pagos", JSON.stringify(list)); }catch(e){}
  if(!IS_CLAUDE_SANDBOX){
    try{
      /* Nunca mandamos el base64 del soporte a la config (desborda la celda del Sheet).
         En la nube el soporte vive en Drive como URL; local guarda el base64 completo. */
      var lean=(list||[]).map(function(p){
        if(p&&p.soporte&&p.soporte.data&&String(p.soporte.data).indexOf("data:")===0){
          var s={name:p.soporte.name,type:p.soporte.type}; if(p.soporte.url)s.url=p.soporte.url;
          return Object.assign({},p,{soporte:s});
        }
        return p;
      });
      apiCall("saveConfig",{key:"pagos",value:lean});
    }catch(e){}
  }
}
function pgMoney(n){ return "Q"+(Math.round(((n||0))*100)/100).toLocaleString("es-GT"); }
function pgFolio(list){
  var yr=new Date().getFullYear();
  var seq=((list||[]).filter(function(p){return String(p.folio||"").indexOf("CP-"+yr)===0;}).length)+1;
  return "CP-"+yr+"-"+String(seq).padStart(4,"0");
}
/* Monto pagable de un trabajo (usa la auto-tarifa como respaldo, igual que el dashboard) */
function pgEffTotal(r, vendors){
  if(isDanos(r.categoria)) return 0;
  var t=parseFloat(r.total||0);
  if(t>0) return t;
  var at=autoTarifa(r.reportadoPor||"",vendors||[]);
  return at.tarifa?(parseFloat(at.tarifa)||0):0;
}
/* Construye un comprobante a partir de los trabajos recién marcados como pagados. */
function buildComprobante(repsPaid, opts){
  opts=opts||{};
  var vendors=opts.vendors||[], adelantos=opts.adelantos||[], allReps=opts.allReps||repsPaid||[];
  var groups={};
  (repsPaid||[]).forEach(function(r){
    var v=(vendors).find(function(x){return repMatchesVendor(r,x);});
    var email=v?(v.email||vendorEmailSet(v)[0]||(r.reportadoPor||"")):(r.reportadoPor||"");
    var name =v?vendorDisplay(v):(r.reportadoPor||"—");
    var key=(email||name).toLowerCase();
    if(!groups[key]) groups[key]={vendorEmail:email,vendorName:name,trabajos:[],subtotal:0};
    var monto=pgEffTotal(r,vendors);
    groups[key].trabajos.push({repId:r.id,propiedad:r.propiedad||"—",fecha:r.fecha||"",categoria:r.categoria||"",descripcion:r.descripcion||"",monto:monto,pagadoPor:r.pagadoPor||""});
    groups[key].subtotal+=monto;
  });
  var tecnicos=Object.keys(groups).map(function(k){
    var g=groups[k];
    /* Descuento de adelanto: cuota semanal vigente del técnico (solo en pagos de lote/semana). */
    var desc=opts.applyAdelanto ? advanceChargeFor(adelantos, allReps, g.vendorEmail) : 0;
    desc=Math.min(desc, g.subtotal);
    g.trabajos.sort(function(a,b){return (a.fecha||"").localeCompare(b.fecha||"");});
    return Object.assign({},g,{adelanto:desc, neto:Math.max(0,g.subtotal-desc)});
  }).sort(function(a,b){return (a.vendorName||"").localeCompare(b.vendorName||"");});
  var fechas=(repsPaid||[]).map(function(r){return r.fecha;}).filter(Boolean).sort();
  var totalBruto=tecnicos.reduce(function(s,t){return s+t.subtotal;},0);
  var totalDesc =tecnicos.reduce(function(s,t){return s+t.adelanto;},0);
  return {
    id:"pg_"+Date.now()+"_"+Math.floor(Math.random()*1000),
    folio: opts.folio||("CP-"+Date.now().toString(36).toUpperCase().slice(-6)),
    createdAt: Date.now(),
    fechaPago: todayStr(),
    tipo: opts.tipo||"lote",
    generadoPor: opts.generadoPor||"Admin",
    rangoDesde: opts.rangoDesde||(fechas[0]||""),
    rangoHasta: opts.rangoHasta||(fechas[fechas.length-1]||""),
    tecnicos: tecnicos,
    totalBruto: totalBruto,
    totalDescuento: totalDesc,
    totalNeto: Math.max(0, totalBruto-totalDesc),
    soporte: null,
  };
}
/* Recibo imprimible / PDF (window.print). focusEmail limita a un solo técnico. */
function printComprobante(pago, company, focusEmail){
  if(!pago) return;
  function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];}); }
  var coName=(company&&company.name)?company.name:"Spacio AM S.A.";
  var coNit =(company&&company.nit)?company.nit:"118287796";
  var techs=(pago.tecnicos||[]).filter(function(t){return !focusEmail || t.vendorEmail===focusEmail;});
  var multi=techs.length>1;
  var gBruto=techs.reduce(function(s,t){return s+t.subtotal;},0);
  var gDesc =techs.reduce(function(s,t){return s+t.adelanto;},0);
  var gNeto =techs.reduce(function(s,t){return s+t.neto;},0);
  var rango = pago.rangoDesde||pago.rangoHasta
    ? (fmtDate(pago.rangoDesde)+(pago.rangoHasta&&pago.rangoHasta!==pago.rangoDesde?" — "+fmtDate(pago.rangoHasta):""))
    : "—";
  var sections=techs.map(function(t){
    var rows=t.trabajos.map(function(w){
      return "<tr><td class='dt'>"+fmtDate(w.fecha)+"</td><td>"+esc(w.propiedad)+"<div class='cat'>"+esc(w.categoria)+"</div></td><td class='num'>"+pgMoney(w.monto)+"</td></tr>";
    }).join("");
    var descRow=t.adelanto>0?"<tr class='disc'><td colspan='2'>Descuento — adelanto (cuota semanal)</td><td class='num'>−"+pgMoney(t.adelanto)+"</td></tr>":"";
    return "<section class='grp'>"
      + (multi?"<h2>"+esc(t.vendorName)+"</h2>":"")
      + "<table><thead><tr><th>Fecha</th><th>Trabajo</th><th class='num'>Monto</th></tr></thead><tbody>"+rows+"</tbody>"
      + "<tfoot>"
      + "<tr class='sub'><td colspan='2'>Subtotal</td><td class='num'>"+pgMoney(t.subtotal)+"</td></tr>"
      + descRow
      + "<tr class='net'><td colspan='2'>Neto a pagar</td><td class='num'>"+pgMoney(t.neto)+"</td></tr>"
      + "</tfoot></table></section>";
  }).join("");
  var grand = multi ? "<div class='grand'>"
      + "<div class='gr'><span>Total bruto</span><b>"+pgMoney(gBruto)+"</b></div>"
      + (gDesc>0?"<div class='gr disc'><span>Descuentos por adelanto</span><b>−"+pgMoney(gDesc)+"</b></div>":"")
      + "<div class='gr net'><span>Total neto pagado</span><b>"+pgMoney(gNeto)+"</b></div>"
      + "</div>" : "";
  var soporte="";
  if(pago.soporte&&(pago.soporte.url||pago.soporte.data)){
    var sopSrc=pago.soporte.url?driveThumb(pago.soporte.url,1400):pago.soporte.data;
    if((pago.soporte.type||"").indexOf("image/")===0){
      soporte="<div class='sop'><div class='sop-t'>Comprobante de transferencia</div><img src='"+sopSrc+"' alt='soporte'/></div>";
    } else {
      soporte="<div class='sop'><div class='sop-t'>Comprobante de transferencia</div><div class='sop-f'>📄 "+esc(pago.soporte.name||"Documento adjunto (PDF)")+"</div></div>";
    }
  }
  var css="*{box-sizing:border-box}body{font-family:'Montserrat',-apple-system,Segoe UI,Roboto,sans-serif;color:#3E3F3F;max-width:760px;margin:32px auto;padding:0 34px;-webkit-font-smoothing:antialiased}"
    +".hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #D8D4CE;padding-bottom:20px;margin-bottom:22px}"
    +".hd img{height:56px;width:auto}"
    +".co{text-align:right;font-size:11px;color:#938B8A;line-height:1.7;letter-spacing:.04em}.co b{color:#3E3F3F;font-size:13px;letter-spacing:.02em}"
    +"h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;letter-spacing:.01em;margin:0 0 2px}"
    +".elig{font-size:9.5px;letter-spacing:.28em;text-transform:uppercase;color:#E9826A;font-weight:700;margin-bottom:10px}"
    +".meta{display:flex;flex-wrap:wrap;gap:26px;margin:0 0 26px;font-size:11px}"
    +".meta div span{display:block;font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:#938B8A;font-weight:700;margin-bottom:3px}"
    +".meta div b{font-size:13px;font-weight:600;color:#3E3F3F}"
    +".grp{margin-bottom:22px}.grp h2{font-family:Georgia,serif;font-weight:400;font-size:17px;margin:0 0 8px;color:#3E3F3F}"
    +"table{width:100%;border-collapse:collapse;font-size:12px}"
    +"thead th{text-align:left;font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:#938B8A;font-weight:700;padding:0 0 7px;border-bottom:1px solid #D8D4CE}"
    +"tbody td{padding:9px 0;border-bottom:1px solid #EAE6E0;vertical-align:top}"
    +".dt{color:#938B8A;white-space:nowrap;width:78px}.cat{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#938B8A;margin-top:3px}"
    +".num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}"
    +"tfoot td{padding:7px 0;font-size:12px}tfoot .sub td{color:#938B8A;padding-top:11px}"
    +"tfoot .disc td{color:#E9826A}tfoot .net td{font-weight:700;font-size:13.5px;border-top:1.5px solid #3E3F3F;padding-top:9px}"
    +".grand{margin-top:8px;border-top:2px solid #3E3F3F;padding-top:12px}"
    +".grand .gr{display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;color:#938B8A}.grand .gr b{color:#3E3F3F;font-variant-numeric:tabular-nums}"
    +".grand .disc b{color:#E9826A}.grand .net{font-size:15px;color:#3E3F3F;font-weight:700}.grand .net b{color:#3d6b52}"
    +".sop{margin-top:28px;border-top:1px solid #D8D4CE;padding-top:16px}.sop-t{font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:#938B8A;font-weight:700;margin-bottom:10px}"
    +".sop img{max-width:100%;border:1px solid #D8D4CE;border-radius:10px}.sop-f{font-size:12px;color:#3E3F3F;background:#F5F3F0;border:1px solid #D8D4CE;border-radius:8px;padding:12px 14px}"
    +".ft{margin-top:36px;border-top:1px solid #EAE6E0;padding-top:12px;font-size:9.5px;color:#B8B2AC;text-align:center;letter-spacing:.04em}"
    +"@media print{body{margin:0;padding:20px 26px}@page{margin:14mm}}";
  var html="<html><head><meta charset='UTF-8'><title>Comprobante "+esc(pago.folio)+"</title>"
    + "<link href='https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap' rel='stylesheet'>"
    + "<style>"+css+"</style></head><body>"
    + "<div class='hd'><img src='"+LOGO_STAMP+"' alt='Spacio AM'/><div class='co'><b>"+esc(coName)+"</b><br>NIT: "+esc(coNit)+"<br>hola@spacioam.com<br>+502 5690 9499</div></div>"
    + "<div class='elig'>Comprobante de pago"+(pago.tipo==="individual"?" · individual":"")+"</div>"
    + "<h1>"+(focusEmail&&techs[0]?esc(techs[0].vendorName):"Pago a técnicos")+"</h1>"
    + "<div class='meta'>"
    +   "<div><span>Folio</span><b>"+esc(pago.folio)+"</b></div>"
    +   "<div><span>Fecha de pago</span><b>"+fmtDate(pago.fechaPago)+"</b></div>"
    +   "<div><span>Período</span><b>"+rango+"</b></div>"
    +   "<div><span>Trabajos</span><b>"+techs.reduce(function(s,t){return s+t.trabajos.length;},0)+"</b></div>"
    + "</div>"
    + sections
    + grand
    + soporte
    + "<div class='ft'>Spacio AM · Comprobante generado el "+new Date().toLocaleString("es-GT")+" · Hay espacios en donde sueñas con volver a despertar.</div>"
    + "</body></html>";
  var w=window.open("","_blank","width=860,height=920"); if(!w) return; w.document.write(html); w.document.close();
  setTimeout(function(){ try{ w.focus(); }catch(_){} }, 200);
}

/* ─── Historial de pagos — lista de comprobantes (admin y técnico) */
function PagosHistory({pagos, vendors, company, isAdmin, meEmails, onSvPagos}) {
  const [sel,   setSel]   = useState(null);
  const [fTipo, setFTipo] = useState("Todos");
  var mine=(meEmails||[]).map(function(e){return (e||"").toLowerCase().trim();}).filter(Boolean);
  var list=(pagos||[]).slice().sort(function(a,b){return (b.createdAt||0)-(a.createdAt||0);});
  if(!isAdmin){
    list=list.filter(function(p){return (p.tecnicos||[]).some(function(t){return mine.indexOf((t.vendorEmail||"").toLowerCase().trim())>=0;});});
  }
  if(fTipo!=="Todos") list=list.filter(function(p){return p.tipo===fTipo;});
  var focusEmail=(!isAdmin&&mine.length)?mine[0]:null;

  function techBadges(p){
    var ts=isAdmin?(p.tecnicos||[]):(p.tecnicos||[]).filter(function(t){return mine.indexOf((t.vendorEmail||"").toLowerCase().trim())>=0;});
    return ts.map(function(t){return t.vendorName;});
  }
  function shownNeto(p){
    if(isAdmin) return p.totalNeto;
    return (p.tecnicos||[]).filter(function(t){return mine.indexOf((t.vendorEmail||"").toLowerCase().trim())>=0;}).reduce(function(s,t){return s+t.neto;},0);
  }

  var LBL={fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".13em",textTransform:"uppercase",display:"block",marginBottom:5};
  var IS={border:"1.5px solid "+C.gray,borderRadius:9,padding:"7px 10px",fontSize:12.5,fontFamily:"Montserrat,sans-serif",outline:"none",background:"#fff",color:C.black,cursor:"pointer"};

  return (
    <div style={{padding:"22px 16px 80px",maxWidth:860,margin:"0 auto",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:18}}>
        <div>
          <div style={{fontSize:19,fontWeight:600,color:C.black,letterSpacing:".01em"}}>Historial de pagos</div>
          <div style={{fontSize:12,color:C.earth,marginTop:3}}>{isAdmin?"Comprobantes generados al marcar trabajos como pagados.":"Tus comprobantes de pago. Puedes descargarlos o imprimirlos."}</div>
        </div>
        <div>
          <span style={LBL}>Tipo</span>
          <select value={fTipo} onChange={function(e){setFTipo(e.target.value);}} style={IS}>
            <option value="Todos">Todos</option>
            <option value="lote">Pago en lote</option>
            <option value="individual">Pago individual</option>
          </select>
        </div>
      </div>

      {list.length===0
        ? <div style={{textAlign:"center",padding:"56px 20px",color:C.earth,fontSize:13.5,background:"#fff",borderRadius:16,border:"1px solid "+C.gray}}>Aún no hay comprobantes de pago.{isAdmin?" Se generará uno automáticamente cada vez que marques trabajos como pagados.":""}</div>
        : <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {list.map(function(p){
              var techs=techBadges(p);
              return (
                <div key={p.id} className="rh" onClick={function(){setSel(p);}} style={{background:"#fff",borderRadius:14,border:"1px solid "+C.gray,padding:"15px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:16,transition:"box-shadow .18s",boxShadow:"0 4px 16px rgba(62,63,63,0.05)"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap",marginBottom:5}}>
                      <span style={{fontSize:13.5,fontWeight:700,color:C.black,fontVariantNumeric:"tabular-nums"}}>{p.folio}</span>
                      <span style={{fontSize:9,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",padding:"2px 8px",borderRadius:100,background:p.tipo==="individual"?"#EDEAE3":"#EDF5EF",color:p.tipo==="individual"?"#7a7050":C.green}}>{p.tipo==="individual"?"Individual":"Lote"}</span>
                    </div>
                    <div style={{fontSize:12,color:C.earth}}>{fmtDate(p.fechaPago)} · {techs.length} técnico{techs.length!==1?"s":""} · {techs.slice(0,3).join(", ")}{techs.length>3?" +"+(techs.length-3):""}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:16,fontWeight:700,color:C.black,fontVariantNumeric:"tabular-nums"}}>{pgMoney(shownNeto(p))}</div>
                    <div style={{fontSize:10.5,color:C.earth,marginTop:2}}>neto{p.soporte?" · 📎 soporte":""}</div>
                  </div>
                  <Icon name="arrowRight" size={16} stroke={C.gray}/>
                </div>
              );
            })}
          </div>}

      {sel&&<PagoComprobanteModal pago={sel} company={company} isAdmin={isAdmin} focusEmail={focusEmail} onClose={function(){setSel(null);}} onSvPagos={onSvPagos} pagos={pagos}/>}
    </div>
  );
}

/* ═══ Comprobante como imagen / PDF — compartible por WhatsApp ═══
   Se rehace un "card" limpio y autocontenido y se rasteriza con html2canvas.
   El adjunto de transferencia NO se incluye aquí (evita imágenes de Drive
   que ensucian el canvas por CORS); ese soporte se comparte por separado. */
function pgEsc(s){ return String(s==null?"":s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];}); }
function pgComprobanteCardHTML(pago, company, focusEmail){
  var coName=(company&&company.name)?company.name:"Spacio AM S.A.";
  var coNit =(company&&company.nit)?company.nit:"118287796";
  var techs=(pago.tecnicos||[]).filter(function(t){return !focusEmail||t.vendorEmail===focusEmail;});
  var multi=techs.length>1;
  var gBruto=techs.reduce(function(s,t){return s+t.subtotal;},0);
  var gDesc =techs.reduce(function(s,t){return s+t.adelanto;},0);
  var gNeto =techs.reduce(function(s,t){return s+t.neto;},0);
  var rango=(pago.rangoDesde||pago.rangoHasta)?(fmtDate(pago.rangoDesde)+(pago.rangoHasta&&pago.rangoHasta!==pago.rangoDesde?" — "+fmtDate(pago.rangoHasta):"")):"—";
  var title=focusEmail&&techs[0]?techs[0].vendorName:"Pago a técnicos";
  var meta=[["Folio",pago.folio],["Fecha de pago",fmtDate(pago.fechaPago)],["Período",rango],["Tipo",pago.tipo==="individual"?"Individual":"Lote"]];
  var metaHtml=meta.map(function(m){return "<div><div style=\"font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#938B8A;margin-bottom:3px\">"+pgEsc(m[0])+"</div><div style=\"font-size:13px;font-weight:600;color:#3E3F3F\">"+pgEsc(m[1])+"</div></div>";}).join("");
  var groups=techs.map(function(t){
    var rows=t.trabajos.map(function(w){
      return "<div style=\"display:flex;justify-content:space-between;gap:12px;padding:9px 14px;border-bottom:1px solid #EFEBE5\"><div><div style=\"font-size:12.5px;font-weight:600;color:#3E3F3F\">"+pgEsc(w.propiedad)+"</div><div style=\"font-size:10px;color:#938B8A;margin-top:2px\">"+fmtDate(w.fecha)+" · "+pgEsc(w.categoria)+"</div></div><div style=\"font-size:12.5px;font-weight:600;color:#3E3F3F;white-space:nowrap\">"+pgMoney(w.monto)+"</div></div>";
    }).join("");
    var desc=t.adelanto>0?"<div style=\"display:flex;justify-content:space-between;font-size:11.5px;color:#E9826A;padding:2px 0\"><span>Descuento — adelanto</span><b>−"+pgMoney(t.adelanto)+"</b></div>":"";
    return "<div style=\"margin-bottom:16px\">"
      +(multi?"<div style=\"font-size:15px;font-weight:600;color:#3E3F3F;font-family:Georgia,serif;margin-bottom:6px\">"+pgEsc(t.vendorName)+"</div>":"")
      +"<div style=\"border:1px solid #E4DFD8;border-radius:12px;overflow:hidden\">"+rows
      +"<div style=\"padding:10px 14px;background:#F7F5F1\">"
      +"<div style=\"display:flex;justify-content:space-between;font-size:11.5px;color:#938B8A;padding:2px 0\"><span>Subtotal</span><b style=\"color:#3E3F3F\">"+pgMoney(t.subtotal)+"</b></div>"
      +desc
      +"<div style=\"display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#3E3F3F;padding:6px 0 0;margin-top:4px;border-top:1.5px solid #E4DFD8\"><span>Neto a pagar</span><b style=\"color:#3d6b52\">"+pgMoney(t.neto)+"</b></div>"
      +"</div></div></div>";
  }).join("");
  var grand=multi?"<div style=\"border-top:2px solid #3E3F3F;padding-top:12px;margin-top:4px\">"
      +"<div style=\"display:flex;justify-content:space-between;font-size:12px;color:#938B8A;padding:3px 0\"><span>Total bruto</span><b style=\"color:#3E3F3F\">"+pgMoney(gBruto)+"</b></div>"
      +(gDesc>0?"<div style=\"display:flex;justify-content:space-between;font-size:12px;color:#E9826A;padding:3px 0\"><span>Descuentos por adelanto</span><b>−"+pgMoney(gDesc)+"</b></div>":"")
      +"<div style=\"display:flex;justify-content:space-between;font-size:16px;font-weight:700;color:#3E3F3F;padding:6px 0 0\"><span>Total neto pagado</span><b style=\"color:#3d6b52\">"+pgMoney(gNeto)+"</b></div>"
      +"</div>":"";
  return "<div style=\"width:760px;box-sizing:border-box;background:#fff;padding:40px 44px;font-family:Montserrat,Helvetica,Arial,sans-serif;color:#3E3F3F\">"
    +"<div style=\"display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #E4DFD8;padding-bottom:20px;margin-bottom:22px\">"
    +"<img src=\""+LOGO_STAMP+"\" style=\"width:54px;height:54px;object-fit:contain\"/>"
    +"<div style=\"text-align:right;font-size:10.5px;line-height:1.6;color:#938B8A\"><b style=\"color:#3E3F3F;font-size:12px\">"+pgEsc(coName)+"</b><br>NIT: "+pgEsc(coNit)+"<br>hola@spacioam.com<br>+502 5690 9499</div>"
    +"</div>"
    +"<div style=\"font-size:9.5px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:#E9826A;margin-bottom:8px\">Comprobante de pago"+(pago.tipo==="individual"?" · individual":"")+"</div>"
    +"<div style=\"font-size:26px;font-weight:600;font-family:Georgia,serif;margin-bottom:4px\">"+pgEsc(title)+"</div>"
    +"<div style=\"font-size:12px;color:#938B8A;margin-bottom:22px\">"+pgEsc(pago.folio)+" · "+fmtDate(pago.fechaPago)+"</div>"
    +"<div style=\"display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px\">"+metaHtml+"</div>"
    +groups+grand
    +"<div style=\"margin-top:26px;border-top:1px solid #E4DFD8;padding-top:12px;font-size:9px;color:#B8B2AC;text-align:center;letter-spacing:.04em\">Spacio AM · Generado el "+new Date().toLocaleString("es-GT")+" · Hay espacios en donde sueñas con volver a despertar.</div>"
    +"</div>";
}
async function pgRenderCanvas(pago, company, focusEmail){
  if(!window.html2canvas) throw new Error("No cargó la librería de imagen. Recarga la página e intenta de nuevo.");
  var host=document.createElement("div");
  host.style.cssText="position:fixed;left:-10000px;top:0;z-index:-1;background:#fff";
  host.innerHTML=pgComprobanteCardHTML(pago, company, focusEmail);
  document.body.appendChild(host);
  var card=host.firstChild;
  await new Promise(function(r){setTimeout(r,90);});
  try{
    return await window.html2canvas(card,{scale:2,backgroundColor:"#ffffff",useCORS:true,logging:false,windowWidth:820});
  } finally { try{document.body.removeChild(host);}catch(_){} }
}
function pgFileBase(pago, focusEmail){
  var techs=(pago.tecnicos||[]).filter(function(t){return !focusEmail||t.vendorEmail===focusEmail;});
  var who=String(focusEmail&&techs[0]?techs[0].vendorName:"tecnicos").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\w\-]+/g,"_");
  return "Comprobante_"+(pago.folio||"pago")+"_"+who;
}
function pgDownload(blob, filename){
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},5000);
  return Promise.resolve();
}
function pgShareOrDownload(blob, filename, title){
  return (async function(){
    try{
      var file=new File([blob], filename, {type:blob.type});
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:title, text:title});
        return;
      }
    }catch(e){ if(e&&e.name==="AbortError") return; }
    return pgDownload(blob, filename);
  })();
}
/* mode: "image" (PNG → compartir), "imgdl" (PNG → descargar), "pdf" (PDF → compartir/descargar) */
function shareComprobante(pago, company, focusEmail, mode, setBusy){
  if(setBusy) setBusy(mode);
  var title="Comprobante de pago "+(pago.folio||"");
  pgRenderCanvas(pago, company, focusEmail).then(function(canvas){
    var base=pgFileBase(pago, focusEmail);
    if(mode==="pdf"){
      var jsPDFctor=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
      if(!jsPDFctor) throw new Error("No cargó la librería de PDF. Recarga la página e intenta de nuevo.");
      var imgData=canvas.toDataURL("image/jpeg",0.92);
      var pw=595.28, ph=pw*canvas.height/canvas.width;
      var pdf=new jsPDFctor({orientation:"p",unit:"pt",format:[pw,ph]});
      pdf.addImage(imgData,"JPEG",0,0,pw,ph);
      return pgShareOrDownload(pdf.output("blob"), base+".pdf", title);
    }
    return new Promise(function(res){
      canvas.toBlob(function(blob){
        (mode==="imgdl"?pgDownload(blob,base+".png"):pgShareOrDownload(blob,base+".png",title)).then(res);
      },"image/png");
    });
  }).catch(function(e){
    alert("No se pudo generar el comprobante: "+((e&&e.message)||"error"));
  }).then(function(){ if(setBusy) setBusy(""); });
}

/* ─── Modal de detalle de un comprobante */
function PagoComprobanteModal({pago, company, isAdmin, focusEmail, onClose, onSvPagos, pagos}) {
  const supRef=useRef(null);
  const [upBusy,setUpBusy]=useState(false);
  const [shareBusy,setShareBusy]=useState("");
  var techs=(pago.tecnicos||[]).filter(function(t){return !focusEmail || t.vendorEmail===focusEmail;});
  var gBruto=techs.reduce(function(s,t){return s+t.subtotal;},0);
  var gDesc =techs.reduce(function(s,t){return s+t.adelanto;},0);
  var gNeto =techs.reduce(function(s,t){return s+t.neto;},0);
  var multi=techs.length>1;
  var rango=(pago.rangoDesde||pago.rangoHasta)?(fmtDate(pago.rangoDesde)+(pago.rangoHasta&&pago.rangoHasta!==pago.rangoDesde?" — "+fmtDate(pago.rangoHasta):"")):"—";

  function saveSoporte(sop){
    var next=(pagos||[]).map(function(p){return p.id===pago.id?Object.assign({},p,{soporte:sop}):p;});
    if(onSvPagos) onSvPagos(next);
  }
  function onAddSoporte(file){
    var r=new FileReader();
    r.onload=function(ev){
      var dataUrl=ev.target.result;
      /* En demo (sandbox) guardamos el base64. En vivo lo subimos a Drive y guardamos solo la URL,
         para que persista y sea visible por el técnico tras recargar. */
      if(IS_CLAUDE_SANDBOX){ saveSoporte({name:file.name,type:file.type,data:dataUrl}); return; }
      setUpBusy(true);
      uploadMedia(dataUrl, file.name, file.type, "comprobantes").then(function(url){
        saveSoporte({name:file.name,type:file.type,url:url});
      }).catch(function(e){
        saveSoporte({name:file.name,type:file.type,data:dataUrl});
        alert("El comprobante se guardó, pero no se pudo subir a la nube ("+((e&&e.message)||"error de red")+"). Con buena conexión, quítalo y vuelve a adjuntarlo para que el técnico pueda verlo.");
      }).then(function(){ setUpBusy(false); });
    };
    r.readAsDataURL(file);
  }

  var META=[["Folio",pago.folio],["Fecha de pago",fmtDate(pago.fechaPago)],["Período",rango],["Tipo",pago.tipo==="individual"?"Individual":"Lote"]];

  return (
    <Overlay onClick={onClose}>
      <div onClick={function(e){e.stopPropagation();}} style={{background:"#fff",borderRadius:22,width:"min(680px,94vw)",maxHeight:"90vh",overflow:"auto",boxShadow:"0 28px 80px rgba(62,63,63,0.16)",fontFamily:"Montserrat,sans-serif"}}>
        {/* header */}
        <div style={{padding:"22px 26px 18px",borderBottom:"1px solid "+C.gray,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:14,position:"sticky",top:0,background:"#fff",zIndex:2}}>
          <div>
            <div style={{fontSize:9.5,fontWeight:700,letterSpacing:".26em",textTransform:"uppercase",color:C.peach,marginBottom:6}}>Comprobante de pago</div>
            <div style={{fontSize:22,fontWeight:600,color:C.black,fontFamily:"Georgia,serif"}}>{focusEmail&&techs[0]?techs[0].vendorName:"Pago a técnicos"}</div>
            <div style={{fontSize:12,color:C.earth,marginTop:4,fontVariantNumeric:"tabular-nums"}}>{pago.folio} · {fmtDate(pago.fechaPago)}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:24,color:C.earth,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
        </div>

        <div style={{padding:"20px 26px 26px"}}>
          {/* meta chips */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:12,marginBottom:22}}>
            {META.map(function(m,i){return (
              <div key={i}>
                <div style={{fontSize:8.5,fontWeight:700,letterSpacing:".18em",textTransform:"uppercase",color:C.earth,marginBottom:3}}>{m[0]}</div>
                <div style={{fontSize:13,fontWeight:600,color:C.black}}>{m[1]}</div>
              </div>
            );})}
          </div>

          {/* per-technician breakdown */}
          {techs.map(function(t,ti){return (
            <div key={ti} style={{marginBottom:18}}>
              {multi&&<div style={{fontSize:15,fontWeight:600,color:C.black,fontFamily:"Georgia,serif",marginBottom:6}}>{t.vendorName}</div>}
              <div style={{border:"1px solid "+C.gray,borderRadius:12,overflow:"hidden"}}>
                {t.trabajos.map(function(w,wi){return (
                  <div key={wi} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,padding:"11px 14px",borderBottom:"1px solid "+C.line,alignItems:"start"}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.black}}>{w.propiedad}</div>
                      <div style={{fontSize:10.5,color:C.earth,marginTop:2,letterSpacing:".04em"}}>{fmtDate(w.fecha)} · {w.categoria}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:C.black,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{pgMoney(w.monto)}</div>
                  </div>
                );})}
                <div style={{padding:"10px 14px",background:C.surfaceWarm}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.earth,padding:"2px 0"}}><span>Subtotal</span><b style={{color:C.black,fontVariantNumeric:"tabular-nums"}}>{pgMoney(t.subtotal)}</b></div>
                  {t.adelanto>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.peach,padding:"2px 0"}}><span>Descuento — adelanto</span><b style={{fontVariantNumeric:"tabular-nums"}}>−{pgMoney(t.adelanto)}</b></div>}
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13.5,fontWeight:700,color:C.black,padding:"6px 0 0",marginTop:4,borderTop:"1.5px solid "+C.gray}}><span>Neto a pagar</span><b style={{color:C.green,fontVariantNumeric:"tabular-nums"}}>{pgMoney(t.neto)}</b></div>
                </div>
              </div>
            </div>
          );})}

          {/* grand totals for multi-tech */}
          {multi&&(
            <div style={{borderTop:"2px solid "+C.black,paddingTop:12,marginTop:4,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,color:C.earth,padding:"3px 0"}}><span>Total bruto</span><b style={{color:C.black,fontVariantNumeric:"tabular-nums"}}>{pgMoney(gBruto)}</b></div>
              {gDesc>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,color:C.peach,padding:"3px 0"}}><span>Descuentos por adelanto</span><b style={{fontVariantNumeric:"tabular-nums"}}>−{pgMoney(gDesc)}</b></div>}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,color:C.black,padding:"6px 0 0"}}><span>Total neto pagado</span><b style={{color:C.green,fontVariantNumeric:"tabular-nums"}}>{pgMoney(gNeto)}</b></div>
            </div>
          )}

          {/* support attachment */}
          <div style={{marginTop:20,borderTop:"1px solid "+C.gray,paddingTop:16}}>
            <div style={{fontSize:8.5,fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",color:C.earth,marginBottom:10}}>Comprobante de transferencia</div>
            {pago.soporte?(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {(pago.soporte.type||"").indexOf("image/")===0
                  ? <img src={pago.soporte.url?driveThumb(pago.soporte.url,1200):pago.soporte.data} alt="soporte" style={{maxWidth:"100%",borderRadius:10,border:"1px solid "+C.gray}}/>
                  : <a href={pago.soporte.url||pago.soporte.data} target="_blank" rel="noopener" download={pago.soporte.url?undefined:pago.soporte.name} style={{display:"flex",alignItems:"center",gap:10,background:C.surfaceWarm,border:"1px solid "+C.gray,borderRadius:8,padding:"12px 14px",fontSize:13,color:C.black,textDecoration:"none",fontWeight:600}}><span style={{fontSize:18}}>📄</span>{pago.soporte.name||"Documento adjunto"}<span style={{marginLeft:"auto",fontSize:11,color:C.earth}}>{pago.soporte.url?"Ver":"Descargar"}</span></a>}
                {isAdmin&&<button onClick={function(){saveSoporte(null);}} style={{alignSelf:"flex-start",background:"none",border:"none",color:C.red,fontSize:11.5,fontWeight:600,cursor:"pointer",padding:0}}>Quitar soporte</button>}
              </div>
            ):(
              isAdmin
                ? <button disabled={upBusy} onClick={function(){if(supRef.current)supRef.current.click();}} style={{width:"100%",padding:"14px",borderRadius:10,border:"2px dashed "+C.gray,background:C.beige,display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:upBusy?"default":"pointer",fontSize:13,color:C.earth,fontFamily:"Montserrat,sans-serif",fontWeight:600}}><span style={{fontSize:19}}>📎</span>{upBusy?"Subiendo comprobante…":"Adjuntar comprobante de transferencia (PDF o imagen)"}</button>
                : <div style={{fontSize:12,color:C.earth,fontStyle:"italic"}}>El administrador aún no ha adjuntado el comprobante de la transferencia.</div>
            )}
            <input ref={supRef} type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files[0])onAddSoporte(e.target.files[0]);e.target.value="";}}/>
          </div>

          {/* actions */}
          <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:24}}>
            <button disabled={!!shareBusy} onClick={function(){shareComprobante(pago,company,focusEmail,"image",setShareBusy);}} style={{width:"100%",padding:"14px",borderRadius:11,border:"none",background:shareBusy?C.gray:C.green,color:"#fff",fontSize:13.5,fontWeight:700,cursor:shareBusy?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{shareBusy==="image"?"Generando imagen…":"Compartir por WhatsApp (imagen)"}</button>
            <div style={{display:"flex",gap:10}}>
              <button disabled={!!shareBusy} onClick={function(){shareComprobante(pago,company,focusEmail,"pdf",setShareBusy);}} style={{flex:1,padding:"12px",borderRadius:11,border:"none",background:C.black,color:"#fff",fontSize:12.5,fontWeight:700,cursor:shareBusy?"default":"pointer"}}>{shareBusy==="pdf"?"Generando…":"Descargar PDF"}</button>
              <button disabled={!!shareBusy} onClick={function(){shareComprobante(pago,company,focusEmail,"imgdl",setShareBusy);}} style={{flex:1,padding:"12px",borderRadius:11,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:shareBusy?"default":"pointer"}}>{shareBusy==="imgdl"?"Generando…":"Descargar imagen"}</button>
              <button onClick={function(){printComprobante(pago,company,focusEmail);}} title="Imprimir" style={{padding:"12px 16px",borderRadius:11,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Imprimir</button>
            </div>
            <button onClick={onClose} style={{width:"100%",padding:"11px",borderRadius:11,border:"none",background:"none",color:C.earth,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Cerrar</button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

/* ─── Contract preview modal */
function ContractModal({adv,onClose}){
  return (
    <Overlay onClick={onClose}>
      <div onClick={function(e){e.stopPropagation();}} style={{background:"#fff",borderRadius:18,maxWidth:680,width:"100%",maxHeight:"88vh",overflow:"auto",boxShadow:C.shadowLg||"0 28px 80px rgba(62,63,63,.18)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 22px",borderBottom:"1px solid "+C.line,position:"sticky",top:0,background:"#fff"}}>
          <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:19,color:C.black}}>Contrato de adelanto</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:C.earth,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:"26px 30px"}}>
          {advContracts(adv).map(function(c,i,arr){
            var multi=arr.length>1;
            var txt=c.contractText||buildContractText(Object.assign({vendorName:adv.vendorName},c));
            var dep=c.comprobanteDeposito;
            return (
              <div key={i} style={{marginBottom:i<arr.length-1?36:0,paddingBottom:i<arr.length-1?30:0,borderBottom:i<arr.length-1?"1px solid "+C.line:"none"}}>
                {multi&&<div style={{fontSize:9.5,fontWeight:700,color:C.peach,letterSpacing:".2em",textTransform:"uppercase",marginBottom:12}}>Contrato {i+1} · Q{(c.monto||0).toLocaleString()}</div>}
                <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:23,letterSpacing:".03em",textAlign:"center",color:C.black,marginBottom:22}}>Solicitud y recibo de adelanto de pago</div>
                <div style={{fontFamily:"Georgia,serif",fontSize:13.5,lineHeight:1.7,color:C.black,whiteSpace:"pre-wrap"}}>{txt}</div>
                <div style={{marginTop:36}}>
                  {c.firma&&<img src={c.firma} alt="Firma" style={{maxHeight:64,display:"block",marginBottom:2}}/>}
                  <div style={{borderTop:"1px solid "+C.black,width:260,paddingTop:6,fontSize:13,color:C.black}}>{adv.vendorName||""}{c.firma&&<span style={{fontSize:10.5,color:C.earth,display:"block",marginTop:2}}>Firmado digitalmente{c.firmadoEn?" · "+fmtDate(new Date(c.firmadoEn).toISOString().split("T")[0]):""}</span>}</div>
                </div>
                {c.dpiPhoto&&(<div style={{marginTop:24}}><div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:8}}>DPI adjunto</div><img src={c.dpiPhoto} alt="DPI" style={{maxWidth:"100%",borderRadius:10,border:"1px solid "+C.gray}}/></div>)}
                {dep&&(<div style={{marginTop:24}}><div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:8}}>Comprobante de depósito</div>{(dep.type||"").indexOf("image/")===0?<img src={dep.url||dep.data} alt="Comprobante" style={{maxWidth:"100%",borderRadius:10,border:"1px solid "+C.gray}}/>:<div style={{fontSize:12.5,color:C.black,background:C.surfaceWarm,border:"1px solid "+C.gray,borderRadius:8,padding:"12px 14px"}}>📄 {dep.name||"Documento adjunto"}</div>}</div>)}
              </div>
            );
          })}
        </div>
        <div style={{padding:"14px 22px",borderBottom:"none",borderTop:"1px solid "+C.line,display:"flex",justifyContent:"flex-end",gap:10,position:"sticky",bottom:0,background:"#fff"}}>
          <button onClick={function(){printContract(adv);}} style={{padding:"10px 20px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Imprimir / PDF</button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─── Vendor: completar una solicitud iniciada por el administrador
   El monto/cuotas ya los fijó el admin; el técnico solo sube su DPI y firma. */
function AdminReqComplete({adv, vendor, onComplete}){
  const [dpiPhoto,setDpiPhoto] = useState(adv.dpiPhoto||null);
  const [nombre,setNombre] = useState(adv.vendorName||vendorDisplay(vendor)||"");
  const [dpiNum,setDpiNum] = useState(adv.dpiNumber||"");
  const [firma,setFirma]   = useState(null);
  const [err,setErr]       = useState("");
  const [busy,setBusy]     = useState(false);
  const [preview,setPreview]= useState(false);
  const fileRef = useRef(null);
  var semanal=parseFloat(adv.cobroSemanal||0)||0;
  var datosOk=!!dpiPhoto && nombre.trim() && dpiNum.trim();
  async function pick(file){ if(!file)return; try{var d=await compress(file); setDpiPhoto(d);}catch(e){} }
  var draftAdv=Object.assign({},adv,{vendorName:nombre,dpiNumber:dpiNum,dpiPhoto:dpiPhoto,firma:firma});
  async function submit(){
    setErr("");
    if(!dpiPhoto)      return setErr("Sube la foto de tu documento (DPI).");
    if(!nombre.trim()) return setErr("Confirma tu nombre completo.");
    if(!dpiNum.trim()) return setErr("Confirma tu número de DPI (CUI).");
    if(!firma)         return setErr("Firma el contrato para continuar.");
    setBusy(true);
    try{ await onComplete({dpiPhoto:dpiPhoto,nombre:nombre.trim(),dpiNumber:dpiNum.trim(),firma:firma}); }catch(e){}
    setBusy(false);
  }
  function StepBadge({n,done,active}){ return <span style={{width:24,height:24,borderRadius:"50%",flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,background:done?C.green:(active?C.black:C.gray),color:done||active?"#fff":C.earth}}>{done?"✓":n}</span>; }
  return (
    <div style={{background:"#fff",border:"1.5px solid "+C.peach+"66",borderRadius:18,boxShadow:"0 4px 16px rgba(62,63,63,.05)",padding:"18px 18px 20px",marginBottom:20}}>
      <div style={{fontSize:9.5,fontWeight:700,color:C.peach,letterSpacing:".22em",textTransform:"uppercase",marginBottom:6}}>Solicitud del administrador</div>
      <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:21,color:C.black,marginBottom:4}}>Tienes un adelanto por firmar</div>
      <div style={{fontSize:12,color:C.earth,lineHeight:1.6,marginBottom:14}}>El administrador inició un adelanto para ti. Sube tu DPI y firma el contrato; luego el administrador hará el depósito.</div>
      <div style={{background:C.surfaceWarm,borderRadius:12,padding:"13px 15px",marginBottom:16,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <AdvStat label="Monto" value={"Q"+(adv.monto||0).toLocaleString()}/>
        <AdvStat label="Cuotas" value={adv.cuotas||"—"}/>
        <AdvStat label="Semanal" value={"Q"+semanal.toLocaleString()} accent/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}} className="f">
        {/* DPI */}
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:11}}><StepBadge n={1} done={!!dpiPhoto} active={!dpiPhoto}/><span style={{fontSize:13,fontWeight:700,color:C.black}}>Sube tu documento (DPI)</span></div>
          {dpiPhoto?(
            <div style={{position:"relative",borderRadius:12,overflow:"hidden",border:"1px solid "+C.gray}}>
              <img src={dpiPhoto} alt="DPI" style={{width:"100%",display:"block",maxHeight:200,objectFit:"cover"}}/>
              <button onClick={function(){setDpiPhoto(null);}} style={{position:"absolute",top:8,right:8,width:30,height:30,borderRadius:"50%",border:"none",background:"rgba(62,63,63,.7)",color:"#fff",fontSize:17,cursor:"pointer"}}>×</button>
            </div>
          ):(
            <button onClick={function(){if(fileRef.current)fileRef.current.click();}} style={{width:"100%",padding:"22px",borderRadius:12,border:"2px dashed "+C.gray,background:C.surfaceWarm,display:"flex",flexDirection:"column",alignItems:"center",gap:7,cursor:"pointer",color:C.earth}}>
              <Icon name="camera" size={22} stroke={C.earth}/>
              <span style={{fontSize:12.5,fontWeight:600,color:C.black}}>Tomar foto / subir DPI</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files[0])pick(e.target.files[0]);e.target.value="";}}/>
        </div>
        {/* Datos */}
        {dpiPhoto&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:11}}><StepBadge n={2} done={!!(nombre.trim()&&dpiNum.trim())} active={!(nombre.trim()&&dpiNum.trim())}/><span style={{fontSize:13,fontWeight:700,color:C.black}}>Confirma tus datos</span></div>
            <div style={{display:"flex",flexDirection:"column",gap:13}}>
              <F label="Nombre completo (como en el DPI)"><input value={nombre} onChange={function(e){setNombre(e.target.value);setErr("");}} placeholder="Nombre y apellidos"/></F>
              <F label="Número de DPI (CUI)"><input value={dpiNum} onChange={function(e){setDpiNum(e.target.value);setErr("");}} placeholder="0000 00000 0000" inputMode="numeric"/></F>
            </div>
          </div>
        )}
        {/* Firma */}
        {datosOk&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:11}}><StepBadge n={3} done={!!firma} active={!firma}/><span style={{fontSize:13,fontWeight:700,color:C.black}}>Firma y envía</span></div>
            <button onClick={function(){setPreview(true);}} style={{width:"100%",padding:"11px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer",marginBottom:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon name="file" size={15} stroke={C.black}/>Leer el contrato</button>
            <SignaturePad onChange={setFirma}/>
            <div style={{fontSize:10.5,color:C.earth,lineHeight:1.6,marginTop:10}}>Al firmar aceptas el contrato de adelanto y autorizas el descuento semanal automático.</div>
          </div>
        )}
        {err&&<Err msg={err}/>}
        <BigBtn onClick={submit} dis={busy||!firma}>{busy?"Enviando…":"Firmar y enviar →"}</BigBtn>
      </div>
      {preview&&<ContractModal adv={draftAdv} onClose={function(){setPreview(false);}}/>}
    </div>
  );
}

/* ─── Vendor: request an advance (EPI Limpieza only) */
function AdvanceRequest({vendor, reps, adelantos, onSvAdelantos}){
  var emails = vendorEmailSet(vendor);
  var mine = (adelantos||[]).filter(function(a){return emails.indexOf((a.vendorEmail||"").toLowerCase().trim())>=0;});
  var vigentes = mine.filter(function(a){return a.status==="activo"||a.status==="pendiente"||a.status==="pendiente_tecnico"||a.status==="por_depositar";});
  /* Solicitudes que el ADMIN inició para este técnico y que él debe completar (DPI + firma). */
  var adminReqs = mine.filter(function(a){return a.status==="pendiente_tecnico";});
  function completeAdminReq(adv, data){
    var updated=Object.assign({}, adv, {
      dpiPhoto:data.dpiPhoto, vendorName:(data.nombre||adv.vendorName), dpiNumber:(data.dpiNumber||adv.dpiNumber),
      firma:data.firma, firmadoEn:Date.now(), status:"por_depositar",
    });
    updated.contractText=buildContractText(updated);
    return onSvAdelantos((adelantos||[]).map(function(a){return a.id===adv.id?updated:a;}));
  }
  var maxTotal = maxAdvanceForVendor(reps, vendor);
  var sum8 = incomeLast8(reps, emails);
  /* Suma de saldos vigentes (activos por su saldo, solicitudes pendientes por su monto) */
  var saldoVigente = vigentes.reduce(function(s,a){ return s + (a.status==="activo" ? advanceState(a,reps).saldo : (parseFloat(a.monto)||0)); },0);
  var disponible = Math.max(0, maxTotal - saldoVigente);

  const [dpiPhoto,setDpiPhoto] = useState(null);
  const [nombre,setNombre] = useState(vendorDisplay(vendor)||"");
  const [dpiNum,setDpiNum] = useState("");
  const [monto,setMonto]   = useState("");
  const [cuotas,setCuotas] = useState(8);
  const [fecha,setFecha]   = useState(todayStr());
  const [firma,setFirma]   = useState(null);
  const [err,setErr]       = useState("");
  const [busy,setBusy]     = useState(false);
  const [preview,setPreview]= useState(null);
  const fileRef = useRef(null);

  var montoN = parseFloat(monto||0)||0;
  var semanal = cuotas>0 ? Math.ceil(montoN/cuotas) : 0;
  var mensual = Math.round(semanal*52/12);
  var datosOk = !!dpiPhoto && nombre.trim() && dpiNum.trim();
  var montoOk = datosOk && montoN>0 && montoN<=disponible;

  async function pickDpi(file){ if(!file) return; try{ var d=await compress(file); setDpiPhoto(d); }catch(e){} }
  function draft(){ return {vendorName:nombre,dpiNumber:dpiNum,monto:montoN,cuotas:cuotas,cobroSemanal:semanal,fechaDeposito:fecha,fechaInicio:fecha,dpiPhoto:dpiPhoto,firma:firma}; }

  async function submit(){
    setErr("");
    if(!dpiPhoto)      return setErr("Sube la foto de tu documento (DPI).");
    if(!nombre.trim()) return setErr("Confirma tu nombre completo.");
    if(!dpiNum.trim()) return setErr("Confirma tu número de DPI (CUI).");
    if(!montoN||montoN<=0) return setErr("Ingresa el monto a solicitar.");
    if(montoN>disponible)  return setErr("El monto excede tu disponible (Q"+disponible.toLocaleString()+").");
    if(!firma)         return setErr("Firma el contrato para enviar la solicitud.");
    setBusy(true);
    var adv = Object.assign({id:"adv_"+Date.now(), vendorEmail:vendor.email, status:"pendiente", createdAt:Date.now(), pausas:[], firmadoEn:Date.now()}, draft());
    adv.contractText = buildContractText(adv);
    try{ await onSvAdelantos([adv].concat(adelantos||[])); }catch(e){}
    setBusy(false); setDpiPhoto(null); setDpiNum(""); setMonto(""); setCuotas(8); setFirma(null);
  }

  function StepBadge({n,done,active}){ return <span style={{width:24,height:24,borderRadius:"50%",flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,background:done?C.green:(active?C.black:C.gray),color:done||active?"#fff":C.earth}}>{done?"✓":n}</span>; }

  return (
    <div style={{maxWidth:520,margin:"0 auto",padding:"24px 16px 90px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:9.5,fontWeight:600,color:C.earth,letterSpacing:".28em",textTransform:"uppercase",marginBottom:8}}>Adelanto de pago</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:27,color:C.black}}>Solicitar un adelanto</div>
      </div>

      {/* Solicitudes iniciadas por el administrador — el técnico debe subir DPI y firmar */}
      {adminReqs.map(function(a){ return (
        <AdminReqComplete key={a.id} adv={a} vendor={vendor} onComplete={function(data){return completeAdminReq(a,data);}}/>
      );})}

      {/* Available */}
      <div style={{background:C.black,borderRadius:16,padding:"18px 20px",marginBottom:16,color:"#fff"}}>
        <div style={{fontSize:9.5,fontWeight:600,letterSpacing:".2em",textTransform:"uppercase",opacity:.7,marginBottom:6}}>Disponible para solicitar</div>
        <div style={{fontSize:30,fontWeight:600,letterSpacing:"-.01em",color:disponible>0?"#fff":C.peach}}>Q{disponible.toLocaleString()}</div>
        <div style={{fontSize:11,opacity:.62,marginTop:8,lineHeight:1.7}}>Máximo (½ de tus últimas 8 semanas, Q{sum8.toLocaleString()}): <b style={{color:"#fff"}}>Q{maxTotal.toLocaleString()}</b>{saldoVigente>0?<> · En adelantos vigentes: <b style={{color:"#fff"}}>Q{saldoVigente.toLocaleString()}</b></>:null}</div>
      </div>

      {/* Mis adelantos vigentes */}
      {vigentes.filter(function(a){return a.status!=="pendiente_tecnico";}).length>0&&(
        <div style={{marginBottom:18}}>
          <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:9}}>Mis adelantos · {vigentes.filter(function(a){return a.status!=="pendiente_tecnico";}).length}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {vigentes.filter(function(a){return a.status!=="pendiente_tecnico";}).map(function(a){ var st=advanceState(a,reps); var isActivo=a.status==="activo"; var dot=isActivo?C.green:C.orange;
              var estado=isActivo?"activo":(a.status==="por_depositar"?"esperando depósito":"pendiente de aprobación");
              var sub=isActivo?("Saldo Q"+st.saldo.toLocaleString()+" · Q"+(a.cobroSemanal||0)+"/sem"):(a.status==="por_depositar"?"Firmado · el admin realizará el depósito":"En revisión"); return (
              <button key={a.id} onClick={function(){setPreview(a);}} style={{textAlign:"left",background:"#fff",border:"1px solid "+C.line,borderRadius:14,padding:"13px 15px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",boxShadow:"0 4px 16px rgba(62,63,63,.04)"}}>
                <span style={{width:9,height:9,borderRadius:"50%",background:dot,flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.black}}>Q{(a.monto||0).toLocaleString()} <span style={{fontWeight:500,color:C.earth,fontSize:11.5}}>· {estado}</span></div>
                  <div style={{fontSize:11,color:C.earth,marginTop:2}}>{sub}</div>
                </div>
                <span style={{fontSize:11,color:C.earth,fontWeight:600}}>Ver →</span>
              </button>
            );})}
          </div>
        </div>
      )}

      {maxTotal<=0 ? (
        <div style={{background:C.surfaceWarm,borderRadius:14,padding:"22px",textAlign:"center",fontSize:13,color:C.earth,lineHeight:1.7,border:"1px solid "+C.line}}>Aún no tienes trabajos registrados en las últimas 8 semanas, por lo que no hay un monto disponible para adelanto.</div>
      ) : disponible<=0 ? (
        <div style={{background:C.surfaceWarm,borderRadius:14,padding:"22px",textAlign:"center",fontSize:13,color:C.earth,lineHeight:1.7,border:"1px solid "+C.line}}>Ya tienes el máximo en adelantos vigentes. Podrás solicitar otro cuando bajes el saldo pendiente.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* PASO 1 — Documento */}
          <div style={{background:"#fff",borderRadius:16,border:"1px solid "+C.line,boxShadow:"0 4px 16px rgba(62,63,63,.04)",padding:"16px 18px"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:13}}><StepBadge n={1} done={!!dpiPhoto} active={!dpiPhoto}/><span style={{fontSize:13.5,fontWeight:700,color:C.black}}>Sube tu documento</span></div>
            {dpiPhoto?(
              <div style={{position:"relative",borderRadius:12,overflow:"hidden",border:"1px solid "+C.gray}}>
                <img src={dpiPhoto} alt="DPI" style={{width:"100%",display:"block",maxHeight:220,objectFit:"cover"}}/>
                <button onClick={function(){setDpiPhoto(null);}} style={{position:"absolute",top:8,right:8,width:30,height:30,borderRadius:"50%",border:"none",background:"rgba(62,63,63,.7)",color:"#fff",fontSize:17,cursor:"pointer"}}>×</button>
              </div>
            ):(
              <button onClick={function(){if(fileRef.current)fileRef.current.click();}} style={{width:"100%",padding:"26px",borderRadius:12,border:"2px dashed "+C.gray,background:C.surfaceWarm,display:"flex",flexDirection:"column",alignItems:"center",gap:7,cursor:"pointer",color:C.earth}}>
                <Icon name="camera" size={24} stroke={C.earth}/>
                <span style={{fontSize:13,fontWeight:600,color:C.black}}>Tomar foto / subir DPI</span>
                <span style={{fontSize:10.5,color:C.earth,textAlign:"center"}}>De aquí se toman tu nombre y número de DPI para el contrato</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files[0])pickDpi(e.target.files[0]);e.target.value="";}}/>
          </div>

          {/* PASO 2 — Confirma datos del documento */}
          {dpiPhoto&&(
            <div style={{background:"#fff",borderRadius:16,border:"1px solid "+C.line,boxShadow:"0 4px 16px rgba(62,63,63,.04)",padding:"16px 18px"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:13}}><StepBadge n={2} done={!!(nombre.trim()&&dpiNum.trim())} active={!(nombre.trim()&&dpiNum.trim())}/><span style={{fontSize:13.5,fontWeight:700,color:C.black}}>Confirma tus datos</span></div>
              <div style={{fontSize:11,color:C.earth,marginBottom:13,lineHeight:1.6}}>Verifica que coincidan exactamente con tu documento. Se usarán en el contrato.</div>
              <div style={{display:"flex",flexDirection:"column",gap:13}} className="f">
                <F label="Nombre completo (como en el DPI)"><input value={nombre} onChange={function(e){setNombre(e.target.value);setErr("");}} placeholder="Nombre y apellidos"/></F>
                <F label="Número de DPI (CUI)"><input value={dpiNum} onChange={function(e){setDpiNum(e.target.value);setErr("");}} placeholder="0000 00000 0000" inputMode="numeric"/></F>
              </div>
            </div>
          )}

          {/* PASO 3 — Monto y plazo */}
          {datosOk&&(
            <div style={{background:"#fff",borderRadius:16,border:"1px solid "+C.line,boxShadow:"0 4px 16px rgba(62,63,63,.04)",padding:"16px 18px"}} className="f">
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:13}}><StepBadge n={3} done={montoOk} active={!montoOk}/><span style={{fontSize:13.5,fontWeight:700,color:C.black}}>Monto y plazo</span></div>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <F label={"Monto a solicitar (máx. Q"+disponible.toLocaleString()+")"}><input type="number" inputMode="numeric" placeholder={"Ej. "+Math.min(500,disponible)} value={monto} onChange={function(e){setMonto(e.target.value);setErr("");}}/></F>
                {montoN>disponible&&<div style={{fontSize:11,color:C.red,fontWeight:600,marginTop:-6}}>Excede tu disponible (Q{disponible.toLocaleString()}).</div>}
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:C.earth,letterSpacing:".2em",textTransform:"uppercase",marginBottom:9}}>Cuotas semanales — máx. 16</div>
                  <div style={{display:"flex",alignItems:"center",gap:14}}>
                    <input type="range" min="1" max="16" value={cuotas} onChange={function(e){setCuotas(parseInt(e.target.value));}} style={{flex:1,accentColor:C.peach}}/>
                    <span style={{fontSize:15,fontWeight:700,color:C.black,minWidth:64,textAlign:"right"}}>{cuotas} sem.</span>
                  </div>
                </div>
                {montoN>0&&(
                  <div style={{background:C.peach12||"rgba(233,130,106,.12)",borderRadius:12,padding:"13px 15px",display:"flex",flexDirection:"column",gap:9}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:12,color:C.black,fontWeight:600}}>Descuento semanal</span><span style={{fontSize:17,fontWeight:700,color:C.peach}}>Q{semanal.toLocaleString()}</span></div>
                    <div style={{height:1,background:"rgba(62,63,63,.10)"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:12,color:C.black,fontWeight:600}}>Débito mensual aprox.</span><span style={{fontSize:14,fontWeight:700,color:C.black}}>Q{mensual.toLocaleString()}</span></div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PASO 4 — Firma y envío */}
          {montoOk&&(
            <div style={{background:"#fff",borderRadius:16,border:"1px solid "+C.line,boxShadow:"0 4px 16px rgba(62,63,63,.04)",padding:"16px 18px"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:13}}><StepBadge n={4} done={!!firma} active={!firma}/><span style={{fontSize:13.5,fontWeight:700,color:C.black}}>Firma y envía</span></div>
              <button onClick={function(){setPreview(Object.assign({vendorEmail:vendor.email},draft()));}} style={{width:"100%",padding:"12px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon name="file" size={15} stroke={C.black}/>Leer el contrato</button>
              <div style={{fontSize:10,fontWeight:600,color:C.earth,letterSpacing:".2em",textTransform:"uppercase",marginBottom:9}}>Tu firma</div>
              <SignaturePad onChange={setFirma}/>
              <div style={{fontSize:10.5,color:C.earth,lineHeight:1.6,marginTop:10}}>Al firmar aceptas el contrato de adelanto y autorizas el descuento semanal automático.</div>
            </div>
          )}

          {err&&<Err msg={err}/>}
          <BigBtn onClick={submit} dis={busy||!firma}>{busy?"Enviando…":"Firmar y enviar solicitud →"}</BigBtn>
          <div style={{fontSize:11,color:C.earth,textAlign:"center",lineHeight:1.7,padding:"0 10px"}}>El administrador revisará tu solicitud antes de activarla. El descuento semanal se aplica automáticamente a tus pagos.</div>
        </div>
      )}
      {preview&&<ContractModal adv={preview} onClose={function(){setPreview(null);}}/>}
    </div>
  );
}
/* ─── Pad de firma (mouse + táctil) */
function SignaturePad({onChange, height}){
  const ref=useRef(null); const ctxRef=useRef(null); const drawing=useRef(false); const empty=useRef(true);
  const [has,setHas]=useState(false);
  var H = height||150;
  useEffect(function(){
    var c=ref.current; if(!c) return;
    var rect=c.getBoundingClientRect();
    c.width=rect.width*2; c.height=H*2;
    var ctx=c.getContext("2d"); ctx.scale(2,2); ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#3E3F3F"; ctxRef.current=ctx;
  },[]);
  function pos(e){ var c=ref.current; var r=c.getBoundingClientRect(); var t=e.touches&&e.touches[0]; var x=(t?t.clientX:e.clientX)-r.left; var y=(t?t.clientY:e.clientY)-r.top; return {x:x,y:y}; }
  function start(e){ e.preventDefault(); drawing.current=true; var p=pos(e); ctxRef.current.beginPath(); ctxRef.current.moveTo(p.x,p.y); }
  function move(e){ if(!drawing.current)return; e.preventDefault(); var p=pos(e); ctxRef.current.lineTo(p.x,p.y); ctxRef.current.stroke(); empty.current=false; if(!has)setHas(true); }
  function end(){ if(!drawing.current)return; drawing.current=false; if(!empty.current&&onChange) onChange(ref.current.toDataURL("image/png")); }
  function clear(){ var c=ref.current; ctxRef.current.clearRect(0,0,c.width,c.height); empty.current=true; setHas(false); if(onChange)onChange(null); }
  return (
    <div>
      <canvas ref={ref}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{width:"100%",height:H+"px",background:C.surfaceWarm,border:"1.5px dashed "+(has?C.green:C.gray),borderRadius:12,touchAction:"none",display:"block",cursor:"crosshair"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:7}}>
        <span style={{fontSize:11,color:has?C.green:C.earth,fontWeight:has?700:400}}>{has?"✓ Firma capturada":"Firma con el dedo o el mouse"}</span>
        <button onClick={clear} style={{background:"none",border:"none",color:C.earth,fontSize:11,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>Borrar</button>
      </div>
    </div>
  );
}
/* ─── Subir comprobante de depósito (imagen o PDF) — lo sube el admin */
function DepositReceiptUp({receipt, onAdd, onDel, compact}){
  var ref=useRef(null);
  const [busy,setBusy]=useState(false);
  async function add(file){
    if(!file) return; setBusy(true);
    try{
      var data;
      if((file.type||"").indexOf("image/")===0){ data=await compress(file); }
      else { data=await new Promise(function(res){var r=new FileReader();r.onload=function(ev){res(ev.target.result);};r.readAsDataURL(file);}); }
      onAdd({name:file.name,type:file.type,data:data});
    }catch(e){}
    setBusy(false);
  }
  if(receipt){
    var isImg=(receipt.type||"").indexOf("image/")===0;
    var src=receipt.url?receipt.url:receipt.data;
    return (
      <div style={{display:"flex",alignItems:"center",gap:11,background:"#fff",border:"1px solid "+C.line,borderRadius:10,padding:"9px 12px"}}>
        {isImg&&src?<img src={src} alt="" style={{width:40,height:40,borderRadius:7,objectFit:"cover",border:"1px solid "+C.gray}}/>:<span style={{fontSize:20}}>📄</span>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11.5,fontWeight:700,color:C.green}}>Comprobante de depósito</div>
          <div style={{fontSize:10.5,color:C.earth,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{receipt.name||"Adjunto"}</div>
        </div>
        {onDel&&<button onClick={onDel} title="Quitar" style={{background:"none",border:"1px solid "+C.gray,borderRadius:6,color:C.earth,fontSize:11,fontWeight:600,padding:"4px 9px",cursor:"pointer"}}>Cambiar</button>}
      </div>
    );
  }
  return (
    <div>
      <button onClick={function(){if(ref.current)ref.current.click();}} disabled={busy} style={{width:"100%",padding:compact?"11px":"14px",borderRadius:10,border:"2px dashed "+C.gray,background:C.surfaceWarm,display:"flex",alignItems:"center",justifyContent:"center",gap:9,cursor:busy?"wait":"pointer",fontSize:12.5,color:C.earth,fontWeight:600}}>
        <Icon name="upload" size={16} stroke={C.earth}/>{busy?"Subiendo…":"Subir comprobante de depósito"}
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files[0])add(e.target.files[0]);e.target.value="";}}/>
    </div>
  );
}
function AdvStat({label,value,accent}){
  return <div><div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:4}}>{label}</div><div style={{fontSize:18,fontWeight:700,color:accent?C.peach:C.black}}>{value}</div></div>;
}

/* ─── Admin: manage advances */
function AdvancesAdmin({adelantos, reps, vendors, onSvAdelantos}){
  const [preview,setPreview] = useState(null);
  const [adjust, setAdjust]  = useState(null); /* id del adelanto en modo ajuste */
  const [creating,setCreating] = useState(false);
  var list = adelantos||[];
  var pendTec = list.filter(function(a){return a.status==="pendiente_tecnico";}); /* admin inició, espera al técnico */
  var pend    = list.filter(function(a){return a.status==="pendiente";});         /* técnico solicitó, espera aprobación */
  var porDep  = list.filter(function(a){return a.status==="por_depositar";});      /* técnico firmó, espera depósito */
  var active  = list.filter(function(a){return a.status==="activo";});
  var done    = list.filter(function(a){return a.status==="pagado"||a.status==="rechazado";});

  function update(id, patch){ onSvAdelantos(list.map(function(a){return a.id===id?Object.assign({},a,patch):a;})); }
  /* Aprobar (solicitud del técnico): activa y unifica con cualquier adelanto activo previo. */
  function approve(a){
    var next=list.map(function(x){return x.id===a.id?Object.assign({},x,{status:"activo", fechaDeposito:x.fechaDeposito||todayStr(), fechaInicio:x.fechaInicio||x.fechaDeposito||todayStr()}):x;});
    var u=autoUnify(next, reps); onSvAdelantos(u.list);
  }
  /* Activar tras el depósito (adelanto iniciado por el admin y ya firmado por el técnico). */
  function activateDeposit(a){
    if(!advDeposits(a).length) return;
    var next=list.map(function(x){return x.id===a.id?Object.assign({},x,{status:"activo", fechaInicio:todayStr(), fechaDeposito:x.fechaDeposito||todayStr()}):x;});
    var u=autoUnify(next, reps); onSvAdelantos(u.list);
  }
  /* Guarda el comprobante de depósito (top-level, o en un sub-contrato si es unificado). */
  function setDeposit(a, receipt, contractIdx){
    if(a.unified && a.contracts && typeof contractIdx==="number"){
      update(a.id, {contracts:a.contracts.map(function(c,i){return i===contractIdx?Object.assign({},c,{comprobanteDeposito:receipt}):c;})});
    } else {
      update(a.id, {comprobanteDeposito:receipt});
    }
  }
  function reject(a){ update(a.id,{status:"rechazado"}); }
  function pauseNext(a){
    var k=nextChargeableWeek(a, reps);
    if(!k) return;
    var pausas=(a.pausas||[]).slice();
    if(pausas.indexOf(k)<0) pausas.push(k);
    update(a.id, {pausas:pausas});
  }
  function unpauseWeek(a, k){
    update(a.id, {pausas:(a.pausas||[]).filter(function(x){return x!==k;})});
  }
  function delAdv(a){ onSvAdelantos(list.filter(function(x){return x.id!==a.id;})); }
  function createAdv(adv){ onSvAdelantos([adv].concat(list)); }

  var totalSaldo = active.reduce(function(s,a){return s+advanceState(a,reps).saldo;},0);
  var totalSemanal = weeklyAdvanceCharge(list, reps);

  return (
    <div style={{maxWidth:760,margin:"0 auto",padding:"26px 16px 90px",fontFamily:"Montserrat,sans-serif"}}>
      <div style={{marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:14,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:9.5,fontWeight:600,color:C.earth,letterSpacing:".28em",textTransform:"uppercase",marginBottom:8}}>Adelantos</div>
          <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:28,color:C.black}}>Adelantos de pago</div>
        </div>
        <button onClick={function(){setCreating(true);}} style={{padding:"11px 20px",borderRadius:100,border:"none",background:C.black,color:"#fff",fontSize:12.5,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:8,whiteSpace:"nowrap"}}><Icon name="plus" size={15} stroke="#fff"/>Crear adelanto</button>
      </div>

      {/* Summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:24}}>
        <div style={{background:"#fff",borderRadius:16,padding:"16px 18px",border:"1px solid "+C.line,boxShadow:"0 4px 16px rgba(62,63,63,.05)"}}><div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>Activos</div><div style={{fontSize:24,fontWeight:600,color:C.black}}>{active.length}</div></div>
        <div style={{background:"#fff",borderRadius:16,padding:"16px 18px",border:"1px solid "+C.line,boxShadow:"0 4px 16px rgba(62,63,63,.05)"}}><div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>Saldo total</div><div style={{fontSize:24,fontWeight:600,color:C.black}}>Q{totalSaldo.toLocaleString()}</div></div>
        <div style={{background:C.black,borderRadius:16,padding:"16px 18px"}}><div style={{fontSize:9.5,fontWeight:700,color:"rgba(255,255,255,.6)",letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>Descuento / semana</div><div style={{fontSize:24,fontWeight:600,color:C.peach}}>Q{totalSemanal.toLocaleString()}</div></div>
      </div>

      {/* Firmados — por depositar (adelantos iniciados por el admin, ya firmados) */}
      {porDep.length>0&&(
        <div style={{marginBottom:26}}>
          <div style={{fontSize:10,fontWeight:700,color:C.green,letterSpacing:".18em",textTransform:"uppercase",marginBottom:12}}>Firmados · por depositar · {porDep.length}</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {porDep.map(function(a){ var dep=advDeposits(a)[0]; return (
              <div key={a.id} style={{background:"#fff",borderRadius:16,border:"1.5px solid "+C.green+"55",overflow:"hidden",boxShadow:"0 4px 16px rgba(62,63,63,.05)"}}>
                <div style={{padding:"16px 18px"}}>
                  <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"center",marginBottom:14}}>
                    <div style={{flex:1,minWidth:160}}>
                      <div style={{fontSize:15,fontWeight:700,color:C.black}}>{a.vendorName||a.vendorEmail}</div>
                      <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>Firmado por el técnico · DPI {a.dpiNumber||"—"}</div>
                    </div>
                    <div style={{display:"flex",gap:18}}>
                      <AdvStat label="Monto" value={"Q"+(a.monto||0).toLocaleString()}/>
                      <AdvStat label="Semanal" value={"Q"+(a.cobroSemanal||0).toLocaleString()} accent/>
                    </div>
                  </div>
                  <div style={{fontSize:11.5,color:C.earth,lineHeight:1.6,marginBottom:12}}>El técnico ya subió su DPI y firmó el contrato. Sube el comprobante de depósito para activar el adelanto.</div>
                  <div style={{marginBottom:12}}><DepositReceiptUp receipt={dep} onAdd={function(rc){setDeposit(a,rc);}} onDel={function(){setDeposit(a,null);}}/></div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={function(){activateDeposit(a);}} disabled={!dep} style={{flex:1,minWidth:150,padding:"11px",borderRadius:100,border:"none",background:dep?C.green:C.gray,color:"#fff",fontSize:12.5,fontWeight:700,cursor:dep?"pointer":"not-allowed"}}>Activar adelanto</button>
                    <button onClick={function(){setPreview(a);}} style={{padding:"11px 18px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Ver contrato</button>
                    <button onClick={function(){delAdv(a);}} title="Eliminar" style={{padding:"11px 14px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,cursor:"pointer"}}><Icon name="trash" size={15} stroke={C.earth}/></button>
                  </div>
                </div>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Esperando al técnico (adelanto iniciado por el admin, sin firmar aún) */}
      {pendTec.length>0&&(
        <div style={{marginBottom:26}}>
          <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:12}}>Esperando al técnico · {pendTec.length}</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {pendTec.map(function(a){ return (
              <div key={a.id} style={{background:C.surfaceWarm,borderRadius:16,border:"1px dashed "+C.gray,padding:"16px 18px"}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"center"}}>
                  <div style={{flex:1,minWidth:160}}>
                    <div style={{fontSize:15,fontWeight:700,color:C.black}}>{a.vendorName||a.vendorEmail}</div>
                    <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>Le enviaste una solicitud. Debe subir su DPI y firmar el contrato.</div>
                  </div>
                  <div style={{display:"flex",gap:14,alignItems:"center"}}>
                    <AdvStat label="Monto" value={"Q"+(a.monto||0).toLocaleString()}/>
                    <button onClick={function(){delAdv(a);}} title="Cancelar solicitud" style={{padding:"9px 14px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.red,fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
                  </div>
                </div>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Pending requests */}
      {pend.length>0&&(
        <div style={{marginBottom:26}}>
          <div style={{fontSize:10,fontWeight:700,color:C.orange,letterSpacing:".18em",textTransform:"uppercase",marginBottom:12}}>Solicitudes pendientes · {pend.length}</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {pend.map(function(a){ return (
              <div key={a.id} style={{background:"#fff",borderRadius:16,border:"1.5px solid "+C.orange+"55",overflow:"hidden",boxShadow:"0 4px 16px rgba(62,63,63,.05)"}}>
                <div style={{padding:"16px 18px",display:"flex",flexWrap:"wrap",gap:14,alignItems:"center"}}>
                  <div style={{flex:1,minWidth:160}}>
                    <div style={{fontSize:15,fontWeight:700,color:C.black}}>{a.vendorName||a.vendorEmail}</div>
                    <div style={{fontSize:11.5,color:C.earth,marginTop:2}}>DPI {a.dpiNumber||"—"}</div>
                  </div>
                  <div style={{display:"flex",gap:18}}>
                    <AdvStat label="Monto" value={"Q"+(a.monto||0).toLocaleString()}/>
                    <AdvStat label="Semanal" value={"Q"+(a.cobroSemanal||0).toLocaleString()} accent/>
                    <AdvStat label="Cuotas" value={a.cuotas}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,padding:"0 18px 16px",flexWrap:"wrap"}}>
                  <button onClick={function(){approve(a);}} style={{flex:1,minWidth:120,padding:"11px",borderRadius:100,border:"none",background:C.green,color:"#fff",fontSize:12.5,fontWeight:700,cursor:"pointer"}}>Aprobar y activar</button>
                  <button onClick={function(){setPreview(a);}} style={{padding:"11px 18px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Ver contrato</button>
                  <button onClick={function(){reject(a);}} style={{padding:"11px 18px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.red,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Rechazar</button>
                </div>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Active advances */}
      <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:12}}>Adelantos activos · {active.length}</div>
      {active.length===0&&<div style={{textAlign:"center",padding:"30px",color:C.earth,fontSize:13}}>No hay adelantos activos.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {active.map(function(a){ var st=advanceState(a,reps); var pct=st.monto>0?Math.round(st.debited/st.monto*100):0; var avgPay=avgWeekPay(reps,a.vendorEmail); var pctPay=avgPay>0?Math.round(st.semanal/avgPay*100):0; var nextK=nextChargeableWeek(a,reps); var pausasFut=(a.pausas||[]).filter(function(k){ var w=st.weeks[k]; return !(w&&w.n>0&&w.paid===w.n); }); return (
          <div key={a.id} style={{background:"#fff",borderRadius:16,border:"1px solid "+C.line,overflow:"hidden",boxShadow:"0 4px 16px rgba(62,63,63,.05)"}}>
            <div style={{padding:"16px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:14,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:C.black}}>{a.vendorName||a.vendorEmail}{!a.vendorEmail&&<span style={{fontSize:9,fontWeight:700,color:C.red,background:"#F5EDEC",padding:"2px 7px",borderRadius:100,marginLeft:8,letterSpacing:".06em"}}>SIN LIGAR</span>}</div>
                  <div style={{fontSize:11,color:C.earth,marginTop:2}}>Inicio {fmtDMY(advStart(a))}{a.dpiNumber?" \u00b7 DPI "+a.dpiNumber:""}{a.unified?" \u00b7 "+advContracts(a).length+" contratos unificados":""}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase"}}>Saldo</div>
                  <div style={{fontSize:20,fontWeight:700,color:C.black}}>Q{st.saldo.toLocaleString()}</div>
                </div>
              </div>
              {/* progress */}
              <div style={{height:6,borderRadius:100,background:C.surfaceWarm,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:pct+"%",background:C.green,borderRadius:100,transition:"width .3s"}}/></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.earth,marginBottom:12,flexWrap:"wrap",gap:6}}>
                <span>{st.paidWeeks} / {st.cuotas} cuotas · Q{st.debited.toLocaleString()} debitado{st.revertido>0?" · Q"+st.revertido.toLocaleString()+" revertido":""}</span>
                <span style={{color:C.peach,fontWeight:700}}>Q{st.weeklyCharge.toLocaleString()} / semana{pctPay>0?" \u00b7 "+pctPay+"% del pago":""}</span>
              </div>
              {/* próximo cobro / pausas */}
              <div style={{background:C.surfaceWarm,borderRadius:10,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.earth,lineHeight:1.6}}>
                <span style={{fontWeight:700,color:C.black}}>Cobro automático.</span> Se debita Q{st.semanal.toLocaleString()} cuando se pagan todos los trabajos de la semana.{nextK&&<> Próximo: <span style={{fontWeight:700,color:C.black}}>{weekLabel(nextK)}</span>.</>}
                {pausasFut.length>0&&<div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}><span style={{fontWeight:700,color:C.orange}}>En pausa:</span>{pausasFut.map(function(k){return <button key={k} onClick={function(){unpauseWeek(a,k);}} title="Reanudar esta semana" style={{fontSize:10,fontWeight:700,color:C.orange,background:"#fff",border:"1px solid "+C.orange+"66",borderRadius:100,padding:"2px 9px",cursor:"pointer"}}>{weekLabel(k)} ×</button>;})}</div>}
              </div>
              {/* Comprobantes de depósito — se ven aquí y en el contrato/recibo */}
              <div style={{marginBottom:12,display:"flex",flexDirection:"column",gap:8}}>
                {advContracts(a).map(function(c,ci){
                  var multi=advContracts(a).length>1;
                  return (
                    <div key={ci}>
                      {multi&&<div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:5}}>Contrato {ci+1} · Q{(c.monto||0).toLocaleString()}</div>}
                      <DepositReceiptUp compact receipt={c.comprobanteDeposito}
                        onAdd={function(rc){setDeposit(a,rc,multi?ci:undefined);}}
                        onDel={function(){setDeposit(a,null,multi?ci:undefined);}}/>
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={function(){pauseNext(a);}} disabled={!nextK} style={{flex:1,minWidth:150,padding:"10px",borderRadius:100,border:"1.5px solid "+(nextK?C.orange:C.gray),background:"#fff",color:nextK?C.orange:C.gray,fontSize:12,fontWeight:700,cursor:nextK?"pointer":"not-allowed"}}>Pausar próximo cobro</button>
                <button onClick={function(){setPreview(a);}} style={{padding:"10px 16px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12,fontWeight:600,cursor:"pointer"}}>Contrato</button>
                <button onClick={function(){setAdjust(adjust===a.id?null:a.id);}} style={{padding:"10px 16px",borderRadius:100,border:"1.5px solid "+(adjust===a.id?C.black:C.gray),background:adjust===a.id?C.black:"#fff",color:adjust===a.id?"#fff":C.black,fontSize:12,fontWeight:600,cursor:"pointer"}}>Ajustar</button>
                <button onClick={function(){delAdv(a);}} title="Eliminar" style={{padding:"10px 14px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:12,cursor:"pointer"}}><Icon name="trash" size={15} stroke={C.earth}/></button>
              </div>
              {adjust===a.id&&<AdvAdjustPanel adv={a} st={st} onUpdate={function(p){update(a.id,p);}}/>}
            </div>
          </div>
        );})}
      </div>

      {/* History */}
      {done.length>0&&(
        <div style={{marginTop:26}}>
          <div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase",marginBottom:12}}>Historial · {done.length}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {done.map(function(a){ return (
              <div key={a.id} style={{background:C.surfaceWarm,borderRadius:12,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",border:"1px solid "+C.line}}>
                <div><div style={{fontSize:13,fontWeight:600,color:C.black}}>{a.vendorName||a.vendorEmail}</div><div style={{fontSize:11,color:C.earth}}>Q{(a.monto||0).toLocaleString()}</div></div>
                <span style={{fontSize:11,fontWeight:700,letterSpacing:".06em",padding:"3px 10px",borderRadius:100,background:a.status==="pagado"?"#EDF5EF":"#F5EDEC",color:a.status==="pagado"?C.green:C.red}}>{a.status==="pagado"?"Pagado":"Rechazado"}</span>
              </div>
            );})}
          </div>
        </div>
      )}

      {preview&&<ContractModal adv={preview} onClose={function(){setPreview(null);}}/>}
      {creating&&<AdvanceCreateModal vendors={vendors} reps={reps} adelantos={list} onCreate={createAdv} onClose={function(){setCreating(false);}}/>}
    </div>
  );
}

/* ─── Admin: crear un adelanto directamente (para técnicos internos).
   Respeta el mismo límite dinámico que la solicitud del técnico (½ de las últimas 8 semanas,
   menos lo que ya tiene vigente). Queda ACTIVO de inmediato (el admin ya lo autorizó). */
function AdvanceCreateModal({vendors, reps, adelantos, onCreate, onClose}){
  var internos = (vendors||[]).filter(isInternalVendor).filter(function(v){return v.active!==false;})
    .sort(function(a,b){return vendorDisplay(a).localeCompare(vendorDisplay(b));});
  const [vid,setVid]     = useState(internos[0]?internos[0].id:"");
  const [monto,setMonto] = useState("");
  const [cuotas,setCuotas]= useState(8);
  const [fecha,setFecha] = useState(todayStr());
  const [dpiNum,setDpiNum]= useState("");
  const [err,setErr]     = useState("");
  var vendor = internos.find(function(v){return v.id===vid;});
  var emails = vendor?vendorEmailSet(vendor):[];
  var sum8   = incomeLast8(reps, emails);
  var maxTotal = Math.floor(sum8/2);
  var vigentes = (adelantos||[]).filter(function(a){return (a.status==="activo"||a.status==="pendiente") && emails.indexOf((a.vendorEmail||"").toLowerCase().trim())>=0;});
  var saldoVigente = vigentes.reduce(function(s,a){return s+(a.status==="activo"?advanceState(a,reps).saldo:(parseFloat(a.monto)||0));},0);
  var disponible = Math.max(0, maxTotal - saldoVigente);
  var montoN = parseFloat(monto||0)||0;
  var semanal = cuotas>0?Math.ceil(montoN/cuotas):0;
  var ok = vendor && montoN>0 && montoN<=disponible;
  function crear(){
    setErr("");
    if(!vendor) return setErr("Elige un técnico interno.");
    if(!(montoN>0)) return setErr("Ingresa el monto del adelanto.");
    if(montoN>disponible) return setErr("El monto excede el disponible del técnico (Q"+disponible.toLocaleString()+").");
    /* Adelanto iniciado por el admin: primero le llega al TÉCNICO para subir DPI y firmar.
       Queda 'pendiente_tecnico' (NO cobra) hasta que el técnico complete y el admin deposite. */
    var adv={id:"adv_"+Date.now(), vendorEmail:vendor.email, vendorName:vendorDisplay(vendor), dpiNumber:dpiNum||"", dpiPhoto:null, firma:null,
      monto:montoN, cuotas:cuotas, cobroSemanal:semanal, fechaDeposito:fecha,
      status:"pendiente_tecnico", createdAt:Date.now(), pausas:[], creadoPorAdmin:true};
    adv.contractText=buildContractText(adv);
    onCreate(adv);
    onClose();
  }
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(62,63,63,.45)",backdropFilter:"blur(4px)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"5vh 16px",overflowY:"auto"}}>
      <div onClick={function(e){e.stopPropagation();}} style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:460,padding:"24px",fontFamily:"Montserrat,sans-serif",boxShadow:"0 28px 80px rgba(62,63,63,.18)"}} className="f">
        <div style={{fontSize:9.5,fontWeight:600,color:C.earth,letterSpacing:".24em",textTransform:"uppercase",marginBottom:6}}>Nuevo adelanto</div>
        <div style={{fontFamily:"'Valky','Cormorant Garamond',serif",fontSize:23,color:C.black,marginBottom:18}}>Crear adelanto</div>
        {internos.length===0 ? (
          <div style={{fontSize:13,color:C.earth,lineHeight:1.6,padding:"10px 0 20px"}}>No hay técnicos internos registrados.</div>
        ) : (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <F label="Técnico interno"><select value={vid} onChange={function(e){setVid(e.target.value);setErr("");}}>{internos.map(function(v){return <option key={v.id} value={v.id}>{vendorDisplay(v)}{v.categoria?" · "+v.categoria:""}</option>;})}</select></F>
          <div style={{background:C.black,borderRadius:14,padding:"14px 16px",color:"#fff"}}>
            <div style={{fontSize:9,fontWeight:600,letterSpacing:".2em",textTransform:"uppercase",opacity:.7,marginBottom:5}}>Disponible para este técnico</div>
            <div style={{fontSize:26,fontWeight:600,color:disponible>0?"#fff":C.peach}}>Q{disponible.toLocaleString()}</div>
            <div style={{fontSize:10.5,opacity:.62,marginTop:6,lineHeight:1.6}}>Máx. (½ de últimas 8 semanas, Q{sum8.toLocaleString()}): <b style={{color:"#fff"}}>Q{maxTotal.toLocaleString()}</b>{saldoVigente>0?" · Vigente: Q"+saldoVigente.toLocaleString():""}</div>
          </div>
          <F label={"Monto (máx. Q"+disponible.toLocaleString()+")"}><input type="number" inputMode="numeric" value={monto} placeholder={"Ej. "+Math.min(500,disponible||500)} onChange={function(e){setMonto(e.target.value);setErr("");}}/></F>
          <div>
            <div style={{fontSize:10,fontWeight:600,color:C.earth,letterSpacing:".2em",textTransform:"uppercase",marginBottom:9}}>Cuotas semanales — máx. 16</div>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <input type="range" min="1" max="16" value={cuotas} onChange={function(e){setCuotas(parseInt(e.target.value));}} style={{flex:1,accentColor:C.peach}}/>
              <span style={{fontSize:15,fontWeight:700,color:C.black,minWidth:64,textAlign:"right"}}>{cuotas} sem.</span>
            </div>
          </div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:150}}><F label="Fecha del depósito"><input type="date" value={fecha} onChange={function(e){setFecha(e.target.value);}}/></F></div>
            <div style={{flex:1,minWidth:150}}><F label="DPI (opcional)"><input value={dpiNum} onChange={function(e){setDpiNum(e.target.value);}} placeholder="0000 00000 0000" inputMode="numeric"/></F></div>
          </div>
          {montoN>0&&(
            <div style={{background:C.peach12||"rgba(233,130,106,.12)",borderRadius:12,padding:"12px 15px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,color:C.black,fontWeight:600}}>Descuento semanal automático</span><span style={{fontSize:17,fontWeight:700,color:C.peach}}>Q{semanal.toLocaleString()}</span>
            </div>
          )}
          {err&&<Err msg={err}/>}
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <button onClick={onClose} style={{flex:1,padding:"13px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.earth,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
            <button onClick={crear} disabled={!ok} style={{flex:2,padding:"13px",borderRadius:100,border:"none",background:ok?C.green:C.gray,color:"#fff",fontSize:13,fontWeight:700,cursor:ok?"pointer":"not-allowed"}}>Enviar al técnico →</button>
          </div>
          <div style={{fontSize:10.5,color:C.earth,textAlign:"center",lineHeight:1.6}}>Le llegará al técnico para que suba su DPI y firme el contrato. Cuando firme, sube el comprobante de depósito para activarlo.</div>
        </div>
        )}
      </div>
    </div>
  );
}

/* ─── Panel de ajustes de un adelanto: editar cuota semanal + revertir cobros */
function AdvAdjustPanel({adv, st, onUpdate}) {
  const [semanal, setSemanal]  = useState(String(adv.cobroSemanal||""));
  const [revMonto,setRevMonto] = useState(String(adv.cobroSemanal||""));
  const [revNota, setRevNota]  = useState("");
  var ajustes = adv.ajustes||[];
  var semVal  = parseFloat(semanal)||0;
  var revVal  = parseFloat(revMonto)||0;
  var semDis  = !(semVal>0)||semVal===parseFloat(adv.cobroSemanal||0);
  var revDis  = !(revVal>0)||revVal>st.debited;
  function saveSemanal(){
    if(semDis) return;
    /* Congela lo debitado a hoy con la cuota vieja; la nueva cuota solo aplica a semanas
       futuras. El saldo NO cambia por ajustar la cuota (bug #6). */
    var monto=parseFloat(adv.monto||0)||0;
    var frozen=Math.min(monto, (st.debited||0) + (st.revertido||0));
    onUpdate({cobroSemanal:semVal, frozenDebited:frozen, frozenWeeks:st.paidWeeks});
  }
  function revertir(){
    if(revDis) return;
    onUpdate({ajustes: ajustes.concat([{id:"aj"+Date.now(),fecha:todayStr(),monto:revVal,nota:revNota||"Reversión manual"}])});
    setRevNota("");
  }
  function rmAjuste(id){ onUpdate({ajustes: ajustes.filter(function(x){return x.id!==id;})}); }
  return (
    <div style={{marginTop:12,background:C.surfaceWarm,borderRadius:12,padding:"14px",border:"1px solid "+C.line,display:"flex",flexDirection:"column",gap:14}}>
      <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".18em",textTransform:"uppercase"}}>Ajustes del administrador</div>
      <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:130}}>
          <F label="Cuota semanal (Q)"><input type="number" min="1" value={semanal} onChange={function(e){setSemanal(e.target.value);}}/></F>
        </div>
        <button onClick={saveSemanal} disabled={semDis} style={{padding:"12px 16px",borderRadius:8,border:"none",background:C.black,color:"#fff",fontSize:12,fontWeight:700,cursor:semDis?"not-allowed":"pointer",opacity:semDis?.4:1}}>Guardar cuota</button>
      </div>
      <div style={{borderTop:"1px solid "+C.line,paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
        <div style={{fontSize:11.5,color:C.earth,lineHeight:1.5}}>Revertir un cobro previo: el monto regresa al <strong>saldo pendiente</strong> del técnico (p. ej. si una semana se debitó por error). Puedes revertir la cuota completa o una cantidad específica.</div>
        <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div style={{width:110}}><F label="Monto (Q)"><input type="number" min="1" value={revMonto} onChange={function(e){setRevMonto(e.target.value);}}/></F></div>
          <div style={{flex:1,minWidth:140}}><F label="Nota"><input type="text" placeholder="Motivo de la reversión…" value={revNota} onChange={function(e){setRevNota(e.target.value);}}/></F></div>
          <button onClick={revertir} disabled={revDis} style={{padding:"12px 16px",borderRadius:8,border:"1.5px solid "+C.orange,background:"#fff",color:C.orange,fontSize:12,fontWeight:700,cursor:revDis?"not-allowed":"pointer",opacity:revDis?.4:1}}>↩ Revertir</button>
        </div>
        {revVal>st.debited&&<div style={{fontSize:11,color:C.red}}>El monto no puede ser mayor a lo debitado (Q{st.debited.toLocaleString()}).</div>}
      </div>
      {ajustes.length>0&&(
        <div style={{borderTop:"1px solid "+C.line,paddingTop:12,display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase"}}>Reversiones aplicadas</div>
          {ajustes.map(function(x){return (
            <div key={x.id} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",border:"1px solid "+C.line,borderRadius:8,padding:"8px 12px"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:700,color:C.orange}}>↩ Q{(parseFloat(x.monto)||0).toLocaleString()}</div>
                <div style={{fontSize:10.5,color:C.earth}}>{fmtDate(x.fecha)}{x.nota?" · "+x.nota:""}</div>
              </div>
              <button onClick={function(){rmAjuste(x.id);}} title="Deshacer reversión" style={{background:"none",border:"1px solid "+C.gray,borderRadius:6,color:C.earth,fontSize:11,fontWeight:600,padding:"3px 9px",cursor:"pointer"}}>Deshacer</button>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

function GS() {
  var css = "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Montserrat:wght@300;400;500;600;700&display=swap');"
    + "@font-face{font-family:'Valky';src:url('/fonts/Valky-Light.otf') format('opentype');font-weight:300;font-style:normal;font-display:swap;}"
    + "@font-face{font-family:'Valky';src:url('/fonts/Valky-Regular.otf') format('opentype');font-weight:400;font-style:normal;font-display:swap;}"
    + "@font-face{font-family:'Valky';src:url('/fonts/Valky-Semibold.otf') format('opentype');font-weight:600;font-style:normal;font-display:swap;}"
    + "@font-face{font-family:'Valky';src:url('/fonts/Valky-Bold.otf') format('opentype');font-weight:700;font-style:normal;font-display:swap;}"
    + "*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}"
    + "body{background:#FAFAFA;font-family:'Montserrat',sans-serif;}"
    + "button,input,select,textarea{font-family:'Montserrat',sans-serif;letter-spacing:.03em;}"
    + "textarea{resize:vertical;}"
    + "button{cursor:pointer;}"
    + ".rh{cursor:pointer;transition:background .15s;}"
    + ".rh:hover{background:#F5F3F0!important;}"
    + ".rh:active{background:#EFEBE6!important;}"
    + ".f label{display:block;font-size:10px;font-weight:600;color:#938B8A;letter-spacing:.2em;text-transform:uppercase;margin-bottom:7px;}"
    + ".f input,.f select,.f textarea{width:100%;border:1px solid #D8D4CE;border-radius:6px;padding:12px 14px;font-size:14px;color:#3E3F3F;background:#fff;outline:none;transition:border-color .2s,box-shadow .2s;-webkit-appearance:none;appearance:none;}"
    + ".f input:focus,.f select:focus,.f textarea:focus{border-color:#938B8A;box-shadow:0 0 0 3px rgba(147,139,138,.10);}"
    + "::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#D8D4CE;border-radius:3px;}"
    + "::placeholder{color:#B7B0AE;}"
    + "@media(max-width:639px){.hide-mobile{display:none!important;}.table-cols{grid-template-columns:1fr auto!important;}}"
    + "@media(max-width:639px){.filter-cols{grid-template-columns:1fr 1fr!important;}}"
    + "@media(max-width:639px){.chart-side{grid-template-columns:1fr!important;}}"
    + "@media(max-width:639px){.stat-row{gap:10px!important;flex-wrap:wrap!important;}}"
    + "input[type=date]{min-height:44px;}"
    + "select{min-height:40px;padding-right:36px;position:relative;}"
    + "button:active{transform:scale(.98);}"
    + ".card-hover:hover{box-shadow:0 4px 16px rgba(0,0,0,.07)!important;transform:translateY(-1px);transition:all .2s;}"
    + "input[type=date]::-webkit-calendar-picker-indicator{opacity:.5;cursor:pointer;}";
  return <style>{css}</style>;
}

function Card({title,children,accent}) { return <div style={{background:"#fff",borderRadius:8,padding:"18px",border:"1px solid "+(accent?accent:C.gray),boxShadow:"0 1px 4px rgba(0,0,0,.04)",transition:"box-shadow .2s"}}><div style={{fontSize:9,fontWeight:600,color:accent?accent:C.earth,letterSpacing:".24em",textTransform:"uppercase",marginBottom:14,paddingBottom:10,borderBottom:"1px solid "+(accent?accent+"40":C.line)}}>{title}</div>{children}</div>; }
function F({label,children}) { return <div className="f"><label>{label}</label>{children}</div>; }
function BigBtn({onClick,dis,children}) { return <button onClick={onClick} disabled={dis} style={{width:"100%",padding:"17px",borderRadius:6,border:"none",background:dis?C.gray:C.black,color:"#fff",fontSize:12,fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",cursor:dis?"not-allowed":"pointer",transition:"all .2s",opacity:dis?.5:1,minHeight:52}}>{children}</button>; }
function Stat({label,value,green,warn,peach,sub}) { return <div><div style={{fontSize:10,fontWeight:700,color:C.earth,letterSpacing:".14em",textTransform:"uppercase",marginBottom:3}}>{label}</div><div style={{fontSize:20,fontWeight:600,color:peach?C.peach:green?C.green:warn?C.red:C.black}}>{value}</div>{sub&&<div style={{fontSize:10,color:C.earth,marginTop:1}}>{sub}</div>}</div>; }
function Sep() { return <div style={{width:1,height:30,background:C.gray}}/>; }
/* Bloque de estadísticas: valor NETO destacado + chip "en curso" + desglose expandible.
   Separa lo pagable (semanas anteriores) de la semana en curso para dar claridad al pago. */
function StatsSummary({heroLabel, heroValue, heroGreen, enCursoCount, enCursoMonto, items, defaultOpen}){
  const [open,setOpen]=useState(!!defaultOpen);
  return (
    <div style={{background:"#fff",borderBottom:"1px solid "+C.line,padding:"16px 18px"}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
        <div style={{minWidth:0}}>
          <div style={{fontSize:9.5,fontWeight:700,color:C.earth,letterSpacing:".16em",textTransform:"uppercase",marginBottom:6,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
            <span>{heroLabel}</span>
            <span style={{fontWeight:500,letterSpacing:".02em",color:C.earth,textTransform:"none",fontSize:10.5}}>semanas anteriores</span>
          </div>
          <div style={{fontSize:34,fontWeight:600,letterSpacing:"-.02em",color:heroGreen?C.green:C.black,lineHeight:1}}>{heroValue}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {enCursoMonto>0&&(
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",paddingRight:12,borderRight:"1px solid "+C.line}}>
              <span style={{fontSize:8.5,fontWeight:700,color:C.peach,letterSpacing:".14em",textTransform:"uppercase",marginBottom:2}}>En curso</span>
              <span style={{fontSize:15,fontWeight:700,color:C.black}}>Q{Math.round(enCursoMonto).toLocaleString()}</span>
              <span style={{fontSize:9.5,color:C.earth}}>{enCursoCount} trab. · aún no pagable</span>
            </div>
          )}
          <button onClick={function(){setOpen(function(p){return !p;});}} style={{display:"flex",alignItems:"center",gap:6,background:open?C.black:"#fff",color:open?"#fff":C.black,border:"1.5px solid "+(open?C.black:C.gray),borderRadius:100,padding:"8px 14px",fontSize:11,fontWeight:600,cursor:"pointer",transition:"all .2s",whiteSpace:"nowrap"}}>
            Desglose <Icon name="chevronDown" size={13} stroke={open?"#fff":C.black} style={{transform:open?"rotate(180deg)":"none",transition:"transform .2s"}}/>
          </button>
        </div>
      </div>
      {open&&(
        <div style={{marginTop:16,paddingTop:16,borderTop:"1px solid "+C.line,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:16}}>
          {items.filter(Boolean).map(function(it,i){ return (
            <div key={i}>
              <div style={{fontSize:9,fontWeight:700,color:C.earth,letterSpacing:".13em",textTransform:"uppercase",marginBottom:4}}>{it.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:it.peach?C.peach:(it.green?C.green:C.black)}}>{it.value}</div>
              {it.sub&&<div style={{fontSize:10,color:C.earth,marginTop:2}}>{it.sub}</div>}
            </div>
          );})}
        </div>
      )}
    </div>
  );
}
function Tile({label,value,accent}) { return <div style={{background:C.surfaceWarm,borderRadius:6,padding:"12px 14px",border:"1px solid "+C.line}}><div style={{fontSize:9,color:C.earth,fontWeight:600,letterSpacing:".18em",textTransform:"uppercase",marginBottom:5}}>{label}</div><div style={{fontSize:14,fontWeight:600,color:accent?C.taupe:C.black}}>{value}</div></div>; }
function Overlay({onClick,children}) { return <div onClick={onClick} style={{position:"fixed",inset:0,background:"rgba(62,63,63,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}>{children}</div>; }
function Err({msg}) { return <div style={{fontSize:12,color:C.red,background:"#F5EDEC",padding:"9px 12px",borderRadius:8,lineHeight:1.4}}>{msg}</div>; }
function Loader() {
  const [secs, setSecs] = useState(0);
  useEffect(function(){
    var t = setInterval(function(){setSecs(function(s){return s+1;});},1000);
    return function(){clearInterval(t);};
  },[]);
  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.alabaster,gap:20}}>
      <LogoWordmark width={180}/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
        <div style={{fontSize:9.5,color:C.taupe,letterSpacing:".22em",textTransform:"uppercase",fontFamily:"Montserrat,sans-serif"}}>
          {secs<4?"Conectando con Google Sheets…":secs<8?"Esto puede tardar unos segundos…":"Verificando conexión…"}
        </div>
        <div style={{display:"flex",gap:6,marginTop:4}}>
          {[0,1,2].map(function(i){return <div key={i} style={{width:6,height:6,borderRadius:"50%",background:C.earth,opacity:.4}}/>;}) }
        </div>
        {secs>=7&&(
          <div style={{marginTop:12,fontSize:11,color:C.taupe,fontFamily:"Montserrat,sans-serif",textAlign:"center",maxWidth:260,lineHeight:1.7}}>
            Primera carga puede tardar ~10 seg.<br/>
            <span style={{fontSize:10,opacity:.7}}>El app cargará automáticamente.</span>
          </div>
        )}
      </div>
    </div>
  );
}
function SyncBanner({msg}) {
  return (
    <div style={{position:"fixed",bottom:72,left:"50%",transform:"translateX(-50%)",zIndex:300,background:C.black,color:"#fff",borderRadius:100,padding:"10px 20px",fontSize:12,fontWeight:600,letterSpacing:".06em",display:"flex",alignItems:"center",gap:10,boxShadow:"0 4px 20px rgba(0,0,0,.25)",whiteSpace:"nowrap"}}>
      <div style={{width:8,height:8,borderRadius:"50%",background:C.sand,flexShrink:0}}/>
      {msg||"Sincronizando con Google…"}
    </div>
  );
}
function ConfirmDel({onCancel,onConfirm}) {
  return (
    <div style={{background:"#fff",borderRadius:8,padding:"28px 30px",maxWidth:300,textAlign:"center",boxShadow:"0 16px 48px rgba(0,0,0,.16)"}}>
      <div style={{fontSize:34,marginBottom:12}}>🗑</div>
      <div style={{fontSize:15,fontWeight:600,color:C.black,marginBottom:6}}>¿Eliminar registro?</div>
      <div style={{fontSize:13,color:C.earth,marginBottom:22,lineHeight:1.5}}>Esta acción no se puede deshacer.</div>
      <div style={{display:"flex",gap:10,justifyContent:"center"}}>
        <button onClick={onCancel}  style={{padding:"9px 18px",borderRadius:100,border:"1.5px solid "+C.gray,background:"#fff",color:C.black,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
        <button onClick={onConfirm} style={{padding:"9px 18px",borderRadius:100,border:"none",background:C.red,color:"#fff",fontSize:12.5,fontWeight:600,cursor:"pointer"}}>Eliminar</button>
      </div>
    </div>
  );
}
function DropF({label,value,options,onChange,active}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <span style={{fontSize:10.5,fontWeight:700,color:active?C.black:C.earth,letterSpacing:".1em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{label}</span>
      <select value={value} onChange={function(e){onChange(e.target.value);}} style={{border:"1px solid "+(active?C.black:C.gray),borderRadius:6,padding:"6px 10px",fontSize:12,color:active?C.black:C.earth,background:"#fff",outline:"none",fontFamily:"Montserrat,sans-serif",cursor:"pointer",fontWeight:active?600:400,transition:"all .2s",letterSpacing:".03em"}}>
        {options.map(function(o){return <option key={o}>{o}</option>;})}
      </select>
    </div>
  );
}
function ChipBtn({active,onClick,children,color}) {
  var ac=color||C.black;
  return <button onClick={onClick} style={{padding:"6px 13px",borderRadius:6,border:"1px solid "+(active?ac:C.gray),background:active?ac:"#fff",color:active?"#fff":C.earth,fontSize:11.5,fontWeight:600,cursor:"pointer",transition:"all .2s",whiteSpace:"nowrap",letterSpacing:".03em"}}>{children}</button>;
}
function PicUp({label,max,photos,accent,onAdd,onDel}) {
  var ref=useRef(null);
  return (
    <div>
      <div style={{fontSize:10.5,fontWeight:700,color:accent,letterSpacing:".14em",textTransform:"uppercase",marginBottom:10}}>Fotos {label} <span style={{color:C.earth,fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10}}>máx. {max}</span></div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {photos.map(function(src,i){ return <div key={i} style={{position:"relative",width:84,height:84,borderRadius:11,overflow:"hidden",border:"2px solid "+accent+"30"}}><img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/><button onClick={function(){onDel(i);}} style={{position:"absolute",top:3,right:3,width:20,height:20,borderRadius:"50%",border:"none",background:"rgba(0,0,0,.55)",color:"#fff",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",lineHeight:1}}>×</button></div>; })}
        {photos.length<max&&<button onClick={function(){if(ref.current)ref.current.click();}} style={{width:84,height:84,borderRadius:11,border:"2px dashed "+accent+"50",background:C.beige,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer"}}><span style={{fontSize:22,color:accent}}>+</span><span style={{fontSize:10,color:C.earth,fontWeight:600}}>Subir</span></button>}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files.length)onAdd(e.target.files);e.target.value="";}}/>
    </div>
  );
}
function PicsRow({title,photos,accent}) { return <div><div style={{fontSize:10,color:accent||C.earth,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",marginBottom:10}}>{title}</div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{photos.map(function(src,i){return <img key={i} src={src} alt="" style={{width:110,height:90,objectFit:"cover",borderRadius:9,border:"1px solid "+C.gray}}/>;})}</div></div>; }
function InvoiceUp({factura,onAdd,onDel}) {
  var ref=useRef(null);
  return (
    <div>
      {factura ? (
        <div style={{display:"flex",alignItems:"center",gap:12,background:C.surface,borderRadius:8,padding:"12px 14px",border:"1px solid "+C.line}}>
          <span style={{fontSize:20}}>{factura.type&&factura.type.startsWith("image/")?"🖼️":"📄"}</span>
          <span style={{fontSize:13,fontWeight:600,color:C.black,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{factura.name}</span>
          <button onClick={onDel} style={{background:"none",border:"none",color:C.red,fontSize:18,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
        </div>
      ) : (
        <button onClick={function(){if(ref.current)ref.current.click();}} style={{width:"100%",padding:"14px",borderRadius:10,border:"2px dashed "+C.gray,background:C.beige,display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",fontSize:13,color:C.earth,fontFamily:"Montserrat,sans-serif",fontWeight:600}}>
          <span style={{fontSize:20}}>📎</span>Adjuntar factura (PDF o imagen)
        </button>
      )}
      <input ref={ref} type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={function(e){if(e.target.files&&e.target.files[0])onAdd(e.target.files[0]);e.target.value="";}}/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
