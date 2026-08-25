// functions/test/crosscheck.solape.test.js — cross-check de solape entre las
// TRES superficies: functions/shared/availability.js (autoridad real,
// isRangeFree), public/index.html (widget público, isBarberFreeAt) y
// public/admin/index.html (panel admin, checkConflict). Goal 3 del pool
// ReservaGo pide "que exista de nuevo" este test -- se buscó en el historial
// de git (`git log --all -p -- '*crosscheck*'`) antes de escribirlo: el repo
// solo tiene un "Initial commit" (historia aplastada de una migración
// anterior), y el único cross-check que sobrevivió ahí es
// tests/rules/createBooking.crosscheck.test.js (isValidBooking() CEL vs.
// isValidBookingPayload() JS) -- un cross-check DISTINTO, de validación, no
// de solape entre las tres superficies. Este archivo es nuevo.
//
// CÓMO: en vez de reimplementar isBarberFreeAt()/checkConflict() a mano acá
// (lo que sería una CUARTA copia, y no detectaría una divergencia real en el
// HTML), este test lee el texto real de public/index.html y
// public/admin/index.html, extrae las funciones puntuales que resuelven
// solape, y las ejecuta en un contexto vm con el mínimo de globals que cada
// una necesita (AVAIL/BARBERS/S para el widget; getBookings/D.staff para el
// admin). Si alguien reintroduce una implementación de solape distinta en
// cualquiera de los dos HTML, este test la ejecuta tal cual quedó escrita
// -- no una copia congelada -- y el cross-check revienta.
//
// Después de goal 2 (bundle SWCore) el widget y el admin YA NO tienen su
// propia aritmética de solape: ambos llaman a SWCore.overlaps() (el mismo
// functions/shared/availability.js#overlaps empaquetado). Este test sigue
// teniendo valor pese a eso: cubre toda la lógica alrededor del predicado
// (conversión HH:MM->minutos, aplicación del buffer, filtro de fecha en el
// admin, colación en el widget) -- una divergencia ahí sería tan real como
// una en el predicado mismo, y como corre el texto ACTUAL del HTML, revienta
// si alguien la reintroduce sin querer.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { isRangeFree } = require('../shared/availability.js');
const SWCore = require('../shared/index.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WIDGET_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public/index.html'), 'utf8');
const ADMIN_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public/admin/index.html'), 'utf8');

// Extrae el texto entre dos marcadores (líneas exactas, sin regex frágil de
// contenido interno) -- `startLine` inclusive, `endLine` exclusive. Lanza si
// alguno de los dos no aparece: preferible a extraer silenciosamente el
// bloque equivocado si el HTML cambió de forma.
function extractBetween(source, startLine, endLine) {
  const lines = source.split('\n');
  const s = lines.findIndex(l => l.trim() === startLine.trim());
  const e = lines.findIndex(l => l.trim() === endLine.trim());
  if (s === -1) throw new Error(`No se encontró la línea de inicio: ${JSON.stringify(startLine)}`);
  if (e === -1) throw new Error(`No se encontró la línea de fin: ${JSON.stringify(endLine)}`);
  if (e <= s) throw new Error(`La línea de fin aparece antes que la de inicio (${JSON.stringify(startLine)} / ${JSON.stringify(endLine)})`);
  return lines.slice(s, e).join('\n');
}

// ═══ WIDGET (public/index.html) ═══
// toMin + dowOfDateKey + isBarberFreeAt, tal como viven hoy en el archivo.
const widgetSrc = [
  extractBetween(WIDGET_HTML, 'const toMin = SWCore.toMinutes;', 'function dowOfDateKey(dateKey){'),
  extractBetween(WIDGET_HTML, 'function dowOfDateKey(dateKey){', '// STATE'),
  extractBetween(WIDGET_HTML, 'function isBarberFreeAt(barberId, candStart, candEnd){', 'function isSlotAvailable(candStart, candEnd){'),
].join('\n');

function widgetIsFree({ barberId, dateKey, existingBookings, bufferMin, candTime, candDur }) {
  const ctx = {
    SWCore,
    AVAIL: { barberBusy: { [barberId]: existingBookings.map(b => ({ start: b.time, end: SWCore.addMinutesToTime(b.time, b.dur), kind: 'booking' })) } },
    // Sin colación configurada (schedule: []) -- este cross-check compara el
    // camino de "otras reservas", no el de colación (que no existe en
    // functions/shared/availability.js como concepto separado, solo como
    // otro rango `busy` más -- ver computeAvailability).
    BARBERS: [{ id: barberId, any: false, schedule: [] }],
    S: { date: dateKey },
    BUSINESS_BUFFER_MIN: bufferMin || 0,
  };
  vm.createContext(ctx);
  vm.runInContext(widgetSrc, ctx);
  const candStart = SWCore.toMinutes(candTime);
  const candEnd = candStart + candDur;
  return ctx.isBarberFreeAt(barberId, candStart, candEnd);
}

