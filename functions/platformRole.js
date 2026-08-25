// functions/platformRole.js — roles de PLATAFORMA (Etapa T, goal 7 del pool
// ReservaGo). platformRole:'superadmin' es un nivel de rol separado del role
// de negocio de un tenant (owner/reception/staff+tenantId, goal 14) -- nunca
// se mezclan en el mismo claim.
//
// setPlatformRole() es la ÚNICA forma de otorgar este rol vía código, y solo
// la puede invocar un superadmin YA existente -- ningún callable puede
// auto-otorgarse el rol más alto. El primer superadmin se asigna a mano,
// fuera de la app, con functions/scripts/setPlatformRole.js (ver README.md)
// -- mismo patrón que functions/scripts/setAdminClaim.js ya usa para
// admin:true en el proyecto scissor-white.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');

const VALID_PLATFORM_ROLES = ['superadmin'];

function isSuperadmin(request) {
  return !!(request && request.auth && request.auth.token && request.auth.token.platformRole === 'superadmin');
}

function assertSuperadmin(request) {
  if (!isSuperadmin(request)) {
    throw new HttpsError('permission-denied', 'Solo un superadmin de la plataforma puede hacer esto.');
  }
}

// auth: instancia de Admin SDK Auth, recibida como parámetro (mismo patrón
// que `db` en tenant.js) -- testeable con un stub sin emulador.
async function setPlatformRole(request, auth) {
  assertSuperadmin(request);

  const targetUid = request.data && request.data.uid;
  const role = request.data && request.data.role;
  if (typeof targetUid !== 'string' || !targetUid) {
    throw new HttpsError('invalid-argument', 'uid es requerido.');
  }
  if (VALID_PLATFORM_ROLES.indexOf(role) === -1) {
    throw new HttpsError('invalid-argument', `role inválido -- valores soportados: ${VALID_PLATFORM_ROLES.join(', ')}.`);
  }

  const targetUser = await auth.getUser(targetUid);
  // Merge, NUNCA overwrite -- setCustomUserClaims() reemplaza el objeto
  // completo de claims del usuario. Perder de vista esto pisaría en
  // silencio cualquier claim de negocio que ese mismo uid ya tuviera
  // (tenantId/role del goal 14) -- exactamente el tipo de bug de "borré algo
  // sin darme cuenta" que este repo ya sufrió una vez con el UID a mano en
  // firestore.rules/storage.rules/index.js.
  const claims = Object.assign({}, targetUser.customClaims, { platformRole: role });
  await auth.setCustomUserClaims(targetUid, claims);
  return { uid: targetUid, platformRole: role };
}

module.exports = { isSuperadmin, assertSuperadmin, setPlatformRole };
