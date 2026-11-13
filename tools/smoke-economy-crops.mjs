// tools/smoke-economy-crops.mjs —— 经济与田块冒烟（本次六项任务）
//
// 覆盖：
//   1) 通用规则：拆除 / 替换「储存类 / 采摘类」田块前自动采摘
//   2) 郁金香价值：内部真实值 / 显示夹 0 / 结算夹 0（仅《泡沫》允许负结算）
//   3) 金币区间 [-999999, 999999]：所有入口夹取、允许负债、负金币下不产生反直觉加钱
//   4) 地形可出售：价值统一 1、价格与价值分离、商店地形货架预留为空
//   5) 普通商店不售卖技能（魔法商店技能直售保留）
//   6) 初始金币：正式版 0，测试可用 createInitialState({ gold }) 覆盖
//
// 用法：node tools/smoke-economy-crops.mjs

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

import { createInitialState } from '../src/state/gameState.js';
import { migrateGS } from '../src/state/migrate.js';
import * as BuildSystem from '../src/systems/BuildSystem.js';
import * as InventorySystem from '../src/systems/InventorySystem.js';
import * as TulipSystem from '../src/systems/TulipSystem.js';
import * as ShopSystem from '../src/systems/ShopSystem.js';
import { applyEventEffects } from '../src/systems/EventEffects.js';
import { applyDeathPenalty } from '../src/systems/CombatSystem.js';
import { AUTO_HARVEST_ON_REMOVE, harvestCropBeforeRemove } from '../src/systems/CropHarvest.js';
import { addGold, getGold, setGold, GOLD_MIN, GOLD_MAX } from '../src/systems/GoldSystem.js';
import { INITIAL_GOLD, TERRAIN_VALUE } from '../src/utils/constants.js';
import { ITEMS } from '../src/data/items.js';
import { TERRAINS } from '../src/data/terrains.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

const gs = createInitialState();
gs.buildMode = true;
const HOME_IDX = gs.map.outerTiles.findIndex((t) => t.contentId === 'facility_home');
const tile = (i) => gs.map.outerTiles[i];

function reset() {
  gs.inventory.items = [];
  gs.inventory.outbox = [];
  for (const t of gs.map.outerTiles) {
    t.contentId = t.idx === HOME_IDX ? 'facility_home' : null;
    t.contentState = {};
    t.dailyFlags = {};
  }
  gs.player.gold = 0;
  gs.flags = {};
  gs.creatures = [];
}
const put = (i, id, state = {}) => { tile(i).contentId = id; tile(i).contentState = { ...state }; };
const give = (id, qty = 1) => InventorySystem.addItem(gs, id, qty);

// ════════════════════════════════════════════════════════════
head('1. 拆除 / 替换前自动采摘（通用规则）');
{
  reset();
  check(AUTO_HARVEST_ON_REMOVE.size === 6, '自动采摘集合 = 6 种田块',
    [...AUTO_HARVEST_ON_REMOVE]);
  check(['facility_potato', 'facility_strawberry', 'facility_pea', 'facility_tulip',
    'facility_dandelion', 'facility_ghost_grass'].every((id) => AUTO_HARVEST_ON_REMOVE.has(id)),
  '土豆 / 草莓 / 豌豆 / 郁金香 / 蒲公英 / 幽怜草 均覆盖');

  // 土豆：拆除时把本块存量带回背包
  put(0, 'facility_potato', { potatoStored: 7 });
  BuildSystem.clearContent(gs, 0);
  check(InventorySystem.countItem(gs, 'item_potato') === 7, '拆除土豆田 → 自动收获 7 个土豆',
    InventorySystem.countItem(gs, 'item_potato'));
  check(tile(0).contentId === null, '土豆田拆除后地块为空');

  // 土豆：未积累存量 → 不产出
  reset();
  put(0, 'facility_potato', { potatoStored: 0 });
  BuildSystem.clearContent(gs, 0);
  check(InventorySystem.countItem(gs, 'item_potato') === 0, '未积累存量的土豆田拆除不产出');

  // 草莓 / 豌豆
  reset();
  put(0, 'facility_strawberry', { strawberryStored: 3 });
  BuildSystem.clearContent(gs, 0);
  check(InventorySystem.countItem(gs, 'item_strawberry') === 3, '拆除草莓田 → 自动收获 3 个草莓');
  put(1, 'facility_pea', { peaStored: 4 });
  BuildSystem.clearContent(gs, 1);
  check(InventorySystem.countItem(gs, 'item_pea') === 4, '拆除豌豆田 → 自动收获 4 个豌豆');

  // 郁金香：正价值写出对应 value
  reset();
  put(0, 'facility_tulip', { tulipValue: 12, tulipStacks: 0, tulipInit: true });
  BuildSystem.clearContent(gs, 0);
  const tulipEntry = gs.inventory.items.find((e) => e.itemId === 'item_tulip');
  check(tulipEntry?.qty === 1 && tulipEntry?.value === 12, '拆除郁金香 → 自动采摘价值 12',
    tulipEntry);

  // 蒲公英 / 幽怜草
  reset();
  put(0, 'facility_dandelion', { dandelionValue: 5 });
  BuildSystem.clearContent(gs, 0);
  const dand = gs.inventory.items.find((e) => e.itemId === 'item_dandelion');
  check(dand?.value === 5, '拆除蒲公英 → 自动采摘价值 5', dand);
  put(1, 'facility_ghost_grass', { ghostStored: true, ghostValue: 9 });
  BuildSystem.clearContent(gs, 1);
  const ghost = gs.inventory.items.find((e) => e.itemId === 'item_ghost_grass');
  check(ghost?.value === 9, '拆除幽怜草 → 自动采摘价值 9', ghost);

  // 替换（placeContent）= 先拆后放，同样自动采摘旧内容
  reset();
  put(0, 'facility_strawberry', { strawberryStored: 2 });
  give('facility_potato');
  const repl = BuildSystem.placeContent(gs, 0, 'facility_potato');
  check(repl.ok && tile(0).contentId === 'facility_potato', '替换成功', repl);
  check(InventorySystem.countItem(gs, 'item_strawberry') === 2, '替换旧草莓田前自动采摘 2 个草莓');

  // 非储存类田块：田里没有存量，不产生任何掉落
  for (const id of ['facility_wheat', 'facility_rice', 'facility_corn', 'facility_cabbage', 'facility_mugwort']) {
    reset();
    put(0, id);
    const before = gs.inventory.items.length;
    BuildSystem.clearContent(gs, 0);
    check(gs.inventory.items.length === before, `${id} 拆除不产生物品（产出直接进背包，田内无存量）`);
  }

  // 鸡舍 / 史莱姆屋：属于设施而非田块，蛋/黏液按 §10.4 随设施消失
  reset();
  put(0, 'facility_henhouse', { eggStored: true, eggStoredGolden: true });
  BuildSystem.clearContent(gs, 0);
  check(InventorySystem.countItem(gs, 'item_egg') === 0, '鸡舍拆除不自动收蛋（设施产出随设施消失）');
}

