const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../customer-mobile/node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../customer-mobile/src/app/core/date-of-birth.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {}; vm.runInNewContext(code, { exports: api, Date });
const today = new Date(2026, 8, 9, 0, 15);
test('valid on the eighteenth birthday; younger or future dates show the age message', () => {
  assert.equal(api.dateOfBirthError('2008-09-09', today), null);
  assert.equal(api.dateOfBirthError('2008-09-10', today), api.adultAgeMessage);
  assert.equal(api.dateOfBirthError('2030-01-01', today), api.adultAgeMessage);
});
test('missing and malformed birth dates show actionable messages', () => {
  assert.match(api.dateOfBirthError('', today), /enter your date of birth/);
  for (const value of ['yesterday', '2008-02-30', '2008-13-01', '0000-01-01', '2008-9-9']) assert.equal(api.dateOfBirthError(value, today), 'Please enter a valid date of birth.');
});
test('leap-day cutoff and local calendar date do not overflow or shift through UTC', () => {
  assert.equal(api.latestAdultBirthDate(new Date(2024, 1, 29)), '2006-02-28');
  assert.equal(api.latestAdultBirthDate(today), '2008-09-09');
  assert.equal(api.dateOfBirthError('2004-02-29', today), null);
});
