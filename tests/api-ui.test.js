const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const acorn = require('acorn');
test('nested booking errors retain their message, status and code', async () => {
  const source = fs.readFileSync('frontend/js/main.js', 'utf8');
  const node = acorn.parse(source, { ecmaVersion: 'latest' }).body.find(n => n.id?.name === 'apiRequest');
  const context = vm.createContext({ API_BASE_URL: '/api', fetch: async () => ({ ok: false, status: 409,
    json: async () => ({ success: false, error: { code: 'SEAT_UNAVAILABLE', message: 'Seat 18A is no longer available' } }) }) });
  vm.runInContext(source.slice(node.start, node.end), context);
  await assert.rejects(context.apiRequest('/bookings/create'), e => e.message === 'Seat 18A is no longer available' && e.status === 409 && e.code === 'SEAT_UNAVAILABLE');
});
