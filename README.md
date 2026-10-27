# Spacio AM — EPI App

Sitio estático para GitHub Pages (sin build). GitHub sirve estos archivos tal cual.

## Archivos
- index.html — página principal (carga app.js)
- app.js — la app completa, ya compilada (no necesita Babel)
- public/fonts/ — tipografía Valky
- apps-script/ — código para pegar en Google Apps Script (referencia)
- CNAME — dominio epi.spacioam.com
- .nojekyll — necesario para que Pages sirva todos los archivos

## Configuración de GitHub Pages
Settings → Pages → Build and deployment → Source: **Deploy from a branch** → main → /(root)

## Cómo se aprueba y se publica
`main` está protegida: todo cambio entra por un pull request y se publica al darle **Merge**.

1. El cambio llega en una rama con su PR (si subes archivos desde la web, elige *Create a new branch and start a pull request*).
2. Dentro del PR corren los robots:
   - **Compilar app** — si cambió `app.jsx`, guarda `app.build.js` en la misma rama.
   - **Asegurar sesión firmada** — si `index.html` perdió `sa-sesion.js`, lo vuelve a poner.
   - **Revisar Apps Script** — si cambió `apps-script/`, revisa sintaxis, JSON y funciones repetidas. Si sale en rojo, no le des Merge.
3. Le das **Merge** y se publica solo:
   - La web (GitHub Pages) en epi.spacioam.com.
   - El Apps Script con **Publicar Apps Script** (clasp), siempre en la misma implementación, así la URL no cambia. Usa el secreto `CLASPRC_JSON`; el `scriptId` está en `.clasp.json`.

Si GitHub marca conflicto solo en `app.build.js` / `app.build.v` (dos PR con cambios en `app.jsx`), quédate con cualquiera de las dos versiones: el robot lo vuelve a compilar en el PR.
