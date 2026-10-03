const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const name = `skywings_test_browser_${process.pid}`;
process.env.DB_NAME = name; process.env.NODE_ENV = 'test'; process.env.PAYMENT_MODE = 'demo'; process.env.NOTIFICATIONS_ENABLED = 'false';
const setup = require('./databaseSetup');
const db = require('../backend/config/database');
async function main() {
  let server, browser;
  try {
    await setup({ database: name }); await require('./seed_database')();
    await db.pool.execute("INSERT INTO flights (flight_number,aircraft_id,from_airport_code,to_airport_code,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) VALUES ('SW650',4,'ISB','KHI',DATE_ADD(NOW(),INTERVAL 26 HOUR),DATE_ADD(NOW(),INTERVAL 28 HOUR),120,180,240)");
    server = await require('../backend/server').startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const errors = [], failures = [];
    const artifacts = path.join(__dirname, '../artifacts'); fs.mkdirSync(artifacts, { recursive: true });
    async function context(role, width) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Karachi' });
      if (role) {
        const response = await context.request.post(base + '/api/auth/login', { data: { email: role === 'admin' ? 'admin@skywings.com' : role === 'crew' ? 'crew@skywings.com' : 'user@skywings.com', password: 'DemoPass123!' } }); assert.equal(response.status(), 200);
      }
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400 && response.status() !== 401) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
      return { context, page };
    }
    for (const width of [1440,390]) {
      for (const [role, pages] of [['user',['user-dashboard.html','my-bookings.html','user-profile.html','flight-search.html','check-in.html','user-about-contact.html']],['admin',['admin-dashboard.html','admin-management.html','admin-reports.html']], ['crew',['crew-portal.html']], [null,['index.html','login.html','register.html','about-contact.html']]]) {
        const { context: ctx, page } = await context(role, width);
        for (const file of pages) {
          await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(500);
          assert.ok(!(await page.locator('body').innerText()).match(/<(?:div|span|tr|td|button)\b/), `Escaped markup on ${file}`);
          const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth,document.body.scrollWidth) - innerWidth);
          if(overflow>2){
            await page.screenshot({path:path.join(artifacts,`${file}-${width}-overflow.png`),fullPage:true});
            const oversized=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,id:e.id,classes:String(e.className),width:Math.round(e.getBoundingClientRect().width),right:Math.round(e.getBoundingClientRect().right)})).filter(e=>e.width>innerWidth||e.right>innerWidth+2).slice(0,18));
            console.log('Overflow elements: '+JSON.stringify(oversized));
          }
          assert.ok(overflow <= 2, `${file} overflows at ${width}px by ${overflow}px`);
          if (['my-bookings.html','admin-management.html','flight-search.html'].includes(file)) await page.screenshot({ path: path.join(artifacts, `${file}-${width}.png`), fullPage: true });
        }
        await ctx.close();
      }
    }
    const { context: ctx, page } = await context('user', 1280);
    // Relative seed flights can depart tomorrow when this check runs near midnight.
    const [[outboundDate]] = await db.pool.execute("SELECT DATE_FORMAT(departure_datetime,'%Y-%m-%d') AS date FROM flights WHERE flight_id=1");
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base + '/my-bookings.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Boarding Pass', exact: false }).first().click();
    const pass = page.locator('#boardingPassModalOverlay'); await pass.waitFor();
    await pass.locator('img.bp-qr-image').waitFor();
    assert.ok(await pass.locator('img.bp-qr-image').evaluate(img => img.complete && img.naturalWidth > 0));
    await page.keyboard.press('Escape'); await pass.waitFor({ state: 'hidden' });
    await page.goto(base + '/user-about-contact.html', { waitUntil: 'domcontentloaded' });
    await page.locator('[name="name"]').fill('Ali Raza'); await page.locator('[name="email"]').fill('ali.raza@example.test');
    await page.locator('[name="message"]').fill('Please assist with this browser test reservation.');
    await page.locator('.contact-submit-btn').click(); await page.locator('#contactSuccessBanner').waitFor({ state: 'visible' });
    assert.match(await page.locator('#contactSuccessBanner').innerText(), /Message saved/);
    await page.goto(base + '/flight-search.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#searchFromAirport').selectOption('KHI'); await page.locator('#searchToAirport').selectOption('ISB');
    await page.locator('#searchDepDate').fill(outboundDate.date);
    await page.locator('#flightSearchForm button[type="submit"]').click();
    await page.locator('.btn-book-flight').first().click();
    await page.locator('[name="passenger_1_firstName"]').fill('Nida'); await page.locator('[name="passenger_1_lastName"]').fill('Ahmed');
    await page.getByRole('button', { name: /Reserve & Hold/ }).click();
    await page.waitForURL('**/my-bookings.html');
    const [[reserved]] = await db.pool.execute("SELECT b.booking_id, b.status FROM bookings b JOIN booking_passengers bp ON bp.booking_id = b.booking_id JOIN passengers p ON p.passenger_id = bp.passenger_id WHERE p.first_name = 'Nida'");
    assert.equal(reserved.status, 'PENDING');
    assert.equal(await page.locator('#mockPaymentOverlay').count(), 0);
    await page.locator(`button[onclick="triggerPayPendingBooking(${reserved.booking_id})"]`).click();
    const paymentResponse = page.waitForResponse(response => response.url().endsWith(`/bookings/${reserved.booking_id}/pay`) && response.status() === 200);
    const paymentNavigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() && frame.url().endsWith('/my-bookings.html') });
    await page.getByRole('button', { name: 'Confirm demo booking' }).click();
    await paymentResponse;
    await paymentNavigation; await page.waitForLoadState('domcontentloaded');
    await page.goto(base + `/check-in.html?booking=${reserved.booking_id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('button.seat[data-seat="4C"]').click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.seat-info')?.textContent.startsWith('Selected 0 of'));
    const [[holds]] = await db.pool.execute("SELECT COUNT(*) AS active FROM seat_holds WHERE booking_id = ? AND status = 'HELD'", [reserved.booking_id]);
    assert.equal(holds.active, 0, 'Reset must release server holds');
    await page.locator('button.seat[data-seat="4C"]').click();
    await page.getByRole('button', { name: 'Confirm Seats', exact: true }).click();
    await page.locator('#checkinSuccess').waitFor({ state: 'visible' });
    await page.locator('#boardingPass img.bp-qr-image').waitFor();
    assert.ok(await page.locator('#boardingPass img.bp-qr-image').evaluate(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(artifacts, 'completed-checkin.png'), fullPage: true });
    const [[returnDate]] = await db.pool.execute("SELECT DATE_FORMAT(departure_datetime,'%Y-%m-%d') AS date FROM flights WHERE flight_number='SW650'");
    await page.goto(base+'/flight-search.html',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Return',exact:true}).click();
    await page.locator('#searchFromAirport').selectOption('KHI'); await page.locator('#searchToAirport').selectOption('ISB');
    await page.locator('#searchDepDate').fill(outboundDate.date); await page.locator('#searchReturnDate').fill(returnDate.date);
    await page.locator('#flightSearchForm button[type="submit"]').click();
    await page.locator('.journey-result-leg').nth(0).locator('.btn-book-flight').first().click(); await page.locator('.journey-result-leg').nth(1).locator('.btn-book-flight').first().click();
    await page.getByRole('button',{name:'Continue with journey',exact:true}).click();
    await page.locator('[name="passenger_1_firstName"]').fill('Zara'); await page.locator('[name="passenger_1_lastName"]').fill('Saleem');
    await page.getByRole('button',{name:/Reserve & Hold/}).click(); await page.waitForURL('**/my-bookings.html');
    const [returnBookings]=await db.pool.execute("SELECT b.* FROM bookings b JOIN booking_passengers bp ON bp.booking_id=b.booking_id JOIN passengers p ON p.passenger_id=bp.passenger_id WHERE p.first_name='Zara' ORDER BY b.segment_index");
    assert.equal(returnBookings.length,2); assert.ok(returnBookings.every(b=>b.status==='PENDING'&&b.itinerary_id===returnBookings[0].itinerary_id));
    await page.locator(`button[onclick="triggerPayPendingBooking(${returnBookings[0].booking_id})"]`).click();
    const journeyPaymentResponse = page.waitForResponse(response => response.url().endsWith(`/itineraries/${returnBookings[0].itinerary_id}/pay`) && response.status() === 200);
    const journeyPaymentNavigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() && frame.url().endsWith('/my-bookings.html') });
    await page.getByRole('button',{name:'Confirm demo booking'}).click(); await journeyPaymentResponse; await journeyPaymentNavigation; await page.waitForLoadState('domcontentloaded');
    const [paidReturn]=await db.pool.execute('SELECT status FROM bookings WHERE itinerary_id=?',[returnBookings[0].itinerary_id]); assert.ok(paidReturn.every(b=>b.status==='CONFIRMED'));
    const [[legTwo]]=await db.pool.execute("SELECT DATE_FORMAT(departure_datetime,'%Y-%m-%d') AS date,arrival_datetime FROM flights WHERE flight_id=3");
    const [[legThree]]=await db.pool.execute("SELECT DATE_FORMAT(departure_datetime,'%Y-%m-%d') AS date FROM flights WHERE from_airport_code='LHE' AND to_airport_code='KHI' AND departure_datetime > ? ORDER BY departure_datetime LIMIT 1",[legTwo.arrival_datetime]);
    await page.goto(base+'/flight-search.html',{waitUntil:'domcontentloaded'}); await page.setViewportSize({width:390,height:900});
    await page.locator('#searchFromAirport').selectOption('KHI'); await page.locator('#searchToAirport').selectOption('ISB'); await page.locator('#searchDepDate').fill(outboundDate.date);
    await page.getByRole('button',{name:'Multi-city',exact:true}).click();
    await page.locator('.journey-leg').nth(0).locator('[data-leg-field="from"]').selectOption('ISB'); await page.locator('.journey-leg').nth(0).locator('[data-leg-field="to"]').selectOption('LHE'); await page.locator('.journey-leg').nth(0).locator('[data-leg-field="departure"]').fill(legTwo.date);
    await page.getByRole('button',{name:'+ Add flight leg',exact:true}).click();
    await page.locator('.journey-leg').nth(1).locator('[data-leg-field="from"]').selectOption('LHE'); await page.locator('.journey-leg').nth(1).locator('[data-leg-field="to"]').selectOption('KHI'); await page.locator('.journey-leg').nth(1).locator('[data-leg-field="departure"]').fill(legThree.date);
    await page.locator('#flightSearchForm button[type="submit"]').click();
    for(let i=0;i<3;i++) await page.locator('.journey-result-leg').nth(i).locator('.btn-book-flight').first().click();
    assert.ok(await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth<=2));
    await page.screenshot({path:path.join(artifacts,'journey-search-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Continue with journey',exact:true}).click(); await page.locator('[name="passenger_1_firstName"]').fill('Hina'); await page.locator('[name="passenger_1_lastName"]').fill('Aslam');
    await page.getByRole('button',{name:/Reserve & Hold/}).click(); await page.waitForURL('**/my-bookings.html');
    const [[multiCount]]=await db.pool.execute("SELECT COUNT(*) AS count FROM bookings b JOIN booking_passengers bp ON bp.booking_id=b.booking_id JOIN passengers p ON p.passenger_id=bp.passenger_id WHERE p.first_name='Hina' AND b.status='PENDING'"); assert.equal(multiCount.count,3);
    await ctx.close();
    const { context: staffCtx, page: staffPage } = await context('crew', 1280);
    staffPage.on('dialog', dialog => dialog.accept());
    await staffPage.goto(base + '/crew-portal.html', { waitUntil: 'domcontentloaded' });
    await staffPage.locator('.crew-flight').filter({ hasText:'SW201' }).click();
    await staffPage.locator('#gateWorkspace').waitFor({ state:'visible' });
    await staffPage.getByRole('button', { name:'Open boarding', exact:true }).click();
    await staffPage.waitForFunction(() => document.getElementById('gateFlightDetails').textContent.includes('Boarding open'));
    const [[pax]] = await db.pool.execute('SELECT boarding_token FROM booking_passengers WHERE booking_id = ?', [reserved.booking_id]);
    await staffPage.locator('[name="boarding_token"]').fill(pax.boarding_token);
    await staffPage.locator('[name="identity_verified"]').check();
    await staffPage.getByRole('button', { name:'Record boarding', exact:true }).click();
    await staffPage.waitForFunction(() => document.getElementById('gateOperationResult').textContent.includes('Passenger boarding recorded'));
    await staffPage.waitForFunction(() => document.getElementById('gateAuditRows').textContent.includes('BOARDING SCAN'));
    await staffPage.screenshot({ path:path.join(artifacts,'crew-portal-desktop.png'), fullPage:true });
    await staffPage.setViewportSize({width:390,height:900});
    assert.ok(await staffPage.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth<=2));
    await staffPage.screenshot({path:path.join(artifacts,'crew-portal-mobile.png'),fullPage:true});
    await staffCtx.close();
    const { context: adminCtx, page: adminPage } = await context('admin', 1280);
    adminPage.on('dialog', dialog => dialog.accept());
    await adminPage.goto(base + '/admin-dashboard.html', { waitUntil:'domcontentloaded' });
    const message = adminPage.locator('.inbox-card').filter({ hasText:'Please assist with this browser test reservation.' });
    await message.getByRole('button', { name:'Resolve', exact:true }).click();
    await adminPage.locator('#inboxStatus').selectOption('resolved'); await message.waitFor();
    await message.getByRole('button', { name:'Delete message', exact:true }).click();
    await message.waitFor({ state:'hidden' });
    await adminPage.locator('#inboxStatus').selectOption('trash'); await message.waitFor();
    await message.getByRole('button', { name:'Restore', exact:true }).click(); await message.waitFor({ state:'hidden' });
    await adminPage.locator('#inboxStatus').selectOption('all'); await message.waitFor();
    await adminPage.screenshot({ path:path.join(artifacts,'admin-inbox-desktop.png'), fullPage:true });
    await adminPage.setViewportSize({width:390,height:900});
    assert.ok(await adminPage.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth<=2));
    await adminPage.screenshot({path:path.join(artifacts,'admin-inbox-mobile.png'),fullPage:true});
    await adminCtx.close();
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    console.log('Browser checks passed: all 14 pages at desktop/mobile widths; one-way, return and three-leg multi-city booking; seat hold/reset, check-in, QR, crew boarding, gate audit, inbox resolve/delete/restore and persisted contact.');
  } finally {
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); await db.pool.end();
    const connection = await setup.openConnection();
    try { if (!/^skywings_test_browser_\d+$/.test(name)) throw new Error('Unsafe browser cleanup target'); await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await connection.end(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
