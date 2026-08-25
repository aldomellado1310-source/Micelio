const test = require('node:test');
const assert = require('node:assert');
const { isSuperadminToken, isOwnerOfTenant, assertCanSetUserRole, setUserRole } = require('../setUserRole.js');

function requestWithClaims(claims, data) {
  return { auth: claims ? { token: claims } : null, data: data || {} };
}

// Mismo stub que functions/test/platformRole.test.js.
function fakeAuth(users) {
  const calls = [];
  return {
    calls,
    async getUser(uid) {
      const u = users[uid];
      if (!u) throw new Error(`stub: usuario ${uid} no existe`);
      return { uid, customClaims: u.customClaims };
    },
    async setCustomUserClaims(uid, claims) {
      calls.push({ uid, claims });
      users[uid] = { customClaims: claims };
    },
  };
}

test('isSuperadminToken/isOwnerOfTenant leen el claim correcto', () => {
  assert.strictEqual(isSuperadminToken(requestWithClaims({ platformRole: 'superadmin' })), true);
  assert.strictEqual(isSuperadminToken(requestWithClaims({ role: 'owner', tenantId: 'ten_A' })), false);
  assert.strictEqual(isOwnerOfTenant(requestWithClaims({ role: 'owner', tenantId: 'ten_A' }), 'ten_A'), true);
  assert.strictEqual(isOwnerOfTenant(requestWithClaims({ role: 'owner', tenantId: 'ten_A' }), 'ten_B'), false);
  assert.strictEqual(isOwnerOfTenant(requestWithClaims({ role: 'reception', tenantId: 'ten_A' }), 'ten_A'), false);
});

test('assertCanSetUserRole no lanza para el owner del mismo tenant ni para un superadmin', () => {
  assert.doesNotThrow(() => assertCanSetUserRole(requestWithClaims({ role: 'owner', tenantId: 'ten_A' }), 'ten_A'));
  assert.doesNotThrow(() => assertCanSetUserRole(requestWithClaims({ platformRole: 'superadmin' }), 'ten_A'));
});

test('assertCanSetUserRole rechaza al owner de OTRO tenant, a reception/staff, y a un anónimo', () => {
  [
    requestWithClaims({ role: 'owner', tenantId: 'ten_B' }),
    requestWithClaims({ role: 'reception', tenantId: 'ten_A' }),
    requestWithClaims({ role: 'staff', tenantId: 'ten_A', resourceId: 'res_1' }),
    requestWithClaims(null),
  ].forEach((request) => {
    assert.throws(() => assertCanSetUserRole(request, 'ten_A'), (err) => err.code === 'permission-denied');
  });
});

test('setUserRole rechaza si quien llama no está autorizado, sin tocar Auth', async () => {
  const auth = fakeAuth({});
  const request = requestWithClaims({ role: 'staff', tenantId: 'ten_A', resourceId: 'res_1' }, { uid: 'target', tenantId: 'ten_A', role: 'owner' });
  await assert.rejects(() => setUserRole(request, auth), (err) => err.code === 'permission-denied');
  assert.strictEqual(auth.calls.length, 0);
});

test('setUserRole rechaza uid/tenantId faltantes', async () => {
  // Con superadmin (que no depende de que tenantId calce con ningún claim
  // propio) para aislar la validación de formato de la autorización -- un
  // owner sin tenantId en el payload ya cae antes, en assertCanSetUserRole
  // (permission-denied), como prueba el test de arriba.
  const auth = fakeAuth({});
  const superadmin = { platformRole: 'superadmin' };
  await assert.rejects(
    () => setUserRole(requestWithClaims(superadmin, { tenantId: 'ten_A', role: 'reception' }), auth),
    (err) => err.code === 'invalid-argument',
  );
  await assert.rejects(
    () => setUserRole(requestWithClaims(superadmin, { uid: 'target', role: 'reception' }), auth),
    (err) => err.code === 'invalid-argument',
  );
});

test('un owner que omite tenantId cae en permission-denied (no puede probar autorización sobre "ningún tenant")', async () => {
  const auth = fakeAuth({});
  const owner = { role: 'owner', tenantId: 'ten_A' };
  await assert.rejects(
    () => setUserRole(requestWithClaims(owner, { uid: 'target', role: 'reception' }), auth),
    (err) => err.code === 'permission-denied',
  );
  assert.strictEqual(auth.calls.length, 0);
});

test('setUserRole rechaza un role fuera de la lista soportada', async () => {
  const auth = fakeAuth({ target: { customClaims: {} } });
  const owner = { role: 'owner', tenantId: 'ten_A' };
  await assert.rejects(
    () => setUserRole(requestWithClaims(owner, { uid: 'target', tenantId: 'ten_A', role: 'mega-owner' }), auth),
    (err) => err.code === 'invalid-argument',
  );
});

test('setUserRole rechaza role:staff sin resourceId', async () => {
  const auth = fakeAuth({ target: { customClaims: {} } });
  const owner = { role: 'owner', tenantId: 'ten_A' };
  await assert.rejects(
    () => setUserRole(requestWithClaims(owner, { uid: 'target', tenantId: 'ten_A', role: 'staff' }), auth),
    (err) => err.code === 'invalid-argument',
  );
});

test('setUserRole otorga role:staff+resourceId a un usuario sin claims previos', async () => {
  const auth = fakeAuth({ target: { customClaims: undefined } });
  const owner = { role: 'owner', tenantId: 'ten_A' };
  const result = await setUserRole(requestWithClaims(owner, { uid: 'target', tenantId: 'ten_A', role: 'staff', resourceId: 'res_1' }), auth);
  assert.deepStrictEqual(result, { uid: 'target', role: 'staff', tenantId: 'ten_A', resourceId: 'res_1' });
  assert.deepStrictEqual(auth.calls[0].claims, { role: 'staff', tenantId: 'ten_A', resourceId: 'res_1' });
});

test('setUserRole limpia resourceId a null cuando el role no es staff', async () => {
  const auth = fakeAuth({ target: { customClaims: { role: 'staff', tenantId: 'ten_A', resourceId: 'res_1' } } });
  const owner = { role: 'owner', tenantId: 'ten_A' };
  const result = await setUserRole(requestWithClaims(owner, { uid: 'target', tenantId: 'ten_A', role: 'reception' }), auth);
  assert.strictEqual(result.resourceId, null);
  assert.strictEqual(auth.calls[0].claims.resourceId, null);
});

test('setUserRole hace MERGE, no overwrite -- preserva platformRole existente', async () => {
  const auth = fakeAuth({ target: { customClaims: { platformRole: 'superadmin' } } });
  const superadmin = { platformRole: 'superadmin' };
  await setUserRole(requestWithClaims(superadmin, { uid: 'target', tenantId: 'ten_A', role: 'owner' }), auth);
  assert.deepStrictEqual(auth.calls[0].claims, { platformRole: 'superadmin', role: 'owner', tenantId: 'ten_A', resourceId: null });
});

test('un superadmin puede asignar roles en CUALQUIER tenant, no solo el propio', async () => {
  const auth = fakeAuth({ target: { customClaims: {} } });
  const superadmin = { platformRole: 'superadmin' };
  const result = await setUserRole(requestWithClaims(superadmin, { uid: 'target', tenantId: 'ten_cualquiera', role: 'owner' }), auth);
  assert.strictEqual(result.tenantId, 'ten_cualquiera');
});
