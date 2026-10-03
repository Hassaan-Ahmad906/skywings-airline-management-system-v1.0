const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function config(env){
  let captured;
  const context={process:{env},__dirname:__dirname,module:{exports:{}},console,require:name=>name==='dotenv'?{config(){}}:name==='mysql2/promise'?{createPool(options){captured=options;return {};}}:require(name)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../backend/config/database'),'utf8'),context);
  return captured;
}
test('TiDB dates default to UTC regardless of the client machine time zone',()=>{
  assert.equal(config({DB_HOST:'gateway.tidbcloud.com'}).timezone,'Z');
  assert.equal(config({DB_HOST:'localhost'}).timezone,'local');
  assert.equal(config({DB_HOST:'gateway.tidbcloud.com',DB_TIMEZONE:'+05:00'}).timezone,'+05:00');
});
