// veritest/functions/scripts/setIssuer.js
//
// Habilita a una cuenta de Firebase Auth como EMISOR de diplomas: crea (o
// reactiva) issuers/{issuerId} y le pone a la cuenta el custom claim
// { veritestIssuer: '<issuerId>' }. Es la única forma de dar ese permiso --
// ningún callable lo otorga --, mismo patrón que setPlatformRole.js del
// sistema de reservas: se corre a mano, fuera de la app, con credenciales
// reales del proyecto. Hace MERGE de claims, nunca overwrite.
//
// Requisitos (una de las dos):
//   a) gcloud auth application-default login
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
//
// Uso:
//   cd veritest/functions
//   node scripts/setIssuer.js --project <proyecto-veritest> \
//        --email persona@dominio.cl --issuer samu-talcahuano --name "SAMU SS Talcahuano"
//
// Tras ejecutarlo, la persona debe cerrar sesión y volver a entrar para que el
// claim tome efecto.
'use strict';
const { parseArgs } = require('node:util');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { assertVeritestProject } = require('./_guard.js');
const { isValidIssuerId, mergeIssuerClaim } = require('../lib/issuer.js');

async function main() {
  const { values } = parseArgs({
    options: { project: { type: 'string' }, email: { type: 'string' }, issuer: { type: 'string' }, name: { type: 'string' } },
  });
  const project = assertVeritestProject(values.project);
  if (!values.email || !values.name) throw new Error('Faltan --email y/o --name.');
  if (!isValidIssuerId(values.issuer)) throw new Error('--issuer debe ser un id en minúsculas (letras, números y guiones, 2 a 39 caracteres).');

  initializeApp({ credential: applicationDefault(), projectId: project });
  const auth = getAuth();
  const db = getFirestore();

  const user = await auth.getUserByEmail(values.email);
  const ref = db.doc(`issuers/${values.issuer}`);
  const snap = await ref.get();
  await ref.set(
    snap.exists
      ? { name: values.name, status: 'active' }
      : { name: values.name, status: 'active', createdAt: new Date().toISOString() },
    { merge: true }
  );
  await auth.setCustomUserClaims(user.uid, mergeIssuerClaim(user.customClaims, values.issuer));
  console.log(`OK: ${values.email} (${user.uid}) habilitado como emisor "${values.issuer}" en ${project}. Debe volver a iniciar sesión.`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
