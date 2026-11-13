// veritest/tests/e2e.cjs
//
// Prueba de punta a punta en un Chromium REAL (Playwright): el panel del
// emisor, la página /v/<id>, la verificación por archivo y los caminos
// negativos, contra un servidor local que usa los MISMOS handlers que las
// Cloud Functions (lib/handlers.js) con un registro en memoria.
//
// Lo que NO prueba (igual que goals 2/3/8 del sistema de reservas): Firebase
// de verdad. El SDK de Firebase se reemplaza por un stub (gstatic.com no es
// accesible desde todos los entornos) y el callable se enruta a
// /__callable/registerDiploma. Autenticación real, claims reales y el
// despliegue siguen pendientes de una prueba contra el emulador/proyecto.
//
// Uso:  node tests/e2e.cjs            (no forma parte de `npm test`: necesita Chromium)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'functions', 'lib');
const { handleVerify, handleRegister } = require(path.join(LIB, 'handlers.js'));
const { createMemoryStore } = require(path.join(LIB, 'stores.js'));
const { VeritestError } = require(path.join(LIB, 'errors.js'));
const { samplePdf } = require(path.join(ROOT, 'functions', 'testutil', 'sample-pdf.js'));

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const ISSUER = { id: 'samu-talcahuano', name: 'SAMU SS Talcahuano' };
const HTTP_CODE = { already_registered: 'already-exists', permission_denied: 'permission-denied' };

function startServer(store, port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/api/verify') {
        const r = await handleVerify(Object.fromEntries(url.searchParams), store);
        res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(r.body));
      }
      if (url.pathname === '/__callable/registerDiploma' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const out = await handleRegister({
            data: JSON.parse(body), issuer: ISSUER, actorUid: 'uid-e2e', store, baseUrl: `http://127.0.0.1:${port}`,
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify(out));
        } catch (e) {
          if (!(e instanceof VeritestError)) throw e;
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ code: e.code, message: e.message, details: e.details, httpCode: HTTP_CODE[e.code] || 'invalid-argument' }));
        }
      }
      // Hosting: /v/** -> /v/index.html cuando no hay archivo estático.
      let rel = url.pathname === '/' ? '/index.html' : url.pathname;
      if (rel.endsWith('/')) rel += 'index.html';
      let file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (url.pathname.startsWith('/v/')) file = path.join(PUBLIC, 'v', 'index.html');
        else { res.writeHead(404); return res.end('no encontrado'); }
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    } catch (e) {
      console.error('error del servidor de pruebas', e);
      res.writeHead(500); res.end();
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// ---- stub del SDK de Firebase (solo lo que usa issuer.js) ----
const STUBS = {
  'firebase-app.js': 'export function initializeApp(cfg, name) { return { cfg, name }; }',
  'firebase-auth.js': `
    const listeners = new Set(); let current = null;
    const notify = () => listeners.forEach((cb) => cb(current));
    export function getAuth() { return {}; }
    export function connectAuthEmulator() {}
    export async function signInWithEmailAndPassword(auth, email, pw) {
      if (pw !== 'correcta') throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
      current = { uid: 'uid-e2e', email, getIdTokenResult: async () => ({ claims: window.__claims || {} }) };
      notify();
    }
    export async function signOut() { current = null; notify(); }
    export function onAuthStateChanged(auth, cb) { listeners.add(cb); Promise.resolve().then(() => cb(current)); return () => listeners.delete(cb); }`,
  'firebase-functions.js': `
    export function getFunctions() { return {}; }
    export function connectFunctionsEmulator() {}
    export function httpsCallable(fns, name) {
      return async (data) => {
        const r = await fetch('/__callable/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json();
        if (!r.ok) { const e = new Error(j.message); e.code = 'functions/' + j.httpCode; e.details = Object.assign({ code: j.code }, j.details || {}); throw e; }
        return { data: j };
      };
    }`,
};

async function newPage(browser, base, opts) {
  const o = Object.assign({ claims: { veritestIssuer: ISSUER.id }, viewport: { width: 1000, height: 900 } }, opts || {});
  const ctx = await browser.newContext({ viewport: o.viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (/Content Security Policy|violates/i.test(m.text())) problems.push('CSP: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript((c) => { window.__claims = c; }, o.claims);
  await page.route('https://www.gstatic.com/firebasejs/10.13.0/*', (route) => {
    const name = route.request().url().split('/').pop();
    route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: STUBS[name] || '' });
  });
  page.problems = problems;
  page.base = base;
  return page;
}

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.error('  FALLÓ', name, '\n       ', e.message); process.exitCode = 1; }
}

