// functions/shared/role.js — roles de NEGOCIO de un tenant (Etapa A, goal 14
// del pool ReservaGo). Nivel de rol SEPARADO de platformRole:'superadmin'
// (goal 7, functions/platformRole.js) -- nunca se mezclan en el mismo claim
// ni en la misma función de reglas (ver isSuperadmin() vs. el chequeo de
// role/tenantId en firestore.rules).
//
// owner/reception: acceso completo dentro de su tenant (mismo alcance que
// goal 6 ya daba a cualquier claim con tenantId, ahora con nombre). staff:
// además necesita resourceId -- un miembro de staff solo opera sobre SU
// propio recurso (ver bookingAccessOk() en firestore.rules), nunca sobre el
// resto del tenant.
//
// Agnóstico de tenant, igual que el resto de shared/: solo valida la FORMA
// del role, no a qué tenant pertenece.
'use strict';

const BUSINESS_ROLES = ['owner', 'reception', 'staff'];

function isValidBusinessRole(role) {
  return BUSINESS_ROLES.indexOf(role) !== -1;
}

// ¿este role EXIGE resourceId? Hoy solo 'staff' -- un owner/reception no
// está atado a un recurso particular.
function requiresResourceId(role) {
  return role === 'staff';
}

module.exports = { BUSINESS_ROLES, isValidBusinessRole, requiresResourceId };
