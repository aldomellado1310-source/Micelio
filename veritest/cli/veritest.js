#!/usr/bin/env node
// veritest/cli/veritest.js
//
// Herramienta de línea de comandos para procesar LOTES de diplomas antes (o en
// vez) de usar el panel web: ver veritest/README.md.
//
//   preview   Sella UN PDF con un QR de prueba, sin registrar nada: para elegir
//             esquina y márgenes antes de gastar ids en un lote.
//   stamp     Recibe PDFs ya hechos: los registra, les pega el QR y guarda la
//             versión sellada en --out.
//   generate  Renderiza cada diploma desde una plantilla HTML (Playwright),
//             lo registra y le pega el QR -- el flujo del generador original
//             (generar.js) con Veritest integrado.
//   verify    Consulta el registro local (por --id o por --pdf).
//
// El registro es un archivo JSONL local (--registry). Mientras no exista el
// proyecto Firebase de Veritest es la única fuente de verdad; después se carga
// a Firestore con functions/scripts/importRegistry.js. El registro lleva
// nombres de personas: no se versiona (.gitignore) y se crea con permisos 0600.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseArgs } = require('node:util');

const L = path.join(__dirname, '..', 'functions', 'lib');
const { registerPdf, verifyById, verifyByHash } = require(path.join(L, 'diploma.js'));
const { createJsonlStore } = require(path.join(L, 'stores.js'));
const { resolveBaseUrl, verifyUrl } = require(path.join(L, 'urls.js'));
const { stampPdf, normalizeStampOptions } = require(path.join(L, 'stamp.js'));
const { newVerificationId, isValidVerificationId } = require(path.join(L, 'ids.js'));
const { isValidIssuerId } = require(path.join(L, 'issuer.js'));
const { sha256Hex } = require(path.join(L, 'hash.js'));
const { VeritestError } = require(path.join(L, 'errors.js'));

const OPTIONS = {
  list: { type: 'string' },
  in: { type: 'string' },
  out: { type: 'string' },
  pdf: { type: 'string' },
  id: { type: 'string' },
  template: { type: 'string' },
  registry: { type: 'string', default: 'veritest-registry.jsonl' },
  issuer: { type: 'string' },
  'issuer-name': { type: 'string' },
  'base-url': { type: 'string' },
  corner: { type: 'string' },
  'margin-x': { type: 'string' },
  'margin-y': { type: 'string' },
  'qr-mm': { type: 'string' },
  pages: { type: 'string' },
  width: { type: 'string', default: '297mm' },
  height: { type: 'string', default: '210mm' },
  help: { type: 'boolean', short: 'h' },
};

const HELP = `Uso: node cli/veritest.js <comando> [opciones]

Comandos:
  preview   --pdf <archivo> --out <archivo.pdf> [opciones de sellado]
  stamp     --list <lista.json> --in <carpeta> --out <carpeta> --issuer <id> --issuer-name "<nombre>"
  generate  --list <lista.json> --template <certificado.html> --out <carpeta> --issuer <id> --issuer-name "<nombre>"
  verify    (--id <id> | --pdf <archivo>) [--registry <archivo>]

Opciones de sellado:  --corner br|bl|tr|tl  --margin-x <mm>  --margin-y <mm>  --qr-mm <mm>  --pages first|all
Otras:                --registry <archivo.jsonl> (por defecto ./veritest-registry.jsonl)
                      --base-url <https://veritest.cl> (o VERITEST_BASE_URL)

lista.json: [{ "file": "x.pdf", "holderName": "...", "title": "...", "folio": "...", "issuedOn": "AAAA-MM-DD",
               "params": { ... } }]     ("params" solo para generate: parámetros que recibe la plantilla)
`;

function die(msg) {
  throw new VeritestError('cli_usage', msg);
}

function need(values, name) {
  if (!values[name]) die(`Falta --${name}.\n\n${HELP}`);
  return values[name];
}

function num(values, name) {
  if (values[name] === undefined) return undefined;
  const n = Number(values[name]);
  if (!Number.isFinite(n)) die(`--${name} debe ser un número.`);
  return n;
}

function stampOptions(values) {
  return normalizeStampOptions({
    corner: values.corner,
    marginXmm: num(values, 'margin-x'),
    marginYmm: num(values, 'margin-y'),
    qrMm: num(values, 'qr-mm'),
    pages: values.pages,
  });
}

function loadList(file) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die(`No pude leer ${file} como JSON: ${e.message}`);
  }
  if (!Array.isArray(list) || list.length === 0) die(`${file} debe ser un arreglo con al menos un diploma.`);
  list.forEach((e, i) => {
    if (!e || typeof e !== 'object' || typeof e.file !== 'string' || !e.file) die(`${file}: la entrada ${i + 1} no tiene "file".`);
    // El nombre sale a disco: solo un nombre de archivo, jamás una ruta.
    if (e.file !== path.basename(e.file) || !/\.pdf$/i.test(e.file)) die(`${file}: "file" de la entrada ${i + 1} debe ser un nombre de archivo .pdf, sin carpetas.`);
  });
  const seen = new Set();
  for (const e of list) {
    if (seen.has(e.file)) die(`${file}: el archivo "${e.file}" aparece dos veces.`);
    seen.add(e.file);
  }
  return list;
}

function issuerFrom(values) {
  const id = need(values, 'issuer');
  const name = need(values, 'issuer-name');
  if (!isValidIssuerId(id)) die('--issuer debe ser un id en minúsculas (letras, números y guiones, 2 a 39 caracteres).');
  return { id, name };
}

