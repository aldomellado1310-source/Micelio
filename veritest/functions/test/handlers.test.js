'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleVerify, handleRegister } = require('../lib/handlers.js');
const { resolveIssuer, mergeIssuerClaim, isValidIssuerId } = require('../lib/issuer.js');
const { createMemoryStore } = require('../lib/stores.js');
const { sha256Hex } = require('../lib/hash.js');
const { samplePdf } = require('../testutil/sample-pdf.js');

const ISSUER = { id: 'samu-talcahuano', name: 'SAMU SS Talcahuano', uid: 'uid-1' };
const BASE = 'https://veritest.cl';

async function payload(over) {
  const pdf = await samplePdf();
  return Object.assign({ pdfBase64: pdf.toString('base64'), holderName: 'Ana Pérez', title: 'Curso de prueba', folio: 'F-1', issuedOn: '2026-11-06' }, over);
}

test('registrar → verificar por id y por huella (flujo completo del callable + la función pública)', async () => {
  const store = createMemoryStore();
  const out = await handleRegister({ data: await payload(), issuer: ISSUER, actorUid: ISSUER.uid, store, baseUrl: BASE });
  assert.equal(out.url, `${BASE}/v/${out.id}`);
  assert.equal(sha256Hex(Buffer.from(out.stampedPdfBase64, 'base64')), out.stampedSha256);

  const byId = await handleVerify({ id: out.id }, store);
  assert.equal(byId.status, 200);
  assert.equal(byId.body.holderName, 'Ana Pérez');
  assert.equal(byId.body.issuerName, ISSUER.name);

  const byHash = await handleVerify({ hash: out.stampedSha256.toUpperCase() }, store); // mayúsculas toleradas
  assert.equal(byHash.status, 200);
  assert.equal(byHash.body.id, out.id);
  assert.equal(byHash.body.matched, 'stamped');
});

test('el emisor registrado sale del parámetro del servidor, NUNCA del payload', async () => {
  const store = createMemoryStore();
  const out = await handleRegister({
    data: await payload({ issuerId: 'otro-emisor', issuerName: 'Suplantado', registeredBy: 'uid-falso' }),
    issuer: ISSUER, actorUid: ISSUER.uid, store, baseUrl: BASE,
  });
  const rec = await store.getById(out.id);
  assert.equal(rec.issuerId, ISSUER.id);
  assert.equal(rec.issuerName, ISSUER.name);
  assert.equal(rec.registeredBy, 'uid-1');
});

test('handleRegister: opciones de sellado del payload se validan; el resto del payload se ignora', async () => {
  const store = createMemoryStore();
  await handleRegister({ data: await payload({ stamp: { corner: 'tr', marginXmm: 22, marginYmm: 41, qrMm: 17 } }), issuer: ISSUER, actorUid: 'u', store, baseUrl: BASE });
  await assert.rejects(
    handleRegister({ data: await payload({ stamp: { corner: 'arriba' } }), issuer: ISSUER, actorUid: 'u', store, baseUrl: BASE }),
    (e) => e.code === 'invalid_stamp_options'
  );
});

test('handleRegister rechaza falta de PDF y archivos demasiado grandes antes de decodificar', async () => {
  const store = createMemoryStore();
  const args = { issuer: ISSUER, actorUid: 'u', store, baseUrl: BASE };
  await assert.rejects(handleRegister({ ...args, data: {} }), (e) => e.code === 'invalid_pdf');
  await assert.rejects(handleRegister({ ...args, data: null }), (e) => e.code === 'invalid_pdf');
  await assert.rejects(handleRegister({ ...args, data: { pdfBase64: 'A'.repeat(8 * 1024 * 1024) } }), (e) => e.code === 'pdf_too_large');
});

test('handleVerify: 400 si el id/huella tienen formato inválido o falta la consulta; 404 si no existe', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await handleVerify({}, store), { status: 400, body: { error: 'missing_query' } });
  assert.deepEqual(await handleVerify(undefined, store), { status: 400, body: { error: 'missing_query' } });
  assert.deepEqual(await handleVerify({ id: 'EJ-A-001' }, store), { status: 400, body: { error: 'invalid_id' } });
  assert.deepEqual(await handleVerify({ id: ['a', 'b'] }, store), { status: 400, body: { error: 'invalid_id' } });
  assert.deepEqual(await handleVerify({ hash: 'xyz' }, store), { status: 400, body: { error: 'invalid_hash' } });
  assert.deepEqual(await handleVerify({ id: 'A'.repeat(22) }, store), { status: 404, body: { found: false } });
  assert.deepEqual(await handleVerify({ hash: 'a'.repeat(64) }, store), { status: 404, body: { found: false } });
});

test('handleVerify falla cerrado: si el store revienta, la excepción sube (index.js responde 500, jamás "válido")', async () => {
  const broken = { getById: async () => { throw new Error('firestore caído'); }, getByHash: async () => { throw new Error('firestore caído'); } };
  await assert.rejects(handleVerify({ id: 'A'.repeat(22) }, broken), /firestore caído/);
  await assert.rejects(handleVerify({ hash: 'a'.repeat(64) }, broken), /firestore caído/);
});

// ---- quién puede registrar ----
function dbWithIssuers(issuers) {
  return { doc: (p) => ({ get: async () => { const d = issuers[p.replace('issuers/', '')]; return { exists: !!d, data: () => d }; } }) };
}

test('resolveIssuer: exige sesión, claim válido y emisor activo', async () => {
  const db = dbWithIssuers({ 'samu-talcahuano': { name: 'SAMU', status: 'active' }, suspendido: { name: 'X', status: 'suspended' } });
  const tok = (issuer) => ({ uid: 'u1', token: { veritestIssuer: issuer } });

  assert.deepEqual(await resolveIssuer(tok('samu-talcahuano'), db), { id: 'samu-talcahuano', name: 'SAMU', uid: 'u1' });
  await assert.rejects(resolveIssuer(null, db), (e) => e.code === 'unauthenticated');
  await assert.rejects(resolveIssuer({ uid: '' }, db), (e) => e.code === 'unauthenticated');
  await assert.rejects(resolveIssuer({ uid: 'u1', token: {} }, db), (e) => e.code === 'permission_denied');
  await assert.rejects(resolveIssuer({ uid: 'u1', token: { admin: true, platformRole: 'superadmin' } }, db), (e) => e.code === 'permission_denied');
  await assert.rejects(resolveIssuer(tok('../../diplomas'), db), (e) => e.code === 'permission_denied');
  await assert.rejects(resolveIssuer(tok('suspendido'), db), (e) => e.code === 'permission_denied');
  await assert.rejects(resolveIssuer(tok('no-existe'), db), (e) => e.code === 'permission_denied');
});

test('mergeIssuerClaim agrega el claim sin pisar los que ya existían', () => {
  assert.deepEqual(mergeIssuerClaim({ admin: true, tenantId: 't1' }, 'samu'), { admin: true, tenantId: 't1', veritestIssuer: 'samu' });
  assert.deepEqual(mergeIssuerClaim(undefined, 'samu'), { veritestIssuer: 'samu' });
});

test('isValidIssuerId', () => {
  for (const ok of ['samu', 'samu-talcahuano', 'a1']) assert.ok(isValidIssuerId(ok), ok);
  for (const bad of ['', 'A', 'x', '-samu', 'sa mu', 'sa/mu', 'S'.repeat(3), 'a'.repeat(40), null]) assert.equal(isValidIssuerId(bad), false, String(bad));
});
