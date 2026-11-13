'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newVerificationId, isValidVerificationId } = require('../lib/ids.js');
const { sha256Hex, isValidSha256Hex } = require('../lib/hash.js');
const { resolveBaseUrl, verifyUrl, DEFAULT_BASE_URL } = require('../lib/urls.js');
const { qrModules, qrSvgPath } = require('../lib/qr.js');

test('el id de verificación tiene 22 caracteres base64url y no se repite', () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = newVerificationId();
    assert.equal(id.length, 22);
    assert.ok(isValidVerificationId(id), id);
    ids.add(id);
  }
  assert.equal(ids.size, 2000);
});

test('isValidVerificationId rechaza formatos que no son un id', () => {
  for (const bad of [undefined, null, 42, '', 'corto', 'x'.repeat(21), 'x'.repeat(23), 'a'.repeat(21) + '/', 'EJ-A-001', '../etc/passwd']) {
    assert.equal(isValidVerificationId(bad), false, String(bad));
  }
});

test('sha256Hex es el SHA-256 estándar y isValidSha256Hex exige 64 hex minúscula', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(isValidSha256Hex(sha256Hex(Buffer.from('x'))));
  assert.equal(isValidSha256Hex('BA78' + 'a'.repeat(60)), false);
  assert.equal(isValidSha256Hex('a'.repeat(63)), false);
  assert.equal(isValidSha256Hex(undefined), false);
});

test('resolveBaseUrl: por defecto veritest.cl; exige https salvo localhost', () => {
  assert.equal(resolveBaseUrl(undefined), DEFAULT_BASE_URL);
  assert.equal(resolveBaseUrl(''), DEFAULT_BASE_URL);
  assert.equal(resolveBaseUrl('https://veritest.cl/'), 'https://veritest.cl');
  assert.equal(resolveBaseUrl('http://localhost:5003'), 'http://localhost:5003');
  for (const bad of ['http://veritest.cl', 'ftp://veritest.cl', 'veritest.cl', 'https://veritest.cl/app', 'https://veritest.cl/?a=1']) {
    assert.throws(() => resolveBaseUrl(bad), (e) => e.code === 'invalid_base_url', bad);
  }
});

test('verifyUrl arma <base>/v/<id>', () => {
  assert.equal(verifyUrl('https://veritest.cl', 'abc'), 'https://veritest.cl/v/abc');
});

test('qrSvgPath cubre exactamente los módulos oscuros de la matriz', () => {
  const m = qrModules('https://veritest.cl/v/' + 'A'.repeat(22));
  assert.ok(m.size >= 29);
  const path = qrSvgPath(m);
  // Reconstruir la matriz desde la ruta y compararla módulo a módulo.
  const grid = Array.from({ length: m.size }, () => Array(m.size).fill(false));
  const re = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;
  let hit;
  while ((hit = re.exec(path))) {
    const [c, r, w] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
    for (let k = 0; k < w; k++) grid[r][c + k] = true;
  }
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) assert.equal(grid[r][c], m.get(r, c), `(${r},${c})`);
});
