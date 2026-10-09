const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('journey search includes the selected local day across UTC midnight and excludes the next day', async () => {
  const rows = ['2026-10-03T18:59:59Z','2026-10-03T23:00:00Z','2026-10-04T18:59:59Z','2026-10-04T19:00:00Z'].map((departure_datetime, flight_id) => ({ flight_id, departure_datetime, price:120, available_seats:5 }));
  const module = { exports: {} };
  const context = vm.createContext({ module, require: name => {
    if(name === '../config/database') return { pool: { query: async (sql, params) => {
      assert.match(sql, /f\.departure_datetime >= \? AND f\.departure_datetime < \?/);
      const [start,end] = params.slice(5,7);
      assert.equal(start.toISOString(),'2026-10-03T19:00:00.000Z');
      assert.equal(end.toISOString(),'2026-10-04T19:00:00.000Z');
      return [rows.filter(row => new Date(row.departure_datetime) >= start && new Date(row.departure_datetime) < end)];
    } } };
    if(name === './journeyValidation') return require('../backend/services/journeyValidation');
    if(name === '../repositories/inventorySql') return '5';
    throw new Error('Unexpected dependency');
  } });
  vm.runInContext(fs.readFileSync('backend/services/journeySearchService.js','utf8'),context);
  const result = await module.exports.search([{from:'KHI',to:'ISB',departure:'2026-10-04',utc_offset_minutes:-300,end_utc_offset_minutes:-300}],'oneway','economy',2);
  assert.deepEqual(Array.from(result.legs[0].flights, flight => flight.flight_id),[1,2]);
  assert.equal(result.legs[0].flights[0].total_price,240);
});
