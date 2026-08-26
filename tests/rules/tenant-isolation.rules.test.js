// Aislamiento entre tenants para las subcolecciones de negocio (Etapa T,
// goal 6 del pool ReservaGo): resources, services, bookings, holds,
// dataRequests bajo tenants/{tenantId}/... -- CRÍTICO: probado acá
// con el emulador de reglas, no solo revisado a ojo (así lo pide el goal).
// auditLog NO está en esta lista desde el goal 15 (Etapa A) -- tiene su
// propia regla y su propio archivo de tests, ver tests/rules/audit-log.rules.test.js.
//
// request.auth.token.tenantId es la forma de claim que el goal 7 recién va a
// EMITIR (callable setUserRole) -- todavía no existe ese callable en el
// repo, así que acá se simula directamente vía authenticatedContext(uid,
// {tenantId}), el mismo mecanismo que ya usan los tests de isAdmin()
// (ver tests/rules/firestore.rules.test.js, {admin:true}).
//
// Los `setDoc` de este archivo estampan updatedBy/updatedAt desde el goal
// 15 (firestore.rules#stamped() ahora exige eso en todo create/update
// dentro de un tenant) -- sin esos campos, el `evaluation error` de
// stamped() taparía el resultado que este archivo en realidad quiere
// probar (aislamiento tenant-vs-tenant), no al revés.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { beforeAll, afterAll, test, describe } from 'vitest';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'scissor-white-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

const TENANT_A = 'ten_A';
const TENANT_B = 'ten_B';
const COLLECTIONS = ['resources', 'services', 'bookings', 'holds', 'dataRequests'];

function stamped(uid, fields) {
  return Object.assign({}, fields, { updatedBy: uid, updatedAt: serverTimestamp() });
}

COLLECTIONS.forEach((collection) => {
  describe(`tenants/{tenantId}/${collection}`, () => {
    test(`un usuario del tenant A puede leer y escribir su propio tenants/${TENANT_A}/${collection}`, async () => {
      const db = env.authenticatedContext('user-a', { tenantId: TENANT_A }).firestore();
      await assertSucceeds(setDoc(doc(db, `tenants/${TENANT_A}/${collection}/doc1`), stamped('user-a', { x: 1 })));
      await assertSucceeds(getDoc(doc(db, `tenants/${TENANT_A}/${collection}/doc1`)));
    });

    // CRÍTICO (ver comentario de cabecera del goal 6): un usuario con claims
    // del tenant A que intenta leer o escribir cualquier documento bajo
    // tenants/{tenantB}/... debe recibir permiso denegado.
    test(`un usuario del tenant A NO puede escribir en tenants/${TENANT_B}/${collection}`, async () => {
      const db = env.authenticatedContext('user-a', { tenantId: TENANT_A }).firestore();
      await assertFails(setDoc(doc(db, `tenants/${TENANT_B}/${collection}/doc1`), stamped('user-a', { x: 1 })));
    });

    test(`un usuario del tenant A NO puede leer tenants/${TENANT_B}/${collection}`, async () => {
      const db = env.authenticatedContext('user-a', { tenantId: TENANT_A }).firestore();
      await assertFails(getDoc(doc(db, `tenants/${TENANT_B}/${collection}/doc1`)));
    });

    test(`anónimo NO puede leer ni escribir tenants/${TENANT_A}/${collection}`, async () => {
      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, `tenants/${TENANT_A}/${collection}/doc1`)));
      await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/${collection}/doc1`), { x: 1 }));
    });

    // isAdmin() (custom claim admin:true, el rol de NEGOCIO de Scissor White
    // hoy) a propósito NO debe dar acceso acá -- no tiene tenantId, así que
    // no pertenece a NINGÚN tenant todavía. Confundir esto sería la misma
    // clase de bug que motivó goal 6 (aislamiento por disciplina, no por
    // estructura).
    test(`isAdmin() (admin:true, sin tenantId) NO puede escribir en ninguna subcolección de tenant`, async () => {
      const db = env.authenticatedContext('admin-uid', { admin: true }).firestore();
      await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/${collection}/doc1`), { x: 1 }));
    });
  });
});

test('una ruta bajo tenants/{tenantId}/... con un nombre de colección fuera de la lista permitida es rechazada', async () => {
  const db = env.authenticatedContext('user-a', { tenantId: TENANT_A }).firestore();
  await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/coleccionInventada/doc1`), { x: 1 }));
});
