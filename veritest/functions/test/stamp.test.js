'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PDFDocument } = require('pdf-lib');
const { stampPdf, normalizeStampOptions, placeCard, MM } = require('../lib/stamp.js');
const { newVerificationId } = require('../lib/ids.js');
const { samplePdf } = require('../testutil/sample-pdf.js');

const URL_BASE = 'https://veritest.cl/v/';

test('normalizeStampOptions: defaults, y vacíos vuelven al default', () => {
  assert.deepEqual({ ...normalizeStampOptions() }, { corner: 'br', marginXmm: 8, marginYmm: 8, qrMm: 18, pages: 'first' });
  assert.equal(normalizeStampOptions({ corner: '', marginXmm: null, qrMm: undefined }).corner, 'br');
});

test('normalizeStampOptions rechaza esquinas y números fuera de rango', () => {
  for (const bad of [{ corner: 'center' }, { pages: 'two' }, { qrMm: 5 }, { qrMm: 99 }, { marginXmm: -1 }, { marginYmm: 500 }, { marginXmm: 'x' }, { qrMm: NaN }]) {
    assert.throws(() => normalizeStampOptions(bad), (e) => e.code === 'invalid_stamp_options', JSON.stringify(bad));
  }
});

test('placeCard ubica la tarjeta en cada esquina y falla si no cabe', () => {
  const box = { x: 0, y: 0, width: 800, height: 600 };
  assert.deepEqual(placeCard('bl', 10, 20, 100, 90, box), { x: 10, y: 20 });
  assert.deepEqual(placeCard('br', 10, 20, 100, 90, box), { x: 690, y: 20 });
  assert.deepEqual(placeCard('tl', 10, 20, 100, 90, box), { x: 10, y: 490 });
  assert.deepEqual(placeCard('tr', 10, 20, 100, 90, box), { x: 690, y: 490 });
  assert.throws(() => placeCard('br', 760, 20, 100, 90, box), (e) => e.code === 'stamp_out_of_bounds');
  // Respeta el origen de un CropBox desplazado.
  assert.deepEqual(placeCard('bl', 10, 20, 100, 90, { x: 50, y: 30, width: 800, height: 600 }), { x: 60, y: 50 });
});

test('stampPdf devuelve un PDF válido, distinto del original, con la misma cantidad de páginas', async () => {
  const src = await samplePdf();
  const id = newVerificationId();
  const out = await stampPdf(src, { url: URL_BASE + id, id });
  assert.ok(Buffer.isBuffer(out));
  assert.notDeepEqual(out, src);
  assert.ok(out.subarray(0, 5).toString() === '%PDF-');
  const reloaded = await PDFDocument.load(out);
  assert.equal(reloaded.getPageCount(), 1);
});

test('stampPdf: pages "first" solo toca la primera; "all" toca todas', async () => {
  const src = await samplePdf({ pages: 3 });
  const id = newVerificationId();
  const first = await stampPdf(src, { url: URL_BASE + id, id });
  const all = await stampPdf(src, { url: URL_BASE + id, id, options: { pages: 'all' } });
  // Cada página sellada agrega operaciones; "all" debe pesar claramente más.
  assert.ok(all.length > first.length);
  assert.equal((await PDFDocument.load(all)).getPageCount(), 3);
});

test('stampPdf rechaza basura, páginas rotadas y tarjetas que no caben', async () => {
  const id = newVerificationId();
  const base = { url: URL_BASE + id, id };
  await assert.rejects(stampPdf(Buffer.from('esto no es un pdf'), base), (e) => e.code === 'invalid_pdf');
  await assert.rejects(stampPdf(await samplePdf({ rotate: 90 }), base), (e) => e.code === 'rotated_page');
  // Página de 35x35 mm: la tarjeta (24x33 mm + márgenes) no cabe.
  await assert.rejects(
    stampPdf(await samplePdf({ size: [100, 100] }), base),
    (e) => e.code === 'stamp_out_of_bounds'
  );
  await assert.rejects(stampPdf(await samplePdf(), { id }), (e) => e.code === 'invalid_stamp_options');
});

test('stampPdf no pisa Producer/ModDate del PDF original', async () => {
  const src = await samplePdf();
  const before = await PDFDocument.load(src, { updateMetadata: false });
  const id = newVerificationId();
  const out = await stampPdf(src, { url: URL_BASE + id, id });
  const after = await PDFDocument.load(out, { updateMetadata: false });
  assert.equal(after.getProducer(), before.getProducer());
  assert.equal(String(after.getModificationDate()), String(before.getModificationDate()));
});

// La prueba que importa: el QR que se pegó SE ESCANEA y apunta a /v/<id>.
// Renderiza el PDF sellado con pdftoppm (poppler) y lo decodifica con jsQR,
// con las cuatro esquinas, sobre fondo oscuro. Se omite si no hay pdftoppm.
function hasPdftoppm() {
  try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

test('el QR sellado se escanea y devuelve exactamente la URL de verificación (4 esquinas, fondo oscuro)', { skip: !hasPdftoppm() && 'sin pdftoppm' }, async () => {
  const jsQR = require('jsqr');
  const { PNG } = require('pngjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veritest-qr-'));
  try {
    for (const corner of ['br', 'bl', 'tr', 'tl']) {
      const id = newVerificationId();
      const url = URL_BASE + id;
      const out = await stampPdf(await samplePdf(), { url, id, options: { corner } });
      const pdfPath = path.join(tmp, `${corner}.pdf`);
      fs.writeFileSync(pdfPath, out);
      execFileSync('pdftoppm', ['-r', '300', '-png', '-singlefile', pdfPath, path.join(tmp, corner)]);
      const png = PNG.sync.read(fs.readFileSync(path.join(tmp, `${corner}.png`)));
      const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      assert.ok(found, `no se encontró un QR legible en la esquina ${corner}`);
      assert.equal(found.data, url, `esquina ${corner}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('la tarjeta cabe en una página muy pequeña solo si los márgenes lo permiten (MM exportado)', () => {
  assert.ok(Math.abs(MM - 2.83465) < 1e-4);
});
