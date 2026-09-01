// Headless smoke/visual test: drives the game in headless Chrome over the DevTools protocol
// (no puppeteer needed — Node 22 built-in WebSocket + fetch). Requires the local server:
//   python3 -m http.server 8130 --bind 127.0.0.1     (in the project dir)
//   node test/cdp-harness.mjs /tmp/ac130-test        (screenshots + JSON state land there)
// Uses ?dbg=…&auto=1 which exposes window.__G / __spawn / __SPR for inspection.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2] || '/tmp/ac130-test', PORT = 9334; import('node:fs').then(m => m.mkdirSync(OUT, { recursive: true }));
const url = process.env.AC130_URL || `http://localhost:8130/index.html?lat=34.0505&lon=-118.2488&auto=1&dbg=999&name=DEMO`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',`--user-data-dir=${OUT}/profcdp2`,'--window-size=1600,900',`--remote-debugging-port=${PORT}`,'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(300); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + m.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails); };
const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseMoved' ? 0 : 1, clickCount: 1 });
const key = k => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k });
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url });
const t0 = Date.now();
while (await ev('window.__G && __G.mode') !== 'playing') { await sleep(500); if (Date.now() - t0 > 120000) { console.log('timeout'); process.exit(1); } }
console.log('playing after', ((Date.now() - t0) / 1000).toFixed(1), 's');
await mouse('mouseMoved', 800, 450);
console.log('fps', await ev(`new Promise(r => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r((n / 3).toFixed(0)); }; requestAnimationFrame(f); })`));
// park wave enemies far away, spawn a showcase of vehicles near the base
await ev(`(() => { const G = __G; G.enemies.forEach(e => { e.alive = false; }); G.spawnQueue = [];
  const D = 230; [['tank', 0], ['apc', 1.3], ['truck', 2.6], ['tech', 3.9], ['inf', 5.0], ['inf', 5.2]].forEach(([t, a]) => { __spawn(t, a); const e = G.enemies[G.enemies.length - 1]; e.x = G.base.x + Math.cos(a) * D; e.y = G.base.y + Math.sin(a) * D; e.heading = a + Math.PI; }); })()`);
await ev(`(() => { const S = __SPR; const c = document.createElement('canvas'); c.id = 'ss'; c.width = 1400; c.height = 360; c.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#555'; const x = c.getContext('2d'); let px = 20;
  for (const k of ['tech','truck','apc','tank']) { const sp = S.VEH[k]; x.drawImage(sp.cv, px, 20, sp.w * 6, sp.h * 6); px += sp.w * 6 + 20; }
  S.INF_FR.forEach((f, i) => x.drawImage(f.cv, 20 + i * 200, 250, f.w * 8, f.h * 8)); document.body.appendChild(c); })()`);
await shot('v_sprites', { x: 0, y: 0, width: 1400, height: 360 }); await ev(`document.getElementById('ss').remove()`);
await sleep(2500); await key('z'); await sleep(1500);
const P = JSON.parse(await ev(`(() => { const G = __G, c = G.cam, cs = Math.cos(c.angle), sn = Math.sin(c.angle); const o = {}; for (const e of G.enemies) if (e.alive && e.type !== 'inf') { const dx = e.x - c.x, dy = e.y - c.y; o[e.type] = { x: innerWidth/2 + c.s*(cs*dx - sn*dy), y: innerHeight/2 + c.s*(sn*dx + cs*dy) }; } return JSON.stringify(o); })()`));
console.log('screen pos', P);
for (const k of ['tank','apc','truck','tech']) if (P[k]) await shot('v_' + k, { x: Math.max(0, P[k].x - 120), y: Math.max(0, P[k].y - 90), width: 240, height: 180 });
await shot('v_zoom');
console.log('mid:', await ev(`JSON.stringify({ alive: __G.enemies.filter(e => e.alive).map(e => e.type + ':' + Math.round(Math.hypot(e.x - __G.base.x, e.y - __G.base.y))), hp: __G.base.hp.toFixed(1) })`));
await key('z'); await sleep(600);
// aim at the tank and fire the 105; capture the round in flight
const A = JSON.parse(await ev(`(() => { const G = __G; const e = G.enemies.find(e => e.alive && e.type === 'tank'); const dx = e.x - G.base.x, dy = e.y - G.base.y, cs = Math.cos(G.cam.angle), sn = Math.sin(G.cam.angle); const ax = cs*dx - sn*dy, ay = sn*dx + cs*dy; return JSON.stringify({ mx: innerWidth/2 + ax / G.rMax * innerHeight/2, my: innerHeight/2 + ay / G.rMax * innerHeight/2 }); })()`));
await mouse('mouseMoved', A.mx, A.my); await sleep(600); await key('2'); await mouse('mousePressed', A.mx, A.my); await sleep(50); await mouse('mouseReleased', A.mx, A.my);
await sleep(400); await shot('v_flight1', { x: 0, y: 0, width: 900, height: 500 }); await sleep(500); await shot('v_flight2', { x: 300, y: 100, width: 800, height: 500 }); await sleep(900); await shot('v_boom'); await sleep(3000); await shot('v_after');
console.log('after:', await ev(`JSON.stringify({ alive: __G.enemies.filter(e => e.alive).map(e => e.type + ':' + e.hp.toFixed(1)), kills: __G.kills, marks: __G.marks.map(m => m.kind) })`));
console.log('logs:', logs.slice(0, 6));
ws.close(); chrome.kill(); process.exit(0);
