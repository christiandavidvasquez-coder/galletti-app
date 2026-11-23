/* Café Galletti · aplicación operativa - módulo de supervisión, auditoría, locales y trazabilidad.
   - Supervisión móvil: plantillas de checklist (Cumple / No cumple, Sí / No, mediciones) con observación por ítem,
     fotos de evidencia, firma del encargado con PIN, cierre sellado en el servidor y no conformidades automáticas.
   - Locales: alta, ficha y ciclo de vida (prospecto, apertura, operación, suspensión, salida, cierre) con compuertas.
   - Bitácora de auditoría encadenada: consulta, verificación de integridad y exportación.
   - Aviso de privacidad y términos: aceptación versionada por usuario y por operador. */
(function () {
  'use strict';
  var A = window.Alba || { es: function () { return true; }, rol: function () { return 'central'; }, tienda: function () { return null; }, nombreOperador: function () { return 'demo'; }, modo: 'demo' };
  function App() { return window.AlbaApp; }
  function db() { return App() && App().db; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function hhmm(d) { d = d || new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function fechaHora(iso) { if (!iso) return '-'; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString('es-EC') + ' ' + hhmm(d); }
  function toast(m, e) { if (window.AlbaToast) window.AlbaToast(m, e); }
  function rerender() { if (window.AlbaRender) window.AlbaRender(); }
  function nuevoId(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function head(t, extra) { return '<div class="page-head"><h1>' + t + '</h1><span class="spacer"></span>' + (extra || '') + '</div>'; }
  function tabla(cab, filas) {
    return '<div class="tblwrap"><table class="t"><thead><tr>' + cab.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.map(function (f) { return '<tr>' + f.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function vacio(t) { return '<p class="muted">' + t + '</p>'; }
  function sha256(txt) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
  }
  function errMsg(e) { return (e && (e.message || e.code)) || 'error'; }
  function guardar(fn, ok) {
    if (!db()) { toast('Sin conexión con la base', true); return Promise.resolve(false); }
    return Promise.resolve().then(fn).then(function (r) { if (ok) toast(ok); return r === undefined ? true : r; }, function (e) {
      toast(e && e.code === 'invalid_argument' ? 'Su usuario no tiene permiso para este registro.' : 'No se pudo guardar: ' + errMsg(e), true); return false;
    });
  }

  var ESTADOS_DEF = { prospecto: 'Prospecto', en_apertura: 'En apertura', operando: 'Operando', suspendido_parcial: 'Suspendido parcial', suspendido_total: 'Suspendido total', cierre_temporal: 'Cierre temporal', en_salida: 'En salida', cerrado: 'Cerrado', descartado: 'Descartado' };
  var ACTIVOS = ['en_apertura', 'operando', 'suspendido_parcial', 'suspendido_total', 'cierre_temporal', 'en_salida'];
  var ESTADO_PILL = { prospecto: '', en_apertura: 'gold', operando: 'ok', suspendido_parcial: 'warn', suspendido_total: 'bad', cierre_temporal: 'warn', en_salida: 'warn', cerrado: 'navy', descartado: 'navy' };
  var PLAZO_NC = { critica: 1, mayor: 3, menor: 2 };

  var S = {
    sub: { supervision: 'nueva', locales: 'red' }, plantillas: {}, visitas: [], nc: [], ev: [], personal: {}, ciclo: null, legal: null, acept: {},
    sus: false, activa: null, borr: {}, tiendaSel: null, plantSel: null, ficha: null, bita: null, bitaFiltro: { tienda: '', col: '' }, verif: null, geo: null
  };

  /* ---------- datos ---------- */
  function suscribir() {
    if (S.sus || !db()) return; S.sus = true;
    var d = db();
    function col(nombre, fn) { d.collection(nombre).onSnapshot(function (s) { fn(s.docs); rerender(); }, function (e) { console.warn(nombre, e); }); }
    col('plantillas', function (docs) {
      S.plantillas = {}; docs.forEach(function (x) { S.plantillas[x.id] = x.data(); });
      if (!docs.length && !S.sembradoP && window.ALBA_SEED_SUP && (A.modo === 'demo' || A.es('central'))) { S.sembradoP = true; sembrar(); }
    });
    col('visitas', function (docs) {
      S.visitas = docs.map(function (x) { var v = x.data(); v.id = x.id; return v; });
      Object.keys(S.borr).forEach(function (k) { var p = S.borr[k], v = S.visitas.filter(function (x) { return x.id === p.v; })[0]; if (v && v.estado !== 'cerrada') { v.respuestas = v.respuestas || {}; v.respuestas[p.i] = p.r; } });
    });
    col('nc', function (docs) { S.nc = docs.map(function (x) { var v = x.data(); v.id = x.id; return v; }); });
    col('locales_ev', function (docs) { S.ev = docs.map(function (x) { var v = x.data(); v.id = x.id; return v; }); });
    if (!A.es('tienda')) col('personal', function (docs) { S.personal = {}; docs.forEach(function (x) { S.personal[x.id] = x.data(); }); });
    col('aceptaciones', function (docs) { S.acept = {}; docs.forEach(function (x) { S.acept[x.id] = x.data(); }); revisarLegal(); });
    d.doc('opcfg/ciclo').onSnapshot(function (s) { S.ciclo = s.exists ? s.data() : null; rerender(); }, function () {});
    d.doc('legal/textos').onSnapshot(function (s) { S.legal = s.exists ? s.data() : (window.ALBA_SEED_SUP && ALBA_SEED_SUP.legal) || null; S.legalCargado = true; revisarLegal(); }, function () {});
  }
  function sembrar() {
    var X = window.ALBA_SEED_SUP, d = db(), p = Promise.resolve();
    (X.plantillas || []).forEach(function (pl) { p = p.then(function () { return d.collection('plantillas').doc(pl.id).set(pl); }); });
    if (X.ciclo) p = p.then(function () { return d.doc('opcfg/ciclo').set(X.ciclo); });
    if (X.legal) p = p.then(function () { return d.doc('legal/textos').set(X.legal); });
    p.then(function () { toast('Plantillas de supervisión y ciclo de locales cargados'); }, function (e) { console.warn('siembra', e); });
  }
  function ciclo() { return S.ciclo || (window.ALBA_SEED_SUP && ALBA_SEED_SUP.ciclo) || { estados: [], transiciones: [], ficha: [] }; }
  function estadoNom(id) { var e = (ciclo().estados || []).filter(function (x) { return x.id === id; })[0]; return e ? e.nombre : ESTADOS_DEF[id] || id || '-'; }
  function estadoPill(id) { return '<span class="pill ' + (ESTADO_PILL[id] || '') + '">' + esc(estadoNom(id)) + '</span>'; }

  /* ---------- tiendas (todas, incluidas inactivas) ---------- */
  function todas() {
    var T = App() && App().S && App().S.tiendas || {};
    return Object.keys(T).map(function (id) { var t = T[id]; return { id: id, codigo: t.codigo, nombre: t.nombre, estado: t.estado || (t.activa === false ? 'prospecto' : 'operando'), tipo: t.tipo || 'propia', titular: t.titular || 'galletti', t: t }; })
      .sort(function (a, b) { return String(a.codigo).localeCompare(String(b.codigo)); });
  }
  function activas() { return todas().filter(function (t) { return ACTIVOS.indexOf(t.estado) >= 0; }); }
  function tiendaNom(id) { if (!id) return 'Red'; var t = todas().filter(function (x) { return x.id === id; })[0]; return t ? t.codigo + ' ' + t.nombre : id; }

  /* ---------- llamadas al servidor (o emulación en modo demo) ---------- */
  function rpc(nombre, args) {
    if (A.modo === 'red' && A.sb) return A.sb.rpc(nombre, args).then(function (r) { if (r.error) throw { code: r.error.code === '42501' ? 'invalid_argument' : 'error', message: r.error.message }; return r.data; });
    return demoRpc(nombre, args);
  }
  function demoRpc(nombre, a) {
    var d = db(), C = ciclo();
    function ev(t, de, aa, extra) { var id = t + '_' + Date.now(); return d.collection('locales_ev').doc(id).set(Object.assign({ tienda: t, de: de, a: aa, actor: A.nombreOperador(), rol: A.rol(), ts: new Date().toISOString(), fecha: hoy() }, extra || {})).then(function () { return id; }); }
    if (nombre === 'alba_local_alta') {
      var cod = String(a.p_ficha.codigo || '').toUpperCase();
      if (todas().some(function (t) { return t.id === a.p_id || String(t.codigo).toUpperCase() === cod; })) return Promise.reject({ message: 'El identificador o el código ' + cod + ' ya existe o existió en la red; no se reutiliza' });
      var f = Object.assign({}, a.p_ficha, { codigo: cod, estado: 'prospecto', activa: false, alta: new Date().toISOString() });
      if (f.tipo !== 'licenciatario') f.titular = 'galletti';
      return d.collection('tiendas').doc(a.p_id).set(f).then(function () { return ev(a.p_id, null, 'prospecto', { transicion: 'alta', motivo: a.p_motivo }); }).then(function (id) { return { ok: true, evento: id }; });
    }
    if (nombre === 'alba_local_transicion') {
      var t = todas().filter(function (x) { return x.id === a.p_tienda; })[0]; if (!t) return Promise.reject({ message: 'Local no encontrado' });
      var tr = (C.transiciones || []).filter(function (x) { return x.de === t.estado && x.a === a.p_a; })[0];
      if (!tr) return Promise.reject({ message: 'Transición no permitida' });
      if (tr.motivo_obligatorio && !String(a.p_motivo || '').trim()) return Promise.reject({ message: 'Esta transición exige un motivo' });
      if (tr.requiere_plantilla && !gateCumplida(t, tr.requiere_plantilla))
        return Promise.reject({ message: 'Falta la compuerta: ' + tr.requiere_plantilla + ' cerrada y aprobada para este local' });
      var act = ACTIVOS.indexOf(a.p_a) >= 0;
      return d.collection('tiendas').doc(t.id).update({ estado: a.p_a, activa: act, estado_desde: new Date().toISOString() })
        .then(function () { return ev(t.id, t.estado, a.p_a, { transicion: tr.nombre, motivo: a.p_motivo, ref: a.p_ref, registro: tr.registro }); })
        .then(function () { return { ok: true, de: t.estado, a: a.p_a }; });
    }
    return Promise.reject({ message: 'Disponible solo con la base en línea' });
  }

  function gateCumplida(t, pl) {
    var desde = t.t.estado_desde || '';
    return S.visitas.some(function (v) { return v.tienda === t.id && v.plantilla === pl && v.estado === 'cerrada' && v.resultado === 'aprobado' && String(v.cerrada_srv || '') >= String(desde); });
  }
  /* ---------- permisos de interfaz ---------- */
  function ejecuta() { return A.es('central', 'gerencia', 'supervisor', 'auditor'); }
  function plantillasPara() {
    return Object.keys(S.plantillas).map(function (k) { return S.plantillas[k]; }).filter(function (p) {
      var q = p.quien || []; return !q.length || q.indexOf(A.rol()) >= 0 || A.es('central', 'gerencia');
    }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  }
  function itemsDe(pl) { var out = []; (pl.bloques || []).forEach(function (b) { (b.items || []).forEach(function (it) { out.push(it); }); }); return out; }

  /* ---------- evaluación de una respuesta ---------- */
  function evalua(it, r) {
    if (!r || r.v == null || r.v === '') return 'pend';
    if (r.v === 'NA') return 'na';
    if (it.tipo === 'cumple') return r.v === 'C' ? 'ok' : 'falla';
    if (it.tipo === 'sino') return r.v === 'SI' ? 'ok' : 'falla';
    if (it.tipo === 'numero') { var n = +r.v; if (isNaN(n)) return 'pend'; if (it.min != null && n < +it.min) return 'falla'; if (it.max != null && n > +it.max) return 'falla'; return 'ok'; }
    return 'ok';
  }
  function obsObligatoria(it, st) { return it.obs === 'siempre' || (st === 'falla' && it.obs !== 'opcional') || st === 'falla'; }
  function modoAprob(pl) { return pl.aprobacion || (pl.puntua ? 'umbral' : /DES/.test(pl.id) ? 'todo' : 'sin_criticos'); }
  function resumen(v) {
    var pl = v.plantilla_snap || S.plantillas[v.plantilla] || { bloques: [] }, res = v.respuestas || {};
    var tot = 0, okp = 0, pend = [], fallas = [], crit = [], faltaObs = [], faltaFoto = [];
    itemsDe(pl).forEach(function (it) {
      var r = res[it.id], st = evalua(it, r);
      if ((st === 'pend' && it.tipo !== 'texto') || (it.tipo === 'texto' && it.obs === 'siempre' && !String((r && r.v) || '').trim())) pend.push(it);
      if (st !== 'na' && st !== 'pend') { tot += +it.peso || 0; if (st === 'ok') okp += +it.peso || 0; }
      if (st === 'falla') { fallas.push(it); if (it.criticidad === 'critico') crit.push(it); if (it.foto_si_falla && !(r.fotos && r.fotos.length) && !r.sinFoto) faltaFoto.push(it); }
      if (it.tipo !== 'texto' && (st === 'falla' || it.obs === 'siempre' || (st === 'na' && it.criticidad === 'critico')) && !(r && String(r.obs || '').trim())) faltaObs.push(it);
    });
    var puntaje = pl.puntua && tot ? Math.round(okp / tot * 1000) / 10 : null, m = modoAprob(pl), aprob;
    if (m === 'umbral') aprob = puntaje != null && puntaje >= (+pl.umbral || 80) && !crit.length;
    else if (m === 'todo') aprob = !fallas.length;
    else aprob = !crit.length;
    return { pl: pl, puntaje: puntaje, pend: pend, fallas: fallas, crit: crit, faltaObs: faltaObs, faltaFoto: faltaFoto, aprobado: aprob, total: itemsDe(pl).length };
  }

  /* ---------- geolocalización con consentimiento ---------- */
  function geoConsentido() { return !!S.acept[A.perfil ? A.perfil.email + '_geo_' + legalVer() : 'demo_geo']; }
  function geo() {
    return new Promise(function (res) {
      return res(null); // la app no ubica personas (LEG-04): la presencia queda probada por la firma del encargado
      if (!geoConsentido() || !navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(function (p) { res({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), prec: Math.round(p.coords.accuracy) }); }, function () { res(null); }, { timeout: 8000, maximumAge: 60000 });
    });
  }

  /* =====================================================================
     SUPERVISIÓN
     ===================================================================== */
  function subtabs(ruta, items) {
    return '<div class="alba-tabs" role="tablist">' + items.filter(function (i) { return !i[2] || i[2](); }).map(function (i) {
      return '<button class="btn sm' + (S.sub[ruta] === i[0] ? ' primary' : '') + '" role="tab" aria-selected="' + (S.sub[ruta] === i[0]) + '" data-sv="sub" data-r="' + ruta + '" data-v="' + i[0] + '">' + i[1] + '</button>';
    }).join('') + '</div>';
  }
  function viewSupervision() {
    if (S.activa) { var v = S.visitas.filter(function (x) { return x.id === S.activa; })[0]; if (v) return v.estado === 'cerrada' ? viewInforme(v) : viewEjecucion(v); S.activa = null; }
    var abiertasMias = S.visitas.filter(function (v) { return v.estado !== 'cerrada' && (A.modo === 'demo' || v.por === (A.perfil && A.perfil.email)); });
    var ncAb = S.nc.filter(function (n) { return n.estado !== 'cerrada'; }), ncVenc = ncAb.filter(function (n) { return n.plazo && n.plazo < hoy(); });
    var h = head('Supervisión y auditoría', '<button class="btn sm ghost alba-solo-movil" data-op="salir">Salir</button>');
    h += '<section class="card" style="margin-bottom:14px"><div class="kpis"><div class="kpi"><small>Borradores abiertos</small><b class="num">' + abiertasMias.length + '</b></div>' +
      '<div class="kpi ' + (ncAb.length ? 'warn' : 'ok') + '"><small>No conformidades abiertas</small><b class="num">' + ncAb.length + '</b></div>' +
      '<div class="kpi ' + (ncVenc.length ? 'bad' : 'ok') + '"><small>Vencidas</small><b class="num">' + ncVenc.length + '</b></div>' +
      '<div class="kpi"><small>Visitas cerradas (7 días)</small><b class="num">' + S.visitas.filter(function (v) { return v.estado === 'cerrada' && v.fecha >= addDays(hoy(), -7); }).length + '</b></div></div>' +
      subtabs('supervision', [['nueva', 'Nueva', ejecuta], ['curso', 'En curso (' + abiertasMias.length + ')', ejecuta], ['historial', 'Historial'], ['nc', 'No conformidades'], ['bitacora', 'Bitácora', function () { return A.es('central', 'gerencia', 'auditor', 'licenciatario'); }]]) + '</section>';
    var s = S.sub.supervision; if (!ejecuta() && (s === 'nueva' || s === 'curso')) s = 'historial';
    if (s === 'nueva') return h + viewNueva();
    if (s === 'curso') return h + listaVisitas(abiertasMias, true);
    if (s === 'nc') return h + viewNC();
    if (s === 'bitacora') return h + viewBitacora();
    return h + viewHistorial();
  }
  function viewNueva() {
    var pls = plantillasPara();
    if (!pls.length) return '<section class="card">' + vacio('No hay plantillas cargadas. La central las carga en Catálogo, Plantillas, Paquete inicial.') + '</section>';
    var sel = S.plantSel && S.plantillas[S.plantSel] ? S.plantillas[S.plantSel] : pls[0];
    var h = '<section class="card"><h2>Empezar un registro</h2><div class="sv-plantillas">' + pls.map(function (p) {
      return '<button class="alba-tipo' + (p.id === sel.id ? ' on' : '') + '" data-sv="plant" data-v="' + esc(p.id) + '"><b>' + esc(p.nombre) + '</b><span>' + esc(p.id) + ' · ' + esc(p.frecuencia || '') + (p.puntua ? ' · puntúa sobre 100' : '') + '</span></button>';
    }).join('') + '</div><p class="muted small" style="margin-top:10px">' + esc(sel.descripcion || '') + '</p><div class="toolbar">';
    if (sel.alcance !== 'red') {
      var ts = activas().concat(/APE/.test(sel.id) ? todas().filter(function (t) { return t.estado === 'prospecto'; }) : []);
      if (!S.tiendaSel || !ts.some(function (t) { return t.id === S.tiendaSel; })) S.tiendaSel = ts.length ? ts[0].id : null;
      h += '<div class="fld" style="min-width:220px"><label class="f" for="sv-tienda">Local</label><select class="inp" id="sv-tienda" data-sv="tienda">' + ts.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === S.tiendaSel ? ' selected' : '') + '>' + esc(t.codigo + ' ' + t.nombre) + ' · ' + esc(estadoNom(t.estado)) + '</option>'; }).join('') + '</select></div>';
    }
    h += '<button class="btn primary" data-sv="iniciar" data-v="' + esc(sel.id) + '">Empezar</button></div>';
    var ult = S.visitas.filter(function (v) { return v.plantilla === sel.id && v.estado === 'cerrada' && (sel.alcance === 'red' || v.tienda === S.tiendaSel); }).sort(function (a, b) { return String(b.cerrada_srv || b.fecha).localeCompare(String(a.cerrada_srv || a.fecha)); })[0];
    if (ult) h += '<div class="alert-box info" style="margin-top:12px">Último registro: ' + esc(fechaHora(ult.cerrada_srv || ult.fecha)) + ' · ' + esc(ult.supervisor_nombre || ult.por || '') + (ult.puntaje != null ? ' · ' + ult.puntaje + '/100' : '') + '. ' + (ult.acuerdos ? 'Acuerdo pendiente de revisar: ' + esc(ult.acuerdos) : '') + '</div>';
    return h + '</section>';
  }
  function iniciar(pid) {
    var pl = S.plantillas[pid]; if (!pl) return;
    var t = pl.alcance === 'red' ? null : S.tiendaSel;
    if (pl.alcance !== 'red' && !t) return toast('Elija un local', true);
    var id = nuevoId('v'), d = { plantilla: pl.id, plantilla_version: pl.version || '1.0', plantilla_snap: pl, tienda: t, fecha: hoy(), hora_inicio: hhmm(), inicio: new Date().toISOString(), estado: 'abierta', respuestas: {}, supervisor_nombre: (A.perfil && (A.perfil.nombre || A.perfil.email)) || A.nombreOperador(), rol: A.rol() };
    if (A.modo === 'demo') d.por = 'demo';
    geo().then(function (g) { if (g) d.geo_inicio = g; return guardar(function () { return db().collection('visitas').doc(id).set(d); }); }).then(function (ok) { if (ok) { S.activa = id; S.sub.supervision = 'curso'; rerender(); window.scrollTo(0, 0); } });
  }
  function itemHtml(v, it) {
    var r = (v.respuestas || {})[it.id] || {}, st = evalua(it, r), ro = v.estado === 'cerrada';
    var h = '<div class="sv-item sv-' + st + (it.criticidad === 'critico' ? ' sv-crit' : '') + '" id="it-' + esc(it.id) + '"><div class="sv-q"><span class="sv-cod">' + esc(it.id.replace(/^[A-Z]+-[A-Z]+-/, '')) + '</span> ' + esc(it.texto) +
      (it.criticidad === 'critico' ? ' <span class="pill bad">Crítico</span>' : it.criticidad === 'mayor' ? ' <span class="pill warn">Mayor</span>' : '') + '</div>';
    if (it.ayuda) h += '<div class="sv-ayuda">' + esc(it.ayuda) + '</div>';
    function seg(opts) { return '<div class="sv-seg" role="group" aria-label="Respuesta">' + opts.map(function (o) { return '<button class="sv-b sv-b-' + o[2] + (r.v === o[0] ? ' on' : '') + '" data-sv="resp" data-i="' + esc(it.id) + '" data-v="' + o[0] + '"' + (ro ? ' disabled' : '') + ' aria-pressed="' + (r.v === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
    if (it.tipo === 'cumple') h += seg([['C', 'Cumple', 'ok'], ['NC', 'No cumple', 'bad'], ['NA', 'No aplica', 'na']]);
    else if (it.tipo === 'sino') h += seg([['SI', 'Sí', 'ok'], ['NO', 'No', 'bad'], ['NA', 'No aplica', 'na']]);
    else if (it.tipo === 'numero') h += '<div class="sv-num"><input class="inp" type="number" step="any" inputmode="decimal" data-sv="num" data-i="' + esc(it.id) + '" data-min="' + esc(it.min == null ? '' : it.min) + '" data-max="' + esc(it.max == null ? '' : it.max) + '" value="' + esc(r.v != null && r.v !== 'NA' ? r.v : '') + '"' + (ro ? ' disabled' : '') + ' aria-label="Medición"><span>' + esc(it.unidad || '') + '</span><span class="muted small">' + (it.min != null ? 'mín. ' + esc(it.min) + ' ' : '') + (it.max != null ? 'máx. ' + esc(it.max) : '') + '</span>' + (ro ? '' : '<button class="sv-b sv-b-na' + (r.v === 'NA' ? ' on' : '') + '" data-sv="resp" data-i="' + esc(it.id) + '" data-v="NA">No aplica</button>') + '</div>';
    else h += '<textarea class="inp sv-obs" id="t-' + esc(it.id) + '" data-sv="txt" data-i="' + esc(it.id) + '" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(r.v || '') + '</textarea>';
    if (it.tipo !== 'texto') {
      var req = st === 'falla' || it.obs === 'siempre' || (st === 'na' && it.criticidad === 'critico');
      h += '<div class="sv-obsw' + (req || r.obs ? ' abierta' : '') + '"><label class="f" for="o-' + esc(it.id) + '">Observación' + (req ? ' (obligatoria)' : '') + '</label><textarea class="inp sv-obs" id="o-' + esc(it.id) + '" data-sv="obs" data-i="' + esc(it.id) + '" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(r.obs || '') + '</textarea></div>';
      if (st === 'falla' && it.accion) h += '<div class="alert-box warn sv-accion">Acción inmediata: ' + esc(it.accion) + '</div>';
      var fotos = r.fotos || [];
      h += '<div class="sv-fotos">' + fotos.map(function (f) { return '<button class="sv-foto" data-sv="ver-foto" data-id="' + esc(f) + '" title="Ver evidencia">Foto</button>'; }).join('');
      if (!ro) h += '<label class="btn sm ghost sv-camara" title="Fotografíe el producto, la etiqueta o el equipo. Sin personas, sin documentos, sin pantallas con datos.">Foto de evidencia<input type="file" accept="image/*" capture="environment" data-sv="foto" data-i="' + esc(it.id) + '" hidden></label><span class="muted small">Solo producto, etiqueta o equipo: sin personas ni documentos.</span>' +
        (st === 'falla' && it.foto_si_falla && !fotos.length ? '<label class="small sv-sinfoto"><input type="checkbox" data-sv="sinfoto" data-i="' + esc(it.id) + '"' + (r.sinFoto ? ' checked' : '') + '> No fue posible tomar foto (explíquelo en la observación)</label>' : '');
      h += '</div>';
    }
    return h + '</div>';
  }
  function viewEjecucion(v) {
    var R = resumen(v), pl = R.pl, hechos = R.total - R.pend.length;
    var h = '<div class="sv-top"><button class="btn sm ghost" data-sv="volver">Volver</button><div><b>' + esc(pl.nombre) + '</b><div class="muted small">' + esc(tiendaNom(v.tienda)) + ' · ' + esc(v.fecha) + ' ' + esc(v.hora_inicio) + '' + '</div></div>' +
      '<div class="sv-prog"><div class="alba-bar"><i style="width:' + Math.round(hechos / Math.max(1, R.total) * 100) + '%"></i></div><span class="small">' + hechos + '/' + R.total + (R.puntaje != null ? ' · ' + R.puntaje + ' pts' : '') + (R.crit.length ? ' · <b style="color:var(--bad)">' + R.crit.length + ' crítico(s)</b>' : '') + '</span></div></div>';
    (pl.bloques || []).forEach(function (b) {
      var its = b.items || [], hb = its.filter(function (it) { return evalua(it, (v.respuestas || {})[it.id]) !== 'pend'; }).length;
      h += '<section class="card sv-bloque"><h2>' + esc(b.nombre) + ' <span class="muted small">' + hb + '/' + its.length + '</span></h2>' + its.map(function (it) { return itemHtml(v, it); }).join('') + '</section>';
    });
    h += '<section class="card sv-cierre"><h2>Cierre</h2>';
    if (R.pend.length) h += '<div class="alert-box warn">Faltan ' + R.pend.length + ' ítems por responder. <button class="btn sm ghost" data-sv="ir" data-i="' + esc(R.pend[0].id) + '">Ir al primero</button></div>';
    if (R.faltaObs.length) h += '<div class="alert-box warn">Falta la observación en ' + R.faltaObs.length + ' ítem(s). <button class="btn sm ghost" data-sv="ir" data-i="' + esc(R.faltaObs[0].id) + '">Ir</button></div>';
    if (R.faltaFoto.length) h += '<div class="alert-box warn">Falta la foto de evidencia en ' + R.faltaFoto.length + ' ítem(s) que fallaron. <button class="btn sm ghost" data-sv="ir" data-i="' + esc(R.faltaFoto[0].id) + '">Ir</button></div>';
    var ncN = R.fallas.filter(function (it) { return generaNC(pl, it); }).length;
    h += '<p>' + (R.puntaje != null ? 'Puntaje: <b>' + R.puntaje + '/100</b> (umbral ' + (pl.umbral || 80) + '). ' : '') + 'Fallas: <b>' + R.fallas.length + '</b>, críticas: <b>' + R.crit.length + '</b>. Resultado: ' + (R.aprobado ? '<span class="pill ok">Aprobado</span>' : '<span class="pill bad">No aprobado</span>') + (ncN ? ' · Se abrirán <b>' + ncN + '</b> no conformidades.' : '') + '</p>';
    if (v.tienda) {
      var pers = Object.keys(S.personal).filter(function (id) { return S.personal[id].tienda === v.tienda && S.personal[id].activo !== false; });
      h += '<h3>Firma del encargado como enterado</h3><p class="muted small">La firma confirma que se le leyeron los hallazgos. No implica que esté de acuerdo.</p><div class="grid2">' +
        '<div class="fld"><label class="f" for="sv-enc">Encargado o responsable de turno</label><select class="inp" id="sv-enc"><option value="">-</option>' + pers.map(function (id) { return '<option value="' + esc(id) + '">' + esc(S.personal[id].nombre) + '</option>'; }).join('') + '<option value="_otro">Otra persona (escribir nombre)</option><option value="_negado">Se negó a firmar</option></select></div>' +
        '<div class="fld"><label class="f" for="sv-pin">PIN del encargado (o nombre)</label><input class="inp" id="sv-pin" autocomplete="off"></div></div>';
    }
    h += '<div class="fld" style="margin-top:10px"><label class="f" for="sv-acu">Acuerdos y fecha de revisión</label><textarea class="inp" id="sv-acu" rows="2">' + esc(v.acuerdos || '') + '</textarea></div>';
    h += '<div class="toolbar" style="margin-top:12px"><button class="btn primary" data-sv="cerrar"' + (R.pend.length || R.faltaObs.length || R.faltaFoto.length ? ' disabled' : '') + '>Cerrar y sellar</button><button class="btn ghost" data-sv="descartar">Descartar borrador</button></div>' +
      '<p class="muted small">Al cerrar, el servidor pone la hora oficial y una huella digital (SHA-256). Después ya no se puede modificar; cualquier corrección se registra aparte.</p></section>';
    return h;
  }
  function generaNC(pl, it) { var g = pl.genera_nc || (/^AUD-/.test(pl.id) ? 'todas' : 'criticas'); return g === 'todas' || (g === 'criticas' && it.criticidad === 'critico') || (g === 'mayores' && it.criticidad !== 'menor'); }
  function cerrarVisita(v) {
    var R = resumen(v); if (R.pend.length || R.faltaObs.length || R.faltaFoto.length) return toast('Complete los ítems pendientes', true);
    var sel = ($('sv-enc') || {}).value || '', pin = (($('sv-pin') || {}).value || '').trim(), acu = (($('sv-acu') || {}).value || '').trim();
    var firma = Promise.resolve(null);
    if (v.tienda) {
      if (!sel) return toast('Indique quién firma como enterado', true);
      if (sel === '_negado') { if (!pin) return toast('Escriba el nombre de quien se negó a firmar', true); firma = Promise.resolve({ metodo: 'negado', nombre: pin, ts: new Date().toISOString() }); }
      else if (sel === '_otro') { if (!pin) return toast('Escriba el nombre de quien firma', true); firma = Promise.resolve({ metodo: 'nombre', nombre: pin, ts: new Date().toISOString() }); }
      else {
        var p = S.personal[sel];
        if (A.modo === 'red' && !p.pinHash) firma = Promise.resolve({ metodo: 'pin', personalId: sel, pin: pin });
        else firma = Alba.hashPin(pin, sel).then(function (h) { if (h !== p.pinHash) throw { message: 'PIN incorrecto' }; return { metodo: 'pin', personalId: sel, nombre: p.nombre, ts: new Date().toISOString() }; });
      }
      if (A.modo === 'red') firma = firma.then(function (f) {
        return rpc('alba_visita_firmar', { p_visita: v.id, p_metodo: f.metodo, p_personal: f.personalId || null, p_pin: f.pin || null, p_nombre: f.metodo === 'pin' ? null : f.nombre }).then(function () { return null; });
      });
    }
    var ncs = [];
    firma.then(function (f) {
      return geo().then(function (g) {
        var cambios = { estado: 'cerrada', resultado: R.aprobado ? 'aprobado' : 'no_aprobado', puntaje: R.puntaje, fallas: R.fallas.map(function (x) { return x.id; }), criticos_fallidos: R.crit.map(function (x) { return x.id; }), acuerdos: acu, hora_fin: hhmm(), fin: new Date().toISOString() };
        if (f) cambios.firma_encargado = f; if (g) cambios.geo_fin = g;
        R.fallas.filter(function (it) { return generaNC(R.pl, it); }).forEach(function (it) {
          var tipo = it.criticidad === 'critico' ? 'critica' : it.criticidad === 'mayor' ? 'mayor' : 'menor', r = v.respuestas[it.id] || {};
          ncs.push({ id: 'nc_' + v.id + '_' + it.id, d: { tienda: v.tienda, visita: v.id, plantilla: v.plantilla, item: it.id, requisito: it.ref || '', hallazgo: it.texto, evidencia: r.obs || '', fotos: r.fotos || [], valor: r.v, tipo: tipo, plazo: addDays(hoy(), PLAZO_NC[tipo]), estado: 'abierta', accion_inmediata: it.accion || '', fecha: hoy() } });
        });
        cambios.ncs = ncs.map(function (n) { return n.id; });
        if (A.modo === 'demo') { var snap = Object.assign({}, v, cambios); delete snap.id; return sha256(JSON.stringify(snap)).then(function (s) { cambios.sello = s; cambios.cerrada_srv = new Date().toISOString(); return cambios; }); }
        return cambios;
      });
    }).then(function (cambios) {
      return guardar(function () {
        return db().collection('visitas').doc(v.id).update(cambios).then(function () {
          var p = Promise.resolve(); ncs.forEach(function (n) { p = p.then(function () { return db().collection('nc').doc(n.id).set(n.d); }); }); return p;
        });
      }, 'Registro cerrado y sellado' + (ncs.length ? '. ' + ncs.length + ' no conformidad(es) abierta(s).' : ''));
    }, function (e) { toast(errMsg(e), true); });
  }
  function viewInforme(v) {
    var R = resumen(v), pl = R.pl, res = v.respuestas || {};
    var h = '<div class="sv-top no-print"><button class="btn sm ghost" data-sv="volver">Volver</button><span class="spacer"></span><button class="btn sm" data-sv="imprimir">Imprimir o PDF</button></div>';
    h += '<section class="card sv-informe"><div class="sv-inf-head"><div><h1 style="margin:0">' + esc(pl.nombre) + '</h1><div class="muted">' + esc(pl.id) + ' v' + esc(v.plantilla_version || '') + ' · ' + esc(tiendaNom(v.tienda)) + '</div></div>' +
      '<div class="sv-res">' + (v.resultado === 'aprobado' ? '<span class="pill ok">Aprobado</span>' : '<span class="pill bad">No aprobado</span>') + (v.puntaje != null ? '<b class="num" style="font-size:1.6rem;display:block">' + v.puntaje + '/100</b>' : '') + '</div></div>';
    h += tabla(['Dato', 'Valor'], [
      ['Realizó', esc(v.supervisor_nombre || '') + ' <span class="muted small">' + esc(v.por || '') + ' · ' + esc(v.rol || '') + '</span>'],
      ['Inicio / fin', esc(v.fecha + ' ' + (v.hora_inicio || '')) + ' - ' + esc(v.hora_fin || '')],
      ['Abierta en el servidor', esc(fechaHora(v.abierta_srv))], ['Cerrada en el servidor', esc(fechaHora(v.cerrada_srv))],
      ['Firma del encargado', v.firma_encargado ? esc(v.firma_encargado.nombre) + ' · ' + ({ pin: 'con PIN verificado en el servidor', nombre: 'por nombre escrito', negado: 'se negó a firmar' }[v.firma_encargado.metodo] || '') + (v.firma_encargado.ts ? ' · ' + esc(fechaHora(v.firma_encargado.ts)) : '') : '-'],
      ['Acuerdos', esc(v.acuerdos || '-')], ['Huella SHA-256', '<code class="sv-sello">' + esc(v.sello || '-') + '</code>']]);
    (pl.bloques || []).forEach(function (b) {
      h += '<h2 style="margin-top:16px">' + esc(b.nombre) + '</h2>' + tabla(['#', 'Punto', 'Resultado', 'Observación'], (b.items || []).map(function (it) {
        var r = res[it.id] || {}, st = evalua(it, r), val = it.tipo === 'numero' ? (r.v === 'NA' ? 'No aplica' : esc(r.v) + ' ' + esc(it.unidad || '')) : it.tipo === 'texto' ? esc(r.v || '') : ({ C: 'Cumple', NC: 'No cumple', SI: 'Sí', NO: 'No', NA: 'No aplica' }[r.v] || '-');
        return [esc(it.id), esc(it.texto) + (it.criticidad === 'critico' ? ' <span class="pill bad">Crítico</span>' : ''), '<span class="pill ' + (st === 'ok' ? 'ok' : st === 'falla' ? 'bad' : '') + '">' + val + '</span>', esc(r.obs || '') + (r.fotos && r.fotos.length ? ' <button class="btn sm ghost no-print" data-sv="ver-foto" data-id="' + esc(r.fotos[0]) + '">Foto (' + r.fotos.length + ')</button>' : '')];
      }));
    });
    var ncs = S.nc.filter(function (n) { return n.visita === v.id; });
    if (ncs.length) h += '<h2 style="margin-top:16px">No conformidades abiertas por este registro</h2>' + tablaNC(ncs);
    return h + '<p class="muted small" style="margin-top:14px">Registro inmutable. Sello y horas puestos por el servidor. Cualquier cambio posterior queda en la bitácora de auditoría.</p></section>';
  }
  function listaVisitas(lista, abiertas) {
    if (!lista.length) return '<section class="card">' + vacio(abiertas ? 'No tiene borradores abiertos.' : 'Sin registros con este filtro.') + '</section>';
    lista = lista.slice().sort(function (a, b) { return String(b.cerrada_srv || b.inicio || b.fecha).localeCompare(String(a.cerrada_srv || a.inicio || a.fecha)); });
    return '<section class="card">' + tabla(['Fecha', 'Plantilla', 'Local', 'Quién', 'Resultado', ''], lista.slice(0, 200).map(function (v) {
      var pl = v.plantilla_snap || {};
      return [esc(v.fecha + ' ' + (v.hora_inicio || '')), esc(pl.nombre || v.plantilla), esc(tiendaNom(v.tienda)), esc(v.supervisor_nombre || ''),
        v.estado !== 'cerrada' ? '<span class="pill gold">Borrador</span>' : (v.resultado === 'aprobado' ? '<span class="pill ok">Aprobado</span>' : '<span class="pill bad">No aprobado</span>') + (v.puntaje != null ? ' ' + v.puntaje : ''),
        '<button class="btn sm" data-sv="abrir" data-id="' + esc(v.id) + '">' + (v.estado === 'cerrada' ? 'Ver' : 'Continuar') + '</button>'];
    })) + '</section>';
  }
  function viewHistorial() {
    var f = S.histF || { t: '', p: '' };
    var lista = S.visitas.filter(function (v) { return v.estado === 'cerrada' && (!f.t || v.tienda === f.t) && (!f.p || v.plantilla === f.p); });
    var h = '<section class="card" style="margin-bottom:14px"><div class="toolbar"><div class="fld"><label class="f" for="hf-t">Local</label><select class="inp" id="hf-t" data-sv="hf" data-k="t"><option value="">Todos</option>' + todas().map(function (t) { return '<option value="' + esc(t.id) + '"' + (f.t === t.id ? ' selected' : '') + '>' + esc(t.codigo + ' ' + t.nombre) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fld"><label class="f" for="hf-p">Plantilla</label><select class="inp" id="hf-p" data-sv="hf" data-k="p"><option value="">Todas</option>' + Object.keys(S.plantillas).sort().map(function (k) { return '<option value="' + esc(k) + '"' + (f.p === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></div>' +
      (A.es('central', 'gerencia', 'auditor', 'supervisor') ? '<button class="btn sm ghost" data-sv="hist-csv">Descargar CSV</button>' : '') + '</div></section>';
    return h + listaVisitas(lista, false);
  }
  function tablaNC(lista) {
    return tabla(['Local', 'Hallazgo', 'Tipo', 'Plazo', 'Estado', ''], lista.map(function (n) {
      var venc = n.estado !== 'cerrada' && n.plazo && n.plazo < hoy();
      return [esc(tiendaNom(n.tienda)), esc(n.hallazgo) + '<div class="muted small">' + esc(n.requisito || '') + (n.evidencia ? ' · ' + esc(n.evidencia) : '') + '</div>' + (n.accion_correctiva ? '<div class="small">Acción correctiva: ' + esc(n.accion_correctiva) + '</div>' : ''),
        '<span class="pill ' + ({ critica: 'bad', mayor: 'warn', menor: '' }[n.tipo] || '') + '">' + esc(n.tipo) + '</span>', esc(n.plazo || '') + (venc ? ' <span class="pill bad">Vencida</span>' : ''),
        n.estado === 'cerrada' ? '<span class="pill ok">Cerrada</span><div class="muted small">' + esc(fechaHora(n.cerrada_srv)) + '</div>' : '<span class="pill warn">Abierta</span>',
        n.estado === 'cerrada' ? '' : ((A.es('licenciatario') || A.es('central', 'gerencia')) ? '<button class="btn sm ghost" data-sv="nc-accion" data-id="' + esc(n.id) + '">Acción correctiva</button> ' : '') + (A.es('central', 'gerencia', 'auditor', 'supervisor') ? '<button class="btn sm" data-sv="nc-cerrar" data-id="' + esc(n.id) + '">Verificar y cerrar</button>' : '')];
    }));
  }
  function viewNC() {
    var ab = S.nc.filter(function (n) { return n.estado !== 'cerrada'; }).sort(function (a, b) { return String(a.plazo).localeCompare(String(b.plazo)); });
    var ce = S.nc.filter(function (n) { return n.estado === 'cerrada'; }).sort(function (a, b) { return String(b.cerrada_srv).localeCompare(String(a.cerrada_srv)); }).slice(0, 50);
    return '<section class="card" style="margin-bottom:14px"><h2>Abiertas</h2><p class="muted small">Plazos según GAL-EL-001: crítica 1 día, mayor 3 días, menor 2 días desde el hallazgo. Solo la central, la auditoría o la supervisión verifican y cierran.</p>' + (ab.length ? tablaNC(ab) : vacio('Sin no conformidades abiertas.')) + '</section>' +
      '<section class="card"><h2>Cerradas recientes</h2>' + (ce.length ? tablaNC(ce) : vacio('Ninguna.')) + '</section>';
  }

  /* ---------- bitácora ---------- */
  function viewBitacora() {
    if (A.modo !== 'red') return '<section class="card">' + vacio('La bitácora de auditoría vive en la base en línea. En el modo demo no se registra.') + '</section>';
    var f = S.bitaFiltro, h = '<section class="card" style="margin-bottom:14px"><p class="muted small">Cada alta, cambio o borrado queda registrado con hora del servidor, usuario, rol y operador. Los registros están encadenados con SHA-256: si alguien alterara uno, la verificación lo detecta. Nadie, ni la central, puede editar o borrar la bitácora.</p><div class="toolbar">' +
      '<div class="fld"><label class="f" for="bf-t">Local</label><select class="inp" id="bf-t" data-sv="bf" data-k="tienda"><option value="">Todos</option>' + todas().map(function (t) { return '<option value="' + esc(t.id) + '"' + (f.tienda === t.id ? ' selected' : '') + '>' + esc(t.codigo + ' ' + t.nombre) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fld"><label class="f" for="bf-c">Tipo de registro</label><select class="inp" id="bf-c" data-sv="bf" data-k="col"><option value="">Todos</option>' + ['mov', 'conteo', 'ventas', 'pax', 'visitas', 'nc', 'tiendas', 'locales_ev', 'personas', 'novedades', 'personal', 'perfiles', 'kits', 'aceptaciones'].map(function (c) { return '<option' + (f.col === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>' +
      '<button class="btn primary" data-sv="bita-cargar">Consultar</button>' + (A.es('central', 'gerencia', 'auditor') ? '<button class="btn" data-sv="bita-verif">Verificar integridad</button>' : '') + (S.bita && S.bita.length ? '<button class="btn ghost" data-sv="bita-csv">Descargar CSV</button>' : '') + '</div>';
    if (S.verif) h += '<div class="alert-box ' + (S.verif.primer_error ? 'warn' : 'info') + '" style="margin-top:10px">' + (S.verif.primer_error ? 'Cadena rota en el registro n.º ' + S.verif.primer_error + '. Informe a la gerencia.' : 'Cadena íntegra: ' + S.verif.revisados + ' registros verificados. Última huella: <code>' + esc(String(S.verif.ultimo_hash || '').slice(0, 16)) + '…</code>') + '</div>';
    h += '</section>';
    if (S.bita) h += '<section class="card">' + (S.bita.length ? tabla(['N.º', 'Hora', 'Usuario', 'Rol', 'Operador', 'Acción', 'Registro', 'Local'], S.bita.map(function (b) {
      return [b.n, esc(fechaHora(b.ts)), esc(b.actor), esc(b.rol || ''), esc(b.operador || ''), esc({ insert: 'alta', update: 'cambio', delete: 'borrado' }[b.accion] || b.accion), esc(b.col + ' / ' + b.doc_id), esc(tiendaNom(b.tienda))];
    })) : vacio('Sin registros.')) + '</section>';
    return h;
  }
  function cargarBitacora() {
    var q = A.sb.from('bitacora').select('n,ts,actor,rol,operador,accion,col,doc_id,tienda,datos_hash,hash').order('n', { ascending: false }).limit(300);
    if (S.bitaFiltro.tienda) q = q.eq('tienda', S.bitaFiltro.tienda); if (S.bitaFiltro.col) q = q.eq('col', S.bitaFiltro.col);
    q.then(function (r) { if (r.error) return toast('No se pudo leer la bitácora: ' + r.error.message, true); S.bita = r.data; rerender(); });
  }

  /* =====================================================================
     LOCALES
     ===================================================================== */
  function fichaCampos() {
    var f = ciclo().ficha; if (f && f.length) return f;
    return [{ campo: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, aplica: 'ambos' }, { campo: 'formato', etiqueta: 'Formato', tipo: 'texto', aplica: 'ambos' },
      { campo: 'direccion', etiqueta: 'Dirección', tipo: 'texto', aplica: 'ambos' }, { campo: 'razon_social', etiqueta: 'Razón social del licenciatario', tipo: 'texto', aplica: 'licenciatario' },
      { campo: 'ruc', etiqueta: 'RUC', tipo: 'texto', aplica: 'licenciatario' }, { campo: 'contrato_inicio', etiqueta: 'Fecha del contrato', tipo: 'fecha', aplica: 'licenciatario' }];
  }
  function viewLocales() {
    if (S.ficha) return viewFicha();
    var C = ciclo(), ts = todas().filter(function (t) { return !A.es('licenciatario') || t.titular === (A.perfil && A.perfil.titular); });
    var cuenta = {}; ts.forEach(function (t) { cuenta[t.estado] = (cuenta[t.estado] || 0) + 1; });
    var h = head('Locales de la red', A.es('central', 'gerencia') ? '<button class="btn primary" data-sv="loc-nuevo">Nuevo local</button>' : '');
    h += '<section class="card" style="margin-bottom:14px"><div class="kpis">' + (C.estados || []).filter(function (e) { return cuenta[e.id]; }).map(function (e) { return '<div class="kpi"><small>' + esc(e.nombre) + '</small><b class="num">' + cuenta[e.id] + '</b></div>'; }).join('') + '</div>' +
      '<p class="muted small">Un local nunca se borra: sale de la red por su ciclo de vida (salida, desidentificación y cierre), y su historial se conserva. Su código no se vuelve a usar.</p></section>';
    var pend = S.ev.filter(function (e) { return e.pendiente === true; });
    if (pend.length && A.es('central', 'gerencia')) h += '<section class="card" style="margin-bottom:14px"><h2>Pendientes de segunda aprobación</h2>' + tabla(['Local', 'Cambio', 'Motivo', 'Solicitó', ''], pend.map(function (e) {
      return [esc(tiendaNom(e.tienda)), esc(estadoNom(e.de)) + ' → ' + esc(estadoNom(e.a)), esc(e.motivo || ''), esc(e.solicita || '') + ' · ' + esc(fechaHora(e.ts)), e.solicita === (A.perfil && A.perfil.email) ? '<span class="muted small">Espera a otra persona</span>' : '<button class="btn sm primary" data-sv="loc-aprobar" data-t="' + esc(e.tienda) + '" data-a="' + esc(e.a) + '">Aprobar</button>'];
    })) + '</section>';
    h += '<section class="card">' + tabla(['Código', 'Local', 'Tipo', 'Estado', 'Desde', 'Licencia vence', ''], ts.map(function (t) {
      var lic = t.t.licencia || {};
      return [esc(t.codigo), esc(t.nombre) + (t.t.formato ? '<div class="muted small">' + esc(t.t.formato) + '</div>' : ''), t.tipo === 'licenciatario' ? '<span class="pill gold">Licenciatario</span><div class="muted small">' + esc(t.t.razon_social || t.titular) + '</div>' : '<span class="pill navy">Propia</span>',
        estadoPill(t.estado), esc(t.t.estado_desde ? String(t.t.estado_desde).slice(0, 10) : ''), esc(lic.vence || t.t.licencia_vence || ''), '<button class="btn sm" data-sv="loc-ficha" data-id="' + esc(t.id) + '">Abrir</button>'];
    })) + '</section>';
    return h;
  }
  function viewFicha() {
    var nuevo = S.ficha === '_nuevo', t = nuevo ? { id: '', estado: 'prospecto', tipo: S.fichaTipo || 'propia', t: { tipo: S.fichaTipo || 'propia' } } : todas().filter(function (x) { return x.id === S.ficha; })[0];
    if (!t) { if (S.fichaEspera && Date.now() - S.fichaEspera < 8000) { setTimeout(rerender, 600); return '<section class="card">' + vacio('Cargando la ficha del local…') + '</section>'; } S.ficha = null; return viewLocales(); }
    var C = ciclo(), edit = A.es('central', 'gerencia') && ['cerrado', 'descartado'].indexOf(t.estado) < 0, tipo = t.tipo;
    var h = head(nuevo ? 'Nuevo local' : esc(t.codigo + ' ' + t.nombre), '<button class="btn sm ghost" data-sv="loc-volver">Volver</button>');
    h += '<section class="card" style="margin-bottom:14px"><h2>Ficha</h2>' + (nuevo ? '' : '<p>' + estadoPill(t.estado) + ' <span class="muted small">' + esc(t.tipo === 'licenciatario' ? 'Licenciatario ' + (t.t.razon_social || t.titular) : 'Tienda propia') + '</span></p>') + '<div class="grid2">';
    if (nuevo) h += '<div class="fld"><label class="f" for="lf-codigo">Código (no se reutiliza)</label><input class="inp" id="lf-codigo" placeholder="G05"></div>' +
      '<div class="fld"><label class="f" for="lf-tipo">Tipo</label><select class="inp" id="lf-tipo" data-sv="lf-tipo"><option value="propia"' + (tipo === 'propia' ? ' selected' : '') + '>Tienda propia</option><option value="licenciatario"' + (tipo === 'licenciatario' ? ' selected' : '') + '>Licenciatario</option></select></div>' +
      (tipo === 'licenciatario' ? '<div class="fld"><label class="f" for="lf-titular">Id del licenciatario (sin espacios, el mismo para todos sus locales)</label><input class="inp" id="lf-titular" placeholder="lic-nombre"></div>' : '');
    fichaCampos().filter(function (c) { return c.campo !== 'codigo' && c.campo !== 'tipo' && (c.aplica === 'ambos' || !c.aplica || c.aplica === tipo); }).forEach(function (c) {
      var val = t.t[c.campo]; if (val && typeof val === 'object') val = JSON.stringify(val);
      var typ = c.tipo === 'fecha' ? 'date' : c.tipo === 'numero' ? 'number' : 'text'; if (c.tipo === 'coordenadas' && !val) val = '';
      h += '<div class="fld"><label class="f" for="lf-' + esc(c.campo) + '">' + esc(c.etiqueta) + (c.obligatorio ? ' *' : '') + '</label>' +
        (c.opciones ? '<select class="inp" id="lf-' + esc(c.campo) + '"' + (edit ? '' : ' disabled') + '><option value=""></option>' + c.opciones.map(function (o) { return '<option' + (String(val) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'
          : '<input class="inp" type="' + typ + '" id="lf-' + esc(c.campo) + '" value="' + esc(val == null ? '' : val) + '"' + (edit ? '' : ' disabled') + '>') + '</div>';
    });
    h += '</div>' + (edit ? '<div class="toolbar" style="margin-top:12px"><button class="btn primary" data-sv="' + (nuevo ? 'loc-alta' : 'loc-guardar') + '">' + (nuevo ? 'Dar de alta como prospecto' : 'Guardar ficha') + '</button></div>' : '') + '</section>';
    if (nuevo) return h + '<section class="card"><p class="muted small">El local entra como <b>prospecto</b>: no aparece en operación ni en horarios hasta pasar a "en apertura". La apertura exige la auditoría AUD-APE aprobada.</p></section>';
    var trs = (C.transiciones || []).filter(function (x) { return x.de === t.estado; });
    h += '<section class="card" style="margin-bottom:14px"><h2>Cambiar estado</h2>' + (trs.length ? '<div class="sv-trs">' + trs.map(function (x) {
      var puede = (x.roles || []).indexOf(A.rol()) >= 0 || A.modo === 'demo', gate = x.requiere_plantilla, gateOk = !gate || gateCumplida(t, gate);
      return '<div class="sv-tr"><div><b>' + esc(x.nombre) + '</b> <span class="muted">→ ' + esc(estadoNom(x.a)) + '</span><div class="muted small">' + esc(x.registro || '') + (x.doble_aprobacion ? ' · requiere dos personas' : '') + (gate ? ' · compuerta ' + esc(gate) + ': ' + (gateOk ? 'cumplida' : '<b>pendiente</b>') : '') + '</div></div>' +
        (puede ? '<button class="btn sm' + (gateOk ? ' primary' : '') + '" data-sv="loc-tr" data-a="' + esc(x.a) + '" data-m="' + (x.motivo_obligatorio ? 1 : 0) + '"' + (gateOk ? '' : ' disabled') + '>Ejecutar</button>' : '<span class="muted small">Lo ejecuta: ' + esc((x.roles || []).join(', ')) + '</span>') + '</div>';
    }).join('') + '</div>' : vacio('Estado final: sin cambios posibles.')) + '</section>';
    var evs = S.ev.filter(function (e) { return e.tienda === t.id; }).sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    h += '<section class="card" style="margin-bottom:14px"><h2>Historial del local</h2>' + (evs.length ? tabla(['Fecha', 'Cambio', 'Motivo', 'Registro', 'Quién'], evs.map(function (e) {
      return [esc(fechaHora(e.ts)), esc(e.de ? estadoNom(e.de) + ' → ' : '') + esc(estadoNom(e.a)) + (e.pendiente === true ? ' <span class="pill gold">Pendiente</span>' : ''), esc(e.motivo || ''), esc(e.registro || ''), esc(e.actor || e.solicita || '') + (e.aprobada_por ? '<div class="muted small">aprobó ' + esc(e.aprobada_por) + '</div>' : '')];
    })) : vacio('Sin eventos registrados.')) + '</section>';
    var vis = S.visitas.filter(function (v) { return v.tienda === t.id && v.estado === 'cerrada'; }).length, ncs = S.nc.filter(function (n) { return n.tienda === t.id && n.estado !== 'cerrada'; }).length;
    h += '<section class="card"><h2>Datos del local</h2><p class="muted small">' + vis + ' registros de supervisión o auditoría · ' + ncs + ' no conformidades abiertas.</p>' +
      (A.es('central', 'gerencia') ? '<p class="muted small">Exportación completa de lo que este local registró en la aplicación (movimientos, conteos, ventas, mesas, horarios, supervisión, no conformidades e historial). Sirve para entregar datos a un licenciatario saliente o para el expediente del local. Las fotos de evidencia y los PIN no se incluyen.</p><button class="btn" data-sv="loc-export" data-id="' + esc(t.id) + '">Exportar datos del local</button>' : '') + '</section>';
    return h;
  }
  function leerFicha() {
    var o = {}; fichaCampos().forEach(function (c) { var el = $('lf-' + c.campo); if (!el) return; var v = el.value.trim(); if (c.tipo === 'numero') v = v === '' ? null : +v; o[c.campo] = v; }); return o;
  }
  function exportarLocal(id) {
    var dbx = db(), cols = ['mov', 'conteo', 'ventas', 'pax', 'personal', 'personas', 'novedades', 'visitas', 'nc', 'locales_ev'], out = { app: 'cafe_galletti', tipo: 'exportacion_local', local: id, ficha: (App().S.tiendas || {})[id], exportado: new Date().toISOString(), por: A.nombreOperador(), datos: {} };
    var p = Promise.resolve();
    cols.forEach(function (c) {
      p = p.then(function () { return dbx.collection(c).get(); }).then(function (s) {
        out.datos[c] = s.docs.map(function (x) { var d = x.data(); return { id: x.id, d: d }; }).filter(function (x) {
          var d = x.d; return d.tienda === id || d.tiendaId === id || d.destino === id || (c === 'novedades' && (App().S.personas || {})[d.personaId] && App().S.personas[d.personaId].tiendaId === id);
        }).map(function (x) { var d = JSON.parse(JSON.stringify(x.d)); delete d.pinHash; d.id = x.id; return d; });
      });
    });
    p.then(function () { return sha256(JSON.stringify(out.datos)); }).then(function (h) {
      out.huella_sha256 = h; Alba.descargar('local_' + id + '_' + hoy() + '.json', JSON.stringify(out, null, 1));
      return guardar(function () { return dbx.collection('archivo').doc('exp_' + id + '_' + Date.now()).set({ tipo: 'exportacion_local', local: id, huella: h, fecha: hoy(), por: A.nombreOperador() }); }, 'Datos del local exportados. Huella: ' + h.slice(0, 12) + '…');
    }, function (e) { toast('No se pudo exportar: ' + errMsg(e), true); });
  }

  /* =====================================================================
     PRIVACIDAD, TÉRMINOS Y LICENCIAS
     ===================================================================== */
  function legalVer() { return (S.legal && S.legal.version) || '0'; }
  function idAcept() { return A.perfil ? A.perfil.email + '_' + legalVer() : null; }
  function revisarLegal() {
    if (A.modo !== 'red' || !A.perfil || !S.legal || !S.legalCargado || document.getElementById('alba-legal')) return;
    if (!S.acept[idAcept()]) mostrarLegal(true);
  }
  function mostrarLegal(obligatorio, soloLicencias) {
    var L = S.legal || {}, root = document.createElement('div'); root.id = 'alba-legal'; root.className = 'sheet-bg';
    var lic = (window.ALBA_SEED_SUP && ALBA_SEED_SUP.licencias) || '';
    root.innerHTML = '<div class="sheet card alba-legal" role="dialog" aria-modal="true" aria-labelledby="lg-t"><h2 id="lg-t">' + (soloLicencias ? 'Licencias de software' : 'Aviso de privacidad y términos de uso') + '</h2>' +
      (soloLicencias ? '' : '<p class="muted small">Versión ' + esc(legalVer()) + '. ' + (obligatorio ? 'Para usar la aplicación debe leer y aceptar estos textos.' : '') + '</p>' +
        '<div class="alba-legal-txt"><h3>Aviso de privacidad</h3>' + texto(L.aviso) + '<h3>Términos de uso</h3>' + texto(L.terminos) + '<h3>Propiedad y confidencialidad</h3>' + texto(L.leyenda) + '</div>') +
      (lic ? '<details' + (soloLicencias ? ' open' : '') + '><summary>Licencias de componentes de código abierto</summary><div class="alba-legal-txt">' + texto(lic) + '</div></details>' : '') +
      '<div class="toolbar" style="margin-top:12px">' + (obligatorio ? '<div style="display:grid;gap:6px;width:100%"><label class="small"><input type="checkbox" id="lg-aviso"> He leído el aviso de privacidad</label><label class="small"><input type="checkbox" id="lg-ok"> Acepto los términos de uso</label></div><button class="btn primary" data-sv="lg-aceptar">Continuar</button><button class="btn ghost" data-op="salir">Salir</button>' : '<button class="btn" data-sv="lg-cerrar">Cerrar</button>') + '</div></div>';
    document.body.appendChild(root);
  }
  function texto(t) { return String(t || '').split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join(''); }
  function aceptar(id, extra) {
    return db().collection('aceptaciones').doc(id).set(Object.assign({ email: A.perfil ? A.perfil.email : 'demo', version: legalVer(), fecha: hoy(), ua: navigator.userAgent.slice(0, 140) }, extra || {}));
  }
  // aceptación del operador (persona con PIN dentro de la cuenta de la tienda)
  window.AlbaLegal = {
    operador: function (op) {
      if (A.modo !== 'red' || !op || !op.id || !S.legal) return;
      var id = A.perfil.email + '_op_' + op.id + '_' + legalVer(); if (S.acept[id]) return;
      if (confirm(S.legal.operador ? String(S.legal.operador).replace(/\{NOMBRE\}/g, op.nombre).replace(/\{RESPONSABLE DEL LOCAL\}/g, responsableDe(A.tienda())) : ('Antes de registrar, ' + op.nombre + ': su PIN es su firma electrónica y la aplicación guarda su nombre en cada registro. ¿Está de acuerdo?')))
        aceptar(id, { tipo: 'operador_firma', personalId: op.id, nombre: op.nombre, tienda: A.tienda() }).catch(function () {});
      else { Alba.soltarOperador(); rerender(); }
    },
    abrir: function () { mostrarLegal(false); }, licencias: function () { mostrarLegal(false, true); }
  };
  function responsableDe(tid) { var t = todas().filter(function (x) { return x.id === tid; })[0]; return t && t.tipo === 'licenciatario' ? (t.t.razon_social || 'el licenciatario del local') : '[RAZÓN SOCIAL DEL TITULAR]'; }
  function pie() {
    var f = document.getElementById('alba-pie');
    if (!f) { f = document.createElement('footer'); f.id = 'alba-pie'; f.className = 'alba-pie no-print'; document.body.appendChild(f); }
    var t = esc((S.legal && S.legal.leyenda_corta) || 'Café Galletti · uso interno y de licenciatarios autorizados') + ' · <a href="#" data-sv="lg-ver">Privacidad y términos</a> · <a href="#" data-sv="lg-lic">Licencias</a>';
    if (f.innerHTML !== t) f.innerHTML = t;
  }

  /* ---------- foto de evidencia: se reduce a 1024 px antes de guardarla ---------- */
  function foto(input) {
    var file = input.files && input.files[0], iid = input.dataset.i, v = S.visitas.filter(function (x) { return x.id === S.activa; })[0]; if (!file || !v) return;
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var k = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      var data = c.toDataURL('image/jpeg', 0.62), eid = nuevoId('e');
      sha256(data).then(function (h) {
        return guardar(function () {
          return db().collection('evidencias').doc(eid).set({ tienda: v.tienda, visita: v.id, item: iid, img: data, sha256: h, fecha: hoy(), tomada: new Date().toISOString() }).then(function () {
            var r = Object.assign({}, (v.respuestas || {})[iid]); r.fotos = (r.fotos || []).concat([eid]); return setResp(v, iid, r);
          });
        }, 'Foto guardada');
      });
    };
    img.src = url;
  }
  function verFoto(id) {
    db().doc('evidencias/' + id).get().then(function (s) {
      if (!s.exists) return toast('Foto no disponible', true);
      var d = s.data(), w = document.createElement('div'); w.className = 'sheet-bg'; w.dataset.sv = 'cerrar-hoja';
      w.innerHTML = '<div class="sheet card" style="max-width:720px"><img src="' + esc(d.img) + '" alt="Evidencia" style="max-width:100%;display:block"><p class="muted small">' + esc(fechaHora(d.tomada)) + ' · SHA-256 ' + esc(String(d.sha256).slice(0, 16)) + '…</p><button class="btn" data-sv="cerrar-hoja">Cerrar</button></div>';
      document.body.appendChild(w);
    }, function (e) { toast(errMsg(e), true); });
  }

  /* ---------- respuestas con guardado inmediato ---------- */
  var timers = {};
  function setResp(v, iid, r) {
    v.respuestas = v.respuestas || {}; v.respuestas[iid] = r; r.t = new Date().toISOString();
    var cambio = {}; cambio.respuestas = v.respuestas;
    return db().collection('visitas').doc(v.id).update(cambio);
  }
  function respDiferida(v, iid, r) {
    v.respuestas = v.respuestas || {}; v.respuestas[iid] = r; S.borr[v.id + '|' + iid] = { v: v.id, i: iid, r: r };
    clearTimeout(timers[v.id]); timers[v.id] = setTimeout(function () {
      var pend = Object.keys(S.borr).filter(function (k) { return S.borr[k].v === v.id; });
      db().collection('visitas').doc(v.id).update({ respuestas: v.respuestas }).then(function () { pend.forEach(function (k) { delete S.borr[k]; }); }, function (e) { toast('No se guardó: ' + errMsg(e), true); });
    }, 900);
  }
  function visitaActiva() { return S.visitas.filter(function (x) { return x.id === S.activa; })[0]; }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-sv]'); if (!el) return;
    var op = el.dataset.sv;
    if (['tienda', 'num', 'obs', 'txt', 'foto', 'sinfoto', 'hf', 'bf', 'lf-tipo'].indexOf(op) >= 0) return;
    if (op === 'cerrar-hoja') { if (ev.target === el || el.tagName === 'BUTTON') { var bg = el.closest('.sheet-bg'); if (bg) bg.remove(); } return; }
    ev.preventDefault();
    var v = visitaActiva();
    switch (op) {
      case 'sub': S.sub[el.dataset.r] = el.dataset.v; S.verif = null; rerender(); break;
      case 'plant': S.plantSel = el.dataset.v; rerender(); break;
      case 'iniciar': iniciar(el.dataset.v); break;
      case 'abrir': S.activa = el.dataset.id; rerender(); window.scrollTo(0, 0); break;
      case 'volver': S.activa = null; rerender(); break;
      case 'imprimir': window.print(); break;
      case 'resp': {
        if (!v) return; var r = Object.assign({}, (v.respuestas || {})[el.dataset.i]); r.v = r.v === el.dataset.v ? null : el.dataset.v;
        guardar(function () { return setResp(v, el.dataset.i, r); }); rerender(); break;
      }
      case 'ir': { var t = document.getElementById('it-' + el.dataset.i); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.add('sv-ir'); setTimeout(function () { t.classList.remove('sv-ir'); }, 1600); } break; }
      case 'cerrar': if (v) cerrarVisita(v); break;
      case 'descartar': if (v && confirm('¿Descartar este borrador? Queda constancia en la bitácora.')) guardar(function () { return db().collection('visitas').doc(v.id).delete(); }, 'Borrador descartado').then(function (ok) { if (ok) { S.activa = null; rerender(); } }); break;
      case 'ver-foto': verFoto(el.dataset.id); break;
      case 'geo-consent':
        if (confirm(((S.legal && S.legal.geo) || 'La aplicación registrará la ubicación del teléfono solo al empezar y al cerrar cada visita, para dejar constancia de que se hizo en el local. No se rastrea su ubicación en otro momento. Puede retirar este permiso pidiéndolo a la central.') + '\n\n¿Acepta?'))
          guardar(function () { return aceptar(A.perfil.email + '_geo_' + legalVer(), { tipo: 'geolocalizacion' }); }, 'Ubicación de visitas activada');
        break;
      case 'nc-accion': {
        var n = S.nc.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!n) return;
        var a = prompt('Acción correctiva (causa, qué se hizo, responsable y fecha):', n.accion_correctiva || ''); if (a == null) return;
        guardar(function () { return db().collection('nc').doc(n.id).update({ accion_correctiva: a, accion_por: A.nombreOperador(), accion_fecha: hoy() }); }, 'Acción correctiva registrada'); break;
      }
      case 'nc-cerrar': {
        var n2 = S.nc.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!n2) return;
        var e2 = prompt('Verificación del cierre: qué se comprobó y con qué evidencia (en tienda para las críticas).'); if (!e2) return;
        guardar(function () { return db().collection('nc').doc(n2.id).update({ estado: 'cerrada', verificacion: e2, verificada_por: A.nombreOperador() }); }, 'No conformidad cerrada'); break;
      }
      case 'hist-csv': {
        var rows = [['fecha', 'hora', 'plantilla', 'local', 'quien', 'resultado', 'puntaje', 'fallas', 'criticos', 'sello']];
        S.visitas.filter(function (x) { return x.estado === 'cerrada'; }).forEach(function (x) { rows.push([x.fecha, x.hora_inicio, x.plantilla, tiendaNom(x.tienda), x.supervisor_nombre, x.resultado, x.puntaje == null ? '' : x.puntaje, (x.fallas || []).join(' '), (x.criticos_fallidos || []).join(' '), x.sello || '']); });
        Alba.descargar('supervision_' + hoy() + '.csv', '﻿' + rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).replace(/;/g, ','); }).join(';'); }).join('\n')); break;
      }
      case 'bita-cargar': cargarBitacora(); break;
      case 'bita-verif': A.sb.rpc('alba_bitacora_verificar', {}).then(function (r) { if (r.error) return toast(r.error.message, true); S.verif = r.data && r.data[0]; rerender(); }); break;
      case 'bita-csv': {
        var bw = [['n', 'ts', 'actor', 'rol', 'operador', 'accion', 'col', 'doc_id', 'tienda', 'datos_hash', 'hash']].concat(S.bita.map(function (b) { return [b.n, b.ts, b.actor, b.rol, b.operador, b.accion, b.col, b.doc_id, b.tienda, b.datos_hash, b.hash]; }));
        Alba.descargar('bitacora_' + hoy() + '.csv', '﻿' + bw.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).replace(/;/g, ','); }).join(';'); }).join('\n')); break;
      }
      case 'loc-nuevo': S.ficha = '_nuevo'; S.fichaTipo = 'propia'; rerender(); break;
      case 'loc-ficha': S.ficha = el.dataset.id; rerender(); window.scrollTo(0, 0); break;
      case 'loc-volver': S.ficha = null; rerender(); break;
      case 'loc-alta': {
        var f = leerFicha(), cod = ($('lf-codigo').value || '').trim().toUpperCase(), tipo = $('lf-tipo').value, titular = (($('lf-titular') || {}).value || '').trim().toLowerCase();
        if (!/^[A-Z0-9-]{2,12}$/.test(cod)) return toast('Código no válido (letras y números, ej. G05 o L01)', true);
        var falta = fichaCampos().filter(function (c) { return c.obligatorio && (c.aplica === 'ambos' || !c.aplica || c.aplica === tipo) && !f[c.campo]; });
        if (falta.length) return toast('Falta: ' + falta.map(function (c) { return c.etiqueta; }).join(', '), true);
        if (tipo === 'licenciatario' && !/^[a-z0-9_-]{2,30}$/.test(titular)) return toast('Indique el id del licenciatario (minúsculas, sin espacios)', true);
        var motivo = prompt('Motivo o referencia del alta (por ejemplo: postulación aprobada, GAL-REG-201):'); if (motivo == null) return;
        var ficha = Object.assign(f, { codigo: cod, tipo: tipo, titular: tipo === 'licenciatario' ? titular : 'galletti', apertura: '08:00', cierre: '19:00', diasAbiertos: [true, true, true, true, true, true, true], regimen: 'ordinaria', objetivoPersonas: 6, extendida: { activa: false, cierre: '' } });
        guardar(function () { return rpc('alba_local_alta', { p_id: cod.toLowerCase(), p_ficha: ficha, p_motivo: motivo }); }, 'Local ' + cod + ' dado de alta como prospecto').then(function (r) { if (r) { S.ficha = cod.toLowerCase(); S.fichaEspera = Date.now(); rerender(); } });
        break;
      }
      case 'loc-guardar': {
        var f2 = leerFicha();
        guardar(function () { return db().collection('tiendas').doc(S.ficha).update(f2); }, 'Ficha guardada'); break;
      }
      case 'loc-tr': case 'loc-aprobar': {
        var tid = op === 'loc-aprobar' ? el.dataset.t : S.ficha, a2 = el.dataset.a, mot = null;
        if (op === 'loc-tr') { mot = prompt('Motivo y referencia (número de acta, NC, contrato):'); if (mot == null) return; if (el.dataset.m === '1' && !mot.trim()) return toast('Esta transición exige un motivo', true); }
        else if (!confirm('¿Aprobar el cambio de estado de ' + tiendaNom(tid) + ' a "' + estadoNom(a2) + '"?')) return;
        if (['en_salida', 'cerrado', 'descartado'].indexOf(a2) >= 0 && !confirm('Con este cambio se desactivan la cuenta del local y los PIN de su personal. Sus registros se conservan. ¿Continuar?')) return;
        guardar(function () { return rpc('alba_local_transicion', { p_tienda: tid, p_a: a2, p_motivo: mot, p_ref: null }); }).then(function (r) { if (r) toast(r.pendiente ? r.mensaje : 'Estado cambiado a "' + estadoNom(r.a) + '"'); });
        break;
      }
      case 'loc-export': exportarLocal(el.dataset.id); break;
      case 'lg-aceptar':
        if (!$('lg-ok').checked || !$('lg-aviso').checked) return toast('Marque las dos casillas para continuar', true);
        sha256(JSON.stringify([(S.legal || {}).aviso, (S.legal || {}).terminos, (S.legal || {}).leyenda])).then(function (h) { return aceptar(idAcept(), { tipo: 'terminos', aviso_leido: true, huella_texto: h }); }).then(function () { var x = $('alba-legal'); if (x) x.remove(); toast('Gracias. Aceptación registrada.'); }, function (e) { toast(errMsg(e), true); }); break;
      case 'lg-cerrar': { var y = $('alba-legal'); if (y) y.remove(); break; }
      case 'lg-ver': mostrarLegal(false); break;
      case 'lg-lic': mostrarLegal(false, true); break;
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target; if (!el.dataset || !el.dataset.sv) return;
    var op = el.dataset.sv, v = visitaActiva();
    if (op === 'tienda') { S.tiendaSel = el.value; rerender(); }
    else if (op === 'num' && v) { var r = Object.assign({}, (v.respuestas || {})[el.dataset.i]); r.v = el.value === '' ? null : +el.value; guardar(function () { return setResp(v, el.dataset.i, r); }); rerender(); }
    else if (op === 'foto') foto(el);
    else if (op === 'sinfoto' && v) { var r2 = Object.assign({}, (v.respuestas || {})[el.dataset.i]); r2.sinFoto = el.checked; guardar(function () { return setResp(v, el.dataset.i, r2); }); rerender(); }
    else if (op === 'hf') { S.histF = S.histF || { t: '', p: '' }; S.histF[el.dataset.k] = el.value; rerender(); }
    else if (op === 'bf') { S.bitaFiltro[el.dataset.k] = el.value; }
    else if (op === 'lf-tipo') { var vals = {}; Array.prototype.forEach.call(document.querySelectorAll('[id^=lf-]'), function (x) { vals[x.id] = x.value; }); S.fichaTipo = el.value; rerender(); Object.keys(vals).forEach(function (k) { var x = $(k); if (x && k !== 'lf-tipo') x.value = vals[k]; }); }
    else if ((op === 'obs' || op === 'txt') && v) { rerender(); }
  });
  document.addEventListener('input', function (ev) {
    var el = ev.target; if (!el.dataset || (el.dataset.sv !== 'obs' && el.dataset.sv !== 'txt')) return;
    var v = visitaActiva(); if (!v) return;
    var r = Object.assign({}, (v.respuestas || {})[el.dataset.i]); if (el.dataset.sv === 'obs') r.obs = el.value; else r.v = el.value; r.t = new Date().toISOString();
    respDiferida(v, el.dataset.i, r);
  });

  /* ---------- catálogo: plantillas, ciclo de locales y textos legales (solo central y gerencia) ---------- */
  function vistaCatalogo() {
    suscribir();
    var pls = Object.keys(S.plantillas).sort().map(function (k) { return S.plantillas[k]; });
    return '<section class="card" style="margin-bottom:14px"><h2>Paquete inicial</h2><p class="muted small">Carga de una sola vez el catálogo de kits, las plantillas de supervisión, el ciclo de locales y los textos legales desde el archivo <b>paquete_inicial_cafe_galletti.json</b>. Lo que ya exista con el mismo código se reemplaza.</p><label class="btn">Elegir archivo y cargar<input type="file" accept=".json,application/json" data-sv="paquete" hidden></label></section>' +
      '<section class="card" style="margin-bottom:14px"><h2>Plantillas de supervisión y auditoría</h2><p class="muted small">' + pls.length + ' plantillas. Cada registro guarda una copia de la plantilla con la que se hizo, así que editar una plantilla no cambia el historial. Al cambiar una plantilla, suba su número de versión.</p>' +
      tabla(['Id', 'Nombre', 'Versión', 'Ítems', 'Puntúa'], pls.map(function (p) { return [esc(p.id), esc(p.nombre), esc(p.version || ''), itemsDe(p).length, p.puntua ? 'Sí (' + (p.umbral || 80) + ')' : 'No']; })) +
      '<details style="margin-top:12px"><summary>Editar en formato JSON (avanzado)</summary><textarea class="inp alba-txt" id="cp-json" style="min-height:320px">' + esc(JSON.stringify(pls, null, 1)) + '</textarea><button class="btn primary" style="margin-top:8px" data-sv="cp-save">Guardar plantillas</button></details></section>' +
      '<section class="card" style="margin-bottom:14px"><h2>Ciclo de vida de locales</h2><p class="muted small">Estados, transiciones (quién, compuerta, registro, motivo, doble aprobación) y campos de la ficha. La base aplica estas reglas en el servidor.</p><details><summary>Editar en formato JSON (avanzado)</summary><textarea class="inp alba-txt" id="cc-json" style="min-height:260px">' + esc(JSON.stringify(ciclo(), null, 1)) + '</textarea><button class="btn primary" style="margin-top:8px" data-sv="cc-save">Guardar ciclo</button></details></section>' +
      '<section class="card"><h2>Aviso de privacidad y términos</h2><p class="muted small">Versión vigente: ' + esc(legalVer()) + '. Al cambiar la versión, cada usuario debe volver a aceptar en su siguiente ingreso.</p><details><summary>Editar</summary><textarea class="inp alba-txt" id="cl-json" style="min-height:260px">' + esc(JSON.stringify(S.legal || {}, null, 1)) + '</textarea><button class="btn primary" style="margin-top:8px" data-sv="cl-save">Guardar textos</button></details></section>';
  }
  document.addEventListener('change', function (ev) {
    var el = ev.target; if (!el.dataset || el.dataset.sv !== 'paquete' || !el.files || !el.files[0]) return;
    var fr = new FileReader();
    fr.onload = function () {
      var j; try { j = JSON.parse(fr.result); } catch (e) { return toast('El archivo no es un paquete válido', true); }
      if (j.tipo !== 'paquete_inicial_cafe_galletti') return toast('El archivo no es el paquete inicial de Café Galletti', true);
      guardar(function () {
        var d = db(), p = Promise.resolve();
        (j.kits || []).forEach(function (k) { p = p.then(function () { return d.collection('kits').doc(k.codigo).set(k); }); });
        (j.plantillas || []).forEach(function (pl) { p = p.then(function () { return d.collection('plantillas').doc(pl.id).set(pl); }); });
        if (j.ciclo) p = p.then(function () { return d.doc('opcfg/ciclo').set(j.ciclo); });
        if (j.legal) p = p.then(function () { return d.doc('legal/textos').set(j.legal); });
        return p;
      }, 'Paquete cargado: ' + (j.kits || []).length + ' kits y ' + (j.plantillas || []).length + ' plantillas');
    };
    fr.readAsText(el.files[0]); el.value = '';
  });
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-sv="cp-save"],[data-sv="cc-save"],[data-sv="cl-save"]'); if (!el) return;
    var op = el.dataset.sv, txt = $(op === 'cp-save' ? 'cp-json' : op === 'cc-save' ? 'cc-json' : 'cl-json').value, j;
    try { j = JSON.parse(txt); } catch (e) { return toast('JSON no válido: ' + e.message, true); }
    if (op === 'cp-save') {
      if (!Array.isArray(j)) return toast('Debe ser una lista de plantillas', true);
      guardar(function () { var p = Promise.resolve(); j.forEach(function (pl) { p = p.then(function () { return db().collection('plantillas').doc(pl.id).set(pl); }); }); return p; }, 'Plantillas guardadas');
    } else if (op === 'cc-save') guardar(function () { return db().doc('opcfg/ciclo').set(j); }, 'Ciclo guardado');
    else guardar(function () { return db().doc('legal/textos').set(j); }, 'Textos guardados');
  });

  /* ---------- integración con el enrutador ---------- */
  var RUTAS = [
    ['supervision', 'Supervisión', 'check', function () { return true; }],
    ['locales', 'Locales', 'pin', function () { return A.es('central', 'gerencia', 'supervisor', 'oficina', 'auditor', 'licenciatario'); }]
  ];
  window.AlbaSup = {
    rutas: function () { return RUTAS.filter(function (r) { return r[3](); }).map(function (r) { return [r[0], r[1], r[2]]; }); },
    iconos: { check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9"/>', pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>' },
    tiene: function (r) { return RUTAS.some(function (x) { return x[0] === r && x[3](); }); },
    vista: function (r) { suscribir(); if (r === 'supervision') return viewSupervision(); if (r === 'locales') return viewLocales(); return ''; },
    despues: function () { suscribir(); pie(); revisarLegal(); },
    vistaCatalogo: vistaCatalogo, estadoDe: function (id) { var t = todas().filter(function (x) { return x.id === id; })[0]; return t ? t.estado : null; }, estadoNom: estadoNom,
    _S: S
  };
})();
