const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('seat map renders only real seats, blocks foreign holds/cabins, and creates server holds', async () => {
  const buttons = [], calls = [];
  const node = () => ({ children: [], dataset: {}, classList: { toggle() {} },
    setAttribute() {}, addEventListener() {}, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, after() {}, remove() {} });
  const map = node(), info = node();
  const context = vm.createContext({ document: { getElementById: () => map, querySelector: () => info,
    createElement: tag => { const item = node(); if (tag === 'button') buttons.push(item); return item; } },
    currentBooking: { booking_id: 1, flight_id: 1, class: 'economy', passengers: [] }, selectedSeats: [], maxSeatsAllowed: 1,
    setInterval: () => 1, clearInterval() {}, sessionStorage: { getItem: () => 'session' }, alert: msg => { throw new Error(msg); },
    apiRequest: async (url, options) => {
      calls.push([url, options]);
      if (url.endsWith('seat-map')) return { data: { seats: Array.from({ length: 7 }, (_, i) => ({
        seat_number: i < 6 ? `1${String.fromCharCode(65 + i)}` : '2A', seat_class: i === 5 ? 'first' : 'economy',
        status: i === 6 ? 'HELD' : 'AVAILABLE', mine: false
      })) } };
      return { data: { hold_id: 3, expires_at: new Date(Date.now() + 600000).toISOString() } };
    } });
  vm.runInContext(fs.readFileSync('frontend/js/seat-map.js', 'utf8'), context);
  await context.initializeSeatMap();
  assert.equal(buttons.length, 7);
  assert.equal(buttons.some(button => button.textContent === '2B'), false);
  assert.equal(buttons[6].disabled, true);
  assert.equal(buttons[5].disabled, true);
  await context.selectSeat(buttons[0]);
  assert.equal(calls[1][0], '/seat-holds');
  assert.equal(JSON.parse(calls[1][1].body).seat_number, '1A');
  assert.deepEqual(Array.from(context.selectedSeats), ['1A']);
  await context.selectSeat(buttons[0]);
  assert.equal(calls[2][0], '/seat-holds/3');
  assert.equal(calls[2][1].method, 'DELETE');
});
