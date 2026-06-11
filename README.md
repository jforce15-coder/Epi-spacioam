# Spacio AM — EPI App (GitHub Pages)

Versión estática **sin build**: se sube tal cual al repositorio y GitHub Pages la sirve directo.
Los datos viven en Google Sheets vía Apps Script (URL configurada dentro de `app.jsx`).

## Cómo actualizar el sitio

1. En el repositorio: **Add file → Upload files**.
2. Arrastra TODO el contenido de esta carpeta (`index.html`, `app.jsx`, `.nojekyll`, `public/`, `apps-script/`).
3. **Commit changes** — GitHub Pages publica solo en 1-2 minutos.

> Pages debe estar activado en Settings → Pages → Deploy from a branch → main / (root).

## Apps Script

En `apps-script/agregar-notificaciones.gs` están los 3 bloques para pegar en el Apps Script:
notificaciones por correo, resumen IA (requiere ANTHROPIC_API_KEY) y tareas programadas
(sync Hospitable 3am/9pm + recuperación de fotos cada hora).

## Últimos cambios (jun 2026)

- Función de Supervisión (rol en Config, revisión del equipo, tablero de daños con urgencia/estado/comentarios).
- Calidad admin: Limpiezas / Daños / Resumen técnicos + "Aprobar todas" + resumen IA.
- Correcciones inmediata/futuro con seguimiento de respuesta del técnico.
- Cuadro de sugerencias en Calidad; Config reorganizado.
- Recuperación de fotos automática; fix de URLs de Hospitable.
- Formulario "Supervisión" (1/día, tarifa del usuario).
- Logo con fondo transparente; daños sin pago; filtro "Semanas anteriores"; ajustes de adelantos; conteo de blancos; fotos obligatorias por espacio.
