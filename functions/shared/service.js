// functions/shared/service.js — `requires` de un servicio (Etapa A, goal 10
// del pool ReservaGo).
//
// Hasta este goal, un servicio siempre necesitaba exactamente "una persona
// activa cualquiera" -- ese comportamiento estaba implícito en cómo
// computeAvailability() (functions/shared/availability.js) agrupaba
// reservas por barberId. Ahora un servicio puede declarar qué necesita de
// verdad: `requires: [{kind, anyOf, count}]`, para citas que ocupan varios
// recursos a la vez (una persona Y un box, por ejemplo).
//
// REQUISITO DURO del goal (no preferencia): un servicio sin `requires` (o
// con `requires` vacío) debe comportarse EXACTAMENTE igual que antes -- una
// persona activa cualquiera. normalizeServiceRequires() es la única función
// que decide cuál es el requires EFECTIVO de un servicio, así que ningún
// otro código del repo debe leer `service.requires` directo sin pasar por
// acá -- ver computeResourceAvailability/isServiceBookableAt en
// availability.js y test/service.crosscheck.test.js, que prueba la
// equivalencia contra una captura real de computeAvailability().
//
// Agnóstico de tenant, igual que el resto de shared/: no asume qué
// servicios existen, solo valida la FORMA de `requires`.
'use strict';

const { RESOURCE_KINDS } = require('./resource.js');

// El requires EFECTIVO de un servicio sin `requires` propio: exactamente el
// comportamiento actual de Scissor White. `anyOf: null` significa "cualquier
// recurso activo de ese kind", no una lista acotada.
const DEFAULT_REQUIRES = [{ kind: 'person', anyOf: null, count: 1 }];

function isValidRequirement(req) {
  if (!req || typeof req !== 'object') return false;
  if (RESOURCE_KINDS.indexOf(req.kind) === -1) return false;
  if (req.anyOf !== undefined && req.anyOf !== null) {
    if (!Array.isArray(req.anyOf) || req.anyOf.length === 0) return false;
    if (!req.anyOf.every((id) => typeof id === 'string' && id.length > 0)) return false;
  }
  if (!Number.isInteger(req.count) || req.count < 1) return false;
  return true;
}

// isValidRequires(): `undefined`/`null` son válidos a propósito -- un
// servicio sin `requires` es el caso legítimo que dispara el default, no un
// error. Si viene, debe ser un array no vacío de requerimientos válidos: un
// array vacío ([]) también se rechaza -- normalizeServiceRequires() ya lo
// trata como "ausente", así que dejarlo pasar como valor propio sería un
// mismo estado representado de dos formas distintas.
function isValidRequires(requires) {
  if (requires === undefined || requires === null) return true;
  return Array.isArray(requires) && requires.length > 0 && requires.every(isValidRequirement);
}

// normalizeServiceRequires(): el requires EFECTIVO de un servicio. Nunca
// devuelve un array vacío -- un servicio siempre necesita al menos un
// recurso para poder agendarse.
function normalizeServiceRequires(service) {
  const requires = service && service.requires;
  if (!Array.isArray(requires) || requires.length === 0) return DEFAULT_REQUIRES;
  return requires;
}

module.exports = { DEFAULT_REQUIRES, isValidRequirement, isValidRequires, normalizeServiceRequires };
