// Roles de negocio dentro de un tenant (Etapa A, goal 14 del pool
// ReservaGo): owner/reception ven todo su tenant (mismo alcance que el
// goal 6 ya daba); 'staff' queda acotado a los bookings donde SU PROPIO
// resourceId aparece en resourceIds[] -- CRÍTICO, es el hecho-cuando
// central del goal ("un usuario con rol 'staff' que lee una reserva de
// otro recurso del mismo tenant recibe permiso denegado"). También
// reafirma que el aislamiento tenant-vs-tenant del goal 6 sigue
// funcionando con roles de negocio encima.
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

const TENANT = 'ten_role_goal14';

async function seedBooking(id, resourceIds) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `tenants/${TENANT}/bookings/${id}`), {
      status: 'pending', resourceIds, time: '10:00', dur: 30,
    });
  });
}

function dbFor(uid, claims) {
  return env.authenticatedContext(uid, claims).firestore();
}

test('staff SÍ puede leer un booking de SU PROPIO resourceId', async () => {
  await seedBooking('bk_own', ['res_ana']);
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/bookings/bk_own`)));
});

// CRÍTICO -- el hecho-cuando central del goal 14.
test('staff NO puede leer un booking de OTRO resourceId del mismo tenant', async () => {
  await seedBooking('bk_other', ['res_victoria']);
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertFails(getDoc(doc(db, `tenants/${TENANT}/bookings/bk_other`)));
});

test('staff NO puede leer un booking con varios resourceIds si el suyo no está entre ellos', async () => {
  await seedBooking('bk_multi', ['res_victoria', 'res_box1']);
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertFails(getDoc(doc(db, `tenants/${TENANT}/bookings/bk_multi`)));
});

test('staff SÍ puede leer un booking multi-recurso si SU resourceId está entre los varios', async () => {
  await seedBooking('bk_multi2', ['res_victoria', 'res_ana']);
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/bookings/bk_multi2`)));
});

test('owner ve CUALQUIER booking del tenant, sin restricción de resourceId', async () => {
  await seedBooking('bk_for_owner', ['res_victoria']);
  const db = dbFor('owner-1', { role: 'owner', tenantId: TENANT });
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/bookings/bk_for_owner`)));
});

test('reception ve CUALQUIER booking del tenant, sin restricción de resourceId', async () => {
  await seedBooking('bk_for_reception', ['res_victoria']);
  const db = dbFor('reception-1', { role: 'reception', tenantId: TENANT });
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/bookings/bk_for_reception`)));
});

test('staff NO puede crear un booking asignado a OTRO resourceId', async () => {
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertFails(setDoc(doc(db, `tenants/${TENANT}/bookings/bk_new_wrong`), {
    status: 'pending', resourceIds: ['res_victoria'], time: '11:00', dur: 30,
  }));
});

test('staff SÍ puede crear un booking asignado a SU PROPIO resourceId', async () => {
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  // updatedBy/updatedAt: firestore.rules#stamped() los exige desde el goal
  // 15 en todo create/update dentro de un tenant.
  await assertSucceeds(setDoc(doc(db, `tenants/${TENANT}/bookings/bk_new_ok`), {
    status: 'pending', resourceIds: ['res_ana'], time: '11:00', dur: 30,
    updatedBy: 'staff-ana', updatedAt: serverTimestamp(),
  }));
});

test('staff NO puede actualizar un booking de otro resourceId', async () => {
  await seedBooking('bk_update_other', ['res_victoria']);
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertFails(updateDoc(doc(db, `tenants/${TENANT}/bookings/bk_update_other`), { status: 'cancelled' }));
});

test('staff NO está restringido por resourceId en otras colecciones (resources/services)', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `tenants/${TENANT}/resources/res_victoria`), { kind: 'person', name: 'Victoria', active: true, schedule: [] });
  });
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/resources/res_victoria`)));
});

test('leer un booking inexistente no revienta la regla (exists:false, no error de evaluación)', async () => {
  const db = dbFor('staff-ana', { role: 'staff', tenantId: TENANT, resourceId: 'res_ana' });
  await assertSucceeds(getDoc(doc(db, `tenants/${TENANT}/bookings/bk_no_existe`)));
});

// Reafirma el aislamiento del goal 6: los roles de negocio no debilitan la
// barrera tenant-vs-tenant. Un 'staff' cuyo resourceId coincidiera POR
// COINCIDENCIA con un id real de OTRO tenant sigue sin poder leer nada ahí
// -- el chequeo de tenantId corre PRIMERO (inTenantCollections()).
test('un owner del tenant A no puede leer bookings del tenant B, aunque exista', async () => {
  const TENANT_B = 'ten_role_goal14_b';
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `tenants/${TENANT_B}/bookings/bk_b`), { status: 'pending', resourceIds: ['res_x'], time: '10:00', dur: 30 });
  });
  const db = dbFor('owner-1', { role: 'owner', tenantId: TENANT });
  await assertFails(getDoc(doc(db, `tenants/${TENANT_B}/bookings/bk_b`)));
});
