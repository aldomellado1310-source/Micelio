// veritest/public/js/issuer.js
//
// Panel del emisor: iniciar sesión, subir un PDF ya hecho, elegir en qué
// esquina va el QR de Veritest, registrar y descargar el PDF sellado.
//
// Todo lo que decide el servidor (quién es el emisor, el id, el sellado, la
// huella) viene en la respuesta del callable `registerDiploma`; este archivo
// no decide nada de eso. Todo texto dinámico entra por textContent.
import { auth, functions } from './firebase-init-veritest.js';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

const MAX_BYTES = 5 * 1024 * 1024;

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};
const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

const FRIENDLY = {
  already_registered: 'Este PDF ya está registrado en Veritest.',
  invalid_pdf: 'El archivo no es un PDF válido.',
  encrypted_pdf: 'El PDF está protegido con contraseña. Quita la protección y vuelve a subirlo.',
  rotated_page: 'La página del PDF está rotada. Exporta el PDF sin rotación e inténtalo de nuevo.',
  pdf_too_large: 'El PDF es demasiado grande (máximo 5 MB).',
  stamp_out_of_bounds: 'La tarjeta del QR no cabe con esos márgenes. Reduce los márgenes o el tamaño del QR.',
  invalid_stamp_options: 'Las opciones de posición del QR no son válidas.',
  permission_denied: 'Tu cuenta no está habilitada para emitir diplomas, o el emisor está suspendido.',
  unauthenticated: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

function describeError(err) {
  const details = (err && err.details) || {};
  const code = details.code;
  if (code === 'invalid_meta' && details.fields) {
    return 'Revisa los datos: ' + Object.keys(details.fields).map((k) => `${k} (${details.fields[k]})`).join(' · ');
  }
  if (FRIENDLY[code]) return FRIENDLY[code];
  return (err && err.message) || 'No se pudo registrar el diploma.';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('No pude leer el archivo.'));
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.readAsDataURL(file);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function show(sectionId) {
  ['#sec-login', '#sec-denied', '#sec-app'].forEach((s) => $(s).classList.toggle('hidden', s !== sectionId));
}

async function onUser(user) {
  if (!user) { show('#sec-login'); return; }
  const token = await user.getIdTokenResult(true);
  if (!token.claims || !token.claims.veritestIssuer) { show('#sec-denied'); return; }
  $('#issuer-id').textContent = token.claims.veritestIssuer;
  show('#sec-app');
}

function wireLogin() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#login-msg');
    clear(out);
    $('#login-btn').disabled = true;
    try {
      await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value);
    } catch (err) {
      out.appendChild(el('div', 'msg bad', 'No pudimos iniciar sesión. Revisa tu correo y contraseña.'));
    } finally {
      $('#login-btn').disabled = false;
    }
  });
  ['#logout', '#logout-denied'].forEach((s) => $(s).addEventListener('click', () => signOut(auth)));
}

function wireRegister() {
  const register = httpsCallable(functions, 'registerDiploma');
  const history = [];

  $('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#reg-result');
    clear(out);
    const file = $('#pdf').files[0];
    if (!file) { out.appendChild(el('div', 'msg warn', 'Elige un archivo PDF.')); return; }
    if (file.size > MAX_BYTES) { out.appendChild(el('div', 'msg warn', 'El PDF es demasiado grande (máximo 5 MB).')); return; }

    const btn = $('#reg-btn');
    btn.disabled = true;
    out.appendChild(el('div', 'msg info', 'Registrando y pegando el QR…'));
    try {
      const num = (sel) => { const v = $(sel).value; return v === '' ? undefined : Number(v); };
      const res = await register({
        pdfBase64: await fileToBase64(file),
        holderName: $('#holder').value,
        title: $('#title').value,
        folio: $('#folio').value,
        issuedOn: $('#issued').value,
        stamp: { corner: $('#corner').value, marginXmm: num('#mx'), marginYmm: num('#my'), qrMm: num('#qr') },
      });
      const data = res.data;
      const name = file.name.replace(/\.pdf$/i, '') + '-veritest.pdf';
      const url = URL.createObjectURL(base64ToBlob(data.stampedPdfBase64, 'application/pdf'));

      clear(out);
      out.appendChild(el('div', 'msg ok', 'Diploma registrado. Descarga el PDF sellado y revisa que el QR no tape nada.'));
      const a = el('a', 'btn', 'Descargar PDF sellado');
      a.href = url;
      a.download = name;
      out.appendChild(a);
      const link = el('p', 'small');
      link.appendChild(document.createTextNode('Página de verificación: '));
      const v = el('a', null, data.url);
      v.href = data.url;
      v.target = '_blank';
      v.rel = 'noopener noreferrer';
      link.appendChild(v);
      out.appendChild(link);

      history.unshift({ holder: $('#holder').value, url: data.url });
      renderHistory(history);
      $('#reg-form').reset();
    } catch (err) {
      clear(out);
      out.appendChild(el('div', 'msg bad', describeError(err)));
      if (err && err.details && err.details.existingId) {
        out.appendChild(el('p', 'small', 'Id del registro existente: ' + err.details.existingId));
      }
    } finally {
      btn.disabled = false;
    }
  });
}

function renderHistory(history) {
  const host = $('#history');
  clear(host);
  host.classList.toggle('hidden', !history.length);
  if (!history.length) return;
  host.appendChild(el('h2', null, 'Registrados en esta sesión'));
  const ol = el('ol', 'hist');
  history.forEach((h) => {
    const li = el('li');
    li.appendChild(document.createTextNode(h.holder + ' — '));
    const a = el('a', null, h.url);
    a.href = h.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.appendChild(a);
    ol.appendChild(li);
  });
  host.appendChild(ol);
}

wireLogin();
wireRegister();
onAuthStateChanged(auth, (u) => { onUser(u).catch(() => show('#sec-login')); });
