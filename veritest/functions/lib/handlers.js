// veritest/functions/lib/handlers.js
//
// Lógica de las dos funciones públicas, sin Firebase: reciben el request ya
// reducido a datos simples y un `store`, devuelven datos simples. index.js
// solo traduce a onRequest/onCall; los tests y el servidor de pruebas
// end-to-end (tests/e2e.mjs) llaman estas mismas funciones.
'use strict';
const { VeritestError } = require('./errors.js');
const { isValidVerificationId } = require('./ids.js');
const { isValidSha256Hex } = require('./hash.js');
const { registerPdf, verifyById, verifyByHash, MAX_PDF_BYTES } = require('./diploma.js');

// GET /api/verify?id=<id>  |  /api/verify?hash=<sha256 hex>
// La verificación FALLA CERRADA: ante cualquier error el cliente recibe un
// error, jamás un "válido" por omisión (al revés que el widget de reservas,
// que falla abierto -- verificar con datos incompletos sería peor que no
// verificar).
async function handleVerify(query, store) {
  const q = query || {};
  if (q.id !== undefined) {
    if (!isValidVerificationId(q.id)) return { status: 400, body: { error: 'invalid_id' } };
    const r = await verifyById(store, q.id);
    return { status: r.found ? 200 : 404, body: r };
  }
  if (q.hash !== undefined) {
    const hash = String(q.hash).toLowerCase();
    if (!isValidSha256Hex(hash)) return { status: 400, body: { error: 'invalid_hash' } };
    const r = await verifyByHash(store, hash);
    return { status: r.found ? 200 : 404, body: r };
  }
  return { status: 400, body: { error: 'missing_query' } };
}

// data: { pdfBase64, holderName, title, folio?, issuedOn?, stamp? }
// issuer y actorUid los resuelve index.js desde el token -- NUNCA del payload.
async function handleRegister(params) {
  const { data, issuer, actorUid, store, baseUrl, now } = params;
  const d = data && typeof data === 'object' ? data : {};
  if (typeof d.pdfBase64 !== 'string' || !d.pdfBase64) {
    throw new VeritestError('invalid_pdf', 'Falta el PDF (pdfBase64).');
  }
  // Tope ANTES de decodificar: base64 infla 4/3, no asignar memoria a ciegas.
  if (d.pdfBase64.length > Math.ceil(MAX_PDF_BYTES * 4 / 3) + 8) {
    throw new VeritestError('pdf_too_large', 'El PDF supera el tamaño máximo.');
  }
  const pdf = Buffer.from(d.pdfBase64, 'base64');
  const result = await registerPdf({
    pdf,
    meta: { holderName: d.holderName, title: d.title, folio: d.folio, issuedOn: d.issuedOn },
    issuer, actorUid, store, baseUrl, now,
    stamp: d.stamp,
    source: 'imported',
  });
  return {
    id: result.record.id,
    url: result.url,
    stampedPdfBase64: result.pdf.toString('base64'),
    stampedSha256: result.record.stampedSha256,
  };
}

module.exports = { handleVerify, handleRegister };
