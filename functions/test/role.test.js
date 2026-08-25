const test = require('node:test');
const assert = require('node:assert');
const { BUSINESS_ROLES, isValidBusinessRole, requiresResourceId } = require('../shared/role.js');

test('BUSINESS_ROLES es owner, reception y staff', () => {
  assert.deepStrictEqual(BUSINESS_ROLES, ['owner', 'reception', 'staff']);
});

test('isValidBusinessRole acepta los 3 roles y rechaza cualquier otro valor', () => {
  BUSINESS_ROLES.forEach((r) => assert.strictEqual(isValidBusinessRole(r), true));
  assert.strictEqual(isValidBusinessRole('superadmin'), false);
  assert.strictEqual(isValidBusinessRole(''), false);
  assert.strictEqual(isValidBusinessRole(undefined), false);
});

test('requiresResourceId: solo staff lo exige', () => {
  assert.strictEqual(requiresResourceId('staff'), true);
  assert.strictEqual(requiresResourceId('owner'), false);
  assert.strictEqual(requiresResourceId('reception'), false);
});
