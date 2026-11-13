// veritest/functions/lib/stores.js
//
// Tres implementaciones de la MISMA interfaz de registro:
//
//   getById(id)       -> record | null
//   getByHash(sha256) -> { record, matched: 'original'|'stamped' } | null
//   insert(record)    -> void   (atómico: rechaza id repetido y huella repetida)
//
//   * memory    -- tests.
//   * jsonl     -- el CLI: registro local en un archivo (una línea por
//                  diploma). Sirve MIENTRAS no exista el proyecto Firebase de
//                  Veritest; después se carga con scripts/importRegistry.js.
//   * firestore -- producción: diplomas/{id} + hashes/{sha256}, solo Admin SDK
//                  (firestore.rules niega todo acceso de cliente).
//
// Por qué hashes/{sha256} aparte: así buscar por huella es un get() directo,
// sin consultas ni índices, y la unicidad de huella se hace valer dentro de
// la misma transacción que crea el diploma.
'use strict';
const fs = require('node:fs');
const { VeritestError } = require('./errors.js');

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function hashesOf(record) {
  const out = [{ hash: record.originalSha256, kind: 'original' }];
  if (record.stampedSha256 !== record.originalSha256) {
    out.push({ hash: record.stampedSha256, kind: 'stamped' });
  } else {
    out[0].kind = 'stamped';
  }
  return out;
}

function createMemoryStore(initial) {
  const byId = new Map();
  const byHash = new Map();

  function put(record) {
    if (byId.has(record.id)) {
      throw new VeritestError('id_collision', 'Ya existe un diploma con ese id.');
    }
    const hs = hashesOf(record);
    for (const { hash } of hs) {
      const hit = byHash.get(hash);
      if (hit) {
        throw new VeritestError('already_registered', 'Este PDF ya está registrado en Veritest.', {
          existingId: hit.id, matched: hit.kind,
        });
      }
    }
    byId.set(record.id, clone(record));
    for (const { hash, kind } of hs) byHash.set(hash, { id: record.id, kind });
  }

  (initial || []).forEach(put);

  return {
    async getById(id) { return clone(byId.get(id)) || null; },
    async getByHash(hash) {
      const hit = byHash.get(hash);
      return hit ? { record: clone(byId.get(hit.id)), matched: hit.kind } : null;
    },
    async insert(record) { put(record); },
    all() { return Array.from(byId.values()).map(clone); },
  };
}

function createJsonlStore(filePath) {
  const records = [];
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        records.push(JSON.parse(line));
      } catch (e) {
        throw new VeritestError('corrupt_registry', `${filePath}: línea ${i + 1} no es JSON válido.`);
      }
    });
  }
  const mem = createMemoryStore(records);
  return {
    getById: mem.getById,
    getByHash: mem.getByHash,
    all: mem.all,
    async insert(record) {
      await mem.insert(record); // valida unicidad antes de escribir al disco
      // 0o600: el registro lleva nombres de personas.
      fs.appendFileSync(filePath, JSON.stringify(record) + '\n', { mode: 0o600 });
    },
  };
}

function createFirestoreStore(db) {
  async function getById(id) {
    const snap = await db.doc(`diplomas/${id}`).get();
    return snap.exists ? snap.data() : null;
  }
  async function getByHash(hash) {
    const snap = await db.doc(`hashes/${hash}`).get();
    if (!snap.exists) return null;
    const { id, kind } = snap.data();
    const record = await getById(id);
    return record ? { record, matched: kind } : null;
  }
  async function insert(record) {
    const idRef = db.doc(`diplomas/${record.id}`);
    const hs = hashesOf(record);
    await db.runTransaction(async (tx) => {
      // Dentro de la transacción SOLO tx.get() -- nunca db.get() suelto.
      const idSnap = await tx.get(idRef);
      const hashSnaps = [];
      for (const { hash } of hs) hashSnaps.push(await tx.get(db.doc(`hashes/${hash}`)));
      if (idSnap.exists) throw new VeritestError('id_collision', 'Ya existe un diploma con ese id.');
      for (const s of hashSnaps) {
        if (s.exists) {
          const d = s.data();
          throw new VeritestError('already_registered', 'Este PDF ya está registrado en Veritest.', {
            existingId: d.id, matched: d.kind,
          });
        }
      }
      tx.set(idRef, record);
      for (const { hash, kind } of hs) tx.set(db.doc(`hashes/${hash}`), { id: record.id, kind });
    });
  }
  return { getById, getByHash, insert };
}

module.exports = { createMemoryStore, createJsonlStore, createFirestoreStore };
