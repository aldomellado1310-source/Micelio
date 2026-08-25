const test = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_REQUIRES, isValidRequirement, isValidRequires, normalizeServiceRequires,
} = require('../shared/service.js');

test('DEFAULT_REQUIRES es una persona activa cualquiera', () => {
  assert.deepStrictEqual(DEFAULT_REQUIRES, [{ kind: 'person', anyOf: null, count: 1 }]);
});

test('normalizeServiceRequires de un servicio sin requires devuelve el default', () => {
  assert.deepStrictEqual(normalizeServiceRequires({}), DEFAULT_REQUIRES);
  assert.deepStrictEqual(normalizeServiceRequires({ requires: [] }), DEFAULT_REQUIRES);
  assert.deepStrictEqual(normalizeServiceRequires({ requires: null }), DEFAULT_REQUIRES);
  assert.deepStrictEqual(normalizeServiceRequires(undefined), DEFAULT_REQUIRES);
});

test('normalizeServiceRequires de un servicio con requires propio lo devuelve tal cual', () => {
  const requires = [{ kind: 'person', anyOf: null, count: 1 }, { kind: 'space', anyOf: ['box1'], count: 1 }];
  assert.deepStrictEqual(normalizeServiceRequires({ requires }), requires);
});

test('isValidRequirement acepta un requerimiento completo con anyOf', () => {
  assert.strictEqual(isValidRequirement({ kind: 'space', anyOf: ['box1', 'box2'], count: 1 }), true);
});

test('isValidRequirement acepta anyOf ausente o null (cualquier recurso de ese kind)', () => {
  assert.strictEqual(isValidRequirement({ kind: 'person', count: 2 }), true);
  assert.strictEqual(isValidRequirement({ kind: 'person', anyOf: null, count: 2 }), true);
});

test('isValidRequirement rechaza kind desconocido', () => {
  assert.strictEqual(isValidRequirement({ kind: 'robot', count: 1 }), false);
});

test('isValidRequirement rechaza count no entero o menor a 1', () => {
  assert.strictEqual(isValidRequirement({ kind: 'person', count: 0 }), false);
  assert.strictEqual(isValidRequirement({ kind: 'person', count: 1.5 }), false);
  assert.strictEqual(isValidRequirement({ kind: 'person' }), false);
});

test('isValidRequirement rechaza anyOf vacío o con elementos no-string', () => {
  assert.strictEqual(isValidRequirement({ kind: 'person', anyOf: [], count: 1 }), false);
  assert.strictEqual(isValidRequirement({ kind: 'person', anyOf: [1, 2], count: 1 }), false);
});

test('isValidRequires acepta ausente/null a propósito -- es el caso que dispara el default', () => {
  assert.strictEqual(isValidRequires(undefined), true);
  assert.strictEqual(isValidRequires(null), true);
});

test('isValidRequires rechaza un array vacío (usar ausente/null en su lugar)', () => {
  assert.strictEqual(isValidRequires([]), false);
});

test('isValidRequires acepta un array de requerimientos válidos y rechaza si alguno es inválido', () => {
  assert.strictEqual(isValidRequires([{ kind: 'person', count: 1 }, { kind: 'space', anyOf: ['box1'], count: 1 }]), true);
  assert.strictEqual(isValidRequires([{ kind: 'person', count: 1 }, { kind: 'robot', count: 1 }]), false);
});
