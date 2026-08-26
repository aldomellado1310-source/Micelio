// functions/setUserRole.js — roles de NEGOCIO de un tenant (Etapa A, goal 14
// del pool ReservaGo). Mismo patrón que functions/platformRole.js (goal 7):
// merge de claims, nunca overwrite; la autorización se revisa ANTES de
// validar el resto del payload, para no filtrarle nada a quien no puede
// invocar esto.
//
// setUserRole() es la ÚNICA forma de otorgar role+tenantId(+resourceId) vía
// código -- solo la puede invocar un 'owner' de ESE MISMO tenant o un
// superadmin de plataforma (goal 7). Un 'reception'/'staff' no puede
// asignar roles, ni siquiera dentro de su propio tenant.
'use strict';
const { HttpsError } = require('firebase-functions/v2/https');
const { isValidBusinessRole, requiresResourceId } = require('./shared/role.js');

function isSuperadminToken(request) {
  return !!(request && request.auth && request.auth.token && request.auth.token.platformRole === 'superadmin');
}

function isOwnerOfTenant(request, tenantId) {
  return !!(request && request.auth && request.auth.token
    && request.auth.token.role === 'owner' && request.auth.token.tenantId === tenantId);
}

function assertCanSetUserRole(request, tenantId) {
  if (!isSuperadminToken(request) && !isOwnerOfTenant(request, tenantId)) {
    throw new HttpsError('permission-denied', 'Solo un owner de este tenant o un superadmin de plataforma puede asignar roles.');
  }
}

// auth: instancia de Admin SDK Auth, recibida como parámetro (mismo patrón
// que setPlatformRole/resolveTenantId) -- testeable con un stub sin
// emulador.
async function setUserRole(request, auth) {
  const data = (request && request.data) || {};
  // Autorización PRIMERO, contra el tenantId crudo del payload (aunque
  // todavía no se haya validado su formato) -- mismo criterio que
  // assertSuperadmin() en platformRole.js: quien no puede invocar esto no
  // debe recibir ningún otro mensaje de error que revele forma del payload.
  assertCanSetUserRole(request, data.tenantId);

  const targetUid = data.uid;
  const tenantId = data.tenantId;
  const role = data.role;
  const resourceId = data.resourceId;

  if (typeof targetUid !== 'string' || !targetUid) {
    throw new HttpsError('invalid-argument', 'uid es requerido.');
  }
  if (typeof tenantId !== 'string' || !tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId es requerido.');
  }
  if (!isValidBusinessRole(role)) {
    throw new HttpsError('invalid-argument', 'role inválido -- valores soportados: owner, reception, staff.');
  }
  if (requiresResourceId(role) && (typeof resourceId !== 'string' || !resourceId)) {
    throw new HttpsError('invalid-argument', 'resourceId es requerido cuando role es "staff".');
  }

  const targetUser = await auth.getUser(targetUid);
  // Merge, NUNCA overwrite -- mismo motivo que setPlatformRole: pisaría en
  // silencio platformRole (goal 7) u otro claim que ese uid ya tuviera.
  // resourceId se limpia explícitamente a null para cualquier role que no
  // sea 'staff' -- si no, un usuario reasignado de staff a owner quedaría
  // con un resourceId viejo colgando en su token, que ningún código nuevo
  // debería leer pero que sería un dato mentiroso de todas formas.
  const claims = Object.assign({}, targetUser.customClaims, {
    role, tenantId, resourceId: requiresResourceId(role) ? resourceId : null,
  });
  await auth.setCustomUserClaims(targetUid, claims);
  return { uid: targetUid, role, tenantId, resourceId: claims.resourceId };
}

module.exports = { isSuperadminToken, isOwnerOfTenant, assertCanSetUserRole, setUserRole };