// ════════════════════════════════════════════════════════════
head('2. 郁金香：内部真实值 / 显示夹 0 / 结算夹 0');
{
  check(TulipSystem.TULIP_FORCE_REMOVE_THRESHOLD === -100, '强制拆除阈值 -100');

  // ×1.5 判定读真实值（不是显示值）
  check(TulipSystem.settleTulipValue(60) === 90, '真实值 60 → 结算 90（读真实值）');
  check(TulipSystem.settleTulipValue(-60) === -90, '真实值 -60 → 结算 -90（读真实值）');

  // 显示：无《泡沫》夹 0；有《泡沫》显示真实负值
  reset();
  put(0, 'facility_tulip', { tulipValue: -37, tulipStacks: 0, tulipInit: true });
  check(TulipSystem.tulipDisplayValue(gs, tile(0)) === 0, '无《泡沫》：内部 -37 显示 0');
  check(TulipSystem.tulipValue(tile(0)) === -37, '内部价值保持 -37（不被显示逻辑改写）');
  give(TulipSystem.GRIMOIRE_BUBBLE);
  check(TulipSystem.tulipDisplayValue(gs, tile(0)) === -37, '有《泡沫》：显示真实值 -37');

  // 结算：无《泡沫》按 0；有《泡沫》按真实负值
  check(TulipSystem.tulipSettleValue(gs, tile(0)) === -37, '有《泡沫》结算 -37（|v|≤50 不放大）');
  gs.inventory.items = gs.inventory.items.filter((e) => e.itemId !== TulipSystem.GRIMOIRE_BUBBLE);
  check(TulipSystem.tulipSettleValue(gs, tile(0)) === 0, '无《泡沫》结算 0');

  // 强制拆除读真实值：显示 0 但 -101 仍会触发
  reset();
  put(0, 'facility_tulip', { tulipValue: -101, tulipStacks: 0, tulipInit: true });
  check(TulipSystem.tulipDisplayValue(gs, tile(0)) === 0, '内部 -101 显示 0');
  check(TulipSystem.maybeForceRemoveTulip(gs, tile(0)) === true, '内部 -101 仍触发强制拆除（读真实值）');

  // 无《泡沫》时负价值拆除：不扣金币、产出 0 价值花
  reset();
  put(0, 'facility_tulip', { tulipValue: -30, tulipStacks: 0, tulipInit: true });
  gs.player.gold = 10;
  BuildSystem.clearContent(gs, 0);
  check(gs.player.gold === 10, '无《泡沫》负价值拆除不扣金币', gs.player.gold);
  const t = gs.inventory.items.find((e) => e.itemId === 'item_tulip');
  check(t?.value === 0, '无《泡沫》负价值拆除产出价值 0 的郁金香', t);
}

