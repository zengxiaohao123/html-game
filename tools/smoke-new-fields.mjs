// tools/smoke-new-fields.mjs —— v0.6 田块大更新专项冒烟
//
// 覆盖：
//   1) 水稻：水面 3 / 草地 1；祝福 5 日每日 +1；压制当日 0
//   2) 薰衣草：经过 +1 金币，20% 概率 +1 薰衣草
//   3) 向日葵：日初随机 1 格获得【产出时】+1；受祝福给全部 8 邻格
//   4) 黑莓：日初压制周围 8 格田块；受祝福清除并进入 4 天解除期
//   5) 酢浆草：经过自压制 → 当日日末不产出
//   6) 啤酒花：日初/日末各储存 1（上限 18）；相邻水面激活【产出时】+2；经过自动取走
//   7) 蘑菇：水面失效；日初储存 2；满 6 不产出不扩散，5/6 溢出一部分才扩散
//   8) 蓝星果：日初储存 1；半径公式；蓝息变异只掷一次；角色光环 +25% 动态增减
//   9) 杨桃：日初/日末/进入 +8；达到 200 产出 1 并重置 100
//  10) 南瓜：日末 +12；满 100 储存 1；进入取走且田块消失
//  11) 背包/出货箱按展示词条分堆，搬移保留词条
//
// 用法：node tools/smoke-new-fields.mjs

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
import { Random } from '../src/core/Random.js';
import { getTile, neighborRefs8, neighborRefs, refXY } from '../src/core/TileAccess.js';
import * as InventorySystem from '../src/systems/InventorySystem.js';
import { initPassiveItems, syncPumpkin } from '../src/systems/PassiveItemSystem.js';
import { FieldAuraSystem } from '../src/systems/FieldAuraSystem.js';
import { expandMapInPlace, EXPAND_AXIS } from '../src/systems/MapExpandSystem.js';
import { isSuppressed, releaseBlackberry } from '../src/systems/SuppressSystem.js';
import {
  blueRadiusFor, isInBlueBreath, isTileCenterInBlueBreath, syncBlueBreath, syncCreatureBlueAura,
} from '../src/systems/BlueBreathSystem.js';
import { produce } from '../src/systems/ProduceSystem.js';
import { hasProduceBonus, hasAdjacentWater, grantProduceBonus } from '../src/systems/ProduceSystem.js';
import { takeStoredToBag } from '../src/systems/ProduceSystem.js';
import { harvestCropBeforeRemove } from '../src/systems/CropHarvest.js';
import { placeContent, clearContent } from '../src/systems/BuildSystem.js';
import { migrateGS } from '../src/state/migrate.js';
import { harvestPotato } from '../src/systems/PotatoSystem.js';
import { POOLS } from '../src/data/items.js';
import { createEl } from '../src/ui/dom.js';
import { fieldContentRows } from '../src/data/fieldTraits.js';
import { useItem, hasDailyStartTrait } from '../src/systems/UseItemSystem.js';
import { addHopsStored } from '../src/data/fields/hops.js';
import { applyMaxHp } from '../src/systems/HealSystem.js';
import { Assets } from '../src/core/Assets.js';
import { ITEMS, GLOSSARY } from '../src/data/items.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

const director = new GameDirector();
initPassiveItems(() => director.getGS());
director.start();
getRealtimeClock().stop();
const gs = director.getGS();

const HOME_IDX = gs.map.outerTiles.find((t) => t.contentId === 'facility_home')?.idx;
const ANCHOR = gs.map.outerTiles.find((t) => t.idx !== HOME_IDX && t.idx !== undefined).idx;
const BASE_HP = gs.player.maxHp;
const BASE_ATK = gs.player.atk;
const origChance = Random.chance;
const origPick = Random.pick;

function reset() {
  gs.inventory.items = [];
  gs.inventory.outbox = [];
  for (const t of gs.map.outerTiles) {
    t.contentId = t.idx === HOME_IDX ? 'facility_home' : null;
    t.terrain = 'terrain_grass';
    t.states = [];
    t.dailyFlags = {};
    t.contentState = {};
    t.placedItems = [];
  }
  gs.player.maxHp = BASE_HP;
  gs.player.atk = BASE_ATK;
  gs.player.hp = BASE_HP;
  gs.player.x = 0;
  // 动态加成账本（蓝息 / 悲伤的南瓜）也要清空：测试直接改数值后就从当前值重新记基数
  delete gs.player._statLedger;
  gs._pumpkin = null;
  gs._blueAura = null;
  Random.chance = origChance;
  Random.pick = origPick;
}
const at = (ref) => getTile(gs, ref);
function put(ref, id, terrain = 'terrain_grass') {
  const t = at(ref);
  t.contentId = id;
  t.terrain = terrain;
  t.states = [];
  t.dailyFlags = {};
  t.contentState = {};
  return t;
}
const count = (id) => InventorySystem.countItem(gs, id);
const dayStart = () => { FieldAuraSystem.preDailyStart(gs); HookDispatcher.fire('onDailyStart', { gs }); };
const dayEnd = () => { HookDispatcher.fire('onDailyEnd', { gs }); };
const passTile = (ref) => HookDispatcher.fire('onPass', { gs, tileIdx: ref, tileRef: ref });
const enterTile = (ref) => HookDispatcher.fire('onEnter', { gs, tileIdx: ref, tileRef: ref });
const blessTile = (ref) => HookDispatcher.fire('onBlessed', { gs, tileIdx: ref, tileRef: ref });

// ════════════════════════════════════════════════════════════
head('1. 水稻：水面 3 / 草地 1；祝福每日 +1；压制当日 0');
{
  reset();
  const nb = neighborRefs(gs, ANCHOR);
  put(ANCHOR, 'facility_rice', 'terrain_water');
  put(nb[0], 'facility_rice', 'terrain_grass');
  dayStart();
  check(count('item_rice_straw') === 4, '水面 3 + 草地 1 = 4 稻草', count('item_rice_straw'));
  blessTile(ANCHOR);
  check(at(ANCHOR).states.some((s) => s.type === 'rice_bless' && s.remainingDays === 5), '受祝福写入 5 日 rice_bless');
  gs.inventory.items = [];
  dayStart();
  check(count('item_rice_straw') === 5, '次日水面 3 + 祝福 1 + 草地 1 = 5', count('item_rice_straw'));
  at(nb[0]).contentState.suppressUntilDay = gs.day;
  gs.inventory.items = [];
  dayStart();
  check(count('item_rice_straw') === 4, '草地格被压制后只剩水面 3 + 祝福 1 = 4', count('item_rice_straw'));
}

