// Local synthetic QA through real Pages handlers; no external account or network writes.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node site/tests/smoke-picture-timeline-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { d1, r2, SITE } from './helpers.mjs';
import { setup, findOrCreateUser, startSession, sha256 } from '../lib/accounts.js';
import { onRequest as profileApi } from '../functions/api/profile/[action].js';
import { onRequest as picturesApi } from '../functions/api/profile/pictures/index.js';
import { onRequest as imageApi } from '../functions/pictures/[file].js';
import { onRequestGet as profileGet } from '../functions/u/[handle].js';
import { readJourney } from '../lib/journey.js';
import { RECORD } from './fixtures/journey/record.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const env = { DB:d1(), STUDIO:r2(), SITE_FEATURES:'pictures,-storyvoice,-lore' };
await setup(env);
let origin = 'http://127.0.0.1';
const user = await findOrCreateUser(env,{email:'picture-qa@example.invalid',googleSub:'picture-qa',name:'Synthetic'});
const cookie = (await startSession(env,new Request(origin),user.id)).split(';')[0];
const token = 'c'.repeat(64);
await env.DB.prepare('INSERT INTO devices (id,token_hash,user_id,label,created,last_used) VALUES (?,?,?,?,?,?)')
  .bind('picture-qa',await sha256(token),user.id,'Synthetic','2026-10-01','2026-10-01').run();
await profileApi({env,params:{action:'import'},request:new Request(origin+'/api/profile/import',{method:'POST',
 headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({record:RECORD})})});
const character = 'a'.repeat(64), t = 1759373420;
const journey = readJourney({v:1,tz:0,moments:[{k:'shot',t,character,z:'Elwynn Forest',s:'Goldshire'}, {k:'zone',t:t+30,z:'Westfall',new:1},
 ...Array.from({length:28},(_,i)=>({k:'lvl',t:t+i+1,lv:i+2})),
 {k:'shot',t:t+40,character,z:'Stormwind City'}, {k:'shot',t:t+50,character,z:'Westfall'}]});