async function main() {
  const store = createMemoryStore();
  const port = 5099;
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer(store, port);
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veritest-e2e-'));
  const shots = process.env.E2E_SHOTS || '';
  const original = await samplePdf({ name: 'Ana Pérez' });
  const other = await samplePdf({ name: 'Otra Persona' });
  let stampedPath = '';
  let verifyUrl = '';

  async function login(page) {
    await page.goto(base + '/issuer/');
    await page.fill('#email', 'emisor@ejemplo.cl');
    await page.fill('#password', 'correcta');
    await page.click('#login-btn');
  }
  async function register(page, pdf, holder, title) {
    await page.setInputFiles('#pdf', { name: 'diploma.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.fill('#holder', holder);
    await page.fill('#title', title);
    await page.fill('#folio', 'T-001');
    await page.fill('#issued', '2026-11-06');
    await page.selectOption('#corner', 'tr');
    await page.fill('#mx', '12');
    await page.fill('#my', '12');
    await page.click('#reg-btn');
  }

  try {
    console.log('Panel del emisor');
    await step('sin sesión se ve el login; credenciales malas dan error y no entran', async () => {
      const page = await newPage(browser, base);
      await page.goto(base + '/issuer/');
      assert.ok(await page.isVisible('#sec-login'));
      await page.fill('#email', 'x@y.cl'); await page.fill('#password', 'mala'); await page.click('#login-btn');
      await page.waitForSelector('#login-msg .msg.bad');
      assert.ok(await page.isHidden('#sec-app'));
      await page.close();
    });

    await step('una cuenta sin claim de emisor ve "Cuenta no habilitada" y no el formulario', async () => {
      const page = await newPage(browser, base, { claims: {} });
      await login(page);
      await page.waitForSelector('#sec-denied:not(.hidden)');
      assert.ok(await page.isHidden('#sec-app'));
      await page.close();
    });

    await step('el emisor registra un PDF ya hecho y descarga la versión sellada', async () => {
      const page = await newPage(browser, base);
      await login(page);
      await page.waitForSelector('#sec-app:not(.hidden)');
      assert.equal(await page.textContent('#issuer-id'), ISSUER.id);
      await register(page, original, 'Ana Pérez', 'Certificado de participación');
      await page.waitForSelector('#reg-result .msg.ok');
      verifyUrl = await page.getAttribute('#reg-result p a', 'href');
      assert.match(verifyUrl, new RegExp(`^${base}/v/[A-Za-z0-9_-]{22}$`));
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#reg-result a.btn')]);
      assert.match(download.suggestedFilename(), /^diploma-veritest\.pdf$/);
      stampedPath = path.join(tmp, 'sellado.pdf');
      await download.saveAs(stampedPath);
      const bytes = fs.readFileSync(stampedPath);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.notDeepEqual(bytes, original);
      assert.equal(await page.isVisible('#history li'), true);
      assert.deepEqual(page.problems, []);
      if (shots) await page.screenshot({ path: path.join(shots, 'issuer-after.png'), fullPage: true });
      await page.close();
    });

    await step('registrar de nuevo el mismo PDF muestra el error amigable, sin duplicar', async () => {
      const before = store.all().length;
      const page = await newPage(browser, base);
      await login(page);
      await page.waitForSelector('#sec-app:not(.hidden)');
      await register(page, original, 'Ana Pérez', 'Certificado de participación');
      await page.waitForSelector('#reg-result .msg.bad');
      assert.match(await page.textContent('#reg-result .msg.bad'), /ya está registrado/);
      assert.equal(store.all().length, before);
      await page.close();
    });

    await step('un nombre con HTML se muestra como texto y no ejecuta nada', async () => {
      const page = await newPage(browser, base);
      await login(page);
      await page.waitForSelector('#sec-app:not(.hidden)');
      await register(page, other, '<img src=x onerror="window.__xss=1">Mallory', 'Curso <b>peligroso</b>');
      await page.waitForSelector('#reg-result .msg.ok');
      const hist = await page.textContent('#history li');
      assert.match(hist, /<img src=x/);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      const url = await page.getAttribute('#reg-result p a', 'href');
      const v = await newPage(browser, base);
      await v.goto(url);
      await v.waitForSelector('.holder');
      assert.match(await v.textContent('.holder'), /<img src=x/);
      assert.equal(await v.locator('#result img').count(), 0);
      assert.equal(await v.evaluate(() => window.__xss), undefined);
      await v.close(); await page.close();
    });

    console.log('Página pública de verificación');
    await step('/v/<id> muestra el registro: titular, diploma, emisor, folio y fecha de emisión', async () => {
      const page = await newPage(browser, base);
      await page.goto(verifyUrl);
      await page.waitForSelector('#result .badge.ok');
      assert.match(await page.textContent('#result .badge'), /registrado y vigente/);
      const text = await page.textContent('#result');
      for (const s of ['Ana Pérez', 'Certificado de participación', ISSUER.name, 'T-001', '6 de noviembre de 2026']) assert.ok(text.includes(s), `falta "${s}" en: ${text}`);
      assert.match(text, /hora de Chile/);
      assert.deepEqual(page.problems, []);
      if (shots) await page.screenshot({ path: path.join(shots, 'verify-desktop.png') });
      await page.close();
    });

    await step('en móvil (375px) la ficha no desborda horizontalmente', async () => {
      const page = await newPage(browser, base, { viewport: { width: 375, height: 760 } });
      await page.goto(verifyUrl);
      await page.waitForSelector('#result .badge.ok');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `desborda ${overflow}px`);
      if (shots) await page.screenshot({ path: path.join(shots, 'verify-mobile.png'), fullPage: true });
      await page.close();
    });

    await step('subir el PDF sellado en /v/<id> confirma que es idéntico a la versión oficial', async () => {
      const page = await newPage(browser, base);
      await page.goto(verifyUrl);
      await page.setInputFiles('#file', stampedPath);
      await page.waitForSelector('#file-result .msg.ok');
      assert.match(await page.textContent('#file-result'), /idéntico a la versión oficial/);
      await page.close();
    });

    await step('subir el PDF ORIGINAL (sin QR) avisa que no es la versión oficial', async () => {
      const page = await newPage(browser, base);
      await page.goto(verifyUrl);
      await page.setInputFiles('#file', { name: 'o.pdf', mimeType: 'application/pdf', buffer: original });
      await page.waitForSelector('#file-result .msg.warn');
      assert.match(await page.textContent('#file-result'), /PDF original/);
      await page.close();
    });

    await step('subir un PDF distinto (adulterado) dice que NO coincide', async () => {
      const page = await newPage(browser, base);
      await page.goto(verifyUrl);
      const forged = await samplePdf({ name: 'Ana Pérez', seed: 'adulterado' });
      await page.setInputFiles('#file', { name: 'f.pdf', mimeType: 'application/pdf', buffer: forged });
      await page.waitForSelector('#file-result .msg.bad');
      assert.match(await page.textContent('#file-result'), /no coincide/);
      await page.close();
    });

    await step('subir el PDF de OTRO diploma registrado en /v/<id> lo marca como de otro diploma', async () => {
      const page = await newPage(browser, base);
      await page.goto(verifyUrl);
      await page.setInputFiles('#file', { name: 'o.pdf', mimeType: 'application/pdf', buffer: other });
      await page.waitForSelector('#file-result .msg.bad');
      assert.match(await page.textContent('#file-result'), /OTRO diploma/);
      await page.close();
    });

    await step('inicio: subir el PDF sellado muestra el registro y confirma la identidad del archivo', async () => {
      const page = await newPage(browser, base);
      await page.goto(base + '/');
      await page.setInputFiles('#file', stampedPath);
      await page.waitForSelector('#result .badge.ok');
      const text = await page.textContent('#result');
      assert.ok(text.includes('Ana Pérez'));
      assert.match(text, /idéntico a la versión oficial/);
      assert.deepEqual(page.problems, []);
      if (shots) await page.screenshot({ path: path.join(shots, 'home-result.png'), fullPage: true });
      await page.close();
    });

    await step('inicio: un PDF no registrado dice "No coincide"', async () => {
      const page = await newPage(browser, base);
      await page.goto(base + '/');
      await page.setInputFiles('#file', { name: 'x.pdf', mimeType: 'application/pdf', buffer: await samplePdf({ name: 'Nadie' }) });
      await page.waitForSelector('#result .badge.bad');
      assert.match(await page.textContent('#result'), /No coincide/);
      await page.close();
    });

    await step('un id con formato inválido o inexistente da "No encontrado"', async () => {
      for (const p of ['/v/corto', `/v/${'A'.repeat(22)}`, '/v/']) {
        const page = await newPage(browser, base);
        await page.goto(base + p);
        await page.waitForSelector('#result .badge.bad');
        assert.match(await page.textContent('#result .badge'), /No encontrado/, p);
        await page.close();
      }
    });

    await step('FALLA CERRADA: si la consulta falla, jamás aparece "vigente"; el mensaje aclara que no implica falsedad', async () => {
      const page = await newPage(browser, base);
      await page.route('**/api/verify**', (route) => route.fulfill({ status: 500, body: '{"error":"internal"}', contentType: 'application/json' }));
      await page.goto(verifyUrl);
      await page.waitForSelector('#result .badge.warn');
      const text = await page.textContent('#result');
      assert.match(text, /Sin resultado/);
      assert.match(text, /no significa que el diploma sea falso/);
      assert.doesNotMatch(text, /vigente/);
      await page.close();

      const net = await newPage(browser, base);
      await net.route('**/api/verify**', (route) => route.abort());
      await net.goto(verifyUrl);
      await net.waitForSelector('#result .badge.warn');
      assert.doesNotMatch(await net.textContent('#result'), /vigente/);
      await net.close();
    });

    await step('el PDF no sale del navegador: la consulta lleva solo la huella (64 hex), nunca el archivo', async () => {
      const page = await newPage(browser, base);
      const seen = [];
      page.on('request', (r) => { if (r.url().includes('/api/verify')) seen.push({ method: r.method(), url: r.url(), body: r.postData() }); });
      await page.goto(base + '/');
      await page.setInputFiles('#file', stampedPath);
      await page.waitForSelector('#result .badge');
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, 'GET');
      assert.equal(seen[0].body, null);
      assert.match(seen[0].url, /\/api\/verify\?hash=[0-9a-f]{64}$/);
      await page.close();
    });
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${passed} pasos OK${process.exitCode ? ' -- HAY FALLOS' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