// ════════════════════════════════════════════════════════════
head('2. 薰衣草：经过 +1 金币；20% 概率 +1 薰衣草');
{
  reset();
  put(ANCHOR, 'facility_lavender');
  const g0 = gs.player.gold;
  Random.chance = () => false;
  passTile(ANCHOR);
  check(gs.player.gold === g0 + 1 && count('item_lavender') === 0, '未命中 20%：金币 +1，无薰衣草', { gold: gs.player.gold, n: count('item_lavender') });
  Random.chance = () => true;
  passTile(ANCHOR);
  check(gs.player.gold === g0 + 2 && count('item_lavender') === 1, '命中 20%：金币 +1，薰衣草 +1', { gold: gs.player.gold, n: count('item_lavender') });
  blessTile(ANCHOR);
  check(count('item_lavender') === 3, '受祝福：薰衣草 +2', count('item_lavender'));
}

// ════════════════════════════════════════════════════════════
head('3. 向日葵：日初随机 1 格获得【产出时】；受祝福给全部 8 邻格');
{
  reset();
  put(ANCHOR, 'facility_sunflower');
  const nbs = neighborRefs8(gs, ANCHOR);
  put(nbs[0], 'facility_wheat');
  put(nbs[1], 'facility_wheat');
  Random.pick = (arr) => arr[0];
  dayStart();
  const granted = nbs.filter((r) => at(r).contentState?.produceBonusDay === gs.day).length;
  check(granted === 1, '日初只授予 1 格', granted);
  gs.inventory.items = [];
  Random.chance = () => false;
  produce(gs, { ref: nbs[0], itemId: 'item_wheat', qty: 1 });
  check(count('item_wheat') === 2, '带【产出时】的产出 +1（1 → 2）', count('item_wheat'));
  blessTile(ANCHOR);
  const fieldNb = nbs.filter((r) => at(r).contentId === 'facility_wheat');
  const all = fieldNb.filter((r) => at(r).contentState?.produceBonusDay === gs.day).length;
  check(all === fieldNb.length && fieldNb.length === 2, `受祝福后周围 ${fieldNb.length} 格田块全部获得`, all);
}

// ════════════════════════════════════════════════════════════
head('4. 黑莓：日初压制周围 8 格；受祝福清除并进入 4 天解除期');
{
  reset();
  gs.day = 8;
  put(ANCHOR, 'facility_blackberry');
  const nb = neighborRefs8(gs, ANCHOR)[0];
  put(nb, 'facility_rice');
  dayStart();
  check(isSuppressed(gs, nb), '相邻水稻被压制');
  check(count('item_blackberry') === 2, '黑莓自身日产 2（不被压制）', count('item_blackberry'));
  check(count('item_rice_straw') === 0, '被压制水稻当日 0 稻草', count('item_rice_straw'));
  blessTile(ANCHOR);
  check(!isSuppressed(gs, nb), '受祝福立刻清除相邻压制');
  check(at(ANCHOR).contentState.blackberryReleaseUntilDay === gs.day + 3, '解除期 = 当天 + 3');
  gs.inventory.items = [];
  gs.day += 1;
  dayStart();
  check(!isSuppressed(gs, nb) && count('item_rice_straw') === 1, '解除期内次日不压制，水稻 1 稻草');
  // 直接验证 releaseBlackberry 的解除天数
  const before = at(ANCHOR).contentState.blackberryReleaseUntilDay;
  releaseBlackberry(gs, ANCHOR);
  check(at(ANCHOR).contentState.blackberryReleaseUntilDay === gs.day + 3 && before === gs.day + 2, '重复祝福重置为 4 天');
}

// ════════════════════════════════════════════════════════════
head('5. 酢浆草：经过自压制 → 当日日末 0');
{
  reset();
  put(ANCHOR, 'facility_sorrel');
  passTile(ANCHOR);
  check(isSuppressed(gs, ANCHOR), '经过后本日自压制');
  dayEnd();
  check(count('item_sorrel') === 0, '被压制日末不产出', count('item_sorrel'));
  gs.day += 1;
  dayEnd();
  check(count('item_sorrel') === 4, '次日日末 +4', count('item_sorrel'));
  blessTile(ANCHOR);
  check(count('item_sorrel') === 8, '受祝福 +4', count('item_sorrel'));
}

// ════════════════════════════════════════════════════════════
head('6. 啤酒花：邻水常规 1 + 额外 2 = 3；【产出时】独立于水面');
{
  reset();
  put(ANCHOR, 'facility_hops');
  const waterRef = neighborRefs(gs, ANCHOR)[0];
  at(waterRef).terrain = 'terrain_water';
  at(waterRef).contentId = null;
  dayStart();
  check(at(ANCHOR).contentState.hopsStored === 3, '邻水日初一次产出 = 常规 1 + 额外 2 = 3', at(ANCHOR).contentState.hopsStored);
  dayEnd();
  check(at(ANCHOR).contentState.hopsStored === 6, '日末再产出 3 = 6', at(ANCHOR).contentState.hopsStored);
  check(hasAdjacentWater(gs, ANCHOR), '相邻水面：浇水门槛满足');
  // 直接用产出漏斗验证结算顺序：基础 1 + 水面 2 + 向日葵【产出时】1 = 4
  grantProduceBonus(at(ANCHOR), gs.day); // 模拟向日葵授予的【产出时】
  check(hasProduceBonus(gs, ANCHOR), '邻水 + 【产出时】同时生效');
  const before = at(ANCHOR).contentState.hopsStored;
  Random.chance = () => false;
  const n1 = produce(gs, {
    ref: ANCHOR, itemId: 'item_hops', qty: 1, channel: 'store',
    apply: (k) => addHopsStored(at(ANCHOR), k),
  });
  check(n1 === 4 && at(ANCHOR).contentState.hopsStored === before + 4, '1 基础 + 2 水面 + 1 产出时 = 4', n1);
  // 水面 +2 只作用于啤酒花本体：向日葵递归产出不能继承这 +2
  const sunBefore = count('item_sunflower');
  let chanceCalls = 0;
  Random.chance = () => { chanceCalls += 1; return chanceCalls === 1; }; // 只让第一次 10% 命中
  produce(gs, {
    ref: ANCHOR, itemId: 'item_hops', qty: 1, channel: 'store',
    apply: (k) => addHopsStored(at(ANCHOR), k),
  });
  check(count('item_sunflower') === sunBefore + 2,
    '向日葵递归不继承水面 +2（基础 1 + 产出时 1 = 2，而非 ×3）', count('item_sunflower') - sunBefore);
  Random.chance = () => false;
  // 移除水面：水面额外量消失，但向日葵特性仍独立生效（不再被水面门控）
  at(waterRef).terrain = 'terrain_grass';
  check(hasProduceBonus(gs, ANCHOR), '移除水面后向日葵【产出时】仍生效（不再被水面门控）');
  const n2 = produce(gs, {
    ref: ANCHOR, itemId: 'item_hops', qty: 1, channel: 'store',
    apply: (k) => addHopsStored(at(ANCHOR), k),
  });
  check(n2 === 2, '无水面：常规 1 + 产出时 1 = 2', n2);
  const beforePass = at(ANCHOR).contentState.hopsStored;
  passTile(ANCHOR);
  check(at(ANCHOR).contentState.hopsStored === 0 && count('item_hops') === beforePass,
    '经过自动取走全部储存', { stored: at(ANCHOR).contentState.hopsStored, bag: count('item_hops') });
}

