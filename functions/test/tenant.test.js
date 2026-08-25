const test = require('node:test');
const assert = require('node:assert');
const { resolveTenantId, assertTenantIdMatches } = require('../tenant.js');

// Stub mínimo de Firestore Admin SDK: solo lo que resolveTenantId toca
// (db.doc(path).get() -> {exists, data()}). Mismo espíritu que los tests de
// createBooking.js: la lógica de decisión se testea sin emulador, pasándole
// datos ya "leídos" a mano.
function fakeDb(docs) {
  return {
    doc(path) {
      return {
        async get() {
          const data = docs[path];
          return { exists: data !== undefined, data: () => data };
        },
      };
    },
  };
}

function fakeRequest(hostname, data) {
  return { rawRequest: hostname ? { hostname } : undefined, data: data || {} };
}

test('resolveTenantId resuelve un dominio de prueba conocido', async () => {
  const db = fakeDb({ 'tenantsByDomain/scissorwhite.cl': { tenantId: 'ten_scissorwhite', slug: 'scissorwhite' } });
  const resolved = await resolveTenantId(fakeRequest('scissorwhite.cl'), db);
  assert.deepStrictEqual(resolved, { tenantId: 'ten_scissorwhite', slug: 'scissorwhite' });
});

test('resolveTenantId rechaza un dominio sin tenant configurado', async () => {
  const db = fakeDb({});
  await assert.rejects(
    () => resolveTenantId(fakeRequest('dominio-desconocido.cl'), db),
    (err) => err.code === 'failed-precondition',
  );
});

test('resolveTenantId rechaza si no puede determinar el hostname de la solicitud', async () => {
  const db = fakeDb({});
  await assert.rejects(
    () => resolveTenantId(fakeRequest(null), db),
    (err) => err.code === 'failed-precondition',
  );
});

test('resolveTenantId NUNCA lee el tenantId del payload (request.data), solo del dominio', async () => {
  // Mismo dominio que el primer caso, pero con un tenantId distinto y
  // malicioso en el payload -- debe resolver igual que si el payload viniera
  // vacío, porque resolveTenantId no lo mira en absoluto.
  const db = fakeDb({ 'tenantsByDomain/scissorwhite.cl': { tenantId: 'ten_scissorwhite', slug: 'scissorwhite' } });
  const resolved = await resolveTenantId(fakeRequest('scissorwhite.cl', { tenantId: 'ten_OTRO_NEGOCIO' }), db);
  assert.strictEqual(resolved.tenantId, 'ten_scissorwhite');
});

test('assertTenantIdMatches no hace nada si el payload no trae tenantId', () => {
  assert.doesNotThrow(() => assertTenantIdMatches('ten_scissorwhite', undefined));
});

test('assertTenantIdMatches no hace nada si el payload coincide con el resuelto', () => {
  assert.doesNotThrow(() => assertTenantIdMatches('ten_scissorwhite', 'ten_scissorwhite'));
});

test('assertTenantIdMatches rechaza un callable que intenta operar con un tenantId distinto al resuelto del dominio', () => {
  assert.throws(
    () => assertTenantIdMatches('ten_scissorwhite', 'ten_OTRO_NEGOCIO'),
    (err) => err.code === 'permission-denied',
  );
});
