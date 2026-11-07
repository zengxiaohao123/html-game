// tools/smoke-mainmenu.mjs —— 主菜单场景回归断言
//
// 硬约束：进入主地图只有两条合法路径
//   1. 主菜单「新的游戏」
//   2. 主菜单「读取存档」→ 选中有存档的槽位 → 读档成功
// 其余主菜单入口（图鉴 / 存读档页 / 设置 / 关闭面板）都必须留在主菜单，
// 不得挂载主地图（#app 中不允许出现 .map-container 或地块节点）。
//
// 用法：node tools/smoke-mainmenu.mjs
// 浏览器：默认自动查找 Edge/Chrome，可用 BROWSER_EXE 指定。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 8125);
const CDP_PORT = Number(process.env.CDP_PORT || 9333);

function findBrowser() {
  if (process.env.BROWSER_EXE) return process.env.BROWSER_EXE;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('404'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('未找到 Edge/Chrome，可用 BROWSER_EXE 指定浏览器路径');
    process.exit(1);
  }

  const server = await startServer();
  const profile = path.join(os.tmpdir(), 'tt-smoke-menu-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(browser, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        wsUrl = (await res.json()).webSocketDebuggerUrl;
      } catch { await sleep(250); }
    }
    if (!wsUrl) throw new Error('CDP 未就绪');

    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    let msgId = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(`未捕获异常: ${d.text} ${d.exception?.description?.split('\n')[0] || ''} @${d.url}:${d.lineNumber}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        if (!(msg.params.entry.url || '').endsWith('favicon.ico')) errors.push('log.error: ' + msg.params.entry.text);
      }
    };
    const send = (method, params = {}, sessionId) => {
      const id = ++msgId;
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((resolve) => pending.set(id, resolve));
    };
    const sid = (await send('Target.attachToTarget', { targetId: page.id, flatten: true })).result.sessionId;
    await send('Runtime.enable', {}, sid);
    await send('Log.enable', {}, sid);
    await send('Page.enable', {}, sid);

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sid);
      return r.result?.result?.value;
    };
    const loadPage = async () => {
      errors.length = 0;
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sid);
      await sleep(3000);
      await evaluate('localStorage.clear()');
      await send('Page.reload', {}, sid);
      await sleep(5000);
    };
    const state = () => evaluate(`(() => {
      const menuEl = Array.from(document.body.children).find((c) => (c.innerText || '').includes('新的游戏'));
      return {
        menuVisible: !!menuEl && getComputedStyle(menuEl).display !== 'none',
        mapCount: document.querySelectorAll('#app .map-container').length,
        tileCount: document.querySelectorAll('#app [class*="tile"]').length,
        settingsVisible: document.body.innerText.includes('存 档 管 理'),
        codexVisible: document.body.innerText.includes('图鉴（K）'),
        hasGS: !!window.__gameDirector?.getGS?.(),
      };
    })()`);
    const clickText = async (text, times = 1) => {
      for (let i = 0; i < times; i++) {
        const r = await evaluate(`(() => {
          const el = Array.from(document.querySelectorAll('button')).find((n) => (n.innerText || '').includes(${JSON.stringify(text)}));
          if (!el) return 'not-found';
          el.click();
          return 'clicked';
        })()`);
        await sleep(1000);
        if (r === 'not-found') return r;
      }
      return 'clicked';
    };
    const pressEscape = async () => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      await sleep(800);
    };

    const failures = [];
    const check = (name, cond, detail) => {
      if (cond) console.log(`PASS  ${name}`);
      else { console.log(`FAIL  ${name}  ${JSON.stringify(detail)}`); failures.push(name); }
    };

    // 用例 1：启动后停留在主菜单，未挂载地图
    await loadPage();
    const s0 = await state();
    check('启动: 主菜单可见', s0.menuVisible, s0);
    check('启动: #app 无地图容器/地块', s0.mapCount === 0 && s0.tileCount === 0, s0);
    check('启动: 未调用 startNewGame(无 GS)', !s0.hasGS, s0);

    // 用例 2：读取存档 → 仅在主菜单打开存读档页
    await loadPage();
    await clickText('读取存档');
    const s1 = await state();
    check('读取存档: 存读档页可见', s1.settingsVisible, s1);
    check('读取存档: 仍留在主菜单', s1.menuVisible, s1);
    check('读取存档: #app 无地图', s1.mapCount === 0 && s1.tileCount === 0, s1);

    // 用例 3：图鉴 → 面板叠在主菜单上，不进地图
    await loadPage();
    await clickText('图鉴');
    const s2 = await state();
    check('图鉴: 面板可见', s2.codexVisible, s2);
    check('图鉴: 仍留在主菜单', s2.menuVisible, s2);
    check('图鉴: #app 无地图', s2.mapCount === 0 && s2.tileCount === 0, s2);

    // 用例 4：新的游戏 → 唯一合法的直接进图路径
    await loadPage();
    await clickText('新的游戏');
    const s3 = await state();
    check('新的游戏: 进入主地图', s3.mapCount === 1 && s3.tileCount > 0, s3);
    check('新的游戏: 主菜单隐藏', !s3.menuVisible, s3);

    // 用例 5：读取存档成功 → 才允许进图
    await loadPage();
    await clickText('新的游戏');
    await pressEscape();
    await clickText('返回主菜单');
    await clickText('读取存档');
    await evaluate(`(() => {
      const el = Array.from(document.querySelectorAll('div')).find((n) => {
        const t = (n.innerText || '').replace(/\\s+/g, ' ').trim();
        return t.startsWith('Slot 1') && t.includes('已用') && t.length < 60;
      });
      if (el) el.click();
    })()`);
    await sleep(1000);
    await clickText('读取此存档', 2);
    await sleep(2000);
    const s4 = await state();
    check('读档成功: 进入主地图', s4.mapCount === 1 && s4.tileCount > 0, s4);
    check('读档成功: 主菜单隐藏', !s4.menuVisible, s4);
    check('全程无未捕获异常 / console error', errors.length === 0, errors);

    ws.close();
    console.log(failures.length ? `\n${failures.length} 项断言失败` : '\n全部断言通过');
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    proc.kill();
    server.close();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
