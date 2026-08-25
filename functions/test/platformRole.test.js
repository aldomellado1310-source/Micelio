const test = require('node:test');
const assert = require('node:assert');
const { isSuperadmin, assertSuperadmin, setPlatformRole } = require('../platformRole.js');

function requestWithClaims(claims) {
  return { auth: claims ? { token: claims } : null, data: {} };
}

// Stub mínimo de Admin SDK Auth: solo lo que setPlatformRole toca
// (getUser/setCustomUserClaims), con espía de las llamadas para poder
// verificar el merge.
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

test('isSuperadmin: true solo con platformRole:superadmin', () => {
  assert.strictEqual(isSuperadmin(requestWithClaims({ platformRole: 'superadmin' })), true);
});

test('isSuperadmin: false sin auth, sin claim, o con otro claim (admin/tenantId)', () => {
  assert.strictEqual(isSuperadmin(requestWithClaims(null)), false);
  assert.strictEqual(isSuperadmin(requestWithClaims({})), false);
  assert.strictEqual(isSuperadmin(requestWithClaims({ admin: true })), false);
  assert.strictEqual(isSuperadmin(requestWithClaims({ tenantId: 'ten_A', role: 'owner' })), false);
});

test('assertSuperadmin no lanza para un superadmin', () => {
  assert.doesNotThrow(() => assertSuperadmin(requestWithClaims({ platformRole: 'superadmin' })));
});

test('assertSuperadmin rechaza a un usuario con role de tenant (no invoca setPlatformRole)', () => {
  assert.throws(
    () => assertSuperadmin(requestWithClaims({ tenantId: 'ten_A', role: 'owner' })),
    (err) => err.code === 'permission-denied',
  );
});

test('setPlatformRole rechaza si quien llama no es superadmin', async () => {
  const auth = fakeAuth({});
  const request = Object.assign(requestWithClaims({ tenantId: 'ten_A', role: 'owner' }), { data: { uid: 'target-uid', role: 'superadmin' } });
  await assert.rejects(
    () => setPlatformRole(request, auth),
    (err) => err.code === 'permission-denied',
  );
  assert.strictEqual(auth.calls.length, 0, 'no debe haber tocado Auth si no es superadmin');
});

test('setPlatformRole rechaza uid faltante', async () => {
  const auth = fakeAuth({});
  const request = Object.assign(requestWithClaims({ platformRole: 'superadmin' }), { data: { role: 'superadmin' } });
  await assert.rejects(() => setPlatformRole(request, auth), (err) => err.code === 'invalid-argument');
});

test('setPlatformRole rechaza un role fuera de la lista soportada', async () => {
  const auth = fakeAuth({ 'target-uid': { customClaims: {} } });
  const request = Object.assign(requestWithClaims({ platformRole: 'superadmin' }), { data: { uid: 'target-uid', role: 'mega-admin' } });
  await assert.rejects(() => setPlatformRole(request, auth), (err) => err.code === 'invalid-argument');
});

test('setPlatformRole otorga platformRole:superadmin a un usuario sin claims previos', async () => {
  const auth = fakeAuth({ 'target-uid': { customClaims: undefined } });
  const request = Object.assign(requestWithClaims({ platformRole: 'superadmin' }), { data: { uid: 'target-uid', role: 'superadmin' } });
  const result = await setPlatformRole(request, auth);
  assert.deepStrictEqual(result, { uid: 'target-uid', platformRole: 'superadmin' });
  assert.deepStrictEqual(auth.calls[0].claims, { platformRole: 'superadmin' });
});

test('setPlatformRole hace MERGE, no overwrite -- preserva claims de negocio existentes (tenantId/role del goal 14)', async () => {
  const auth = fakeAuth({ 'target-uid': { customClaims: { tenantId: 'ten_A', role: 'owner' } } });
  const request = Object.assign(requestWithClaims({ platformRole: 'superadmin' }), { data: { uid: 'target-uid', role: 'superadmin' } });
  await setPlatformRole(request, auth);
  assert.deepStrictEqual(auth.calls[0].claims, { tenantId: 'ten_A', role: 'owner', platformRole: 'superadmin' });
});
