function fail(message) { throw Object.assign(new Error(message), { status:400, code:'INVALID_JOURNEY' }); }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value; }
function departureBounds(leg) {
  if (leg.utc_offset_minutes === undefined && leg.end_utc_offset_minutes === undefined) return null;
  if (!validDate(leg.departure) || [leg.utc_offset_minutes, leg.end_utc_offset_minutes].some(offset => !Number.isInteger(offset) || Math.abs(offset) > 840)) fail('Provide valid departure-day time zone offsets');
  const midnight = Date.parse(leg.departure + 'T00:00:00Z');
  const start = new Date(midnight + leg.utc_offset_minutes * 60000);
  const end = new Date(midnight + 86400000 + leg.end_utc_offset_minutes * 60000);
  if (end - start < 22 * 3600000 || end - start > 26 * 3600000) fail('Provide valid departure-day time zone offsets');
  return [start, end];
}
function validateLegs(legs, type) {
  if (!['oneway','return','multicity'].includes(type) || !Array.isArray(legs) || legs.length < 1 || legs.length > 6 ||
    (type === 'oneway' && legs.length !== 1) || (type === 'return' && legs.length !== 2) || (type === 'multicity' && legs.length < 2)) fail('Choose a valid trip type and 1–6 flight legs');
  legs.forEach((leg,index) => {
    if (!leg || !/^[A-Z]{3}$/.test(leg.from || '') || !/^[A-Z]{3}$/.test(leg.to || '') || leg.from === leg.to || !validDate(leg.departure)) fail('Every leg needs different valid airports and a departure date');
    departureBounds(leg);
    if (index && leg.departure < legs[index-1].departure) fail('Flight dates must be in chronological order');
  });
  if (type === 'return' && (legs[0].from !== legs[1].to || legs[0].to !== legs[1].from)) fail('Return flights must reverse the outbound route');
  return legs;
}
function validateChronology(flights, type) {
  if (type === 'return' && (flights[0].from_airport_code !== flights[1].to_airport_code || flights[0].to_airport_code !== flights[1].from_airport_code)) fail('Return flights must reverse the outbound route');
  for (let i=1;i<flights.length;i++) {
    const connected = flights[i-1].to_airport_code === flights[i].from_airport_code;
    const gap = new Date(flights[i].departure_datetime) - new Date(flights[i-1].arrival_datetime);
    if (gap < (connected ? 60*60000 : 0)) fail(connected ? 'Allow at least 60 minutes between connecting flight legs' : 'Selected flights overlap in time');
  }
}
module.exports = { validateLegs, validateChronology, validDate, departureBounds, fail };
