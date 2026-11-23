# Escuela Galletti - servidor de video

Los videos de la Escuela se guardan en un bucket privado de Cloudflare R2 y los entrega este Worker, solo a quien abre la lección desde Alba con su sesión activa. No se publica ningún archivo .mp4: el video llega en fragmentos HLS de 6 segundos, cada uno con un ticket firmado que vence a las 4 horas y solo sirve para esa lección.

## Costo

Todo cabe en el plan gratuito de Cloudflare:

| Servicio | Gratis cada mes | Uso estimado de la Escuela |
|---|---|---|
| R2 almacenamiento | 10 GB | ~2 GB con 200 videos de 60 s a 720 x 1280 |
| R2 lecturas | 10 millones | ~55.000 (30 personas, 5 videos al día, unos 12 fragmentos por video) |
| R2 salida a internet | Sin costo | - |
| Workers | 100.000 solicitudes por día | ~2.000 por día |

Cloudflare puede pedir registrar una tarjeta al activar R2 la primera vez. Es una verificación: dentro de esos límites no cobra.

## Puesta en marcha (una sola vez)

1. Cree una cuenta de Cloudflare a nombre de la empresa y active R2.
2. En esta carpeta:
   ```
   npx wrangler login
   npx wrangler r2 bucket create galletti-escuela
   npx wrangler secret put TICKET_SECRET
   npx wrangler deploy
   ```
   El valor de `TICKET_SECRET` se obtiene en Supabase (SQL Editor, proyecto galletti-app) con:
   `select valor from esc_config where clave = 'ticket_secret';`
   No lo envíe por chat ni lo guarde en el repositorio.
3. `wrangler deploy` muestra la dirección del Worker (por ejemplo `https://galletti-escuela-video.<cuenta>.workers.dev`).
   En Alba, como central: Escuela > Catálogo > Servidor de video, pegue esa dirección y guarde.
4. Si Alba se publica en otro dominio, agréguelo en `ORIGENES` dentro de `wrangler.toml` y vuelva a ejecutar `npx wrangler deploy`.

## Publicar un video

```
./empaquetar.sh GAL-EV-BIE-001_v1.0_master.mp4 GAL-EV-BIE-001 1.0
```

El script convierte el maestro a HLS 720 x 1280, genera la portada y sube todo a `onb/GAL-EV-BIE-001/v1.0/`. Luego en Alba > Escuela > Catálogo, en la lección, pegue la ruta `onb/GAL-EV-BIE-001/v1.0/index.m3u8` y márquela como vigente.

El maestro .mp4 se guarda en el archivo de la empresa (Drive), nunca en R2 ni en el repositorio.

## Qué protege y qué no

- Protege: nadie sin sesión activa en Alba ve un video; un enlace reenviado por WhatsApp abre Alba y pide usuario y PIN; quien sale de la red pierde el acceso el mismo día; no hay botón ni archivo de descarga.
- No puede impedir que alguien grabe la pantalla o filme el celular. Para eso Alba muestra encima del video una marca de agua con el nombre de la persona, su tienda, la fecha y la hora, que cambia de lugar cada pocos segundos.
