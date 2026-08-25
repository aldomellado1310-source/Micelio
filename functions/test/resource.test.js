const test = require('node:test');
const assert = require('node:assert');
const { RESOURCE_KINDS, DAYS_PER_WEEK, isValidResourcePayload, isValidSchedule } = require('../shared/resource.js');

function closedDay() { return { open: false }; }
function openDay(extra) { return Object.assign({ open: true, start: '10:00', end: '20:00' }, extra); }
function week(day) { return new Array(DAYS_PER_WEEK).fill(null).map(() => day()); }

test('RESOURCE_KINDS son person, space y equipment', () => {
  assert.deepStrictEqual(RESOURCE_KINDS, ['person', 'space', 'equipment']);
});

test('isValidResourcePayload acepta un person con profile y schedule válido', () => {
  const data = {
    kind: 'person', name: 'Ana', active: true,
    schedule: week(closedDay),
    profile: { photo: 'https://x/y.jpg', bio: 'Barbera' },
  };
  assert.strictEqual(isValidResourcePayload(data), true);
});

test('isValidResourcePayload acepta un space/equipment SIN profile', () => {
  const base = { name: 'Box 1', active: true, schedule: week(closedDay) };
  assert.strictEqual(isValidResourcePayload(Object.assign({ kind: 'space' }, base)), true);
  assert.strictEqual(isValidResourcePayload(Object.assign({ kind: 'equipment' }, base)), true);
});

test('isValidResourcePayload rechaza profile en un kind distinto de person', () => {
  const data = {
    kind: 'space', name: 'Box 1', active: true,
    schedule: week(closedDay), profile: { bio: 'no debería existir' },
  };
  assert.strictEqual(isValidResourcePayload(data), false);
});

test('isValidResourcePayload acepta un person SIN profile (opcional)', () => {
  const data = { kind: 'person', name: 'Ana', active: true, schedule: week(closedDay) };
  assert.strictEqual(isValidResourcePayload(data), true);
});

test('isValidResourcePayload rechaza kind desconocido', () => {
  const data = { kind: 'robot', name: 'x', active: true, schedule: week(closedDay) };
  assert.strictEqual(isValidResourcePayload(data), false);
});

test('isValidResourcePayload rechaza name vacío o ausente', () => {
  const base = { kind: 'space', active: true, schedule: week(closedDay) };
  assert.strictEqual(isValidResourcePayload(Object.assign({ name: '' }, base)), false);
  assert.strictEqual(isValidResourcePayload(Object.assign({ name: '   ' }, base)), false);
  assert.strictEqual(isValidResourcePayload(base), false);
});

test('isValidResourcePayload rechaza active que no sea booleano', () => {
  const data = { kind: 'space', name: 'x', active: 'true', schedule: week(closedDay) };
  assert.strictEqual(isValidResourcePayload(data), false);
});

test('isValidSchedule exige exactamente 7 días', () => {
  assert.strictEqual(isValidSchedule(new Array(6).fill({ open: false })), false);
  assert.strictEqual(isValidSchedule(new Array(7).fill({ open: false })), true);
  assert.strictEqual(isValidSchedule(new Array(8).fill({ open: false })), false);
});

test('un día cerrado no necesita start/end/break', () => {
  assert.strictEqual(isValidSchedule(week(closedDay)), true);
});

test('un día abierto exige start/end en formato HH:MM', () => {
  const days = week(closedDay);
  days[0] = { open: true, start: '10:00', end: '20:00' };
  assert.strictEqual(isValidSchedule(days), true);
  const badDays = week(closedDay);
  badDays[0] = { open: true, start: '10h', end: '20:00' };
  assert.strictEqual(isValidSchedule(badDays), false);
});

test('un día abierto sin start/end es inválido', () => {
  const days = week(closedDay);
  days[0] = { open: true };
  assert.strictEqual(isValidSchedule(days), false);
});

test('break es opcional pero si viene debe ser un rango completo', () => {
  const days = week(closedDay);
  days[0] = openDay({ break: { start: '13:00', end: '14:00' } });
  assert.strictEqual(isValidSchedule(days), true);

  const badDays = week(closedDay);
  badDays[0] = openDay({ break: { start: '13:00' } });
  assert.strictEqual(isValidSchedule(badDays), false);
});

test('isValidResourcePayload rechaza payload no-objeto', () => {
  assert.strictEqual(isValidResourcePayload(null), false);
  assert.strictEqual(isValidResourcePayload(undefined), false);
  assert.strictEqual(isValidResourcePayload('x'), false);
});
