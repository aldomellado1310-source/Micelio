const test = require('node:test');
const assert = require('node:assert');
const { buildAuditEntry } = require('../auditLog.js');

test('devuelve null si el documento no existe después del write (delete) -- fuera de alcance del goal 15', () => {
  const entry = buildAuditEntry({ before: { price: 1000, updatedBy: 'uid-1' }, after: null, collection: 'services', docId: 'svc1' });
  assert.strictEqual(entry, null);
});

test('action:"created" cuando before es null', () => {
  const entry = buildAuditEntry({ before: null, after: { price: 1000, updatedBy: 'uid-1' }, collection: 'services', docId: 'svc1' });
  assert.strictEqual(entry.action, 'created');
});

test('action:"updated" cuando before y after existen', () => {
  const entry = buildAuditEntry({
    before: { price: 1000, updatedBy: 'uid-1' },
    after: { price: 1200, updatedBy: 'uid-2' },
    collection: 'services', docId: 'svc1',
  });
  assert.strictEqual(entry.action, 'updated');
});

test('actorUid sale de after.updatedBy, no de before', () => {
  const entry = buildAuditEntry({
    before: { price: 1000, updatedBy: 'uid-viejo' },
    after: { price: 1200, updatedBy: 'uid-nuevo' },
    collection: 'services', docId: 'svc1',
  });
  assert.strictEqual(entry.actorUid, 'uid-nuevo');
});

test('actorUid es null si after no trae updatedBy', () => {
  const entry = buildAuditEntry({ before: null, after: { price: 1000 }, collection: 'services', docId: 'svc1' });
  assert.strictEqual(entry.actorUid, null);
});

test('collection/docId/before/after se copian tal cual', () => {
  const before = { price: 1000 };
  const after = { price: 1200, updatedBy: 'uid-1' };
  const entry = buildAuditEntry({ before, after, collection: 'services', docId: 'svc1' });
  assert.strictEqual(entry.collection, 'services');
  assert.strictEqual(entry.docId, 'svc1');
  assert.deepStrictEqual(entry.before, before);
  assert.deepStrictEqual(entry.after, after);
});

test('source usa el default "client" si no se pasa uno', () => {
  const entry = buildAuditEntry({ before: null, after: { updatedBy: 'uid-1' }, collection: 'services', docId: 'svc1' });
  assert.strictEqual(entry.source, 'client');
});

test('source respeta el valor explícito recibido', () => {
  const entry = buildAuditEntry({ before: null, after: { updatedBy: 'uid-1' }, collection: 'services', docId: 'svc1', source: 'migration' });
  assert.strictEqual(entry.source, 'migration');
});
