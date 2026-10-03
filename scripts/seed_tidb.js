const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../backend/config/database');
const { rowDigest } = require('./backup_database');
const tables = ['aircraft','airports','audit_logs','booking_passengers','booking_rebooking_history','bookings','check_ins','contact_messages','disruption_affected_passengers','flight_disruptions','flight_seat_allocations','flights','gate_audit_events','itineraries','passengers','schema_migrations','seat_holds','seats','ticket_audit_logs','tickets','user_preferences','users'];
const airports = [
  ['KHI','Jinnah International Airport','Karachi','Pakistan'], ['LHE','Allama Iqbal International Airport','Lahore','Pakistan'],
  ['ISB','Islamabad International Airport','Islamabad','Pakistan'], ['PEW','Bacha Khan International Airport','Peshawar','Pakistan'],
  ['UET','Quetta International Airport','Quetta','Pakistan'], ['MUX','Multan International Airport','Multan','Pakistan'],
  ['SKT','Sialkot International Airport','Sialkot','Pakistan'], ['LYP','Faisalabad International Airport','Faisalabad','Pakistan'],
  ['DXB','Dubai International Airport','Dubai','United Arab Emirates'], ['DOH','Hamad International Airport','Doha','Qatar'],
  ['JED','King Abdulaziz International Airport','Jeddah','Saudi Arabia'], ['RUH','King Khalid International Airport','Riyadh','Saudi Arabia']
];
const names = [['Ali','Raza','Karachi'],['Ayesha','Khan','Lahore'],['Hassan','Ahmed','Islamabad'],['Fatima','Malik','Rawalpindi'],['Usman','Iqbal','Peshawar'],['Sana','Ahmed','Multan'],['Bilal','Hussain','Faisalabad'],['Zainab','Sheikh','Sialkot'],['Hamza','Ali','Quetta'],['Mariam','Farooq','Karachi'],['Zoya','Siddiqui','Lahore'],['Danish','Abbasi','Islamabad']];
async function prepareAccounts() {
  const accounts = [
    { first:'Ahmed',last:'Farooq',city:'Karachi',email:'admin@skywings.com',role:'admin' },
    ...names.map(([first,last,city],i) => ({ first,last,city,email:i ? `${first}.${last}@example.com`.toLowerCase() : 'user@skywings.com',role:'user' })),
    { first:'Hamza',last:'Iqbal',city:'Karachi',email:'crew@skywings.com',role:'crew',airport:'KHI' }
  ];
  for (const account of accounts) { account.password='Sw9!'+crypto.randomBytes(21).toString('base64url'); account.hash=await bcrypt.hash(account.password,12); }
  return accounts;
}
const protectedFlight = `EXISTS (SELECT 1 FROM bookings b WHERE b.flight_id=f.flight_id)
  OR EXISTS (SELECT 1 FROM tickets t WHERE t.flight_id=f.flight_id)
  OR EXISTS (SELECT 1 FROM booking_rebooking_history h WHERE h.old_flight_id=f.flight_id OR h.new_flight_id=f.flight_id)
  OR EXISTS (SELECT 1 FROM flight_disruptions d WHERE d.flight_id=f.flight_id)
  OR EXISTS (SELECT 1 FROM seat_holds h WHERE h.flight_id=f.flight_id)
  OR EXISTS (SELECT 1 FROM flight_seat_allocations s WHERE s.flight_id=f.flight_id)
  OR EXISTS (SELECT 1 FROM gate_audit_events g WHERE g.flight_id=f.flight_id)
  OR EXISTS (SELECT 1 FROM audit_logs a WHERE a.resource_type IN ('FLIGHT','FLIGHTS') AND a.resource_id=CAST(f.flight_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci)`;
