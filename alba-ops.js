/* Alba · Café Galletti - módulo de operación: kits, movimientos, conteo, ventas, mesas, conciliación, red, exportación,
   archivo y catálogo. Se monta dentro del enrutador de la app de horarios y usa su mismo almacén (App.db). */
(function () {
  'use strict';
  var A = window.Alba || { es: function () { return true; }, rol: function () { return 'central'; }, tienda: function () { return null; }, nombreOperador: function () { return 'demo'; }, modo: 'demo' };
  function App() { return window.AlbaApp; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var NF = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 });
  function fmt(n) { return n == null || isNaN(n) ? '-' : NF.format(Math.round(n * 100) / 100); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function hhmm() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function toast(m, e) { if (window.AlbaToast) window.AlbaToast(m, e); }
  function icon(n) { return window.AlbaIcon ? window.AlbaIcon(n) : ''; }
  function rerender() { if (window.AlbaRender) window.AlbaRender(); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem('alba_' + k); localStorage.setItem('alba_' + k, v); } catch (e) { return null; } }

  var TIPOS = {
    REC: { n: 'Recepción de planta', d: 'Entra a la tienda', s: 1, lote: true },
    TRS: { n: 'Transferencia a otra tienda', d: 'Sale; la otra tienda confirma', s: -1, destino: true },
    DEV: { n: 'Devolución a planta', d: 'No conforme, vida útil o sobrestock', s: -1, causa: true },
    MER: { n: 'Merma', d: 'Se pierde: vencido, dañado…', s: -1, causa: true },
    CON: { n: 'Consumo interno', d: 'Cortesía, degustación, personal', s: -1, causa: true }
  };
  var DEV_CAUSAS = [['D01', 'No conforme en la recepción'], ['D02', 'Vida útil insuficiente'], ['D03', 'Sobrestock autorizado (congelado, cerrado)'], ['D04', 'Retiro de lote ordenado por la central']];
  var CON_CAUSAS = [['M05', 'Cortesía autorizada'], ['M06', 'Degustación'], ['M07', 'Consumo de personal']];
  var MER_DEF = [['M01', 'Vencimiento'], ['M02', 'Daño en transporte'], ['M03', 'Error de preparación'], ['M04', 'Caída o accidente'], ['M08', 'Devolución de cliente'], ['M09', 'Falla de equipo o cadena de frío'], ['M10', 'No conforme de origen'], ['M11', 'Fin de exhibición']];
  var OPS_COLS = ['mov', 'conteo', 'ventas', 'pax'];

  var O = { sub: { operacion: ls('sub_operacion') || 'registrar', red: 'tablero', catalogo: 'kits' }, fecha: hoy(), tipo: 'REC', lineas: [], canal: 'mesa',
    kits: [], mov: [], conteos: {}, ventas: {}, pax: [], personal: {}, perfiles: {}, cfg: { causas: null, tolerancia: 0, bodegas: {} },
    sus: false, ventasParse: null, uso: null, archMes: '', archDescargado: '' };

  /* ---------- rutas que se suman al menú ---------- */
  var RUTAS = [
    ['operacion', 'Operación', 'box', function () { return !A.es('auditor'); }],
    ['red', 'Red', 'flag', function () { return A.es('central', 'gerencia', 'supervisor', 'oficina', 'licenciatario'); }],
    ['catalogo', 'Catálogo', 'list', function () { return A.es('central', 'gerencia'); }]
  ];
  var ICONOS = {
    box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    out: '<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>'
  };

  /* ---------- datos ---------- */
  function db() { return App() && App().db; }
  function suscribir() {
    if (O.sus || !db()) return; O.sus = true;
    var d = db();
    function col(nombre, fn) { d.collection(nombre).onSnapshot(function (s) { fn(s.docs); rerender(); }, function (e) { console.warn(nombre, e); }); }
    col('kits', function (docs) {
      O.kits = docs.map(function (x) { var k = x.data(); k.id = x.id; return k; });
      if (!docs.length && !O.sembrado && window.ALBA_SEED_KITS && (A.modo === 'demo' || A.es('central'))) {
        O.sembrado = true;
        var p = Promise.resolve(); window.ALBA_SEED_KITS.forEach(function (k) { p = p.then(function () { return d.collection('kits').doc(k.codigo).set(k); }); });
        p.then(function () { toast('Catálogo inicial de kits cargado (GAL-SK-001)'); }, function () {});
      }
    });
    col('mov', function (docs) { O.mov = docs.map(function (x) { var m = x.data(); m.id = x.id; return m; }); });
    col('conteo', function (docs) { O.conteos = {}; docs.forEach(function (x) { O.conteos[x.id] = x.data(); }); });
    col('ventas', function (docs) { O.ventas = {}; docs.forEach(function (x) { O.ventas[x.id] = x.data(); }); });
    col('pax', function (docs) { O.pax = docs.map(function (x) { var p = x.data(); p.id = x.id; return p; }); });
    col('personal', function (docs) { O.personal = {}; docs.forEach(function (x) { O.personal[x.id] = x.data(); }); });
    if (A.es('central', 'gerencia')) col('perfiles', function (docs) { O.perfiles = {}; docs.forEach(function (x) { O.perfiles[x.id] = x.data(); }); });
    d.doc('opcfg/main').onSnapshot(function (s) { var c = s.exists ? s.data() : {}; O.cfg = { causas: c.causas || null, tolerancia: c.tolerancia == null ? 0 : c.tolerancia, bodegas: c.bodegas || {} }; rerender(); }, function () {});
  }
  function guardar(fn, ok) {
    if (!db()) { toast('Sin conexión con la base', true); return Promise.resolve(false); }
    return Promise.resolve().then(fn).then(function () { if (ok) toast(ok); return true; }, function (e) {
      var c = e && e.code;
      toast(c === 'invalid_argument' ? 'Su usuario no tiene permiso para este registro.' : c === 'unavailable' ? 'Sin conexión: no se guardó. Intente de nuevo.' : 'No se pudo guardar (' + ((e && e.message) || c || 'error') + ')', true);
      return false;
    });
  }
  function pinValido(p) { return /^\d{6}$/.test(p) && !/^(\d)\1{5}$/.test(p) && '0123456789012345'.indexOf(p) < 0 && '9876543210987654'.indexOf(p) < 0; }
  function nuevoId(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- tiendas (de la app de horarios) ---------- */
  function tiendas() {
    var S = App() && App().S; if (!S || !S.tiendas) return [];
    return Object.keys(S.tiendas).filter(function (id) { return S.tiendas[id].activa !== false; }).sort(function (a, b) { return String(S.tiendas[a].codigo).localeCompare(String(S.tiendas[b].codigo)); })
      .map(function (id) { return { id: id, codigo: S.tiendas[id].codigo, nombre: S.tiendas[id].nombre }; });
  }
  function tiendaNom(id) { var t = tiendas().filter(function (x) { return x.id === id; })[0]; return t ? t.codigo + ' ' + t.nombre : (id || '-'); }
  function tiendaActual() {
    var fija = A.es('tienda') ? A.tienda() : null;
    if (fija && App()) App().tienda = fija;
    var t = App() && App().tienda; var ts = tiendas();
    if (!ts.some(function (x) { return x.id === t; })) t = ts.length ? ts[0].id : null;
    return t;
  }
  function selTienda(id) {
    if (A.es('tienda')) return '<div class="fld"><span class="f">Tienda</span><b>' + esc(tiendaNom(tiendaActual())) + '</b></div>';
    return '<div class="fld" style="min-width:200px"><label class="f" for="op-tienda">Tienda</label><select class="inp" id="op-tienda" data-op="tienda">' +
      tiendas().map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === id ? ' selected' : '') + '>' + esc(t.codigo + ' ' + t.nombre) + '</option>'; }).join('') + '</select></div>';
  }
  function selFecha() { return '<div class="fld"><label class="f" for="op-fecha">Fecha</label><input class="inp" type="date" id="op-fecha" data-op="fecha" value="' + O.fecha + '"' + (A.es('tienda') ? ' min="' + addDays(hoy(), -2) + '" max="' + hoy() + '"' : '') + '></div>'; }

  /* ---------- catálogo ---------- */
  function kitBy(c) { return O.kits.filter(function (k) { return k.codigo === c; })[0]; }
  function kitNom(c) { var k = kitBy(c); return k ? k.nombre : c; }
  function kitsActivos() { return O.kits.filter(function (k) { return k.activo !== false; }).sort(function (a, b) { return String(a.familia || '').localeCompare(String(b.familia || '')) || String(a.nombre).localeCompare(String(b.nombre)); }); }
  function causasMer() { return O.cfg.causas && O.cfg.causas.length ? O.cfg.causas.map(function (c) { return [c.codigo, c.nombre]; }) : MER_DEF; }
  function causasDe(t) { return t === 'MER' ? causasMer() : t === 'DEV' ? DEV_CAUSAS : CON_CAUSAS; }
  function causaNom(t, c) { var x = causasDe(t).filter(function (y) { return y[0] === c; })[0]; return x ? x[1] : c || ''; }
  function kitOpts(sel) {
    var g = null, h = '';
    kitsActivos().forEach(function (k) {
      if (k.familia !== g) { if (g !== null) h += '</optgroup>'; g = k.familia; h += '<optgroup label="' + esc(String(g || 'Otros').replace(/^\d+\s*/, '')) + '">'; }
      h += '<option value="' + esc(k.codigo) + '"' + (k.codigo === sel ? ' selected' : '') + '>' + esc(k.nombre) + ' · ' + esc(k.unidad || 'u') + '</option>';
    });
    return h + (g !== null ? '</optgroup>' : '');
  }

  /* ---------- efectos y conciliación ---------- */
  function efectos(m, t) {
    var out = [];
    (m.lineas || []).forEach(function (l) {
      var q = +l.cant || 0;
      if (m.tipo === 'TRS') {
        if (m.tienda === t) out.push({ kit: l.kit, q: q, campo: 'trsOut', f: m.fecha });
        if (m.destino === t && m.estado === 'recibida') out.push({ kit: l.kit, q: +(l.recibido != null ? l.recibido : q), campo: 'trsIn', f: m.recibidaFecha || m.fecha });
      } else if (m.tienda === t) out.push({ kit: l.kit, q: q, campo: { REC: 'rec', DEV: 'dev', MER: 'mer', CON: 'con' }[m.tipo], f: m.fecha });
    });
    return out;
  }
  function k2(t, f) { return t + '_' + f; }
  function conciliar(t, f) {
    var ini = O.conteos[k2(t, addDays(f, -1))], fin = O.conteos[k2(t, f)], ven = O.ventas[k2(t, f)], rows = {};
    function R(k) { return rows[k] = rows[k] || { kit: k, ini: ini && ini.lineas ? ini.lineas[k] : undefined, rec: 0, trsIn: 0, trsOut: 0, ven: ven && ven.lineas ? ven.lineas[k] || 0 : 0, mer: 0, dev: 0, con: 0, fin: fin && fin.lineas ? fin.lineas[k] : undefined }; }
    kitsActivos().forEach(function (k) { R(k.codigo); });
    O.mov.forEach(function (m) { efectos(m, t).forEach(function (e) { if (e.f === f) R(e.kit)[e.campo] += e.q; }); });
    var tol = +O.cfg.tolerancia || 0;
    Object.keys(rows).forEach(function (k) {
      var r = rows[k];
      r.teo = r.ini == null ? null : r.ini + r.rec + r.trsIn - r.trsOut - r.ven - r.mer - r.dev - r.con;
      r.dif = r.teo == null || r.fin == null ? null : r.fin - r.teo;
      r.estado = r.dif == null ? 'na' : Math.abs(r.dif) <= tol + 1e-9 ? 'ok' : Math.abs(r.dif) <= Math.max(tol * 3, 1) ? 'warn' : 'bad';
    });
    return { rows: Object.keys(rows).map(function (k) { return rows[k]; }), ini: !!ini, fin: !!fin, ven: !!ven };
  }

  /* ---------- piezas de interfaz ---------- */
  function subtabs(ruta, items) {
    return '<div class="alba-tabs" role="tablist">' + items.filter(function (i) { return !i[2] || i[2](); }).map(function (i) {
      return '<button class="btn sm' + (O.sub[ruta] === i[0] ? ' primary' : '') + '" role="tab" aria-selected="' + (O.sub[ruta] === i[0]) + '" data-op="sub" data-r="' + ruta + '" data-v="' + i[0] + '">' + i[1] + '</button>';
    }).join('') + '</div>';
  }
  function head(t, extra) { return '<div class="page-head"><h1>' + t + '</h1><span class="spacer"></span>' + (extra || '') + '</div>'; }
  function kpis(arr) { return '<div class="kpis">' + arr.map(function (k) { return '<div class="kpi ' + (k[2] || '') + '"><small>' + k[0] + '</small><b class="num">' + k[1] + '</b></div>'; }).join('') + '</div>'; }
  function tabla(cab, filas, nums) {
    nums = nums || [];
    return '<div class="tblwrap"><table class="t"><thead><tr>' + cab.map(function (c, i) { return '<th' + (nums.indexOf(i) >= 0 ? ' class="n"' : '') + '>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.map(function (f) { return '<tr>' + f.map(function (c, i) { return '<td' + (nums.indexOf(i) >= 0 ? ' class="n"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function vacio(t) { return '<p class="muted">' + t + '</p>'; }

  /* ---------- identificación del operador (cuentas de tienda) ---------- */
  function necesitaOperador() { return A.modo === 'red' && A.es('tienda') && !A.operador; }
  function viewOperador() {
    var t = tiendaActual(), lista = Object.keys(O.personal).filter(function (id) { return O.personal[id].tienda === t && O.personal[id].activo !== false; });
    var h = head('¿Quién registra?');
    h += '<section class="card" style="max-width:520px"><p class="muted">Elija su nombre y escriba su PIN de 6 dígitos. Su PIN es su firma electrónica: todo lo que registre en este turno queda a su nombre.</p>';
    if (!lista.length) h += '<div class="alert-box warn" style="margin:10px 0">La central aún no cargó el personal de esta tienda. Puede seguir; los registros quedarán a nombre de la tienda.</div><button class="btn primary" data-op="op-sin">Continuar como ' + esc(tiendaNom(t)) + '</button>';
    else h += '<div class="grid2"><div class="fld"><label class="f" for="op-persona">Persona</label><select class="inp" id="op-persona">' + lista.map(function (id) { return '<option value="' + esc(id) + '">' + esc(O.personal[id].nombre) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fld"><label class="f" for="op-pin">PIN</label><input class="inp" id="op-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div></div><button class="btn primary" style="margin-top:12px" data-op="op-entrar">Empezar turno</button>';
    return h + '</section>';
  }

  /* ---------- OPERACIÓN ---------- */
  function viewOperacion() {
    if (necesitaOperador()) return viewOperador();
    var t = tiendaActual();
    var h = head('Operación de tienda', '<span class="muted small">Registra: <b>' + esc(A.nombreOperador()) + '</b></span>' + (A.modo === 'red' && A.es('tienda') ? ' <button class="btn sm ghost" data-op="op-cambiar">Cambiar persona</button>' : ''));
    var est = window.AlbaSup && t ? AlbaSup.estadoDe(t) : null;
    if (est && est !== 'operando') h += '<div class="alert-box warn" style="margin-bottom:12px">Este local está en estado <b>' + esc(AlbaSup.estadoNom(est)) + '</b>. ' + ({ en_apertura: 'Todavía no registra ventas ni mesas.', suspendido_total: 'Solo admite conteo y devolución a planta.', en_salida: 'Solo admite conteo y devolución a planta.', suspendido_parcial: 'Revise el alcance de la suspensión con la central.' }[est] || '') + '</div>';
    h += '<section class="card" style="margin-bottom:14px"><div class="toolbar">' + selTienda(t) + selFecha() + '</div>' +
      subtabs('operacion', [['registrar', 'Registrar'], ['conteo', 'Conteo'], ['mesas', 'Mesas'], ['ventas', 'Ventas'], ['conciliacion', 'Conciliación']]) + '</section>';
    if (!t) return h + '<div class="card empty">' + vacio('Primero cree las tiendas en Configurar.') + '</div>';
    if (!O.kits.length && O.sub.operacion !== 'mesas') h += '<div class="alert-box warn" style="margin-bottom:14px">El catálogo de kits está vacío. La central lo carga en Catálogo.</div>';
    var s = O.sub.operacion;
    if (s === 'conteo') return h + viewConteo(t);
    if (s === 'mesas') return h + viewMesas(t);
    if (s === 'ventas') return h + viewVentas(t);
    if (s === 'conciliacion') return h + viewConc(t);
    return h + viewRegistrar(t);
  }
  function nuevaLinea() { return { kit: (kitsActivos()[0] || {}).codigo || '', cant: '', causa: (causasDe(O.tipo)[0] || [])[0] || '', lote: '', vence: '' }; }
  function viewRegistrar(t) {
    var T = TIPOS[O.tipo];
    var h = '<section class="card" style="margin-bottom:14px"><div class="alba-tipos">' + Object.keys(TIPOS).map(function (k) {
      return '<button class="alba-tipo' + (k === O.tipo ? ' on' : '') + '" aria-pressed="' + (k === O.tipo) + '" data-op="tipo" data-v="' + k + '"><b>' + TIPOS[k].n + '</b><span>' + TIPOS[k].d + '</span></button>';
    }).join('') + '</div>';
    if (O.kits.length) {
      if (!O.lineas.length) O.lineas.push(nuevaLinea());
      h += '<div class="toolbar" style="margin:14px 0 8px">';
      if (T.destino) h += '<div class="fld" style="min-width:200px"><label class="f" for="m-dest">Tienda de destino</label><select class="inp" id="m-dest">' + tiendas().filter(function (x) { return x.id !== t; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.codigo + ' ' + x.nombre) + '</option>'; }).join('') + '</select></div>';
      if (O.tipo === 'REC') h += '<div class="fld"><label class="f" for="m-guia">N.° de guía o despacho</label><input class="inp" id="m-guia" type="text"></div>';
      h += '<div class="fld" style="flex:1;min-width:200px"><label class="f" for="m-nota">Nota (opcional)</label><input class="inp" id="m-nota" type="text"></div></div>';
      var cab = ['Kit', 'Cantidad'].concat(T.causa ? ['Causa'] : []).concat(T.lote ? ['Lote', 'Vence'] : []).concat(['']);
      var filas = O.lineas.map(function (l, i) {
        var f = ['<select class="inp" data-op="ln" data-i="' + i + '" data-f="kit" aria-label="Kit">' + kitOpts(l.kit) + '</select>',
          '<input class="inp alba-num" type="number" min="0" step="any" inputmode="decimal" data-op="ln" data-i="' + i + '" data-f="cant" value="' + esc(l.cant) + '" aria-label="Cantidad">'];
        if (T.causa) f.push('<select class="inp" data-op="ln" data-i="' + i + '" data-f="causa" aria-label="Causa">' + causasDe(O.tipo).map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === l.causa ? ' selected' : '') + '>' + esc(c[0] + ' ' + c[1]) + '</option>'; }).join('') + '</select>');
        if (T.lote) { f.push('<input class="inp" data-op="ln" data-i="' + i + '" data-f="lote" value="' + esc(l.lote) + '" aria-label="Lote">'); f.push('<input class="inp" type="date" data-op="ln" data-i="' + i + '" data-f="vence" value="' + esc(l.vence) + '" aria-label="Vence">'); }
        f.push('<button class="btn sm ghost" data-op="ln-del" data-i="' + i + '" aria-label="Quitar línea">×</button>');
        return f;
      });
      h += tabla(cab, filas, [1]);
      h += '<div class="row" style="justify-content:flex-start;gap:10px;margin-top:12px"><button class="btn sm" data-op="ln-add">+ Otra línea</button><button class="btn primary" data-op="mov-save">Guardar ' + T.n.toLowerCase() + '</button></div>';
    }
    h += '</section>';
    var pend = O.mov.filter(function (m) { return m.tipo === 'TRS' && m.destino === t && m.estado !== 'recibida'; });
    h += '<section class="card" style="margin-bottom:14px"><h2>Transferencias por recibir</h2>' + (pend.length ? pend.map(function (m) {
      return '<div class="alert-box info" style="margin-top:8px"><b>De ' + esc(tiendaNom(m.tienda)) + '</b> · ' + esc(m.fecha) + ' ' + esc(m.hora) + ' · ' + m.lineas.map(function (l) { return esc(kitNom(l.kit)) + ': ' + fmt(l.cant); }).join(' · ') +
        ' <button class="btn sm primary" data-op="trs-rec" data-id="' + esc(m.id) + '">Recibir</button></div>';
    }).join('') : vacio('Nada pendiente.')) + '</section>';
    var dia = O.mov.filter(function (m) { return m.fecha === O.fecha && (m.tienda === t || m.destino === t); }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    h += '<section class="card"><h2>Movimientos del día</h2>' + (dia.length ? tabla(['Hora', 'Tipo', 'Detalle', 'Registró', 'Estado', ''], dia.map(function (m) {
      var tipo = (TIPOS[m.tipo] || {}).n || m.tipo; if (m.tipo === 'TRS') tipo += m.tienda === t ? ' → ' + tiendaNom(m.destino) : ' ← ' + tiendaNom(m.tienda);
      return [esc(m.hora), esc(tipo), m.lineas.map(function (l) { return esc(kitNom(l.kit)) + ': ' + fmt(l.cant) + (l.causa ? ' <span class="muted">(' + esc(causaNom(m.tipo, l.causa)) + ')</span>' : ''); }).join('<br>') + (m.nota ? '<div class="small muted">' + esc(m.nota) + '</div>' : ''),
        esc(m.por || ''), m.tipo === 'TRS' ? (m.estado === 'recibida' ? '<span class="pill ok">Recibida</span>' : '<span class="pill warn">Pendiente</span>') : '',
        m.tienda === t && m.estado !== 'recibida' && m.fecha === hoy() ? '<button class="btn sm ghost danger" data-op="mov-del" data-id="' + esc(m.id) + '">Anular</button>' : ''];
    })) : vacio('Sin movimientos registrados.')) + '</section>';
    return h;
  }
  function viewConteo(t) {
    var c = O.conteos[k2(t, O.fecha)], vals = (c && c.lineas) || {}, g = null;
    var h = '<section class="card"><h2>Conteo de cierre</h2><p class="muted small">Se cuenta a ciegas: vitrina, refrigeración, congelación y bodega, sin mirar el teórico. Tortas y cheesecakes en porciones. Deje en blanco lo que no contó; escriba 0 si no hay.</p>';
    var filas = [];
    kitsActivos().forEach(function (k) {
      if (k.familia !== g) { g = k.familia; filas.push(['<b class="alba-fam">' + esc(String(g || '').replace(/^\d+\s*/, '')) + '</b>', '', '']); }
      filas.push([esc(k.nombre), '<span class="muted small">' + esc(k.unidad) + '</span>', '<input class="inp alba-num" type="number" min="0" step="any" inputmode="decimal" data-cont="' + esc(k.codigo) + '" value="' + (vals[k.codigo] != null ? vals[k.codigo] : '') + '" aria-label="' + esc(k.nombre) + '">']);
    });
    h += tabla(['Kit', 'Unidad', 'Contado'], filas, [2]);
    h += '<div class="row" style="justify-content:flex-start;gap:12px;margin-top:12px"><button class="btn primary" data-op="cont-save">Guardar conteo</button><span class="muted small">' + (c ? 'Guardado a las ' + esc(c.hora) + ' por ' + esc(c.por || '-') + '.' : '') + '</span></div></section>';
    return h;
  }
  function paxDia(t, f) { var r = []; O.pax.forEach(function (d) { if (d.tienda === t && d.fecha === f) (d.reg || []).forEach(function (x) { r.push(x); }); }); return r.sort(function (a, b) { return a.h < b.h ? -1 : 1; }); }
  function viewMesas(t) {
    var r = paxDia(t, O.fecha), mesa = r.filter(function (x) { return x.c === 'mesa'; }), llevar = r.filter(function (x) { return x.c !== 'mesa'; }), pers = mesa.reduce(function (s, x) { return s + x.p; }, 0);
    var h = '<section class="card" style="margin-bottom:14px"><h2>Mesas y personas</h2><p class="muted small">Un toque por cada mesa que se sienta: cuántas personas son. Para llevar también se marca.</p>' +
      '<div class="toolbar" style="margin-bottom:12px"><div class="alba-tabs"><button class="btn sm' + (O.canal === 'mesa' ? ' primary' : '') + '" data-op="canal" data-v="mesa">En mesa</button><button class="btn sm' + (O.canal !== 'mesa' ? ' primary' : '') + '" data-op="canal" data-v="llevar">Para llevar</button></div>' +
      '<div class="fld"><label class="f" for="pax-mesa">Mesa (opcional)</label><input class="inp" id="pax-mesa" maxlength="4" autocomplete="off" style="width:90px" title="Solo el código de la mesa (hasta 4 caracteres). No anote nombres de clientes."></div></div>' +
      '<div class="alba-pax">' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<button class="btn" data-op="pax" data-n="' + n + '" aria-label="' + n + ' personas">' + n + (n === 8 ? '+' : '') + '</button>'; }).join('') + '</div></section>';
    h += kpis([['Mesas atendidas', mesa.length], ['Personas en mesa', pers], ['Personas por mesa', mesa.length ? fmt(pers / mesa.length) : '-'], ['Para llevar', llevar.length]]);
    var fr = {}; r.forEach(function (x) { var k = x.h.slice(0, 2) + ':00'; fr[k] = fr[k] || { m: 0, p: 0, l: 0 }; if (x.c === 'mesa') { fr[k].m++; fr[k].p += x.p; } else fr[k].l++; });
    var max = Math.max.apply(null, [1].concat(Object.keys(fr).map(function (k) { return fr[k].p; })));
    h += '<section class="card" style="margin-top:14px"><h2>Personas por franja</h2>' + (Object.keys(fr).length ? tabla(['Hora', 'Mesas', 'Personas', 'Para llevar', ''], Object.keys(fr).sort().map(function (k) {
      return [k, fr[k].m, fr[k].p, fr[k].l, '<div class="alba-bar"><i style="width:' + (fr[k].p / max * 100) + '%"></i></div>'];
    }), [1, 2, 3]) : vacio('Sin registros en esta fecha.')) + '</section>';
    return h;
  }
  function mapaContifico() { var m = {}; kitsActivos().forEach(function (k) { (k.contifico || []).forEach(function (c) { var u = String(c.codigo).toUpperCase(); (m[u] = m[u] || []).push({ kit: k.codigo, f: +c.factor || 1 }); }); }); return m; }
  function parseVentas(txt) {
    var mapa = mapaContifico(), kits = {}, sin = [];
    txt.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(); if (!line) return;
      var cols = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(function (s) { return s.replace(/^"|"$/g, '').trim(); });
      var cod = null, cant = null;
      cols.forEach(function (c) { if (!cod && mapa[c.toUpperCase()]) cod = c.toUpperCase(); });
      if (!cod) { var cand = cols.filter(function (c) { return /^[A-Z0-9]{3,}$/i.test(c) && /[A-Z]/i.test(c) && !/^codigo$/i.test(c); })[0]; if (cand) cod = cand.toUpperCase(); }
      var nums = cols.map(function (c) { return c.replace(/\s/g, ''); }).filter(function (c) { return /^-?\d+([.,]\d+)?$/.test(c); }).map(function (c) { return +c.replace(',', '.'); });
      if (nums.length) cant = nums[nums.length - 1];
      if (!cod || cant == null) return;
      if (mapa[cod]) mapa[cod].forEach(function (x) { kits[x.kit] = (kits[x.kit] || 0) + cant * x.f; }); else sin.push(cod);
    });
    return { kits: kits, sin: sin };
  }
  function viewVentas(t) {
    var v = O.ventas[k2(t, O.fecha)], p = O.ventasParse;
    var h = '<section class="card" style="margin-bottom:14px"><h2>Ventas del día desde Contífico</h2><p class="muted small">Pegue el reporte "Ventas por productos/servicios" filtrado por tienda y fecha (código y cantidad; CSV, punto y coma o tabulado). Cada código se convierte en kits con la equivalencia del catálogo.</p>' +
      '<textarea class="inp alba-txt" id="vt-txt" placeholder="codigo;cantidad&#10;DSFCU02;7&#10;DDPMP01;12"></textarea>' +
      '<div class="row" style="justify-content:flex-start;gap:10px;margin-top:10px"><button class="btn sm" data-op="vt-rev">Revisar</button><button class="btn primary" data-op="vt-save"' + (p && Object.keys(p.kits).length ? '' : ' disabled') + '>Guardar ventas del día</button></div>';
    if (p) {
      h += '<h3 style="margin-top:14px">Equivale a</h3>' + tabla(['Kit', 'Vendido'], Object.keys(p.kits).map(function (k) { return [esc(kitNom(k)), fmt(p.kits[k])]; }), [1]);
      if (p.sin.length) h += '<div class="alert-box info" style="margin-top:10px">' + p.sin.length + ' códigos sin equivalencia (bebidas, adicionales u otros): ' + esc(p.sin.slice(0, 25).join(', ')) + (p.sin.length > 25 ? '…' : '') + '. No afectan la conciliación.</div>';
    }
    h += '</section><section class="card"><h2>Ventas guardadas</h2>' + (v ? '<p class="muted small">Cargadas a las ' + esc(v.hora) + ' por ' + esc(v.por || '-') + '.</p>' + tabla(['Kit', 'Vendido'], Object.keys(v.lineas || {}).map(function (k) { return [esc(kitNom(k)), fmt(v.lineas[k])]; }), [1]) : vacio('Aún no se cargan las ventas de este día.')) + '</section>';
    return h;
  }
  function viewConc(t) {
    var c = conciliar(t, O.fecha), act = c.rows.filter(function (r) { return r.ini || r.rec || r.trsIn || r.trsOut || r.ven || r.mer || r.dev || r.con || r.fin; });
    function sum(f) { return act.reduce(function (s, r) { return s + (+r[f] || 0); }, 0); }
    var disp = act.reduce(function (s, r) { return s + (r.ini || 0) + r.rec + r.trsIn; }, 0), ok = act.filter(function (r) { return r.estado === 'ok'; }).length, mal = act.filter(function (r) { return r.estado === 'warn' || r.estado === 'bad'; }).length;
    var h = kpis([['Kits vendidos', fmt(sum('ven'))], ['Kits de merma', fmt(sum('mer')), sum('mer') ? 'warn' : 'ok'], ['Merma sobre disponible', disp ? fmt(sum('mer') / disp * 100) + ' %' : '-'], ['Kits que cuadran', ok + ' / ' + (ok + mal), mal ? 'bad' : 'ok']]);
    var pill = function (s) { return s === 'ok' ? '<span class="pill ok">Cuadra</span>' : s === 'warn' ? '<span class="pill warn">Revisar</span>' : s === 'bad' ? '<span class="pill bad">Diferencia</span>' : '<span class="muted small">Falta dato</span>'; };
    h += '<section class="card" style="margin-top:14px"><h2>Conciliación por kit</h2><p class="muted small">Ayer + recibido + transferencias que entran - transferencias que salen - vendido - merma - devuelto - consumo = lo que debería haber. Se compara con el conteo de hoy.</p>' +
      (act.length ? tabla(['Kit', 'Ayer', '+ Recibido', '+ Trf. entra', '- Trf. sale', '- Vendido', '- Merma', '- Devuelto', '- Consumo', '= Debería', 'Contado', 'Diferencia', 'Estado'], act.map(function (r) {
        return [esc(kitNom(r.kit)), fmt(r.ini), fmt(r.rec), fmt(r.trsIn), fmt(r.trsOut), fmt(r.ven), fmt(r.mer), fmt(r.dev), fmt(r.con), '<b>' + fmt(r.teo) + '</b>', fmt(r.fin), r.dif == null ? '-' : (r.dif > 0 ? '+' : '') + fmt(r.dif), pill(r.estado)];
      }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) : vacio('Sin datos para esta tienda y fecha.'));
    var falt = []; if (!c.ini) falt.push('el conteo de ayer'); if (!c.fin) falt.push('el conteo de hoy'); if (!c.ven) falt.push('las ventas de hoy');
    h += '<p class="small muted" style="margin-top:10px">' + (falt.length ? '<b>Falta ' + falt.join(', ') + '.</b> ' : '') + 'Diferencia negativa: falta producto (venta sin registrar, merma sin anotar, recepción mal contada o transferencia sin registro). Positiva: sobra producto. Tolerancia: ' + fmt(O.cfg.tolerancia) + ' por kit.</p></section>';
    return h;
  }

  /* ---------- RED ---------- */
  function viewRed() {
    var h = head('Red de tiendas') + '<section class="card" style="margin-bottom:14px">' + subtabs('red', [['tablero', 'Tablero'], ['exportar', 'Exportar a Contífico'], ['archivo', 'Archivo', function () { return A.es('central', 'gerencia'); }]]) + '</section>';
    if (O.sub.red === 'exportar') return h + viewExportar();
    if (O.sub.red === 'archivo' && A.es('central', 'gerencia')) return h + viewArchivo();
    return h + viewTablero();
  }
  function rango(idD, idH) { var d = ($(idD) || {}).value || O[idD] || addDays(hoy(), -6), hh = ($(idH) || {}).value || O[idH] || hoy(); O[idD] = d; O[idH] = hh; return [d, hh]; }
  function viewTablero() {
    var r = rango('red-d', 'red-h'), d = r[0], hh = r[1], fechas = [];
    for (var f = d; f <= hh && fechas.length < 62; f = addDays(f, 1)) fechas.push(f);
    var h = '<section class="card" style="margin-bottom:14px"><div class="toolbar"><div class="fld"><label class="f" for="red-d">Desde</label><input class="inp" type="date" id="red-d" data-op="rango" value="' + d + '"></div><div class="fld"><label class="f" for="red-h">Hasta</label><input class="inp" type="date" id="red-h" data-op="rango" value="' + hh + '"></div></div></section>';
    var filas = tiendas().map(function (t) {
      var a = { ven: 0, mer: 0, dev: 0, con: 0, rec: 0, disp: 0, difs: 0, conteos: 0, mesas: 0, pers: 0 };
      fechas.forEach(function (f) {
        var c = conciliar(t.id, f);
        c.rows.forEach(function (x) { a.disp += (x.ini || 0) + x.rec + x.trsIn; a.ven += x.ven; a.mer += x.mer; a.dev += x.dev; a.con += x.con; a.rec += x.rec; if (x.estado === 'warn' || x.estado === 'bad') a.difs++; });
        if (c.fin) a.conteos++;
        paxDia(t.id, f).forEach(function (x) { if (x.c === 'mesa') { a.mesas++; a.pers += x.p; } });
      });
      var pend = O.mov.filter(function (m) { return m.tipo === 'TRS' && m.destino === t.id && m.estado !== 'recibida'; }).length;
      return [esc(t.codigo + ' ' + t.nombre), a.conteos + ' / ' + fechas.length, fmt(a.rec), fmt(a.ven), fmt(a.mer), a.disp ? fmt(a.mer / a.disp * 100) + ' %' : '-', fmt(a.dev), fmt(a.con),
        a.difs ? '<span class="pill ' + (a.difs > 3 ? 'bad' : 'warn') + '">' + a.difs + '</span>' : '<span class="pill ok">0</span>', pend ? '<span class="pill warn">' + pend + '</span>' : '0', a.mesas, a.pers, a.mesas ? fmt(a.pers / a.mesas) : '-'];
    });
    h += '<section class="card" style="margin-bottom:14px"><h2>Tiendas</h2>' + tabla(['Tienda', 'Días con conteo', 'Recibido', 'Vendido', 'Merma', 'Merma %', 'Devuelto', 'Consumo', 'Kits con diferencia', 'Trf. sin recibir', 'Mesas', 'Personas', 'Pers./mesa'], filas, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) + '</section>';
    var causas = {}, kits = {}, ts = tiendas();
    O.mov.forEach(function (m) { if (m.tipo !== 'MER' || m.fecha < d || m.fecha > hh) return; m.lineas.forEach(function (l) { var k = l.causa || '?'; causas[k] = causas[k] || {}; causas[k][m.tienda] = (causas[k][m.tienda] || 0) + (+l.cant || 0); kits[l.kit] = kits[l.kit] || {}; kits[l.kit][m.tienda] = (kits[l.kit][m.tienda] || 0) + (+l.cant || 0); }); });
    function tab(obj, nom) {
      var keys = Object.keys(obj); if (!keys.length) return vacio('Sin merma registrada en el período.');
      function tot(k) { return Object.keys(obj[k]).reduce(function (s, x) { return s + obj[k][x]; }, 0); }
      keys.sort(function (a, b) { return tot(b) - tot(a); });
      return tabla([''].concat(ts.map(function (t) { return esc(t.codigo); })).concat(['Total']), keys.map(function (k) { return [esc(nom(k))].concat(ts.map(function (t) { return fmt(obj[k][t.id] || 0); })).concat(['<b>' + fmt(tot(k)) + '</b>']); }), ts.map(function (x, i) { return i + 1; }).concat([ts.length + 1]));
    }
    h += '<section class="card" style="margin-bottom:14px"><h2>Merma por causa</h2>' + tab(causas, function (k) { return k + ' ' + causaNom('MER', k); }) + '</section>';
    h += '<section class="card"><h2>Merma por kit</h2>' + tab(kits, kitNom) + '</section>';
    return h;
  }
  function filasExport(d, hh) {
    var bod = function (t) { return O.cfg.bodegas[t] || tiendaNom(t); };
    var codC = function (k) { var kit = kitBy(k) || {}; var c = (kit.contifico || []).filter(function (x) { return +x.factor === 1; })[0] || (kit.contifico || [])[0]; return kit.codigo_contifico || (c && c.codigo) || k; };
    var out = [['fecha', 'tipo_contifico', 'bodega_origen', 'bodega_destino', 'codigo_producto', 'kit', 'cantidad', 'descripcion', 'registro']];
    O.mov.filter(function (m) { return m.fecha >= d && m.fecha <= hh; }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.ts || 0) - (b.ts || 0); }).forEach(function (m) {
      m.lineas.forEach(function (l) {
        if (m.tipo === 'TRS' && m.estado !== 'recibida') return;
        var tipo = m.tipo === 'REC' ? 'ING' : m.tipo === 'TRS' ? 'TRA' : 'EGR', q = m.tipo === 'TRS' ? (l.recibido != null ? l.recibido : l.cant) : l.cant;
        var desc = (TIPOS[m.tipo].n + (l.causa ? ' - ' + l.causa + ' ' + causaNom(m.tipo, l.causa) : '') + (m.guia ? ' - guía ' + m.guia : '') + (m.nota ? ' - ' + m.nota : '')).replace(/[;\n]/g, ' ');
        out.push([m.fecha, tipo, bod(m.tienda), m.tipo === 'TRS' ? bod(m.destino) : '', codC(l.kit), kitNom(l.kit), q, desc, m.por || '']);
        if (m.tipo === 'TRS' && l.recibido != null && +l.recibido !== +l.cant) out.push([m.recibidaFecha || m.fecha, 'EGR', bod(m.tienda), '', codC(l.kit), kitNom(l.kit), +l.cant - +l.recibido, 'Diferencia en transferencia a ' + tiendaNom(m.destino), m.recibidaPor || '']);
      });
    });
    return out.map(function (r) { return r.join(';'); }).join('\n');
  }
  function viewExportar() {
    var r = rango('ex-d', 'ex-h');
    return '<section class="card"><h2>Movimientos para Contífico</h2><p class="muted small">Egresos (merma, devolución, consumo), traslados entre bodegas e ingresos de planta del período, con la bodega y el código Contífico de cada kit.</p>' +
      '<div class="toolbar" style="margin-bottom:12px"><div class="fld"><label class="f" for="ex-d">Desde</label><input class="inp" type="date" id="ex-d" data-op="rango" value="' + r[0] + '"></div><div class="fld"><label class="f" for="ex-h">Hasta</label><input class="inp" type="date" id="ex-h" data-op="rango" value="' + r[1] + '"></div>' +
      '<button class="btn primary" data-op="ex-dl">' + icon('download') + 'Descargar CSV</button><button class="btn sm" data-op="ex-copy">Copiar</button></div>' +
      '<textarea class="inp alba-txt" id="ex-txt" readonly style="min-height:240px">' + esc(filasExport(r[0], r[1])) + '</textarea></section>';
  }

  /* ---------- ARCHIVO: descarga a la PC y depuración en línea ---------- */
  function mesesConDatos() {
    var m = {}; OPS_COLS.forEach(function (c) { var arr = c === 'mov' || c === 'pax' ? O[c] : Object.keys(O[c === 'conteo' ? 'conteos' : 'ventas']).map(function (k) { return O[c === 'conteo' ? 'conteos' : 'ventas'][k]; }); arr.forEach(function (x) { if (x && x.fecha) m[x.fecha.slice(0, 7)] = (m[x.fecha.slice(0, 7)] || 0) + 1; }); });
    return m;
  }
  function datosMes(mes) {
    function f(arr) { return arr.filter(function (x) { return x && x.fecha && x.fecha.slice(0, 7) === mes; }); }
    function obj(o) { return Object.keys(o).filter(function (k) { return o[k].fecha && o[k].fecha.slice(0, 7) === mes; }).map(function (k) { var x = JSON.parse(JSON.stringify(o[k])); x.id = k; return x; }); }
    return { mov: f(O.mov), conteo: obj(O.conteos), ventas: obj(O.ventas), pax: f(O.pax) };
  }
  function viewArchivo() {
    var meses = mesesConDatos(), lim = hoy().slice(0, 7), lista = Object.keys(meses).sort();
    var h = '<section class="card" style="margin-bottom:14px"><h2>Archivo mensual</h2><p class="muted small">Para que la base en línea no crezca sin límite, cada mes cerrado se descarga a la computadora de la central (JSON completo y CSV de movimientos) y después se borra en línea. Se conservan en línea el mes actual y el anterior, que la conciliación necesita. Guarde los archivos en la carpeta del proyecto en Google Drive.</p>';
    h += lista.length ? tabla(['Mes', 'Registros en línea', 'Estado', ''], lista.map(function (m) {
      var prev = addDays(lim + '-01', -1).slice(0, 7), bloqueado = m >= prev;
      return [m, meses[m], bloqueado ? '<span class="pill navy">En uso</span>' : O.archDescargado === m ? '<span class="pill ok">Descargado</span>' : '<span class="pill warn">Por archivar</span>',
        bloqueado ? '' : '<button class="btn sm" data-op="arch-dl" data-m="' + m + '">' + icon('download') + 'Descargar</button> <button class="btn sm danger" data-op="arch-del" data-m="' + m + '"' + (O.archDescargado === m ? '' : ' disabled title="Primero descargue el mes"') + '>Borrar en línea</button>'];
    }), [1]) : vacio('No hay registros operativos todavía.');
    h += '</section><section class="card"><h2>Respaldo completo</h2><p class="muted small">Descarga todo lo que hay en línea (horarios, catálogo, operación), sin borrar nada.</p><button class="btn" data-op="arch-todo">' + icon('download') + 'Descargar respaldo completo</button>' +
      (O.uso ? '<h3 style="margin-top:14px">Uso de la base</h3>' + tabla(['Colección', 'Documentos', 'KB'], O.uso.map(function (u) { return [esc(u.col), u.documentos, fmt(u.bytes / 1024)]; }), [1, 2]) : (A.sb ? '<p style="margin-top:10px"><button class="btn sm ghost" data-op="arch-uso">Ver uso de la base</button></p>' : '')) + '</section>';
    return h;
  }
  function csvMes(dm) {
    var r = [['fecha', 'hora', 'tienda', 'tipo', 'kit', 'cantidad', 'causa', 'destino', 'estado', 'recibido', 'registro']];
    dm.mov.forEach(function (m) { m.lineas.forEach(function (l) { r.push([m.fecha, m.hora, tiendaNom(m.tienda), (TIPOS[m.tipo] || {}).n || m.tipo, kitNom(l.kit), l.cant, l.causa || '', m.destino ? tiendaNom(m.destino) : '', m.estado || '', l.recibido != null ? l.recibido : '', m.por || '']); }); });
    return r.map(function (x) { return x.map(function (c) { return String(c).replace(/;/g, ','); }).join(';'); }).join('\n');
  }

  /* ---------- CATÁLOGO ---------- */
  function viewCatalogo() {
    var h = head('Catálogo y accesos') + '<section class="card" style="margin-bottom:14px">' + subtabs('catalogo', [['kits', 'Kits'], ['reglas', 'Causas y bodegas'], ['personal', 'Personal y PIN'], ['plantillas', 'Plantillas, ciclo y textos'], ['cuentas', 'Cuentas', function () { return A.modo === 'red'; }]]) + '</section>';
    var s = O.sub.catalogo;
    if (s === 'plantillas') return h + (window.AlbaSup ? AlbaSup.vistaCatalogo() : '');
    if (s === 'reglas') {
      var bod = tiendas().map(function (t) { return t.id + ' | ' + (O.cfg.bodegas[t.id] || ''); }).join('\n');
      return h + '<section class="card"><h2>Causas de merma</h2><p class="muted small">Una por línea: código | nombre. Las causas de devolución (D01-D04) y de consumo interno (M05-M07) son fijas.</p><textarea class="inp alba-txt" id="cf-causas">' + esc(causasMer().map(function (c) { return c[0] + ' | ' + c[1]; }).join('\n')) + '</textarea>' +
        '<h2 style="margin-top:16px">Bodegas Contífico por tienda</h2><p class="muted small">Una por línea: id de tienda | código de bodega en Contífico.</p><textarea class="inp alba-txt" id="cf-bod" style="min-height:100px">' + esc(bod) + '</textarea>' +
        '<div class="toolbar" style="margin-top:12px"><div class="fld"><label class="f" for="cf-tol">Tolerancia de diferencia (unidades por kit)</label><input class="inp alba-num" type="number" min="0" step="0.5" id="cf-tol" value="' + (O.cfg.tolerancia || 0) + '"></div><button class="btn primary" data-op="cf-save">Guardar</button></div></section>';
    }
    if (s === 'personal') {
      var ids = Object.keys(O.personal).sort(function (a, b) { return String(O.personal[a].tienda + O.personal[a].nombre).localeCompare(String(O.personal[b].tienda + O.personal[b].nombre)); });
      return h + '<section class="card" style="margin-bottom:14px"><h2>Agregar persona</h2><p class="muted small">El PIN de 6 dígitos identifica a quien registra dentro de la cuenta de la tienda y funciona como su firma electrónica. Se guarda cifrado en el servidor y nadie puede leerlo; si alguien lo olvida, se le asigna uno nuevo. No use repeticiones (111111) ni secuencias (123456).</p><div class="grid2">' +
        '<div class="fld"><label class="f" for="pe-nom">Nombre</label><input class="inp" id="pe-nom"></div><div class="fld"><label class="f" for="pe-tienda">Tienda</label><select class="inp" id="pe-tienda">' + tiendas().map(function (t) { return '<option value="' + t.id + '">' + esc(t.codigo + ' ' + t.nombre) + '</option>'; }).join('') + '</select></div>' +
        '<div class="fld"><label class="f" for="pe-pin">PIN (6 dígitos)</label><input class="inp" id="pe-pin" inputmode="numeric" maxlength="6" autocomplete="off"></div></div><button class="btn primary" style="margin-top:12px" data-op="pe-add">Agregar</button></section>' +
        '<section class="card"><h2>Personal registrado</h2>' + (ids.length ? tabla(['Nombre', 'Tienda', 'Estado', ''], ids.map(function (id) { var p = O.personal[id]; return [esc(p.nombre), esc(tiendaNom(p.tienda)), p.activo === false ? '<span class="pill">Inactivo</span>' : '<span class="pill ok">Activo</span>', '<button class="btn sm" data-op="pe-pin" data-id="' + id + '">Nuevo PIN</button> <button class="btn sm ghost" data-op="pe-act" data-id="' + id + '">' + (p.activo === false ? 'Activar' : 'Desactivar') + '</button>']; })) : vacio('Sin personal registrado.')) + '</section>';
    }
    if (s === 'cuentas') {
      var em = Object.keys(O.perfiles).sort();
      return h + '<section class="card" style="margin-bottom:14px"><h2>Habilitar una cuenta</h2><p class="muted small">Primero cree el usuario (correo y contraseña) en Supabase: Authentication, Add user, con "Auto confirm". Luego habilítelo aquí con su rol. Tienda: registra solo en su local y ve su horario en lectura. Licenciatario: administra sus locales (personal, horarios, operación) y ve sus auditorías y no conformidades. Supervisor: toda la red menos catálogo y cuentas. Auditor interno: supervisión, auditorías y no conformidades. Oficina: lectura y exportación. Gerencia y central: todo.</p><div class="grid2">' +
        '<div class="fld"><label class="f" for="cu-email">Correo</label><input class="inp" id="cu-email" type="email"></div><div class="fld"><label class="f" for="cu-rol">Rol</label><select class="inp" id="cu-rol"><option value="tienda">Tienda</option><option value="supervisor">Supervisor</option><option value="auditor">Auditor interno</option><option value="licenciatario">Licenciatario (administrador)</option><option value="oficina">Oficina</option><option value="gerencia">Gerencia</option><option value="central">Central</option></select></div>' +
        '<div class="fld"><label class="f" for="cu-titular">Id del licenciatario (solo rol licenciatario)</label><input class="inp" id="cu-titular" placeholder="lic-nombre"></div>' +
        '<div class="fld"><label class="f" for="cu-tienda">Tienda (solo rol tienda)</label><select class="inp" id="cu-tienda"><option value="">-</option>' + tiendas().map(function (t) { return '<option value="' + t.id + '">' + esc(t.codigo + ' ' + t.nombre) + '</option>'; }).join('') + '</select></div>' +
        '<div class="fld"><label class="f" for="cu-nom">Nombre visible</label><input class="inp" id="cu-nom"></div></div><button class="btn primary" style="margin-top:12px" data-op="cu-add">Habilitar</button></section>' +
        '<section class="card"><h2>Cuentas habilitadas</h2>' + tabla(['Correo', 'Rol', 'Tienda', 'Nombre', 'Estado', ''], em.map(function (e) { var p = O.perfiles[e]; return [esc(e), esc(p.rol), esc(p.tienda ? tiendaNom(p.tienda) : '-'), esc(p.nombre || ''), p.activo === false ? '<span class="pill">Inactiva</span>' : '<span class="pill ok">Activa</span>', e === (A.perfil && A.perfil.email) ? '' : '<button class="btn sm ghost" data-op="cu-act" data-id="' + esc(e) + '">' + (p.activo === false ? 'Activar' : 'Desactivar') + '</button>']; })) + '</section>';
    }
    var txt = O.kits.slice().sort(function (a, b) { return a.codigo < b.codigo ? -1 : 1; }).map(function (k) { return [k.codigo, k.nombre, k.familia || '', k.unidad || '', k.frio || '', k.vida || '', (k.contifico || []).map(function (c) { return c.codigo + '*' + c.factor; }).join(', '), k.activo === false ? 'no' : 'si'].join(' | '); }).join('\n');
    return h + '<section class="card"><h2>Kits de servicio (GAL-SK-001)</h2><p class="muted small">Una línea por kit: código | nombre | familia | unidad | frío | vida útil | códigos Contífico con factor (CÓDIGO*factor, separados por coma) | activo (si/no). El factor convierte una venta en kits: una porción es 1 y una torta entera de 8 es 8 si el kit se cuenta en porciones.</p>' +
      '<textarea class="inp alba-txt" id="kits-txt" style="min-height:320px">' + esc(txt) + '</textarea><div class="row" style="justify-content:flex-start;margin-top:12px"><button class="btn primary" data-op="kits-save">Guardar catálogo</button><span class="muted small" style="margin-left:12px">' + O.kits.length + ' kits, ' + kitsActivos().length + ' activos</span></div></section>';
  }

  /* ---------- acciones ---------- */
  function guardarMov() {
    var t = tiendaActual(), T = TIPOS[O.tipo];
    var lineas = O.lineas.filter(function (l) { return l.kit && +l.cant > 0; }).map(function (l) { var o = { kit: l.kit, cant: +l.cant }; if (T.causa) o.causa = l.causa; if (T.lote) { if (l.lote) o.lote = l.lote; if (l.vence) o.vence = l.vence; } return o; });
    if (!lineas.length) return toast('Ingrese al menos una cantidad mayor que cero', true);
    var d = { tipo: O.tipo, tienda: t, fecha: O.fecha, hora: hhmm(), ts: Date.now(), lineas: lineas, nota: ($('m-nota') || {}).value || '', por: A.nombreOperador() };
    if (O.tipo === 'TRS') { d.destino = ($('m-dest') || {}).value; d.estado = 'pendiente'; if (!d.destino) return toast('No hay otra tienda para transferir', true); }
    if (O.tipo === 'REC') d.guia = ($('m-guia') || {}).value || '';
    guardar(function () { return db().collection('mov').doc(nuevoId('m')).set(d); }, T.n + ' guardada').then(function (ok) { if (ok) { O.lineas = []; rerender(); } });
  }
  function recibir(id) {
    var m = O.mov.filter(function (x) { return x.id === id; })[0]; if (!m) return;
    var root = document.getElementById('sheet-root');
    root.innerHTML = '<div class="sheet-bg" data-op="sh-close"><div class="sheet card" role="dialog" aria-modal="true" aria-labelledby="sh-t" style="max-width:560px;width:100%"><h2 id="sh-t">Recepción de transferencia</h2><p class="muted small">Cuente lo que llegó. Si llega menos de lo enviado, anote lo real: la diferencia queda registrada.</p>' +
      tabla(['Kit', 'Enviado', 'Recibido'], m.lineas.map(function (l, i) { return [esc(kitNom(l.kit)), fmt(l.cant), '<input class="inp alba-num" type="number" min="0" step="any" id="rc-' + i + '" value="' + l.cant + '">']; }), [1, 2]) +
      '<div class="row" style="justify-content:flex-start;gap:10px;margin-top:12px"><button class="btn primary" data-op="rc-ok" data-id="' + esc(id) + '">Confirmar recepción</button><button class="btn" data-op="sh-close">Cancelar</button></div></div></div>';
  }
  function cerrarHoja() { var r = document.getElementById('sheet-root'); if (r) r.innerHTML = ''; }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-op]'); if (!el) return;
    var op = el.dataset.op;
    if (op === 'sh-close') { if (ev.target === el || el.tagName === 'BUTTON') cerrarHoja(); return; }
    if (['tienda', 'fecha', 'rango', 'ln'].indexOf(op) >= 0) return;
    ev.preventDefault();
    switch (op) {
      case 'sub': O.sub[el.dataset.r] = el.dataset.v; if (el.dataset.r === 'operacion') ls('sub_operacion', el.dataset.v); O.ventasParse = null; rerender(); break;
      case 'tipo': O.tipo = el.dataset.v; O.lineas = []; rerender(); break;
      case 'ln-add': O.lineas.push(nuevaLinea()); rerender(); break;
      case 'ln-del': O.lineas.splice(+el.dataset.i, 1); rerender(); break;
      case 'mov-save': guardarMov(); break;
      case 'mov-del': if (confirm('¿Anular este movimiento? Se borra del registro del día.')) guardar(function () { return db().collection('mov').doc(el.dataset.id).delete(); }, 'Movimiento anulado'); break;
      case 'trs-rec': recibir(el.dataset.id); break;
      case 'rc-ok': {
        var m = O.mov.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!m) return;
        var lineas = m.lineas.map(function (l, i) { var o = JSON.parse(JSON.stringify(l)); o.recibido = +($('rc-' + i).value || 0); return o; });
        guardar(function () { return db().collection('mov').doc(m.id).update({ estado: 'recibida', lineas: lineas, recibidaFecha: O.fecha, recibidaHora: hhmm(), recibidaPor: A.nombreOperador() }); }, 'Transferencia recibida').then(function (ok) { if (ok) cerrarHoja(); });
        break;
      }
      case 'cont-save': {
        var t = tiendaActual(), lineas = {};
        Array.prototype.forEach.call(document.querySelectorAll('[data-cont]'), function (i) { if (i.value !== '') lineas[i.dataset.cont] = +i.value; });
        guardar(function () { return db().collection('conteo').doc(k2(t, O.fecha)).set({ tienda: t, fecha: O.fecha, hora: hhmm(), lineas: lineas, por: A.nombreOperador() }); }, 'Conteo guardado');
        break;
      }
      case 'canal': O.canal = el.dataset.v; rerender(); break;
      case 'pax': {
        var t2 = tiendaActual(), dev = ls('disp') || (function () { var x = Math.random().toString(36).slice(2, 10); ls('disp', x); return x; })();
        var id = k2(t2, O.fecha) + '_' + dev, cur = O.pax.filter(function (p) { return p.id === id; })[0], reg = cur && cur.reg ? cur.reg.slice() : [];
        var mesa = String(($('pax-mesa') || {}).value || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
        reg.push({ h: hhmm(), p: +el.dataset.n, c: O.canal, m: mesa, por: A.nombreOperador() });
        guardar(function () { return db().collection('pax').doc(id).set({ tienda: t2, fecha: O.fecha, reg: reg }); }, (+el.dataset.n) + (el.dataset.n === '1' ? ' persona' : ' personas') + (O.canal === 'mesa' ? ' en mesa' : ' para llevar'));
        break;
      }
      case 'vt-rev': O.ventasParse = parseVentas(($('vt-txt') || {}).value || ''); O.vtTxt = ($('vt-txt') || {}).value || ''; rerender(); if ($('vt-txt')) $('vt-txt').value = O.vtTxt; break;
      case 'vt-save': {
        var t3 = tiendaActual(), p = O.ventasParse; if (!p) return;
        guardar(function () { return db().collection('ventas').doc(k2(t3, O.fecha)).set({ tienda: t3, fecha: O.fecha, hora: hhmm(), lineas: p.kits, sinMapear: p.sin.length, por: A.nombreOperador() }); }, 'Ventas guardadas').then(function (ok) { if (ok) { O.ventasParse = null; O.vtTxt = ''; rerender(); } });
        break;
      }
      case 'ex-dl': { var r = rango('ex-d', 'ex-h'); if (window.Alba && Alba.descargar) Alba.descargar('alba_contifico_' + r[0] + '_' + r[1] + '.csv', '﻿' + filasExport(r[0], r[1])); break; }
      case 'ex-copy': { var tx = $('ex-txt'); if (navigator.clipboard) navigator.clipboard.writeText(tx.value).then(function () { toast('Copiado'); }, function () { tx.select(); }); else tx.select(); break; }
      case 'arch-dl': {
        var mes = el.dataset.m, dm = datosMes(mes);
        var json = JSON.stringify({ app: 'alba_galletti', tipo: 'archivo_mensual', mes: mes, exportado: new Date().toISOString(), por: A.nombreOperador(), kits: O.kits, datos: dm }, null, 1);
        Promise.all([Alba.descargar('alba_archivo_' + mes + '.json', json), Alba.descargar('alba_movimientos_' + mes + '.csv', '﻿' + csvMes(dm))]).then(function () { O.archDescargado = mes; toast('Archivo del mes descargado. Verifique el archivo antes de borrar en línea.'); rerender(); });
        break;
      }
      case 'arch-del': {
        var mes2 = el.dataset.m; if (O.archDescargado !== mes2) return;
        var escrito = prompt('Se borrarán en línea todos los registros de ' + mes2 + ' (movimientos, conteos, ventas y mesas). Escriba el mes (' + mes2 + ') para confirmar.');
        if (escrito !== mes2) { toast('No se borró nada'); return; }
        if (A.modo === 'red' && A.sb) {
          A.sb.rpc('alba_archivar', { p_mes: mes2 }).then(function (r) { if (r.error) return toast('No se archivó: ' + r.error.message, true); toast(r.data + ' registros archivados y borrados en línea. La bitácora de auditoría se conserva.'); O.archDescargado = ''; rerender(); });
          break;
        }
        var dm2 = datosMes(mes2), tareas = [];
        dm2.mov.forEach(function (x) { tareas.push(['mov', x.id]); }); dm2.conteo.forEach(function (x) { tareas.push(['conteo', x.id]); }); dm2.ventas.forEach(function (x) { tareas.push(['ventas', x.id]); }); dm2.pax.forEach(function (x) { tareas.push(['pax', x.id]); });
        var i = 0;
        (function sig() { if (i >= tareas.length) { toast(tareas.length + ' registros archivados y borrados en línea'); db().collection('archivo').doc(mes2).set({ mes: mes2, registros: tareas.length, fecha: hoy(), por: A.nombreOperador() }); O.archDescargado = ''; rerender(); return; }
          var tk = tareas[i++]; db().collection(tk[0]).doc(tk[1]).delete().then(sig, function (e) { toast('Se detuvo el borrado: ' + ((e && e.message) || 'error'), true); }); })();
        break;
      }
      case 'arch-todo': {
        var todo = { app: 'alba_galletti', tipo: 'respaldo_completo', exportado: new Date().toISOString(), horarios: window.AlbaApp ? window.AlbaApp.raw : null, kits: O.kits, opcfg: O.cfg, personal: O.personal, mov: O.mov, conteos: O.conteos, ventas: O.ventas, pax: O.pax };
        Alba.descargar('alba_respaldo_' + hoy() + '.json', JSON.stringify(todo, null, 1)); break;
      }
      case 'arch-uso': if (A.sb) A.sb.rpc('alba_uso').then(function (r) { if (!r.error) { O.uso = r.data; rerender(); } }); break;
      case 'cf-save': {
        var causas = ($('cf-causas').value || '').split('\n').map(function (l) { return l.split('|').map(function (s) { return s.trim(); }); }).filter(function (a) { return a[0]; }).map(function (a) { return { codigo: a[0], nombre: a[1] || a[0] }; });
        var bodegas = {}; ($('cf-bod').value || '').split('\n').forEach(function (l) { var a = l.split('|').map(function (s) { return s.trim(); }); if (a[0]) bodegas[a[0]] = a[1] || ''; });
        guardar(function () { return db().doc('opcfg/main').set({ causas: causas, bodegas: bodegas, tolerancia: +$('cf-tol').value || 0 }); }, 'Ajustes guardados');
        break;
      }
      case 'kits-save': {
        var nuevos = ($('kits-txt').value || '').split('\n').map(function (l) { return l.split('|').map(function (s) { return s.trim(); }); }).filter(function (a) { return a[0]; }).map(function (a) {
          return { codigo: a[0], nombre: a[1] || a[0], familia: a[2] || '', unidad: a[3] || 'u', frio: a[4] || '', vida: a[5] || '', contifico: (a[6] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { var p = s.split('*'); return { codigo: p[0].trim().toUpperCase(), factor: +(p[1] || 1) }; }), activo: !/^no$/i.test(a[7] || 'si') };
        });
        var ids = {}; nuevos.forEach(function (k) { ids[k.codigo] = 1; });
        guardar(function () {
          var p = Promise.resolve();
          nuevos.forEach(function (k) { p = p.then(function () { return db().collection('kits').doc(k.codigo).set(k); }); });
          O.kits.forEach(function (k) { if (!ids[k.id]) p = p.then(function () { return db().collection('kits').doc(k.id).delete(); }); });
          return p;
        }, 'Catálogo guardado: ' + nuevos.length + ' kits');
        break;
      }
      case 'pe-add': {
        var nom = $('pe-nom').value.trim(), ti = $('pe-tienda').value, pin = $('pe-pin').value.trim();
        if (!nom || !pinValido(pin)) return toast('Escriba el nombre y un PIN de 6 dígitos sin repeticiones ni secuencias', true);
        var pid = nuevoId('p');
        if (A.modo === 'red') {
          guardar(function () { return db().collection('personal').doc(pid).set({ nombre: nom, tienda: ti, activo: true, alta: hoy() }); }).then(function (ok) {
            if (!ok) return; A.sb.rpc('alba_pin_fijar', { p_personal: pid, p_pin: pin }).then(function (r) { toast(r.error ? 'Persona agregada, pero el PIN no se guardó: ' + r.error.message : 'Persona agregada con su PIN', !!r.error); });
          });
          break;
        }
        Alba.hashPin(pin, pid).then(function (hash) { return guardar(function () { return db().collection('personal').doc(pid).set({ nombre: nom, tienda: ti, pinHash: hash, activo: true }); }, 'Persona agregada'); });
        break;
      }
      case 'pe-pin': {
        var np = prompt('Nuevo PIN de 6 dígitos para ' + O.personal[el.dataset.id].nombre); if (!np) return;
        if (!pinValido(np)) return toast('El PIN debe tener 6 dígitos, sin repeticiones ni secuencias', true);
        if (A.modo === 'red') { A.sb.rpc('alba_pin_fijar', { p_personal: el.dataset.id, p_pin: np }).then(function (r) { toast(r.error ? 'No se cambió: ' + r.error.message : 'PIN actualizado', !!r.error); }); break; }
        Alba.hashPin(np, el.dataset.id).then(function (hash) { return guardar(function () { return db().collection('personal').doc(el.dataset.id).update({ pinHash: hash }); }, 'PIN actualizado'); });
        break;
      }
      case 'pe-act': guardar(function () { return db().collection('personal').doc(el.dataset.id).update({ activo: O.personal[el.dataset.id].activo === false }); }, 'Actualizado'); break;
      case 'cu-add': {
        var em = $('cu-email').value.trim().toLowerCase(), rol = $('cu-rol').value, tt = $('cu-tienda').value, tit = ($('cu-titular').value || '').trim().toLowerCase();
        if (!/@/.test(em)) return toast('Correo no válido', true);
        if (rol === 'tienda' && !tt) return toast('El rol tienda necesita una tienda', true);
        if (rol === 'licenciatario' && !tit) return toast('El rol licenciatario necesita el id del licenciatario', true);
        guardar(function () { return db().collection('perfiles').doc(em).set({ email: em, rol: rol, tienda: rol === 'tienda' ? tt : '', titular: rol === 'licenciatario' ? tit : '', nombre: $('cu-nom').value.trim(), activo: true }); }, 'Cuenta habilitada');
        break;
      }
      case 'cu-act': guardar(function () { return db().collection('perfiles').doc(el.dataset.id).update({ activo: O.perfiles[el.dataset.id].activo === false }); }, 'Actualizado'); break;
      case 'op-entrar': {
        var pid2 = $('op-persona').value, pin2 = $('op-pin').value;
        var entrar = function (okPin) { if (okPin) { Alba.fijarOperador({ id: pid2, nombre: O.personal[pid2].nombre, email: Alba.perfil.email }); rerender(); if (window.AlbaLegal) AlbaLegal.operador(Alba.operador); } else toast('PIN incorrecto', true); };
        if (A.modo === 'red' && !O.personal[pid2].pinHash) A.sb.rpc('alba_pin_verificar', { p_personal: pid2, p_pin: pin2 }).then(function (r) { if (r.error) return toast(r.error.message, true); entrar(r.data === true); });
        else Alba.hashPin(pin2, pid2).then(function (h) { entrar(h === O.personal[pid2].pinHash); });
        break;
      }
      case 'op-sin': Alba.fijarOperador({ id: '', nombre: tiendaNom(tiendaActual()), email: Alba.perfil.email }); rerender(); break;
      case 'op-cambiar': Alba.soltarOperador(); rerender(); break;
      case 'salir': if (window.Alba && Alba.salir) Alba.salir(); break;
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target; if (!el.dataset || !el.dataset.op) return;
    var op = el.dataset.op;
    if (op === 'tienda') { if (App()) App().tienda = el.value; try { localStorage.setItem('hg_tienda', el.value); } catch (e) { /* nada */ } O.lineas = []; rerender(); }
    else if (op === 'fecha') { O.fecha = el.value || hoy(); O.lineas = []; rerender(); }
    else if (op === 'rango') { O[el.id] = el.value; rerender(); }
    else if (op === 'ln') { O.lineas[+el.dataset.i][el.dataset.f] = el.value; }
  });
  document.addEventListener('input', function (ev) { var el = ev.target; if (el.dataset && el.dataset.op === 'ln') O.lineas[+el.dataset.i][el.dataset.f] = el.value; });

  /* ---------- integración con el enrutador ---------- */
  window.AlbaOps = {
    rutas: function () { return RUTAS.filter(function (r) { return r[3](); }).map(function (r) { return [r[0], r[1], r[2]]; }).concat(window.AlbaSup ? AlbaSup.rutas() : []).concat(window.AlbaEsc ? AlbaEsc.rutas() : []); },
    iconos: Object.assign({}, ICONOS, window.AlbaSup ? AlbaSup.iconos : {}, window.AlbaEsc ? AlbaEsc.iconos : {}),
    tiene: function (r) { return RUTAS.some(function (x) { return x[0] === r && x[3](); }) || !!(window.AlbaSup && AlbaSup.tiene(r)) || !!(window.AlbaEsc && AlbaEsc.tiene(r)); },
    vista: function (r) {
      suscribir();
      if (window.AlbaSup && AlbaSup.tiene(r)) return AlbaSup.vista(r);
      if (window.AlbaEsc && AlbaEsc.tiene(r)) return AlbaEsc.vista(r);
      if (r === 'operacion') return viewOperacion();
      if (r === 'red') return viewRed();
      if (r === 'catalogo') return viewCatalogo();
      return '';
    },
    despues: function () {
      var top = document.querySelector('header.top .wrap'); if (!top) return;
      var u = document.getElementById('alba-usuario');
      if (!u) { u = document.createElement('span'); u.id = 'alba-usuario'; u.className = 'alba-usuario'; top.appendChild(u); }
      var txt = A.modo === 'red' ? esc((A.perfil && (A.perfil.nombre || A.perfil.email)) || '') + ' · ' + esc(A.rol()) + ' <button class="btn sm ghost" data-op="salir" title="Cerrar sesión">' + icon('out') + 'Salir</button>' : '<span class="pill gold">Demo local</span>';
      if (u.innerHTML !== txt) u.innerHTML = txt;
      suscribir();
      if (window.AlbaSup) AlbaSup.despues();
      if (window.AlbaEsc) AlbaEsc.despues();
    },
    suscribir: suscribir
  };
})();