// ════════════════════════════════════════════════════════════
head('7. 蘑菇：水面失效；日初储存 2；满 6 不产出不扩散；5/6 溢出才扩散');
{
  reset();
  put(ANCHOR, 'facility_mushroom', 'terrain_water');
  dayStart();
  check(at(ANCHOR).contentState.mushroomStored === undefined || at(ANCHOR).contentState.mushroomStored === 0, '水面：其余所有特性失效');
  at(ANCHOR).terrain = 'terrain_grass';
  dayStart();
  check(at(ANCHOR).contentState.mushroomStored === 2, '日初储存 2', at(ANCHOR).contentState.mushroomStored);
  at(ANCHOR).contentState.mushroomStored = 6;
  Random.pick = (arr) => arr[0];
  const mushTiles = () => gs.map.outerTiles.filter((t) => t.contentId === 'facility_mushroom').length;
  const nFull = mushTiles();
  dayStart();
  check(at(ANCHOR).contentState.mushroomStored === 6 && mushTiles() === nFull,
    '储存已满 6/6：日初不再产出，也不扩散',
    { stored: at(ANCHOR).contentState.mushroomStored, tiles: mushTiles() });
  at(ANCHOR).contentState.mushroomStored = 5;
  dayStart();
  check(at(ANCHOR).contentState.mushroomStored === 6 && mushTiles() === nFull + 1,
    '5/6 → 只落地 1 个，溢出扩散 1 块',
    { stored: at(ANCHOR).contentState.mushroomStored, tiles: mushTiles() });
  // 扩散出的田块 = 独立真实田块：扩建后不消失，随地块一起重映射
  const probe = JSON.parse(JSON.stringify(gs));
  const mushIdx = new Set(gs.map.outerTiles.filter((t) => t.contentId === 'facility_mushroom').map((t) => t.idx));
  for (const t of probe.map.outerTiles) if (mushIdx.has(t.idx)) t._probeMush = true;
  const n0 = probe.map.outerTiles.filter((t) => t._probeMush).length;
  expandMapInPlace(probe, EXPAND_AXIS.LENGTH);
  expandMapInPlace(probe, EXPAND_AXIS.WIDTH);
  const kept = probe.map.outerTiles.filter((t) => t._probeMush && t.contentId === 'facility_mushroom').length;
  check(n0 === mushIdx.size && kept === n0, '蘑菇扩散田块经两次扩建后仍存在（随地块重映射）',
    { before: n0, kept });
}

// ════════════════════════════════════════════════════════════
head('8. 蓝星果：储存 / 半径 / 变异只掷一次 / 角色光环');
{
  reset();
  put(ANCHOR, 'facility_blue_star_fruit');
  const nb = neighborRefs(gs, ANCHOR)[0];
  put(nb, 'facility_lavender');
  dayStart();
  check(at(ANCHOR).contentState.blueStored === 1, '日初储存 1', at(ANCHOR).contentState.blueStored);
  check(blueRadiusFor(1) === 0.6 && Math.abs(blueRadiusFor(7) - 1.8) < 1e-9, '半径公式 0.6 + 0.2×(n-1)');
  // 地块按四周边缘判定：半径 0.6 米已与相邻格边缘接触（源心到矩形最近距离 0.5）
  check(isInBlueBreath(gs, nb), '地块按边缘判定：半径 0.6 米即覆盖相邻格');
  const diag = neighborRefs8(gs, ANCHOR).find((r) => !neighborRefs(gs, ANCHOR).includes(r));
  if (diag !== undefined) {
    check(!isInBlueBreath(gs, diag), '对角格边缘最近距离 0.707 米 > 0.6：不在范围内');
  }
  // 角色 / NPC 按所在地块中心点判定：相邻格中心距 1 米 > 0.6
  check(!isTileCenterInBlueBreath(gs, nb), '角色口径：半径 0.6 米覆盖不到相邻格中心点');
  at(ANCHOR).contentState.blueStored = 7;
  check(isInBlueBreath(gs, nb), '储存 7（半径 1.8 米）覆盖相邻格');
  at(ANCHOR).contentState.suppressUntilDay = gs.day;
  check(!isInBlueBreath(gs, nb), '蓝星果田块被压制：蓝息关闭');
  at(ANCHOR).contentState.suppressUntilDay = null;
  Random.chance = () => true;
  gs.inventory.items = [];
  produce(gs, { ref: nb, itemId: 'item_lavender', qty: 1 });
  const blueStack = gs.inventory.items.find((e) => e.itemId === 'item_lavender' && e.tags);
  check(blueStack && blueStack.qty === 1 && blueStack.tags.join('|') === '湛蓝|违禁品', '10% 变异挂【湛蓝】【违禁品】', blueStack);
  // 两块蓝星果重叠覆盖同一格：每件仍只判定一次
  const other = neighborRefs8(gs, ANCHOR).find((r) => !at(r).contentId) ?? ANCHOR;
  put(other, 'facility_blue_star_fruit');
  at(other).contentState.blueStored = 7;
  gs.inventory.items = [];
  produce(gs, { ref: nb, itemId: 'item_lavender', qty: 1 });
  const tagged = gs.inventory.items.filter((e) => e.tags).reduce((s, e) => s + e.qty, 0);
  check(tagged === 1, '范围重叠仍只判定一次', tagged);
  // 蓝星果田块自身不受变异影响
  gs.inventory.items = [];
  produce(gs, { ref: ANCHOR, itemId: 'item_blue_starfruit', qty: 1 });
  check(gs.inventory.items.every((e) => !e.tags), '蓝星果田块自身产出不带变异词条', gs.inventory.items);

  // A1：逐个产物独立掷（3 件中第 1 件命中 → 只有 1 件带词条）
  let roll = 0;
  Random.chance = () => (roll++ % 3) === 0;
  gs.inventory.items = [];
  produce(gs, { ref: nb, itemId: 'item_lavender', qty: 3 });
  const taggedQty = gs.inventory.items.filter((e) => e.tags).reduce((s, e) => s + e.qty, 0);
  check(taggedQty === 1, '逐件独立判定：3 件只有 1 件变异', taggedQty);

  // A1：拆除自动采摘同样逐件判定（草莓 3 个 → 3 件全变异）
  Random.chance = () => true;
  gs.inventory.items = [];
  put(nb, 'facility_strawberry');
  at(nb).contentState.strawberryStored = 3;
  const harvested = harvestCropBeforeRemove(gs, at(nb), nb);
  const removedTagged = gs.inventory.items
    .filter((e) => e.itemId === 'item_strawberry' && e.tags)
    .reduce((s, e) => s + e.qty, 0);
  check(harvested?.harvested?.length === 1 && removedTagged === 3,
    '拆除自动采摘：逐件入包并逐件判定变异', { removedTagged, harvested });
  // 角色光环动态增减：先离开范围清空，再进入
  gs.player.x = -1;
  gs.player.loc = null;
  syncBlueBreath(gs);
  const hp0 = gs.player.maxHp;
  gs.player.x = ANCHOR;
  syncBlueBreath(gs);
  check(gs.player.maxHp === Math.round(hp0 * 1.25), `角色最大生命 +25%（${hp0} → ${gs.player.maxHp}）`);
  gs.player.x = -1;
  gs.player.loc = null;
  syncBlueBreath(gs);
  check(gs.player.maxHp === hp0, '离开范围后动态移除', gs.player.maxHp);
  // 反复进出 → 加成全部移除后必须精确回到原值（不允许取整漂移）
  for (let i = 0; i < 5; i++) {
    gs.player.x = ANCHOR;
    syncBlueBreath(gs);
    gs.player.x = -1;
    gs.player.loc = null;
    syncBlueBreath(gs);
  }
  check(gs.player.maxHp === hp0, '反复进出蓝息 5 次后最大生命精确回到原值', gs.player.maxHp);
}

