// functions/scripts/checkDeployList.js — goal 4 del pool ReservaGo: "que sea
// imposible desplegar dejando una función fuera por olvido". Corrido por CI
// (.github/workflows/ci.yml) en cada push/PR.
//
// Compara `exports.NOMBRE = ...` en functions/index.js (parseo de texto, no
// require() -- evita ejecutar initializeApp()/defineSecret() sin
// credenciales reales en CI) contra functions/deploy-list.json. Falla si:
//   a) una función exportada no está en deploy-list.json (el olvido real que
//      dejó createBooking congelado en 2026-08-23, ver CLAUDE.md), o
//   b) deploy-list.json tiene un nombre que ya no se exporta (entrada
//      obsoleta -- `firebase deploy --only functions:X` con X inexistente
//      falla igual en el momento del deploy, pero detectarlo acá es más
//      barato que descubrirlo ahí).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const INDEX_PATH = path.join(__dirname, '..', 'index.js');
const DEPLOY_LIST_PATH = path.join(__dirname, '..', 'deploy-list.json');

function exportedFunctionNames(indexSource) {
  const re = /^exports\.([a-zA-Z0-9_]+)\s*=/gm;
  const names = [];
  let m;
  while ((m = re.exec(indexSource)) !== null) names.push(m[1]);
  return names;
}

const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
const exported = exportedFunctionNames(indexSource);
if (exported.length === 0) {
  console.error('checkDeployList: no se encontró ningún "exports.NOMBRE = " en functions/index.js -- ¿cambió el patrón de exportación? Revisar la regex de este script antes de confiar en el resultado.');
  process.exit(1);
}

const deployList = JSON.parse(fs.readFileSync(DEPLOY_LIST_PATH, 'utf8')).functions;

const missing = exported.filter(name => !deployList.includes(name));
const stale = deployList.filter(name => !exported.includes(name));

if (missing.length === 0 && stale.length === 0) {
  console.log(`checkDeployList: OK -- ${exported.length} funciones exportadas, todas en functions/deploy-list.json.`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error('checkDeployList: FALTAN en functions/deploy-list.json (se desplegarían por olvido, quedando congeladas):');
  missing.forEach(name => console.error(`  - ${name}`));
}
if (stale.length > 0) {
  console.error('checkDeployList: SOBRAN en functions/deploy-list.json (ya no existen como exports.X en functions/index.js):');
  stale.forEach(name => console.error(`  - ${name}`));
}
process.exit(1);
