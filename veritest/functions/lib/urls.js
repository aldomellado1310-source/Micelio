// veritest/functions/lib/urls.js
//
// URL que codifica cada QR: <base>/v/<id>.
//
// La base es CONFIGURABLE (VERITEST_BASE_URL, por defecto https://veritest.cl)
// y no está escrita en el código de la página ni del sellador: un QR impreso
// no se puede corregir, así que el dominio que queda impreso tiene que ser el
// que de verdad se va a poseer y servir. Hasta que veritest.cl exista y esté
// apuntando a este hosting, NO se deben emitir diplomas reales -- los QR de
// prueba deben usar una base de prueba (por ejemplo http://localhost:5003).
'use strict';
const { VeritestError } = require('./errors.js');

const DEFAULT_BASE_URL = 'https://veritest.cl';

function resolveBaseUrl(raw) {
  const value = (raw === undefined || raw === null || raw === '') ? DEFAULT_BASE_URL : String(raw);
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    throw new VeritestError('invalid_base_url', `VERITEST_BASE_URL no es una URL válida: "${value}".`);
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new VeritestError('invalid_base_url', 'VERITEST_BASE_URL debe ser https (http solo se acepta en localhost).');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new VeritestError('invalid_base_url', 'VERITEST_BASE_URL debe ser solo el origen, sin ruta ni parámetros.');
  }
  return url.origin;
}

function verifyUrl(baseUrl, id) {
  return `${baseUrl}/v/${id}`;
}

module.exports = { DEFAULT_BASE_URL, resolveBaseUrl, verifyUrl };
