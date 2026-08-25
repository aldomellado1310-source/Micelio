const test = require('node:test');
const assert = require('node:assert');
const {
  BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, OCCUPYING_STATUSES,
  isValidBookingStatus, isTerminalStatus, getValidNextStatuses, occupiesSlot, validateStatusTransition,
} = require('../shared/status.js');

test('DEFAULT_BOOKING_STATUS es pending', () => {
  assert.strictEqual(DEFAULT_BOOKING_STATUS, 'pending');
});

test('BOOKING_STATUSES incluye el default y los 5 estados del ciclo de vida', () => {
  assert.ok(BOOKING_STATUSES.indexOf(DEFAULT_BOOKING_STATUS) !== -1);
  assert.deepStrictEqual(BOOKING_STATUSES.slice().sort(), ['cancelled', 'completed', 'confirmed', 'no_show', 'pending']);
});

test('isValidBookingStatus acepta los 5 estados reconocidos y rechaza cualquier otro valor', () => {
  BOOKING_STATUSES.forEach((s) => assert.strictEqual(isValidBookingStatus(s), true));
  assert.strictEqual(isValidBookingStatus('en_progreso'), false);
  assert.strictEqual(isValidBookingStatus(''), false);
  assert.strictEqual(isValidBookingStatus(undefined), false);
});

test('isTerminalStatus: completed/cancelled/no_show son terminales, pending/confirmed no', () => {
  assert.strictEqual(isTerminalStatus('completed'), true);
  assert.strictEqual(isTerminalStatus('cancelled'), true);
  assert.strictEqual(isTerminalStatus('no_show'), true);
  assert.strictEqual(isTerminalStatus('pending'), false);
  assert.strictEqual(isTerminalStatus('confirmed'), false);
});

test('getValidNextStatuses devuelve las transiciones declaradas y [] para un estado terminal', () => {
  assert.deepStrictEqual(getValidNextStatuses('pending').sort(), ['cancelled', 'confirmed', 'no_show']);
  assert.deepStrictEqual(getValidNextStatuses('confirmed').sort(), ['cancelled', 'completed', 'no_show']);
  assert.deepStrictEqual(getValidNextStatuses('completed'), []);
});

test('occupiesSlot: solo pending/confirmed/completed ocupan cupo', () => {
  OCCUPYING_STATUSES.forEach((s) => assert.strictEqual(occupiesSlot(s), true));
  assert.strictEqual(occupiesSlot('cancelled'), false);
  assert.strictEqual(occupiesSlot('no_show'), false);
});

test('occupiesSlot trata un status ausente/desconocido como que SÍ ocupa (conservador)', () => {
  assert.strictEqual(occupiesSlot(undefined), true);
  assert.strictEqual(occupiesSlot('algo-raro'), true);
});

// Cada transición válida declarada -- goal 12 pide cubrir CADA UNA.
const VALID_TRANSITIONS = [
  ['pending', 'confirmed'],
  ['pending', 'cancelled'],
  ['pending', 'no_show'],
  ['confirmed', 'completed'],
  ['confirmed', 'cancelled'],
  ['confirmed', 'no_show'],
];
VALID_TRANSITIONS.forEach(([from, to]) => {
  test(`validateStatusTransition acepta ${from} -> ${to}`, () => {
    assert.deepStrictEqual(validateStatusTransition(from, to), { ok: true });
  });
});

// Al menos tres transiciones inválidas, cada una con un motivo específico
// distinto -- goal 12 pide "un error específico, no genérico".
test('validateStatusTransition rechaza un estado actual terminal (completed) con failed-precondition', () => {
  const result = validateStatusTransition('completed', 'pending');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
  assert.match(result.message, /estado terminal/);
});

test('validateStatusTransition rechaza una transición no declarada (pending -> completed) con failed-precondition', () => {
  const result = validateStatusTransition('pending', 'completed');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
  assert.match(result.message, /Transición no permitida/);
});

test('validateStatusTransition rechaza un estado destino desconocido con invalid-argument', () => {
  const result = validateStatusTransition('pending', 'en_progreso');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'invalid-argument');
  assert.match(result.message, /destino desconocido/);
});

test('validateStatusTransition rechaza un estado actual desconocido con failed-precondition', () => {
  const result = validateStatusTransition('en_progreso', 'confirmed');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'failed-precondition');
  assert.match(result.message, /actual desconocido/);
});

test('validateStatusTransition rechaza retroceder confirmed -> pending (no declarada)', () => {
  const result = validateStatusTransition('confirmed', 'pending');
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Transición no permitida/);
});
