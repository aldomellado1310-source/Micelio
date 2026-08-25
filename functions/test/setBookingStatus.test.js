const test = require('node:test');
const assert = require('node:assert');
const { resolveSetBookingStatus } = require('../setBookingStatus.js');

const NOW = new Date('2026-07-13T14:00:00.000Z');

test('devuelve not-found si la reserva no existe', () => {
  const result = resolveSetBookingStatus({ booking: null, toStatus: 'cancelled', now: NOW });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'not-found');
});

test('cancelar una reserva pending produce el update correcto (status/motivo/autor)', () => {
  const booking = { status: 'pending' };
  const result = resolveSetBookingStatus({ booking, toStatus: 'cancelled', reason: 'Cliente no pudo asistir', actor: 'uid-staff', now: NOW });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.update.status, 'cancelled');
  assert.strictEqual(result.update.statusReason, 'Cliente no pudo asistir');
  assert.strictEqual(result.update.updatedBy, 'uid-staff');
  assert.strictEqual(result.update.statusAt, NOW.toISOString());
  assert.strictEqual(result.update.modifiedCount, 1);
  assert.strictEqual(result.update.statusHistory.length, 1);
  assert.strictEqual(result.update.statusHistory[0].status, 'cancelled');
  assert.strictEqual(result.update.statusHistory[0].by, 'uid-staff');
});

test('reason es opcional -- queda null si no se pasa', () => {
  const result = resolveSetBookingStatus({ booking: { status: 'pending' }, toStatus: 'confirmed', now: NOW });
  assert.strictEqual(result.update.statusReason, null);
});

test('acumula sobre statusHistory/modifiedCount previos en vez de reemplazarlos', () => {
  const booking = {
    status: 'confirmed',
    statusHistory: [{ status: 'pending', at: '2026-07-10T10:00:00.000Z', reason: null, by: null }],
    modifiedCount: 1,
  };
  const result = resolveSetBookingStatus({ booking, toStatus: 'completed', actor: 'uid-staff', now: NOW });
  assert.strictEqual(result.update.modifiedCount, 2);
  assert.strictEqual(result.update.statusHistory.length, 2);
  assert.strictEqual(result.update.statusHistory[1].status, 'completed');
});

test('tolera una reserva vieja sin statusHistory/modifiedCount (de antes del goal 11)', () => {
  const booking = { status: 'pending' }; // sin statusHistory ni modifiedCount
  const result = resolveSetBookingStatus({ booking, toStatus: 'no_show', now: NOW });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.update.modifiedCount, 1);
  assert.strictEqual(result.update.statusHistory.length, 1);
});

test('rechaza una transición inválida con el error específico de validateStatusTransition, sin aplicar ningún update', () => {
  const result = resolveSetBookingStatus({ booking: { status: 'completed' }, toStatus: 'pending', now: NOW });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
  assert.strictEqual(result.update, undefined);
});

test('rechaza un toStatus desconocido', () => {
  const result = resolveSetBookingStatus({ booking: { status: 'pending' }, toStatus: 'en_progreso', now: NOW });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'invalid-argument');
});
