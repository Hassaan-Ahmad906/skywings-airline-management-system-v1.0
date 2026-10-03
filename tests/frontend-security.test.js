const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const acorn = require('acorn');
const source = fs.readFileSync('frontend/js/main.js', 'utf8');
const context = vm.createContext({ document: { querySelector: () => null }, console });
vm.runInContext(fs.readFileSync('frontend/js/html.js', 'utf8'), context);
for (const node of acorn.parse(source, { ecmaVersion: 'latest' }).body) {
  if (node.type === 'FunctionDeclaration' && node.id.name === 'generateFlightResults') vm.runInContext(source.slice(node.start, node.end), context);
}
test('database text cannot add tags or attributes to flight cards', () => {
  const payload = '<img src=x onerror="window.injected=true">';
  const rendered = context.generateFlightResults([{ flight_id: 1, flight_number: payload,
    from_code: 'KHI', to_code: 'ISB', from_city: payload, to_city: "O'Brien", aircraft_model: payload,
    departure_datetime: '2027-01-01T10:00:00Z', arrival_datetime: '2027-01-01T12:00:00Z', base_price: 100, available_seats: 4 }]);
  assert.equal(rendered.includes('<img'), false);
  assert.match(rendered, /&lt;img/);
  assert.match(rendered, /O&#39;Brien/);
  assert.match(rendered, /<span>.*Wi-Fi/);
  assert.match(rendered, /onclick="bookFlight\(1,/);
});
test('passenger validation rejects injected markup and invalid dates while allowing Pakistani names', () => {
  const { validateBooking } = require('../backend/services/bookingValidation');
  assert.throws(() => validateBooking({ flight_id: 1, passengers: [{ first_name: '<img>', last_name: 'Khan' }] }), e => e.status === 400);
  assert.throws(() => validateBooking({ flight_id: 1, passengers: [{ first_name: 'Ali', last_name: 'Khan', date_of_birth: '2025-02-30' }] }), e => e.status === 400);
  assert.equal(validateBooking({ flight_id: 1, passengers: [{ first_name: 'علی', last_name: 'Khan' }] }), 'economy');
});
