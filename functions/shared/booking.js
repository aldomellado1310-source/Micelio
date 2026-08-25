// functions/shared/booking.js — campos del ciclo de vida de una reserva
// (Etapa A, goal 11 del pool ReservaGo).
//
// Hoy (Scissor White, colección raíz `bookings`) una reserva nace con
// status:'pending' fijo y nada la vuelve a tocar -- cancelar hace
// deleteDoc() (ver CLAUDE.md, "Estado conocido"). Este módulo agrega los
// campos que una reserva tenant-aware necesita para tener un ciclo de vida
// real: quién la creó/modificó, cuándo, por qué, y con qué recursos --
// aunque las TRANSICIONES de estado (pending -> confirmed -> ...) recién
// llegan en el goal 12 y `setBookingStatus` (que reemplaza deleteBooking) en
// el goal 13. Este goal solo inicializa los campos, no los hace mutar.
//
// Agnóstico de tenant, igual que el resto de shared/: no asume qué tenant
// es, solo la FORMA del documento -- mismo criterio que resource.js/
// service.js.
'use strict';

const { DEFAULT_BOOKING_STATUS } = require('./status.js');

// statusHistory[] acotado a 20 entradas -- una bitácora de estado ilimitada
// dentro del propio documento de la reserva volvería a crecer sin control
// (el mismo problema de fondo que motiva auditLog aparte en el goal 15,
// pero acá el goal pide explícitamente un array truncado, no una
// subcolección). Se descartan las entradas MÁS VIEJAS -- el estado actual
// (la más nueva) nunca se pierde.
const STATUS_HISTORY_MAX = 20;

function appendStatusHistory(history, entry) {
  const next = (Array.isArray(history) ? history : []).concat([entry]);
  return next.length > STATUS_HISTORY_MAX ? next.slice(next.length - STATUS_HISTORY_MAX) : next;
}

// buildBookingLifecycleFields(): los campos de ciclo de vida que TODA
// reserva nueva dentro de un tenant debe traer desde que se crea.
//
// resourceIds[] es la fuente de verdad (goal 9/10: una reserva puede
// ocupar varios recursos a la vez). `barberId` queda DEPRECADO -- se
// sincroniza como espejo de `resourceIds[0]` SOLO mientras el widget viejo
// de Scissor White (que hoy lee/escribe `barberId` directo, no
// `resourceIds`) siga en circulación; se retira recién cuando ese widget se
// migre en el goal 17. Nunca es la fuente de verdad acá -- ningún código
// nuevo debe leer `barberId` para decidir nada, solo `resourceIds`.
//
// `actor`: uid de quien crea la reserva, o `null` para una reserva creada
// por el flujo público (el cliente que agenda nunca está autenticado --
// mismo caso que `createBooking` hoy, que corre con Admin SDK sin
// `request.auth`). Un cambio de estado posterior (goal 12/13) sí traerá un
// actor real -- ver `stamped()` en firestore.rules para el mismo criterio
// aplicado a `tenants/{tenantId}`.
//
// `remindAt`/`reminderSentAt`/`manageTokenV`/`modifiedCount` se crean AHORA
// pero no los usa ni los interpreta nada todavía -- son para la etapa C
// (recordatorios, autogestión) del plan de negocio, fuera de alcance de las
// etapas 0/T/A. Sus valores iniciales (null/0) son placeholders sin
// significado operativo hasta que esa etapa los active.
function buildBookingLifecycleFields({ resourceIds, now, actor }) {
  const ids = Array.isArray(resourceIds) ? resourceIds : [];
  const nowIso = now.toISOString();
  return {
    status: DEFAULT_BOOKING_STATUS,
    statusAt: nowIso,
    statusReason: null,
    statusHistory: appendStatusHistory([], {
      status: DEFAULT_BOOKING_STATUS, at: nowIso, reason: null, by: actor || null,
    }),
    resourceIds: ids,
    barberId: ids[0] || null, // DEPRECADO -- ver comentario de cabecera.
    remindAt: null,
    reminderSentAt: null,
    manageTokenV: 0,
    modifiedCount: 0,
    updatedBy: actor || null,
    updatedAt: nowIso,
  };
}

module.exports = { STATUS_HISTORY_MAX, appendStatusHistory, buildBookingLifecycleFields };
