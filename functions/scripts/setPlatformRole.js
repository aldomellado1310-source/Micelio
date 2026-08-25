// functions/scripts/setPlatformRole.js
//
// Asigna el custom claim { platformRole: 'superadmin' } a una cuenta de
// Firebase Auth EN EL PROYECTO registrago001 (la plataforma Micelio -- ver
// README.md#Contexto:-Micelio, proyecto separado de scissor-white a
// propósito). Es el ÚNICO mecanismo para crear el PRIMER superadmin: el
// callable setPlatformRole (functions/platformRole.js) exige que quien lo
// invoque YA sea superadmin, así que no hay ningún camino de app para
// otorgarse este rol la primera vez -- tiene que ser este script, corrido a
// mano por alguien con credenciales reales del proyecto.
//
// A diferencia de functions/scripts/setAdminClaim.js (que targetea
// scissor-white y sobreescribe los claims sin merge -- ese proyecto hoy solo
// tiene el claim admin, así que no hay nada que perder), este script SÍ hace
// merge: registrago001 es donde eventualmente coexistirán platformRole y
// tenantId/role (goal 14) en la misma cuenta de Auth, así que sobreescribir
// sin mirar sería el mismo tipo de bug silencioso que setPlatformRole()
// (el callable) evita a propósito.
//
// Requisitos (una de las dos):
//   a) gcloud auth application-default login   (usa tus credenciales)
//   b) GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
//
// Uso:
//   cd functions
//   node scripts/setPlatformRole.js superadmin@micorriza.cl
//
// Tras ejecutarlo, el usuario debe cerrar y volver a iniciar sesión (o
// refrescar el token) para que el claim tome efecto.
'use strict';
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const PLATFORM_PROJECT_ID = 'registrago001';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Falta el email. Uso: node scripts/setPlatformRole.js <email>');
    process.exit(1);
  }
  initializeApp({
    credential: applicationDefault(),
    projectId: PLATFORM_PROJECT_ID,
  });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  // Merge, nunca overwrite -- ver la nota de cabecera.
  const claims = Object.assign({}, user.customClaims, { platformRole: 'superadmin' });
  await auth.setCustomUserClaims(user.uid, claims);
  const updated = await auth.getUser(user.uid);
  console.log(`OK: ${email} (uid ${user.uid}, proyecto ${PLATFORM_PROJECT_ID}) ahora tiene claims:`, updated.customClaims);
  console.log('El usuario debe re-loguearse para que el claim tome efecto.');
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