// ════════════════════════════════════════════════════════════
head('8b. 蓝息三类判定：栅栏内生物按自身碰撞框');
{
  reset();
  const savedCreatures = gs.creatures;
  put(ANCHOR, 'facility_blue_star_fruit');
  at(ANCHOR).contentState.blueStored = 1;
  const p = refXY(gs, ANCHOR);
  const sx = p.x + 0.5;
  const sy = p.y + 0.5;
  gs.creatures = [
    // 距源心 0.7 米；蓝息 0.6 + 碰撞半径 0.15 = 0.75 → 接触
    { id: 'smoke_c1', kind: 'chick', hp: 25, maxHp: 50, atk: 10, pos: { x: sx + 0.7, y: sy }, radius: 0.15, speedPerTile: 1 },
    // 距源心 1.0 米 → 不接触
    { id: 'smoke_c2', kind: 'chick', hp: 25, maxHp: 50, atk: 10, pos: { x: sx + 1.0, y: sy }, radius: 0.15, speedPerTile: 1 },
  ];
  syncCreatureBlueAura(gs);
  const c1 = gs.creatures[0];
  const c2 = gs.creatures[1];
  check(c1._blueAura?.active === true, '碰撞框与蓝息接触 → 生物获得 buff');
  check(Math.abs(c1.maxHp - 62.5) < 1e-9 && Math.abs(c1.hp - 31.3) < 1e-9,
    '生物上限 +25%，当前生命按原 50% 同步', { maxHp: c1.maxHp, hp: c1.hp });
  check(!c2._blueAura?.active, '碰撞框未接触 → 不获得 buff');
  c1.pos.x = sx + 0.8; // 0.8 > 0.75
  syncCreatureBlueAura(gs);
  check(c1._blueAura.active === false && c1.maxHp === 50, '移出碰撞范围 → 光环移除', { maxHp: c1.maxHp });
  gs.creatures = savedCreatures;
}

// ════════════════════════════════════════════════════════════
head('8c. 生命上限变化：当前生命按百分比同步（角色与生物一致）');
{
  const up = { hp: 50, maxHp: 100 };
  applyMaxHp(up, 120);
  check(up.hp === 60 && up.maxHp === 120, '上限提高：50/100 → 60/120', up);
  const down = { hp: 30, maxHp: 100 };
  applyMaxHp(down, 50);
  check(down.hp === 15 && down.maxHp === 50, '上限下降：30/100 → 15/50', down);
  const floor = { hp: 1, maxHp: 100 };
  applyMaxHp(floor, 10);
  check(floor.hp === 1, '上限下降后当前生命不低于 1', floor);
  const full = { hp: 50, maxHp: 50 };
  applyMaxHp(full, 62.5);
  check(full.hp === 62.5, '满血单位上限提高后保持满血（生物小数上限）', full);
  const creatureDown = { hp: 25, maxHp: 50 };
  applyMaxHp(creatureDown, 37.5);
  check(Math.abs(creatureDown.hp - 18.8) < 1e-9, '生物：25/50 → 18.8/37.5', creatureDown);
}

// ════════════════════════════════════════════════════════════
head('8d. 图标兜底 / 蓝息术语 / 违禁品词条');
{
  check(Assets.getEmoji('items', 'item_hops') === '🍺', '新物品 emoji 兜底：item_hops → 🍺');
  check(Assets.getEmoji('facilities', 'facility_blue_star_fruit') === '💙', '新田块 emoji 兜底：蓝星果田块 → 💙');
  check(Assets.getEmoji('items', 'no_such_item') === '❓', '未知 id 仍回退 ❓（不误伤）');
  const blue = GLOSSARY.find((g) => g.term === '蓝息');
  check(!!blue && !blue.meaning.includes('重叠取最高'), '蓝息术语释义不含内部实现备注');
  check(!!blue && blue.notes.includes('重叠取最高'), '内部备注移入 notes（弹窗不展示）');
  check((ITEMS.facility_blue_star_fruit.traits || []).includes('违禁品'), '蓝星果田块展示词条含【违禁品】');
}

