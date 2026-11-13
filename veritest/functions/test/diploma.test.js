'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPdf, validateDiplomaMeta, verifyById, verifyByHash, toPublicView } = require('../lib/diploma.js');
const { createMemoryStore } = require('../lib/stores.js');
const { sha256Hex } = require('../lib/hash.js');
const { isValidVerificationId } = require('../lib/ids.js');
const { samplePdf } = require('../testutil/sample-pdf.js');

const ISSUER = { id: 'samu-talcahuano', name: 'SAMU SS Talcahuano' };
const META = { holderName: 'Marta Soto Ñuñez', title: 'Certificado de participación — Jornadas Académicas', folio: 'EJ-A-001', issuedOn: '2026-11-06' };
const BASE = 'https://veritest.cl';

function reg(over) {
  return registerPdf(Object.assign({
    pdf: null, meta: META, issuer: ISSUER, actorUid: 'uid-1', store: null, baseUrl: BASE,
  }, over));
}

test('validateDiplomaMeta normaliza texto y quita caracteres de control/bidi', () => {
  const v = validateDiplomaMeta({ holderName: '  Ana‮   Pérez\u0000 ', title: 'Curso\tX', folio: ' F-1 ', issuedOn: ' 2026-02-28 ' });
  assert.deepEqual(v, { holderName: 'Ana Pérez', title: 'Curso X', folio: 'F-1', issuedOn: '2026-02-28' });
});

test('validateDiplomaMeta: folio y fecha son opcionales; devuelve null', () => {
  const v = validateDiplomaMeta({ holderName: 'Ana Pérez', title: 'Curso X' });
  assert.equal(v.folio, null);
  assert.equal(v.issuedOn, null);
});

test('validateDiplomaMeta reporta TODOS los campos inválidos a la vez', () => {
  assert.throws(
    () => validateDiplomaMeta({ holderName: 'A', title: '', folio: '<script>', issuedOn: '2026-02-30' }),
    (e) => e.code === 'invalid_meta' && ['holderName', 'title', 'folio', 'issuedOn'].every((k) => e.details.fields[k])
  );
  assert.throws(() => validateDiplomaMeta(null), (e) => e.code === 'invalid_meta');
});

test('registerPdf: sella, guarda el registro y devuelve el PDF distinto del original', async () => {
  const store = createMemoryStore();
  const pdf = await samplePdf();
  const now = new Date('2026-11-13T12:00:00Z');
  const r = await reg({ pdf, store, now });

  assert.ok(isValidVerificationId(r.record.id));
  assert.equal(r.url, `${BASE}/v/${r.record.id}`);
  assert.equal(r.record.originalSha256, sha256Hex(pdf));
  assert.equal(r.record.stampedSha256, sha256Hex(r.pdf));
  assert.notEqual(r.record.originalSha256, r.record.stampedSha256);
  assert.equal(r.record.registeredAt, '2026-11-13T12:00:00.000Z');
  assert.equal(r.record.registeredBy, 'uid-1');
  assert.equal(r.record.issuerId, ISSUER.id);
  assert.equal(r.record.status, 'valid');
  assert.equal(r.record.source, 'imported');
  assert.deepEqual(await store.getById(r.record.id), r.record);
});

test('registerPdf rechaza registrar dos veces el mismo PDF original', async () => {
  const store = createMemoryStore();
  const pdf = await samplePdf();
  const first = await reg({ pdf, store });
  await assert.rejects(
    reg({ pdf, store }),
    (e) => e.code === 'already_registered' && e.details.existingId === first.record.id && e.details.matched === 'original'
  );
});

test('registerPdf rechaza volver a registrar un PDF que YA es la versión sellada (no se sella dos veces)', async () => {
  const store = createMemoryStore();
  const first = await reg({ pdf: await samplePdf(), store });
  await assert.rejects(
    reg({ pdf: first.pdf, store }),
    (e) => e.code === 'already_registered' && e.details.existingId === first.record.id && e.details.matched === 'stamped'
  );
  assert.equal(store.all().length, 1);
});

test('registerPdf no guarda nada si el PDF o los datos son inválidos', async () => {
  const store = createMemoryStore();
  await assert.rejects(reg({ pdf: Buffer.from('hola'), store }), (e) => e.code === 'invalid_pdf');
  await assert.rejects(reg({ pdf: Buffer.alloc(0), store }), (e) => e.code === 'invalid_pdf');
  await assert.rejects(reg({ pdf: Buffer.alloc(5 * 1024 * 1024 + 1, 1), store }), (e) => e.code === 'pdf_too_large');
  await assert.rejects(reg({ pdf: await samplePdf(), store, meta: { holderName: '', title: '' } }), (e) => e.code === 'invalid_meta');
  await assert.rejects(reg({ pdf: await samplePdf({ rotate: 90 }), store }), (e) => e.code === 'rotated_page');
  await assert.rejects(reg({ pdf: await samplePdf(), store, issuer: null }), (e) => e.code === 'invalid_issuer');
  assert.equal(store.all().length, 0);
});

test('verifyById / verifyByHash: encuentran, distinguen original de sellado y no filtran campos internos', async () => {
  const store = createMemoryStore();
  const pdf = await samplePdf();
  const r = await reg({ pdf, store });

  const byId = await verifyById(store, r.record.id);
  assert.equal(byId.found, true);
  assert.equal(byId.holderName, META.holderName);
  assert.equal(byId.issuerName, ISSUER.name);
  assert.equal(byId.matched, null);

  const stamped = await verifyByHash(store, r.record.stampedSha256);
  assert.equal(stamped.id, r.record.id);
  assert.equal(stamped.matched, 'stamped');
  const original = await verifyByHash(store, r.record.originalSha256);
  assert.equal(original.id, r.record.id);
  assert.equal(original.matched, 'original');

  // Vista pública: solo estos campos, ninguna huella ni uid.
  assert.deepEqual(
    Object.keys(byId).sort(),
    ['folio', 'found', 'holderName', 'id', 'issuedOn', 'issuerName', 'matched', 'registeredAt', 'status', 'title']
  );
  const dump = JSON.stringify([byId, stamped, original]);
  assert.equal(dump.includes(r.record.originalSha256), false);
  assert.equal(dump.includes(r.record.stampedSha256), false);
  assert.equal(dump.includes('uid-1'), false);
});

test('verifyById / verifyByHash devuelven found:false si no existe', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await verifyById(store, 'A'.repeat(22)), { found: false });
  assert.deepEqual(await verifyByHash(store, 'a'.repeat(64)), { found: false });
});

test('un PDF distinto (aunque tenga el mismo texto) no coincide por huella', async () => {
  const store = createMemoryStore();
  const r = await reg({ pdf: await samplePdf({ name: 'Ana Pérez' }), store });
  const forged = await samplePdf({ name: 'Ana Pérez', seed: 'adulterado' });
  assert.deepEqual(await verifyByHash(store, sha256Hex(forged)), { found: false });
  assert.equal((await verifyById(store, r.record.id)).found, true);
});

test('toPublicView conserva el status para poder mostrar registros no vigentes', () => {
  const v = toPublicView({ id: 'x', status: 'revoked', holderName: 'A B', title: 'T', issuerName: 'E', registeredAt: 'z' });
  assert.equal(v.status, 'revoked');
});
