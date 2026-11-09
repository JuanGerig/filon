# Filón

Comparador de campañas de clipping en español. Página estática que se regenera cada día a partir de la base de Airtable **Filón**.

## Cómo funciona

1. Las campañas viven en Airtable (tablas `Campañas` y `Plataformas`). Solo se publican las que tienen **Activa** marcada y presupuesto restante.
2. Cada día a las 6:00 (hora de Venezuela), en cada cambio del repo, o al pulsar **Actions → Publicar Filón → Run workflow**, GitHub lee Airtable, genera `campanas.json` y publica la web en GitHub Pages.
3. Sin el secreto `AIRTABLE_TOKEN` se publican los datos de `datos-ejemplo/`.

## Configuración

`config.json` (público, sin secretos):

| Clave | Qué es |
| --- | --- |
| `airtable_base` | ID de la base Filón en Airtable |
| `posthog_key` | Clave del proyecto de PostHog (empieza por `phc_`). Vacía = sin medición |
| `posthog_host` | `https://us.i.posthog.com` o `https://eu.i.posthog.com` |
| `formulario_url` | Enlace público del formulario "Publica tu campaña" (aparece en el pie) |

Secreto de GitHub (Settings → Secrets and variables → Actions): `AIRTABLE_TOKEN`, un token de Airtable con permiso `data.records:read` sobre la base Filón.

## Qué se mide (PostHog)

`$pageview`, `busqueda`, `filtro`, `orden`, `quitar_filtros`, `clic_campana` (con campaña, plataforma, pago y posición) y `clic_publicar_campana`.

## Regla de datos

Solo campañas públicas copiadas a mano o enviadas por sus dueños o plataformas con acuerdo. Nada que solo se vea con sesión iniciada sin su permiso. Nada de herramientas automáticas sobre Whop o Content Rewards sin permiso escrito.

## Probar en tu PC

```
node scripts/build.mjs          # con datos de ejemplo
npx serve _site
```

Fuentes tipográficas: Archivo y Big Shoulders Display, licencia SIL OFL (ver `sitio/fuentes/`).