// ════════════════════════════════════════════════════════════
head('3. 金币区间 [-999999, 999999]（含端点）');
{
  reset();
  addGold(gs, 1e9, 'test');
  check(gs.player.gold === GOLD_MAX, '上溢夹到 999999', gs.player.gold);
  addGold(gs, -1e9, 'test');
  check(gs.player.gold === GOLD_MIN, '下溢夹到 -999999', gs.player.gold);
  setGold(gs, GOLD_MAX + 500);
  check(gs.player.gold === GOLD_MAX, 'setGold 越界同样夹取');
  check(getGold({ player: { gold: GOLD_MIN - 1 } }) === GOLD_MIN, '读取越界值也夹取');

  // 负金币下事件扣款不能反向加钱（旧实现 -(gold) 的 bug）
  reset();
  gs.player.gold = -50;
  applyEventEffects(gs, [{ type: 'gold', amount: -10 }]);
  check(gs.player.gold === -50, '负金币时事件扣款最多扣到 0，不会反向加钱', gs.player.gold);

  // 负金币死亡惩罚不额外扣
  reset();
  gs.player.gold = -20;
  applyDeathPenalty(gs, gs.player);
  check(gs.player.gold === -20, '负金币时死亡惩罚按 0 处理', gs.player.gold);

  // 商店卖出夹取
  reset();
  give('item_potato', 1);
  setGold(gs, GOLD_MAX);
  ShopSystem.sell(gs, 'item_potato', { qty: 1 });
  check(gs.player.gold === GOLD_MAX, '满额金币卖出不越界', gs.player.gold);

  // 读档夹取
  const loaded = createInitialState();
  loaded.player.gold = GOLD_MAX + 12345;
  migrateGS(loaded);
  check(loaded.player.gold === GOLD_MAX, '读档时越界金币被夹取', loaded.player.gold);
}

// ════════════════════════════════════════════════════════════
head('4. 地形可出售：价值 1 / 价格分离 / 货架预留');
{
  const terrainIds = Object.keys(TERRAINS);
  check(terrainIds.length > 0, `地形数量 ${terrainIds.length}`);
  check(terrainIds.every((id) => ITEMS[id]?.value === TERRAIN_VALUE),
    '所有地形价值统一为 1', terrainIds.map((id) => [id, ITEMS[id]?.value]));
  check(terrainIds.every((id) => ShopSystem.isSellable(id)), '所有地形均可出售');

  reset();
  give('terrain_grass', 2);
  gs.player.gold = 0;
  const r = ShopSystem.sell(gs, 'terrain_grass', { qty: 1 });
  check(r.ok && r.total === TERRAIN_VALUE, '卖出 1 块草地 → 1 金币', r);
  check(gs.player.gold === 1 && InventorySystem.countItem(gs, 'terrain_grass') === 1,
    '金币 +1、背包 -1', [gs.player.gold, InventorySystem.countItem(gs, 'terrain_grass')]);

  check(Array.isArray(ShopSystem.SHOP_TERRAINS) && ShopSystem.SHOP_TERRAINS.length === 0,
    '商店地形货架预留为空（暂不上架）');
  check(!ShopSystem.SHOP_KINDS.shop.groups.some((g) => g.pool === 'SHOP_TERRAIN'),
    '普通商店当前没有地形货架分组');
}

// ════════════════════════════════════════════════════════════
head('5. 普通商店不售卖技能；魔法商店技能直售保留');
{
  let shopSkill = 0;
  let magicSkill = 0;
  for (let i = 0; i < 200; i++) {
    for (const it of ShopSystem.generateStock('shop')) {
      if (ITEMS[it.id]?.tier2 === '技能') shopSkill += 1;
    }
    for (const it of ShopSystem.generateStock('magic')) {
      if (ITEMS[it.id]?.tier2 === '技能') magicSkill += 1;
    }
  }
  check(shopSkill === 0, '普通商店 200 次生成 0 件技能商品', shopSkill);
  check(magicSkill > 0, '魔法商店仍会生成技能商品', magicSkill);
  check(!ShopSystem.SHOP_KINDS.shop.groups.some((g) => g.pool === 'SHOP_SKILL'),
    '普通商店配置里不存在技能货架');
  check(ShopSystem.SHOP_KINDS.magic.groups.some((g) => g.pool === 'SHOP_SKILL'),
    '魔法商店保留 SHOP_SKILL 技能护架');
}

// ════════════════════════════════════════════════════════════
head('6. 初始金币可配置（正式 0）');
{
  check(INITIAL_GOLD === 0, 'INITIAL_GOLD = 0');
  check(createInitialState().player.gold === 0, '默认初始金币 0');
  check(createInitialState({ gold: 500 }).player.gold === 500, '测试覆盖 { gold: 500 } 生效');
  check(createInitialState({ gold: GOLD_MAX + 1 }).player.gold === GOLD_MAX, '覆盖值也会夹取');
}

// ════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-economy-crops 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
