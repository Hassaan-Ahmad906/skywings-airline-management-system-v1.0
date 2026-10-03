const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const source=fs.readFileSync('frontend/js/main.js','utf8');
const nodes=acorn.parse(source,{ecmaVersion:'latest'}).body;
function evaluate(name,globals={}){const context=vm.createContext(globals),node=nodes.find(node=>node.id?.name===name);vm.runInContext(source.slice(node.start,node.end),context);return context[name];}
test('report CSV uses real nested metrics and preserves unavailable values and quoted cells',()=>{
  const csv=evaluate('buildReportCsv');
  const performance=csv('performance',{onTimePerformance:{rate:null,total:9,delayed:2,cancelled:1},occupancy:{rate:1,booked:7,total:800},customerSatisfaction:{average:null},efficiency:{avgFlightTime:'1h 0m'}},'test');
  assert.match(performance,/"Occupancy rate","1%"/);assert.match(performance,/"Booked seats","7"/);
  assert.match(performance,/"On-time rate","Unavailable"/);assert.match(performance,/"Customer satisfaction","Unavailable"/);
  assert.ok(!performance.includes('[object Object]'));
  const routes=csv('routes',{popularRoutes:[{route:'Karachi, "Sindh"',booking_count:2,revenue:4000.5}],routePerformance:[],routeRevenue:[]},'test');
  assert.match(routes,/"Karachi, ""Sindh""","2","\$4000\.50"/);
  const overview=csv('overview',{revenue:{total:7900,monthly:7500},bookings:{total:15,monthly:14},performance:{onTimeRate:null,occupancyRate:1,customerSatisfaction:null},popularRoutes:[{route:'=1+1',booking_count:10,total_revenue:7900}]},'test');
  assert.match(overview,/"Total paid booking value","\$7900\.00"/);assert.match(overview,/"'=1\+1","10","\$7900\.00"/);
  const revenue=csv('revenue',{totalRevenue:7900,monthlyRevenue:7500,growth:null,revenueByRoute:[],revenueTrend:[]},'test');
  assert.match(revenue,/"Growth","Unavailable"/);
  const bookings=csv('bookings',{totalBookings:15,monthlyBookings:14,growth:null,bookingStatus:[{status:'COMPLETED',count:2}],bookingTrend:[],bookingsByFlight:[]},'test');
  assert.match(bookings,/"COMPLETED","2"/);
});
test('upcoming booking classification respects server flags and excludes expired holds and terminal states',()=>{
  const upcoming=evaluate('isUpcomingBooking');
  assert.equal(upcoming({is_upcoming:1,departure_datetime:'2000-01-01'}),true);
  const future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
  assert.equal(upcoming({is_upcoming:0,status:'CONFIRMED',departure_datetime:future}),false);
  assert.equal(upcoming({status:'PENDING',departure_datetime:future,reservation_expires_at:past}),false);
  assert.equal(upcoming({status:'PENDING',departure_datetime:future,reservation_expires_at:future}),true);
  for(const status of ['COMPLETED','MISSED','CANCELLED','EXPIRED']) assert.equal(upcoming({status,departure_datetime:future}),false);
  assert.equal(upcoming({status:'CONFIRMED',flight_status:'cancelled',departure_datetime:future}),false);
});
test('report line charts generate valid numeric SVG paths',()=>{
  const element={innerHTML:''};
  const render=evaluate('renderLineChart',{document:{getElementById:()=>element},console,
    html:(strings,...values)=>strings.reduce((result,part,index)=>result+part+(values[index]??''),''),rawHtml:value=>value});
  render('chart',[{month:'June',value:10},{month:'July',value:20}]);
  const path=element.innerHTML.match(/<path d="([^"]+)"/)[1];
  assert.equal(path,'M 0 50 L 100 0');assert.ok(!/NaN|Infinity|%/.test(path));
});
test('a slower previous flight search cannot overwrite a newer result',async()=>{
  let resolveOld;
  const old=new Promise(resolve=>{resolveOld=resolve;});
  const table={innerHTML:''},badges={upcomingFlightsCountBadge:{},pastFlightsCountBadge:{}};
  const state={upcomingList:[],pastList:[]};
  const response=flight_number=>({success:true,data:{flights:[{flight_number,is_upcoming:1,departure_datetime:'2030-01-01'}],pagination:{totalPages:1}}});
  const load=evaluate('loadAdminFlights',{adminFlightsLoadVersion:0,adminFlightsState:state,URLSearchParams,console,
    document:{querySelector:()=>table,getElementById:id=>badges[id]},
    apiRequest:url=>url.includes('search=old')?old:Promise.resolve(response('LATEST')),
    renderAdminFlightsUpcomingPage:()=>{},renderAdminFlightsPastPage:()=>{}});
  const previous=load(1,'old');await load(1,'new');resolveOld(response('STALE'));await previous;
  assert.equal(state.upcomingList[0].flight_number,'LATEST');assert.equal(badges.upcomingFlightsCountBadge.textContent,1);
});
