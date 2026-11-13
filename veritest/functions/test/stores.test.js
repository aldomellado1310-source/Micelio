'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryStore, createJsonlStore, createFirestoreStore } = require('../lib/stores.js');
const { sha256Hex } = require('../lib/hash.js');

// Huellas distintas para cada n (antes: dígitos repetidos, y las de n y n+1 se
// pisaban entre registros vecinos).
const h = (label) => sha256Hex(Buffer.from(label));

function rec(n, extra) {
  return Object.assign({
    id: String(n).padStart(22, 'A'),
    originalSha256: h('original-' + n),
    stampedSha256: h('stamped-' + n),
    holderName: 'X Y', title: 'T', issuerId: 'e1', issuerName: 'E', status: 'valid', registeredAt: 'z',
  }, extra);
}

test('memoria: guarda, busca por id y por cada huella, y entrega copias', async () => {
  const s = createMemoryStore();
  const r = rec(1);
  await s.insert(r);
  assert.deepEqual(await s.getById(r.id), r);
  assert.equal((await s.getByHash(r.originalSha256)).matched, 'original');
  assert.equal((await s.getByHash(r.stampedSha256)).matched, 'stamped');
  assert.equal(await s.getByHash('f'.repeat(64)), null);
  (await s.getById(r.id)).holderName = 'mutado';
  assert.equal((await s.getById(r.id)).holderName, 'X Y');
});

test('memoria: rechaza id repetido y huella repetida, sin dejar medio registro', async () => {
  const s = createMemoryStore();
  await s.insert(rec(1));
  await assert.rejects(s.insert(rec(1, { originalSha256: 'a'.repeat(64), stampedSha256: 'b'.repeat(64) })), (e) => e.code === 'id_collision');
  await assert.rejects(s.insert(rec(2, { stampedSha256: rec(1).originalSha256 })), (e) => e.code === 'already_registered');
  // El registro rechazado no dejó su otra huella colgada:
  assert.equal(await s.getByHash(rec(2).originalSha256), null);
  assert.equal(s.all().length, 1);
});

test('jsonl: persiste, recarga y valida unicidad contra lo que ya estaba en disco', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritest-jsonl-'));
  const file = path.join(dir, 'registry.jsonl');
  try {
    const a = createJsonlStore(file);
    await a.insert(rec(1));
    await a.insert(rec(3));
    const b = createJsonlStore(file); // proceso nuevo
    assert.equal(b.all().length, 2);
    assert.equal((await b.getById(rec(3).id)).id, rec(3).id);
    await assert.rejects(b.insert(rec(1)), (e) => e.code === 'id_collision');
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2); // lo rechazado no se escribió
    assert.equal(fs.statSync(file).mode & 0o077, 0, 'el registro lleva nombres: solo el dueño debe poder leerlo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('jsonl: un registro corrupto es un error explícito con el número de línea', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritest-jsonl-'));
  const file = path.join(dir, 'registry.jsonl');
  try {
    fs.writeFileSync(file, JSON.stringify(rec(1)) + '\n{no es json\n');
    assert.throws(() => createJsonlStore(file), (e) => e.code === 'corrupt_registry' && /línea 2/.test(e.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Firestore falso. Hace valer el invariante del repo: dentro de una
// transacción solo tx.get(); un ref.get() suelto durante la transacción
// revienta el test.
function fakeFirestore() {
  const data = new Map();
  let inTx = false;
  const db = {
    data,
    doc(p) {
      return {
        path: p,
        async get() {
          assert.equal(inTx, false, `db.doc("${p}").get() suelto dentro de una transacción`);
          return { exists: data.has(p), data: () => data.get(p) };
        },
      };
    },
    async runTransaction(fn) {
      inTx = true;
      const writes = [];
      try {
        const tx = {
          async get(ref) { return { exists: data.has(ref.path), data: () => data.get(ref.path) }; },
          set(ref, value) { writes.push([ref.path, JSON.parse(JSON.stringify(value))]); },
        };
        await fn(tx);
      } finally {
        inTx = false;
      }
      writes.forEach(([k, v]) => data.set(k, v)); // solo se confirma si fn no lanzó
    },
  };
  return db;
}

test('firestore: crea diplomas/{id} + hashes/{sha} y lee por id y por huella', async () => {
  const db = fakeFirestore();
  const s = createFirestoreStore(db);
  const r = rec(1);
  await s.insert(r);
  assert.deepEqual([...db.data.keys()].sort(), [`diplomas/${r.id}`, `hashes/${r.originalSha256}`, `hashes/${r.stampedSha256}`].sort());
  assert.deepEqual(await s.getById(r.id), r);
  const hit = await s.getByHash(r.stampedSha256);
  assert.equal(hit.matched, 'stamped');
  assert.equal(hit.record.id, r.id);
  assert.equal(await s.getById('Z'.repeat(22)), null);
  assert.equal(await s.getByHash('f'.repeat(64)), null);
});

test('firestore: rechaza duplicados dentro de la transacción y no escribe nada', async () => {
  const db = fakeFirestore();
  const s = createFirestoreStore(db);
  await s.insert(rec(1));
  const before = db.data.size;
  await assert.rejects(s.insert(rec(1, { originalSha256: 'a'.repeat(64), stampedSha256: 'b'.repeat(64) })), (e) => e.code === 'id_collision');
  await assert.rejects(s.insert(rec(2, { originalSha256: rec(1).stampedSha256 })), (e) => e.code === 'already_registered' && e.details.existingId === rec(1).id);
  assert.equal(db.data.size, before);
});
