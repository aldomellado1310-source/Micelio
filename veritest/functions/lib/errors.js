// veritest/functions/lib/errors.js
//
// Un solo tipo de error para todo el núcleo de Veritest, con un `code`
// estable que cada superficie (callable, CLI, página) traduce a su propio
// formato. Nunca se parsea el `message` para decidir qué hacer -- el mensaje
// es para humanos y puede cambiar; el `code` es el contrato.
'use strict';

class VeritestError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'VeritestError';
    this.code = code;
    this.details = details || null;
  }
}

module.exports = { VeritestError };
