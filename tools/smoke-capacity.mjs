// tools/smoke-capacity.mjs —— 容量 UI 刷新冒烟（扩建 / 读档首帧）
//
// 覆盖：
//   1) 新开局容量条首次渲染即为 4
//   2) 扩建后不做任何额外操作，TopBar 容量文本在同一次同步调用里变为新上限
//   3) 读档进入扩建后的存档，TopBar 首次渲染即为存档中的新上限
// 用法：node tools/smoke-capacity.mjs

// ════════════════════════════════════════════════════════════
// 0. 最小 DOM 桩（必须在 import 任何 src 模块之前装好）
// ════════════════════════════════════════════════════════════
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = { setProperty: () => {} };
    this.attributes = Object.create(null);
    this._text = '';
    this._classes = new Set();
    this.id = '';
    this.title = '';
    this.value = '';
    this.disabled = false;
    this._listeners = Object.create(null);
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._classes;
    return {
      add: (...cs) => cs.forEach((c) => s.add(c)),
      remove: (...cs) => cs.forEach((c) => s.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !s.has(c) : !!force;
        if (on) s.add(c); else s.delete(c);
        return on;
      },
      contains: (c) => s.has(c),
    };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(t, fn) { (this._listeners[t] || (this._listeners[t] = [])).push(fn); }
  removeEventListener(t, fn) {
    const arr = this._listeners[t];
    if (arr) this._listeners[t] = arr.filter((x) => x !== fn);
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(v) { if (String(v) === '') this.children = []; this._text = ''; }
}

globalThis.document = {
  createElement: (t) => new FakeEl(t),
  body: new FakeEl('body'),
  documentElement: new FakeEl('html'),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { GameDirector } from '../src/systems/GameDirector.js';
import { getRealtimeClock } from '../src/systems/RealtimeClock.js';
import { TopBar } from '../src/ui/TopBar.js';
import { MapExpandSystem, EXPAND_AXIS } from '../src/systems/MapExpandSystem.js';
import { Storage } from '../src/state/storage.js';
import { DayBaseline } from '../src/state/DayBaseline.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

/** 顶部容量条文本：友善 / 危险 / 高危 */
const capText = (bar) => ({
  friendly: bar.friendlyText?.textContent,
  danger: bar.dangerText?.textContent,
  extreme: bar.extremeText?.textContent,
});

head('1. 扩建：不做额外操作，容量 UI 同帧更新');
{
  const director = new GameDirector();
  director.start();
  getRealtimeClock().stop();
  const gs = director.getGS();

  const bar = new TopBar();
  const host = new FakeEl('div');
  bar.mount(gs, host);

  check(capText(bar).friendly === '0/4', '新开局首次渲染：友善 0/4', capText(bar));
  check(capText(bar).danger === '3/4', '新开局首次渲染：危险 3/4', capText(bar));

  // 只调用扩建，不触发移动/日结算/其它任何操作
  MapExpandSystem.expandMap(gs, EXPAND_AXIS.LENGTH); // 3×3 → 3×4，栅栏 +1

  check(gs.capacity.friendly === 5 && gs.capacity.danger === 5, '扩建后容量上限立刻为 5', gs.capacity);
  check(capText(bar).friendly === '0/5', '扩建后容量 UI 同帧刷新为 0/5', capText(bar));
  check(capText(bar).danger === '3/5', '扩建后危险容量 UI 同帧刷新为 3/5', capText(bar));

  MapExpandSystem.expandMap(gs, EXPAND_AXIS.WIDTH); // → 4×4，栅栏 2×2（4 格）→ 上限 7
  check(gs.capacity.friendly === 7, '再次扩建（II 型）上限累加到 7', gs.capacity);
  check(capText(bar).friendly === '0/7', '连续扩建同样立即刷新', capText(bar));
}

head('2. 读档：扩建后的存档首帧即为新上限');
{
  const d1 = new GameDirector();
  d1.start();
  getRealtimeClock().stop();
  const gs0 = d1.getGS();
  MapExpandSystem.expandMap(gs0, EXPAND_AXIS.LENGTH);
  MapExpandSystem.expandMap(gs0, EXPAND_AXIS.LENGTH); // 栅栏 1×3 → 上限 6
  check(gs0.capacity.friendly === 6, '存档前容量上限为 6', gs0.capacity.friendly);

  const slot = 6;
  check(Storage.save(slot, DayBaseline.capture(gs0)), '写入扩建后的存档');
  const payload = Storage.load(slot);

  const d2 = new GameDirector();
  d2.loadGame(payload);
  getRealtimeClock().stop();
  const gs2 = d2.getGS();
  const bar2 = new TopBar();
  bar2.mount(gs2, new FakeEl('div'));

  check(gs2.map.fence.length === 3, '读档后栅栏为 1×3', gs2.map.fence.length);
  check(gs2.capacity.friendly === 6, '读档后容量上限为 6', gs2.capacity.friendly);
  check(capText(bar2).friendly === '0/6', '读档首帧容量 UI 即为 0/6', capText(bar2));
  Storage.clearSlot(slot);
}

console.log(`\n════ 容量 UI 冒烟：${pass} 通过 / ${fail} 失败 ════`);
process.exit(fail === 0 ? 0 : 1);
