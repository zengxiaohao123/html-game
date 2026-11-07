// tools/smoke-creature-visual.mjs —— 生物可见性冒烟
// 覆盖：
//   1) 新开局真实生成 3 只随机史莱姆（占容量；读档不注入由注入位置保证）
//   2) 纯色圆形节点：直径 = radius*2*每格像素、颜色按物种、无 emoji/贴图
//   3) 节点位置随 renderPos 变化；重叠时节点数不减少
// 用法：node tools/smoke-creature-visual.mjs

// ── 最小 DOM 桩（必须在 import src 模块前装好） ──
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = Object.create(null);
    this._text = '';
    this.className = '';
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(v) { if (String(v) === '') this.children = []; this._text = ''; }
}
globalThis.document = {
  createElement: (t) => new FakeEl(t),
  body: new FakeEl('body'),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
};
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { CreatureView, creatureColor, CREATURE_COLORS, creatureCircleStyle } from '../src/ui/CreatureView.js';
import { GameDirector, INITIAL_SLIME_COUNT } from '../src/systems/GameDirector.js';
import { getRealtimeClock } from '../src/systems/RealtimeClock.js';
import { SLIME_KINDS, CREATURES } from '../src/data/creatures.js';
import { EventBus } from '../src/core/EventBus.js';
import { GE } from '../src/core/GameEvents.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ════════════════════════════════════════════════════════════
head('1. 新开局：真实生成 3 只随机史莱姆（不是装饰）');
{
  const capEvents = [];
  const onCap = (p) => capEvents.push(p);
  EventBus.on(GE.CAPACITY_CHANGE, onCap);

  const director = new GameDirector();
  director.start();
  getRealtimeClock().stop(); // 断言期间冻结时钟，避免生物在检查间隙移动
  EventBus.off(GE.CAPACITY_CHANGE, onCap);
  const gs = director.getGS();

  check(INITIAL_SLIME_COUNT === 3, '新开局注入数量常量 = 3', INITIAL_SLIME_COUNT);
  check(gs.creatures.length === 3, '新开局栅栏内生物数 = 3', gs.creatures.length);
  check(gs.creatures.every(c => SLIME_KINDS.includes(c.kind)), '3 只全部是史莱姆变体',
    gs.creatures.map(c => c.kind));
  check(new Set(gs.creatures.map(c => c.kind)).size === 3, '3 只种类互不相同（3 个不同颜色圆）',
    gs.creatures.map(c => c.kind));
  check(gs.creatures.every(c => c.category === 'danger'), '种类分类均为 danger（危险生物）');
  check(new Set(gs.creatures.map(c => c.id)).size === 3, '生物 id 唯一（真实实例）');

  const dangerCapEvents = capEvents.filter(e => e.category === 'danger');
  check(dangerCapEvents.length >= 1 && dangerCapEvents[dangerCapEvents.length - 1].newCount === 3,
    '容量统计事件包含这 3 只（danger newCount = 3）', dangerCapEvents.at(-1));

  // 容量规则核对：1×1 栅栏基础危险上限 4，3 < 4，无冲突（不为凑数改容量）
  const fenceTiles = gs.map.fence.length;
  const dangerCap = 4 + Math.max(0, fenceTiles - 1);
  check(fenceTiles === 1 && 3 <= dangerCap, `3 只 < 危险容量 4（fence=${fenceTiles}）`, { dangerCap });

  // 每个实例都带连续移动字段（能在网页上动）
  check(gs.creatures.every(c => Number.isFinite(c.pos?.x) && Number.isFinite(c.renderPos?.x) &&
    Number.isFinite(c.dir) && c.speedPerTile >= 3 && c.speedPerTile <= 6),
    '3 只均有 pos/renderPos/dir/speedPerTile(3~6 秒/格)');
}

