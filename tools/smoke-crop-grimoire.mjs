// tools/smoke-crop-grimoire.mjs —— 魔导书「土豆 / 郁金香」6 本效果冒烟
//
// 覆盖：
//   1) 薯道难：共用容量池 / 一次取走全部田块 / 地雷伤害取总量
//   2) 薯条四重奏：田块数恰为 4 的倍数时容量 +10
//   3) 土豆地雷：上限 5、5 回合探出、敌对触发、友善不触发
//   4) 爆炸范围：友善生物在半径内不吃伤害 / 不晕眩，敌对生物正常受伤 + 晕眩
//   5) 易伤：受击方属性，地雷伤害同样生效；同名取最高，最后统一 floor
//   6) 泡沫 / 简单！：波动区间、叠放倍率、×1.5 结算、负价值扣金币、< -100 强制拆除
//   7) 经济上行：追溯抬高「初始价值」基线，但不改当前价值；叠放增量按新基线
// 用法：node tools/smoke-crop-grimoire.mjs

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
import * as InventorySystem from '../src/systems/InventorySystem.js';
import { initPassiveItems } from '../src/systems/PassiveItemSystem.js';
import { initCropGrimoires } from '../src/systems/CropGrimoireHooks.js';
import { isCreatureStunned } from '../src/systems/CreatureSystem.js';
import * as PotatoSystem from '../src/systems/PotatoSystem.js';
import * as TulipSystem from '../src/systems/TulipSystem.js';
import * as MineSystem from '../src/systems/MineSystem.js';
import { applyElementalDamageToCreature } from '../src/systems/CombatSystem.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

const director = new GameDirector();
initPassiveItems(() => director.getGS());   // 与 main.js 一致：start 前接线，BOOT 时补挂
initCropGrimoires(() => director.getGS());
director.start();
getRealtimeClock().stop();
const gs = director.getGS();

const POTATO = 'facility_potato';
const TULIP = 'facility_tulip';
const HARDSHIP = 'grimoire_potato_hardship';
const FRIES = 'grimoire_fries_quartet';
const MINE = 'grimoire_potato_mine';
const BUBBLE = 'grimoire_bubble';
const SIMPLE = 'grimoire_tulip_simple';
const ECONOMY = 'grimoire_economy_up';

const HOME_IDX = gs.map.outerTiles.findIndex((t) => t.contentId === 'facility_home');

function reset() {
  gs.inventory.items = [];
  gs.inventory.outbox = [];
  for (const t of gs.map.outerTiles) {
    t.contentId = t.idx === HOME_IDX ? 'facility_home' : null;
    t.contentState = {};
    t.dailyFlags = {};
  }
  gs.mines = [];
  gs.minesNextId = 1;
  gs.creatures = [];
  gs.player.gold = 100;
  gs.flags = {};
  gs.activeBuffs = [];
}
const tile = (i) => gs.map.outerTiles[i];
const put = (i, id) => { gs.map.outerTiles[i].contentId = id; };
const give = (id, qty = 1) => InventorySystem.addItem(gs, id, qty);

/** 构造生物：默认敌对，可覆写 */
function creature(over = {}) {
  return {
    id: 'c1', kind: 'slime', name: '粘液', category: 'hostile',
    hp: 100, maxHp: 100, radius: 0.25, housed: false, activeBuffs: [],
    pos: { x: 1.5, y: 1.5 },
    ...over,
  };
}

/** 直接放一颗已探出的地雷（便于精确控制坐标） */
function placedMine(x = 1.5, y = 1.5, sourceTileIdx = 0) {
  const m = {
    id: 'mine_test', sourceTileIdx, x, y, radius: MineSystem.MINE_RADIUS,
    blastRadius: MineSystem.MINE_BLAST_RADIUS, turnsLeft: 0, surfaced: true,
  };
  gs.mines = [m];
  return m;
}

