// functions/shared/index.js — punto de entrada del bundle de navegador
// (SWCore, ver package.json#build:core). Re-exporta los cuatro módulos de
// functions/shared/ tal cual — este archivo NO agrega lógica propia, solo
// junta lo que ya es la fuente única para que esbuild lo empaquete en un
// único IIFE consumible desde <script> planos (public/index.html,
// public/admin/index.html). functions/ NO importa este archivo: cada
// función/trigger sigue requiriendo el módulo puntual que necesita (ver
// createBooking.js, email.js, index.js) para no cargar código de más.
'use strict';

module.exports = Object.assign(
  {},
  require('./availability.js'),
  require('./timezone.js'),
  require('./validate.js'),
  require('./status.js'),
);
