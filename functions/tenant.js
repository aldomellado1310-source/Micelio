// functions/tenant.js — resolución de tenant por dominio, en servidor
// (Etapa T, goal 5 del pool ReservaGo). resolveTenantId(request, db) es la
// función helper que TODO callable de negocio debe usar para obtener el
// tenantId real -- nunca confiar en un tenantId que venga de request.data
// (el payload del cliente).
//
// CÓMO ve el servidor el dominio real: los callables se invocan hoy directo
// contra el dominio de Cloud Functions (getFunctions(app, 'southamerica-east1')
// + httpsCallable en el cliente), así que request.rawRequest.hostname sería
// SIEMPRE el dominio de Cloud Functions, nunca el del negocio -- decisión
// discutida con el usuario 2026-08-25. La solución: un rewrite de Firebase
// Hosting (ver firebase.json#hosting.rewrites) que reenvía la ruta pública
// hacia la función, conservando el Host original -- Hosting hace de proxy,
// no el navegador, así que el dominio que ve request.rawRequest.hostname
// es el que Hosting realmente recibió, no algo que el cliente pueda mentir.
// Callables que necesiten esto DEBEN exponerse vía ese rewrite (ver
// exports.resolveTenant en index.js) -- invocados directo contra
// *.cloudfunctions.net, este helper falla con 'failed-precondition' porque
// el hostname que ve no está en tenantsByDomain.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');

// db se recibe como parámetro (nunca un getFirestore() propio acá) -- mismo
// patrón que resolveCreateBooking()/buildBookingDoc() en createBooking.js:
// el I/O real (qué Firestore, qué transacción) lo decide el llamador, esta
// función solo hace UN read puntual y punto. Permite testear con un stub de
// `db` sin emulador (ver functions/test/tenant.test.js).
async function resolveTenantId(request, db) {
  const hostname = request && request.rawRequest && request.rawRequest.hostname;
  if (!hostname) {
    throw new HttpsError('failed-precondition', 'No se pudo determinar el dominio de la solicitud.');
  }
  const snap = await db.doc(`tenantsByDomain/${hostname}`).get();
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', `No hay ningún tenant configurado para el dominio "${hostname}".`);
  }
  const data = snap.data();
  return { tenantId: data.tenantId, slug: data.slug };
}

// Guard que cualquier callable de negocio debe llamar antes de operar con un
// tenantId que haya llegado en el payload (request.data.tenantId) -- por
// ejemplo un cliente viejo, o un intento de leer/escribir el tenant de otro
// negocio. El tenantId resuelto por dominio SIEMPRE gana; esto solo detecta
// el desacuerdo y rechaza, nunca "corrige" en silencio.
function assertTenantIdMatches(resolvedTenantId, claimedTenantId) {
  if (claimedTenantId && claimedTenantId !== resolvedTenantId) {
    throw new HttpsError('permission-denied', 'El tenantId no coincide con el dominio de la solicitud.');
  }
}

module.exports = { resolveTenantId, assertTenantIdMatches };
