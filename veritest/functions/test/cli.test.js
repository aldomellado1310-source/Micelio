'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../../cli/veritest.js');
const { samplePdf } = require('../testutil/sample-pdf.js');
const { sha256Hex } = require('../lib/hash.js');

function io() {
  const lines = { log: [], error: [] };
  return { lines, log: (m) => lines.log.push(String(m)), error: (m) => lines.error.push(String(m)) };
}

async function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritest-cli-'));
  const inDir = path.join(dir, 'in');
  fs.mkdirSync(inDir);
  const a = await samplePdf({ name: 'Ana Pérez' });
  const b = await samplePdf({ name: 'Beto Soto' });
  fs.writeFileSync(path.join(inDir, 'a.pdf'), a);
  fs.writeFileSync(path.join(inDir, 'b.pdf'), b);
  const list = [
    { file: 'a.pdf', holderName: 'Ana Pérez', title: 'Curso de prueba', folio: 'T-001', issuedOn: '2026-11-06' },
    { file: 'b.pdf', holderName: 'Beto Soto', title: 'Curso de prueba', folio: 'T-002' },
  ];
  fs.writeFileSync(path.join(dir, 'lista.json'), JSON.stringify(list));
  return { dir, inDir, outDir: path.join(dir, 'out'), registry: path.join(dir, 'reg.jsonl'), a, b };
}

const base = (w) => ['--list', path.join(w.dir, 'lista.json'), '--in', w.inDir, '--out', w.outDir, '--registry', w.registry, '--issuer', 'samu-talcahuano', '--issuer-name', 'SAMU SS Talcahuano', '--base-url', 'http://localhost:5003'];

