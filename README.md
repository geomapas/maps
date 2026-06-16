# GEOmapas — Estructura de módulos

Aplicación GIS para técnicos de campo en Castilla-La Mancha.

## Archivos

```
geomapas/
├── index.html              ← HTML puro + referencias a JS/CSS
├── css/
│   └── styles.css          ← Todo el CSS (~1764 líneas)
└── js/
    ├── config.js            ← 'use strict', configuración base
    ├── mapa.js              ← Mapa Leaflet, basemaps, ortofoto, watermark
    ├── capas-sigpac.js      ← WMS recintos/cultivo + config capas iniciales
    ├── fotos.js             ← EXIF, marcadores SVG, clusters, enlace público
    ├── sidebar.js           ← Panel unificado + lightbox
    ├── consulta-wms.js      ← Popup recinto/cultivo, búsqueda SIGPAC, geoloc GPS
    ├── capas-shp.js         ← addShpLayer, cloud sync Firestore, árbol geometrías
    ├── shp-writer.js        ← Generador binario SHP embebido
    ├── txt-import.js        ← Importación TXT códigos SIGPAC
    ├── draw.js              ← Herramienta dibujo, medición, GPS track
    ├── firebase.js          ← Firebase Auth + Firestore sync
    ├── movil.js             ← UX móvil completa, bottom sheets
    ├── gps-desktop.js       ← Herramienta GPS measure desktop
    ├── ui.js                ← Init global, draw bar, drag&drop, ganadería, etiquetas, modal edición
    ├── seleccion.js         ← Herramienta selección para generar SHP
    ├── checklist.js         ← Checklist visitado + observaciones
    └── mapa3d.js            ← Vista 3D MapLibre
```

## Qué módulo modificar según la tarea

| Tarea | Módulo(s) |
|-------|-----------|
| Añadir capa WMS nueva | `capas-sigpac.js` |
| Cambiar popup de consulta recinto/cultivo | `consulta-wms.js` |
| Modificar checklist / visitado / observaciones | `checklist.js` |
| Cambiar cómo se cargan capas SHP | `capas-shp.js` |
| Exportar SHP o KML | `capas-shp.js` + `shp-writer.js` |
| Búsqueda ganadería | `ui.js` (sección GANADERÍA) |
| Etiquetas sobre mapa | `ui.js` (sección ETIQUETAS) |
| Modal edición de capa | `ui.js` (sección MODAL EDICIÓN) |
| Herramienta de dibujo/medición | `draw.js` |
| Panel móvil / bottom sheets | `movil.js` |
| GPS de campo | `consulta-wms.js` (desktop: `gps-desktop.js`) |
| Vista 3D | `mapa3d.js` |
| Importar TXT con recintos | `txt-import.js` |
| Fotos con EXIF | `fotos.js` |
| Estilos / colores / layout | `css/styles.css` |
| HTML del panel / botones | `index.html` |

## Flujo de trabajo con IA

1. Describe qué quieres cambiar
2. La IA indica qué módulo(s) afecta
3. Sube solo ese archivo (~200-700 líneas)
4. Recibes solo ese archivo modificado

## Hosting

GitHub Pages sirve los archivos estáticos directamente.  
**Importante**: nunca abrir `index.html` como `file://` local — usar siempre GitHub Pages o un servidor local (Live Server de VS Code, por ejemplo).