// ════════════════════════════════════════════════════════════
head('8e. 展示归类：【压制】/【蓝息】只出现在状态页，不在区块内容');
{
  const collect = (el, cls, out = []) => {
    if (el?._classes?.has(cls)) out.push(el);
    for (const c of el?.children || []) collect(c, cls, out);
    return out;
  };
  const { InfoPanel } = await import('../src/ui/InfoPanel.js');
  const panel = new InfoPanel();
  panel.mount();
  panel.currentGs = gs;
  put(ANCHOR, 'facility_wheat');
  at(ANCHOR).contentState.suppressUntilDay = gs.day;
  at(ANCHOR).terrain = 'terrain_grass';
  panel.selectTile(ANCHOR);
  const contentText = panel.root.textContent;
  check(!contentText.includes('【压制】'), '地块内容不显示【压制】debuff');
  check(!contentText.includes('⛔'), '地块内容不显示压制行');
  const stateIdx = panel._currentTabs.findIndex((t) => t.render === 'state');
  check(stateIdx >= 0, '被压制地块有状态 tab');
  panel.activeTabIdx = stateIdx;
  panel._renderBody();
  const stateText = panel.root.textContent;
  check(stateText.includes('【压制】'), '状态页显示【压制】debuff');
  check(stateText.includes(GLOSSARY.find((g) => g.term === '压制').meaning), '压制行释义取自词条字典');
  // 条件型激活：不另起一行播报，改为特性行末尾的彩色（已激活 / 未激活）后缀
  reset();
  put(ANCHOR, 'facility_blue_star_fruit');
  at(ANCHOR).contentState.blueStored = 7;
  panel.activeTabIdx = 0; // 回到「地块内容」
  panel.selectTile(ANCHOR);
  const blueText = panel.root.textContent;
  check(!blueText.includes('💙 特性：'), '蓝星果不再另起一行播报激活态');
  check(blueText.includes('（已激活）'), '蓝星果有储存：特性行末尾显示（已激活）');
  at(ANCHOR).contentState.blueStored = 0;
  panel._renderBody();
  check(panel.root.textContent.includes('（未激活）'), '蓝星果无储存：特性行末尾显示（未激活）');
  at(ANCHOR).contentState.blueStored = 7;
  syncBlueBreath(gs);
  const blueStateIdx = panel._currentTabs.findIndex((t) => t.render === 'state');
  panel.activeTabIdx = blueStateIdx;
  panel._renderBody();
  check(panel.root.textContent.includes('【蓝息】'), '受影响地块（含蓝星果自身）状态页显示蓝息 buff');

  // 啤酒花：激活状态走特性行后缀；未浇水仍正常显示（不套封禁）
  reset();
  put(ANCHOR, 'facility_hops', 'terrain_grass');
  panel.activeTabIdx = 0;
  panel.selectTile(ANCHOR);
  const hopTraitLines = collect(panel.root, 'trait-line');
  const hopLine = hopTraitLines.find((el) => el.textContent.includes('需要浇水'));
  check(!!hopLine && hopLine.textContent.includes('（未激活）'), '啤酒花未浇水：特性行末尾显示（未激活）');
  check(!hopTraitLines.some((el) => el._classes.has('is-suppressed')),
    '未浇水不套用封禁样式');
  check(!panel.root.textContent.includes('💧 相邻水面'),
    '不再单独播报「相邻水面：已浇水」');
  const waterRef = neighborRefs(gs, ANCHOR)[0];
  at(waterRef).terrain = 'terrain_water';
  panel._renderBody();
  const hopLine2 = collect(panel.root, 'trait-line').find((el) => el.textContent.includes('需要浇水'));
  check(!!hopLine2 && hopLine2.textContent.includes('（已激活）'), '啤酒花相邻水面：特性行末尾显示（已激活）');

  // 蘑菇：地块为水面 → 除水面规则行外，其余特性行套用封禁样式
  reset();
  put(ANCHOR, 'facility_mushroom', 'terrain_water');
  panel.selectTile(ANCHOR);
  const mushTraitLines = collect(panel.root, 'trait-line');
  const ruleLine = mushTraitLines.find((el) => el.textContent.includes('所在地块地形为水面时'));
  const otherLines = mushTraitLines.filter((el) => el !== ruleLine);
  check(!!ruleLine && !ruleLine._classes.has('is-suppressed'), '蘑菇水面：「其余所有特性失效」规则行本身不划掉');
  check(otherLines.length > 0 && otherLines.every((el) => el._classes.has('is-suppressed')),
    '蘑菇水面：其余特性行套用封禁样式（红底 + 删除线）', otherLines.length);
  check(!ruleLine.textContent.includes('（未激活）') && !ruleLine.textContent.includes('（已激活）'),
    '蘑菇水面走封禁样式，不显示激活态后缀');
}

// ════════════════════════════════════════════════════════════
head('8f. 悲伤的南瓜：储存反复增减后，最大生命 / 攻击精确回到原值');
{
  reset();
  gs.inventory.items = [];
  InventorySystem.addItem(gs, 'collectible_sad_pumpkin', 1);
  put(ANCHOR, 'facility_pumpkin');
  const baseHp = gs.player.maxHp;
  const baseAtk = gs.player.atk;
  for (let i = 0; i < 6; i++) {
    at(ANCHOR).contentState.potatoStored = 5;
    syncPumpkin(gs);
    at(ANCHOR).contentState.potatoStored = 0;
    syncPumpkin(gs);
  }
  check(gs.player.maxHp === baseHp && gs.player.atk === baseAtk,
    `南瓜储存加满再清空 6 次：${baseHp}/${baseAtk} 精确回到原值`,
    { maxHp: gs.player.maxHp, atk: gs.player.atk });
}

// ════════════════════════════════════════════════════════════
head('9. 杨桃：日初/日末/进入 +8；满 200 产出 1 并重置 100');
{
  reset();
  put(ANCHOR, 'facility_starfruit');
  at(ANCHOR).contentState.starfruitGrowth = 0;
  dayStart();
  dayEnd();
  check(at(ANCHOR).contentState.starfruitGrowth === 16, '日初 + 日末 = 16', at(ANCHOR).contentState.starfruitGrowth);
  enterTile(ANCHOR);
  check(at(ANCHOR).contentState.starfruitGrowth === 24, '进入 +8 = 24', at(ANCHOR).contentState.starfruitGrowth);
  gs.inventory.items = [];
  at(ANCHOR).contentState.starfruitGrowth = 192;
  dayStart();
  check(count('item_starfruit') === 1 && at(ANCHOR).contentState.starfruitGrowth === 100,
    '192 + 8 = 200 → 杨桃 ×1，成长值重置 100',
    { n: count('item_starfruit'), g: at(ANCHOR).contentState.starfruitGrowth });
}

// ════════════════════════════════════════════════════════════
head('10. 南瓜：日末 +12；满 100 储存；进入取走且田块消失');
{
  reset();
  put(ANCHOR, 'facility_pumpkin');
  at(ANCHOR).contentState.pumpkinGrowth = 0;
  dayEnd();
  check(at(ANCHOR).contentState.pumpkinGrowth === 12, '日末成长值 +12', at(ANCHOR).contentState.pumpkinGrowth);
  Random.chance = () => false; // 不触发 50% 田块掉落
  at(ANCHOR).contentState.pumpkinGrowth = 88;
  dayEnd();
  check(at(ANCHOR).contentState.pumpkinStored === 1 && at(ANCHOR).contentState.pumpkinGrowth === 100,
    '88 + 12 = 100 → 储存南瓜 ×1，成长值封顶');
  enterTile(ANCHOR);
  check(at(ANCHOR).contentId === null && count('item_pumpkin') === 1, '进入取走南瓜，南瓜田块消失', at(ANCHOR).contentId);
}

// ════════════════════════════════════════════════════════════
head('11. 背包 / 出货箱按展示词条分堆，搬移保留词条');
{
  reset();
  InventorySystem.addItem(gs, 'item_lavender', 2);
  InventorySystem.addItem(gs, 'item_lavender', 1, { tags: ['湛蓝', '违禁品'] });
  const stacks = gs.inventory.items.filter((e) => e.itemId === 'item_lavender');
  check(stacks.length === 2, '普通堆与【湛蓝】堆分开', stacks.length);
  const ok = InventorySystem.moveItemBetween(gs, 'items', 'outbox', 'item_lavender', 1, '湛蓝|违禁品');
  const outEntry = gs.inventory.outbox.find((e) => e.itemId === 'item_lavender');
  check(ok && outEntry && Array.isArray(outEntry.tags), '搬入出货箱保留展示词条', outEntry);
  const leftNormal = gs.inventory.items.find((e) => e.itemId === 'item_lavender' && !e.tags);
  check(leftNormal && leftNormal.qty === 2, '普通堆不受影响', leftNormal);
}

