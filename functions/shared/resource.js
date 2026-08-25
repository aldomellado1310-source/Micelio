// functions/shared/resource.js — modelo de `resource` (Etapa A, goal 9 del
// pool ReservaGo).
//
// El recurso que ocupa un cupo de agenda deja de ser "el barbero": puede ser
// una persona, un espacio (una silla, un box) o un equipo. Vive en
// tenants/{tenantId}/resources/{id} (subcolección del goal 6) -- nunca fuera
// de una ruta de tenant, no existe (ni debe crearse) una colección
// `resources` de nivel raíz.
//
// La forma de `schedule[dow]` ({open,start,end,break}) es DELIBERADAMENTE la
// misma que ya usa `staff.schedule` en Scissor White hoy (ver
// public/admin/index.html, funciones toggleDay/setDayTime/toggleBreak, y
// functions/shared/availability.js#computeAvailability, que ya lee
// staff.schedule[dow] con este mismo shape) -- no se inventa un formato
// nuevo, se generaliza el existente. Eso es lo que permite que la migración
// staff -> resources del goal 17 mueva este campo sin transformarlo.
//
// Agnóstico de tenant: no valida CONTRA la configuración de un negocio en
// particular (no hay reglas de negocio por tenant en este módulo), solo la
// FORMA del documento -- igual que shared/validate.js con el payload de una
// reserva.
'use strict';

const RESOURCE_KINDS = ['person', 'space', 'equipment'];
const DAYS_PER_WEEK = 7;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidHHMM(v) {
  return typeof v === 'string' && HHMM_RE.test(v);
}

function isValidScheduleBreak(brk) {
  // Opcional -- un día puede no tener colación. Si viene, debe ser un rango
  // completo, mismo criterio que start/end del día.
  if (brk === undefined) return true;
  return brk !== null && typeof brk === 'object'
    && isValidHHMM(brk.start) && isValidHHMM(brk.end);
}

function isValidScheduleDay(day) {
  if (!day || typeof day !== 'object') return false;
  if (typeof day.open !== 'boolean') return false;
  // Un día cerrado no necesita start/end/break válidos -- mismo criterio que
  // ya usa la UI actual (toggleDay guarda {open:false} sin tocar horarios).
  if (!day.open) return true;
  return isValidHHMM(day.start) && isValidHHMM(day.end) && isValidScheduleBreak(day.break);
}

function isValidSchedule(schedule) {
  return Array.isArray(schedule)
    && schedule.length === DAYS_PER_WEEK
    && schedule.every(isValidScheduleDay);
}

function isValidProfile(profile) {
  if (profile === undefined) return true;
  if (profile === null || typeof profile !== 'object') return false;
  if (profile.photo !== undefined && typeof profile.photo !== 'string') return false;
  if (profile.bio !== undefined && typeof profile.bio !== 'string') return false;
  return true;
}

// isValidResourcePayload(): true si `data` tiene la forma completa de un
// resource válido para crear/reemplazar. kind/name/active/schedule son
// obligatorios para los tres kinds; profile es EXCLUSIVO de kind:'person' --
// un 'space' o 'equipment' con profile se rechaza (no tiene sentido una bio
// o foto de perfil para una silla).
function isValidResourcePayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (RESOURCE_KINDS.indexOf(data.kind) === -1) return false;
  if (typeof data.name !== 'string' || data.name.trim().length === 0) return false;
  if (typeof data.active !== 'boolean') return false;
  if (!isValidSchedule(data.schedule)) return false;
  if (data.kind === 'person') {
    if (!isValidProfile(data.profile)) return false;
  } else if (data.profile !== undefined) {
    return false;
  }
  return true;
}

module.exports = {
  RESOURCE_KINDS,
  DAYS_PER_WEEK,
  isValidResourcePayload,
  isValidSchedule,
  isValidScheduleDay,
};
