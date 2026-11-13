// veritest/public/js/verify.js
//
// Verificación pública, dos formas (misma página de resultado):
//   * /v/<id>   -- se llega escaneando el QR del diploma. Muestra el registro.
//   * archivo   -- se elige el PDF; el navegador calcula su SHA-256 con
//                  crypto.subtle y manda SOLO la huella a /api/verify. El PDF
//                  nunca sale del computador de quien verifica.
//
// La verificación FALLA CERRADA: si la consulta no se puede completar, la
// página lo dice con todas sus letras; jamás muestra "válido" por omisión
// (al revés que el widget de reservas, que falla abierto -- aquí un "válido"
// falso sería peor que ningún resultado).
//
// Todo el texto del registro entra por textContent: nada de HTML del servidor.
(function () {
  'use strict';

  var MAX_BYTES = 25 * 1024 * 1024;
  // Las fechas de registro se muestran en hora de Chile, no en la del
  // navegador de quien consulta (mismo criterio que el resto de los productos).
  var TZ = 'America/Santiago';

  function $(sel) { return document.querySelector(sel); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function fmtDate(ymd) {
    // 'AAAA-MM-DD' sin hora: formatear en UTC para que el navegador no la corra un día.
    var p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('es-CL', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function fmtInstant(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' }) + ' (hora de Chile)';
  }

  function sha256Hex(file) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('Tu navegador no permite calcular la huella del archivo en esta conexión.'));
    }
    return file.arrayBuffer().then(function (buf) {
      return window.crypto.subtle.digest('SHA-256', buf);
    }).then(function (digest) {
      return Array.prototype.map.call(new Uint8Array(digest), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function lookup(params) {
    return fetch('/api/verify?' + new URLSearchParams(params).toString(), { headers: { accept: 'application/json' } })
      .then(function (res) {
        if (res.status === 404) return { found: false };
        if (!res.ok) throw new Error('http_' + res.status);
        return res.json();
      });
  }

  function msg(kind, text) { return el('div', 'msg ' + kind, text); }

  // uploadHint: en /v/<id> el archivo se sube DESPUÉS de ver el registro; en el
  // inicio ya se subió antes, así que la nota no manda a subirlo.
  function renderRecord(host, r, uploadHint) {
    clear(host);
    var valid = r.status === 'valid';
    host.appendChild(el('span', 'badge ' + (valid ? 'ok' : 'warn'), valid ? 'Diploma registrado y vigente' : 'Registro no vigente (estado: ' + r.status + ')'));
    host.appendChild(el('p', 'holder', r.holderName));
    var dl = el('dl', 'rec');
    function row(k, v) { if (!v) return; dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    row('Diploma', r.title);
    row('Emisor', r.issuerName);
    row('Folio', r.folio);
    row('Fecha de emisión', r.issuedOn ? fmtDate(r.issuedOn) : null);
    row('Registrado el', fmtInstant(r.registeredAt));
    host.appendChild(dl);
    host.appendChild(msg('info', 'Compara estos datos con tu documento. Veritest confirma que el emisor registró este diploma; un QR copiado sobre otro documento mostraría estos mismos datos.' +
      (uploadHint ? ' Para comprobar que tu archivo es idéntico al registrado, súbelo abajo.' : '')));
  }

  function renderNotFound(host) {
    clear(host);
    host.appendChild(el('span', 'badge bad', 'No encontrado'));
    host.appendChild(msg('bad', 'No encontramos un diploma registrado con este código. Puede que el QR se haya escaneado mal, o que el diploma no esté registrado en Veritest.'));
  }

  function renderError(host) {
    clear(host);
    host.appendChild(el('span', 'badge warn', 'Sin resultado'));
    host.appendChild(msg('warn', 'No pudimos consultar el registro en este momento. Inténtalo de nuevo en unos minutos. Esto no significa que el diploma sea falso.'));
  }

  // ---- /v/<id> ----
  function recordPage() {
    var host = $('#result');
    var id = location.pathname.split('/').filter(Boolean)[1] || '';
    if (!/^[A-Za-z0-9_-]{22}$/.test(id)) { renderNotFound(host); return; }
    host.textContent = 'Consultando el registro…';
    lookup({ id: id }).then(function (r) {
      if (r.found) renderRecord(host, r, true); else renderNotFound(host);
    }).catch(function () { renderError(host); });
    wireFile(function (r, matchedKind) {
      var out = $('#file-result');
      clear(out);
      if (r.found && r.id === id) {
        out.appendChild(matchedKind === 'original'
          ? msg('warn', 'Este archivo es el PDF original que se registró, sin el QR de Veritest. La versión oficial es la que lleva el QR.')
          : msg('ok', 'El archivo es idéntico a la versión oficial registrada de este diploma.'));
      } else if (r.found) {
        out.appendChild(msg('bad', 'Este archivo corresponde a OTRO diploma registrado, no al de este código.'));
      } else {
        out.appendChild(msg('bad', 'El archivo no coincide con lo registrado. Si el PDF fue modificado, reimpreso o convertido, la huella cambia aunque el diploma sea real; en ese caso confía en los datos de arriba.'));
      }
    });
  }

  // ---- inicio: verificar un archivo ----
  function homePage() {
    wireFile(function (r, matchedKind) {
      var host = $('#result');
      clear(host);
      if (!r.found) {
        host.appendChild(el('span', 'badge bad', 'No coincide'));
        host.appendChild(msg('bad', 'Este archivo no coincide con ningún diploma registrado. Si el PDF fue modificado, reimpreso o convertido, la huella cambia aunque el diploma sea real: en ese caso escanea el QR del diploma.'));
        return;
      }
      renderRecord(host, r);
      host.appendChild(matchedKind === 'original'
        ? msg('warn', 'Este archivo es el PDF original que se registró, sin el QR de Veritest. La versión oficial es la que lleva el QR.')
        : msg('ok', 'El archivo es idéntico a la versión oficial registrada.'));
    });
  }

  // Conecta el selector/soltar de archivos. cb(resultado, 'stamped'|'original'|null)
  function wireFile(cb) {
    var input = $('#file');
    var drop = $('#drop');
    if (!input || !drop) return;
    var status = $('#file-status');

    function handle(file) {
      if (!file) return;
      var host = $('#result');
      if (file.size > MAX_BYTES) { clear(status); status.appendChild(msg('warn', 'El archivo es demasiado grande (máximo 25 MB).')); return; }
      clear(status);
      status.textContent = 'Calculando la huella de «' + file.name + '» en tu navegador…';
      sha256Hex(file).then(function (hash) {
        return lookup({ hash: hash });
      }).then(function (r) {
        clear(status);
        cb(r, r.matched || null);
      }).catch(function (e) {
        clear(status);
        if (e && /huella/.test(e.message)) status.appendChild(msg('warn', e.message));
        else if (host && $('#file-result') === null) renderError(host);
        else status.appendChild(msg('warn', 'No pudimos consultar el registro en este momento. Inténtalo de nuevo; esto no significa que el diploma sea falso.'));
      });
    }

    input.addEventListener('change', function () { handle(input.files && input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { handle(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
  }

  var page = document.body.getAttribute('data-page');
  if (page === 'record') recordPage();
  else if (page === 'home') homePage();
})();
