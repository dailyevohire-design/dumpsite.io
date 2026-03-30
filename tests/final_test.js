#!/usr/bin/env node
const https=require("https"),http=require("http")
const BASE=process.argv[2]||"http://localhost:3333"
const WH=BASE+"/api/sms/webhook"
const G="\x1b[32m",R="\x1b[31m",Y="\x1b[33m",C="\x1b[36m",B="\x1b[1m",P="\x1b[35m",GR="\x1b[90m",X="\x1b[0m"
let p=0,f=0,w=0;const fails=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function sms(from,body,opts={}){
  const sid=`SM${Date.now()}${Math.random().toString(36).slice(2,8)}`;const params={From:`+1${from}`,To:"+14697174225",Body:body||"",MessageSid:sid,NumMedia:opts.nm||"0",AccountSid:"ACtest"}
  if(opts.mu){params.MediaUrl0=opts.mu;params.MediaContentType0="image/jpeg"}
  const qs=new URLSearchParams(params).toString();const url=new URL(WH),isH=url.protocol==="https:",lib=isH?https:http
  return new Promise(res=>{const req=lib.request({hostname:url.hostname,port:url.port||(isH?443:80),path:url.pathname,method:"POST",timeout:20000,headers:{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(qs)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{const m=d.match(/<Message[^>]*>([\s\S]*?)<\/Message>/i);res({s:r.statusCode,t:m?m[1].trim():"",from})})});req.on("error",e=>res({s:0,t:"ERR:"+e.message,from}));req.on("timeout",()=>{req.destroy();res({s:0,t:"TIMEOUT",from})});req.write(qs);req.end()})
}
function ok(name,r,checks){
  const t=r.t||"",errs=[]
  for(const c of checks){
    if(c.t==="has"&&!t.toLowerCase().includes(c.v.toLowerCase()))errs.push(`Missing "${c.v}"`)
    if(c.t==="no"&&t.toLowerCase().includes(c.v.toLowerCase()))errs.push(`Has "${c.v}"`)
    if(c.t==="empty"&&t.trim())errs.push(`Not empty`)
    if(c.t==="notempty"&&!t.trim())errs.push("Empty")
    if(c.t==="short"&&t.length>c.v)errs.push(`${t.length}>${c.v}chars`)
    if(c.t==="http"&&r.s!==c.v)errs.push(`HTTP ${r.s}`)
    if(c.t==="nobot"){for(const bp of["Reply 1-5","Reply:","press 1","select one"]){if(t.toLowerCase().includes(bp.toLowerCase()))errs.push(`Bot: "${bp}"`)}}
    if(c.t==="nocode"&&/DS-[A-Z0-9]{5,}/.test(t))errs.push("Code leaked")
    if(c.t==="noai"){for(const ap of["i am an ai","i'm an ai","language model","claude","anthropic","i am a bot"]){if(t.toLowerCase().includes(ap))errs.push(`AI: "${ap}"`)}}
    if(c.t==="nopay"&&/got it.{0,20}we will have|listo.{0,20}mandamos|sent shortly/i.test(t))errs.push("Fake pay")
    if(c.t==="$"&&!/\$\d+/.test(t))errs.push("No $")
    if(c.t==="noceil"&&t.includes(`$${c.v}`))errs.push(`Ceiling $${c.v}`)
    if(c.t==="ceilstop"&&!/best|most|all i can|thats|cant go|no more|eso es lo mejor|that is the best/i.test(t))errs.push("No ceiling stop")
    if(c.t==="spanish"&&!/\b(tienes|tengo|tierra|como|para|cuantos|mandame|listo|zelle|venmo|cuantas|yardas|foto|dejame|avisame|puedo|hacer|por|carga|dale|mandamos|rato|direccion|limpia|volteo|camion|primero|precio|pago|necesito)\b/i.test(t))errs.push("Not Spanish")
    if(c.t==="noaddr"&&t.toLowerCase().includes(c.v.toLowerCase()))errs.push("Driver addr echoed")
  }
  const icon=errs.length===0?"✓":"✗",col=errs.length===0?G:R
  console.log(`${col}${icon}${X} ${name}`);console.log(`  ${GR}+1${r.from}${X} ${C}"${t.slice(0,100)}"${X}`)
  if(errs.length){f++;errs.forEach(e=>{console.log(`  ${R}  ✗ ${e}${X}`);fails.push(`${name}: ${e}`)})}else p++
  return t
}
async function run(){
  console.log(`\n${B}${P}╔══════════════════════════════════════════════╗${X}`)
  console.log(`${B}${P}║  FINAL PRE-LAUNCH TEST — ${BASE.slice(0,25).padEnd(20)} ║${X}`)
  console.log(`${B}${P}╚══════════════════════════════════════════════╝${X}`)
  const T=Date.now().toString().slice(-5);let r

  // CRITICAL: Address security
  console.log(`\n${B}${P}── Address Security ──${X}`)
  const a1=`555${T}01`;await sms(a1,"hey");await sleep(600);await sms(a1,"Test D");await sleep(600)
  r=await sms(a1,"1717 n harwood st dallas tx")
  ok("CRIT-1 Driver addr NOT echoed as dump site",r,[{t:"notempty"},{t:"noaddr",v:"1717 n harwood"},{t:"nocode"}]);await sleep(800)

  // CRITICAL: Natural truck Q
  console.log(`\n${B}${P}── Natural Truck Question ──${X}`)
  const a2=`555${T}02`;await sms(a2,"hey");await sleep(500);await sms(a2,"Test D");await sleep(500)
  r=await sms(a2,"I got dirt in Anna TX")
  ok("CRIT-2 Truck Q natural",r,[{t:"notempty"},{t:"nobot"},{t:"no",v:"Reply:"},{t:"no",v:"tandem, triaxle"}]);await sleep(800)

  // CRITICAL: Affirmative
  console.log(`\n${B}${P}── Affirmative ──${X}`)
  const a3=`555${T}03`;await sms(a3,"hey");await sleep(500);await sms(a3,"Test D");await sleep(500)
  await sms(a3,"I got dirt");await sleep(600)
  r=await sms(a3,"yes")
  ok("CRIT-3 YES advances",r,[{t:"notempty"},{t:"no",v:"you got dirt today"},{t:"no",v:"hauling today"}]);await sleep(800)

  // CRITICAL: Photo only
  console.log(`\n${B}${P}── Photo Only ──${X}`)
  const a4=`555${T}04`;await sms(a4,"hey");await sleep(500);await sms(a4,"Test D");await sleep(500)
  await sms(a4,"dirt in mckinney tandem");await sleep(600)
  r=await sms(a4,"",{nm:"1",mu:"https://picsum.photos/400/300"})
  ok("CRIT-4 Photo no restart",r,[{t:"notempty"},{t:"no",v:"you got dirt today"},{t:"no",v:"hauling"}]);await sleep(800)

  // CRITICAL: Ceiling
  console.log(`\n${B}${P}── Negotiation Ceiling ──${X}`)
  const a5=`555${T}05`;await sms(a5,"hey");await sleep(500);await sms(a5,"Test D");await sleep(500)
  await sms(a5,"200 yards clean fill McKinney end dump");await sleep(800)
  r=await sms(a5,"how much per load");ok("CRIT-5a Floor",r,[{t:"notempty"},{t:"$"}]);await sleep(800)
  r=await sms(a5,"I need $60 minimum");ok("CRIT-5b $60→stop",r,[{t:"notempty"},{t:"ceilstop"}]);await sleep(800)

  // CRITICAL: Identity
  console.log(`\n${B}${P}── Identity Defense ──${X}`)
  for(const q of["are you a bot","is this ai","are you real","eres un robot"]){
    const ph=`555${T}${Math.floor(Math.random()*9000+1000)}`;await sms(ph,"hey");await sleep(400);await sms(ph,"T D");await sleep(400)
    r=await sms(ph,q);ok(`CRIT-6 "${q}"`,r,[{t:"notempty"},{t:"noai"}]);await sleep(500)
  }

  // Payment trap
  console.log(`\n${B}${P}── Payment Trap ──${X}`)
  for(const msg of["hello","what","lol","???","yes"]){
    r=await sms(`555${T}${Math.floor(Math.random()*9000+1000)}`,msg)
    ok(`CRIT-7 "${msg}" no fake pay`,r,[{t:"http",v:200},{t:"nopay"}]);await sleep(400)
  }

  // Reset
  console.log(`\n${B}${P}── Reset ──${X}`)
  for(const w of["reset","cancel","help","start over"]){
    r=await sms(`555${T}${Math.floor(Math.random()*9000+1000)}`,w)
    ok(`CRIT-8 "${w}"`,r,[{t:"notempty"},{t:"nopay"}]);await sleep(400)
  }

  // Spanish
  console.log(`\n${B}${P}── Spanish ──${X}`)
  const es=`555${T}06`;r=await sms(es,"Hola tengo tierra en Dallas");ok("ES-1",r,[{t:"notempty"},{t:"spanish"}]);await sleep(700)
  r=await sms(es,"si camion de volteo");ok("ES-2",r,[{t:"notempty"},{t:"spanish"}]);await sleep(700)
  r=await sms(es,"cuanto pagan");ok("ES-3",r,[{t:"notempty"},{t:"spanish"}]);await sleep(700)
  r=await sms(es,"como me pagan");ok("ES-4",r,[{t:"notempty"},{t:"spanish"}]);await sleep(700)

  // Load parsing
  console.log(`\n${B}${P}── Load Parsing ──${X}`)
  const pl=t=>{if(/^(done|finished|all done|terminamos|that.?s it)$/i.test(t.trim()))return -1;if(/^\d+$/.test(t.trim()))return Math.min(parseInt(t),50);const m1=t.match(/(\d+)\s*(down|loads?|total|done|delivered|drops?|cargas?)/i);if(m1)return Math.min(parseInt(m1[1]),50);const m2=t.match(/(done|delivered|dropped|terminé|tiramos)\s*(\d+)/i);if(m2)return Math.min(parseInt(m2[2]),50);return null}
  for(const[i,e]of[["10",10],["10 down",10],["delivered 8",8],["dropped 12",12],["done",-1],["finished",-1]]){const r=pl(i),o=r===e;console.log(`  ${o?G+"✓":R+"✗"}${X} "${i}"→${r} (${e})`);if(o)p++;else{f++;fails.push(`Parse "${i}":${r}!=${e}`)}}

  // Account validation
  console.log(`\n${B}${P}── Account Validation ──${X}`)
  const lk=a=>{const d=a.replace(/\D/g,"");return d.length>=7||/@/.test(a)||/^[A-Z][a-z]+ [A-Z][a-z]+/.test(a)||/^[a-z]+ [a-z]+$/i.test(a)||(a.startsWith("@")&&a.length>=4)}
  for(const[a,w]of[["214-555-1234",true],["john@gmail.com",true],["John Smith",true],["hello",false],["lol",false],["yes",false]]){const g=lk(a),o=g===w;console.log(`  ${o?G+"✓":R+"✗"}${X} "${a}"→${g} (${w})`);if(o)p++;else{f++;fails.push(`Acct "${a}":${g}!=${w}`)}}

  // STOP/START
  console.log(`\n${B}${P}── STOP/START ──${X}`)
  const sp=`555${T}07`;r=await sms(sp,"STOP");ok("STOP",r,[{t:"empty"}]);await sleep(500)
  r=await sms(sp,"START");ok("START",r,[{t:"notempty"}])

  // Edge cases
  console.log(`\n${B}${P}── Edge Cases ──${X}`)
  for(const m of["lol","???","k","HELLO","asdfgh",".","wrong number"]){
    r=await sms(`555${T}${Math.floor(Math.random()*9000+1000)}`,m)
    ok(`"${m}"`,r,[{t:"http",v:200},{t:"nobot"},{t:"short",v:400}]);await sleep(400)
  }

  // Summary
  console.log(`\n${B}${P}╔══════════════════════════════════════════════╗${X}`)
  console.log(`${B}${P}║  RESULTS                                     ║${X}`)
  console.log(`${B}${P}╚══════════════════════════════════════════════╝${X}`)
  console.log(`  ${G}✓ PASSED: ${p}${X}`);console.log(`  ${R}✗ FAILED: ${f}${X}`);console.log(`  ${Y}⚠ WARNED: ${w}${X}`)
  if(f===0)console.log(`\n${G}${B}  ✓ ALL TESTS PASSED — READY FOR REAL DRIVERS${X}\n`)
  else{console.log(`\n${R}${B}  ${f} FAILURES:${X}`);fails.forEach(x=>console.log(`  ${R}→ ${x}${X}`))}
  process.exit(f>0?1:0)
}
run().catch(e=>{console.error(`${R}CRASH: ${e.message}${X}`);process.exit(1)})
