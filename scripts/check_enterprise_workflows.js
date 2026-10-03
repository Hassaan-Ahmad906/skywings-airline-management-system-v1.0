const assert = require('node:assert/strict');
const name=`skywings_test_enterprise_${process.pid}`;
process.env.DB_NAME=name; process.env.NODE_ENV='test'; process.env.PAYMENT_MODE='demo'; process.env.NOTIFICATIONS_ENABLED='false';
const setup=require('./databaseSetup'),db=require('../backend/config/database');
async function main(){ let server;
  try {
    await setup({database:name});
    const hash=await require('bcryptjs').hash('TestPass123!',10);
    for(const [id,role] of [[1,'admin'],[2,'user'],[3,'user']]) await db.pool.execute('INSERT INTO users (user_id,first_name,last_name,email,password,role) VALUES (?,\'Ali\',\'Raza\',?,?,?)',[id,`person${id}@example.test`,hash,role]);
    for(const [code,city] of [['KHI','Karachi'],['ISB','Islamabad'],['LHE','Lahore']]) await db.pool.execute('INSERT INTO airports (airport_code,airport_name,city,country) VALUES (?,?,?,\'Pakistan\')',[code,city,city]);
    for(const [id,from,to,dep,arr] of [[1,'KHI','ISB',1,2],[2,'ISB','KHI',4,5],[3,'ISB','LHE',4,5],[4,'LHE','KHI',7,8]]) {
      await db.pool.execute('INSERT INTO aircraft (aircraft_id,model,registration,capacity,status) VALUES (?,\'Fixture aircraft\',?,2,\'active\')',[id,'AP-TST'+id]);
      for(const letter of ['A','B']) await db.pool.execute('INSERT INTO seats (aircraft_id,seat_number,seat_class,`row_number`,column_letter) VALUES (?, ?,\'economy\',1,?)',[id,'1'+letter,letter]);
      await db.pool.execute('INSERT INTO flights (flight_id,flight_number,aircraft_id,from_airport_code,to_airport_code,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) VALUES (?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? HOUR),DATE_ADD(NOW(),INTERVAL ? HOUR),100,150,200)',[id,'SW'+id,id,from,to,dep,arr]);
    }
    server=await require('../backend/server').startServer(0); const base=`http://127.0.0.1:${server.address().port}/api`,cookies={};
    async function req(path,actor=2,body,method=body?'POST':'GET') { const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookies[actor]?{Cookie:cookies[actor]}:{})},body:body?JSON.stringify(body):undefined}); return {status:response.status,data:await response.json()}; }
    for(const actor of [1,2,3]) { const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`person${actor}@example.test`,password:'TestPass123!'})}); assert.equal(r.status,200); cookies[actor]=r.headers.get('set-cookie').split(';')[0]; }
    const [[dates]]=await db.pool.execute("SELECT DATE_FORMAT((SELECT departure_datetime FROM flights WHERE flight_id=1),'%Y-%m-%d') AS first_day, DATE_FORMAT((SELECT departure_datetime FROM flights WHERE flight_id=2),'%Y-%m-%d') AS return_day");
    const legs=[{from:'KHI',to:'ISB',departure:dates.first_day},{from:'ISB',to:'KHI',departure:dates.return_day}];
    const searched=await req('/flights/itinerary-search?'+new URLSearchParams({legs:JSON.stringify(legs),trip_type:'return'}));
    assert.equal(searched.status,200,JSON.stringify(searched.data)); assert.equal(searched.data.data.legs.length,2); assert.equal(searched.data.data.legs[1].flights[0].flight_id,2);
    const body={flight_ids:[1,2],trip_type:'return',class:'economy',passengers:[{first_name:'Nida',last_name:'Ahmed'}],idempotency_key:'return-once'};
    const created=await req('/itineraries',2,body); assert.equal(created.status,201,JSON.stringify(created.data)); const journey=created.data.data.itinerary;
    assert.equal(journey.bookings.length,2); assert.equal(Number(journey.total_amount),200); assert.ok(journey.bookings.every(b=>b.status==='PENDING'&&b.payment_status==='pending'));
    assert.equal((await req('/itineraries',2,body)).data.data.itinerary.itinerary_id,journey.itinerary_id);
    assert.equal((await req('/itineraries',2,{...body,passengers:[{first_name:'Other',last_name:'Person'}]})).status,409);
    assert.equal((await req(`/itineraries/${journey.itinerary_id}`,3)).status,404);
    assert.equal((await req(`/itineraries/${journey.itinerary_id}/pay`,3,{})).status,404);
    assert.equal((await req(`/itineraries/${journey.itinerary_id}/pay`,2,{})).status,200);
    assert.equal((await req(`/itineraries/${journey.itinerary_id}/pay`,2,{})).status,200);
    assert.equal((await req(`/bookings/${journey.bookings[0].booking_id}/rebook`,2,{new_flight_id:1,reason:'CUSTOMER_REQUEST'})).status,409);
    const [[tickets]]=await db.pool.execute('SELECT COUNT(*) AS count FROM tickets'); assert.equal(tickets.count,2);
    const [[before]]=await db.pool.execute('SELECT COUNT(*) AS count FROM bookings');
    assert.equal((await req('/itineraries',2,{...body,flight_ids:[2,1],idempotency_key:'wrong-order'})).status,400);
    assert.equal((await req('/itineraries',2,{...body,passengers:[{passenger_id:999}],idempotency_key:'foreign-pax'})).status,403);
    assert.equal((await db.pool.execute('SELECT COUNT(*) AS count FROM bookings'))[0][0].count,before.count);
    const multi=await req('/itineraries',2,{...body,flight_ids:[1,3,4],trip_type:'multicity',idempotency_key:'multi-once'}); assert.equal(multi.status,201,JSON.stringify(multi.data));
    const multiId=multi.data.data.itinerary.itinerary_id;
    assert.equal(multi.data.data.itinerary.bookings.length,3);
    assert.equal((await req('/itineraries',3,{...body,idempotency_key:'no-capacity'})).status,409);
    const [[journeyCount]]=await db.pool.execute('SELECT COUNT(*) AS count FROM itineraries'); assert.equal(journeyCount.count,2);
    await db.pool.execute('UPDATE bookings SET reservation_expires_at = DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE itinerary_id = ? AND segment_index = 1',[multiId]);
    assert.equal((await req(`/itineraries/${multiId}/pay`,2,{})).status,409);
    const afterFailure=await req(`/itineraries/${multiId}`); assert.ok(afterFailure.data.data.itinerary.bookings.every(b=>b.status==='PENDING'&&b.payment_status==='pending'));
    assert.equal((await db.pool.execute('SELECT COUNT(*) AS count FROM tickets'))[0][0].count,2);
    assert.equal((await req('/boarding/staff',2,{first_name:'Hamza',last_name:'Iqbal',email:'crew@example.test',password:'SecureDemo123!',airport:'KHI'})).status,403);
    assert.equal((await req('/boarding/staff',1,{first_name:'Hamza',last_name:'Iqbal',email:'crew@example.test',password:'SecureDemo123!',airport:'KHI'})).status,201);
    const recovery = require('../backend/services/accountRecoveryService');
    const inspected = await recovery.inspect(db.pool, ' PERSON1@EXAMPLE.TEST ');
    assert.equal(inspected.role, 'admin'); assert.equal(inspected.passwordFormat, 'bcrypt');
    assert.ok(!('password' in inspected));
    await assert.rejects(recovery.reset(db.pool, 'person1@example.test', 'DemoPass123!'), /unique password/);
    await assert.rejects(recovery.reset(db.pool, 'missing@example.test', 'RecoveredAdmin123!'), /Account not found/);
    await db.pool.execute("UPDATE users SET status = 'suspended' WHERE user_id = 3");
    await assert.rejects(recovery.reset(db.pool, 'person3@example.test', 'RecoveredAdmin123!'), /inactive or suspended/);
    await recovery.reset(db.pool, 'PERSON1@EXAMPLE.TEST', 'RecoveredAdmin123!');
    assert.equal((await req('/auth/check', 1)).status, 401, 'Old admin sessions must be revoked');
    const wrongPassword = await req('/auth/login', 1, { email: 'person1@example.test', password: 'TestPass123!' });
    assert.equal(wrongPassword.status, 401);
    const recoveredLogin = await req('/auth/login', 1, { email: 'person1@example.test', password: 'RecoveredAdmin123!' });
    assert.equal(recoveredLogin.status, 200); assert.equal(recoveredLogin.data.data.user.role, 'admin');
    const [[recovered]] = await db.pool.execute('SELECT password,token_version FROM users WHERE user_id = 1');
    assert.equal(require('bcryptjs').getRounds(recovered.password), 12);
    const [[resetAudit]] = await db.pool.execute("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'PASSWORD_RESET' AND resource_id = '1'");
    assert.equal(resetAudit.count, 1);
    const audit = require('../backend/services/auditService'), originalLog = audit.logEvent;
    try {
      audit.logEvent = async () => { throw new Error('Audit unavailable'); };
      await assert.rejects(recovery.reset(db.pool, 'person1@example.test', 'OtherRecovery123!'), /Audit unavailable/);
    } finally { audit.logEvent = originalLog; }
    const [[rolledBack]] = await db.pool.execute('SELECT password,token_version FROM users WHERE user_id = 1');
    assert.equal(rolledBack.password, recovered.password); assert.equal(rolledBack.token_version, recovered.token_version);
    for (const [email, password] of [['signup.person@example.test','SignupTest123!'], ['A.li.Raza+Travel@gmail.com',' SpacesPassword123! ']]) {
      const registered = await fetch(base+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:'Ali',lastName:'Raza',email,password,confirmPassword:password})});
      const registeredBody = await registered.json(); assert.equal(registered.status,201,JSON.stringify(registeredBody));
      const cookie = registered.headers.get('set-cookie').split(';')[0];
      const [[beforeLogout]] = await db.pool.execute('SELECT password,token_version FROM users WHERE user_id = ?',[registeredBody.data.userId]);
      const loggedOut = await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:cookie}}); assert.equal(loggedOut.status,200);
      const [[afterLogout]] = await db.pool.execute('SELECT password,token_version FROM users WHERE user_id = ?',[registeredBody.data.userId]);
      assert.equal(afterLogout.password,beforeLogout.password,'Logout must preserve the password hash');
      assert.equal(afterLogout.token_version,beforeLogout.token_version+1);
      const signedIn = await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
      assert.equal(signedIn.status,200,JSON.stringify(await signedIn.json()));
      const refreshedCookie = signedIn.headers.get('set-cookie').split(';')[0];
      assert.equal((await fetch(base+'/auth/check',{headers:{Cookie:refreshedCookie}})).status,200);
      assert.equal((await fetch(base+'/auth/check',{headers:{Cookie:cookie}})).status,401);
    }
    console.log('Registration/logout/login passed: new customer accounts, normalized Gmail aliases, exact password preservation and fresh sessions.');
    await db.pool.execute("INSERT INTO users (first_name,last_name,email,password,role,status) VALUES ('Invalid','Hash','invalid.hash@example.test','legacy-or-truncated-hash','user','active')");
    const references = new Set();
    for (const [email,password,reason,status] of [
      ['missing@example.test','TestPass123!','ACCOUNT_NOT_FOUND',401],
      ['person2@example.test','WrongPassword123!','PASSWORD_MISMATCH',401],
      ['invalid.hash@example.test','TestPass123!','PASSWORD_STORAGE_INVALID',401],
      ['person3@example.test','TestPass123!','ACCOUNT_INACTIVE',403]
    ]) {
      const response = await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Request-ID':'client-chosen-reference'},body:JSON.stringify({email,password})});
      const body = await response.json(); assert.equal(response.status,status);
      assert.match(body.request_id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      assert.equal(response.headers.get('x-request-id'),body.request_id); assert.ok(!references.has(body.request_id)); references.add(body.request_id);
      if(status === 401) assert.equal(body.message,'Invalid email or password');
      assert.deepEqual(Object.keys(body).sort(),['message','request_id','success']);
      assert.ok(!JSON.stringify(body).includes(reason)); assert.ok(!JSON.stringify(body).includes(password));
      const [[event]] = await db.pool.execute("SELECT metadata,new_value FROM audit_logs WHERE action='AUTH_LOGIN_FAILURE' AND request_id=?",[body.request_id]);
      const metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
      assert.equal(metadata.reason,reason); assert.ok(!JSON.stringify(event).includes(password));
    }
    console.log('Login diagnostics passed: unique server references match private audit reasons; public failures reveal no passwords, hashes or missing-account reason.');
    console.log('Account recovery passed: private inspection, existing active account only, default-password rejection, preserved admin role, session revocation, authenticated login and audit-failure rollback.');
    console.log('Enterprise workflow checks passed: real return search, multi-city reservation, atomic inventory/payment rollback, idempotency, ownership, expiry, ticket replay and admin-only crew provisioning.');
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve)); await db.pool.end(); const c=await setup.openConnection();
    try { if(!/^skywings_test_enterprise_\d+$/.test(name)) throw new Error('Unsafe cleanup database'); await c.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await c.end(); }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