// ════════════════════════════════════════════════════════════
head('12. 初级肥料：对有日初效果的新田块结算 2 次');
{
  reset();
  put(ANCHOR, 'facility_hops');
  InventorySystem.addItem(gs, 'item_fertilizer', 1);
  const r = useItem(gs, 'item_fertilizer', { tileIdx: ANCHOR });
  check(r && r.ok !== false, '啤酒花田块可作为肥料目标', r);
  check(at(ANCHOR).contentState.hopsStored === 2, '施肥结算 2 次 → 储存 2', at(ANCHOR).contentState.hopsStored);
}

// ════════════════════════════════════════════════════════════
head('13. 初级肥料：按【每一日开始时】词条判定，不维护名单');
{
  reset();
  InventorySystem.addItem(gs, 'item_fertilizer', 6);

  check(hasDailyStartTrait('facility_sunflower') && hasDailyStartTrait('facility_starfruit'),
    '向日葵 / 杨桃（日初涨成长值）具有日初特性');
  check(!hasDailyStartTrait('facility_pumpkin') && !hasDailyStartTrait('facility_lavender')
    && !hasDailyStartTrait('facility_sorrel'), '南瓜 / 薰衣草 / 酢浆草不具有日初特性');

  // 向日葵：日初授予邻格【产出时】，施肥后当次生效
  const nb = neighborRefs8(gs, ANCHOR)[0];
  put(ANCHOR, 'facility_sunflower');
  put(nb, 'facility_hops', 'terrain_grass');
  const rSun = useItem(gs, 'item_fertilizer', { tileIdx: ANCHOR });
  check(rSun && rSun.ok !== false, '向日葵可作为肥料目标', rSun);
  check(at(nb).contentState.produceBonusDay === gs.day, '向日葵日初被重复结算 → 邻格获得【产出时】', at(nb).contentState);

  // 杨桃：每次日初 +8 成长值，施肥 2 次 = 16
  put(ANCHOR, 'facility_starfruit');
  useItem(gs, 'item_fertilizer', { tileIdx: ANCHOR });
  check(at(ANCHOR).contentState.starfruitGrowth === 16, '杨桃施肥结算 2 次 → 成长值 16', at(ANCHOR).contentState.starfruitGrowth);

  // 南瓜 / 薰衣草 / 酢浆草：不具日初特性，使用后不产生任何日初效果
  put(ANCHOR, 'facility_pumpkin');
  const goldBefore = gs.player.gold;
  const rPump = useItem(gs, 'item_fertilizer', { tileIdx: ANCHOR });
  check(rPump && rPump.ok !== false, '肥料对南瓜仍照常消耗', rPump);
  check(!at(ANCHOR).contentState.pumpkinGrowth, '南瓜成长值不受肥料影响', at(ANCHOR).contentState);

  put(ANCHOR, 'facility_lavender');
  useItem(gs, 'item_fertilizer', { tileIdx: ANCHOR });
  check(gs.player.gold === goldBefore, '薰衣草不因肥料产出金币', gs.player.gold - goldBefore);

  put(ANCHOR, 'facility_sorrel');
  const sorrelState = JSON.stringify(at(ANCHOR).contentState);
  useItem(gs, 'item_fertilizer', { tileIdx: ANCHOR });
  check(JSON.stringify(at(ANCHOR).contentState) === sorrelState, '酢浆草不因肥料产生日初结算');
}

// ════════════════════════════════════════════════════════════
head('14. 【压制】禁用日初波动等一切地块特性（不做例外）');
{
  reset();
  // 郁金香：被压制当日不波动
  put(ANCHOR, 'facility_tulip');
  at(ANCHOR).contentState.tulipValue = 50;
  at(ANCHOR).contentState.suppressUntilDay = gs.day;
  dayStart();
  check(at(ANCHOR).contentState.tulipValue === 50, '被压制的郁金香日初不波动', at(ANCHOR).contentState.tulipValue);

  // 解除压制后恢复波动
  at(ANCHOR).contentState.suppressUntilDay = null;
  const origRandom = Math.random;
  Math.random = () => 0.999;
  dayStart();
  Math.random = origRandom;
  check(at(ANCHOR).contentState.tulipValue !== 50, '解除压制后郁金香日初恢复波动', at(ANCHOR).contentState.tulipValue);

  // 幽怜草：被压制当日不枯萎
  put(ANCHOR, 'facility_ghost_grass');
  at(ANCHOR).contentState.ghostStored = true;
  at(ANCHOR).contentState.ghostBlessedToday = false;
  at(ANCHOR).contentState.suppressUntilDay = gs.day;
  dayStart();
  check(at(ANCHOR).contentId === 'facility_ghost_grass', '被压制的幽怜草当日不枯萎', at(ANCHOR).contentId);
}

