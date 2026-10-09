import {test,expect,type Page} from '@playwright/test';
const port=(p:Page,name:string)=>p.locator(`[data-port="${name}"]`);
async function wire(p:Page,a:string,b:string){await port(p,a).click();await port(p,b).click();}
async function startChallenge(p:Page,index:number){await p.getByRole('button',{name:/Challenges/}).click();await p.getByRole('button',{name:'Start assignment'}).nth(index).click();}
async function wireCircuit(p:Page,load:string){await wire(p,'PS-01:a','S-01:a');await wire(p,'S-01:b',`${load}:a`);await wire(p,`${load}:b`,'PS-01:b');}
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('[data-component="tank"]')).toBeVisible();});
test('heats, pauses, resets and preserves energy',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'Run',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.waitForTimeout(700);await page.getByRole('button',{name:'Pause',exact:true}).click();
 const time=await page.locator('.simulation-clock strong').textContent();await page.waitForTimeout(150);expect(await page.locator('.simulation-clock strong').textContent()).toBe(time);
 await page.getByRole('button',{name:'Advance 60 s'}).click();await expect(page.locator('.primary-reading')).not.toContainText('20.00');
 await page.getByRole('button',{name:'Energy balance'}).click();await expect(page.locator('.energy-error')).toContainText('Conservation residual');
 await page.getByRole('button',{name:'Reset simulation'}).click();await expect(page.locator('.primary-reading')).toContainText('20.00');await expect(page.locator('.simulation-clock strong')).toHaveText('00:00:00.00');expect(errors).toEqual([]);
});
test('builds a functioning light circuit and completes challenge 001',async({page})=>{
 await startChallenge(page,0);await expect(page.locator('.status-footer')).toContainText('0 connections');await wireCircuit(page,'L-01');
 await page.getByRole('button',{name:'Run',exact:true}).click();await expect(page.locator('.challenge-strip')).toContainText('3 stars',{timeout:15000});await expect(page.locator('[data-component="lamp"]')).toContainText('ILLUMINATED');
 await page.locator('[data-component="switch"]').dblclick();await expect(page.locator('[data-component="lamp"]')).toContainText('UNPOWERED');
});
test('builds and completes heating challenge 002 using real fixed steps',async({page})=>{
 await startChallenge(page,1);await wireCircuit(page,'H-01');await wire(page,'H-01:heat','TK-01:heat');
 for(let i=0;i<25;i++){await page.getByRole('button',{name:'Advance 60 s'}).click();if((await page.locator('.challenge-strip').textContent())?.includes('stars'))break;}
 await expect(page.locator('.challenge-strip')).toContainText('3 stars');await expect(page.locator('[data-component="tank"] .tank-number')).toContainText('80.00');
});
test('validates connections and supports editing, undo, zoom and drag placement',async({page})=>{
 await wire(page,'PS-01:a','TK-01:heat');await expect(page.getByRole('status')).toContainText('Electrical and thermal terminals cannot');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/Resistor/}).first().dragTo(page.locator('.construction-canvas'),{targetPosition:{x:220,y:230}});await expect(page.locator('[data-component="resistor"]')).toHaveCount(1);
 await page.getByRole('button',{name:'Duplicate selected'}).click();await expect(page.locator('[data-component="resistor"]')).toHaveCount(2);await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-component="resistor"]')).toHaveCount(1);
 await page.locator('[data-component="resistor"]').click();await page.getByRole('button',{name:'Rotate selected'}).click();await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(page.locator('.zoom-controls')).not.toContainText('95%');
 await page.getByRole('button',{name:'Delete selected'}).click();await expect(page.locator('[data-component="resistor"]')).toHaveCount(0);
});
test('saves, imports, rejects invalid files, and exports measured CSV',async({page})=>{
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const saved=await download;expect(saved.suggestedFilename()).toMatch(/physics.json$/);const path=await saved.path();expect(path).toBeTruthy();
 await page.getByRole('button',{name:'New empty experiment'}).click();await expect(page.locator('.empty-canvas')).toBeVisible();await page.locator('input[type=file]').setInputFiles(path!);await expect(page.locator('[data-component="tank"]')).toBeVisible();await expect(page.locator('.status-footer')).toContainText('4 connections');
 await page.locator('input[type=file]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":99}')});await expect(page.getByRole('status')).toContainText('Unsupported project version');
 await page.getByRole('button',{name:'Advance 60 s'}).click();const csvPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();expect((await csvPromise).suggestedFilename()).toContain('measurements.csv');
});
test('replays recorded user input and recovers identical thermal state',async({page})=>{
 await page.getByRole('button',{name:'Advance 60 s'}).click();await page.locator('[data-component="switch"]').dblclick();await page.getByRole('button',{name:'Advance 60 s'}).click();const before=await page.locator('[data-component="tank"] .tank-number').textContent();
 await page.getByRole('button',{name:/Event log/}).click();await page.getByRole('button',{name:'Replay experiment'}).click();expect(await page.locator('[data-component="tank"] .tank-number').textContent()).toBe(before);await expect(page.locator('.event-log')).toContainText('Deterministic replay completed');
});
test('registers browser tools against the interface contract and validates inputs',async({page})=>{
 await page.addInitScript(()=>{const registry:Record<string,unknown>={};Object.assign(window,{labTools:registry});Object.defineProperty(document,'modelContext',{value:{registerTool:(tool:{name:string},opts:{signal:AbortSignal})=>{registry[tool.name]=tool;opts.signal.addEventListener('abort',()=>delete registry[tool.name]);}}});});
 await page.reload();await page.waitForFunction(()=>Object.keys((window as unknown as {labTools:object}).labTools??{}).length===3);
 const result=await page.evaluate(async()=>{const tools=(window as unknown as {labTools:Record<string,{execute:(input:unknown)=>Record<string,unknown>;inputSchema:object}>}).labTools;const before=tools.read_lab_measurements.execute({});tools.advance_lab_simulation.execute({seconds:1});const after=tools.read_lab_measurements.execute({});let invalid=false;try{tools.advance_lab_simulation.execute({seconds:-1});}catch{invalid=true;}return {before:before.time,after:after.time,invalid,count:Object.keys(tools).length};});
 expect(result.count).toBe(3);expect(result.before).toBe(0);expect(result.after).toBeCloseTo(1,6);expect(result.invalid).toBe(true);await expect(page.locator('.simulation-clock strong')).toHaveText('00:00:01.00');
});
test('mobile workspace remains usable without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.construction-canvas')).toBeVisible();expect(await page.evaluate(()=>document.body.scrollWidth)).toBe(390);
 await page.getByRole('button',{name:'Toggle component library'}).click();await expect(page.getByRole('heading',{name:'Component library'})).toBeVisible();await page.getByRole('button',{name:'Toggle component library'}).click();await page.getByRole('button',{name:'Run',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/physics-lab-mobile.png'});
});