function ensureOutDir(outDir, inDir) {
  const out = path.resolve(outDir);
  if (inDir && path.resolve(inDir) === out) die('--out debe ser una carpeta distinta de --in: los PDF originales no se pisan.');
  fs.mkdirSync(out, { recursive: true });
  // Falla ANTES de registrar nada si no se puede escribir: un registro sin
  // archivo entregable sería un id gastado.
  const probe = path.join(out, `.veritest-write-test-${process.pid}`);
  fs.writeFileSync(probe, '');
  fs.rmSync(probe);
  return out;
}

async function cmdPreview(values, io) {
  const src = need(values, 'pdf');
  const out = need(values, 'out');
  const id = newVerificationId();
  const base = resolveBaseUrl(values['base-url'] || process.env.VERITEST_BASE_URL);
  const stamped = await stampPdf(fs.readFileSync(src), { url: verifyUrl(base, id), id, options: stampOptions(values) });
  fs.writeFileSync(out, stamped);
  io.log(`Vista previa escrita en ${out} (id de prueba ${id}, NO registrado).`);
  io.log('Revísala a ojo: el sellador no puede saber qué hay debajo de la tarjeta.');
}

async function runBatch(kind, values, io) {
  const list = loadList(need(values, 'list'));
  const issuer = issuerFrom(values);
  const baseUrl = resolveBaseUrl(values['base-url'] || process.env.VERITEST_BASE_URL);
  const stamp = stampOptions(values);
  const inDir = kind === 'stamp' ? need(values, 'in') : null;
  const outDir = ensureOutDir(need(values, 'out'), inDir);
  const store = createJsonlStore(path.resolve(values.registry));

  let render = null;
  let closeBrowser = async () => {};
  if (kind === 'generate') {
    const template = path.resolve(need(values, 'template'));
    if (!fs.existsSync(template)) die(`No existe la plantilla ${template}.`);
    let chromium;
    try {
      ({ chromium } = require('playwright'));
    } catch (e) {
      die('generate necesita Playwright: npm i playwright && npx playwright install chromium');
    }
    const browser = await chromium.launch();
    const page = await browser.newPage();
    closeBrowser = () => browser.close();
    render = async (entry) => {
      const query = new URLSearchParams(entry.params || {});
      await page.goto(`${pathToFileURL(template).href}?${query}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      return Buffer.from(await page.pdf({ width: values.width, height: values.height, printBackground: true }));
    };
  }

  const tally = { ok: 0, skipped: 0, failed: 0 };
  try {
    for (const entry of list) {
      try {
        const pdf = kind === 'stamp'
          ? fs.readFileSync(path.join(inDir, entry.file))
          : await render(entry);
        const r = await registerPdf({
          pdf,
          meta: { holderName: entry.holderName, title: entry.title, folio: entry.folio, issuedOn: entry.issuedOn },
          issuer, actorUid: 'cli', store, baseUrl, stamp,
          source: kind === 'stamp' ? 'imported' : 'generated',
        });
        fs.writeFileSync(path.join(outDir, entry.file), r.pdf);
        tally.ok++;
        io.log(`OK       ${entry.file}  ${r.url}`);
      } catch (e) {
        if (e instanceof VeritestError && e.code === 'already_registered') {
          tally.skipped++;
          io.log(`YA ESTABA ${entry.file}  registrado como ${e.details.existingId} (no se vuelve a sellar)`);
        } else if (e instanceof VeritestError) {
          tally.failed++;
          const fields = e.details && e.details.fields ? ' ' + JSON.stringify(e.details.fields) : '';
          io.error(`ERROR    ${entry.file}  [${e.code}] ${e.message}${fields}`);
        } else if (e && e.code === 'ENOENT') {
          tally.failed++;
          io.error(`ERROR    ${entry.file}  no existe el archivo de entrada`);
        } else {
          throw e;
        }
      }
    }
  } finally {
    await closeBrowser();
  }
  io.log(`\nListo: ${tally.ok} registrados y sellados, ${tally.skipped} ya estaban, ${tally.failed} con error.`);
  io.log(`Registro: ${path.resolve(values.registry)}  (lleva nombres: no lo subas a git)`);
  return tally.failed > 0 ? 1 : 0;
}

async function cmdVerify(values, io) {
  const store = createJsonlStore(path.resolve(values.registry));
  let r;
  if (values.id) {
    if (!isValidVerificationId(values.id)) die('--id no tiene formato de id de Veritest.');
    r = await verifyById(store, values.id);
  } else if (values.pdf) {
    r = await verifyByHash(store, sha256Hex(fs.readFileSync(values.pdf)));
  } else {
    die('verify necesita --id o --pdf.');
  }
  io.log(JSON.stringify(r, null, 2));
  return r.found ? 0 : 1;
}

async function main(argv, io) {
  const out = io || { log: console.log, error: console.error };
  const command = argv[0];
  let parsed;
  try {
    parsed = parseArgs({ args: argv.slice(1), options: OPTIONS, allowPositionals: false });
  } catch (e) {
    out.error(`${e.message}\n\n${HELP}`);
    return 2;
  }
  const values = parsed.values;
  if (!command || values.help || command === 'help') { out.log(HELP); return command ? 0 : 2; }
  try {
    if (command === 'preview') { await cmdPreview(values, out); return 0; }
    if (command === 'stamp' || command === 'generate') return await runBatch(command, values, out);
    if (command === 'verify') return await cmdVerify(values, out);
    out.error(`Comando desconocido: ${command}\n\n${HELP}`);
    return 2;
  } catch (e) {
    if (e instanceof VeritestError) { out.error(`Error [${e.code}]: ${e.message}`); return 2; }
    throw e;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { main };
