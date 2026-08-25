// Modelo de resources (Etapa A, goal 9 del pool ReservaGo): construido ya
// sobre las subcolecciones por tenant del goal 6 -- no hay una versión sin
// tenant que migrar después. El aislamiento tenant-vs-tenant para
// `resources` ya está probado genéricamente en
// tests/rules/tenant-isolation.rules.test.js; este archivo verifica en
// cambio la FORMA real del documento (kind/name/active/schedule/profile,
// ver functions/shared/resource.js) y que no exista ninguna ruta de
// `resources` fuera de tenants/{tenantId}/....
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { beforeAll, afterAll, test } from 'vitest';
import { isValidResourcePayload, DAYS_PER_WEEK } from '../../functions/shared/resource.js';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

const TENANT = 'ten_resource_goal9';

function week(day) { return new Array(DAYS_PER_WEEK).fill(null).map(() => Object.assign({}, day)); }

test('puedo crear un resource kind:person con profile dentro de un tenant de prueba y leerlo de vuelta', async () => {
  const data = {
    kind: 'person', name: 'Ana', active: true,
    schedule: week({ open: false }),
    profile: { photo: 'https://x/y.jpg', bio: 'Barbera' },
  };
  // Confirma que el payload de prueba respeta el mismo modelo que la
  // función real usaría para validar antes de escribir.
  if (!isValidResourcePayload(data)) throw new Error('payload de prueba inválido');

  const db = env.authenticatedContext('owner-a', { tenantId: TENANT }).firestore();
  const ref = doc(db, `tenants/${TENANT}/resources/res_person`);
  await assertSucceeds(setDoc(ref, data));
  const snap = await getDoc(ref);
  const read = snap.data();
  if (read.kind !== 'person' || read.name !== 'Ana' || read.profile.bio !== 'Barbera') {
    throw new Error('el resource leído no coincide con lo escrito');
  }
});

test('puedo crear un resource kind:space SIN profile dentro de un tenant de prueba y leerlo de vuelta', async () => {
  const data = { kind: 'space', name: 'Box 1', active: true, schedule: week({ open: false }) };
  if (!isValidResourcePayload(data)) throw new Error('payload de prueba inválido');

  const db = env.authenticatedContext('owner-a', { tenantId: TENANT }).firestore();
  const ref = doc(db, `tenants/${TENANT}/resources/res_space`);
  await assertSucceeds(setDoc(ref, data));
  const snap = await getDoc(ref);
  if (snap.data().kind !== 'space') throw new Error('el resource leído no coincide con lo escrito');
});

// "sin ninguna referencia a resources fuera de una ruta de tenant" (goal 9):
// no existe ningún `match` de nivel raíz para `resources` en firestore.rules
// -- confirma que una ruta /resources/{id} SIN tenantId no cae por
// convención sino porque la regla no la contempla en absoluto (deny-all
// implícito de Firestore para cualquier ruta sin match).
test('resources fuera de una ruta de tenant (nivel raíz) está denegado, incluso para un usuario con tenantId', async () => {
  const db = env.authenticatedContext('owner-a', { tenantId: TENANT }).firestore();
  await assertFails(setDoc(doc(db, 'resources/res_raiz'), { kind: 'space', name: 'x', active: true, schedule: week({ open: false }) }));
  await assertFails(getDoc(doc(db, 'resources/res_raiz')));
});
