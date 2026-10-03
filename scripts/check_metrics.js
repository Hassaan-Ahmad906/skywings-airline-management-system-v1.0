const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const name=`skywings_test_metrics_${process.pid}`;
process.env.DB_NAME=name; process.env.NODE_ENV='test'; process.env.PAYMENT_MODE='demo'; process.env.NOTIFICATIONS_ENABLED='false';
const setup=require('./databaseSetup'),db=require('../backend/config/database');
async function main(){let server,browser;
  try {
    await setup({database:name});
    const hash=await require('bcryptjs').hash('MetricsTest123!',10);
    for(const [id,role] of [[1,'admin'],[2,'user'],[3,'user']]) await db.pool.execute("INSERT INTO users (user_id,first_name,last_name,email,password,role) VALUES (?,'Hassan','Akram',?,?,?)",[id,`metrics${id}@example.test`,hash,role]);
    await db.pool.execute("INSERT INTO airports (airport_code,airport_name,city,country) VALUES ('KHI','Jinnah','Karachi','Pakistan'),('ISB','Islamabad','Islamabad','Pakistan')");
    await db.pool.execute("INSERT INTO aircraft (aircraft_id,model,registration,capacity,status) VALUES (1,'Fixture','AP-MET',100,'active'),(2,'Fixture','AP-MEU',100,'maintenance')");
    const flights=[[1,1,'scheduled',3],[2,1,'delayed',5],[3,1,'scheduled',-2],[4,1,'in_air',-0.5],[5,1,'completed',-24],[6,1,'cancelled',8],[7,1,'completed',36],[8,1,'boarding',1],[9,2,'scheduled',4]];
    for(const [id,aircraft,status,hours] of flights) await db.pool.execute("INSERT INTO flights (flight_id,flight_number,aircraft_id,from_airport_code,to_airport_code,status,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) VALUES (?,?,?,'KHI','ISB',?,DATE_ADD(NOW(),INTERVAL ? MINUTE),DATE_ADD(NOW(),INTERVAL ? MINUTE),999,1499,1999)",[id,'MET'+id,aircraft,status,hours*60,hours*60+60]);
    const records=[
      [1,'CONFIRMED','paid',100,2,1],[2,'CHECKED_IN','paid',200,1,2],[3,'BOARDED','paid',300,1,8],
      [4,'COMPLETED','paid',400,1,5],[5,'MISSED','paid',500,1,3],[6,'CANCELLED','refunded',600,1,6],
      [7,'PENDING','pending',700,1,1],[8,'PENDING','pending',800,1,1],[9,'EXPIRED','pending',900,1,1],
      [10,'CANCELLED','paid',1000,1,6],[11,'CONFIRMED','pending',1100,1,1],[12,'MISSED','paid',1200,1,1],
      [13,'CONFIRMED','paid',1300,1,6],[14,'COMPLETED','paid',1400,1,7],[15,'BOARDED','paid',1500,1,4]
    ];
    for(const [id,status,payment,amount,pax,flight] of records){
      await db.pool.execute("INSERT INTO bookings (booking_id,booking_reference,user_id,flight_id,status,payment_status,total_amount,number_of_passengers,reservation_expires_at) VALUES (?,?,2,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))",[id,'MET-PNR-'+id,flight,status,payment,amount,pax,id===8?-1:10]);
      for(let i=0;i<pax;i++) {
        const [person]=await db.pool.execute("INSERT INTO passengers (user_id,first_name,last_name) VALUES (2,'Ayesha','Khan')");
        await db.pool.execute('INSERT INTO booking_passengers (booking_id,passenger_id) VALUES (?,?)',[id,person.insertId]);
      }
    }
    await db.pool.execute('UPDATE bookings SET booking_date=DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH) WHERE booking_id=4');
    server=await require('../backend/server').startServer(0); const origin=`http://127.0.0.1:${server.address().port}`,cookies={};
    async function login(actor,context){const response=await (context ? context.request.post(origin+'/api/auth/login',{data:{email:`metrics${actor}@example.test`,password:'MetricsTest123!'}}) : fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`metrics${actor}@example.test`,password:'MetricsTest123!'})}));assert.equal(typeof response.status==='function'?response.status():response.status,200);if(!context) cookies[actor]=response.headers.get('set-cookie').split(';')[0];}
    for(const actor of [1,2,3]) await login(actor);
    async function get(path,actor=1){const response=await fetch(origin+'/api'+path,{headers:{Cookie:cookies[actor]}});assert.equal(response.status,200,path);return (await response.json()).data;}
    const before=(await db.pool.execute('SELECT booking_id,status,payment_status FROM bookings ORDER BY booking_id'))[0];
    const [admin,overview,revenue,bookings,performance,routes,customer,other,list,adminList]=await Promise.all([
      get('/admin/stats'),get('/reports/overview'),get('/reports/revenue'),get('/reports/bookings'),get('/reports/performance'),get('/reports/routes'),get('/users/stats',2),get('/users/stats',3),get('/bookings/list',2),get('/admin/bookings')]);
    assert.equal(admin.totalFlights,9); assert.equal(admin.upcomingFlights,3); assert.equal(admin.totalBookings,15);
    assert.equal(admin.confirmedBookings,8); assert.equal(admin.upcomingBookings,5);
    assert.equal(admin.totalRevenue,7900); assert.equal(overview.revenue.total,7900); assert.equal(revenue.totalRevenue,7900); assert.equal(customer.totalSpent,7900);
    assert.equal(customer.totalBookings,15); assert.equal(customer.upcomingFlights,5); assert.equal(customer.completedTrips,2); assert.equal(customer.loyalty.available,false);
    assert.equal(other.totalBookings,0); assert.equal(other.totalSpent,0);
    assert.equal(overview.bookings.total,bookings.totalBookings); assert.equal(bookings.totalBookings,15);
    assert.equal(overview.revenue.monthly,revenue.monthlyRevenue); assert.equal(revenue.monthlyRevenue,7500);
    assert.equal(overview.bookings.monthly,bookings.monthlyBookings); assert.equal(bookings.monthlyBookings,14);
    assert.equal(performance.occupancy.booked,7); assert.equal(performance.occupancy.total,800); assert.equal(performance.occupancy.rate,0.88);
    assert.equal(overview.performance.occupancyRate,performance.occupancy.rate); assert.equal(performance.onTimePerformance.total,9); assert.equal(performance.onTimePerformance.onTime,null);
    assert.equal(Number(routes.routeRevenue[0].revenue),7900); assert.equal(Number(routes.popularRoutes[0].revenue),7900);
    assert.ok(Math.abs(Number(routes.routePerformance[0].avg_price)-7900/11)<0.01,'Route fares must use recorded, passenger-weighted paid fares, not current flight prices');
    assert.equal(bookings.bookingsByFlight.reduce((sum,row)=>sum+Number(row.total_revenue),0),7900);
    assert.equal(list.bookings.filter(b=>Number(b.is_upcoming)===1).length,5); assert.equal(adminList.bookings.filter(b=>Number(b.is_upcoming)===1).length,5);
    assert.deepEqual((await db.pool.execute('SELECT booking_id,status,payment_status FROM bookings ORDER BY booking_id'))[0],before,'Reporting must be read-only');
    // More than one page exposes the old first-500-record truncation in management.
    const extra=Array.from({length:501},(_,i)=>['BULK'+i,1,'KHI','ISB','scheduled',new Date(Date.now()+(48+i*3)*3600000),new Date(Date.now()+(49+i*3)*3600000),100,150,200]);
    await db.pool.query('INSERT INTO flights (flight_number,aircraft_id,from_airport_code,to_airport_code,status,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) VALUES ?',[extra]);
    const first=await get('/admin/flights?limit=500&page=1'),second=await get('/admin/flights?limit=500&page=2');
    assert.equal(first.pagination.total,510); assert.equal(first.flights.length+second.flights.length,510);
    assert.equal([...first.flights,...second.flights].filter(f=>Number(f.is_upcoming)===1).length,504);
    browser=await chromium.launch({channel:'chromium',headless:true});
    const errors=[];
    for(const width of [1280,390]) {
      const context=await browser.newContext({viewport:{width,height:900},timezoneId:width===390?'America/New_York':'Asia/Karachi'});
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await login(2,context);await page.goto(origin+'/user-dashboard.html');
      await page.waitForFunction(()=>document.getElementById('totalBookings').textContent==='15');
      assert.equal(await page.locator('#upcomingFlights').innerText(),'5'); assert.equal(await page.locator('#completedTrips').innerText(),'2'); assert.equal(await page.locator('#totalSpent').innerText(),'7900.00');
      await page.goto(origin+'/user-profile.html'); await page.waitForFunction(()=>document.getElementById('profileTotalBookings').textContent==='15');
      assert.equal(await page.locator('#profileSkyMiles').innerText(),'—'); assert.equal(await page.locator('#profileTierName').innerText(),'Not available');
      await page.goto(origin+'/my-bookings.html');await page.waitForFunction(()=>document.querySelectorAll('#bookingsList .booking-card').length===15);
      for(const [filter,count] of [['upcoming',5],['boarded',2],['completed',2],['cancelled',2],['expired',1]]) {
        await page.evaluate(async filter=>await filterBookings(filter,'user'),filter);
        assert.equal(await page.locator('#bookingsList .booking-card').count(),count,filter+' must match its own category');
        if(filter!=='upcoming') {
          const statuses=await page.locator('#bookingsList .booking-card').evaluateAll(cards=>cards.map(card=>card.getAttribute('data-status')));
          assert.ok(statuses.every(status=>status===filter));
        }
      }
      await login(1,context);await page.goto(origin+'/admin-dashboard.html');
      await page.waitForFunction(()=>document.getElementById('totalBookings').textContent==='15');
      assert.match(await page.locator('#totalRevenue').innerText(),/7,900/);
      await page.goto(origin+'/admin-management.html');await page.waitForFunction(()=>document.getElementById('upcomingFlightsCountBadge').textContent==='504');
      assert.equal(await page.locator('#pastFlightsCountBadge').innerText(),'6');
      await page.evaluate(()=>loadAdminBookings());await page.waitForFunction(()=>document.getElementById('statTotalBookings').textContent==='15');
      assert.equal(await page.locator('#statConfirmedBookings').innerText(),'8'); assert.equal(await page.locator('#statUpcomingBookings').innerText(),'5');
      await page.evaluate(()=>{document.getElementById('adminBookingStatusFilter').value='completed';applyAdminBookingFilters();});
      assert.equal(await page.locator('#upcomingBookingsCountBadge').innerText(),'0'); assert.equal(await page.locator('#pastBookingsCountBadge').innerText(),'2');
      await context.close();
    }
    assert.deepEqual(errors,[]);
    console.log('Metrics reconciliation passed: dashboard/report/customer paid totals, occupancy, state/time/expiry exclusions, recorded route fares, unchanged records, all 510 flights across pages and desktop/mobile UI in two timezones.');
  } finally {
    if(browser) await browser.close();if(server) await new Promise(resolve=>server.close(resolve));await db.pool.end();
    const connection=await setup.openConnection();try{if(!/^skywings_test_metrics_\d+$/.test(name))throw new Error('Unsafe cleanup database');await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);}finally{await connection.end();}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
