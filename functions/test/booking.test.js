const test = require('node:test');
const assert = require('node:assert');
const { STATUS_HISTORY_MAX, appendStatusHistory, buildBookingLifecycleFields } = require('../shared/booking.js');

const NOW = new Date('2026-07-13T14:00:00.000Z');

test('buildBookingLifecycleFields inicializa status en el default y lo refleja en statusAt/statusHistory', () => {
  const fields = buildBookingLifecycleFields({ resourceIds: ['res_ana'], now: NOW, actor: null });
  assert.strictEqual(fields.status, 'pending');
  assert.strictEqual(fields.statusAt, NOW.toISOString());
  assert.strictEqual(fields.statusReason, null);
  assert.strictEqual(fields.statusHistory.length, 1);
  assert.strictEqual(fields.statusHistory[0].status, 'pending');
  assert.strictEqual(fields.statusHistory[0].at, NOW.toISOString());
});

test('resourceIds es la fuente de verdad y barberId es un espejo de resourceIds[0]', () => {
  const fields = buildBookingLifecycleFields({ resourceIds: ['res_ana', 'res_box1'], now: NOW });
  assert.deepStrictEqual(fields.resourceIds, ['res_ana', 'res_box1']);
  assert.strictEqual(fields.barberId, 'res_ana');
});

test('barberId es null cuando resourceIds viene vacío o ausente', () => {
  assert.strictEqual(buildBookingLifecycleFields({ resourceIds: [], now: NOW }).barberId, null);
  assert.strictEqual(buildBookingLifecycleFields({ now: NOW }).barberId, null);
  assert.deepStrictEqual(buildBookingLifecycleFields({ now: NOW }).resourceIds, []);
});

test('remindAt/reminderSentAt/manageTokenV/modifiedCount se crean con su valor inicial, sin usarse todavía', () => {
  const fields = buildBookingLifecycleFields({ resourceIds: ['res_ana'], now: NOW });
  assert.strictEqual(fields.remindAt, null);
  assert.strictEqual(fields.reminderSentAt, null);
  assert.strictEqual(fields.manageTokenV, 0);
  assert.strictEqual(fields.modifiedCount, 0);
});

test('updatedBy/updatedAt reflejan el actor recibido, o null para una reserva pública sin autenticar', () => {
  const anon = buildBookingLifecycleFields({ resourceIds: ['res_ana'], now: NOW });
  assert.strictEqual(anon.updatedBy, null);
  const staff = buildBookingLifecycleFields({ resourceIds: ['res_ana'], now: NOW, actor: 'uid-staff' });
  assert.strictEqual(staff.updatedBy, 'uid-staff');
  assert.strictEqual(staff.statusHistory[0].by, 'uid-staff');
});

test('appendStatusHistory agrega al final y trunca a STATUS_HISTORY_MAX, sin perder la entrada más nueva', () => {
  let history = [];
  for (let i = 0; i < STATUS_HISTORY_MAX + 5; i++) {
    history = appendStatusHistory(history, { status: 'pending', at: String(i) });
  }
  assert.strictEqual(history.length, STATUS_HISTORY_MAX);
  assert.strictEqual(history[history.length - 1].at, String(STATUS_HISTORY_MAX + 4));
  // Las 5 primeras (más viejas) se descartaron -- solo quedan del índice 5 en adelante.
  assert.strictEqual(history[0].at, '5');
});

test('appendStatusHistory no falla si la historia previa no es un array', () => {
  const history = appendStatusHistory(undefined, { status: 'pending', at: NOW.toISOString() });
  assert.strictEqual(history.length, 1);
});