// ════════════════════════════════════════════════════════════
head('15. 随机池补向日葵 / 野生种子放置即抽池 / 艾草新特性');
{
  reset();
  // A2：createEl 必须支持 disabled（否则「草莓未满 5 个时取走按钮不可点」形同虚设）
  const btn = createEl('button', { text: '取走', disabled: true });
  check(btn.disabled === true, 'createEl 传入 disabled 时按钮真正禁用（A2）');

  // A5：向日葵补进 POOL-01
  check(POOLS['POOL-01'].entries.some((e) => e.id === 'facility_sunflower'),
    '田块池1（POOL-01）包含向日葵花田');

  // A5：野生种子放下后立即消失，并调用随机池抽一个田块放置到该格
  gs.inventory.items = [];
  InventorySystem.addItem(gs, 'facility_wild_seed', 1);
  const before = count('facility_wild_seed');
  const r = placeContent(gs, ANCHOR, 'facility_wild_seed');
  check(r?.ok !== false && count('facility_wild_seed') === before - 1,
    '放置野生种子消耗 1 个种子', { before, after: count('facility_wild_seed'), r });
  check(at(ANCHOR).contentId && at(ANCHOR).contentId !== 'facility_wild_seed',
    '野生种子立即被随机田块替换', at(ANCHOR).contentId);

  // A6：艾草——回血获得艾草，每回合限 2 次；回合开始重置
  reset();
  put(ANCHOR, 'facility_mugwort');
  HookDispatcher.fire('onTurnStart', { gs });
  gs.inventory.items = [];
  gs.player.hp = Math.max(1, gs.player.maxHp - 20);
  HookDispatcher.fire('onHeal', { gs, amount: 1 });
  HookDispatcher.fire('onHeal', { gs, amount: 1 });
  HookDispatcher.fire('onHeal', { gs, amount: 1 });
  check(count('item_mugwort') === 2, '同回合回血 3 次 → 最多获得 2 个艾草', count('item_mugwort'));
  HookDispatcher.fire('onTurnStart', { gs });
  HookDispatcher.fire('onHeal', { gs, amount: 1 });
  check(count('item_mugwort') === 3, '新回合开始后计数重置（再获得 1 个）', count('item_mugwort'));

  // A6：旧的「每日开始 +2」已删除；受祝福回复 25% 生命
  reset();
  put(ANCHOR, 'facility_mugwort');
  gs.inventory.items = [];
  dayStart();
  check(count('item_mugwort') === 0, '日初不再凭空获得艾草（旧 +2 已删）', count('item_mugwort'));
  gs.player.hp = Math.max(1, Math.floor(gs.player.maxHp / 2));
  const hpBefore = gs.player.hp;
  blessTile(ANCHOR);
  const expectHeal = Math.max(1, Math.round(gs.player.maxHp * 0.25));
  check(gs.player.hp >= hpBefore && gs.player.hp - hpBefore >= Math.min(expectHeal, gs.player.maxHp - hpBefore),
    '受祝福回复 25% 生命', { hpBefore, hp: gs.player.hp, maxHp: gs.player.maxHp });

  // ── B / D：特性着色与来源（描述全部按特性行渲染，不再有非特性白名单）──
  reset();
  const hopRows = fieldContentRows(gs, 'facility_hops', { suppressed: true });
  check(hopRows.every((r) => r.kind === 'trait'),
    '啤酒花描述全部按特性行渲染（含浇水说明）');
  check(hopRows.every((r) => r.suppressed),
    '压制：啤酒花全部特性行（含浇水说明）标记封禁');
  const hopWater = hopRows.find((r) => r.text.includes('需要浇水'));
  check(hopWater && hopWater.rarity === 1 && hopWater.kind === 'trait',
    '浇水说明：原生原色特性行', hopWater);
  const codexRows = fieldContentRows(null, 'facility_hops', { codex: true, suppressed: true });
  check(codexRows.every((r) => !r.suppressed && r.rarity === 1 && r.kind === 'trait'),
    '图鉴：只显示原始特性、原色、永不封禁');

  // 蘑菇：非水面正常特性；水面时「其余所有特性失效」→ 除规则行外按封禁样式
  reset();
  put(ANCHOR, 'facility_mushroom', 'terrain_grass');
  const mushDry = fieldContentRows(gs, 'facility_mushroom', { ref: ANCHOR });
  check(mushDry.every((r) => r.kind === 'trait' && !r.suppressed),
    '蘑菇（非水面）：全部按正常特性行渲染');
  at(ANCHOR).terrain = 'terrain_water';
  const mushWet = fieldContentRows(gs, 'facility_mushroom', { ref: ANCHOR });
  const mushRule = mushWet.find((r) => r.text.includes('所在地块地形为水面时'));
  const mushOthers = mushWet.filter((r) => r !== mushRule);
  check(!!mushRule && mushRule.kind === 'trait' && !mushRule.suppressed,
    '「其余所有特性失效」规则行本身不划掉', mushRule);
  check(mushOthers.length > 0 && mushOthers.every((r) => r.kind === 'trait' && r.suppressed),
    '蘑菇（水面）：其余特性整条封禁（红底 + 删除线）', mushOthers);
  check(mushRule?.text === '蘑菇田块所在地块地形为水面时，其余所有特性失效',
    '蘑菇水面文案与物品库一致', mushRule?.text);
  const mushCodex = fieldContentRows(null, 'facility_mushroom', { codex: true });
  check(mushCodex.every((r) => !r.suppressed),
    '蘑菇图鉴：永不显示封禁');
  const withTemp = fieldContentRows(gs, 'facility_lavender', {
    suppressed: true,
    extraTraits: [{ text: '向日葵临时特性', rarity: 3 }],
  });
  const tempRow = withTemp.find((r) => r.text === '向日葵临时特性');
  check(tempRow && tempRow.rarity === 3 && tempRow.suppressed,
    '向日葵给予的临时特性：R3 蓝，被压制时同样变红');

  // 仓廪实：水稻共享小麦魔导书特性（金色 R5），小麦取原书 R4
  // 黄金浪是「条件发放」：只有真实处于 ≥3 相连簇内的田块才发放这条特性，
  // 描述本身不得包含条件；背包（无位置）不显示。
  reset();
  put(0, 'facility_wheat');
  put(1, 'facility_wheat');
  put(2, 'facility_wheat');
  put(3, 'facility_rice');
  gs.inventory.items = [];
  InventorySystem.addItem(gs, 'grimoire_granary_full', 1);
  InventorySystem.addItem(gs, 'grimoire_golden_wave', 1);
  InventorySystem.addItem(gs, 'grimoire_grain_full', 1);
  const riceGold = fieldContentRows(gs, 'facility_rice', { ref: 3 }).find((r) => r.text.includes('【经过时】'));
  const wheatGold = fieldContentRows(gs, 'facility_wheat', { ref: 0 }).find((r) => r.text.includes('【经过时】'));
  check(riceGold?.rarity === 5 && wheatGold?.rarity === 4,
    '仓廪实：水稻共享【黄金浪】为金（5），小麦原书为紫（4）', { riceGold, wheatGold });
  check(wheatGold && wheatGold.text === '【经过时】获得小麦 ×1',
    '黄金浪特性描述只写效果，不带「至少 3 个田块相连」条件', wheatGold?.text);
  const bagGold = fieldContentRows(gs, 'facility_wheat').find((r) => r.text.includes('【经过时】'));
  check(!bagGold, '背包无位置：不发放黄金浪特性（条件不满足）', bagGold);
  const isolatedGold = fieldContentRows(gs, 'facility_wheat', { ref: 999 }).find((r) => r.text.includes('【经过时】'));
  check(!isolatedGold, '不在 ≥3 相连簇内的田块：不发放黄金浪特性', isolatedGold);

  // 郁金香两本魔导书：修改同一条波动特性的数值与节点 → 只显示一条合并特性
  InventorySystem.addItem(gs, 'grimoire_bubble', 1);
  InventorySystem.addItem(gs, 'grimoire_tulip_simple', 1);
  const tulipRows = fieldContentRows(gs, 'facility_tulip').filter((r) => r.text.includes('价值随机'));
  check(tulipRows.length === 1 && tulipRows[0].text === '【每回合开始时】价值随机 -9~+18',
    '郁金香两书同持：合并为一条【每回合开始时】-9~+18', tulipRows);
  check(tulipRows[0]?.rarity === 3, '合并特性底色取最高 R3', tulipRows[0]);
  const blessRow = fieldContentRows(gs, 'facility_tulip').find((r) => r.text.includes('【受祝福时】'));
  check(blessRow?.text.includes('【受祝福时】立即使价值波动 2 次') && !blessRow?.text.includes('触发 2 次'),
    '祝福描述取自物品库原文：立即使价值波动 2 次', blessRow);
  const bubblePassive = fieldContentRows(gs, 'facility_tulip').filter((r) => r.text.startsWith('价值可以为负'));
  check(bubblePassive.length === 1, '泡沫后三段合并为一条常态特性', bubblePassive);
}

