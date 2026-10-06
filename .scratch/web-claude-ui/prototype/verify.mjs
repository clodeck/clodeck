/* PROTOTYPE verifier — drives the prototype in headless Chrome over CDP,
   pokes it like a user, screenshots each step, and reports console errors.

   Usage:  node verify.mjs            (from this folder)
           CHROME_PATH=/path/to/chrome node verify.mjs

   Screenshots land in <os tmpdir>/proto-shots/. Requires Node 22+ (global
   WebSocket) — no dependencies. Throwaway tooling, same as the prototype. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(HERE, 'index.html')).href;
const OUT = join(tmpdir(), 'proto-shots');
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome/Edge found. Set CHROME_PATH to your browser binary.');
  process.exit(1);
}
console.log('browser:', CHROME);
console.log('output: ', OUT);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1600,1000', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + join(OUT, 'prof'), 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('no devtools target');
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value)));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + m.params.exceptionDetails.exception?.description);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(expr + ' → ' + JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: PAGE + '?variant=A' });
await sleep(1500);

const step = async (label, expr, name, wait = 400) => {
  const v = await evaluate(expr);
  await sleep(wait);
  if (name) await shot(name);
  console.log(`ok  ${label}${v === undefined ? '' : ' -> ' + JSON.stringify(v)}`);
};

/* A — chat-first: drawer, terminal, streaming chat */
await step('A: open the Files drawer', `document.querySelector('.rail button[title="Files drawer"]').click(); 'ok'`);
await step('A: click src/ChatPane.tsx in the tree',
  `[...document.querySelectorAll('.tree-row')].find(r => r.textContent.trim() === 'ChatPane.tsx').click();
   document.querySelectorAll('.code tbody tr').length`, 'A-files');
await step('A: switch drawer to Terminal', `document.querySelector('.rail button[title="Terminal drawer"]').click(); 'ok'`);
await step('A: run `npm test` in the fake shell',
  `const s1 = document.querySelector('.term-input'); s1.value = 'npm test';
   s1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
   'sent'`, 'A-term');
await step('A: send a chat message and let it stream',
  `const s2 = document.querySelector('.composer-box textarea');
   s2.value = 'does it still flicker now?';
   s2.dispatchEvent(new Event('input', { bubbles: true }));
   document.querySelector('.send').click(); 'sent'`, 'A-chat', 4500);
const turns = await evaluate(`document.querySelectorAll('.transcript .turn').length`);
const tools = await evaluate(`document.querySelectorAll('.transcript .tool').length`);
console.log(`    transcript turns: ${turns}, tool cards: ${tools}`);
if (turns < 5 || tools < 2) throw new Error('chat stream did not complete');
await step('A: close drawer', `document.querySelector('.rail button[title="Chat"]').click(); 'ok'`);

/* B — three-pane: variant switch + file open */
await step('B: switch variant', `location.hash = 'variant=B'; 'ok'`, 'B-initial', 900);
await step('B: click a file in the explorer',
  `[...document.querySelectorAll('.tree-row')].find(r => r.textContent.trim() === 'transcript.ts').click();
   document.querySelector('.code .src')?.textContent.trim()`, 'B-file');

/* C — command deck: project switch moves sessions + terminal */
await step('C: switch variant', `location.hash = 'variant=C'; 'ok'`, 'C-initial', 900);
await step('C: switch to the acme-api project',
  `[...document.querySelectorAll('button')].find(b => b.textContent.includes('acme-api') && b.textContent.includes('sessions')).click();
   'ok'`, 'C-project', 900);
const state = await evaluate(`document.querySelector('.pw .st').textContent`);
console.log('    switcher state:', state);
if (!state.includes('acme-api')) throw new Error('project switch did not reach the switcher');
await step("C: run `git status` in that project's shell",
  `const s3 = document.querySelector('.term-input'); s3.value = 'git status';
   s3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
   'sent'`, 'C-term', 500);

/* the floating bar must never cover the app */
const layout = await evaluate(`(() => {
  const bar = document.querySelector('.pw').getBoundingClientRect();
  return { appBottom: document.getElementById('app').getBoundingClientRect().bottom, barTop: Math.round(bar.top) };
})()`);
console.log('    bar does not overlap the app:', layout.appBottom <= layout.barTop, JSON.stringify(layout));

console.log(logs.length ? '\nERRORS:\n' + logs.join('\n') : '\nno console errors');
ws.close();
chrome.kill();
process.exit(logs.length ? 1 : 0);
