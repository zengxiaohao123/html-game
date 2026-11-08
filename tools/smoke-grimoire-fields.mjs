// tools/smoke-grimoire-fields.mjs —— 魔导书「稻草 / 小麦 / 水稻」7 本效果冒烟
//
// 覆盖：
//   1) 稻香远：onTurnStart 回复 2 × 稻草田块数，且不突破生命上限（验证在 advanceTurn 内 fire）
//   2) 庆丰收：只有处于「≥3 相连」簇内的水稻田块产出 ×2（逐格判定，不是全局开关）
//   3) 春光好：草元素伤害倍率 1 + 2% × 水稻田块数，且不作用于物理/真实伤害
//   4) 食为先：生命跌破 50% 时回复 floor(3% × 小麦田块数 × maxHp)，每天 1 次
//   5) 穗粒满：onDailyEnd 每块小麦田块 +1 小麦
//   6) 黄金浪：≥3 相连簇内的小麦田块【经过时】+1 小麦；孤立麦田不触发
//   7) 仓廪实：稻草 / 小麦田块双向视同 —— 数量统计、连片判定、产出结算三处一致
// 用法：node tools/smoke-grimoire-fields.mjs

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
import { HookDispatcher } from '../src/core/HookDispatcher.js';
import { EventBus } from '../src/core/EventBus.js';
import { GE } from '../src/core/GameEvents.js';
import * as InventorySystem from '../src/systems/InventorySystem.js';
import { initPassiveItems } from '../src/systems/PassiveItemSystem.js';
import { advanceTurn } from '../src/systems/TurnSystem.js';
import { FieldEffects } from '../src/systems/FieldEffects.js';
import { calculateDamage, applyElementalDamageToCreature } from '../src/systems/CombatSystem.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

const director = new GameDirector();
initPassiveItems(() => director.getGS());   // 与 main.js 一致：start 前接线，BOOT 时补挂
director.start();
getRealtimeClock().stop();
const gs = director.getGS();

const RICE = 'facility_rice';
const WHEAT = 'facility_wheat';
const STRAW = 'item_rice_straw';
const WHEAT_ITEM = 'item_wheat';

const HOME_IDX = gs.map.outerTiles.findIndex((t) => t.contentId === 'facility_home');

/** 清空背包 / 地块 / 玩家状态，让每个场景互不影响（保留家） */
function reset() {
  gs.inventory.items = [];
  gs.inventory.outbox = [];
  for (const t of gs.map.outerTiles) {
    t.contentId = t.idx === HOME_IDX ? 'facility_home' : null;
    t.terrain = 'terrain_grass';
    t.states = [];
    t.dailyFlags = {};
    t.contentState = {};
  }
  gs.player.hp = gs.player.maxHp;
  gs.flags = {};
  gs.activeBuffs = [];
}
const tile = (i) => gs.map.outerTiles[i];
const put = (i, id) => { gs.map.outerTiles[i].contentId = id; };
const give = (id, qty = 1) => InventorySystem.addItem(gs, id, qty);
const straw = () => InventorySystem.countItem(gs, STRAW);
const wheat = () => InventorySystem.countItem(gs, WHEAT_ITEM);

// ════════════════════════════════════════════════════════════
head('1. 稻香远：每回合开始时回复 2 × 稻草田块数量');
{
  reset();
  put(0, RICE); put(1, RICE); put(2, RICE);          // 3 块稻田
  give('grimoire_rice_scent');
  gs.player.hp = gs.player.maxHp - 100;
  const turn0 = gs.turn;
  advanceTurn(gs, 1);
  check(gs.turn === turn0 + 1, 'advanceTurn 只推进 1 回合', gs.turn - turn0);
  check(gs.player.hp === gs.player.maxHp - 100 + 6, '回合开始回复 2×3 = 6 点', gs.player.hp - (gs.player.maxHp - 100));

  // 上限截断
  gs.player.hp = gs.player.maxHp - 3;
  advanceTurn(gs, 1);
  check(gs.player.hp === gs.player.maxHp, '回复不突破生命上限', gs.player.hp);

  // 没有魔导书时不回复
  reset();
  put(0, RICE);
  gs.player.hp = gs.player.maxHp - 100;
  advanceTurn(gs, 1);
  check(gs.player.hp === gs.player.maxHp - 100, '未持有魔导书不回复', gs.player.hp);
}

// ════════════════════════════════════════════════════════════
head('2. 庆丰收：只有 ≥3 相连簇内的水稻田块产出 ×2');
{
  reset();
  put(0, RICE); put(1, RICE); put(2, RICE);   // 0,1,2 同一行相连
  put(4, RICE);                              // 孤立稻田（4 的邻居是 3/5，均非水稻）
  give('grimoire_harvest_cereal');
  HookDispatcher.fire('onDailyStart', { gs });
  // 草地 +1 → 基础 2/块；相连 3 块 ×2 = 4/块，孤立 1 块仍为 2
  check(straw() === 4 * 3 + 2, '稻草 = 4×3（簇内翻倍）+ 2（孤立不翻倍）', straw());

  // 簇被拆开后不再翻倍
  reset();
  put(0, RICE); put(2, RICE); put(4, RICE);
  gs.inventory.items = [];
  give('grimoire_harvest_cereal');
  HookDispatcher.fire('onDailyStart', { gs });
  check(straw() === 2 * 3, '不足 3 相连时不翻倍', straw());
}

