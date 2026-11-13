// veritest/functions/lib/issuer.js
//
// Quién puede REGISTRAR diplomas. Sin este control cualquiera subiría un
// diploma falso y recibiría un QR de "verificado" -- el registro sería
// inútil. Reglas:
//   * Hay que estar autenticado y llevar el custom claim `veritestIssuer`
//     con el id de un emisor (lo asigna scripts/setIssuer.js a mano, fuera de
//     la app, mismo patrón que setPlatformRole.js del sistema de reservas).
//   * El id del emisor sale SIEMPRE del token firmado por Firebase, nunca del
//     payload -- un cliente no puede registrar "en nombre de" otro emisor.
//   * issuers/{id}.status debe ser 'active'. Un emisor suspendido no puede
//     registrar diplomas NUEVOS, pero sus diplomas ya registrados siguen
//     verificándose (nada se borra ni se oculta).
'use strict';
const { VeritestError } = require('./errors.js');

const ISSUER_ID_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

function isValidIssuerId(value) {
  return typeof value === 'string' && ISSUER_ID_RE.test(value);
}

// `auth` es lo que Firebase deja en request.auth ({uid, token}) o null.
async function resolveIssuer(auth, db) {
  if (!auth || !auth.uid) {
    throw new VeritestError('unauthenticated', 'Debes iniciar sesión.');
  }
  const issuerId = auth.token && auth.token.veritestIssuer;
  if (!isValidIssuerId(issuerId)) {
    throw new VeritestError('permission_denied', 'Tu cuenta no está habilitada para emitir diplomas.');
  }
  const snap = await db.doc(`issuers/${issuerId}`).get();
  if (!snap.exists || snap.data().status !== 'active') {
    throw new VeritestError('permission_denied', 'El emisor no existe o está suspendido.');
  }
  return { id: issuerId, name: snap.data().name, uid: auth.uid };
}

// Merge, nunca overwrite: setCustomUserClaims() reemplaza el objeto entero.
function mergeIssuerClaim(existingClaims, issuerId) {
  return Object.assign({}, existingClaims, { veritestIssuer: issuerId });
}

module.exports = { resolveIssuer, mergeIssuerClaim, isValidIssuerId };
