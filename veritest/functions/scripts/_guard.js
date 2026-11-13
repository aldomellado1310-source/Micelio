// veritest/functions/scripts/_guard.js
//
// Los scripts de administración de Veritest exigen --project EXPLÍCITO y se
// niegan a correr contra los proyectos de producción que ya existen para el
// sistema de reservas: Veritest vive en su propio proyecto (ver
// veritest/README.md). Un script que cae en `scissor-white` escribiría
// issuers/diplomas dentro de la base de producción de un cliente real.
'use strict';

const FORBIDDEN_PROJECTS = ['scissor-white', 'registrago001'];

function assertVeritestProject(projectId) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Falta --project <id del proyecto Firebase de Veritest>.');
  }
  if (FORBIDDEN_PROJECTS.indexOf(projectId) !== -1) {
    throw new Error(`"${projectId}" es un proyecto del sistema de reservas, no de Veritest. Use el proyecto propio de Veritest.`);
  }
  if (/^REEMPLAZAR/i.test(projectId)) {
    throw new Error('El id del proyecto sigue siendo un placeholder.');
  }
  return projectId;
}

module.exports = { assertVeritestProject, FORBIDDEN_PROJECTS };
