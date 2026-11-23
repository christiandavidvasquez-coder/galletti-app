/* Alba · Café Galletti - núcleo: sesión, permisos por rol y almacén en tiempo real (Supabase).
   Expone la misma superficie que usa la app de horarios (window.claude.use('db' | 'user' | 'downloads')),
   así la app corre sin cambios sobre la base compartida. Sin configuración, la app queda en modo demo local. */
(function () {
  'use strict';
  var CFG = window.ALBA_CONFIG || {};
  var configurado = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase && !/PEGAR/.test(CFG.supabaseUrl));
  var ROLES_ESCRITURA_HORARIOS = { central: 1, gerencia: 1, supervisor: 1, licenciatario: 1 };

  var Alba = window.Alba = {
    configurado: configurado, sb: null, sesion: null, perfil: null, operador: null,
    rol: function () { return Alba.perfil ? Alba.perfil.rol : (configurado ? null : 'central'); },
    tienda: function () { return Alba.perfil ? Alba.perfil.tienda || null : null; },
    es: function () { var r = Alba.rol(); for (var i = 0; i < arguments.length; i++) if (arguments[i] === r) return true; return false; },
    nombreOperador: function () { return Alba.operador ? Alba.operador.nombre : (Alba.perfil ? (Alba.perfil.nombre || Alba.perfil.email) : 'demo'); }
  };

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function err(code, message) { return { code: code, message: message }; }
  function mapErr(e) {
    if (!e) return err('unavailable', 'Error');
    var c = String(e.code || ''), m = e.message || String(e);
    if (c === '42501' || /row-level security|permission denied/i.test(m)) return err('invalid_argument', 'Sin permiso para este cambio');
    if (/Failed to fetch|NetworkError|network/i.test(m)) return err('unavailable', 'Sin conexión');
    return err('unavailable', m);
  }

  /* ---------- almacén de documentos con caché y tiempo real ---------- */
  function crearStore(sb) {
    var cache = {}, cargado = {}, cargando = {}, colL = {}, docL = {}, canal = null, META = { fromCache: false, hasPendingWrites: false };
    function snapDoc(c, id) {
      var col = cache[c] || {}, ex = Object.prototype.hasOwnProperty.call(col, id);
      return { id: id, exists: ex, data: function () { return ex ? clone(col[id]) : undefined; }, metadata: META };
    }
    function snapCol(c, filtro) {
      var ids = Object.keys(cache[c] || {}).sort();
      var docs = ids.map(function (id) { return snapDoc(c, id); });
      if (filtro) docs = filtro(docs);
      return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: META };
    }
    function avisar(c) {
      (colL[c] || []).slice().forEach(function (l) { try { l.next(snapCol(c, l.filtro)); } catch (e) { console.error(e); } });
      Object.keys(docL).forEach(function (p) { var s = p.split('/'); if (s[0] !== c) return; (docL[p] || []).slice().forEach(function (l) { try { l.next(snapDoc(s[0], s[1])); } catch (e) { console.error(e); } }); });
    }
    function aplicar(row, borrar) {
      if (!row || !row.col) return;
      var col = cache[row.col] = cache[row.col] || {};
      if (borrar) delete col[row.id]; else col[row.id] = row.data;
      avisar(row.col);
    }
    function cargar(c) {
      if (cargado[c]) return Promise.resolve();
      if (cargando[c]) return cargando[c];
      cargando[c] = (function pagina(desde, acc) {
        return sb.from('docs').select('id,data').eq('col', c).range(desde, desde + 999).then(function (r) {
          if (r.error) throw mapErr(r.error);
          acc = acc.concat(r.data || []);
          if ((r.data || []).length === 1000) return pagina(desde + 1000, acc);
          var m = {}; acc.forEach(function (x) { m[x.id] = x.data; });
          cache[c] = Object.assign(m, cache[c] && cargado[c] ? cache[c] : {});
          cargado[c] = true; return null;
        });
      })(0, []);
      return cargando[c];
    }
    function tiempoReal() {
      if (canal) return;
      canal = sb.channel('alba-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, function (p) {
        if (p.eventType === 'DELETE') aplicar(p.old, true); else aplicar(p.new, false);
      }).subscribe(function (estado) { Alba.estadoTiempoReal = estado; if (Alba.alCambiarConexion) Alba.alCambiarConexion(estado); });
    }
    function escribir(c, id, d) {
      var previo = cache[c] ? clone(cache[c][id]) : undefined;
      (cache[c] = cache[c] || {})[id] = clone(d); avisar(c);
      return sb.from('docs').upsert({ col: c, id: id, data: d }, { onConflict: 'col,id' }).then(function (r) {
        if (r.error) { if (previo === undefined) delete cache[c][id]; else cache[c][id] = previo; avisar(c); throw mapErr(r.error); }
      });
    }
    function docRef(c, id) {
      return {
        id: id, path: c + '/' + id,
        get: function () { return cargar(c).then(function () { return snapDoc(c, id); }); },
        set: function (d) { return escribir(c, id, clone(d)); },
        update: function (d) {
          return cargar(c).then(function () {
            var cur = (cache[c] || {})[id];
            if (cur === undefined) throw err('invalid_argument', 'El documento no existe');
            var n = clone(cur), nd = clone(d); Object.keys(nd).forEach(function (k) { n[k] = nd[k]; });
            return escribir(c, id, n);
          });
        },
        delete: function () {
          var previo = cache[c] ? cache[c][id] : undefined;
          if (cache[c]) delete cache[c][id]; avisar(c);
          return sb.from('docs').delete().eq('col', c).eq('id', id).then(function (r) {
            if (r.error) { if (previo !== undefined) cache[c][id] = previo; avisar(c); throw mapErr(r.error); }
          });
        },
        onSnapshot: function (next, onErr) {
          var p = c + '/' + id, l = { next: next }; (docL[p] = docL[p] || []).push(l); tiempoReal();
          cargar(c).then(function () { next(snapDoc(c, id)); }, function (e) { if (onErr) onErr(e); });
          return function () { var a = docL[p], i = a.indexOf(l); if (i >= 0) a.splice(i, 1); };
        },
        collection: function (sub) { return coleccion(c + '__' + id + '__' + sub); }
      };
    }
    function nuevoId() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    function consulta(c, filtros, orden, lim) {
      function filtro(docs) {
        var r = docs.filter(function (d) {
          var x = d.data();
          return filtros.every(function (f) {
            var v = x[f[0]], w = f[2];
            switch (f[1]) { case '==': return v === w; case '!=': return v !== w; case '<': return v < w; case '<=': return v <= w; case '>': return v > w; case '>=': return v >= w;
              case 'in': return w.indexOf(v) >= 0; case 'not-in': return w.indexOf(v) < 0; case 'array-contains': return Array.isArray(v) && v.indexOf(w) >= 0; default: return true; }
          });
        });
        if (orden) r.sort(function (a, b) { var x = a.data()[orden[0]], y = b.data()[orden[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (orden[1] === 'desc' ? -1 : 1); });
        if (lim) r = r.slice(0, lim);
        return r;
      }
      var q = {
        where: function (f, op, v) { return consulta(c, filtros.concat([[f, op, v]]), orden, lim); },
        orderBy: function (f, dir) { return consulta(c, filtros, [f, dir || 'asc'], lim); },
        limit: function (n) { return consulta(c, filtros, orden, n); },
        get: function () { return cargar(c).then(function () { return snapCol(c, filtro); }); },
        onSnapshot: function (next, onErr) {
          var l = { next: next, filtro: filtro }; (colL[c] = colL[c] || []).push(l); tiempoReal();
          cargar(c).then(function () { next(snapCol(c, filtro)); }, function (e) { if (onErr) onErr(e); });
          return function () { var a = colL[c], i = a.indexOf(l); if (i >= 0) a.splice(i, 1); };
        }
      };
      return q;
    }
    function coleccion(c) {
      var q = consulta(c, [], null, 0);
      q.path = c;
      q.doc = function (id) { return docRef(c, id || nuevoId()); };
      q.add = function (d) { var r = docRef(c, nuevoId()); return r.set(d).then(function () { return r; }); };
      return q;
    }
    return {
      collection: coleccion,
      doc: function (path) { var p = String(path).split('/'); return docRef(p[0], p[1]); },
      /* utilidades propias de Alba */
      recargar: function (c) { cargado[c] = false; cargando[c] = null; return cargar(c).then(function () { avisar(c); }); },
      olvidar: function (c, ids) { ids.forEach(function (id) { if (cache[c]) delete cache[c][id]; }); avisar(c); }
    };
  }

  /* ---------- descargas: enlace con Blob (web y escritorio) ---------- */
  var Descargas = {
    save: function (o) {
      return new Promise(function (ok, ko) {
        try {
          var data = o.data, blob;
          if (data instanceof Blob) blob = data;
          else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) blob = new Blob([data]);
          else if (typeof data === 'string' && /^data:/.test(data)) { var a0 = document.createElement('a'); a0.href = data; a0.download = o.filename; document.body.appendChild(a0); a0.click(); a0.remove(); return ok(); }
          else blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: /\.csv$/i.test(o.filename) ? 'text/csv;charset=utf-8' : /\.json$/i.test(o.filename) ? 'application/json' : 'application/octet-stream' });
          var url = URL.createObjectURL(blob), a = document.createElement('a');
          a.href = url; a.download = o.filename; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000); ok();
        } catch (e) { ko(e); }
      });
    }
  };
  Alba.descargar = function (filename, data) { return Descargas.save({ filename: filename, data: data }); };

  /* ---------- operador con PIN (cuentas de tienda) ---------- */
  Alba.hashPin = function (pin, sal) {
    var txt = new TextEncoder().encode('alba|' + sal + '|' + pin);
    return crypto.subtle.digest('SHA-256', txt).then(function (b) { return Array.from(new Uint8Array(b)).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
  };
  function operadorGuardado() { try { return JSON.parse(sessionStorage.getItem('alba_operador') || 'null'); } catch (e) { return null; } }
  Alba.fijarOperador = function (o) { Alba.operador = o; try { sessionStorage.setItem('alba_operador', JSON.stringify(o)); } catch (e) { /* sin sesión */ } if (Alba.alCambiarOperador) Alba.alCambiarOperador(o); };
  Alba.soltarOperador = function () { Alba.operador = null; try { sessionStorage.removeItem('alba_operador'); } catch (e) { /* nada */ } if (Alba.alCambiarOperador) Alba.alCambiarOperador(null); };

  if (!configurado) { Alba.modo = 'demo'; return; }

  /* ---------- sesión ---------- */
  var sb = Alba.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'alba-sesion' } });
  var listo, alListo = new Promise(function (r) { listo = r; });
  var store = null;

  function pantallaLogin(msg) {
    var d = document.getElementById('alba-login');
    if (!d) { d = document.createElement('div'); d.id = 'alba-login'; document.body.appendChild(d); }
    d.innerHTML = '<div class="alba-login-card card"><img class="alba-login-gallo" src="' + (document.querySelector('.bg-wm img') || {}).src + '" alt="">' +
      '<h1>' + (window.ALBA_NOMBRE || 'Alba') + '</h1><p class="muted">Café Galletti · operación de tienda</p>' +
      '<form id="alba-login-form" autocomplete="on"><label class="f" for="alba-email">Usuario (correo)</label><input class="inp" id="alba-email" type="email" autocomplete="username" required>' +
      '<label class="f" for="alba-pass" style="margin-top:12px">Contraseña</label><input class="inp" id="alba-pass" type="password" autocomplete="current-password" required>' +
      '<p class="alba-login-msg" id="alba-login-msg" role="alert">' + (msg || '') + '</p>' +
      '<button class="btn primary" type="submit" style="width:100%;margin-top:8px">Entrar</button></form>' +
      '<p class="small muted" style="margin-top:14px">Las cuentas las crea la central. Si olvidó su contraseña, avise al supervisor.</p></div>';
    d.hidden = false;
    document.getElementById('alba-login-form').onsubmit = function (ev) {
      ev.preventDefault();
      var m = document.getElementById('alba-login-msg'); m.textContent = 'Entrando...';
      sb.auth.signInWithPassword({ email: document.getElementById('alba-email').value.trim(), password: document.getElementById('alba-pass').value }).then(function (r) {
        if (r.error) { m.textContent = /Invalid login/i.test(r.error.message) ? 'Usuario o contraseña incorrectos.' : 'No se pudo entrar: ' + r.error.message; return; }
        iniciar(r.data.session);
      });
    };
  }
  function ocultarLogin() { var d = document.getElementById('alba-login'); if (d) d.hidden = true; }

  function iniciar(sesion) {
    Alba.sesion = sesion;
    var email = (sesion.user.email || '').toLowerCase();
    return sb.from('docs').select('data').eq('col', 'perfiles').eq('id', email).maybeSingle().then(function (r) {
      if (r.error || !r.data || r.data.data.activo === false) {
        sb.auth.signOut(); pantallaLogin('Su cuenta existe pero no tiene un perfil activo en Alba. Pida a la central que la habilite.'); return;
      }
      Alba.perfil = Object.assign({ email: email }, r.data.data);
      var op = operadorGuardado(); if (op && op.email === email) Alba.operador = op;
      store = crearStore(sb); Alba.store = store;
      ocultarLogin(); document.body.classList.add('alba-rol-' + Alba.perfil.rol);
      listo();
    });
  }
  Alba.salir = function () { Alba.soltarOperador(); sb.auth.signOut().then(function () { location.reload(); }); };

  var Usuario = {
    isOwner: function () { return alListo.then(function () { return Alba.es('central'); }); },
    canEdit: function () { return alListo.then(function () { return Alba.es('central', 'gerencia'); }); },
    can: function (n) { return alListo.then(function () { return n === 'data.write' ? !!ROLES_ESCRITURA_HORARIOS[Alba.rol()] : false; }); },
    id: function () { return alListo.then(function () { return Alba.sesion.user.id; }); },
    me: function () { return alListo.then(function () { return { id: Alba.sesion.user.id, name: Alba.perfil.nombre || Alba.perfil.email }; }); },
    profiles: function () { return Promise.resolve({}); }
  };

  window.claude = {
    use: function (n) {
      if (n === 'downloads') return Promise.resolve(Descargas);
      if (n === 'user') return alListo.then(function () { return Usuario; });
      if (n === 'db') return alListo.then(function () { return store; });
      return Promise.resolve(null);
    }
  };
  Alba.listo = alListo;
  Alba.modo = 'red';

  function arrancar() {
    sb.auth.getSession().then(function (r) { if (r.data && r.data.session) iniciar(r.data.session); else pantallaLogin(''); });
    sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && Alba.perfil) location.reload(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
