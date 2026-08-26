// functions/auditLog.js — decide qué entrada de auditoría de NEGOCIO
// corresponde a un write dentro de un tenant (Etapa A, goal 15 del pool
// ReservaGo). Pura: no toca Firestore ni Auth, el trigger
// (functions/index.js#onTenantSubcollectionWritten) hace todo el I/O y le
// pasa los datos ya leídos -- mismo patrón que
// platformAuditLog.js#buildPlatformAuditEntry (goal 8), pero genérica sobre
// CUALQUIER colección de un tenant en vez de estar atada a `tenants/{id}`.
'use strict';

// before/after: datos del documento (null si no existe). Los borrados NO
// generan entrada acá a propósito: stamped() (firestore.rules) solo exige
// updatedBy/updatedAt en create/update -- un delete no trae
// request.resource.data que estampar, así que no hay forma confiable de
// atribuirlo a un actor real sin inventar attribution a partir del último
// editor (que podría no ser quien borró). Documentado como límite conocido,
// no un descuido -- el hecho-cuando del goal (cambiar el precio de un
// servicio) es un update, no un delete.
function buildAuditEntry({ before, after, collection, docId, source }) {
  if (!after) return null;
  const action = before ? 'updated' : 'created';
  return {
    actorUid: after.updatedBy || null,
    action,
    collection,
    docId,
    before: before || null,
    after,
    source: source || 'client',
  };
}

module.exports = { buildAuditEntry };