test('stamp: registra y sella cada PDF, escribe las versiones selladas y NO toca los originales', async () => {
  const w = await workspace();
  try {
    const o = io();
    assert.equal(await main(['stamp', ...base(w), '--corner', 'tr', '--margin-x', '22', '--margin-y', '41'], o), 0, o.lines.error.join('\n'));
    assert.equal(o.lines.log.filter((l) => l.startsWith('OK')).length, 2);
    for (const f of ['a.pdf', 'b.pdf']) assert.ok(fs.existsSync(path.join(w.outDir, f)), f);
    assert.deepEqual(fs.readFileSync(path.join(w.inDir, 'a.pdf')), w.a); // original intacto
    assert.notEqual(sha256Hex(fs.readFileSync(path.join(w.outDir, 'a.pdf'))), sha256Hex(w.a));

    const records = fs.readFileSync(w.registry, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(records.length, 2);
    assert.equal(records[0].source, 'imported');
    assert.equal(records[0].stampedSha256, sha256Hex(fs.readFileSync(path.join(w.outDir, 'a.pdf'))));
    assert.equal(fs.statSync(w.registry).mode & 0o077, 0);
  } finally { fs.rmSync(w.dir, { recursive: true, force: true }); }
});

test('stamp es idempotente: volver a correr el mismo lote no duplica registros ni sella dos veces', async () => {
  const w = await workspace();
  try {
    assert.equal(await main(['stamp', ...base(w)], io()), 0);
    const o = io();
    assert.equal(await main(['stamp', ...base(w)], o), 0);
    assert.equal(o.lines.log.filter((l) => l.startsWith('YA ESTABA')).length, 2);
    assert.equal(fs.readFileSync(w.registry, 'utf8').trim().split('\n').length, 2);
  } finally { fs.rmSync(w.dir, { recursive: true, force: true }); }
});

test('stamp: un error en una entrada no detiene el lote y deja exit code 1', async () => {
  const w = await workspace();
  try {
    const list = JSON.parse(fs.readFileSync(path.join(w.dir, 'lista.json'), 'utf8'));
    list[0].holderName = ''; // inválida
    list.push({ file: 'no-existe.pdf', holderName: 'Zoe Mora', title: 'Curso' });
    fs.writeFileSync(path.join(w.dir, 'lista.json'), JSON.stringify(list));
    const o = io();
    assert.equal(await main(['stamp', ...base(w)], o), 1);
    assert.ok(o.lines.error.some((l) => /a\.pdf.*invalid_meta/.test(l)));
    assert.ok(o.lines.error.some((l) => /no-existe\.pdf.*no existe/.test(l)));
    assert.ok(fs.existsSync(path.join(w.outDir, 'b.pdf'))); // la válida sí se procesó
    assert.equal(fs.readFileSync(w.registry, 'utf8').trim().split('\n').length, 1);
  } finally { fs.rmSync(w.dir, { recursive: true, force: true }); }
});

test('stamp se niega a escribir sobre la carpeta de los originales y a seguir rutas en "file"', async () => {
  const w = await workspace();
  try {
    const args = base(w);
    args[args.indexOf('--out') + 1] = w.inDir;
    const o = io();
    assert.equal(await main(['stamp', ...args], o), 2);
    assert.match(o.lines.error.join(''), /distinta de --in/);
    assert.deepEqual(fs.readFileSync(path.join(w.inDir, 'a.pdf')), w.a);

    fs.writeFileSync(path.join(w.dir, 'lista.json'), JSON.stringify([{ file: '../../etc/x.pdf', holderName: 'Ana Pérez', title: 'C' }]));
    const o2 = io();
    assert.equal(await main(['stamp', ...base(w)], o2), 2);
    assert.match(o2.lines.error.join(''), /sin carpetas/);
  } finally { fs.rmSync(w.dir, { recursive: true, force: true }); }
});

test('preview sella sin registrar nada', async () => {
  const w = await workspace();
  try {
    const out = path.join(w.dir, 'preview.pdf');
    const o = io();
    assert.equal(await main(['preview', '--pdf', path.join(w.inDir, 'a.pdf'), '--out', out, '--corner', 'tl', '--base-url', 'http://localhost:5003'], o), 0);
    assert.ok(fs.statSync(out).size > 0);
    assert.equal(fs.existsSync(w.registry), false);
  } finally { fs.rmSync(w.dir, { recursive: true, force: true }); }
});

test('verify consulta el registro local por id y por PDF (sellado u original); 1 si no existe', async () => {
  const w = await workspace();
  try {
    await main(['stamp', ...base(w)], io());
    const rec = JSON.parse(fs.readFileSync(w.registry, 'utf8').trim().split('\n')[0]);

    const byId = io();
    assert.equal(await main(['verify', '--registry', w.registry, '--id', rec.id], byId), 0);
    assert.equal(JSON.parse(byId.lines.log.join('')).holderName, 'Ana Pérez');

    const stamped = io();
    assert.equal(await main(['verify', '--registry', w.registry, '--pdf', path.join(w.outDir, 'a.pdf')], stamped), 0);
    assert.equal(JSON.parse(stamped.lines.log.join('')).matched, 'stamped');

    const original = io();
    assert.equal(await main(['verify', '--registry', w.registry, '--pdf', path.join(w.inDir, 'a.pdf')], original), 0);
    assert.equal(JSON.parse(original.lines.log.join('')).matched, 'original');

    const forged = path.join(w.dir, 'falso.pdf');
    fs.writeFileSync(forged, await samplePdf({ name: 'Ana Pérez', seed: 'adulterado' }));
    assert.equal(await main(['verify', '--registry', w.registry, '--pdf', forged], io()), 1);
    assert.equal(await main(['verify', '--registry', w.registry, '--id', 'A'.repeat(22)], io()), 1);
  } finally { fs.rmSync(w.dir, { recursive: true, force: true }); }
});

test('uso: sin comando, comando desconocido y opciones desconocidas devuelven 2 con ayuda', async () => {
  for (const argv of [[], ['nada'], ['stamp', '--no-existe']]) {
    const o = io();
    assert.equal(await main(argv, o), 2, argv.join(' '));
  }
  const o = io();
  assert.equal(await main(['stamp', '--list', 'x.json'], o), 2); // falta --issuer etc.
});

// generate necesita Chromium (Playwright): se omite si no está.
function hasPlaywright() { try { require('playwright'); return true; } catch (e) { return false; } }

test('generate: renderiza la plantilla de ejemplo, registra como "generated" y sella', { skip: !hasPlaywright() && 'sin playwright' }, async () => {
  const w = await workspace();
  try {
    fs.writeFileSync(path.join(w.dir, 'gen.json'), JSON.stringify([
      { file: 'g1.pdf', holderName: 'Ana Pérez', title: 'Curso de prueba', folio: 'G-001', params: { n: 'Ana Pérez', t: 'Curso de prueba', f: 'G-001' } },
    ]));
    const o = io();
    const code = await main([
      'generate', '--list', path.join(w.dir, 'gen.json'), '--template', path.join(__dirname, '..', '..', 'templates', 'ejemplo', 'certificado.html'),
      '--out', w.outDir, '--registry', w.registry, '--issuer', 'samu-talcahuano', '--issuer-name', 'SAMU',
      '--base-url', 'http://localhost:5003', '--corner', 'tr', '--margin-x', '12', '--margin-y', '12',
    ], o);
    assert.equal(code, 0, o.lines.error.join('\n'));
    const rec = JSON.parse(fs.readFileSync(w.registry, 'utf8').trim());
    assert.equal(rec.source, 'generated');
    assert.equal(rec.stampedSha256, sha256Hex(fs.readFileSync(path.join(w.outDir, 'g1.pdf'))));
  } finally { fs.rmSync(w.dir, { recursive: true, force: true }); }
});