// ════════════════════════════════════════════════════════════
head('3. 春光好：草元素伤害 +（2% × 水稻田块数量）');
{
  reset();
  put(0, RICE); put(1, RICE); put(2, RICE); put(3, RICE);   // 4 块稻田 → +8%
  give('grimoire_spring_glow');
  check(Math.abs(FieldEffects.grassElementMultiplier(gs) - 1.08) < 1e-9, '倍率 = 1.08', FieldEffects.grassElementMultiplier(gs));

  const defender = { name: '木桩', hp: 9999, maxHp: 9999, def: 0 };
  // 用剥离了天赋状态的探针 gs，避免其它战斗加成像干扰倍率断言
  const probe = { player: gs.player, map: gs.map, inventory: gs.inventory, team: {}, flags: {}, activeBuffs: [] };
  // 暴击是随机的（rawDamage 已含 1.5 倍），断言时按 isCrit 还原基准
  const critMul = (r) => (r.isCrit ? 1.5 : 1);
  const grass = calculateDamage({ atk: 100, defender, element: 'grass', player: probe.player, gs: probe });
  check(Math.abs(grass.rawDamage - 108 * critMul(grass)) < 1e-6, '草元素 rawDamage = 100 × 1.08（含暴击还原）', [grass.rawDamage, grass.isCrit]);

  // 摘掉魔导书做对照：物理伤害不应有任何变化
  probe.inventory = { items: gs.inventory.items.filter((e) => e.itemId !== 'grimoire_spring_glow'), outbox: [] };
  const physicalWithBook = calculateDamage({ atk: 100, defender, element: 'physical', player: probe.player, gs: probe });
  const grassNoBook = calculateDamage({ atk: 100, defender, element: 'grass', player: probe.player, gs: probe });
  check(Math.abs(physicalWithBook.rawDamage - 100 * critMul(physicalWithBook)) < 1e-6, '物理不受影响',
    [physicalWithBook.rawDamage, physicalWithBook.isCrit]);
  check(Math.abs(grassNoBook.rawDamage - 100 * critMul(grassNoBook)) < 1e-6, '无魔导书时草元素不加成',
    [grassNoBook.rawDamage, grassNoBook.isCrit]);

  probe.inventory = { items: gs.inventory.items, outbox: [] };
  const real = calculateDamage({ atk: 100, defender, element: 'grass', player: probe.player, gs: probe, realDamage: true });
  check(Math.abs(real.rawDamage - 100) < 1e-6, '真实伤害不吃加成', real.rawDamage);
}

// ════════════════════════════════════════════════════════════
head('4. 食为先：生命 < 50% 时立即回复，每天 1 次');
{
  reset();
  put(0, WHEAT); put(1, WHEAT);              // 2 块小麦田
  give('grimoire_food_first');
  gs.day = 1;
  gs.player.hp = Math.floor(gs.player.maxHp * 0.4);
  EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: -1, reason: 'test_damage' });
  const expected = Math.max(1, Math.floor(gs.player.maxHp * 0.03 * 2));
  check(gs.player.hp === Math.floor(gs.player.maxHp * 0.4) + expected, `回复 ${expected}（3%×2）`, gs.player.hp);

  // 同一天第二次跌破阈值不再回复
  const hpBefore = gs.player.hp;
  EventBus.emit(GE.HP_CHANGE, { newValue: hpBefore, delta: -1, reason: 'test_damage' });
  check(gs.player.hp === hpBefore, '同一天不重复触发', gs.player.hp);

  // 换日恢复次数
  gs.day = 2;
  gs.player.hp = Math.floor(gs.player.maxHp * 0.4);
  EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: -1, reason: 'test_damage' });
  check(gs.player.hp === Math.floor(gs.player.maxHp * 0.4) + expected, '次日再次生效', gs.player.hp);
}

// ════════════════════════════════════════════════════════════
head('5. 穗粒满：每一日结束时每块小麦田块 +1 小麦');
{
  reset();
  put(0, WHEAT); put(1, WHEAT); put(2, WHEAT);
  give('grimoire_grain_full');
  HookDispatcher.fire('onDailyEnd', { gs });
  check(wheat() === 3, '小麦 +3', wheat());
}

// ════════════════════════════════════════════════════════════
head('6. 黄金浪：≥3 相连小麦田块【经过时】+1 小麦');
{
  reset();
  put(0, WHEAT); put(1, WHEAT); put(2, WHEAT); put(4, WHEAT);
  give('grimoire_golden_wave');
  HookDispatcher.fire('onPass', { gs, tileIdx: 1 });
  check(wheat() === 1, '簇内麦田经过 → +1', wheat());
  HookDispatcher.fire('onPass', { gs, tileIdx: 4 });
  check(wheat() === 1, '孤立麦田经过不触发', wheat());
}

