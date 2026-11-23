/* Café Galletti · Alba - Escuela Galletti (GAL-ESC-001).
   - Biblioteca siempre abierta, ordenada por categoría (Onboarding), cargo y función. Se repasa sin límite.
   - Reproductor vertical a pantalla completa, tipo feed: deslizar arriba o abajo para la lección siguiente o anterior.
   - Los videos no se descargan: llegan en fragmentos HLS desde el servidor de video, con un ticket de 4 horas que emite la base.
   - Marca de agua visible sobre el video: nombre de quien mira, tienda, fecha y hora, cambiando de lugar.
   - Quiz de 1 a 3 preguntas calificado en el servidor y firma con el PIN personal; registros inmutables (esc_registros).
   - Enlace para compartir por WhatsApp: abre Alba y pide sesión; sin sesión no se ve nada.
   - Progreso por tienda y persona, cargo de la ruta y verificación práctica del supervisor. */
(function () {
  'use strict';
  var A = window.Alba || { es: function () { return true; }, rol: function () { return 'central'; }, tienda: function () { return null; }, nombreOperador: function () { return 'demo'; }, modo: 'demo' };
  function App() { return window.AlbaApp; }
  function db() { return App() && App().db; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, e) { if (window.AlbaToast) window.AlbaToast(m, e); }
  function rerender() { if (window.AlbaRender) window.AlbaRender(); }
  function head(t, extra) { return '<div class="page-head"><h1>' + t + '</h1><span class="spacer"></span>' + (extra || '') + '</div>'; }
  function rpc(fn, args) {
    return A.sb.rpc(fn, args).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function errMsg(e) { return (e && (e.message || e.code)) || 'error'; }
  function fechaCorta(iso) { var d = iso ? new Date(iso) : new Date(); return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' }) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  var CARGOS = [['ASL', 'Asistente de línea'], ['BAR', 'Barista'], ['ANF', 'Anfitrión'], ['RT', 'Responsable de turno'], ['ENC', 'Encargado de tienda']];
  var CARGO_N = {}; CARGOS.forEach(function (c) { CARGO_N[c[0]] = c[1]; });
  var FUNCIONES = ['Bienvenida', 'Modelo de trabajo', 'Mi cargo', 'Servicio', 'Línea', 'Alba', 'Errores frecuentes'];
  var CATEGORIAS = [['onboarding', 'Onboarding']];

  var E = {
    sub: 'biblioteca', cat: 'onboarding', cargo: null, q: '', cargado: false, cargando: false, error: null,
    lecciones: [], reg: [], personal: {}, tiendas: {}, base: '', sus: false,
    ov: null, lista: [], idx: 0, hls: null, vista: {}, resp: {}, res: null, firmando: false, wmT: null, guionT: null, pendienteAbrir: null,
    verif: null
  };

  /* ---------- datos ---------- */
  function suscribir() {
    if (E.sus || !db()) return; E.sus = true;
    db().collection('personal').onSnapshot(function (s) { E.personal = {}; s.docs.forEach(function (x) { E.personal[x.id] = x.data(); }); rerender(); }, function () {});
    db().collection('tiendas').onSnapshot(function (s) { E.tiendas = {}; s.docs.forEach(function (x) { E.tiendas[x.id] = x.data(); }); }, function () {});
  }
  function cargar(forzar) {
    if (A.modo !== 'red' || !A.sb) return Promise.resolve();
    if (E.cargando) return E.cargando;
    if (E.cargado && !forzar) return Promise.resolve();
    E.cargando = Promise.resolve(A.listo).then(function () { return Promise.all([
      A.sb.from('esc_lecciones').select('*').order('orden', { ascending: true }),
      A.sb.from('esc_registros').select('id,creado,tipo,leccion,version,tienda,personal_id,nombre,pct,aprobado,por_email').order('id', { ascending: false }).limit(5000),
      A.sb.rpc('esc_base')
    ]); }).then(function (r) {
      if (r[0].error) throw r[0].error;
      E.lecciones = r[0].data || [];
      E.reg = (r[1].data || []);
      E.base = (r[2] && r[2].data) || '';
      E.cargado = true; E.error = null;
    }).catch(function (e) { E.error = errMsg(e); }).then(function () { E.cargando = false; rerender(); revisarEnlace(); });
    return E.cargando;
  }

  /* ---------- quién mira ---------- */
  function persona() { return A.operador && A.operador.id ? A.operador : null; }
  function necesitaPersona() { return A.modo === 'red' && A.es('tienda') && !persona(); }
  function nombreQuienMira() { var p = persona(); return p ? p.nombre : (A.perfil ? (A.perfil.nombre || A.perfil.email) : 'Demo'); }
  function tiendaNombre(id) { var t = E.tiendas[id] || (App() && App().S && App().S.tiendas ? App().S.tiendas[id] : null); return t ? (t.nombre || t.codigo || id) : (id || ''); }
  function tiendaQuienMira() { var p = persona(); var t = p && E.personal[p.id] ? E.personal[p.id].tienda : A.tienda(); return t ? tiendaNombre(t) : (A.rol() || ''); }
  function cargoDe(pid) { return pid && E.personal[pid] ? E.personal[pid].cargo || null : null; }
  function cargoActivo() { if (E.cargo !== null) return E.cargo || null; var p = persona(); return p ? cargoDe(p.id) : null; }

  /* ---------- rutas y estado de cada lección ---------- */
  function deCategoria() { return E.lecciones.filter(function (l) { return (l.categoria || 'onboarding') === E.cat && l.estado !== 'retirado'; }); }
  function enRuta(l, cargo) { var c = l.cargos || []; return c.indexOf('TODOS') >= 0 || !cargo || c.indexOf(cargo) >= 0; }
  function ruta(cargo) { return deCategoria().filter(function (l) { return enRuta(l, cargo); }); }
  function mio(r) { var p = persona(); return p ? r.personal_id === p.id : (!r.personal_id && A.perfil && r.por_email === A.perfil.email); }
  function estado(l, filtro) {
    filtro = filtro || mio;
    var firmada = false, vista = false, firmadaAntes = false, verificada = false;
    E.reg.forEach(function (r) {
      if (r.leccion !== l.codigo || !filtro(r)) return;
      if (r.tipo === 'firma') { if (r.version === l.version) firmada = true; else firmadaAntes = true; }
      if (r.tipo === 'vista' && r.version === l.version) vista = true;
      if (r.tipo === 'verificacion' && r.aprobado && r.version === l.version) verificada = true;
    });
    return { firmada: firmada, vista: vista, cambio: firmadaAntes && !firmada, verificada: verificada };
  }
  function pillEstado(l, st) {
    if (l.estado === 'en_produccion' && !l.video_ruta) { if (st.firmada) return '<span class="pill ok">Firmada</span>'; return '<span class="pill">Guion · video en producción</span>'; }
    if (st.verificada) return '<span class="pill navy">Certificada</span>';
    if (st.firmada) return '<span class="pill ok">Firmada v' + esc(l.version) + '</span>';
    if (st.cambio) return '<span class="pill warn">Cambió: repasar</span>';
    if (st.vista) return '<span class="pill gold">Vista</span>';
    return '<span class="pill">Pendiente</span>';
  }
  function reciente(l) { return l.actualizado && (Date.now() - new Date(l.actualizado).getTime()) < 14 * 864e5; }

  /* ---------- vistas ---------- */
  function subtabs() {
    var items = [['biblioteca', 'Biblioteca'], ['progreso', 'Progreso'], ['catalogo', 'Catálogo']].filter(function (i) {
      if (i[0] === 'catalogo') return A.es('central', 'gerencia');
      return true;
    });
    return '<div class="alba-tabs" role="tablist">' + items.map(function (i) {
      return '<button class="btn sm' + (E.sub === i[0] ? ' primary' : '') + '" role="tab" aria-selected="' + (E.sub === i[0]) + '" data-es="sub" data-v="' + i[0] + '">' + i[1] + '</button>';
    }).join('') + '</div>';
  }
  function viewPersona() {
    var t = A.tienda(), lista = Object.keys(E.personal).filter(function (id) { return E.personal[id].tienda === t && E.personal[id].activo !== false; });
    var h = head('Escuela Galletti');
    h += '<section class="card" style="max-width:520px"><p class="muted">Elija su nombre y escriba su PIN. Así la Escuela guarda su avance y sus firmas a su nombre.</p>';
    if (!lista.length) return h + '<div class="alert-box warn" style="margin-top:10px">La central aún no cargó el personal de esta tienda.</div></section>';
    h += '<div class="grid2"><div class="fld"><label class="f" for="es-persona">Persona</label><select class="inp" id="es-persona">' + lista.map(function (id) { return '<option value="' + esc(id) + '">' + esc(E.personal[id].nombre) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fld"><label class="f" for="es-pin">PIN</label><input class="inp" id="es-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div></div>' +
      '<button class="btn primary" style="margin-top:12px" data-es="persona">Entrar a la Escuela</button></section>';
    return h;
  }
  function viewBiblioteca() {
    var cargo = cargoActivo(), r = ruta(cargo), firm = r.filter(function (l) { return estado(l).firmada; }).length;
    var h = '<section class="card es-ruta" style="margin-bottom:14px">';
    h += '<div class="es-cats">' + CATEGORIAS.map(function (c) { return '<button class="btn sm' + (E.cat === c[0] ? ' gold' : ' ghost') + '" data-es="cat" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>';
    h += '<div class="es-chips" role="group" aria-label="Cargo"><button class="es-chip' + (!cargo ? ' on' : '') + '" data-es="cargo" data-v="">Todos los cargos</button>' +
      CARGOS.map(function (c) { return '<button class="es-chip' + (cargo === c[0] ? ' on' : '') + '" data-es="cargo" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>';
    var pct = r.length ? Math.round(100 * firm / r.length) : 0;
    h += '<div class="es-prog-ruta"><div><b>' + (cargo ? 'Ruta de onboarding: ' + esc(CARGO_N[cargo]) : 'Onboarding: ruta común y de cada cargo') + '</b><span class="muted small"> · ' + firm + ' de ' + r.length + ' firmadas</span></div>' +
      '<div class="alba-bar" style="flex:1"><i style="width:' + pct + '%"></i></div></div>';
    h += '<div class="fld" style="margin-top:10px"><label class="f" for="es-q">Buscar por tema, producto o tarea</label><input class="inp" id="es-q" data-es="q" value="' + esc(E.q) + '" placeholder="ej. PIN, ciclo, caja, barista" autocomplete="off"></div>';
    h += '</section>';
    var q = E.q.trim().toLowerCase();
    var lista = r.filter(function (l) { return !q || (l.titulo + ' ' + (l.objetivo || '') + ' ' + (l.narracion || '') + ' ' + l.codigo).toLowerCase().indexOf(q) >= 0; });
    if (!lista.length) return h + '<div class="card empty"><p class="muted">' + (E.lecciones.length ? 'No hay lecciones con ese criterio.' : 'La central todavía no carga las lecciones de la Escuela.') + '</p></div>';
    var nuevos = lista.filter(function (l) { var st = estado(l); return st.cambio || (l.estado === 'vigente' && reciente(l) && !st.vista && !st.firmada); }).slice(0, 6);
    if (nuevos.length && nuevos.length < lista.length && !q) h += grupo('Nuevo o cambió', nuevos, 'nuevo');
    FUNCIONES.concat(lista.map(function (l) { return l.funcion; }).filter(function (f, i, a) { return FUNCIONES.indexOf(f) < 0 && a.indexOf(f) === i; })).forEach(function (f) {
      var g = lista.filter(function (l) { return l.funcion === f; });
      if (g.length) h += grupo(f, g, f);
    });
    return h;
  }
  function grupo(titulo, ls, clave) {
    return '<section class="es-grupo"><h2 class="es-gtit">' + esc(titulo) + ' <span class="muted small">' + ls.length + '</span></h2><div class="es-grid">' + ls.map(function (l) {
      var st = estado(l);
      return '<button class="es-card" data-es="abrir" data-c="' + esc(l.codigo) + '" data-g="' + esc(clave) + '">' +
        '<span class="es-thumb"><span class="es-thumb-cod">' + esc(l.video || l.codigo) + '</span><span class="es-thumb-t">' + esc(l.titulo) + '</span><span class="es-thumb-play" aria-hidden="true">▶</span></span>' +
        '<span class="es-card-pie"><span class="muted small">' + (l.duracion_s ? l.duracion_s + ' s' : '') + (l.cargos && l.cargos.indexOf('TODOS') < 0 ? ' · ' + l.cargos.map(function (c) { return CARGO_N[c] || c; }).join(', ') : '') + '</span>' + pillEstado(l, st) + '</span></button>';
    }).join('') + '</div></section>';
  }

  function viewProgreso() {
    var tiendasIds = {};
    Object.keys(E.personal).forEach(function (id) { var p = E.personal[id]; if (p.activo !== false && p.tienda) (tiendasIds[p.tienda] = tiendasIds[p.tienda] || []).push(id); });
    var ids = Object.keys(tiendasIds).sort();
    if (A.es('tienda')) ids = ids.filter(function (t) { return t === A.tienda(); });
    if (!ids.length) return '<div class="card empty"><p class="muted">No hay personal cargado para mostrar avance.</p></div>';
    var puedeCargo = A.es('central', 'gerencia', 'supervisor', 'licenciatario');
    var puedeVerif = A.es('central', 'gerencia', 'supervisor', 'auditor', 'licenciatario');
    var h = '';
    ids.forEach(function (t) {
      var filas = tiendasIds[t].sort(function (a, b) { return String(E.personal[a].nombre).localeCompare(E.personal[b].nombre); }).map(function (pid) {
        var p = E.personal[pid], cargo = p.cargo || null, r = ruta(cargo);
        var filtro = function (x) { return x.personal_id === pid; };
        var firm = r.filter(function (l) { return estado(l, filtro).firmada; }).length;
        var cert = r.filter(function (l) { return estado(l, filtro).verificada; }).length;
        var ult = E.reg.filter(filtro)[0];
        var pct = r.length ? Math.round(100 * firm / r.length) : 0;
        var selCargo = puedeCargo ? '<select class="inp es-sel" data-es="fijar-cargo" data-p="' + esc(pid) + '"><option value="">Sin cargo</option>' + CARGOS.map(function (c) { return '<option value="' + c[0] + '"' + (cargo === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select>' : esc(CARGO_N[cargo] || 'Sin cargo');
        return '<tr><td><b>' + esc(p.nombre) + '</b></td><td>' + selCargo + '</td><td class="n">' + firm + ' / ' + r.length + '</td><td><div class="alba-bar"><i style="width:' + pct + '%"></i></div></td><td class="n">' + cert + '</td><td>' + (ult ? fechaCorta(ult.creado) : '-') + '</td>' +
          (puedeVerif ? '<td><button class="btn sm" data-es="verif" data-p="' + esc(pid) + '">Verificar práctica</button></td>' : '') + '</tr>';
      }).join('');
      h += '<section class="card" style="margin-bottom:14px"><h2>' + esc(tiendaNombre(t)) + '</h2><div class="tblwrap"><table class="t"><thead><tr><th>Persona</th><th>Cargo de su ruta</th><th class="n">Firmadas</th><th>Avance</th><th class="n">Certificadas</th><th>Última actividad</th>' + (puedeVerif ? '<th></th>' : '') + '</tr></thead><tbody>' + filas + '</tbody></table></div></section>';
    });
    if (E.verif) h = formVerif() + h;
    return h;
  }
  function formVerif() {
    var pid = E.verif.p, p = E.personal[pid] || {}, cargo = p.cargo || null;
    var filtro = function (x) { return x.personal_id === pid; };
    var ls = ruta(cargo).filter(function (l) { return estado(l, filtro).firmada; });
    var PUNTOS = ['Hace la tarea en el orden del estándar', 'Usa la cantidad, el tiempo o la temperatura de la ficha', 'Cumple el paso crítico (OJO)', 'Registra en Alba lo que corresponde', 'Avisa a quien corresponde', 'Mantiene orden y limpieza al terminar', 'Explica con sus palabras por qué se hace así', 'Trato al cliente según el estándar (si aplica)'];
    return '<section class="card" style="margin-bottom:14px;border-left:4px solid var(--accent)"><h2>Verificación práctica · ' + esc(p.nombre || '') + '</h2>' +
      (ls.length ? '<div class="fld"><label class="f" for="es-vl">Lección observada (solo las ya firmadas)</label><select class="inp" id="es-vl">' + ls.map(function (l) { return '<option value="' + esc(l.codigo) + '">' + esc(l.codigo + ' · ' + l.titulo) + '</option>'; }).join('') + '</select></div>' +
        '<div class="es-puntos">' + PUNTOS.map(function (t, i) { return '<label class="es-punto"><input type="checkbox" id="es-vp' + i + '" checked> ' + esc(t) + '</label>'; }).join('') + '</div>' +
        '<div class="fld"><label class="f" for="es-vo">Observación</label><input class="inp" id="es-vo" autocomplete="off"></div>' +
        '<div class="toolbar" style="margin-top:10px"><button class="btn primary" data-es="verif-ok">Cumple: certificar</button><button class="btn danger" data-es="verif-no">No cumple: reasignar</button><button class="btn ghost" data-es="verif-x">Cancelar</button></div>'
        : '<p class="muted">Esta persona todavía no tiene lecciones firmadas en su ruta. Primero ve y firma la lección; después se verifica en la tienda.</p><button class="btn ghost" data-es="verif-x">Cerrar</button>') + '</section>';
  }

  function viewCatalogo() {
    var h = '<section class="card" style="margin-bottom:14px"><h2>Servidor de video</h2><p class="muted small">Dirección del Worker de Cloudflare que entrega los videos (ver escuela-video/LEEME.md). Sin esta dirección, las lecciones muestran el guion animado.</p>' +
      '<div class="toolbar"><input class="inp" id="es-base" style="min-width:320px" value="' + esc(E.base) + '" placeholder="https://galletti-escuela-video.<cuenta>.workers.dev"><button class="btn primary" data-es="base">Guardar</button></div></section>';
    h += '<section class="card" style="margin-bottom:14px"><h2>Cargar o actualizar lecciones</h2><p class="muted small">Paquete JSON de la Escuela (categoría, versión y lecciones con preguntas). Si una lección cambia de versión, su video vuelve a "en producción" y la firma anterior deja de contar.</p>' +
      '<label class="btn"><input type="file" accept=".json,application/json" id="es-paquete" hidden>Elegir paquete JSON</label></section>';
    var filas = E.lecciones.map(function (l) {
      return '<tr><td class="sv-cod">' + esc(l.codigo) + '<br>' + esc(l.video) + '</td><td>' + esc(l.titulo) + (l.pendientes ? '<br><span class="muted small">Pendiente: ' + esc(l.pendientes) + '</span>' : '') + '</td><td>' + esc(l.version) + '</td>' +
        '<td><select class="inp es-sel" id="es-est-' + esc(l.codigo) + '">' + [['en_produccion', 'En producción'], ['vigente', 'Vigente'], ['retirado', 'Retirado']].map(function (o) { return '<option value="' + o[0] + '"' + (l.estado === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td>' +
        '<td><input class="inp" id="es-ruta-' + esc(l.codigo) + '" value="' + esc(l.video_ruta || '') + '" placeholder="onb/' + esc(l.video) + '/v' + esc(l.version) + '/index.m3u8"></td>' +
        '<td><button class="btn sm" data-es="publicar" data-c="' + esc(l.codigo) + '">Guardar</button></td></tr>';
    }).join('');
    h += '<section class="card"><h2>Lecciones (' + E.lecciones.length + ')</h2><div class="tblwrap"><table class="t"><thead><tr><th>Código</th><th>Lección</th><th>Versión</th><th>Estado</th><th>Ruta del video</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div></section>';
    return h;
  }

  function vista() {
    suscribir(); cargar();
    if (A.modo !== 'red') return head('Escuela Galletti') + '<div class="card empty"><p class="muted">La Escuela necesita conexión con la base de la red.</p></div>';
    if (necesitaPersona()) return viewPersona();
    var p = persona();
    var extra = '<span class="muted small">Aprende: <b>' + esc(nombreQuienMira()) + '</b></span>' + (A.es('tienda') ? ' <button class="btn sm ghost" data-es="cambiar">Cambiar persona</button>' : '');
    var h = head('Escuela Galletti', extra) + '<section class="card" style="margin-bottom:14px">' + subtabs() + '</section>';
    if (E.error) h += '<div class="alert-box bad" style="margin-bottom:12px">No se pudo leer la Escuela: ' + esc(E.error) + '</div>';
    if (!E.cargado) return h + '<div class="card empty"><p class="muted">Cargando lecciones...</p></div>';
    if (E.sub === 'progreso') return h + viewProgreso();
    if (E.sub === 'catalogo' && A.es('central', 'gerencia')) return h + viewCatalogo();
    return h + viewBiblioteca();
  }

  /* ---------- reproductor tipo feed (fuera del ciclo de render de la app) ---------- */
  function abrir(codigo, grupoClave) {
    var l = E.lecciones.filter(function (x) { return x.codigo === codigo; })[0]; if (!l) return;
    var cargo = cargoActivo(), lista = ruta(cargo);
    if (grupoClave && grupoClave !== 'nuevo') lista = lista.filter(function (x) { return x.funcion === grupoClave; });
    if (lista.indexOf(l) < 0) lista = [l];
    E.lista = lista; E.idx = lista.indexOf(l);
    montarOverlay(); pintar();
    try { history.replaceState(null, '', '#escuela?l=' + encodeURIComponent(codigo)); } catch (e) { /* nada */ }
  }
  function actual() { return E.lista[E.idx]; }
  function montarOverlay() {
    if (E.ov) return;
    var ov = document.createElement('div'); ov.id = 'es-ov'; ov.className = 'es-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    document.body.appendChild(ov); E.ov = ov; document.body.classList.add('es-abierto');
    ov.addEventListener('contextmenu', function (e) { if (e.target.closest('.es-player')) e.preventDefault(); });
    var y0 = null;
    ov.addEventListener('touchstart', function (e) { if (e.target.closest('.es-player')) y0 = e.touches[0].clientY; }, { passive: true });
    ov.addEventListener('touchend', function (e) {
      if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (Math.abs(dy) > 70) mover(dy < 0 ? 1 : -1);
    }, { passive: true });
  }
  function cerrar() {
    detener();
    if (E.ov) { E.ov.remove(); E.ov = null; }
    document.body.classList.remove('es-abierto');
    try { history.replaceState(null, '', '#escuela'); } catch (e) { /* nada */ }
    rerender();
  }
  function mover(d) { var n = E.idx + d; if (n < 0 || n >= E.lista.length) return; detener(); E.idx = n; pintar(); try { history.replaceState(null, '', '#escuela?l=' + encodeURIComponent(actual().codigo)); } catch (e) { /* nada */ } }
  function detener() {
    if (E.hls) { try { E.hls.destroy(); } catch (e) { /* nada */ } E.hls = null; }
    var v = $('es-video'); if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* nada */ } }
    clearInterval(E.wmT); clearInterval(E.guionT); E.wmT = E.guionT = null;
  }
  function conVideo(l) { return !!(l.video_ruta && E.base && l.estado === 'vigente'); }
  function pintar() {
    var l = actual(); if (!l || !E.ov) return;
    E.resp = {}; E.res = null;
    var st = estado(l), sinV = !conVideo(l);
    var h = '<div class="es-ov-in">' +
      '<div class="es-ov-top"><button class="btn sm ghost es-x" data-es="cerrar" aria-label="Cerrar">✕ Cerrar</button><span class="muted small">' + (E.idx + 1) + ' de ' + E.lista.length + '</span>' +
      '<span class="spacer"></span><button class="btn sm ghost" data-es="ant"' + (E.idx === 0 ? ' disabled' : '') + ' aria-label="Anterior">▲</button><button class="btn sm ghost" data-es="sig"' + (E.idx >= E.lista.length - 1 ? ' disabled' : '') + ' aria-label="Siguiente">▼</button></div>' +
      '<div class="es-ov-body"><div class="es-player" id="es-player">' +
      (sinV ? '<div class="es-guion" id="es-guion"></div>' : '<video id="es-video" playsinline webkit-playsinline disablepictureinpicture disableremoteplayback controlslist="nodownload noplaybackrate noremoteplayback nofullscreen" preload="metadata"></video><button class="es-play" id="es-play" data-es="play" aria-label="Reproducir">▶</button>') +
      '<div class="es-wm' + (sinV ? ' es-wm-osc' : '') + '" id="es-wm" aria-hidden="true"></div><div class="es-wm-fijo" aria-hidden="true">Propiedad de Café Galletti · uso interno · no se graba ni se comparte el contenido</div>' +
      '<div class="es-barra"><i id="es-barra-i"></i></div></div>' +
      '<div class="es-det">' +
      '<div class="sv-cod">' + esc(l.codigo) + ' · ' + esc(l.video) + ' · v' + esc(l.version) + '</div>' +
      '<h2 class="es-tit">' + esc(l.titulo) + '</h2>' + pillEstado(l, st) +
      (sinV ? '<div class="alert-box info" style="margin:10px 0">Video en producción. Mientras tanto se muestra el guion aprobado.</div>' : '') +
      (l.objetivo ? '<p><b>Al terminar podrás:</b> ' + esc(l.objetivo) + '</p>' : '') +
      (l.regla ? '<p class="es-regla">' + esc(l.regla) + '</p>' : '') +
      '<details class="es-narr"><summary>Leer el texto de la lección</summary><p>' + esc(l.narracion || '') + '</p></details>' +
      '<div id="es-quiz">' + quizHTML(l, st) + '</div>' +
      '<div class="toolbar" style="margin-top:14px"><button class="btn" data-es="compartir">Compartir enlace por WhatsApp</button></div>' +
      '<p class="muted small">El enlace abre Alba y pide usuario y PIN. Sin sesión no se ve el video.</p>' +
      '<p class="muted small">Fuente: ' + esc(l.fuente || '-') + '</p>' +
      '</div></div></div>';
    E.ov.innerHTML = h;
    marcaDeAgua();
    if (sinV) iniciarGuion(l); else iniciarVideo(l);
  }
  function quizHTML(l, st) {
    var pregs = l.preguntas || [];
    if (!pregs.length) return '';
    if (st.firmada && !E.res) return '<div class="alert-box ok" style="margin-top:12px">Ya firmaste la versión ' + esc(l.version) + ' de esta lección. Repásala las veces que quieras.</div>';
    var h = '<section class="es-quiz"><h3>Comprueba lo que aprendiste</h3>';
    pregs.forEach(function (q, i) {
      var r = E.res && E.res.detalle ? E.res.detalle[i] : null;
      h += '<fieldset class="es-q' + (r === true ? ' ok' : r === false ? ' bad' : '') + '"><legend>' + (i + 1) + '. ' + esc(q.p) + '</legend>' + (q.o || []).map(function (o, j) {
        return '<label class="es-op"><input type="radio" name="es-q' + i + '" data-es="resp" data-i="' + i + '" data-j="' + j + '"' + (E.resp[i] === j ? ' checked' : '') + (E.res && E.res.aprobado ? ' disabled' : '') + '> ' + esc(o) + '</label>';
      }).join('') + (r === false && q.x ? '<p class="muted small">' + esc(q.x) + '</p>' : '') + '</fieldset>';
    });
    if (E.res && E.res.aprobado) return h + '<div class="alert-box ok">Correcto: ' + E.res.aciertos + ' de ' + E.res.total + '. Quedó firmada a tu nombre.</div></section>';
    if (E.res) h += '<div class="alert-box warn">Tienes ' + E.res.aciertos + ' de ' + E.res.total + '. Mira otra vez la lección y vuelve a intentarlo.</div>';
    var pideP = A.es('tienda');
    h += (pideP ? '<div class="fld" style="max-width:220px"><label class="f" for="es-qpin">Tu PIN para firmar</label><input class="inp" id="es-qpin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div>' : '') +
      '<button class="btn primary" style="margin-top:8px" data-es="firmar"' + (E.firmando ? ' disabled' : '') + '>' + (pideP ? 'Firmar con mi PIN' : 'Responder') + '</button></section>';
    return h;
  }
  function marcaDeAgua() {
    var wm = $('es-wm'); if (!wm) return;
    var pos = [['8%', '10%'], ['62%', '58%'], ['30%', '76%'], ['70%', '18%'], ['16%', '44%']], k = 0;
    function poner() {
      wm.textContent = nombreQuienMira() + ' · ' + tiendaQuienMira() + ' · ' + fechaCorta();
      var p = pos[k++ % pos.length]; wm.style.top = p[0]; wm.style.left = p[1];
    }
    poner(); E.wmT = setInterval(poner, 6000);
  }
  function registrarVista(l, pct, origen) {
    var clave = l.codigo + '|' + l.version + '|' + (persona() ? persona().id : '');
    if (E.vista[clave]) return; E.vista[clave] = true;
    rpc('esc_registrar_vista', { p_leccion: l.codigo, p_version: l.version, p_personal: persona() ? persona().id : null, p_pct: pct, p_origen: origen })
      .then(function () { cargar(true); }, function (e) { E.vista[clave] = false; console.warn('vista', e); });
  }
  function iniciarGuion(l) {
    var box = $('es-guion'), pant = (l.pantallas || []).filter(function (p) { return p && (p.texto_en_pantalla || p.texto); });
    if (!box) return;
    if (!pant.length) { box.innerHTML = '<div class="es-g-esc"><p>' + esc(l.titulo) + '</p></div>'; return; }
    var total = Math.max(l.duracion_s || 40, 10), i = 0, barra = $('es-barra-i');
    function lineas(p) { var t = p.texto_en_pantalla || p.texto; return Array.isArray(t) ? t : [t]; }
    function mostrar() {
      var p = pant[i];
      box.innerHTML = '<div class="es-g-esc es-g-' + esc(p.tipo || 'paso') + '">' + (p.tipo === 'ojo' ? '<span class="es-ojo">OJO</span>' : '') + lineas(p).map(function (t, j) { return '<p class="' + (j ? 'es-g-sub' : 'es-g-main') + '">' + esc(t) + '</p>'; }).join('') + '</div>';
      var t0 = p.t_inicio_s || 0; if (barra) barra.style.width = Math.min(100, Math.round(100 * t0 / total)) + '%';
    }
    mostrar();
    E.guionT = setInterval(function () {
      i++;
      if (i >= pant.length) { clearInterval(E.guionT); E.guionT = null; if (barra) barra.style.width = '100%'; registrarVista(l, 100, 'guion'); return; }
      mostrar();
    }, Math.max(2500, Math.round(1000 * total / pant.length)));
  }
  function cargarHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = 'vendor/hls.light.min.js'; s.onload = function () { ok(window.Hls); }; s.onerror = ko; document.head.appendChild(s); });
  }
  function iniciarVideo(l) {
    var v = $('es-video'), play = $('es-play'), barra = $('es-barra-i'); if (!v) return;
    rpc('esc_ticket', { p_leccion: l.codigo }).then(function (t) {
      if (!t || !t.ok) throw { message: 'El video no está disponible' };
      var url = String(t.base || E.base).replace(/\/+$/, '') + '/v/' + t.ruta + '?k=' + encodeURIComponent(t.ticket);
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return; }
      return cargarHls().then(function (Hls) {
        if (!Hls || !Hls.isSupported()) throw { message: 'Este navegador no puede reproducir el video' };
        E.hls = new Hls({ maxBufferLength: 20 }); E.hls.loadSource(url); E.hls.attachMedia(v);
      });
    }).then(function () { var p = v.play(); if (p && p.catch) p.catch(function () { /* espera el toque */ }); }, function (e) { toast(errMsg(e), true); });
    v.addEventListener('play', function () { if (play) play.hidden = true; });
    v.addEventListener('pause', function () { if (play) play.hidden = false; });
    v.addEventListener('click', function () { if (v.paused) v.play(); else v.pause(); });
    v.addEventListener('timeupdate', function () {
      if (!v.duration) return; var pct = Math.round(100 * v.currentTime / v.duration);
      if (barra) barra.style.width = pct + '%';
      if (pct >= 90) registrarVista(l, pct, 'video');
    });
    v.addEventListener('ended', function () { registrarVista(l, 100, 'video'); });
  }

  /* ---------- acciones ---------- */
  function firmar() {
    var l = actual(); if (!l) return;
    var n = (l.preguntas || []).length, arr = [];
    for (var i = 0; i < n; i++) { if (E.resp[i] == null) return toast('Responda todas las preguntas', true); arr.push(E.resp[i]); }
    var pin = $('es-qpin') ? $('es-qpin').value.trim() : null;
    if (A.es('tienda') && !/^\d{6}$/.test(pin || '')) return toast('Escriba su PIN de 6 dígitos', true);
    E.firmando = true;
    rpc('esc_responder', { p_leccion: l.codigo, p_version: l.version, p_personal: persona() ? persona().id : null, p_pin: pin, p_respuestas: arr }).then(function (r) {
      E.res = r; E.firmando = false;
      if (r.aprobado) toast('Lección firmada');
      return cargar(true);
    }, function (e) { E.firmando = false; toast(errMsg(e), true); }).then(function () {
      var q = $('es-quiz'); if (q && actual() === l) q.innerHTML = quizHTML(l, estado(l));
    });
  }
  function compartir() {
    var l = actual(); if (!l) return;
    var link = location.origin + location.pathname + '#escuela?l=' + encodeURIComponent(l.codigo);
    var txt = 'Escuela Galletti · ' + l.titulo + '\n' + link;
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  }
  function revisarEnlace() {
    var m = /[#&?]l=([^&]+)/.exec(location.hash || ''); if (!m) return;
    var c = decodeURIComponent(m[1]);
    if (!E.cargado || E.ov || !A.rol()) return;
    if (necesitaPersona()) { E.pendienteAbrir = c; return; }
    if (E.lecciones.some(function (x) { return x.codigo === c; })) abrir(c);
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-es]'); if (!el) return;
    var op = el.dataset.es;
    if (op === 'sub') { E.sub = el.dataset.v; E.verif = null; rerender(); }
    else if (op === 'cat') { E.cat = el.dataset.v; rerender(); }
    else if (op === 'cargo') { E.cargo = el.dataset.v || ''; rerender(); }
    else if (op === 'abrir') abrir(el.dataset.c, el.dataset.g);
    else if (op === 'cerrar') cerrar();
    else if (op === 'sig') mover(1);
    else if (op === 'ant') mover(-1);
    else if (op === 'play') { var v = $('es-video'); if (v) v.play(); }
    else if (op === 'firmar') firmar();
    else if (op === 'compartir') compartir();
    else if (op === 'cambiar') { A.soltarOperador(); rerender(); }
    else if (op === 'persona') {
      var pid = $('es-persona').value, pin = $('es-pin').value.trim();
      if (!/^\d{6}$/.test(pin)) return toast('El PIN tiene 6 dígitos', true);
      rpc('alba_pin_verificar', { p_personal: pid, p_pin: pin }).then(function (ok) {
        if (!ok) return toast('PIN incorrecto', true);
        Alba.fijarOperador({ id: pid, nombre: E.personal[pid].nombre, email: A.perfil.email });
        rerender();
        if (E.pendienteAbrir) { var c = E.pendienteAbrir; E.pendienteAbrir = null; abrir(c); }
      }, function (e) { toast(errMsg(e), true); });
    }
    else if (op === 'verif') { E.verif = { p: el.dataset.p }; rerender(); window.scrollTo(0, 0); }
    else if (op === 'verif-x') { E.verif = null; rerender(); }
    else if (op === 'verif-ok' || op === 'verif-no') {
      var cod = $('es-vl').value, l = E.lecciones.filter(function (x) { return x.codigo === cod; })[0];
      var puntos = []; for (var i = 0; i < 8; i++) { var c = $('es-vp' + i); puntos.push(!!(c && c.checked)); }
      rpc('esc_verificar', { p_leccion: cod, p_version: l.version, p_personal: E.verif.p, p_cumple: op === 'verif-ok', p_puntos: { puntos: puntos, obs: $('es-vo').value || '' }, p_visita: null })
        .then(function () { toast(op === 'verif-ok' ? 'Práctica certificada' : 'Registrado: la lección vuelve a su ruta'); E.verif = null; return cargar(true); }, function (e) { toast(errMsg(e), true); });
    }
    else if (op === 'base') rpc('esc_fijar_base', { p_base: $('es-base').value.trim() }).then(function () { toast('Servidor de video guardado'); return cargar(true); }, function (e) { toast(errMsg(e), true); });
    else if (op === 'publicar') {
      var c2 = el.dataset.c;
      rpc('esc_publicar', { p_codigo: c2, p_ruta: $('es-ruta-' + c2).value.trim(), p_estado: $('es-est-' + c2).value }).then(function () { toast('Lección actualizada'); return cargar(true); }, function (e) { toast(errMsg(e), true); });
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.es === 'resp') { E.resp[+el.dataset.i] = +el.dataset.j; }
    else if (el.dataset && el.dataset.es === 'fijar-cargo') {
      if (!el.value) return;
      rpc('esc_fijar_cargo', { p_personal: el.dataset.p, p_cargo: el.value }).then(function () { toast('Cargo actualizado'); }, function (e) { toast(errMsg(e), true); rerender(); });
    }
    else if (el.id === 'es-paquete' && el.files && el.files[0]) {
      var fr = new FileReader();
      fr.onload = function () {
        var j; try { j = JSON.parse(fr.result); } catch (e) { return toast('El archivo no es un JSON válido', true); }
        if (!j || !Array.isArray(j.lecciones)) return toast('El paquete no trae lecciones', true);
        rpc('esc_cargar', { p_paquete: j }).then(function (n) { toast(n + ' lecciones cargadas'); return cargar(true); }, function (e) { toast(errMsg(e), true); });
      };
      fr.readAsText(el.files[0]); el.value = '';
    }
  });
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.es === 'q') {
      E.q = el.value; var pos = el.selectionStart; rerender();
      var n = $('es-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* nada */ } }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (!E.ov) return;
    if (ev.key === 'Escape') cerrar();
    else if (ev.key === 'ArrowDown' && !/INPUT|TEXTAREA|SELECT/.test((ev.target.tagName || ''))) { ev.preventDefault(); mover(1); }
    else if (ev.key === 'ArrowUp' && !/INPUT|TEXTAREA|SELECT/.test((ev.target.tagName || ''))) { ev.preventDefault(); mover(-1); }
  });
  window.addEventListener('hashchange', function () { if (/^#escuela/.test(location.hash)) revisarEnlace(); else if (E.ov) cerrar(); });
  document.addEventListener('visibilitychange', function () { var v = $('es-video'); if (document.hidden && v) v.pause(); });

  /* ---------- integración con el enrutador ---------- */
  var ICONO = { escuela: '<path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/><path d="M22 9v6"/>' };
  window.AlbaEsc = {
    rutas: function () { return [['escuela', 'Escuela', 'escuela']]; },
    iconos: ICONO,
    tiene: function (r) { return r === 'escuela'; },
    vista: function () { return vista(); },
    despues: function () { suscribir(); if (E.cargado) revisarEnlace(); },
    _E: E
  };
})();
