import { chromium } from '../node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const dir=new URL('./',import.meta.url).pathname;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000},ignoreHTTPSErrors:true});
page.setDefaultTimeout(5000);
const log=[]; const record=(name,data)=>{log.push({name,data});fs.writeFileSync(dir+'challenge-observations.json',JSON.stringify(log,null,2));console.log(name,JSON.stringify(data).slice(0,18000));};
page.on('pageerror',e=>record('pageerror',e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')record('console-'+m.type(),m.text());});
await page.addInitScript(()=>{window.auditTools={};Object.defineProperty(document,'modelContext',{value:{registerTool(tool){window.auditTools[tool.name]=tool;}}});});
await page.goto('http://fracht.lennartobst.de:8080');await page.locator('[data-component="tank"]').waitFor();
const shot=async name=>page.screenshot({path:dir+name+'.png',fullPage:true});
const read=()=>page.evaluate(()=>window.auditTools.read_lab_measurements.execute({}));
const adv=seconds=>page.evaluate(seconds=>window.auditTools.advance_lab_simulation.execute({seconds}),seconds);
const wire=async(a,b)=>{await page.locator(`[data-port="${a}"]`).click();await page.locator(`[data-port="${b}"]`).click();};
let placement=0; const add=async name=>{const i=placement++;await page.locator('.library-component').filter({hasText:name}).first().dragTo(page.locator('.construction-canvas'),{targetPosition:{x:140+(i%3)*285,y:130+Math.floor(i/3)*210}});};
const select=kind=>page.locator(`[data-component="${kind}"]`).first().click();
const field=async(label,value)=>{await page.getByLabel(label,{exact:true}).fill(String(value));await page.getByLabel(label,{exact:true}).press('Enter');};
const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const d=await pending;await d.saveAs(dir+name+'.physics.json');return JSON.parse(fs.readFileSync(dir+name+'.physics.json','utf8'));};
const test=async(name,fn)=>{try{await fn();}catch(e){record(name+'-BLOCKED',e.message);await shot(name+'-blocked').catch(()=>{});}};
const fresh=async()=>{await page.goto('http://fracht.lennartobst.de:8080');await page.locator('[data-component="tank"]').waitFor();};
const fault=async(kind,type)=>{await select(kind);if(!await page.getByLabel('Inject component fault').isVisible())await page.locator('summary').filter({hasText:'EXPERIMENT FAULTS'}).click();await page.getByLabel('Inject component fault').selectOption(type);};
const startChallenge=async i=>{await page.keyboard.press('Escape');await page.getByRole('button',{name:/Challenges/}).click();await page.getByRole('button',{name:'Start assignment',exact:true}).nth(i).click();};
import { starter } from '/tmp/physics-audit-projects.mjs';
for(const [mode,index,seconds] of [['transfer',3,180],['pressure',4,195],['supply',5,600],['descent',6,60],['lift',7,60],['rotation',8,70]]) await test('challenge-'+mode,async()=>{
await fresh();await startChallenge(index);await save('challenge-'+mode+'-initial');if(mode==='descent'){await page.getByRole('button',{name:'Schematic view',exact:true}).click();await select('forceActuator');await field('Brake damping',200);}else{if(index>=7)await page.getByRole('button',{name:'Schematic view',exact:true}).click();const p=starter(mode);const byid=Object.fromEntries(p.components.map(c=>[c.id,c.name]));for(const w of p.connections)await wire(byid[w.from.component]+':'+w.from.port,byid[w.to.component]+':'+w.to.port);}
await save('challenge-'+mode+'-wired');await adv(seconds);if(mode==='supply')await adv(120);record('C-'+mode,{strip:await page.locator('.challenge-strip').innerText(),state:await read()});await shot('C-'+mode);await save('challenge-'+mode+'-end');
if(mode==='transfer'){await page.getByRole('button',{name:'Reset simulation',exact:true}).click();record('C-transfer-reset',await page.locator('.challenge-strip').innerText());await page.getByRole('button',{name:'Undo',exact:true}).click();record('C-transfer-undo',await page.locator('.challenge-strip').innerText());}
});
await test('mechanics-build',async()=>{await fresh();await page.getByRole('button',{name:'New empty experiment',exact:true}).click();await page.getByRole('button',{name:'Physical view',exact:true}).click();await page.getByRole('button',{name:'Rectangle',exact:true}).click();await field('World Y',10);await save('freefall-initial');record('M-freefall-start',await read());await adv(1);record('M-freefall-1',await read());await shot('15-freefall');await page.getByRole('button',{name:'Schematic view',exact:true}).click();record('M-view-switch',await read());});
await test('mechanism-starter',async()=>{await fresh();await page.getByRole('button',{name:'Open mechanical construction starter',exact:true}).click();await save('mechanism-initial');await adv(10);record('M-mechanism-10',await read());await shot('16-mechanism');});
await browser.close();
