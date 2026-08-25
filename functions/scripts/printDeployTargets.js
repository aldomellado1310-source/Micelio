// functions/scripts/printDeployTargets.js — imprime el argumento --only
// completo para `firebase deploy`, leyendo los nombres de función desde
// functions/deploy-list.json en vez de mantenerlos escritos a mano en
// README.md (goal 4 del pool ReservaGo). Uso:
//
//   firebase deploy --project scissor-white --only "$(node functions/scripts/printDeployTargets.js)"
//
// hosting/firestore:rules/firestore:indexes van fijos -- lo único que puede
// quedar desactualizado por olvido es la lista de funciones, así que es lo
// único que se deriva del JSON versionado.
'use strict';
const path = require('node:path');
const deployList = require(path.join(__dirname, '..', 'deploy-list.json')).functions;

const targets = ['hosting', 'firestore:rules', 'firestore:indexes']
  .concat(deployList.map(name => `functions:${name}`));

console.log(targets.join(','));
