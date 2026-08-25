// functions/setBookingStatus.js — lógica pura del callable transaccional
// `setBookingStatus` (Etapa A, goal 13 del pool ReservaGo): reemplaza
// deleteBooking. Cancelar (o cualquier otro cambio de estado) deja de ser un
// deleteDoc() -- la reserva sigue existiendo con status/statusReason/autor.
//
// Sin dependencia de firebase-admin, igual que createBooking.js: index.js
// hace TODO el I/O (lee el doc dentro de una transacción) y le pasa acá
// datos ya leídos; esta función solo decide.
//
// tenantId: este callable opera hoy sobre la colección RAÍZ `bookings` (la
// de Scissor White) sin resolver tenantId -- Scissor White todavía no tiene
// un tenant real (eso es el goal 17). El día que exista, este mismo motor
// puro sirve igual para `tenants/{tenantId}/bookings`: el llamador (index.js)
// es quien decide la ruta del documento, resolveSetBookingStatus() no la
// conoce ni le importa.
'use strict';
const { validateStatusTransition } = require('./shared/status.js');
const { appendStatusHistory } = require('./shared/booking.js');

// Arma la actualización a aplicar si la transición es válida. `booking` es
// el doc actual ya leído (dentro de la transacción, por el llamador).
// Tolerante a bookings viejos sin statusHistory/modifiedCount (el 100% de
// las reservas de Scissor White anteriores al goal 11) -- appendStatusHistory
// trata `undefined` como historial vacío, y modifiedCount ausente cuenta
// como 0. La primera vez que una reserva vieja cambia de estado, "adquiere"
// los campos de ciclo de vida del goal 11 -- no hace falta una migración
// aparte para eso.
function resolveSetBookingStatus({ booking, toStatus, reason, actor, now }) {
  if (!booking) {
    return { ok: false, code: 'not-found', message: 'La reserva no existe.' };
  }
  const check = validateStatusTransition(booking.status, toStatus);
  if (!check.ok) return check;

  const nowIso = now.toISOString();
  return {
    ok: true,
    update: {
      status: toStatus,
      statusAt: nowIso,
      statusReason: reason || null,
      statusHistory: appendStatusHistory(booking.statusHistory, {
        status: toStatus, at: nowIso, reason: reason || null, by: actor || null,
      }),
      modifiedCount: (booking.modifiedCount || 0) + 1,
      updatedBy: actor || null,
      updatedAt: nowIso,
    },
  };
}

module.exports = { resolveSetBookingStatus };
