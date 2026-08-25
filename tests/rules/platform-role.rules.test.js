// Roles de plataforma vs. roles de tenant (Etapa T, goal 7 del pool
// ReservaGo): un usuario con SOLO platformRole:'superadmin' no debe poder
// leer datos de ningún tenant a través de las reglas de negocio -- ni las
// colecciones de nivel raíz de Scissor White (gate: isAdmin()) ni las
// subcolecciones por tenant (gate: tenantId, goal 6). Sí debe poder leer y
// escribir tenants/{tenantId} (el modelo de cliente de la plataforma).
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { beforeAll, afterAll, test } from 'vitest';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

test('superadmin puede leer y escribir tenants/{tenantId}', async () => {
  const db = env.authenticatedContext('super-uid', { platformRole: 'superadmin' }).firestore();
  await assertSucceeds(setDoc(doc(db, 'tenants/ten_scissorwhite'), { name: 'Scissor White', status: 'active' }));
  await assertSucceeds(getDoc(doc(db, 'tenants/ten_scissorwhite')));
});

test('un usuario sin platformRole (aunque esté autenticado) NO puede leer ni escribir tenants/{tenantId}', async () => {
  const db = env.authenticatedContext('user-a', { tenantId: 'ten_A' }).firestore();
  await assertFails(getDoc(doc(db, 'tenants/ten_scissorwhite')));
  await assertFails(setDoc(doc(db, 'tenants/ten_scissorwhite'), { name: 'x' }));
});

// CRÍTICO (hecho-cuando del goal 7): un usuario con SOLO
// platformRole:'superadmin' no puede leer datos de ningún tenant a través de
// las reglas de negocio -- ni las de nivel raíz de Scissor White (isAdmin())
// ni las subcolecciones por tenant (goal 6). Un superadmin puro no tiene
// admin:true ni tenantId, así que ninguna de las dos reglas lo reconoce --
// esto prueba que de verdad no se mezclan, no solo que "en teoría" no deberían.
test('superadmin puro NO puede leer/escribir colecciones de negocio de nivel raíz (isAdmin())', async () => {
  const db = env.authenticatedContext('super-uid', { platformRole: 'superadmin' }).firestore();
  await assertFails(setDoc(doc(db, 'services/svc1'), { name: 'Corte' }));
  await assertFails(getDoc(doc(db, 'bookings/b1')));
  await assertFails(getDoc(doc(db, 'patients/p1')));
});

test('superadmin puro NO puede leer/escribir subcolecciones de ningún tenant (goal 6)', async () => {
  const db = env.authenticatedContext('super-uid', { platformRole: 'superadmin' }).firestore();
  await assertFails(setDoc(doc(db, 'tenants/ten_A/bookings/b1'), { x: 1 }));
  await assertFails(getDoc(doc(db, 'tenants/ten_A/services/s1')));
});

// El otro lado del hecho-cuando: un usuario con role de tenant no puede
// invocar setPlatformRole -- eso se prueba a nivel de callable en
// functions/test/platformRole.test.js (assertSuperadmin rechaza un request
// con claims de tenant), no acá: setPlatformRole no es una escritura de
// Firestore, así que el emulador de reglas no lo cubre.
test('un usuario con role de tenant (sin platformRole) tampoco puede tocar tenants/{tenantId}', async () => {
  const db = env.authenticatedContext('owner-a', { tenantId: 'ten_A', role: 'owner' }).firestore();
  await assertFails(getDoc(doc(db, 'tenants/ten_A')));
  await assertFails(setDoc(doc(db, 'tenants/ten_A'), { name: 'x' }));
});