// ════════════════════════════════════════════════════════════
head('7. 仓廪实：稻草 / 小麦田块双向视同');
{
  reset();
  put(0, RICE); put(1, RICE); put(2, WHEAT);   // 2 稻田 + 1 麦田，全部相连
  give('grimoire_granary_full');
  give('grimoire_harvest_cereal');
  give('grimoire_rice_scent');
  give('grimoire_grain_full');

  check(FieldEffects.countFieldTiles(gs, 'rice') === 3, '水稻田块数把麦田也计入 → 3',
    FieldEffects.countFieldTiles(gs, 'rice'));
  check(FieldEffects.countFieldTiles(gs, 'wheat') === 3, '小麦田块数把稻田也计入 → 3',
    FieldEffects.countFieldTiles(gs, 'wheat'));
  check(FieldEffects.isFieldInCluster(gs, 2, 'rice', 3), '麦田参与水稻连片判定 → ≥3 相连',
    FieldEffects.fieldClusterSizeMap(gs, 'rice').get(2));

  // 产出结算：水稻 2 块各 2→4（簇内翻倍）；麦田 1 块 3→6（视同水稻后同样享受庆丰收）
  HookDispatcher.fire('onDailyStart', { gs });
  check(straw() === 8, '水稻产出 = 4×2', straw());
  check(wheat() === 6, '麦田产出 = (2+1)×2', wheat());

  // 稻香远按视同后的数量回复 2×3 = 6
  const inv = gs.inventory.items;
  gs.inventory.items = inv;    // 保持背包
  gs.player.hp = gs.player.maxHp - 100;
  advanceTurn(gs, 1);
  check(gs.player.hp === gs.player.maxHp - 94, '稻香远按视同数量回复 6', gs.player.hp);

  // 穗粒满按视同后的数量给 3 小麦
  const w0 = wheat();
  HookDispatcher.fire('onDailyEnd', { gs });
  check(wheat() === w0 + 3, '穗粒满按视同数量 +3', wheat() - w0);
}

// ════════════════════════════════════════════════════════════
head('8. 地块元素伤害链路：applyElementalDamageToCreature + 春光好');
{
  reset();
  put(0, RICE); put(1, RICE); put(2, RICE); put(3, RICE);   // 4 块稻田 → +8%
  give('grimoire_spring_glow');
  const dummy = { id: 'dummy_1', kind: 'slime', name: '粘液', category: 'hostile', hp: 100, maxHp: 100 };
  const r1 = applyElementalDamageToCreature(gs, dummy, 20, 'grass', { source: 'facility_cabbage' });
  check(r1?.finalDamage === 21 && dummy.hp === 79, '20 草伤 → 21（floor(20×1.08)）', [r1?.finalDamage, dummy.hp]);

  gs.inventory.items = gs.inventory.items.filter((e) => e.itemId !== 'grimoire_spring_glow');
  dummy.hp = 100;
  const r2 = applyElementalDamageToCreature(gs, dummy, 20, 'grass');
  check(r2?.finalDamage === 20 && dummy.hp === 80, '无魔导书 → 20', [r2?.finalDamage, dummy.hp]);

  const immune = { id: 'dummy_2', kind: 'slime', hp: 100, maxHp: 100, elementImmune: 'grass' };
  const r3 = applyElementalDamageToCreature(gs, immune, 20, 'grass');
  check(r3?.immune === true && immune.hp === 100, '草元素免疫 → 0 伤害', [r3?.immune, immune.hp]);

  // 卷心菜田块真实链路：每日开始投掷，不再因函数缺失被静默吞掉
  give('grimoire_spring_glow');
  put(3, 'facility_cabbage');
  give('item_cabbage', 2);
  const cabbageTarget = { id: 'dummy_3', kind: 'slime', name: '粘液', category: 'hostile', hp: 100, maxHp: 100, fenceCol: 1, fenceRow: 1 };
  gs.creatures = [cabbageTarget];
  HookDispatcher.fire('onDailyStart', { gs });
  check(cabbageTarget.hp === 79, '卷心菜投掷落到 21 草伤', cabbageTarget.hp);

  // 致死目标立即入队并 flush（从 gs.creatures 移除）
  put(3, 'facility_cabbage');
  tile(3).dailyFlags = {};
  give('item_cabbage', 1);
  const dying = { id: 'dummy_4', kind: 'slime', name: '粘液', category: 'hostile', hp: 10, maxHp: 100, fenceCol: 1, fenceRow: 1 };
  gs.creatures = [dying];
  HookDispatcher.fire('onDailyStart', { gs });
  check(gs.creatures.length === 0, '地块伤害击杀 → 立即移出生物列表', gs.creatures.length);
  gs.creatures = [];
}

// ════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