// ═══ ADMIN (public/admin/index.html) ═══
// checkConflict + toMin + dowOfDateKey, tal como viven hoy en el archivo.
const adminSrc = [
  extractBetween(ADMIN_HTML, 'function checkConflict(barberId, dateStr, timeStr, durMin, ignoreId, bufferMin){', 'var toMin = SWCore.toMinutes;'),
  extractBetween(ADMIN_HTML, 'var toMin = SWCore.toMinutes;', 'function parseDt(dateStr, timeStr){'),
].join('\n');

function adminIsFree({ barberId, dateKey, existingBookings, bufferMin, candTime, candDur }) {
  const ctx = {
    SWCore,
    getBookings: () => existingBookings.map(b => ({ barberId, date: dateKey + 'T' + b.time + ':00.000Z', time: b.time, dur: b.dur })),
  };
  vm.createContext(ctx);
  vm.runInContext(adminSrc, ctx);
  return !ctx.checkConflict(barberId, dateKey, candTime, candDur, null, bufferMin || 0);
}

// ═══ CASOS ═══ [etiqueta, {existente, candidato, bufferMin}, libre-esperado]
const cases = [
  ['sin solape, mucho antes', { existing: { time: '10:00', dur: 30 }, cand: { time: '08:00', dur: 30 }, bufferMin: 0 }, true],
  ['solape total (mismo horario)', { existing: { time: '10:00', dur: 30 }, cand: { time: '10:00', dur: 30 }, bufferMin: 0 }, false],
  ['solape parcial (empieza antes, termina dentro)', { existing: { time: '10:00', dur: 30 }, cand: { time: '09:45', dur: 30 }, bufferMin: 0 }, false],
  ['justo antes, toca el borde, sin buffer', { existing: { time: '10:00', dur: 30 }, cand: { time: '09:30', dur: 30 }, bufferMin: 0 }, true],
  ['justo después, toca el borde, sin buffer', { existing: { time: '10:00', dur: 30 }, cand: { time: '10:30', dur: 30 }, bufferMin: 0 }, true],
  ['justo antes, dentro del buffer', { existing: { time: '10:00', dur: 30 }, cand: { time: '09:30', dur: 30 }, bufferMin: 15 }, false],
  ['justo después, dentro del buffer', { existing: { time: '10:00', dur: 30 }, cand: { time: '10:30', dur: 30 }, bufferMin: 15 }, false],
  ['fuera del buffer', { existing: { time: '10:00', dur: 30 }, cand: { time: '10:46', dur: 30 }, bufferMin: 15 }, true],
];

const DATE_KEY = '2026-09-10';
const BARBER_ID = 'felipe';

cases.forEach(([label, { existing, cand, bufferMin }, expectedFree]) => {
  test(`solape -- ${label}: functions/shared coincide con lo esperado`, () => {
    const busy = [{ start: existing.time, end: SWCore.addMinutesToTime(existing.time, existing.dur), kind: 'booking' }];
    const free = isRangeFree(busy, cand.time, SWCore.addMinutesToTime(cand.time, cand.dur), bufferMin);
    assert.strictEqual(free, expectedFree, `functions/shared/availability.js#isRangeFree esperaba libre=${expectedFree}`);
  });

  test(`solape -- ${label}: widget (isBarberFreeAt) coincide con functions/shared`, () => {
    const functionsFree = isRangeFree(
      [{ start: existing.time, end: SWCore.addMinutesToTime(existing.time, existing.dur), kind: 'booking' }],
      cand.time, SWCore.addMinutesToTime(cand.time, cand.dur), bufferMin,
    );
    const widgetFree = widgetIsFree({
      barberId: BARBER_ID, dateKey: DATE_KEY, existingBookings: [existing], bufferMin, candTime: cand.time, candDur: cand.dur,
    });
    assert.strictEqual(widgetFree, functionsFree, `isBarberFreeAt() de public/index.html divergió de functions/shared para "${label}"`);
  });

  test(`solape -- ${label}: admin (checkConflict) coincide con functions/shared`, () => {
    const functionsFree = isRangeFree(
      [{ start: existing.time, end: SWCore.addMinutesToTime(existing.time, existing.dur), kind: 'booking' }],
      cand.time, SWCore.addMinutesToTime(cand.time, cand.dur), bufferMin,
    );
    const adminFree = adminIsFree({
      barberId: BARBER_ID, dateKey: DATE_KEY, existingBookings: [existing], bufferMin, candTime: cand.time, candDur: cand.dur,
    });
    assert.strictEqual(adminFree, functionsFree, `checkConflict() de public/admin/index.html divergió de functions/shared para "${label}"`);
  });
});
