'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertVeritestProject } = require('../scripts/_guard.js');
const { importRecords } = require('../scripts/importRegistry.js');
const { createMemoryStore } = require('../lib/stores.js');
const { sha256Hex } = require('../lib/hash.js');

const h = (s) => sha256Hex(Buffer.from(s));
const rec = (n, extra) => Object.assign({
  id: String(n).padStart(22, 'B'), originalSha256: h('o' + n), stampedSha256: h('s' + n),
  holderName: 'X Y', title: 'T', issuerId: 'e1', issuerName: 'E', status: 'valid', registeredAt: 'z',
}, extra);

test('guard: se niega a correr contra los proyectos del sistema de reservas y contra placeholders', () => {
  for (const bad of ['scissor-white', 'registrago001', 'REEMPLAZAR-con-el-id', undefined, '', null, 42]) {
    assert.throws(() => assertVeritestProject(bad), Error, String(bad));
  }
  assert.equal(assertVeritestProject('veritest-prod'), 'veritest-prod');
});

test('importRecords carga todo en una base vacía', async () => {
  const store = createMemoryStore();
  const t = await importRecords([rec(1), rec(2)], store, () => {});
  assert.deepEqual(t, { inserted: 2, skipped: 0, conflicts: 0 });
});

test('importRecords es idempotente: correr dos veces el mismo registro no duplica ni falla', async () => {
  const store = createMemoryStore();
  await importRecords([rec(1), rec(2)], store, () => {});
  const t = await importRecords([rec(1), rec(2), rec(3)], store, () => {});
  assert.deepEqual(t, { inserted: 1, skipped: 2, conflicts: 0 });
  assert.equal(store.all().length, 3);
});

test('importRecords informa CONFLICTO (y no pisa) si el id existe con contenido distinto', async () => {
  const store = createMemoryStore();
  await importRecords([rec(1)], store, () => {});
  const logs = [];
  const t = await importRecords([rec(1, { holderName: 'Otro Nombre', originalSha256: h('x'), stampedSha256: h('y') })], store, (m) => logs.push(m));
  assert.deepEqual(t, { inserted: 0, skipped: 0, conflicts: 1 });
  assert.match(logs[0], /CONFLICTO/);
  assert.equal((await store.getById(rec(1).id)).holderName, 'X Y');
});

test('importRecords: una huella ya registrada bajo OTRO id es conflicto, no omisión', async () => {
  const store = createMemoryStore();
  await importRecords([rec(1)], store, () => {});
  const clash = rec(2, { originalSha256: rec(1).originalSha256 });
  const t = await importRecords([clash], store, () => {});
  assert.equal(t.conflicts, 1);
  assert.equal(store.all().length, 1);
});
