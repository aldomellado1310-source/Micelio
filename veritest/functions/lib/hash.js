// veritest/functions/lib/hash.js
//
// Huella SHA-256 de un PDF, en hex minúscula. Es lo que permite verificar
// "este archivo exacto" (además del QR, que solo prueba que el id existe).
// El navegador calcula la misma huella con crypto.subtle (public/js/verify.js)
// y manda SOLO la huella al servidor -- el PDF nunca sale del computador de
// quien verifica.
'use strict';
const crypto = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/;

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isValidSha256Hex(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

module.exports = { sha256Hex, isValidSha256Hex };