// ════════════════════════════════════════════════════════════
head('1. 薯道难：共用容量池 / 一次取走全部 / 地雷伤害取总量');
{
  reset();
  put(0, POTATO); put(1, POTATO); put(2, POTATO);
  give(HARDSHIP);

  check(PotatoSystem.potatoCapacity(gs) === 30, '无薯条四重奏时容量 30', PotatoSystem.potatoCapacity(gs));
  check(PotatoSystem.addPotatoStored(gs, tile(0), 30) === 30, 'A 田存满 30', PotatoSystem.potatoStoredOf(tile(0)));
  check(PotatoSystem.addPotatoStored(gs, tile(1), 5) === 0, '共用池已满 → B 田无法再存', PotatoSystem.potatoStoredOf(tile(1)));
  check(PotatoSystem.potatoTotalStored(gs) === 30, '总量 = 30', PotatoSystem.potatoTotalStored(gs));

  // 从 B 田「进入时」取走：应扣到 A 田（外圈 idx 升序），一次拿走 20
  const r = PotatoSystem.harvestPotato(gs, 1, 20);
  check(r.actual === 20 && r.touched.includes(0), '一次取走 20（跨田块扣减）', r);
  check(PotatoSystem.potatoStoredOf(tile(0)) === 10, 'A 田剩余 10', PotatoSystem.potatoStoredOf(tile(0)));

  // 薯道难 → 伤害量 = 土豆储存总量
  check(PotatoSystem.potatoMineDamage(gs, 1) === 10, '地雷伤害 = 总量 10', PotatoSystem.potatoMineDamage(gs, 1));

  // 无薯道难 → 只算来源田块
  reset();
  put(0, POTATO); put(1, POTATO);
  tile(0).contentState = { potatoStored: 8 };
  tile(1).contentState = { potatoStored: 20 };
  check(PotatoSystem.potatoMineDamage(gs, 1) === 20, '无薯道难按来源田块 20', PotatoSystem.potatoMineDamage(gs, 1));
  check(PotatoSystem.addPotatoStored(gs, tile(1), 15) === 10, '单块容量 30 截断 +10', PotatoSystem.potatoStoredOf(tile(1)));
}

// ════════════════════════════════════════════════════════════
head('2. 薯条四重奏：数量恰为 4 的倍数时容量 +10');
{
  reset();
  put(0, POTATO); put(1, POTATO); put(2, POTATO);
  give(FRIES);
  check(PotatoSystem.potatoCapacity(gs) === 30, '3 块（非 4 倍数）→ 30', PotatoSystem.potatoCapacity(gs));
  put(3, POTATO);
  check(PotatoSystem.potatoCapacity(gs) === 40, '4 块 → 40', PotatoSystem.potatoCapacity(gs));

  // 无魔导书时 4 块也只有 30
  gs.inventory.items = gs.inventory.items.filter((e) => e.itemId !== FRIES);
  check(PotatoSystem.potatoCapacity(gs) === 30, '无书时 4 块仍 30', PotatoSystem.potatoCapacity(gs));
}

// ════════════════════════════════════════════════════════════
head('3. 土豆地雷：上限 5 / 5 回合探出 / 只对敌对生物触发');
{
  reset();
  put(0, POTATO);
  tile(0).contentState = { potatoStored: 10 };
  for (let i = 0; i < 6; i++) MineSystem.plantMine(gs, 0);
  check(gs.mines.length === MineSystem.MAX_MINES, '场上上限 5 个', gs.mines.length);

  check(gs.mines[0].turnsLeft === 5 && gs.mines[0].surfaced === false, '埋下时 5 回合未探出',
    [gs.mines[0].turnsLeft, gs.mines[0].surfaced]);
  MineSystem.tickMines(gs);
  MineSystem.tickMines(gs);
  MineSystem.tickMines(gs);
  MineSystem.tickMines(gs);
  const now = MineSystem.tickMines(gs);
  check(now.length > 0 && now.every((m) => m.surfaced), '第 5 回合探出头', now.length);

  // 友善生物踩雷：不触发、不受伤
  reset();
  put(0, POTATO);
  tile(0).contentState = { potatoStored: 10 };
  placedMine(1.5, 1.5, 0);
  const friend = creature({ id: 'c_friend', category: 'friendly', name: '小鸡', pos: { x: 1.5, y: 1.5 } });
  gs.creatures = [friend];
  const fired1 = MineSystem.stepMineCollisions(gs);
  check(fired1 === 0, '友善生物踩雷不触发', fired1);
  check(gs.mines.length === 1, '地雷仍在场上', gs.mines.length);
  check(friend.hp === 100 && !isCreatureStunned(friend), '友善生物不受伤、不晕眩', friend.hp);

  // 敌对生物踩雷：正常触发
  const enemy = creature({ id: 'c_enemy', pos: { x: 1.5, y: 1.5 } });
  gs.creatures = [enemy];
  const fired2 = MineSystem.stepMineCollisions(gs);
  check(fired2 === 1 && gs.mines.length === 0, '敌对生物踩雷 → 爆炸并消耗', [fired2, gs.mines.length]);
  check(enemy.hp === 90, '敌对生物受到 10 点火焰伤害', enemy.hp);
  check(isCreatureStunned(enemy), '敌对生物被【晕眩】', enemy.activeBuffs);
}

