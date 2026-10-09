import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:5173/');await page.waitForTimeout(1500);
await page.screenshot({path:'/tmp/physics-lab-desktop.png',fullPage:true});
console.log(JSON.stringify({title:await page.title(),errors,bodyWidth:await page.evaluate(()=>document.body.scrollWidth),viewport:1440}));
await browser.close();
