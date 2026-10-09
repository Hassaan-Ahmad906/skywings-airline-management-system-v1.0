const { test } = require('node:test'), assert = require('node:assert/strict');
const { validateLegs,validateChronology,validDate,departureBounds } = require('../backend/services/journeyValidation');
test('trip dates reject invalid calendar dates and malformed routes',()=>{
  assert.equal(validDate('2026-02-30'),false); assert.equal(validDate('2026-12-31'),true);
  assert.throws(()=>validateLegs([{ from:'KHI',to:'KHI',departure:'2026-10-05' }],'oneway'),/valid airports/);
});

test('departure calendar days translate Pakistan and daylight-saving offsets into UTC boundaries',()=>{
  const iso = leg => departureBounds(leg).map(date => date.toISOString());
  assert.deepEqual(iso({departure:'2026-10-04',utc_offset_minutes:-300,end_utc_offset_minutes:-300}), ['2026-10-03T19:00:00.000Z','2026-10-04T19:00:00.000Z']);
  assert.deepEqual(iso({departure:'2026-03-08',utc_offset_minutes:300,end_utc_offset_minutes:240}), ['2026-03-08T05:00:00.000Z','2026-03-09T04:00:00.000Z']);
  assert.deepEqual(iso({departure:'2026-11-01',utc_offset_minutes:240,end_utc_offset_minutes:300}), ['2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z']);
  assert.equal(departureBounds({departure:'2026-10-04'}),null);
  for(const values of [[-300,undefined],[1000,1000],['-300',-300],[0,300]]) assert.throws(()=>departureBounds({departure:'2026-10-04',utc_offset_minutes:values[0],end_utc_offset_minutes:values[1]}),/time zone offsets/);
});
test('return search validates reverse route and chronological dates',()=>{
  const legs=[{ from:'KHI',to:'ISB',departure:'2026-10-05' },{ from:'ISB',to:'KHI',departure:'2026-10-07' }];
  assert.equal(validateLegs(legs,'return'),legs);
  assert.throws(()=>validateLegs([legs[0],{...legs[1],to:'LHE'}],'return'),/reverse/);
  assert.throws(()=>validateLegs([legs[0],{...legs[1],departure:'2026-10-01'}],'return'),/chronological/);
});
test('multi-city search requires two to six legs and does not silently ignore additional legs',()=>{
  const leg={ from:'KHI',to:'ISB',departure:'2026-10-05' };
  assert.throws(()=>validateLegs([leg],'multicity'),/trip type/);
  assert.throws(()=>validateLegs(Array(7).fill(leg),'multicity'),/trip type/);
  assert.equal(validateLegs([leg,{from:'ISB',to:'LHE',departure:'2026-10-06'}],'multicity').length,2);
});
test('selected flight times reject overlaps and short connections',()=>{
  const outbound={ from_airport_code:'KHI',to_airport_code:'ISB',departure_datetime:'2026-10-05T06:00:00Z',arrival_datetime:'2026-10-05T08:00:00Z' };
  assert.throws(()=>validateChronology([outbound,{from_airport_code:'ISB',to_airport_code:'KHI',departure_datetime:'2026-10-05T08:30:00Z'}],'return'),/60 minutes/);
  validateChronology([outbound,{from_airport_code:'ISB',to_airport_code:'KHI',departure_datetime:'2026-10-05T09:00:00Z'}],'return');
});