await env.DB.prepare('UPDATE profiles SET public=1, journey=? WHERE user_id=?').bind(JSON.stringify(journey),user.id).run();
const bytes = await readFile(resolve(SITE,'public/screenshots/01-stormwind-panel.jpg'));
const pics = [];
for (const [i,at] of [t,t+40,t+50].entries()) {
 const body = new FormData();
 body.append('meta',JSON.stringify({cid:`synthetic-${i}`,t:at+1,event_t:at,character,caption:`Synthetic picture ${i+1}`,z:i===0?'Elwynn Forest':i===1?'Stormwind City':'Westfall'}));
 body.append('image',new Blob([bytes],{type:'image/jpeg'}),'synthetic.jpg');
 const response=await picturesApi({env,request:new Request(origin+'/api/profile/pictures',{method:'POST',headers:{Authorization:'Bearer '+token},body})});
 assert.equal(response.status,200); pics.push((await response.json()).picture);
}
// Last image deliberately missing from R2: preserve the shot text and hide its failed thumbnail.
env.STUDIO.objects.delete(`pictures/${user.id}/${pics[2].id}.jpg`);
const root=resolve(SITE,'public'), types={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,origin);
  const request=new Request(url,{method:req.method,headers:req.headers});
  let response;
  if(url.pathname.startsWith('/u/')) response=await profileGet({env,params:{handle:url.pathname.slice(3)},request,waitUntil(){}});
  else if(url.pathname.startsWith('/pictures/')) response=await imageApi({env,params:{file:url.pathname.slice(10)},request});
  else if(url.pathname==='/api/profile/pictures') response=await picturesApi({env,request});
  else if(url.pathname==='/api/auth/me') response=new Response(JSON.stringify({user:null,features:{pictures:true}}),{headers:{'Content-Type':'application/json'}});
  if(response){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  const file=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+'/'))throw Error('outside public');
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
origin='http://127.0.0.1:'+server.address().port;
const out=resolve(process.env.PICTURE_QA_OUT || '/tmp/lore-site-picture-timeline-qa');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1280,height:900}}), page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/u/aelric#timeline');
 const newest=page.locator(`.pf-picture[data-pb-target="${pics[1].id}"]`);
 await newest.waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelectorAll('.pf-picture img[data-failed]').length===1);
 assert.equal(await page.locator('.pf-m.pf-k-pictures').count(),3);
 assert.equal(await page.locator(`.pf-picture[data-pb-target="${pics[2].id}"]`).isVisible(),false);
 assert.equal(await page.locator(`.pf-picture[data-pb-target="${pics[2].id}"]`).evaluate(el=>getComputedStyle(el.closest('.pf-m')).gridTemplateColumns.split(' ').length),2,'failed image leaves a full-width event');
 assert.equal(await page.locator(`.pf-picture[data-pb-target="${pics[0].id}"]`).isVisible(),false, 'older picture is initially folded');
 await page.locator('[data-f="places"]').click();
 assert.equal(await newest.isVisible(),false, 'filter hides picture row while same day remains visible');
 await page.locator('[data-f=""]').click();
 assert.equal(await newest.isVisible(),true);
 await page.screenshot({path:out+'/desktop.png',fullPage:false});
 await newest.hover();
 await page.waitForFunction(()=>!document.querySelector('.pf-picture-preview').hidden);
 assert.equal(await page.locator('.pf-picture-preview').getAttribute('src'),origin+pics[1].url);
 const bounds=await page.locator('.pf-picture-preview').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=1280&&bounds.y>=0&&bounds.y+bounds.height<=900);
 await page.screenshot({path:out+'/hover.png'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('.pf-picture-preview').isVisible(),false);
 await page.mouse.move(0,0);await newest.focus();assert.equal(await page.locator('.pf-picture-preview').isVisible(),true);
 await page.keyboard.press('Enter');assert.equal(await page.locator('#pb-view').evaluate(el=>el.open),true);
 assert.equal(await page.locator('#pb-view .pb-cap').textContent(),'Synthetic picture 2');
 await page.screenshot({path:out+'/dialog.png'});
 await page.keyboard.press('Escape');assert.equal(await newest.evaluate(el=>el===document.activeElement),true);
 assert.equal(await page.locator('.pf-picture-preview').isVisible(),false);
 await newest.click();await page.mouse.click(2,2);
 assert.equal(await page.locator('#pb-view').evaluate(el=>el.open),false, 'backdrop closes the dialog');
 await newest.click();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#pb-view .pb-cap').textContent(),'Synthetic picture 1');
 await page.locator('[data-pb="close"]').click();
 if(!await page.locator('#timeline details').evaluate(el=>el.open)) await page.locator('#timeline details > summary').click();
 assert.equal(await page.locator(`.pf-picture[data-pb-target="${pics[0].id}"]`).isVisible(),true);
 const mobile=await browser.newContext({viewport:{width:320,height:740},hasTouch:true,isMobile:true}), narrow=await mobile.newPage();
 narrow.on('pageerror',e=>errors.push(e.message));await narrow.goto(origin+'/u/aelric#timeline');
 const thumb=narrow.locator(`.pf-picture[data-pb-target="${pics[1].id}"]`);await thumb.waitFor({state:'visible'});
 assert.equal(await narrow.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await narrow.screenshot({path:out+'/mobile.png'});await thumb.tap();
 assert.equal(await narrow.locator('#pb-view').evaluate(el=>el.open),true);
 await narrow.screenshot({path:out+'/mobile-dialog.png'});await narrow.locator('[data-pb="close"]').tap();
 const noScript=await browser.newContext({javaScriptEnabled:false}), plain=await noScript.newPage();
 await plain.goto(origin+'/u/aelric#timeline');
 const fallback=plain.locator(`.pf-picture[data-pb-target="${pics[1].id}"]`);
 assert.equal(await fallback.getAttribute('href'),pics[1].url);
 await fallback.click();assert.equal(plain.url(),origin+pics[1].url, 'without JavaScript the thumbnail still opens its image');
 await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:origin}]);
 await page.reload();await newest.click();await page.locator('[data-pb="remove"]').click();
 await page.waitForFunction(id=>!document.querySelector(`.pf-picture[data-pb-target="${id}"]`),pics[1].id);
 assert.equal(await page.locator('.pf-m.pf-k-pictures').count(),3);
 assert.deepEqual(errors,[]);console.log('PASS desktop hover/focus/Escape/dialog/backdrop/arrows, no-JavaScript link, folded events, 320px touch, failed image, owner removal; screenshots: '+out);
}finally{await browser.close();await new Promise(ok=>server.close(ok));env.DB.sqlite.close();}