// ════════════════════════════════════════════════════════════
head('4. 爆炸范围：友善生物在半径内不吃伤害 / 不晕眩');
{
  reset();
  put(0, POTATO);
  tile(0).contentState = { potatoStored: 12 };
  const mine = placedMine(1.5, 1.5, 0);
  const enemy = creature({ id: 'c_enemy', pos: { x: 1.6, y: 1.5 } });
  const friend = creature({ id: 'c_friend', category: 'friendly', name: '小鸡', pos: { x: 2.0, y: 1.5 } });
  gs.creatures = [enemy, friend];

  const res = MineSystem.explodeMine(gs, mine);
  check(res.hit.length === 1 && res.hit[0] === enemy.id, '爆炸只命中敌对生物', res.hit);
  check(enemy.hp === 88, '敌对生物 -12', enemy.hp);
  check(friend.hp === 100 && !isCreatureStunned(friend), '半径内友善生物不受伤 / 不晕眩', [friend.hp, isCreatureStunned(friend)]);
  check(gs.mines.length === 0, '爆炸后地雷消耗', gs.mines.length);
  check(enemy.activeBuffs.some((b) => b.id === 'stunned' && b.params?.displayTurns === 1),
    '敌对生物获得【晕眩】1 回合（显示值 displayTurns=1）', enemy.activeBuffs);
}

// ════════════════════════════════════════════════════════════
head('5. 易伤：地雷伤害同样生效，同名取最高，最后统一 floor');
{
  reset();
  put(0, POTATO);
  tile(0).contentState = { potatoStored: 10 };

  const normal = creature({ id: 'c_normal', pos: { x: 1.5, y: 1.5 } });
  const vuln30 = creature({
    id: 'c_v30', pos: { x: 1.5, y: 1.5 },
    activeBuffs: [{ id: 'vulnerable', remainingTurns: 3, params: { strength: 0.30 } }],
  });
  const vulnMixed = creature({
    id: 'c_vmax', pos: { x: 1.5, y: 1.5 },
    activeBuffs: [
      { id: 'vulnerable', remainingTurns: 3, params: { strength: 0.30 } },
      { id: 'vulnerable', remainingTurns: 2, params: { strength: 0.50 } },
    ],
  });
  gs.creatures = [normal, vuln30, vulnMixed];
  const res = MineSystem.explodeMine(gs, { id: 'mine_v', sourceTileIdx: 0, x: 1.5, y: 1.5, radius: 0.35, blastRadius: 1, surfaced: true, turnsLeft: 0 });

  check(normal.hp === 90, '无易伤 → 10', normal.hp);
  check(vuln30.hp === 87, '30% 易伤 → floor(10×1.3) = 13', vuln30.hp);
  check(vulnMixed.hp === 85, '同名取最高 50% → floor(10×1.5) = 15（不叠乘）', vulnMixed.hp);
  check(res.maxApplied === 15, '爆炸结算记录最大实际伤害 15', res.maxApplied);

  // 基础值不能被乘出小数后提前取整：7 × 1.3 = 9.1 → 9
  reset();
  put(0, POTATO);
  tile(0).contentState = { potatoStored: 7 };
  const odd = creature({
    id: 'c_odd', pos: { x: 1.5, y: 1.5 },
    activeBuffs: [{ id: 'vulnerable', remainingTurns: 3, params: { strength: 0.30 } }],
  });
  gs.creatures = [odd];
  MineSystem.explodeMine(gs, { id: 'mine_o', sourceTileIdx: 0, x: 1.5, y: 1.5, radius: 0.35, blastRadius: 1, surfaced: true, turnsLeft: 0 });
  check(odd.hp === 91, '7 × 1.3 = 9.1 → 最后统一 floor = 9', odd.hp);

  // 地块投掷（卷心菜链路）同样吃易伤
  reset();
  const cabbageTarget = creature({ id: 'c_cab', hp: 100 });
  applyElementalDamageToCreature(gs, cabbageTarget, 20, 'grass');
  check(cabbageTarget.hp === 80, '无易伤：20 草伤', cabbageTarget.hp);
  cabbageTarget.hp = 100;
  cabbageTarget.activeBuffs = [{ id: 'vulnerable', remainingTurns: 3, params: { strength: 0.30 } }];
  const r = applyElementalDamageToCreature(gs, cabbageTarget, 20, 'grass');
  check(r.finalDamage === 26 && cabbageTarget.hp === 74, '易伤 30%：floor(20×1.3) = 26', [r.finalDamage, cabbageTarget.hp]);
}

