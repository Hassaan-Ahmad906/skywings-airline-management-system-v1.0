const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { accounts: demoAccounts } = require('../backend/config/demoSeed');
const name = `skywings_test_browser_${process.pid}`;
process.env.DB_NAME = name; process.env.NODE_ENV = 'test'; process.env.PAYMENT_MODE = 'demo'; process.env.NOTIFICATIONS_ENABLED = 'false';
const setup = require('./databaseSetup');
const db = require('../backend/config/database');
async function main() {
  let server, browser, workflowError, activePage;
  try {
    await setup({ database: name }); await require('./seed_database')();
    await db.pool.execute("INSERT INTO flights (flight_number,aircraft_id,from_airport_code,to_airport_code,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) SELECT 'SW650',aircraft_id,'ISB','KHI',DATE_ADD(NOW(),INTERVAL 26 HOUR),DATE_ADD(NOW(),INTERVAL 28 HOUR),120,180,240 FROM aircraft WHERE registration='AP-SWD'");
    server = await require('../backend/server').startServer(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const errors = [], failures = [];
    const artifacts = path.join(__dirname, '../artifacts'); fs.mkdirSync(artifacts, { recursive: true });
    async function context(role, width) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Karachi' });
      if (role) {
        const response = await context.request.post(base + '/api/auth/login', { data: demoAccounts[role] }); assert.equal(response.status(), 200);
      }
      const page = await context.newPage();
      activePage = page;
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
    console.log('Desktop/mobile page and overflow checks passed for all three roles and public pages.');
    const { context: ctx, page } = await context('user', 1280);
    async function browserDate(value) {
      return page.evaluate(instant => {
        const date = new Date(instant);
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      }, value.toISOString());
    }
    // Relative seed flights can depart tomorrow when this check runs near midnight.
    const [[outboundDate]] = await db.pool.execute("SELECT departure_datetime FROM flights WHERE flight_number='SW201'");
    outboundDate.date = await browserDate(outboundDate.departure_datetime);
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base + '/my-bookings.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Boarding Pass', exact: false }).first().click();
    const pass = page.locator('#boardingPassModalOverlay'); await pass.waitFor();
    await pass.locator('img.bp-qr-image').waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector('#boardingPassModalOverlay img.bp-qr-image');
      return img?.complete && img.naturalWidth > 0;
    });
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
    await page.waitForFunction(() => {
      const img = document.querySelector('#boardingPass img.bp-qr-image');
      return img?.complete && img.naturalWidth > 0;
    });
    assert.ok(await page.locator('#boardingPass img.bp-qr-image').evaluate(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(artifacts, 'completed-checkin.png'), fullPage: true });
    console.log('Customer reservation, payment, seat hold/reset, check-in and loaded QR images passed.');
    const [[returnDate]] = await db.pool.execute("SELECT departure_datetime FROM flights WHERE flight_number='SW650'");
    returnDate.date = await browserDate(returnDate.departure_datetime);
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
    const [[legTwo]]=await db.pool.execute("SELECT departure_datetime,arrival_datetime FROM flights WHERE flight_number='SW203'");
    legTwo.date = await browserDate(legTwo.departure_datetime);
    const [[legThree]]=await db.pool.execute("SELECT departure_datetime FROM flights WHERE from_airport_code='LHE' AND to_airport_code='KHI' AND departure_datetime > ? ORDER BY departure_datetime LIMIT 1",[legTwo.arrival_datetime]);
    legThree.date = await browserDate(legThree.departure_datetime);
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
    console.log('Return and mobile multi-city booking workflows passed.');
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
    for (const width of [1280,390]) {
      const { context: signupCtx, page: signupPage } = await context(null,width);
      const authDialogs = [];
      signupPage.on('dialog', dialog => { authDialogs.push(dialog.message()); dialog.dismiss(); });
      const email = `browser.signup.${width}@example.test`, password = 'BrowserSignup123!';
      await signupPage.goto(base+'/register.html',{waitUntil:'domcontentloaded'});
      await signupPage.locator('[name="firstName"]').fill('Ali'); await signupPage.locator('[name="lastName"]').fill('Raza');
      await signupPage.locator('[name="email"]').fill(email); await signupPage.locator('[name="password"]').fill(password); await signupPage.locator('[name="confirmPassword"]').fill(password);
      for (const id of ['regPassword','confirmPassword']) {
        const toggle = signupPage.locator(`button[aria-controls="${id}"]`);
        await toggle.click(); assert.equal(await signupPage.locator('#'+id).getAttribute('type'),'text');
        assert.equal(await signupPage.locator('#'+id).inputValue(),password);
        await toggle.click(); assert.equal(await toggle.getAttribute('aria-pressed'),'false');
      }
      await signupPage.getByRole('button',{name:'Create Account',exact:true}).click(); await signupPage.waitForURL('**/user-dashboard.html');
      if(width===390) await signupPage.getByRole('button',{name:'Toggle navigation',exact:true}).click();
      await signupPage.getByRole('link',{name:'Logout',exact:true}).click(); await signupPage.waitForURL('**/index.html');
      await signupPage.goto(base+'/login.html',{waitUntil:'domcontentloaded'});
      authDialogs.length = 0;
      await signupPage.locator('[name="email"]').fill(email); await signupPage.locator('[name="password"]').fill('WrongPassword123!');
      const rejected = signupPage.waitForResponse(response => response.url().endsWith('/auth/login'));
      await signupPage.getByRole('button',{name:'Sign In',exact:true}).click();
      const rejectedBody = await (await rejected).json();
      await signupPage.locator('.form-error').waitFor();
      assert.match(await signupPage.locator('.form-error').innerText(),/Support reference:/);
      assert.ok((await signupPage.locator('.form-error').innerText()).includes(rejectedBody.request_id));
      assert.equal(await signupPage.locator('.form-error').getAttribute('role'),'alert');
      assert.deepEqual(authDialogs,[],'Login errors must stay inline without a blocking debug alert');
      await signupPage.locator('[name="email"]').fill(email); await signupPage.locator('[name="password"]').fill(password);
      await signupPage.getByRole('button',{name:'Show password',exact:true}).click();
      assert.equal(await signupPage.locator('[name="password"]').getAttribute('type'),'text');
      assert.equal(await signupPage.locator('[name="password"]').inputValue(),password);
      await signupPage.getByRole('button',{name:'Hide password',exact:true}).click();
      await signupPage.getByRole('button',{name:'Sign In',exact:true}).click(); await signupPage.waitForURL('**/user-dashboard.html');
      const authenticated = await signupCtx.request.get(base+'/api/auth/check'); assert.equal(authenticated.status(),200);
      assert.equal((await authenticated.json()).data.user.email,email);
      await signupCtx.close();
    }
    // Model Vercel clean URLs while serving the same real HTML and API locally.
    async function cleanUrls(ctx) {
      await ctx.route(url => ['login','register','crew-portal','admin-dashboard','user-dashboard'].includes(new URL(url).pathname.slice(1)), async route => {
        const url = new URL(route.request().url()); url.pathname += '.html';
        await route.fulfill({ response: await route.fetch({url:url.href}) });
      });
    }
    for (const role of ['user','admin','crew']) {
      const { context: staleCtx, page: stalePage } = await context(null,390);
      await cleanUrls(staleCtx);
      await staleCtx.addInitScript(role => localStorage.setItem('skywings_auth_role',role),role);
      for (const file of ['login.html','register.html','login','register']) {
        const navigations = [];
        const track = request => { if(request.isNavigationRequest()) navigations.push(new URL(request.url()).pathname); };
        stalePage.on('request',track);
        await stalePage.goto(base+'/'+file,{waitUntil:'domcontentloaded'});
        await stalePage.waitForFunction(() => localStorage.getItem('skywings_auth_role') === null);
        assert.equal(new URL(stalePage.url()).pathname,'/'+file);
        assert.deepEqual(navigations,['/'+file],'Stale roles must not redirect through protected dashboards');
        stalePage.off('request',track);
      }
      await staleCtx.close();
      const { context: validCtx, page: validPage } = await context(role,1280);
      await cleanUrls(validCtx);
      const destination = role === 'crew' ? 'crew-portal.html' : role+'-dashboard.html';
      for (const file of ['login.html','register.html','login','register']) {
        await validPage.goto(base+'/'+file,{waitUntil:'domcontentloaded'});
        await validPage.waitForURL('**/'+destination);
      }
      await validCtx.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    console.log('Browser checks passed: all 14 pages at desktop/mobile widths; signup/logout/re-login, password visibility, inline login support references, stale roles and authenticated redirects on HTML/clean URLs for all roles; one-way, return and three-leg multi-city booking; seat hold/reset, check-in, QR, crew boarding, gate audit, inbox resolve/delete/restore and persisted contact.');
  } catch (error) {
    workflowError = error;
    console.error('Browser workflow failed at ' + (activePage?.url() || 'setup'));
    if (activePage && !activePage.isClosed()) {
      try { await activePage.screenshot({ path: path.join(__dirname, '../artifacts/browser-workflow-failure.png'), fullPage: true }); }
      catch (_) { /* Preserve the workflow error if diagnostic capture fails. */ }
    }
    throw error;
  } finally {
    require('../backend/services/seatHoldCleaner').stop();
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); await db.pool.end();
    try {
      const connection = await setup.openConnection();
      try { if (!/^skywings_test_browser_\d+$/.test(name)) throw new Error('Unsafe browser cleanup target'); await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await connection.end(); }
    } catch (error) {
      console.error(`Disposable browser database cleanup failed: ${error.code || error.message} (${name})`);
      if (!workflowError) throw error;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
