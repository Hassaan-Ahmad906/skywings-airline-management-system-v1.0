const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const checks=[['test','master_test.js'],['test:schema','check_schema.js'],['test:workflows','check_workflows.js'],['test:seed','check_seed.js'],['test:ui','check_ui_accessibility.js'],['test:enterprise','check_enterprise_workflows.js'],['test:metrics','check_metrics.js'],['test:browser','check_browser_workflows.js']];
const directory=path.join(__dirname,'../artifacts');fs.mkdirSync(directory,{recursive:true});
const report={started_at:new Date().toISOString(),checks:[],passed:false};
const reportFile=path.join(directory,'final-test-results.json'),logFile=path.join(directory,'final-test-output.log');
fs.writeFileSync(logFile,'');
for(const [name,file] of checks){
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  const result=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:path.join(__dirname,'..'),encoding:'utf8',maxBuffer:10*1024*1024,env:{...process.env,NODE_ENV:'test',NOTIFICATIONS_ENABLED:'false'}});
  fs.appendFileSync(logFile,`\n=== ${name} ===\n${result.stdout||''}${result.stderr||''}`);
  report.checks.push({command:`npm run ${name}`,passed:result.status===0,exit_code:result.status});
  console.log(`${result.status===0?'PASS':'FAIL'}: ${name}`);
  if(result.status!==0){console.error(result.error?.message||result.stderr||result.stdout);process.exitCode=1;break;}
}
report.finished_at=new Date().toISOString();report.passed=report.checks.length===checks.length&&report.checks.every(c=>c.passed);
fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
console.log(`Results saved: ${reportFile}`);