// ════════════════════════════════════════════════════════════
head('6. 郁金香价值体系：波动 / 叠放 / 结算 / 负价值 / 强制拆除');
{
  reset();
  put(0, TULIP);
  TulipSystem.initTulipTile(gs, tile(0));
  check(TulipSystem.tulipValue(tile(0)) === 3, '初始价值 3', TulipSystem.tulipValue(tile(0)));

  // 泡沫：日初 -9~+18（Math.random 固定到上界，randInt 上限开区间）
  give(BUBBLE);
  const realRandom = Math.random;
  Math.random = () => 0.999;
  TulipSystem.applyTulipFluctuation(gs, tile(0), 'daily');
  Math.random = realRandom;
  check(TulipSystem.tulipValue(tile(0)) === 3 + 18, '泡沫日初波动 +18', TulipSystem.tulipValue(tile(0)));

  // 简单！：回合 -4~+9，且叠放层数翻倍波动；叠放价值 += 初始值
  reset();
  put(0, TULIP);
  give(SIMPLE);
  TulipSystem.initTulipTile(gs, tile(0));
  check(TulipSystem.tulipValue(tile(0)) === 3, '无经济上行初始 3', TulipSystem.tulipValue(tile(0)));
  const st = TulipSystem.stackTulip(gs, tile(0));
  check(st.value === 6 && st.stacks === 1, '叠放：价值 +3 → 6，层数 1', st);
  Math.random = () => 0.999;
  TulipSystem.applyTulipFluctuation(gs, tile(0), 'turn');
  Math.random = realRandom;
  check(TulipSystem.tulipValue(tile(0)) === 6 + 9 * 2, '回合波动 +9 × 2 倍 = +18 → 24', TulipSystem.tulipValue(tile(0)));

  // 结算 ×1.5：>50 floor；< -50 用 -ceil
  check(TulipSystem.settleTulipValue(51) === 76, '51 × 1.5 = 76.5 → floor 76', TulipSystem.settleTulipValue(51));
  check(TulipSystem.settleTulipValue(-51) === -77, '-51 × 1.5 → -ceil(76.5) = -77', TulipSystem.settleTulipValue(-51));
  check(TulipSystem.settleTulipValue(50) === 50, '50 不触发 ×1.5', TulipSystem.settleTulipValue(50));

  // 三日示例（任务 2 关键断言）：内部真实值累加，无《泡沫》时显示/结算夹 0，但绝不在中途把内部值夹 0
  reset();
  put(0, TULIP);
  TulipSystem.initTulipTile(gs, tile(0));                      // 初始 3
  const keepRandom = Math.random;
  Math.random = () => 0;                                        // 日波动 -4
  TulipSystem.applyTulipFluctuation(gs, tile(0), 'daily');
  check(TulipSystem.tulipValue(tile(0)) === -1, '三日示例①：3 + (-4) → 内部 -1',
    TulipSystem.tulipValue(tile(0)));
  check(TulipSystem.tulipDisplayValue(gs, tile(0)) === 0, '三日示例①：无《泡沫》显示 0',
    TulipSystem.tulipDisplayValue(gs, tile(0)));
  Math.random = () => 0.3;                                      // 日波动 0
  TulipSystem.applyTulipFluctuation(gs, tile(0), 'daily');
  check(TulipSystem.tulipValue(tile(0)) === -1, '三日示例②：波动 0 → 内部仍 -1（未被夹 0）',
    TulipSystem.tulipValue(tile(0)));
  check(TulipSystem.tulipDisplayValue(gs, tile(0)) === 0, '三日示例②：显示仍 0');
  Math.random = () => 0.4;                                      // 日波动 +2
  TulipSystem.applyTulipFluctuation(gs, tile(0), 'daily');
  Math.random = keepRandom;
  check(TulipSystem.tulipValue(tile(0)) === 1, '三日示例③：-1 + 2 → 内部 1（不是 2，证明没有中途夹 0）',
    TulipSystem.tulipValue(tile(0)));
  check(TulipSystem.tulipDisplayValue(gs, tile(0)) === 1, '三日示例③：显示 1',
    TulipSystem.tulipDisplayValue(gs, tile(0)));

  // 负价值 + 无《泡沫》：显示 0，按 0 结算，不扣金币
  reset();
  put(0, TULIP);
  gs.player.gold = 10;
  tile(0).contentState = { tulipValue: -40, tulipStacks: 0, tulipInit: true };
  const pickNoBook = TulipSystem.pickTulip(gs, tile(0));
  check(pickNoBook.debt === 0 && gs.player.gold === 10, '负价值 -40 无《泡沫》→ 按 0 结算、不扣金币',
    [pickNoBook.debt, gs.player.gold]);
  check(pickNoBook.itemValue === 0, '无《泡沫》负价值采摘物品价值 0', pickNoBook.itemValue);

  // 负价值 + 有《泡沫》：按负价值结算，金币可被扣为负
  reset();
  put(0, TULIP);
  give(BUBBLE);
  gs.player.gold = 10;
  tile(0).contentState = { tulipValue: -40, tulipStacks: 0, tulipInit: true };
  const pick = TulipSystem.pickTulip(gs, tile(0));
  check(pick.debt === 40 && gs.player.gold === -30, '负价值 -40 +《泡沫》→ 扣 40 金币（金币可为负）', [pick.debt, gs.player.gold]);
  check(pick.itemValue === 0, '负价值采摘物品价值 0', pick.itemValue);

  // < -100 强制拆除
  reset();
  put(0, TULIP);
  tile(0).contentState = { tulipValue: -101, tulipStacks: 0, tulipInit: true };
  check(TulipSystem.maybeForceRemoveTulip(gs, tile(0)) === true, '价值 < -100 → 强制拆除', tile(0).contentId);
}

