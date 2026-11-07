// Website verification and artwork exports. No application cleanup commands are run.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,extname,sep} from 'node:path';
const root=resolve('docs');
const require=createRequire(resolve(process.env.SITE_TOOL_DIR||'.site-tools','package.json'));
const {chromium}=require('playwright');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.gif':'image/gif','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const local='http://127.0.0.1:'+server.address().port+'/';
const base=process.env.SITE_URL||local;
let browser;
const assets=[];
try {
  browser=await chromium.launch({args:['--no-sandbox']});
  if(!process.env.SITE_URL){
    await mkdir(resolve(root,'assets'),{recursive:true});
    const page=await browser.newPage({viewport:{width:1280,height:640},deviceScaleFactor:1});
    await page.goto(local+'assets/social-preview.html',{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    for(const [path,type] of [['assets/social.jpg','jpeg'],['social-preview.png','png']]){
      await page.screenshot({path:resolve(root,path),type,...(type==='jpeg'?{quality:90}:{})});assets.push('docs/'+path);
    }
    for(const size of [400,180]){
      await page.setViewportSize({width:size,height:size});
      await page.setContent('<style>body{margin:0;background:transparent}img{display:block;width:'+size+'px;height:'+size+'px}</style><img src="'+local+'logo.svg" alt="">');
      await page.waitForLoadState('networkidle');
      const path='docs/assets/icon-'+size+'.png';await page.screenshot({path,omitBackground:true});assets.push(path);
    }
    await page.close();
  }
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(base))errors.push(response.status()+' '+response.url());});
  await page.goto(base,{waitUntil:'networkidle'});
  const summary=page.locator('#selection-summary');
  assert.equal(await summary.textContent(),'2 selected · 4.75 GiB in this example');
  assert.equal(await page.locator('.report-row input:disabled').count(),3);
  await page.getByRole('button',{name:'Preview a plan',exact:true}).click();
  assert.match(await page.locator('#plan-description').textContent(),/2 example folders · 4.75 GiB/);
  assert.doesNotMatch(await page.locator('#plan-description').textContent(),/agent\/sessions|shared\/\.venv|demo-worktree-b/);
  await page.getByRole('button',{name:'Reset example'}).click();
  await page.locator('input[value="deps"]').uncheck();assert.match(await summary.textContent(),/1 selected · 3.50 GiB/);
  await page.locator('input[value="rust"]').uncheck();assert.equal(await page.locator('#preview-plan').isDisabled(),true);
  await page.locator('input[value="deps"]').check();assert.match(await summary.textContent(),/1 selected · 1.25 GiB/);
  for(const [name,count] of [['Protected',2],['Shared',1],['Rebuildable',2],['All folders',5]]){
    await page.getByRole('button',{name,exact:true}).click();assert.equal(await page.locator('.report-row:visible').count(),count);
  }
  await page.getByRole('button',{name:'Preview a plan',exact:true}).click();await page.getByRole('button',{name:'Reset example'}).click();
  await page.locator('[data-copy="hero-command"]').click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'agentdisk scan -p ~/Projects');
  await page.getByRole('tab',{name:'Download',exact:true}).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#setup-source').getAttribute('aria-selected'),'true');
  assert.match(await page.locator('#setup-command').textContent(),/cargo install --locked --path crates\/agentdisk-cli/);
  await page.getByRole('tab',{name:'Other MCP',exact:true}).click();
  assert.deepEqual(JSON.parse(await page.locator('#setup-command').textContent()).mcpServers.agentdisk,{command:'agentdisk',args:['mcp']});
  await page.locator('#setup-panel [data-copy]').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/"agentdisk"/);
  await page.locator('#faq summary').first().click();assert.notEqual(await page.locator('#faq details').first().getAttribute('open'),null);
  const brokenAnchors=await page.locator('a[href^="#"]').evaluateAll(links=>links.filter(a=>a.hash&&!document.getElementById(a.hash.slice(1))).map(a=>a.hash));assert.deepEqual(brokenAnchors,[]);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('img[loading="lazy"]').evaluateAll(images=>images.forEach(img=>img.loading='eager'));
    await page.waitForFunction(()=>[...document.images].every(img=>img.complete));
    const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,nav:document.querySelector('nav').scrollWidth,navWidth:document.querySelector('nav').clientWidth}));
    assert.ok(dimensions.scroll<=width,'Page overflow '+JSON.stringify(dimensions));
    assert.ok(dimensions.nav<=dimensions.navWidth+1,'Navigation overflow '+JSON.stringify(dimensions));
    assert.deepEqual(await page.locator('img').evaluateAll(images=>images.filter(img=>!img.naturalWidth).map(img=>img.src)),[]);
    if(!process.env.SITE_URL&&(width===1440||width===390)){
      const path='docs/assets/preview-'+(width===1440?'desktop':'mobile')+'.png';
      await page.screenshot({path});assets.push(path);
    }
  }
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('unavailable'))}}));
  await page.locator('[data-copy="hero-command"]').click();
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),'agentdisk scan -p ~/Projects');
  assert.deepEqual(errors,[]);
  await context.close();
  const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  const plain=await noJS.newPage();await plain.goto(base,{waitUntil:'networkidle'});
  assert.equal(await plain.locator('.report-row').count(),5);assert.equal(await plain.locator('.report-actions').isVisible(),false);
  assert.equal(await plain.locator('#setup-command').isVisible(),true);await noJS.close();
  console.log('SITE_CHECK_PASSED '+JSON.stringify({base,viewports:[320,390,768,1440],errors}));
  // Only a trusted same-repository PR supplies this short-lived, contents-scoped token.
  // Store reviewable generated images as Git blobs; this never moves a branch or publishes a site.
  if(process.env.PUBLISH_PREVIEW_ASSETS==='1'){
    assert.ok(process.env.GH_TOKEN&&process.env.GITHUB_REPOSITORY);
    for(const path of assets){
      const bytes=await readFile(path);
      const response=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+'/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({content:bytes.toString('base64'),encoding:'base64'})});
      assert.ok(response.ok,'Asset upload failed: '+response.status);
      const result=await response.json();console.log('ASSET_BLOB '+JSON.stringify({path,sha:result.sha,size:bytes.length}));
    }
  }
} finally {await browser?.close();await new Promise(ok=>server.close(ok));}