// ════════════════════════════════════════════════════════════
head('16. 储存类与【产出时】：先产出再落地；满储不再产出');
{
  const setupBlueNextToSunflower = () => {
    reset();
    put(ANCHOR, 'facility_sunflower');
    const blue = neighborRefs(gs, ANCHOR)[0];
    put(blue, 'facility_blue_star_fruit');
    Random.pick = (arr) => arr[0];
    gs.inventory.items = [];
    return blue;
  };

  // A. 空储存：基础 1 + 【产出时】1；10% 未命中
  let blue = setupBlueNextToSunflower();
  Random.chance = () => false;
  dayStart();
  check(at(blue).contentState.produceBonusDay === gs.day, '向日葵日初授予蓝星果田块 1 条【产出时】',
    at(blue).contentState.produceBonusDay);
  check(at(blue).contentState.blueStored === 2, '未命中 10%：蓝星果产量 2（基础 1 + 产出时 1），储存 0→2',
    at(blue).contentState.blueStored);
  check(count('item_sunflower') === 0, '未命中 10%：递归不产出向日葵', count('item_sunflower'));
  // 取走储存物只是搬运：不算产出、不触发【产出时】/10%
  Random.chance = () => true;
  takeStoredToBag(gs, blue, 'item_blue_starfruit', 2);
  check(count('item_sunflower') === 0, '取走储存物不触发【产出时】：不会凭空掷出向日葵', count('item_sunflower'));

  // B. 10% 命中一次：递归产出向日葵
  blue = setupBlueNextToSunflower();
  let rolls = 0;
  Random.chance = () => (rolls++ === 0); // 第一次命中、递归里再掷时未命中
  dayStart();
  check(at(blue).contentState.blueStored === 2, '命中 10%：蓝星果储存仍为 2', at(blue).contentState.blueStored);
  check(count('item_sunflower') === 2, '命中 10%：递归产出向日葵 2（基础 1 + 产出时 1）', count('item_sunflower'));
  check(rolls === 2, '10% 只在 +1 落地后掷 1 次；递归事件本身再掷 1 次', rolls);

  // C. 储存已满 7/7：不产出、不 +1、不掷概率
  blue = setupBlueNextToSunflower();
  at(blue).contentState.blueStored = 7;
  rolls = 0;
  Random.chance = () => { rolls += 1; return true; };
  dayStart();
  check(at(blue).contentState.produceBonusDay === gs.day, '满储仍会获得【产出时】（满 ≠ 特性失效）',
    at(blue).contentState.produceBonusDay);
  check(at(blue).contentState.blueStored === 7, '满储 7/7：日初不再产出，储存不变', at(blue).contentState.blueStored);
  check(count('item_sunflower') === 0 && rolls === 0, '满储：不触发【产出时】、10% 一次都没掷',
    { rolls, sun: count('item_sunflower') });

  // D. 啤酒花满储：邻水 +2 与【产出时】+1 都不落地，10% 不掷
  reset();
  put(ANCHOR, 'facility_hops');
  const waterRef = neighborRefs(gs, ANCHOR)[0];
  at(waterRef).terrain = 'terrain_water';
  at(waterRef).contentId = null;
  at(ANCHOR).contentState.hopsStored = 18;
  grantProduceBonus(at(ANCHOR), gs.day);
  rolls = 0;
  Random.chance = () => { rolls += 1; return true; };
  dayStart();
  dayEnd();
  check(at(ANCHOR).contentState.hopsStored === 18, '啤酒花满储 18/18：日初/日末都不再产出',
    at(ANCHOR).contentState.hopsStored);
  check(rolls === 0, '啤酒花满储：邻水 +2 / 产出时 +1 均不落地，10% 不掷', rolls);
}

// ════════════════════════════════════════════════════════════
head('N. 放置型道具归属地块：内容拆除/替换保留；扩建随地块重映射；旧档迁移');
{
  reset();
  put(ANCHOR, 'facility_strawberry');
  InventorySystem.addItem(gs, 'item_trap', 1);
  InventorySystem.addItem(gs, 'item_incense', 1);
  check(useItem(gs, 'item_trap', { tileIdx: ANCHOR }).ok, '陷阱放置成功');
  check(useItem(gs, 'item_incense', { tileIdx: ANCHOR }).ok, '艾草熏香放置成功');
  check((at(ANCHOR).placedItems || []).length === 2, '两种放置型道具可共存于同一地块');

  // 替换地块内容：不消失
  InventorySystem.addItem(gs, 'facility_lavender', 1);
  placeContent(gs, ANCHOR, 'facility_lavender');
  check(at(ANCHOR).contentId === 'facility_lavender' && (at(ANCHOR).placedItems || []).length === 2,
    '替换地块内容后放置型道具不消失');
  // 拆除地块内容：不消失
  gs.buildMode = true;
  const cleared = clearContent(gs, ANCHOR);
  gs.buildMode = false;
  check(cleared.ok && !at(ANCHOR).contentId && (at(ANCHOR).placedItems || []).length === 2,
    '拆除地块内容后放置型道具不消失', cleared);

  // 扩建：随地块一起重映射（右列整体右移）
  const { x: x0, y: y0 } = refXY(gs, ANCHOR);
  const oldCols = gs.map.cols;
  expandMapInPlace(gs, EXPAND_AXIS.LENGTH);
  const moved = gs.map.outerTiles.find((t) => (t.placedItems || []).length === 2);
  const { x: x1, y: y1 } = moved ? refXY(gs, moved.idx) : { x: NaN, y: NaN };
  check(moved && x1 === (x0 === oldCols - 1 ? x0 + 1 : x0) && y1 === y0,
    '扩建后放置型道具不消失，且随地块按规则重映射', { before: [x0, y0], after: [x1, y1] });

  // 取走型特性受【压制】：土豆田块被压制时不能取走
  reset();
  put(ANCHOR, 'facility_potato');
  at(ANCHOR).contentState = { potatoStored: 5 };
  check(harvestPotato(gs, ANCHOR, 5).actual === 5, '土豆未压制：可正常收获');
  at(ANCHOR).contentState.potatoStored = 5;
  at(ANCHOR).contentState.suppressUntilDay = gs.day + 1;
  check(harvestPotato(gs, ANCHOR, 5).actual === 0, '土豆被压制：即使有储存也不能取走');

  // 旧档迁移：contentState.placedItems → tile.placedItems
  reset();
  const legacy = JSON.parse(JSON.stringify(gs));
  const lt = legacy.map.outerTiles[ANCHOR];
  lt.contentState = { placedItems: [{ itemId: 'item_trap', placedDay: 1 }] };
  delete lt.placedItems;
  const migrated = migrateGS(legacy);
  check((migrated.map.outerTiles[ANCHOR].placedItems || []).some((p) => p.itemId === 'item_trap')
    && !(migrated.map.outerTiles[ANCHOR].contentState?.placedItems),
    '旧存档迁移：contentState.placedItems 并入 tile.placedItems');
}

// ════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-new-fields 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
