// veritest/functions/lib/stamp.js
//
// Pega el QR de Veritest sobre un PDF ya hecho. Es la pieza que permite
// "recibir diplomas ya hechos": el PDF original no se rehace, solo se le
// superpone una tarjeta blanca (QR + "VERIFICA ESTE DIPLOMA" + dominio + id).
//
// La tarjeta es BLANCA a propósito: funciona igual sobre fondos oscuros (como
// el certificado de las Jornadas SAMU28, azul marino) que claros, y deja la
// zona de silencio que exige un QR para escanearse sin depender del diseño de
// debajo.
//
// LIMITACIÓN HONESTA: no puede saber qué hay debajo de la tarjeta. Cada
// diploma tiene su propio diseño, así que la esquina y los márgenes son
// parámetros (corner/marginXmm/marginYmm), no una decisión automática. Revisar
// el resultado antes de entregar un lote -- el CLI y el panel lo dicen.
'use strict';
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { VeritestError } = require('./errors.js');
const { qrModules, qrSvgPath } = require('./qr.js');

const MM = 72 / 25.4;
const CORNERS = ['br', 'bl', 'tr', 'tl'];
const PAGE_MODES = ['first', 'all'];

const DEFAULT_STAMP = Object.freeze({
  corner: 'br',
  marginXmm: 8,
  marginYmm: 8,
  qrMm: 18,
  pages: 'first',
});

function numberInRange(name, value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new VeritestError('invalid_stamp_options', `${name} debe ser un número entre ${min} y ${max}.`);
  }
  return value;
}

function normalizeStampOptions(input) {
  const o = Object.assign({}, DEFAULT_STAMP, input || {});
  // Los valores undefined/null explícitos vuelven al default (el panel y el
  // CLI mandan campos vacíos sin pensarlo dos veces).
  for (const k of Object.keys(DEFAULT_STAMP)) {
    if (o[k] === undefined || o[k] === null || o[k] === '') o[k] = DEFAULT_STAMP[k];
  }
  if (CORNERS.indexOf(o.corner) === -1) {
    throw new VeritestError('invalid_stamp_options', `corner debe ser uno de: ${CORNERS.join(', ')}.`);
  }
  if (PAGE_MODES.indexOf(o.pages) === -1) {
    throw new VeritestError('invalid_stamp_options', `pages debe ser uno de: ${PAGE_MODES.join(', ')}.`);
  }
  return Object.freeze({
    corner: o.corner,
    marginXmm: numberInRange('marginXmm', o.marginXmm, 0, 120),
    marginYmm: numberInRange('marginYmm', o.marginYmm, 0, 120),
    qrMm: numberInRange('qrMm', o.qrMm, 12, 40),
    pages: o.pages,
  });
}

// Origen (esquina inferior izquierda) de la tarjeta dentro de `box`, según la
// esquina pedida. Falla en vez de recortar: una tarjeta que se sale de la
// página es un QR que no se puede escanear.
function placeCard(corner, marginXpt, marginYpt, cardW, cardH, box) {
  const left = corner === 'bl' || corner === 'tl';
  const bottom = corner === 'bl' || corner === 'br';
  const x = left ? box.x + marginXpt : box.x + box.width - marginXpt - cardW;
  const y = bottom ? box.y + marginYpt : box.y + box.height - marginYpt - cardH;
  if (x < box.x || y < box.y || x + cardW > box.x + box.width || y + cardH > box.y + box.height) {
    throw new VeritestError(
      'stamp_out_of_bounds',
      'La tarjeta del QR no cabe en la página con esos márgenes. Reduce los márgenes o el tamaño del QR.'
    );
  }
  return { x, y };
}

// Rectángulo con esquinas redondeadas como ruta SVG (origen arriba-izquierda,
// y hacia abajo -- como la espera drawSvgPath).
function roundedRectPath(w, h, r) {
  const k = 0.5523 * r;
  return (
    `M${r} 0H${w - r}C${w - r + k} 0 ${w} ${r - k} ${w} ${r}` +
    `V${h - r}C${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}` +
    `H${r}C${r - k} ${h} 0 ${h - r + k} 0 ${h - r}` +
    `V${r}C0 ${r - k} ${r - k} 0 ${r} 0Z`
  );
}

async function stampPdf(pdfBytes, params) {
  const { url, id } = params || {};
  if (typeof url !== 'string' || !url || typeof id !== 'string' || !id) {
    throw new VeritestError('invalid_stamp_options', 'stampPdf necesita url e id.');
  }
  const opts = normalizeStampOptions(params.options);

  let doc;
  try {
    // updateMetadata:false -- no pisar Producer/ModDate del PDF original.
    doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypted/i.test(String(e && e.message))) {
      throw new VeritestError(
        'encrypted_pdf',
        'El PDF está protegido con contraseña. Quita la protección y vuelve a subirlo.'
      );
    }
    throw new VeritestError('invalid_pdf', 'El archivo no es un PDF válido.');
  }

  const allPages = doc.getPages();
  if (allPages.length === 0) throw new VeritestError('invalid_pdf', 'El PDF no tiene páginas.');
  const targets = opts.pages === 'all' ? allPages : [allPages[0]];

  const modules = qrModules(url);
  const qrPath = qrSvgPath(modules);
  const host = new URL(url).host;

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const qrPt = opts.qrMm * MM;
  const padQ = 3 * MM; // zona de silencio del QR
  const L1 = { text: 'VERIFICA ESTE DIPLOMA', font: bold, size: 4.6 };
  const L2 = { text: host, font: bold, size: 7.2 };
  const L3 = { text: id, font: mono, size: 4.6 };
  const lines = [L1, L2, L3];
  const widest = Math.max.apply(null, lines.map((l) => l.font.widthOfTextAtSize(l.text, l.size)));
  const cardW = Math.max(qrPt + 2 * padQ, widest + 8);
  const gap = 2.4;
  const cardH = padQ + qrPt + gap + L1.size + 2 + L2.size + 2 + L3.size + 5;

  for (const page of targets) {
    if (page.getRotation().angle % 360 !== 0) {
      throw new VeritestError(
        'rotated_page',
        'La página del PDF está rotada (/Rotate). Aún no se puede sellar; exporta el PDF sin rotación.'
      );
    }
    const box = page.getCropBox();
    const { x, y } = placeCard(opts.corner, opts.marginXmm * MM, opts.marginYmm * MM, cardW, cardH, box);

    page.drawSvgPath(roundedRectPath(cardW, cardH, 2.2 * MM), {
      x, y: y + cardH, color: rgb(1, 1, 1), borderWidth: 0,
    });

    const qrX = x + (cardW - qrPt) / 2;
    const qrTop = y + cardH - padQ;
    page.drawSvgPath(qrPath, {
      x: qrX, y: qrTop, scale: qrPt / modules.size, color: rgb(0.03, 0.05, 0.09), borderWidth: 0,
    });

    let baseline = qrTop - qrPt - gap - L1.size;
    for (const l of lines) {
      const w = l.font.widthOfTextAtSize(l.text, l.size);
      page.drawText(l.text, {
        x: x + (cardW - w) / 2, y: baseline, size: l.size, font: l.font, color: rgb(0.1, 0.12, 0.18),
      });
      baseline -= l.size + 2;
    }
  }

  return Buffer.from(await doc.save());
}

module.exports = {
  stampPdf, normalizeStampOptions, placeCard, DEFAULT_STAMP, CORNERS, PAGE_MODES, MM,
};
