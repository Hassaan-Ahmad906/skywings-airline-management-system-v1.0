require('./public_demo_env')();
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('@playwright/test');
const db=require('../backend/config/database');
const {accounts}=require('../backend/config/publicDemo');
const {rowDigest}=require('./backup_database');
const report={startedAt:new Date().toISOString(),roles:[]};
async function main(){
  const connection=await db.pool.getConnection();
  let server,browser;
  const prior={};
  try{
    assert.equal(db.pool.pool.config.connectionConfig.database,'skywings_public_demo');
    for(const table of ['bookings','tickets','users']) prior[table]=rowDigest((await connection.query(`SELECT * FROM skywings_airlines.\`${table}\``))[0]);
    server=await require('./start_public_demo')(0);
    const base=`http://127.0.0.1:${server.address().port}`;
    async function request(route,body,cookie){
      const response=await fetch(base+'/api'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    }
    for(const [role,credentials] of Object.entries(accounts)){
      const auth=await request('/auth/login',credentials);assert.equal(auth.status,200);
      const check=await request('/auth/check',undefined,auth.cookie);assert.equal(check.data.data.user.role,role);
      const primary=await fetch('https://skywings-airline-management-system.vercel.app/api/auth/check',{headers:{Cookie:auth.cookie},signal:AbortSignal.timeout(55000)});
      assert.equal(primary.status,401,'Public demo token must not authenticate at the primary deployment');
      assert.equal((await request('/auth/logout',{},auth.cookie)).status,200);
      assert.equal((await request('/auth/check',undefined,auth.cookie)).status,401);
      assert.equal((await request('/auth/login',credentials)).status,200);
      report.roles.push(role);
    }
    browser=await chromium.launch({channel:'chromium',headless:true});
    for(const [role,credentials] of Object.entries(accounts)){
      const context=await browser.newContext({viewport:role==='crew'?{width:390,height:844}:{width:1280,height:900},timezoneId:'Asia/Karachi'}),page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
      await page.goto(base+'/login.html');await page.locator('#email').fill(credentials.email);await page.locator('#password').fill(credentials.password);await page.locator('button[type=submit]').click();
      const landing=role==='admin'?'admin-dashboard':role==='crew'?'crew-portal':'user-dashboard';
      await page.waitForURL(new RegExp('/'+landing+'(?:\\.html)?$'),{timeout:60000});
      if(role==='admin'){
        const stats=await page.evaluate(async()=>{const response=await fetch('/api/admin/stats');return (await response.json()).data;});
        assert.equal(stats.totalBookings,19);assert.equal(stats.totalFlights,63);assert.equal(stats.totalUsers,12);
        const overview=await page.evaluate(async()=>{const response=await fetch('/api/reports/overview');return (await response.json()).data;});
        assert.equal(overview.revenue.total,stats.totalRevenue);
      }
      if(role==='crew')await page.waitForFunction(()=>document.querySelector('#gateOperations')?.textContent.includes('SW'),{timeout:60000});
      if(role==='user')await page.waitForFunction(()=>Number(document.querySelector('#totalBookings')?.textContent)>0);
      assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.evaluate(()=>handleLogout());await context.close();
    }
    assert.equal((await require('./setup_public_demo')()).skipped,true,'Repeat setup must not reset shared demo accounts');
    for(const table of Object.keys(prior))assert.equal(rowDigest((await connection.query(`SELECT * FROM skywings_airlines.\`${table}\``))[0]),prior[table],'Primary installation records must remain unchanged');
    const [[counts]]=await db.pool.query('SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM flights) AS flights,(SELECT COUNT(*) FROM bookings) AS bookings');
    report.counts=counts;report.primaryHistoryUnchanged=true;report.crossDeploymentTokensRejected=true;report.passed=true;
    console.log('Isolated TiDB public demo verified: all three roles login/logout/relogin, customer/admin/crew browser dashboards, repeat setup, distinct tokens rejected by the primary website and unchanged primary records.');
  }finally{
    if(browser)await browser.close();
    require('../backend/services/seatHoldCleaner').stop();
    if(server)await new Promise(resolve=>server.close(resolve));connection.release();await db.pool.end();
  }
}
main().catch(error=>{report.passed=false;report.error=error.code||error.message;console.error(error.code||error.message);process.exitCode=1;}).finally(()=>{report.finishedAt=new Date().toISOString();fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/public-demo-checks.json',JSON.stringify(report,null,2));});
