# Spacio AM — EPI App

App operativa del Equipo de Primera Impresión (EPI) de Spacio AM.
Frontend en React + Vite. Los datos viven en Google Sheets vía Apps Script (URL configurada en `src/App.jsx` → `SCRIPT_URL`).

## Desarrollo local

```bash
npm install
npm run dev
```

## Build de producción

```bash
npm run build   # genera dist/
```

## Deploy en Vercel

1. Sube este repositorio a GitHub.
2. En Vercel: **New Project → Import** el repo.
3. Framework preset: **Vite** (detectado automáticamente). Build: `npm run build`, Output: `dist`.

## Últimos cambios (jun 2026)

- Logo de login con fondo transparente.
- Subida de fotos resiliente: nunca se pierden URLs ya subidas; reintentos automáticos.
- "Reporte de Daños" ya no genera pago (solo seguimiento) y se crea siempre junto al reporte de limpieza.
- Botón para extraer daños embebidos como reporte independiente.
- Filtro "Semanas anteriores" en Período rápido.
- Adelantos: editar cuota semanal y revertir cobros (total o parcial).
- Inventario: conteo obligatorio de toallas/sábanas + foto si hay piezas en mal estado.
- Fotos obligatorias: 1 por espacio en reportes de limpieza, con alerta y bloqueo de envío.
- Dashboard: nombre del técnico en lugar del correo.
