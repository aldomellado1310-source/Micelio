// veritest/tests/emulator.cjs
//
// Prueba contra los EMULADORES REALES de Firebase (Auth + Firestore + Functions +
// Hosting), no contra stubs: el index.js de verdad, tokens de Auth con custom
// claims de verdad, las transacciones de Firestore de verdad, firestore.rules
// de verdad y los rewrites de firebase.json de verdad.
//
// Lo que sigue SIN cubrir: Firebase en la nube (despliegue, IAM, Blaze, el
// dominio veritest.cl). Esto es el emulador local, no el proyecto real.
//
// Uso (desde veritest/, con firebase-tools instalado y JDK 21+):
//   firebase emulators:exec --only auth,firestore,functions,hosting \
//       --project demo-veritest "node tests/emulator.cjs"
'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

const ROOT = path.join(__dirname, '..');
const req = createRequire(path.join(ROOT, 'functions', 'index.js'));
const { initializeApp } = req('firebase-admin/app');
const { getAuth } = req('firebase-admin/auth');
const { getFirestore } = req('firebase-admin/firestore');
const { samplePdf } = require(path.join(ROOT, 'functions', 'testutil', 'sample-pdf.js'));
const { sha256Hex } = require(path.join(ROOT, 'functions', 'lib', 'hash.js'));

const PROJECT = 'demo-veritest';
const FN = `http://127.0.0.1:5002/${PROJECT}/southamerica-east1`;
const HOSTING = 'http://127.0.0.1:5003';
const AUTH = 'http://127.0.0.1:9098';
const FS = `http://127.0.0.1:8081/v1/projects/${PROJECT}/databases/(default)/documents`;

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.error('  FALLÓ', name, '\n       ', e.message); process.exitCode = 1; }
}

async function signIn(email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'clave-de-prueba', returnSecureToken: true }),
  });
  const j = await r.json();
  assert.ok(j.idToken, `no se pudo iniciar sesión como ${email}: ${JSON.stringify(j)}`);
  return j.idToken;
}

async function call(name, data, token) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: `Bearer ${token}` } : {}),
    body: JSON.stringify({ data }),
  });
  return { status: r.status, body: await r.json() };
}

const payload = async (over) => Object.assign({
  pdfBase64: (await samplePdf()).toString('base64'),
  holderName: 'Ana Pérez', title: 'Certificado de prueba', folio: 'EM-001', issuedOn: '2026-11-06',
}, over);

