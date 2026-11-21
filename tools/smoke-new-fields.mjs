// tools/smoke-new-fields.mjs —— v0.6 田块大更新专项冒烟
//
// 覆盖：
//   1) 水稻：水面 3 / 草地 1；祝福 5 日每日 +1；压制当日 0
//   2) 薰衣草：经过 +1 金币，20% 概率 +1 薰衣草
//   3) 向日葵：日初随机 1 格获得【产出时】+1；受祝福给全部 8 邻格
//   4) 黑莓：日初压制周围 8 格田块；受祝福清除并进入 4 天解除期
//   5) 酢浆草：经过自压制 → 当日日末不产出
//   6) 啤酒花：日初/日末各储存 1（上限 18）；相邻水面激活【产出时】+2；经过自动取走
//   7) 蘑菇：水面失效；日初储存 2；满 6 后向相邻空地扩散
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
import { getTile, neighborRefs8, neighborRefs } from '../src/core/TileAccess.js';
import * as InventorySystem from '../src/systems/InventorySystem.js';
import { initPassiveItems } from '../src/systems/PassiveItemSystem.js';
import { FieldAuraSystem } from '../src/systems/FieldAuraSystem.js';
import { isSuppressed, releaseBlackberry } from '../src/systems/SuppressSystem.js';
import {
  blueRadiusFor, isInBlueBreath, syncBlueBreath,
} from '../src/systems/BlueBreathSystem.js';
import { produce } from '../src/systems/ProduceSystem.js';
import { hasProduceBonus, hasAdjacentWater, grantProduceBonus } from '../src/systems/ProduceSystem.js';
import { useItem, hasDailyStartTrait } from '../src/systems/UseItemSystem.js';

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
  }
  gs.player.maxHp = BASE_HP;
  gs.player.atk = BASE_ATK;
  gs.player.hp = BASE_HP;
  gs.player.x = 0;
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
head('6. 啤酒花：日初/日末储存；相邻水面激活【产出时】+2；经过取走');
{
  reset();
  put(ANCHOR, 'facility_hops');
  const waterRef = neighborRefs(gs, ANCHOR)[0];
  at(waterRef).terrain = 'terrain_water';
  at(waterRef).contentId = null;
  dayStart();
  dayEnd();
  check(at(ANCHOR).contentState.hopsStored === 2, '日初 +1、日末 +1 = 2', at(ANCHOR).contentState.hopsStored);
  check(hasAdjacentWater(gs, ANCHOR), '相邻水面：浇水门槛满足');
  grantProduceBonus(at(ANCHOR), gs.day); // 模拟向日葵授予的【产出时】
  check(hasProduceBonus(gs, ANCHOR), '浇水 + 【产出时】同时满足');
  blessTile(ANCHOR);
  check(at(ANCHOR).contentState.hopsStored === 4, '受祝福 1 + 【产出时】+1 = 储存 +2', at(ANCHOR).contentState.hopsStored);
  at(waterRef).terrain = 'terrain_grass';
  check(!hasProduceBonus(gs, ANCHOR), '移除水面后【产出时】失效');
  passTile(ANCHOR);
  check(count('item_hops') === 4 && at(ANCHOR).contentState.hopsStored === 0, '经过自动取走 4 个', count('item_hops'));
}

// ════════════════════════════════════════════════════════════
head('7. 蘑菇：水面失效；日初储存 2；满 6 后扩散');
{
  reset();
  put(ANCHOR, 'facility_mushroom', 'terrain_water');
  dayStart();
  check(at(ANCHOR).contentState.mushroomStored === undefined || at(ANCHOR).contentState.mushroomStored === 0, '水面：所有特性失效');
  at(ANCHOR).terrain = 'terrain_grass';
  dayStart();
  check(at(ANCHOR).contentState.mushroomStored === 2, '日初储存 2', at(ANCHOR).contentState.mushroomStored);
  at(ANCHOR).contentState.mushroomStored = 6;
  const empty = neighborRefs(gs, ANCHOR).find((r) => !at(r).contentId);
  if (empty !== undefined) at(empty).contentId = null;
  Random.pick = (arr) => arr[0];
  dayStart();
  const spread = neighborRefs(gs, ANCHOR).filter((r) => at(r).contentId === 'facility_mushroom').length;
  check(spread >= 1, '满 6 后向相邻空地扩散 1 个蘑菇田块', spread);
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
  check(!isInBlueBreath(gs, nb), '半径 0.6 米覆盖不到相邻格（中心距 1 米）');
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
console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-new-fields 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
