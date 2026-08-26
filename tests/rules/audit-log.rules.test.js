// Bitácora de negocio (Etapa A, goal 15 del pool ReservaGo):
// tenants/{tenantId}/auditLog -- lectura solo el owner de ESE tenant o un
// superadmin, escritura NUNCA desde el cliente (solo el trigger
// onTenantSubcollectionWritten, Admin SDK). También prueba el requisito
// CLAVE del goal: stamped() ahora se exige en TODO create/update dentro de
// un tenant, no solo en tenants/{tenantId} (goal 8) -- un write autenticado
// sin updatedBy/updatedAt correctos se rechaza.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { beforeAll, afterAll, test } from 'vitest';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

const TENANT = 'ten_audit_goal15';

async function seedAuditRow(id) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `tenants/${TENANT}/auditLog/${id}`), {
      actorUid: 'staff-x', actorRole: 'staff', action: 'updated',
      collection: 'services', docId: 'svc1', before: { price: 1000 }, after: { price: 1200 },
      source: 'client',
    });
  });
}

test('el owner de ese tenant SÍ puede leer su propio auditLog', async () => {
  await seedAuditRow('row1');
  const db = env.authenticatedContext('owner-1', { role: 'owner', tenantId: TENANT }).firestore();
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/auditLog/row1`)));
});

test('reception y staff NO pueden leer el auditLog, aunque pertenezcan al mismo tenant', async () => {
  await seedAuditRow('row2');
  const reception = env.authenticatedContext('reception-1', { role: 'reception', tenantId: TENANT }).firestore();
  await assertFails(getDoc(doc(reception, `tenants/${TENANT}/auditLog/row2`)));
  const staff = env.authenticatedContext('staff-1', { role: 'staff', tenantId: TENANT, resourceId: 'res_x' }).firestore();
  await assertFails(getDoc(doc(staff, `tenants/${TENANT}/auditLog/row2`)));
});

test('un superadmin de plataforma SÍ puede leer el auditLog de cualquier tenant', async () => {
  await seedAuditRow('row3');
  const db = env.authenticatedContext('super-1', { platformRole: 'superadmin' }).firestore();
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/auditLog/row3`)));
});

test('el owner de OTRO tenant no puede leer este auditLog (aislamiento tenant-vs-tenant intacto)', async () => {
  await seedAuditRow('row4');
  const db = env.authenticatedContext('owner-otro', { role: 'owner', tenantId: 'ten_audit_goal15_b' }).firestore();
  await assertFails(getDoc(doc(db, `tenants/${TENANT}/auditLog/row4`)));
});

test('ni el owner del tenant puede escribir en auditLog directo -- solo el trigger (Admin SDK)', async () => {
  const db = env.authenticatedContext('owner-1', { role: 'owner', tenantId: TENANT }).firestore();
  await assertFails(setDoc(doc(db, `tenants/${TENANT}/auditLog/row_cliente`), {
    actorUid: 'owner-1', action: 'created', collection: 'services', docId: 'svc2', before: null, after: {}, source: 'client',
  }));
});

// CLAVE del goal: stamped() se exige en TODO create/update dentro de un
// tenant desde este goal, no solo en auditLog -- probado acá sobre
// `services` como ejemplo concreto (el mismo que usa el hecho-cuando del
// goal: "cambiar el precio de un servicio").
test('un write autenticado a services SIN updatedBy/updatedAt es rechazado', async () => {
  const db = env.authenticatedContext('owner-1', { role: 'owner', tenantId: TENANT }).firestore();
  await assertFails(setDoc(doc(db, `tenants/${TENANT}/services/svc1`), { name: 'Corte', price: 1000 }));
});

test('un write autenticado a services con updatedBy MENTIROSO (de otro uid) es rechazado', async () => {
  const db = env.authenticatedContext('owner-1', { role: 'owner', tenantId: TENANT }).firestore();
  await assertFails(setDoc(doc(db, `tenants/${TENANT}/services/svc1`), {
    name: 'Corte', price: 1000, updatedBy: 'otro-uid-que-no-es-el-mio', updatedAt: serverTimestamp(),
  }));
});

test('un write autenticado a services CON updatedBy/updatedAt correctos SÍ se acepta', async () => {
  const db = env.authenticatedContext('owner-1', { role: 'owner', tenantId: TENANT }).firestore();
  await assertSucceeds(setDoc(doc(db, `tenants/${TENANT}/services/svc1`), {
    name: 'Corte', price: 1000, updatedBy: 'owner-1', updatedAt: serverTimestamp(),
  }));
});

test('un update sin actualizar updatedAt al nuevo request.time es rechazado (no se puede reusar un timestamp viejo)', async () => {
  const db = env.authenticatedContext('owner-1', { role: 'owner', tenantId: TENANT }).firestore();
  await assertSucceeds(setDoc(doc(db, `tenants/${TENANT}/services/svc2`), {
    name: 'Corte', price: 1000, updatedBy: 'owner-1', updatedAt: serverTimestamp(),
  }));
  // Reintentar con un Date de cliente (no serverTimestamp()) -- nunca va a
  // calzar exactamente con request.time del servidor.
  await assertFails(updateDoc(doc(db, `tenants/${TENANT}/services/svc2`), {
    price: 1200, updatedBy: 'owner-1', updatedAt: new Date(),
  }));
});
