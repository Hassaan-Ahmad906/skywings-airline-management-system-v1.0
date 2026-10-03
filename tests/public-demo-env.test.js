const assert=require('node:assert/strict');
const test=require('node:test');
const {validateEnvironment}=require('../backend/config/publicDemo');
const valid={PUBLIC_DEMO:'true',DB_NAME:'skywings_public_demo',JWT_SECRET:'x'.repeat(48),NODE_ENV:'development',PAYMENT_MODE:'demo',NOTIFICATIONS_ENABLED:'false',DISRUPTION_NOTIFICATION_WEBHOOK_URL:'',N8N_BOOKING_EMAIL_WEBHOOK_URL:''};
test('public demo startup accepts only the explicitly isolated database',()=>{
  assert.doesNotThrow(()=>validateEnvironment(valid));
  assert.throws(()=>validateEnvironment({...valid,DB_NAME:'skywings_airlines'}),/isolated/);
  assert.throws(()=>validateEnvironment({...valid,PUBLIC_DEMO:'false'}),/isolated/);
});
test('public demo startup requires a separate signing secret',()=>{
  assert.throws(()=>validateEnvironment({...valid,JWT_SECRET:''}),/random JWT/);
  assert.throws(()=>validateEnvironment({...valid,JWT_SECRET:'too-short'}),/random JWT/);
});
test('public demo refuses live payment or external notification configuration',()=>{
  for(const change of [{NODE_ENV:'production'},{PAYMENT_MODE:'live'},{NOTIFICATIONS_ENABLED:'true'},{DISRUPTION_NOTIFICATION_WEBHOOK_URL:'https://example.com/hook'},{N8N_BOOKING_EMAIL_WEBHOOK_URL:'https://example.com/hook'}]) assert.throws(()=>validateEnvironment({...valid,...change}),/simulated payments/);
});
