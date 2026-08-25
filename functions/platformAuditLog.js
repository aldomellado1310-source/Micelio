// functions/platformAuditLog.js — decide qué entrada de auditoría de
// plataforma corresponde a un write de tenants/{tenantId} (Etapa T, goal 8
// del pool ReservaGo). Pura: no toca Firestore, el trigger
// (functions/index.js#onTenantWritten) hace el I/O y le pasa los snapshots
// ya leídos -- mismo patrón que resolveCreateBooking()/buildBookingDoc() en
// createBooking.js.
'use strict';

// before/after: datos del documento (null si no existe -- creación o, en
// teoría, borrado; firestore.rules ya prohíbe borrar un tenant, así que ese
// caso no debería ocurrir nunca en producción, pero se maneja igual sin
// asumirlo).
function buildPlatformAuditEntry(before, after) {
  if (!after) return null;
  const actorUid = after.updatedBy || null;

  if (!before) {
    return { action: 'tenant_created', actorUid, before: null, after: { status: after.status } };
  }
  if (before.status !== after.status) {
    const action = after.status === 'suspended' ? 'tenant_suspended' : 'tenant_reactivated';
    return { action, actorUid, before: { status: before.status }, after: { status: after.status } };
  }
  return { action: 'tenant_updated', actorUid, before: null, after: null };
}

module.exports = { buildPlatformAuditEntry };