// ════════════════════════════════════════════════════════════
head('7. 经济上行：追溯基线 +6，不改当前价值；叠放增量按新基线');
{
  reset();
  put(0, TULIP);
  // 先放一块（此时没有经济上行）
  TulipSystem.initTulipTile(gs, tile(0));
  check(TulipSystem.tulipValue(tile(0)) === 3, '放置时无书 → 当前价值 3', TulipSystem.tulipValue(tile(0)));

  give(ECONOMY);
  check(TulipSystem.tulipValue(tile(0)) === 3, '拿到经济上行后当前价值不变（不追溯加 6）', TulipSystem.tulipValue(tile(0)));
  check(TulipSystem.tulipInitialValue(gs) === 9, '初始价值基线抬高到 9（追溯所有田块）', TulipSystem.tulipInitialValue(gs));

  const st = TulipSystem.stackTulip(gs, tile(0));
  check(st.value === 12 && st.stacks === 1, '已存在田块叠放 → +9 基线 → 12', st);
  check(TulipSystem.tulipValue(tile(0)) === 12, '当前价值 = 12', TulipSystem.tulipValue(tile(0)));

  // 新放置的田块直接按新基线
  put(1, TULIP);
  TulipSystem.initTulipTile(gs, tile(1));
  check(TulipSystem.tulipValue(tile(1)) === 9, '新放置田块初始价值 9', TulipSystem.tulipValue(tile(1)));
}

// ════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
