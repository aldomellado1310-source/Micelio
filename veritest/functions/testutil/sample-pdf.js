// veritest/functions/testutil/sample-pdf.js
//
// PDF de muestra para tests, generado con pdf-lib: A4 apaisado, fondo azul
// marino (como los certificados reales, para probar que el QR se lee sobre
// fondo oscuro) y un par de textos. Sin datos reales de nadie.
//
// Vive fuera de test/ a propósito: `node --test` ejecuta como test TODO .js
// dentro de una carpeta llamada test.
'use strict';
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

async function samplePdf(opts) {
  const o = Object.assign({ name: 'Persona de Prueba', rotate: 0, pages: 1, seed: '', size: [841.89, 595.28] }, opts || {});
  const doc = await PDFDocument.create();
  // pdf-lib sella la fecha con precisión de segundos: dos PDF creados en el
  // mismo segundo saldrían idénticos byte a byte (y Veritest rechaza,
  // correctamente, registrar dos veces el mismo archivo). Un identificador
  // aleatorio en los metadatos hace único cada PDF de muestra; los tests que
  // quieren el MISMO archivo reutilizan el mismo Buffer.
  doc.setKeywords([require('node:crypto').randomUUID()]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < o.pages; i++) {
    const page = doc.addPage(o.size);
    page.drawRectangle({ x: 0, y: 0, width: 841.89, height: 595.28, color: rgb(0.04, 0.09, 0.27) });
    page.drawText('Certificado de prueba', { x: 60, y: 480, size: 40, font, color: rgb(1, 1, 1) });
    page.drawText(`${o.name} ${o.seed}`.trim(), { x: 60, y: 400, size: 28, font, color: rgb(1, 1, 1) });
    if (o.rotate) page.setRotation(degrees(o.rotate));
  }
  return Buffer.from(await doc.save());
}

module.exports = { samplePdf };
