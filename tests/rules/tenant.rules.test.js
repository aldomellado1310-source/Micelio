// Reglas de las colecciones de tenencia (Etapa T, goal 5 del pool ReservaGo):
// tenants/{tenantId} (PII, nadie vía cliente) y tenantsByDomain/{dominio}
// (público sin PII, lectura libre, escritura solo Admin SDK).
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

test('cualquiera puede leer tenantsByDomain (documento público sin PII)', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'tenantsByDomain/scissorwhite.cl')));
});

test('anónimo NO puede escribir tenantsByDomain', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'tenantsByDomain/scissorwhite.cl'), { tenantId: 'ten_x', slug: 'x' }));
});

// isAdmin() (el rol de NEGOCIO de Scissor White, ver firestore.rules) a
// propósito NO debe poder tocar esto -- es dato de PLATAFORMA, no de un
// negocio. Solo Admin SDK (functions/tenant.js, scripts) puede escribirlo,
// hasta que exista platformRole:'superadmin' en el goal 7.
test('admin del negocio (isAdmin) tampoco puede escribir tenantsByDomain', async () => {
  const db = env.authenticatedContext('admin-uid', { admin: true }).firestore();
  await assertFails(setDoc(doc(db, 'tenantsByDomain/scissorwhite.cl'), { tenantId: 'ten_x', slug: 'x' }));
});

test('anónimo NO puede leer tenants/{tenantId} (tiene PII: contactEmail/contactName)', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'tenants/ten_scissorwhite')));
});

test('admin del negocio (isAdmin) tampoco puede leer tenants/{tenantId} -- no es el rol de plataforma', async () => {
  const db = env.authenticatedContext('admin-uid', { admin: true }).firestore();
  await assertFails(getDoc(doc(db, 'tenants/ten_scissorwhite')));
});

test('anónimo NO puede escribir tenants/{tenantId}', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'tenants/ten_scissorwhite'), { name: 'Scissor White', status: 'active' }));
});
