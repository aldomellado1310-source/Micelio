// Cross-check del goal 10 (Etapa A, pool ReservaGo) -- REQUISITO DURO: un
// servicio SIN requires debe producir exactamente los mismos cupos que el
// criterio legado (computeAvailability + isRangeFree, "cualquier barbero
// activo libre"), para el mismo set de reservas/horarios/bloqueos, dentro
// de un tenant de prueba.
//
// Captura una jornada completa con el motor VIEJO (staff/barberId), la
// misma jornada traducida al modelo de resources del goal 9 con el motor
// NUEVO (computeResourceAvailability/isServiceBookableAt) usando el
// requires por defecto (normalizeServiceRequires de un servicio sin
// requires), y compara slot por slot -- revienta si cualquiera de los dos
// motores diverge.
const test = require('node:test');
const assert = require('node:assert');
const {
  computeAvailability, computeResourceAvailability, isServiceBookableAt,
  isRangeFree, toMinutes, toHHMM, addMinutesToTime,
} = require('../shared/availability.js');
const { normalizeServiceRequires } = require('../shared/service.js');

const DOW = 1; // lunes, mismo día para ambos motores
const BUFFER_MIN = 10;

const staff = [
  {
    id: 'felipe', status: 'active',
    schedule: buildWeek({ open: true, start: '09:00', end: '18:00', break: { start: '13:00', end: '14:00' } }),
  },
  {
    id: 'victoria', status: 'active',
    schedule: buildWeek({ open: true, start: '09:00', end: '19:00' }),
  },
  {
    id: 'retirado', status: 'inactive',
    schedule: buildWeek({ open: true, start: '09:00', end: '18:00' }),
  },
];

const bookings = [
  { barberId: 'felipe', date: '2026-07-13', time: '10:00', dur: 50 },
  { barberId: 'victoria', date: '2026-07-13', time: '11:00', dur: 30 },
  { barberId: 'felipe', date: '2026-07-13', time: '15:00', dur: 60 },
];

const scheduleBlocks = [
  { barberId: 'felipe', start: '16:00', end: '16:30' },
];

function buildWeek(day) { return new Array(7).fill(null).map(() => Object.assign({}, day)); }

// -- Motor VIEJO: computeAvailability + isRangeFree, "cualquier barbero
// activo libre" (el comportamiento implícito que el goal 10 debe preservar).
const legacy = computeAvailability({ bookings, staff, barberId: 'any', dow: DOW, scheduleBlocks });
function legacyBookable(startHHMM, endHHMM) {
  return legacy.activeBarberIds.some((id) => isRangeFree(legacy.barberBusy[id] || [], startHHMM, endHHMM, BUFFER_MIN));
}

// -- Motor NUEVO: mismos datos traducidos al modelo tenant-aware del goal 9
// (resources en vez de staff, resourceIds[] en vez de barberId), consumidos
// por un servicio SIN requires (normalizeServiceRequires del default).
const resources = staff.map((s) => ({ id: s.id, kind: 'person', active: s.status === 'active', schedule: s.schedule }));
const resourceBookings = bookings.map((b) => ({ time: b.time, dur: b.dur, resourceIds: [b.barberId] }));
const resourceBlocks = scheduleBlocks.map((blk) => ({ resourceId: blk.barberId, start: blk.start, end: blk.end }));
const requires = normalizeServiceRequires({}); // servicio sin requires

const modern = computeResourceAvailability({ bookings: resourceBookings, resources, dow: DOW, scheduleBlocks: resourceBlocks });
function modernBookable(startHHMM, endHHMM) {
  return isServiceBookableAt(requires, modern.activeResources, modern.resourceBusy, startHHMM, endHHMM, BUFFER_MIN);
}

test('un servicio sin requires produce exactamente los mismos cupos que el criterio legado, slot por slot en todo el día', () => {
  let trueCount = 0;
  let falseCount = 0;
  for (let m = toMinutes('09:00'); m <= toMinutes('19:30'); m += 15) {
    const start = toHHMM(m);
    const end = addMinutesToTime(start, 30);
    const legacyResult = legacyBookable(start, end);
    const modernResult = modernBookable(start, end);
    assert.strictEqual(modernResult, legacyResult, `divergencia en el slot ${start}-${end}: legado=${legacyResult}, nuevo=${modernResult}`);
    if (legacyResult) trueCount++; else falseCount++;
  }
  // Test no vacío: la jornada de prueba debe producir tanto slots libres
  // como ocupados, si no la comparación de arriba no probaría nada real.
  assert.ok(trueCount > 0, 'la captura de prueba no tiene ningún slot libre');
  assert.ok(falseCount > 0, 'la captura de prueba no tiene ningún slot ocupado');
});

test('activeResources excluye recursos inactivos, igual que activeBarberIds', () => {
  assert.deepStrictEqual(legacy.activeBarberIds.slice().sort(), ['felipe', 'victoria']);
  assert.deepStrictEqual(modern.activeResources.map((r) => r.id).sort(), ['felipe', 'victoria']);
});
