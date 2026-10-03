const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
test('fallback PDF uses the selected passenger and real seat/token instead of the account holder', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/js/main.js'), 'utf8');
  const fn = acorn.parse(source, { ecmaVersion: 'latest' }).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'generateDirectVectorPDF');
  const text = [], files = [];
  const doc = { internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
    setFillColor() {}, rect() {}, setFontSize() {}, setTextColor() {}, text: value => text.push(value), save: file => files.push(file) };
  const context = vm.createContext({ window: { jsPDF: function () { return doc; } },
    activeBoardingPassPaxIndex: 1, authState: { user: { first_name: 'Ali', last_name: 'Raza' } },
    alert: message => assert.fail(message), showBoardingPassToast() {} });
  vm.runInContext(source.slice(fn.start, fn.end), context);
  const token = 'a'.repeat(64);
  context.generateDirectVectorPDF({ from_code: 'KHI', to_code: 'ISB', flight_number: 'SW201',
    departure_datetime: '2026-10-03T16:00:00Z', passengers: [{ first_name: 'Ali', last_name: 'Raza', seat_number: '4B', boarding_token: 'b'.repeat(64) },
      { first_name: 'Nida', last_name: 'Ahmed', seat_number: '4C', boarding_token: token }] }, 'TESTPNR');
  assert(text.includes('PASSENGER: NIDA AHMED'));
  assert(text.includes('SEAT: 4C')); assert(text.includes('GATE: TBA')); assert(text.includes(token));
  assert.equal(files[0], 'SkyWings_BoardingPass_TESTPNR.pdf');
});