// ════════════════════════════════════════════════════════════
head('2. 纯色圆形节点：直径 = radius*2*每格像素、颜色区分、无 emoji');
{
  const layer = new FakeEl('div');
  const view = new CreatureView(layer);
  const TS = 80;
  const kinds = ['slime_fire', 'slime_water', 'slime_grass'];
  const gs = {
    creatures: kinds.map((kind, i) => ({
      id: 'c' + i, kind, hp: 40, category: 'danger',
      radius: CREATURES[kind].radius,
      pos: { x: 1.5 + i * 0.2, y: 1.5 },
      renderPos: { x: 1.5 + i * 0.2, y: 1.5 },
    })),
  };
  view.paint(gs, TS);

  check(view.els.size === 3, '3 个生物 → 3 个节点', view.els.size);
  for (const c of gs.creatures) {
    const el = view.els.get(c.id);
    const expectedD = c.radius * 2 * TS; // 0.25*2*80 = 40px
    check(el && el.style.borderRadius === '50%', `${c.kind}: 纯圆（borderRadius=50%）`);
    check(near(parseFloat(el.style.width), expectedD, 1e-9) &&
          near(parseFloat(el.style.height), expectedD, 1e-9),
      `${c.kind}: 直径 ${el.style.width} = radius*2*tileSize(${expectedD}px)`, el.style.width);
    check(el.style.background === CREATURE_COLORS[c.kind],
      `${c.kind}: 颜色 = 物种色 ${CREATURE_COLORS[c.kind]}`, el.style.background);
    check(el.children.length === 0 && el.textContent === '',
      `${c.kind}: 无 emoji/贴图/内联文本（纯色圆）`);
    const vis = creatureCircleStyle(c, TS);
    check(el.style.transform === `translate(${vis.x}px, ${vis.y}px) translate(-50%, -50%)`,
      `${c.kind}: 位置 = renderPos × 每格像素`, el.style.transform);
  }
  check(creatureColor('chick') !== creatureColor('chicken') &&
        creatureColor('chicken') !== creatureColor('slime_fire'),
    '小鸡 / 成鸡 / 史莱姆各不同色');
  check(new Set(gs.creatures.map(c => CREATURE_COLORS[c.kind])).size === 3,
    '3 种史莱姆变体颜色互不相同');
}

// ════════════════════════════════════════════════════════════
head('3. 逐帧跟随 renderPos + 重叠不吞并');
{
  const layer = new FakeEl('div');
  const view = new CreatureView(layer);
  const TS = 80;
  const gs = {
    creatures: [
      { id: 'a', kind: 'slime_fire', hp: 40, radius: 0.25, pos: { x: 1.5, y: 1.5 }, renderPos: { x: 1.5, y: 1.5 } },
      { id: 'b', kind: 'slime_water', hp: 40, radius: 0.25, pos: { x: 1.5, y: 1.5 }, renderPos: { x: 1.5, y: 1.5 } }, // 完全重叠
    ],
  };
  view.paint(gs, TS);
  check(view.els.size === 2, '完全重叠的两只 → 仍有 2 个独立节点（不吞并）', view.els.size);

  const before = view.els.get('a').style.transform;
  gs.creatures[0].renderPos.x += 0.4; // 0.4 格
  gs.creatures[1].renderPos.y += 0.2;
  view.paint(gs, TS);
  const after = view.els.get('a').style.transform;
  check(before !== after, 'renderPos 变化后 transform 随之变化（节点不重建）', { before, after });
  check(after.includes(`translate(${1.9 * TS}px`), `新坐标 = 1.9 格 × ${TS}px`, after);
  check(view.els.get('b').style.transform.includes(`translate(${1.5 * TS}px, ${1.7 * TS}px`),
    '第二只按自己的 renderPos 独立移动', view.els.get('b').style.transform);
  check(view.els.size === 2, '移动/重叠后节点数不变', view.els.size);

  // 死亡节点清理（不残留装饰）
  gs.creatures[1].hp = 0;
  view.paint(gs, TS);
  check(view.els.size === 1, 'hp=0 的生物节点被清理', view.els.size);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
