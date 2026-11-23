/* Escuela Galletti - servidor de video.
   Entrega los videos de la Escuela desde un bucket R2 privado, solo a quien trae un ticket firmado por Alba.
   - El ticket lo emite la base (función esc_ticket) a una persona con perfil activo: vale 4 horas y solo para la carpeta de esa lección.
   - Solo se sirven listas HLS (.m3u8) y fragmentos (.ts / .m4s). Nunca un archivo .mp4 completo: no hay nada que descargar de una vez.
   - Las listas se reescriben para que cada fragmento lleve el mismo ticket; sin ticket válido, R2 no entrega nada.
   Plan gratuito de Cloudflare: Workers 100.000 solicitudes por día y R2 10 GB, 10 millones de lecturas al mes, salida sin costo. */

const TIPOS = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  m4s: 'video/iso.segment',
  mp4init: 'video/mp4',
  jpg: 'image/jpeg',
  vtt: 'text/vtt'
};

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function igualSeguro(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function validarTicket(env, ticket, ruta) {
  if (!ticket || ticket.indexOf('.') < 0) return false;
  const [b64, firma] = ticket.split('.');
  let payload;
  try { payload = b64urlDecode(b64); } catch (e) { return false; }
  const esperada = await hmacHex(env.TICKET_SECRET, payload);
  if (!igualSeguro(esperada, firma)) return false;
  const sep = payload.lastIndexOf('|');
  const prefijo = payload.slice(0, sep), exp = parseInt(payload.slice(sep + 1), 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  return ruta.startsWith(prefijo) && !ruta.includes('..');
}

function cors(env, req) {
  const origen = req.headers.get('Origin') || '';
  const permitidos = String(env.ORIGENES || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin' };
  if (permitidos.includes(origen)) { h['Access-Control-Allow-Origin'] = origen; h['Access-Control-Allow-Methods'] = 'GET, OPTIONS'; }
  return h;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const base = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...base, 'Access-Control-Max-Age': '86400' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Método no permitido', { status: 405, headers: base });

    // Ruta: /v/<carpeta de la lección>/<archivo>
    if (!url.pathname.startsWith('/v/')) return new Response('No encontrado', { status: 404, headers: base });
    const ruta = decodeURIComponent(url.pathname.slice(3));
    const ext = (ruta.split('.').pop() || '').toLowerCase();
    if (!['m3u8', 'ts', 'm4s', 'jpg', 'vtt'].includes(ext) && !/init\.mp4$/.test(ruta)) {
      return new Response('Formato no disponible', { status: 403, headers: base });
    }
    const ticket = url.searchParams.get('k');
    if (!(await validarTicket(env, ticket, ruta))) return new Response('Acceso no autorizado', { status: 403, headers: base });

    const obj = await env.VIDEOS.get(ruta);
    if (!obj) return new Response('No encontrado', { status: 404, headers: base });

    const cab = {
      ...base,
      'Content-Type': /init\.mp4$/.test(ruta) ? TIPOS.mp4init : (TIPOS[ext] || 'application/octet-stream'),
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };

    if (ext === 'm3u8') {
      // Cada línea de recurso (fragmento, sublista, clave o inicio) recibe el mismo ticket.
      const texto = await obj.text();
      const conTicket = u => u + (u.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(ticket);
      const salida = texto.split('\n').map(l => {
        const t = l.trim();
        if (!t) return l;
        if (t.startsWith('#')) return l.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + conTicket(u) + '"');
        return conTicket(t);
      }).join('\n');
      return new Response(req.method === 'HEAD' ? null : salida, { headers: { ...cab, 'Cache-Control': 'private, no-store' } });
    }
    return new Response(req.method === 'HEAD' ? null : obj.body, { headers: { ...cab, 'Cache-Control': 'private, max-age=3600', 'Content-Length': String(obj.size) } });
  }
};
