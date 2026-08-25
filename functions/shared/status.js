// functions/shared/status.js — estado de una reserva y sus transiciones
// (Etapa A, goals 12/13 del pool ReservaGo).
//
// Hasta el goal 12 existía UN solo valor posible ('pending') y nada lo
// cambiaba después de crear la reserva: cancelar hacía deleteDoc (destruía
// el registro) -- ver CLAUDE.md, "Estado conocido". Este módulo es ahora la
// ÚNICA autoridad sobre qué transiciones son válidas, para cualquier
// tenant:
//
//   pending   -> confirmed | cancelled | no_show
//   confirmed -> completed | cancelled | no_show
//   completed, cancelled y no_show son terminales (sin transiciones desde
//   ahí -- ver TRANSITIONS).
//
// validateStatusTransition() es la función que cualquier callable que mute
// el status de una reserva DEBE usar (ver functions/setBookingStatus.js) --
// nunca comparar strings sueltos en otro archivo. Rechaza cada motivo con un
// código/mensaje ESPECÍFICO (estado actual desconocido, estado destino
// desconocido, estado actual terminal, transición no declarada), no un
// "transición inválida" genérico -- goal 12 lo pide explícitamente para que
// quien reciba el error sepa exactamente qué pasó.
//
// Agnóstico de tenant: el ciclo de vida de una reserva (qué estados existen,
// qué transiciones son válidas) no depende de qué negocio la creó -- no hay
// parámetro de configuración porque no hay nada configurable por negocio
// acá.
'use strict';

const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
const DEFAULT_BOOKING_STATUS = 'pending';

// Transiciones válidas declaradas -- CUALQUIER par (from,to) que no
// aparezca acá se rechaza. Un estado ausente de este mapa (completed,
// cancelled, no_show) es terminal: no tiene transiciones salientes.
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
};

// Estados que ocupan un cupo de agenda (goal 13): computeAvailability() los
// usa para decidir si una reserva sigue bloqueando su horario. 'cancelled'
// y 'no_show' son los únicos que lo liberan -- ver occupiesSlot() más abajo,
// que trata cualquier status desconocido/ausente como "ocupa" (conservador:
// nunca libera un horario por datos malformados). Distinto del invariante
// "el widget falla abierto" (CLAUDE.md) -- ese es sobre la AUSENCIA total de
// datos de disponibilidad, no sobre el status de una reserva real que sí
// existe.
const OCCUPYING_STATUSES = ['pending', 'confirmed', 'completed'];
const NON_OCCUPYING_STATUSES = ['cancelled', 'no_show'];

function isValidBookingStatus(status) {
  return BOOKING_STATUSES.indexOf(status) !== -1;
}

function isTerminalStatus(status) {
  return isValidBookingStatus(status) && !Object.prototype.hasOwnProperty.call(TRANSITIONS, status);
}

function getValidNextStatuses(status) {
  return TRANSITIONS[status] ? TRANSITIONS[status].slice() : [];
}

function occupiesSlot(status) {
  return NON_OCCUPYING_STATUSES.indexOf(status) === -1;
}

// validateStatusTransition(): {ok:true} si `fromStatus -> toStatus` es una
// transición declarada; si no, {ok:false, code, message} con un motivo
// específico -- nunca un genérico "transición inválida". `code` es un
// HttpsError code válido, listo para que el llamador (functions/
// setBookingStatus.js) haga `throw new HttpsError(code, message)`.
function validateStatusTransition(fromStatus, toStatus) {
  if (!isValidBookingStatus(fromStatus)) {
    return { ok: false, code: 'failed-precondition', message: `Estado actual desconocido: "${fromStatus}".` };
  }
  if (!isValidBookingStatus(toStatus)) {
    return { ok: false, code: 'invalid-argument', message: `Estado destino desconocido: "${toStatus}".` };
  }
  if (isTerminalStatus(fromStatus)) {
    return { ok: false, code: 'failed-precondition', message: `La reserva ya está en un estado terminal (${fromStatus}) y no admite más cambios.` };
  }
  if (getValidNextStatuses(fromStatus).indexOf(toStatus) === -1) {
    return { ok: false, code: 'failed-precondition', message: `Transición no permitida: ${fromStatus} -> ${toStatus}.` };
  }
  return { ok: true };
}

module.exports = {
  BOOKING_STATUSES, DEFAULT_BOOKING_STATUS, TRANSITIONS, OCCUPYING_STATUSES,
  isValidBookingStatus, isTerminalStatus, getValidNextStatuses, occupiesSlot, validateStatusTransition,
};
