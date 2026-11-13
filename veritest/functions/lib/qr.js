// veritest/functions/lib/qr.js
//
// Matriz de módulos de un QR. El sellador (stamp.js) la dibuja como VECTOR
// dentro del PDF -- no como imagen --, así que queda nítida a cualquier zoom
// y al imprimir, y no hay un PNG que se pixele.
//
// Corrección de errores 'Q' (~25%): el QR convive con diseños impresos y
// puede ensuciarse o arrugarse; 44 caracteres caben igual en versión 4.
'use strict';
const QRCode = require('qrcode');

function qrModules(text, errorCorrectionLevel) {
  const qr = QRCode.create(text, { errorCorrectionLevel: errorCorrectionLevel || 'Q' });
  const size = qr.modules.size;
  return {
    size,
    get(row, col) { return !!qr.modules.get(row, col); },
  };
}

// Ruta SVG en unidades de módulo (enteros): una celda por racha horizontal de
// módulos oscuros. Una sola ruta = un solo relleno en el PDF, sin costuras
// entre módulos vecinos.
function qrSvgPath(modules) {
  let d = '';
  for (let r = 0; r < modules.size; r++) {
    let c = 0;
    while (c < modules.size) {
      if (!modules.get(r, c)) { c++; continue; }
      const start = c;
      while (c < modules.size && modules.get(r, c)) c++;
      d += `M${start} ${r}h${c - start}v1h-${c - start}z`;
    }
  }
  return d;
}

module.exports = { qrModules, qrSvgPath };
