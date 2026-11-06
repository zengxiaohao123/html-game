// tools/smoke-b4.mjs —— 第 4 批冒烟：资源点交互 / 事件 / 魔法商店（Node，无 DOM）
//
// 覆盖：
//   RES-005 巴士站（行动力每日限一次 / 轮子每次进入 / 受祝福随机载具）
//   RES-003 狩猎（成功率区间 / 每日限一次 / 受祝福 +50% 上限 100% / 生物入栏）
//   RES-001 事件点 & RES-002 奖励点（每日限一次 / 懒抽取框架 / 祝福记账 / onEventResolve）
//   RES-006 魔法商店（§11.2：进入独立 / 离开本回合禁入 / 每周 3 次刷新 4/8/12 /
//                     受祝福首次刷新免费但消耗次数 / 10 货位四类区间 / 放置每日 1 场上 2）
//
// 用法：node tools/smoke-b4.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities, huntCreature } = await import('../src/data/facilities.js');
const { HookDispatcher } = await import('../src/core/HookDispatcher.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const { addItem } = await import('../src/systems/InventorySystem.js');
const { placeContent, enterBuildMode } = await import('../src/systems/BuildSystem.js');
const { startNewDay } = await import('../src/systems/DaySystem.js');
const ShopSystem = await import('../src/systems/ShopSystem.js');
const { CREATURES } = await import('../src/data/creatures.js');

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');

registerFacilities();
const gs = createInitialState();
gs.inventory.items = [];
gs.inventory.outbox = [];
gs.player.gold = 500;
gs.week = 1;

const setTile = (idx, contentId) => {
  const t = gs.map.outerTiles[idx];
  t.contentId = contentId;
  t.contentState = {};
  t.dailyFlags = {};
  return t;
};

// 捕获 onEventResolve（审计 P1-5：该 hook 此前无消费方，本批开始由资源点 fire）
const resolved = [];
HookDispatcher.register('onEventResolve', (p) => resolved.push(p));

// ════════════════════════════════════════════════════════════
head('RES-005 巴士站：行动力每日限一次，轮子每次进入都给');
// ════════════════════════════════════════════════════════════
setTile(0, 'resource_bus');
gs.player.x = 0;
gs.player.stamina = 5;
const wheelBefore = gs.vehicle.available.filter((a) => a.vehicleId === 'vehicle_wheel').length;
HookDispatcher.fire('onEnter', { gs, tileIdx: 0 });
assert(gs.player.stamina === 6, '首次进入：行动力 +1（5→6）', gs.player.stamina);
assert(
  gs.vehicle.available.filter((a) => a.vehicleId === 'vehicle_wheel').length === wheelBefore + 1,
  '首次进入：获得 1 轮子',
);
HookDispatcher.fire('onEnter', { gs, tileIdx: 0 });
assert(gs.player.stamina === 6, '同日再进入：行动力不再增加（每日限一次）', gs.player.stamina);
assert(
  gs.vehicle.available.filter((a) => a.vehicleId === 'vehicle_wheel').length === wheelBefore + 2,
  '同日再进入：轮子照给（库未标每日限次，OUT-17 限次只在行动力上）',
);

head('RES-005 巴士站：受祝福 → 随机载具（载具池 1），进载具页');
const vehBefore = gs.vehicle.available.length;
HookDispatcher.fire('onBlessed', { gs, tileIdx: 0 });
assert(gs.vehicle.available.length === vehBefore + 1, '受祝福获得 1 随机载具（进载具页手动装备）', gs.vehicle.available.length);

// ════════════════════════════════════════════════════════════
head('RES-001 事件点：每日限一次 + 懒抽取框架 + onEventResolve');
// ════════════════════════════════════════════════════════════
setTile(2, 'resource_event');
const evBefore = resolved.length;
HookDispatcher.fire('onEnter', { gs, tileIdx: 2 });
assert(resolved.length === evBefore + 1, '进入触发一次事件解析（onEventResolve）', resolved.length - evBefore);
assert(resolved[resolved.length - 1].type === 'event', '解析载荷 type=event');
assert(gs.map.outerTiles[2].dailyFlags['resource_event_onEnter'] === true, '每日限次 flag 已记录');
HookDispatcher.fire('onEnter', { gs, tileIdx: 2 });
assert(resolved.length === evBefore + 1, '同日再进入不再触发（每日限一次）');
HookDispatcher.fire('onBlessed', { gs, tileIdx: 2 });
assert(resolved.length === evBefore + 2, '受祝福 → 显示今日事件内容（再解析一次，blessed）');
assert(resolved[resolved.length - 1].blessed === true, '祝福解析载荷 blessed=true');
assert(gs.map.outerTiles[2].contentState.eventBlessed === true, 'eventBlessed 状态已记账');

// ════════════════════════════════════════════════════════════
head('RES-002 奖励点：每日限一次 + 祝福「下次高价值」记账');
// ════════════════════════════════════════════════════════════
setTile(3, 'resource_reward');
HookDispatcher.fire('onBlessed', { gs, tileIdx: 3 });
assert(gs.map.outerTiles[3].contentState.rewardBlessPending === true, '受祝福 → rewardBlessPending 记账');
const rwBefore = resolved.length;
HookDispatcher.fire('onEnter', { gs, tileIdx: 3 });
assert(resolved.length === rwBefore + 1, '进入触发一次奖励解析');
assert(resolved[resolved.length - 1].blessed === true, '本次解析携带祝福（高价值概率提升生效位）');
assert(gs.map.outerTiles[3].contentState.rewardBlessPending === false, '祝福记账已被消耗');
HookDispatcher.fire('onEnter', { gs, tileIdx: 3 });
assert(resolved.length === rwBefore + 1, '同日再进入不再触发（每日限一次）');

// ════════════════════════════════════════════════════════════
head('RES-006 魔法商店：放置限制（每日 1 / 场上 2）');
// ════════════════════════════════════════════════════════════
enterBuildMode(gs);
addItem(gs, 'resource_magic_shop', 3);
const p1 = placeContent(gs, 4, 'resource_magic_shop');
assert(p1.ok === true, '第 1 个魔法商店放置成功');
const p2 = placeContent(gs, 5, 'resource_magic_shop');
assert(p2.ok === false && p2.reason === 'dailyLimit', '同日第 2 个被拒（每日至多放置 1 个）', p2);
startNewDay(gs);
const p3 = placeContent(gs, 5, 'resource_magic_shop');
assert(p3.ok === true, '次日可再放置第 2 个');
startNewDay(gs);
const p4 = placeContent(gs, 0, 'resource_magic_shop');
assert(p4.ok === false && p4.reason === 'fieldLimit', '场上第 3 个被拒（场上总数上限 2）', p4);

// ════════════════════════════════════════════════════════════
head('RES-006 魔法商店：进入规则（§11.2 与商店一致）');
// ════════════════════════════════════════════════════════════
setTile(7, 'resource_magic_shop');
gs.player.x = 7;
let panelOpens = 0;
const onPanel = (p) => { if (p?.panel === 'magicShop') panelOpens += 1; };
EventBus.on(GE.UI_PANEL_OPEN, onPanel);
HookDispatcher.fire('onEnter', { gs, tileIdx: 7 });
HookDispatcher.fire('onEnter', { gs, tileIdx: 7 });
EventBus.off(GE.UI_PANEL_OPEN, onPanel);
// §11.2 与普通商店统一：踩格不自动打开，需在信息区功能选项点「进入魔法商店」
assert(panelOpens === 0, '踩格不再自动打开魔法商店（信息区功能选项进入）', panelOpens);

const e1 = ShopSystem.enterShop(gs, 7);
assert(e1.ok === true, 'enterShop 正常进入', e1);
ShopSystem.leaveShop(gs, 7);
const e2 = ShopSystem.enterShop(gs, 7);
assert(e2.ok === false && e2.reason === 'justLeft', '离开后本回合不可再进入', e2);
gs.turn += 1;
const e3 = ShopSystem.enterShop(gs, 7);
assert(e3.ok === true, '下一回合可再进入');

// ════════════════════════════════════════════════════════════
head('RES-006 魔法商店：刷新机制（每周 3 次 4/8/12，祝福首次免费但耗次数）');
// ════════════════════════════════════════════════════════════
const shop7 = ShopSystem.getShop(gs, 7);
assert(shop7.kind === 'magic', '魔法商店 kind=magic（与商店独立）', shop7.kind);
ShopSystem.grantFreeRefresh(gs, 7);
assert(ShopSystem.manualRefreshCost(shop7) === 0, '受祝福后：首次刷新 0 金币');
const gold0 = gs.player.gold;
const r1 = ShopSystem.refreshShop(gs, 7);
assert(r1.ok === true, '免费刷新成功', r1);
assert(gs.player.gold === gold0, '免费刷新不扣金币', gs.player.gold);
assert(shop7.refreshUsed === 1, '免费刷新仍消耗刷新次数（1/3）', shop7.refreshUsed);
assert(shop7.freeRefreshPending === 0, '免费额度已消耗');
assert(ShopSystem.manualRefreshCost(shop7) === 8, '免费刷新消耗次数后，下一次为第 2 次刷新（8 金币）');
const r2 = ShopSystem.refreshShop(gs, 7);
assert(r2.ok === true && gs.player.gold === gold0 - 8, '第 2 次刷新扣 8 金币', gs.player.gold);
shop7.refreshUsed = 3;
const r3 = ShopSystem.refreshShop(gs, 7);
assert(r3.ok === false && r3.reason === 'noRefreshLeft', '每周 3 次用尽后不可再刷新', r3);
// 跨周：用日历 tickDay 推进到 weekKey 变化（weekKey 基于 gs.calendar）
const { weekKey, tickDay } = await import('../src/systems/CalendarSystem.js');
const wk0 = weekKey(gs);
for (let i = 0; i < 8 && weekKey(gs) === wk0; i++) tickDay(gs);
assert(weekKey(gs) !== wk0, '已推进到新的一周', { wk0, now: weekKey(gs) });
const shop7b = ShopSystem.getShop(gs, 7);
assert(shop7b.refreshUsed === 0, '跨周自动重置刷新次数');

// ════════════════════════════════════════════════════════════
head('RES-006 魔法商店：货位结构（§11.2 共 10 位四类）');
// ════════════════════════════════════════════════════════════
const stock = ShopSystem.generateStock('magic');
assert(stock.length === 10, '货位共 10 个', stock.length);
const catCount = {};
for (const it of stock) catCount[it.group] = (catCount[it.group] || 0) + 1;
assert(catCount['魔导书'] >= 3 && catCount['魔导书'] <= 4, '魔导书 3~4', catCount);
assert(catCount['消耗道具'] >= 2 && catCount['消耗道具'] <= 4, '消耗品 2~4', catCount);
assert(catCount['技能石'] >= 2 && catCount['技能石'] <= 3, '技能石 2~3', catCount);
assert(catCount['载具'] >= 1 && catCount['载具'] <= 3, '载具 1~3', catCount);

head('魔法商店与商店状态独立');
setTile(5, 'resource_shop');
const shopA = ShopSystem.getShop(gs, 7);
const shopB = ShopSystem.getShop(gs, 5);
assert(shopA !== shopB && shopA.kind === 'magic' && shopB.kind === 'shop', '两店状态对象独立');
shopB.refreshUsed = 2;
assert(shopA.refreshUsed !== 2, '刷新次数互不影响');

// ════════════════════════════════════════════════════════════
head('RES-003 狩猎：成功率区间 / 每日限一次 / 受祝福 +50%');
// ════════════════════════════════════════════════════════════
setTile(1, 'resource_hunt');
// 扩充栅栏空位（初始仅 1 格，测试需要多次生成生物）
for (let i = 1; i <= 4; i++) {
  gs.map.fence.push({ row: 0, col: i, terrain: 'terrain_none', terrainAmount: 0, creatures: [], items: [] });
}
const origRandom = Math.random;

// 普通狩猎成功：Math.random=0.1 → 成功率 0.4+0.1*0.5=0.45，判定 0.1<0.45 成功
Math.random = () => 0.1;
const h1 = huntCreature(gs, 1, 'normal');
assert(h1.ok === true && h1.success === true, '普通狩猎成功', h1);
assert(h1.rate >= 0.40 && h1.rate <= 0.90, '成功率落在 40%~90% 区间', h1.rate);
assert(['chick', 'chicken'].includes(h1.kind), '普通狩猎产物为友善类生物', h1.kind);
const hunted = gs.creatures.find((c) => c.kind === h1.kind && c.facilityId === 'resource_hunt');
assert(!!hunted && hunted.category === 'friendly', '生物已入栅栏（友善类）', hunted?.category);

const h2 = huntCreature(gs, 1, 'normal');
assert(h2.ok === false && h2.reason === 'alreadyHunted', '每日限一次：同日再次狩猎被拒', h2);

// 跨日后危险狩猎失败：Math.random=0.99 → 成功率 0.15+0.99*0.6=0.744，判定 0.99>0.744 失败
startNewDay(gs);
Math.random = () => 0.99;
const h3 = huntCreature(gs, 1, 'danger');
assert(h3.ok === true && h3.success === false, '危险狩猎失败（不产出生物）', h3);
assert(h3.rate >= 0.15 && h3.rate <= 0.75, '成功率落在 15%~75% 区间', h3.rate);
assert(gs.map.outerTiles[1].dailyFlags['resource_hunt_hunt'] === true, '失败也消耗每日次数');

// 受祝福：下次狩猎成功率 +50%（0.45+0.5=0.95），判定 0.5<0.95 成功 → 危险类 = 史莱姆七种之一
HookDispatcher.fire('onBlessed', { gs, tileIdx: 1 });
assert(gs.map.outerTiles[1].contentState.huntBlessPending === true, '受祝福 → huntBlessPending 记账');
startNewDay(gs);
Math.random = () => 0.5;
const h4 = huntCreature(gs, 1, 'danger');
assert(h4.ok === true && h4.success === true, '受祝福后危险狩猎成功', h4);
assert(Math.abs(h4.rate - 0.95) < 1e-9, '祝福 +50% 生效（0.45→0.95）', h4.rate);
assert(CREATURES[h4.kind]?.category === 'danger', '危险狩猎产物为危险类生物（史莱姆）', h4.kind);
assert(gs.map.outerTiles[1].contentState.huntBlessPending === false, '祝福记账已消耗');

// 祝福 +50% 上限 100%：0.9+0.5=1.4 → 按 1.0 计
startNewDay(gs);
HookDispatcher.fire('onBlessed', { gs, tileIdx: 1 });
Math.random = () => 0.999;
const h5 = huntCreature(gs, 1, 'normal');
assert(h5.ok === true && h5.success === true && h5.rate === 1, '超出 100% 按 100% 计', h5.rate);

Math.random = origRandom;

// ════════════════════════════════════════════════════════════
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
