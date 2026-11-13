// veritest/functions/lib/diploma.js
//
// Capa de servicio de Veritest: validar los datos de un diploma, registrarlo
// (sellando el PDF con su QR) y producir la vista PÚBLICA para verificarlo.
// No sabe de Firebase -- recibe un `store` (stores.js) --, así que el mismo
// código lo usan el callable, el CLI y los tests.
//
// MODELO DE CONFIANZA (leer antes de tocar):
//   * Veritest solo puede verificar lo que un emisor AUTENTICADO registró.
//     No detecta diplomas falsificados que nadie registró.
//   * El QR prueba que "existe un registro con este id", no que ESTE
//     documento sea ese registro: alguien podría copiar un QR válido sobre un
//     diploma falso. Por eso la página muestra nombre/título/emisor para
//     compararlos con el papel, y por eso existe la verificación por huella
//     SHA-256 del archivo (byte a byte).
//   * Se guardan DOS huellas: la del PDF tal como llegó (originalSha256) y la
//     del PDF ya sellado que se entregó (stampedSha256). El sellado cambia
//     los bytes, así que sin las dos no se podría reconocer ni el original ni
//     la versión oficial.
//   * El PDF en sí NO se guarda -- solo huellas y los datos que el diploma ya
//     muestra impresos.
'use strict';
const { VeritestError } = require('./errors.js');
const { sha256Hex } = require('./hash.js');
const { newVerificationId } = require('./ids.js');
const { verifyUrl } = require('./urls.js');
const { stampPdf } = require('./stamp.js');

const SCHEMA_VERSION = 1;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const SOURCES = ['imported', 'generated'];

// Quita caracteres de control y de formato Unicode (incluye los de
// reordenamiento bidireccional, que sirven para suplantar texto) y colapsa
// espacios.
function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function isRealDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validateDiplomaMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const errors = {};
  const holderName = cleanText(m.holderName);
  const title = cleanText(m.title);
  const folio = cleanText(m.folio);
  const issuedOn = typeof m.issuedOn === 'string' ? m.issuedOn.trim() : '';

  if (holderName.length < 2 || holderName.length > 160) errors.holderName = 'Obligatorio, entre 2 y 160 caracteres.';
  if (title.length < 2 || title.length > 200) errors.title = 'Obligatorio, entre 2 y 200 caracteres.';
  if (folio && (folio.length > 40 || !/^[\p{L}\p{N} ._\-/#]+$/u.test(folio))) {
    errors.folio = 'Máximo 40 caracteres: letras, números y . _ - / #';
  }
  if (issuedOn && !isRealDate(issuedOn)) errors.issuedOn = 'Debe ser una fecha real con formato AAAA-MM-DD.';

  if (Object.keys(errors).length) {
    throw new VeritestError('invalid_meta', 'Hay datos del diploma inválidos.', { fields: errors });
  }
  return { holderName, title, folio: folio || null, issuedOn: issuedOn || null };
}

function assertPdfBuffer(pdf) {
  if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
    throw new VeritestError('invalid_pdf', 'No se recibió ningún archivo.');
  }
  if (pdf.length > MAX_PDF_BYTES) {
    throw new VeritestError('pdf_too_large', `El PDF supera el máximo de ${MAX_PDF_BYTES / (1024 * 1024)} MB.`);
  }
  // Los PDF empiezan con "%PDF-" (puede haber basura corta antes, pero
  // cualquier lector real la tolera solo en el primer KB).
  if (pdf.subarray(0, 1024).indexOf('%PDF-') === -1) {
    throw new VeritestError('invalid_pdf', 'El archivo no es un PDF.');
  }
}

// Registra un PDF: valida, rechaza duplicados, genera el id, lo sella y
// guarda el registro. Devuelve el PDF sellado (lo que se entrega) y el
// registro.
async function registerPdf(params) {
  const {
    pdf, meta, issuer, actorUid, store, baseUrl,
    stamp, source, now, newId,
  } = params;
  if (!issuer || !issuer.id || !issuer.name) throw new VeritestError('invalid_issuer', 'Falta el emisor.');
  if (SOURCES.indexOf(source || 'imported') === -1) throw new VeritestError('invalid_source', 'source inválido.');

  assertPdfBuffer(pdf);
  const value = validateDiplomaMeta(meta);

  const originalSha256 = sha256Hex(pdf);
  const dup = await store.getByHash(originalSha256);
  if (dup) {
    throw new VeritestError(
      'already_registered',
      'Este PDF ya está registrado en Veritest.',
      { existingId: dup.record.id, matched: dup.matched }
    );
  }

  const id = (newId || newVerificationId)();
  const url = verifyUrl(baseUrl, id);
  const stamped = await stampPdf(pdf, { url, id, options: stamp });
  const stampedSha256 = sha256Hex(stamped);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    id,
    status: 'valid',
    source: source || 'imported',
    issuerId: issuer.id,
    issuerName: issuer.name,
    holderName: value.holderName,
    title: value.title,
    folio: value.folio,
    issuedOn: value.issuedOn,
    originalSha256,
    stampedSha256,
    registeredAt: (now || new Date()).toISOString(),
    registeredBy: actorUid || null,
  };
  await store.insert(record);

  return { record, pdf: stamped, url };
}

// Vista PÚBLICA: solo lo que el diploma ya muestra impreso + quién lo
// registró. Nunca huellas, uid de quien registró ni campos internos.
function toPublicView(record, matched) {
  return {
    found: true,
    id: record.id,
    status: record.status,
    holderName: record.holderName,
    title: record.title,
    folio: record.folio || null,
    issuedOn: record.issuedOn || null,
    issuerName: record.issuerName,
    registeredAt: record.registeredAt,
    matched: matched || null,
  };
}

async function verifyById(store, id) {
  const record = await store.getById(id);
  return record ? toPublicView(record, null) : { found: false };
}

async function verifyByHash(store, sha256) {
  const hit = await store.getByHash(sha256);
  return hit ? toPublicView(hit.record, hit.matched) : { found: false };
}

module.exports = {
  registerPdf, validateDiplomaMeta, toPublicView, verifyById, verifyByHash, cleanText,
  MAX_PDF_BYTES, SCHEMA_VERSION,
};