async function reseedPreservingHistory(connection,manifest,accounts,now=Date.now()) {
  const [available] = await connection.query('SHOW TABLES');
  const actual = available.map(row => Object.values(row)[0]).sort();
  if (JSON.stringify(actual)!==JSON.stringify([...tables].sort()) || JSON.stringify(actual)!==JSON.stringify(Object.keys(manifest.tables).sort())) throw new Error('Unexpected schema; reseeding refused');
  await connection.beginTransaction();
  try {
    const originals={};
    for (const table of actual) {
      const [rows] = await connection.query(`SELECT * FROM \`${table}\` FOR UPDATE`);
      if (rows.length!==manifest.tables[table].count || rowDigest(rows)!==manifest.tables[table].digest) throw new Error(`Records changed since backup: ${table}; reseeding refused`);
      originals[table]=rows;
    }
    const [candidates] = await connection.query(`SELECT f.flight_id FROM flights f WHERE NOT (${protectedFlight})`);
    const originalIds = new Set(originals.flights.map(flight => flight.flight_id));
    if (candidates.some(row => !originalIds.has(row.flight_id))) throw new Error('New flights detected; reseeding refused');
    let removedFlights=0;
    for (let offset=0; offset<candidates.length; offset+=500) {
      const batch=candidates.slice(offset,offset+500).map(row => row.flight_id);
      const [result]=await connection.execute(`DELETE f FROM flights f WHERE f.flight_id IN (${batch.map(()=>'?').join(',')}) AND NOT (${protectedFlight})`,batch);
      if (result.affectedRows!==batch.length) throw new Error('Flight references changed; reseeding refused');
      removedFlights+=result.affectedRows;
    }
    // Keep old account IDs and personal history for all historical references,
    // while retiring their login identities and revoking existing sessions.
    for (const user of originals.users) await connection.execute("UPDATE users SET email=?,status='inactive',token_version=token_version+1 WHERE user_id=?",[`archived-${user.user_id}@accounts.example.com`,user.user_id]);
    for (const airport of airports) if (!originals.airports.some(row => row.airport_code===airport[0])) await connection.execute('INSERT INTO airports (airport_code,airport_name,city,country) VALUES (?,?,?,?)',airport);
    const fleet=originals.aircraft.filter(plane => plane.status==='active');
    if (fleet.length!==4) throw new Error('Four active aircraft are required; existing fleet will not be replaced');
    for (const plane of fleet) {
      const count=originals.seats.filter(seat => seat.aircraft_id===plane.aircraft_id).length;
      if (!count) throw new Error('An aircraft has no physical seat layout');
      await connection.execute('UPDATE aircraft SET capacity=? WHERE aircraft_id=?',[count,plane.aircraft_id]);
    }
    for (const [index,account] of accounts.entries()) {
      const dob=`${1987+index}-05-15`;
      const [user]=await connection.execute('INSERT INTO users (first_name,last_name,email,password,role,address,date_of_birth,gate_airport_code) VALUES (?,?,?,?,?,?,?,?)',[account.first,account.last,account.email,account.hash,account.role,`${account.city}, Pakistan (sample profile)`,dob,account.airport||null]);
      account.userId=user.insertId;
      if (account.role==='user') await connection.execute("INSERT INTO passengers (user_id,first_name,last_name,date_of_birth,passport_number,nationality,is_saved) VALUES (?,?,?,?,?,'Pakistani',1)",[account.userId,account.first,account.last,dob,`PK-SAMPLE-${user.insertId}`]);
    }
    const [retained]=await connection.query('SELECT * FROM flights');
    const intervals=new Map(fleet.map(plane => [plane.aircraft_id,retained.filter(flight => flight.aircraft_id===plane.aircraft_id && flight.status!=='cancelled').map(flight=>({ start:+new Date(flight.departure_datetime),end:+new Date(flight.arrival_datetime) }))]));
    const destinations=airports.map(airport=>airport[0]).filter(code=>code!=='KHI');
    const start=Math.ceil((now+6*3600000)/3600000)*3600000;
    const stamp=new Date(now).toISOString().slice(2,10).replace(/-/g,'');
    const flights=[];
    for (let day=0; day<30; day++) for (const [index,plane] of fleet.entries()) {
      const destination=destinations[(day*4+index)%destinations.length];
      const international=['DXB','DOH','JED','RUH'].includes(destination);
      const duration=(international?4:2)*3600000, rotation=2*duration+90*60000;
      let departure=start+day*24*3600000+index*2*3600000;
      let collision;
      while ((collision=intervals.get(plane.aircraft_id).find(slot=>departure<slot.end+30*60000 && departure+rotation+30*60000>slot.start))) departure=collision.end+30*60000;
      const back=departure+duration+90*60000, fare=international?260:120;
      intervals.get(plane.aircraft_id).push({ start:departure,end:back+duration });
      for (let leg=0; leg<2; leg++) flights.push([`SW${stamp}${String(day*8+index*2+leg).padStart(3,'0')}`,plane.aircraft_id,leg?destination:'KHI',leg?'KHI':destination,new Date(leg?back:departure),new Date((leg?back:departure)+duration),fare,fare*1.5,fare*2,'scheduled']);
    }
    await connection.query('INSERT INTO flights (flight_number,aircraft_id,from_airport_code,to_airport_code,departure_datetime,arrival_datetime,base_price,business_price,first_class_price,status) VALUES ?',[flights]);
    await connection.execute("INSERT INTO contact_messages (name,email,category,message) VALUES ('Sana Ahmed','sana.ahmed@example.com','feedback','Sample feedback: please add more morning departures between Karachi and Islamabad.')");
    // Financial records, tickets and their audit trail must be byte-for-byte
    // unchanged; check this before committing any new data.
    for (const table of ['bookings','tickets','booking_passengers','check_ins','ticket_audit_logs','booking_rebooking_history','flight_disruptions','disruption_affected_passengers','itineraries','schema_migrations','seat_holds','flight_seat_allocations','gate_audit_events']) {
      const [rows]=await connection.query(`SELECT * FROM \`${table}\``);
      if (rowDigest(rows)!==manifest.tables[table].digest) throw new Error(`Protected history changed: ${table}`);
    }
    const removedIds=new Set(candidates.map(row=>row.flight_id));
    if (rowDigest(retained)!==rowDigest(originals.flights.filter(flight=>!removedIds.has(flight.flight_id)))) throw new Error('Protected flights changed');
    const result={ retiredAccounts:originals.users.length,createdAccounts:accounts.length,removedUnreferencedFlights:removedFlights,preservedFlights:retained.length,createdFlights:240,preservedBookings:originals.bookings.length,preservedTickets:originals.tickets.length,seats:originals.seats.length };
    await connection.execute("INSERT INTO audit_logs (user_id,action,resource_type,old_value,new_value,status) VALUES (?,'DATABASE_SAMPLE_RESEED','database',?,?,'SUCCESS')",[accounts.find(account=>account.role==='admin').userId,JSON.stringify({ accounts:originals.users.map(user=>({ userId:user.user_id,email:user.email })),backupDigest:manifest.sha256||null }),JSON.stringify(result)]);
    await connection.commit();
    return result;
  } catch(error) { await connection.rollback(); throw error; }
}
async function main() {
  const [flag,target,backupFlag,backupPath]=process.argv.slice(2),config=db.pool.pool.config.connectionConfig;
  if(flag!=='--reseed'||target!=='skywings_airlines'||backupFlag!=='--backup'||!backupPath||process.argv.length!==6) throw new Error('Usage: node scripts/seed_tidb.js --reseed skywings_airlines --backup PRIVATE_BACKUP_FILE');
  if(config.database!==target||!config.host.endsWith('.tidbcloud.com')||!config.ssl||config.ssl.rejectUnauthorized!==true) throw new Error('This command requires the named TiDB database and verified TLS');
  const file=path.resolve(backupPath),directory=path.resolve(__dirname,'../backups')+path.sep;
  if(!file.startsWith(directory)) throw new Error('Backup must be inside the private backups directory');
  const manifest=JSON.parse(fs.readFileSync(file+'.manifest.json','utf8')),verified=JSON.parse(fs.readFileSync(file+'.verified.json','utf8'));
  const age=Date.now()-Date.parse(verified.verifiedAt);
  if(manifest.database!==target||manifest.sha256!==verified.sha256||manifest.sha256!==crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')||!Number.isFinite(age)||age< -300000||age>3600000) throw new Error('A recent, checksum-matched, restore-verified backup is required');
  const connection=await db.pool.getConnection();
  try {
    const [[server]]=await connection.query('SELECT VERSION() AS version');
    if(!server.version.includes('TiDB')) throw new Error('Server is not TiDB');
    const accounts=await prepareAccounts(),credentialFile=path.join(__dirname,`../artifacts/tidb-sample-accounts-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(credentialFile),{recursive:true});
    fs.writeFileSync(credentialFile,JSON.stringify({state:'prepared',accounts:accounts.map(({hash,...account})=>account)},null,2),{mode:0o600});
    const result=await reseedPreservingHistory(connection,manifest,accounts);
    fs.writeFileSync(credentialFile,JSON.stringify({state:'committed',seededAt:new Date().toISOString(),result,accounts:accounts.map(({hash,...account})=>account)},null,2),{mode:0o600});
    fs.copyFileSync(credentialFile,path.join(__dirname,'../artifacts/tidb-sample-accounts.json'));
    console.log('TiDB reseed committed with financial history preserved: '+JSON.stringify(result));
    console.log('Unique credentials saved privately: '+credentialFile);
  } finally { connection.release(); }
}
if(require.main===module) main().catch(error=>{console.error(error.code?`TiDB operation failed (${error.code}); inspect privately before retrying.`:error.message);process.exitCode=1;}).finally(()=>db.pool.end());
module.exports={prepareAccounts,reseedPreservingHistory};
