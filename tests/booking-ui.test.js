const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const acorn = require('acorn');
const source = fs.readFileSync('frontend/js/main.js', 'utf8');
test('reserve action saves a reference without opening payment and retries use the same key', async () => {
  let payments = 0, calls = 0;
  const keys = [], notices = [];
  const button = { textContent: 'Pay', disabled: false };
  const form = { dataset: { action: 'reserve', idempotencyKey: 'stable-key' }, querySelector: () => button, querySelectorAll: () => [button] };
  const values = { flightId: 1, class: 'economy', numPassengers: 1, passenger_1_firstName: 'Ali', passenger_1_lastName: 'Khan' };
  const context = vm.createContext({ console, window: { location: {} }, alert: msg => notices.push(msg),
    FormData: class { get(key) { return values[key]; } }, closeBookingModal: () => {},
    openMockPaymentModal: async () => payments++, apiRequest: async (_, options) => {
      keys.push(JSON.parse(options.body).idempotency_key); calls++;
      if (calls === 1) throw new Error('temporary failure');
      return { success: true, data: { booking_reference: 'PK123456', reservation_expires_at: '2027-01-01' } };
    } });
  const node = acorn.parse(source, { ecmaVersion: 'latest' }).body.find(n => n.id?.name === 'handleBookingSubmit');
  vm.runInContext(source.slice(node.start, node.end), context);
  await context.handleBookingSubmit({ preventDefault() {}, target: form });
  assert.equal(button.disabled, false);
  form.dataset.action = 'reserve';
  await context.handleBookingSubmit({ preventDefault() {}, target: form });
  assert.deepEqual(keys, ['stable-key', 'stable-key']);
  assert.equal(payments, 0);
  assert.ok(notices.some(msg => msg.includes('PK123456')));
  assert.equal(context.window.location.href, 'my-bookings.html');
});
test('a confirmed booking with preselected seats can still start check-in', async () => {
  const notices = [];
  const context = vm.createContext({ authState: { isLoggedIn: true, userRole: 'user' }, isNavigating: false,
    window: { location: {} }, showCheckInStatusCard: msg => notices.push(msg), console,
    apiRequest: async () => ({ success: true, data: { booking: {
      booking_id: 1, status: 'CONFIRMED', departure_datetime: new Date(Date.now() + 3600000).toISOString(),
      passengers: [{ first_name: 'Ali', seat_number: '6A' }]
    } } }) });
  const node = acorn.parse(source, { ecmaVersion: 'latest' }).body.find(n => n.id?.name === 'checkIn');
  vm.runInContext(source.slice(node.start, node.end), context);
  await context.checkIn(1);
  assert.equal(notices.length, 0);
  assert.equal(context.window.location.href, 'check-in.html?booking=1');
});
