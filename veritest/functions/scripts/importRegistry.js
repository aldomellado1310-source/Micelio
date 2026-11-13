// veritest/functions/scripts/importRegistry.js
//
// Carga a Firestore el registro local (JSONL) que produjo el CLI mientras no
// existía el proyecto Firebase de Veritest. Es idempotente: un diploma que ya
// está cargado (mismo id y mismo contenido) se omite; un id que existe con
// contenido DISTINTO es un conflicto y se informa sin pisar nada.
//
// Con FIRESTORE_EMULATOR_HOST definido usa el emulador (sin credenciales).
//
// Uso:
//   cd veritest/functions
//   node scripts/importRegistry.js --project <proyecto-veritest> --registry ../veritest-registry.jsonl [--dry-run]
'use strict';
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { assertVeritestProject } = require('./_guard.js');
const { createFirestoreStore, createMemoryStore } = require('../lib/stores.js');
const { VeritestError } = require('../lib/errors.js');

function sameRecord(a, b) {
  return JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
}

// Función pura sobre un `store`, para poder probarla sin Firestore.
async function importRecords(records, store, log) {
  const tally = { inserted: 0, skipped: 0, conflicts: 0 };
  for (const rec of records) {
    try {
      await store.insert(rec);
      tally.inserted++;
    } catch (e) {
      if (!(e instanceof VeritestError)) throw e;
      const existing = await store.getById(rec.id);
      if (existing && sameRecord(existing, rec)) {
        tally.skipped++;
      } else {
        tally.conflicts++;
        log(`CONFLICTO ${rec.id}: ${e.code} -- ya existe algo distinto; no se pisa.`);
      }
    }
  }
  return tally;
}

async function main() {
  const { values } = parseArgs({
    options: { project: { type: 'string' }, registry: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const project = assertVeritestProject(values.project);
  if (!values.registry) throw new Error('Falta --registry <archivo.jsonl>.');
  const records = fs.readFileSync(values.registry, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`${values.registry}: línea ${i + 1} no es JSON válido.`); }
  });

  let store;
  if (values['dry-run']) {
    store = createMemoryStore();
  } else {
    initializeApp({ credential: process.env.FIRESTORE_EMULATOR_HOST ? undefined : applicationDefault(), projectId: project });
    store = createFirestoreStore(getFirestore());
  }
  const t = await importRecords(records, store, console.error);
  console.log(`${values['dry-run'] ? '[dry-run] ' : ''}${records.length} registros: ${t.inserted} cargados, ${t.skipped} ya estaban, ${t.conflicts} en conflicto.`);
  process.exitCode = t.conflicts ? 1 : 0;
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });

module.exports = { importRecords };