async function main() {
  initializeApp({ projectId: PROJECT });
  const auth = getAuth();
  const db = getFirestore();

  // ---- datos de partida ----
  await db.doc('issuers/samu-talcahuano').set({ name: 'SAMU SS Talcahuano', status: 'active' });
  await db.doc('issuers/suspendido').set({ name: 'Emisor suspendido', status: 'suspended' });
  const users = [
    ['emisor@ejemplo.cl', { veritestIssuer: 'samu-talcahuano' }],
    ['suspendido@ejemplo.cl', { veritestIssuer: 'suspendido' }],
    ['sinclaim@ejemplo.cl', {}],
    ['superadmin@ejemplo.cl', { admin: true, platformRole: 'superadmin' }],
  ];
  const uids = {};
  for (const [email, claims] of users) {
    const u = await auth.createUser({ email, password: 'clave-de-prueba' });
    if (Object.keys(claims).length) await auth.setCustomUserClaims(u.uid, claims);
    uids[email] = u.uid;
  }
  const tok = {};
  for (const [email] of users) tok[email] = await signIn(email);

  const original = await samplePdf({ name: 'Ana Pérez' });
  let reg;

  console.log('registerDiploma (callable real, con Auth real)');
  await step('un emisor habilitado registra un PDF: recibe el sellado, el id y la huella', async () => {
    const r = await call('registerDiploma', await payload({ pdfBase64: original.toString('base64') }), tok['emisor@ejemplo.cl']);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    reg = r.body.result;
    assert.match(reg.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(reg.url, `https://veritest.cl/v/${reg.id}`);
    const stamped = Buffer.from(reg.stampedPdfBase64, 'base64');
    assert.equal(stamped.subarray(0, 5).toString(), '%PDF-');
    assert.equal(sha256Hex(stamped), reg.stampedSha256);
    assert.notEqual(reg.stampedSha256, sha256Hex(original));
  });

  await step('sin sesión: UNAUTHENTICATED y no se escribe nada', async () => {
    const before = (await db.collection('diplomas').get()).size;
    const r = await call('registerDiploma', await payload());
    assert.equal(r.status, 401, JSON.stringify(r.body));
    assert.equal(r.body.error.status, 'UNAUTHENTICATED');
    assert.equal((await db.collection('diplomas').get()).size, before);
  });

  await step('con sesión pero sin claim de emisor, o solo superadmin/admin de OTRO producto: PERMISSION_DENIED', async () => {
    for (const email of ['sinclaim@ejemplo.cl', 'superadmin@ejemplo.cl']) {
      const r = await call('registerDiploma', await payload(), tok[email]);
      assert.equal(r.status, 403, `${email}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error.status, 'PERMISSION_DENIED');
    }
  });

  await step('un emisor SUSPENDIDO no puede registrar diplomas nuevos', async () => {
    const r = await call('registerDiploma', await payload(), tok['suspendido@ejemplo.cl']);
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.match(r.body.error.message, /suspendido/);
  });

  await step('el emisor y quien registra salen del token, no del payload (suplantación ignorada)', async () => {
    const r = await call('registerDiploma', await payload({
      pdfBase64: (await samplePdf({ name: 'Suplantación' })).toString('base64'),
      issuerId: 'suspendido', issuerName: 'Falso', registeredBy: 'uid-falso',
    }), tok['emisor@ejemplo.cl']);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const doc = (await db.doc(`diplomas/${r.body.result.id}`).get()).data();
    assert.equal(doc.issuerId, 'samu-talcahuano');
    assert.equal(doc.issuerName, 'SAMU SS Talcahuano');
    assert.equal(doc.registeredBy, uids['emisor@ejemplo.cl']);
  });

  await step('registrar el mismo PDF otra vez: ALREADY_EXISTS con el id existente', async () => {
    const r = await call('registerDiploma', await payload({ pdfBase64: original.toString('base64') }), tok['emisor@ejemplo.cl']);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.status, 'ALREADY_EXISTS');
    assert.equal(r.body.error.details.existingId, reg.id);
  });

  await step('datos inválidos: INVALID_ARGUMENT con el detalle por campo', async () => {
    const r = await call('registerDiploma', await payload({ holderName: '', issuedOn: '2026-02-30' }), tok['emisor@ejemplo.cl']);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.error.status, 'INVALID_ARGUMENT');
    assert.ok(r.body.error.details.fields.holderName && r.body.error.details.fields.issuedOn);
  });

  await step('CONCURRENCIA real: el mismo PDF registrado 4 veces a la vez deja UN solo registro', async () => {
    const pdf = (await samplePdf({ name: 'Concurrente' })).toString('base64');
    const before = (await db.collection('diplomas').get()).size;
    const rs = await Promise.all([1, 2, 3, 4].map(async () => call('registerDiploma', await payload({ pdfBase64: pdf }), tok['emisor@ejemplo.cl'])));
    const ok = rs.filter((r) => r.status === 200);
    const dup = rs.filter((r) => r.status === 409);
    assert.equal(ok.length, 1, JSON.stringify(rs.map((r) => r.status)));
    assert.equal(dup.length, 3);
    assert.equal((await db.collection('diplomas').get()).size, before + 1);
    // y el índice de huellas quedó consistente (original + sellada, ambas apuntan al mismo id)
    const id = ok[0].body.result.id;
    const rec = (await db.doc(`diplomas/${id}`).get()).data();
    assert.equal((await db.doc(`hashes/${rec.originalSha256}`).get()).data().id, id);
    assert.equal((await db.doc(`hashes/${rec.stampedSha256}`).get()).data().id, id);
  });

  await step('la TRANSACCIÓN de Firestore rechaza huellas repetidas aun sin el chequeo previo (carrera directa al almacén)', async () => {
    // El chequeo previo de registerPdf atrapa casi todos los duplicados antes de
    // que haya carrera; esta prueba va directo a insert() para ejercitar la
    // barrera que de verdad importa: la transacción.
    const { createFirestoreStore } = require(path.join(ROOT, 'functions', 'lib', 'stores.js'));
    const { newVerificationId } = require(path.join(ROOT, 'functions', 'lib', 'ids.js'));
    const store = createFirestoreStore(db);
    const shared = sha256Hex(Buffer.from('mismo-original-en-carrera'));
    const mk = (n) => ({
      schemaVersion: 1, id: newVerificationId(), status: 'valid', source: 'imported',
      issuerId: 'samu-talcahuano', issuerName: 'SAMU SS Talcahuano', holderName: `Carrera ${n}`,
      title: 'T', folio: null, issuedOn: null, originalSha256: shared,
      stampedSha256: sha256Hex(Buffer.from(`sellado-en-carrera-${n}`)),
      registeredAt: new Date().toISOString(), registeredBy: 'u',
    });
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => store.insert(mk(n))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(results.map((r) => r.status)));
    for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.code, 'already_registered', String(r.reason));
    const snap = await db.collection('diplomas').where('originalSha256', '==', shared).get();
    assert.equal(snap.size, 1);
  });

  console.log('verify (función real detrás del rewrite de Hosting de firebase.json)');
  await step('/api/verify?id= devuelve la vista pública, sin huellas ni uid, y no se cachea', async () => {
    const r = await fetch(`${HOSTING}/api/verify?id=${reg.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const text = await r.text();
    const body = JSON.parse(text);
    assert.equal(body.found, true);
    assert.equal(body.holderName, 'Ana Pérez');
    assert.equal(body.issuerName, 'SAMU SS Talcahuano');
    assert.equal(body.status, 'valid');
    assert.equal(text.includes(reg.stampedSha256), false);
    assert.equal(text.includes(uids['emisor@ejemplo.cl']), false);
  });

  await step('/api/verify?hash= reconoce el PDF sellado y el original, y distingue cuál es cuál', async () => {
    const s = await (await fetch(`${HOSTING}/api/verify?hash=${reg.stampedSha256}`)).json();
    assert.equal(s.id, reg.id); assert.equal(s.matched, 'stamped');
    const o = await (await fetch(`${HOSTING}/api/verify?hash=${sha256Hex(original)}`)).json();
    assert.equal(o.id, reg.id); assert.equal(o.matched, 'original');
  });

  await step('inexistente: 404; formato inválido o sin consulta: 400; otro método: 405', async () => {
    assert.equal((await fetch(`${HOSTING}/api/verify?id=${'A'.repeat(22)}`)).status, 404);
    assert.equal((await fetch(`${HOSTING}/api/verify?hash=${'a'.repeat(64)}`)).status, 404);
    assert.equal((await fetch(`${HOSTING}/api/verify?id=EM-001`)).status, 400);
    assert.equal((await fetch(`${HOSTING}/api/verify?hash=xyz`)).status, 400);
    assert.equal((await fetch(`${HOSTING}/api/verify`)).status, 400);
    assert.equal((await fetch(`${HOSTING}/api/verify?id=${reg.id}`, { method: 'POST' })).status, 405);
  });

  await step('/v/<id> sirve la página de verificación (rewrite) con las cabeceras de seguridad', async () => {
    const r = await fetch(`${HOSTING}/v/${reg.id}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /Veritest/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  });

  console.log('firestore.rules (reglas reales: ningún acceso de cliente)');
  await step('con un token de emisor, el cliente NO puede leer ni listar ni escribir diplomas, huellas ni emisores', async () => {
    const h = { authorization: `Bearer ${tok['emisor@ejemplo.cl']}`, 'content-type': 'application/json' };
    const rec = (await db.doc(`diplomas/${reg.id}`).get()).data();
    for (const p of [`diplomas/${reg.id}`, `hashes/${rec.stampedSha256}`, 'issuers/samu-talcahuano', 'diplomas', 'issuers']) {
      const r = await fetch(`${FS}/${p}`, { headers: h });
      assert.equal(r.status, 403, `leer ${p} debería estar prohibido, dio ${r.status}`);
    }
    const w1 = await fetch(`${FS}/diplomas/falso123`, { method: 'PATCH', headers: h, body: JSON.stringify({ fields: { holderName: { stringValue: 'Falso' } } }) });
    assert.equal(w1.status, 403);
    const w2 = await fetch(`${FS}/diplomas/${reg.id}`, { method: 'DELETE', headers: h });
    assert.equal(w2.status, 403);
    assert.equal((await db.doc('diplomas/falso123').get()).exists, false);
    assert.equal((await db.doc(`diplomas/${reg.id}`).get()).exists, true);
  });

  await step('anónimo tampoco; y la prueba es válida: con el bypass de propietario del emulador SÍ se lee', async () => {
    assert.equal((await fetch(`${FS}/diplomas/${reg.id}`)).status, 403);
    assert.equal((await fetch(`${FS}/diplomas/${reg.id}`, { headers: { authorization: 'Bearer owner' } })).status, 200);
  });

  console.log(`\n${passed} pasos OK${process.exitCode ? ' -- HAY FALLOS' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
