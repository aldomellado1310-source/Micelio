// Ciclo de vida del tenant (Etapa T, goal 8 del pool ReservaGo):
//   1) stamped() en tenants/{tenantId} -- todo create/update debe traer
//      updatedBy == el uid real de quien escribe y updatedAt == request.time,
//      o se rechaza (sin esto, platformAuditLog podría atribuir un cambio a
//      alguien que no lo hizo).
//   2) tenants/{tenantId} nunca se borra, ni siquiera un superadmin puede.
//   3) platformAuditLog es de solo lectura para el cliente (lo escribe el
//      trigger onTenantWritten, Admin SDK).
//   4) CRÍTICO: un tenant 'suspended' bloquea la ESCRITURA de sus propios
//      usuarios de negocio de inmediato, pero NO la lectura (no "borra ni
//      oculta" sus datos).
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { beforeAll, afterAll, test } from 'vitest';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });
// Sin clearFirestore() entre tests a propósito: los tests de reglas de este
// repo corren en paralelo contra el MISMO proyecto de emulador
// ('scissor-white-test', compartido por todos los archivos de tests/rules/)
// -- clearFirestore() borraría datos que otro archivo sembró al mismo
// tiempo. Cada test usa su propio ID de tenant (ten_a, ten_b, ten_new, ...)
// para no chocar entre sí, mismo patrón que el resto de la suite.

function superadminDb() {
  return env.authenticatedContext('super-uid', { platformRole: 'superadmin' }).firestore();
}

test('superadmin puede crear un tenant si stampea updatedBy/updatedAt correctamente', async () => {
  const db = superadminDb();
  await assertSucceeds(setDoc(doc(db, 'tenants/ten_new'), {
    name: 'Cliente Nuevo', status: 'active',
    updatedBy: 'super-uid', updatedAt: serverTimestamp(),
  }));
});

test('rechaza crear/actualizar un tenant con updatedBy de OTRO usuario (no se puede mentir sobre quién hizo el cambio)', async () => {
  const db = superadminDb();
  await assertFails(setDoc(doc(db, 'tenants/ten_new'), {
    name: 'Cliente Nuevo', status: 'active',
    updatedBy: 'otro-uid-que-no-es-el-mio', updatedAt: serverTimestamp(),
  }));
});

test('rechaza crear un tenant sin updatedBy/updatedAt', async () => {
  const db = superadminDb();
  await assertFails(setDoc(doc(db, 'tenants/ten_new'), { name: 'Cliente Nuevo', status: 'active' }));
});

test('ni un superadmin puede borrar un tenant -- nunca se borra, solo se suspende', async () => {
  const db = superadminDb();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tenants/ten_a'), { name: 'x', status: 'active', updatedBy: 'super-uid', updatedAt: serverTimestamp() });
  });
  await assertFails(deleteDoc(doc(db, 'tenants/ten_a')));
});

test('platformAuditLog es de solo lectura para el cliente, incluso para un superadmin', async () => {
  const db = superadminDb();
  await assertFails(setDoc(doc(db, 'platformAuditLog/log1'), { action: 'tenant_created' }));
});

// Cada test de acá abajo usa su propio uid de contexto Y su propio tenantId
// -- no por prolijidad: reutilizar el mismo (uid, claims) para
// authenticatedContext() en varios tests del mismo archivo disparó
// "Firestore has already been started and its settings can no longer be
// changed" (quirk conocido de @firebase/rules-unit-testing al reusar un
// contexto cacheado entre un write y un read posteriores). Contextos
// frescos por test lo evita de raíz.
test('un usuario del tenant A puede ESCRIBIR mientras el tenant está activo', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tenants/ten_active_write'), { name: 'x', status: 'active', updatedBy: 'super-uid', updatedAt: serverTimestamp() });
  });
  const db = env.authenticatedContext('owner-active-write', { tenantId: 'ten_active_write' }).firestore();
  await assertSucceeds(setDoc(doc(db, 'tenants/ten_active_write/bookings/b1'), { x: 1 }));
});

// CRÍTICO -- el hecho-cuando central del goal 8.
test('suspender el tenant bloquea de inmediato la escritura de sus usuarios de negocio', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tenants/ten_suspended_write'), { name: 'x', status: 'suspended', updatedBy: 'super-uid', updatedAt: serverTimestamp() });
  });
  const db = env.authenticatedContext('owner-suspended-write', { tenantId: 'ten_suspended_write' }).firestore();
  await assertFails(setDoc(doc(db, 'tenants/ten_suspended_write/bookings/b1'), { x: 1 }));
});

// "No borra ni oculta sus datos" -- la lectura sigue funcionando aunque el
// tenant esté suspendido.
test('suspender el tenant NO bloquea la lectura -- sus datos siguen visibles para su propio equipo', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    // ctx.firestore() UNA sola vez y reusado -- llamarlo dos veces en el
    // mismo callback (una instancia fresca por llamada) disparó "Firestore
    // has already been started and its settings can no longer be changed".
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants/ten_suspended_read'), { name: 'x', status: 'suspended', updatedBy: 'super-uid', updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'tenants/ten_suspended_read/bookings/b1'), { x: 1 });
  });
  const db = env.authenticatedContext('owner-suspended-read', { tenantId: 'ten_suspended_read' }).firestore();
  await assertSucceeds(getDoc(doc(db, 'tenants/ten_suspended_read/bookings/b1')));
});

test('reactivar el tenant (status vuelve a active) restaura la escritura', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tenants/ten_reactivated'), { name: 'x', status: 'active', updatedBy: 'super-uid', updatedAt: serverTimestamp() });
  });
  const db = env.authenticatedContext('owner-reactivated', { tenantId: 'ten_reactivated' }).firestore();
  await assertSucceeds(setDoc(doc(db, 'tenants/ten_reactivated/bookings/b1'), { x: 1 }));
});
