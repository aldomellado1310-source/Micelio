// veritest/functions/lib/ids.js
//
// Identificador de verificación: lo que va dentro del QR (/v/<id>).
//
// DECISIÓN: 16 bytes aleatorios (128 bits) en base64url = 22 caracteres. NO
// es el folio del emisor (EJ-A-001): un folio correlativo permitiría
// recorrer los diplomas de otras personas probando números. Con 128 bits de
// entropía de crypto.randomBytes, adivinar un id válido es inviable, así que
// la página pública de verificación no necesita ningún otro control de
// acceso para no ser enumerable.
'use strict';
const crypto = require('node:crypto');

const ID_BYTES = 16;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

function newVerificationId() {
  return crypto.randomBytes(ID_BYTES).toString('base64url');
}

function isValidVerificationId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

module.exports = { newVerificationId, isValidVerificationId, ID_BYTES };
