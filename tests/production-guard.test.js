const {test}=require('node:test'),assert=require('node:assert/strict'),bcrypt=require('bcryptjs');
const {verify}=require('../backend/services/productionGuard');
test('production startup refuses active synthetic accounts and known default passwords',async()=>{
  const original=process.env.NODE_ENV;
  try {
    process.env.NODE_ENV='production';
    await assert.rejects(verify({execute:async()=>[[{email:'ali@example.test',password:'unused'}]]}),e=>e.code==='DEMO_ACCOUNTS_ACTIVE');
    const password=await bcrypt.hash('DemoPass123!',4);
    await assert.rejects(verify({execute:async()=>[[{email:'admin@skywings.com',password}]]}),e=>e.code==='DEMO_ACCOUNTS_ACTIVE');
    await verify({execute:async()=>[[]]});
    process.env.NODE_ENV='development'; await verify({execute:async()=>assert.fail('Development mode should not query production guard')});
  } finally { if(original===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=original; }
});
