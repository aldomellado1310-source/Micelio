const test = require('node:test');
const assert = require('node:assert');
const { buildPlatformAuditEntry } = require('../platformAuditLog.js');

test('devuelve null si el documento después no existe (no debería pasar -- delete está prohibido en firestore.rules)', () => {
  assert.strictEqual(buildPlatformAuditEntry({ status: 'active' }, null), null);
});

test('tenant_created cuando no había documento antes', () => {
  const entry = buildPlatformAuditEntry(null, { status: 'active', updatedBy: 'super-uid' });
  assert.strictEqual(entry.action, 'tenant_created');
  assert.strictEqual(entry.actorUid, 'super-uid');
});

test('tenant_suspended cuando status pasa a suspended', () => {
  const entry = buildPlatformAuditEntry(
    { status: 'active', updatedBy: 'x' },
    { status: 'suspended', updatedBy: 'super-uid' },
  );
  assert.strictEqual(entry.action, 'tenant_suspended');
  assert.deepStrictEqual(entry.before, { status: 'active' });
  assert.deepStrictEqual(entry.after, { status: 'suspended' });
});

test('tenant_reactivated cuando status sale de suspended', () => {
  const entry = buildPlatformAuditEntry(
    { status: 'suspended', updatedBy: 'x' },
    { status: 'active', updatedBy: 'super-uid' },
  );
  assert.strictEqual(entry.action, 'tenant_reactivated');
});

test('tenant_updated cuando cambia otro campo sin cambiar status', () => {
  const entry = buildPlatformAuditEntry(
    { status: 'active', contactEmail: 'a@x.cl', updatedBy: 'x' },
    { status: 'active', contactEmail: 'b@x.cl', updatedBy: 'super-uid' },
  );
  assert.strictEqual(entry.action, 'tenant_updated');
});

test('actorUid es null si el documento no trae updatedBy (no debería pasar -- stamped() lo exige en firestore.rules)', () => {
  const entry = buildPlatformAuditEntry(null, { status: 'active' });
  assert.strictEqual(entry.actorUid, null);
});
