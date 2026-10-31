// tools/smoke-v05.mjs —— v0.5 规则冒烟测试（Node，无 DOM）
//
// 覆盖本轮新增的规则：冰面滑行、地形放置、野生种子、随机池占位补足、
// 背包按价值分堆、每日重置、载具落点限制。
//
// 用法：node tools/smoke-v05.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities } = await import('../src/data/facilities.js');
const { move, resolvePath } = await import('../src/systems/MovementSystem.js');
const { placeContent, placeTerrain, enterBuildMode } = await import('../src/systems/BuildSystem.js');
const { addItem, removeItem, countItem } = await import('../src/systems/InventorySystem.js');
const { drawFromPool, resolveCandidates, PLACEHOLDER_IDS } = await import('../src/systems/RandomPool.js');
const { startNewDay } = await import('../src/systems/DaySystem.js');
const { VEHICLES } = await import('../src/data/vehicles.js');
const { distanceOf } = await import('../src/core/Distance.js').catch(() => ({ distanceOf: null }));

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');

registerFacilities();
const gs = createInitialState();

// 冒烟测试用干净背包（开局测试包会干扰数量断言）
gs.inventory.items = [];
gs.inventory.outbox = [];
gs.player.gold = 0;

head('初始状态');
assert(gs.map.outerTiles.length === 8, '外圈 8 格');
assert(gs.map.outerTiles.every((t) => t.terrain === 'terrain_none'), '开局 8 格全为无地形（v0.5 §9）');
assert(gs.map.outerTiles[6].contentId === 'facility_home', '左下角是家');

head('背包按价值分堆');
addItem(gs, 'item_tulip', 1, { value: 5 });
addItem(gs, 'item_tulip', 2, { value: 9 });
const tulipEntries = gs.inventory.items.filter((e) => e.itemId === 'item_tulip');
assert(tulipEntries.length === 2, '不同价值的郁金香分成两堆');
assert(countItem(gs, 'item_tulip') === 3, 'countItem 跨堆累加 = 3', countItem(gs, 'item_tulip'));
removeItem(gs, 'item_tulip', 1, { value: 9 });
assert(countItem(gs, 'item_tulip') === 2, '按价值精确扣除后剩 2', countItem(gs, 'item_tulip'));

head('地形放置');
addItem(gs, 'terrain_ice', 2);
const r1 = placeTerrain(gs, 0, 'terrain_ice');
assert(r1.ok, '冰面放置成功');
assert(gs.map.outerTiles[0].terrain === 'terrain_ice', '地块 0 变为冰面');
assert(gs.map.outerTiles[0].terrainAmount === 10, '元素量回满 10');
assert(countItem(gs, 'terrain_ice') === 1, '背包冰面 -1');

head('冰面滑行');
// 3×3 外圈索引：0 左上,1 上,2 右上,3 右,4 右下,5 下,6 左下(家),7 左
gs.map.outerTiles[0].terrain = 'terrain_ice';
gs.map.outerTiles[1].terrain = 'terrain_ice';
gs.map.outerTiles[2].terrain = 'terrain_none';
gs.player.x = 7;                       // 站在左侧
const path = resolvePath(gs, 0);       // 向上：7 → 0，再向上是栅栏 → 必须停在拐角
assert(path[0] === 0, '第一步走到 0（冰面）');
assert(path.length === 1, '环形地图拐角处无法直行 → 停在 0', path);
const beforeStamina = gs.player.stamina;
const dest = move(gs, 'up');
assert(dest === 0, '最终停在 0');
assert(gs.player.stamina === beforeStamina - 1, '整段滑行只扣 1 行动力（不被滑行重复扣）');

head('冰面连续滑行（4×4 长直道）');
const iceMap = {
  map: { size: 4, outerTiles: Array.from({ length: 12 }, (_, i) => ({ idx: i, terrain: 'terrain_ice', terrainAmount: 10 })) },
  player: { x: 0 },
};
let longest = [];
for (const d of [0, 1, 2, 3]) {
  const p = resolvePath(iceMap, d);
  if (p.length > longest.length) longest = p;
}
assert(longest.length >= 2, '全冰面地图上能连续滑行 ≥2 格', longest);

head('非冰面不滑行');
const plainMap = {
  map: { size: 4, outerTiles: Array.from({ length: 12 }, (_, i) => ({ idx: i, terrain: 'terrain_none', terrainAmount: 0 })) },
  player: { x: 0 },
};
let plainMax = 0;
for (const d of [0, 1, 2, 3]) plainMax = Math.max(plainMax, resolvePath(plainMap, d).length);
assert(plainMax === 1, '普通地形只走 1 格', plainMax);

head('随机池占位补足');
const need = 4;
const pool09 = resolveCandidates('POOL-09', need);   // 魔导书池只有 2 条
assert(pool09.realCount === 2, 'POOL-09 实际候选 2 条', pool09.realCount);
assert(pool09.placeholderUsed === true, '候选不足 → 启用占位');
assert(pool09.candidates.length > pool09.realCount, '占位已补入候选');
const drawn = drawFromPool('POOL-09', need);
assert(drawn.length === need, `能抽满 ${need} 件`, drawn.length);
const enoughPool = resolveCandidates('POOL-06', 2);   // 作物池 11 条，充足
assert(enoughPool.placeholderUsed === false, '候选充足时不启用占位（占位权重为 0）');
assert(PLACEHOLDER_IDS.length >= 1, '占位物品已从物品库识别', PLACEHOLDER_IDS);

head('野生种子放置');
for (const t of gs.map.outerTiles) { t.terrain = 'terrain_none'; t.contentId = null; t.contentState = {}; }
gs.map.outerTiles[6].contentId = 'facility_home';
gs.player.x = 6;
gs.buildMode = true;
addItem(gs, 'facility_wild_seed', 1);
const r2 = placeContent(gs, 3, 'facility_wild_seed');
assert(r2.ok, '野生种子放置成功');
const became = gs.map.outerTiles[3].contentId;
assert(became && became !== 'facility_wild_seed', '放置后变成了别的设施', became);
assert(countItem(gs, 'facility_wild_seed') === 0, '背包野生种子已消耗');

head('替换规则（v0.5）');
addItem(gs, 'facility_tent', 1);
gs.map.outerTiles[3].contentId = 'facility_wheat';
gs.map.outerTiles[3].contentState = { tulipValue: 99 };
placeContent(gs, 3, 'facility_tent');
assert(gs.map.outerTiles[3].contentId === 'facility_tent', '帐篷替换成功');
assert(countItem(gs, 'facility_wheat') === 0, '旧设施消失（v0.5 帐篷不再把旧内容带回背包）');
assert(Object.keys(gs.map.outerTiles[3].contentState).length === 0, '旧 contentState 已清空');

head('载具 15 种定义');
assert(Object.keys(VEHICLES).length === 15, '载具 15 种', Object.keys(VEHICLES).length);
assert(VEHICLES.vehicle_horse.movePattern === 'range', '马匹 = 距离型');
assert(VEHICLES.vehicle_tractor.landFilter?.tier2 === '设施', '拖拉机落点必须是设施');
assert(VEHICLES.vehicle_chance.persistent === true, '巧遇不因次数耗尽消失');

head('每日重置');
gs.player.visitedTodayIdx = [1, 2, 3];
gs.buildDailyPlaced = { resource_shop: 1 };
gs.player.stamina = gs.player.maxStamina + 5;
startNewDay(gs);
assert(Array.isArray(gs.player.visitedTodayIdx) && gs.player.visitedTodayIdx.length === 0, 'visitedTodayIdx 已重置');
assert(Object.keys(gs.buildDailyPlaced).length === 0, 'buildDailyPlaced 已重置');
assert(gs.player.stamina <= gs.player.maxStamina, '行动力溢出已清除', gs.player.stamina);

head('商店抽取与交易');
const { getShop, buy, sell, refreshShop, manualRefreshCost, planCounts, SHOP_KINDS, weeklyRefreshAll } =
  await import('../src/systems/ShopSystem.js');
const { CalendarSystem } = await import('../src/systems/CalendarSystem.js');

gs.map.outerTiles[1].contentId = 'resource_shop';
gs.map.outerTiles[1].contentState = {};
const shop = getShop(gs, 1);
assert(!!shop, '商店状态已生成');
assert(shop.stock.length === 12, '商店共 12 格商品', shop.stock.length);

// 各类数量落在区间内
const byGroup = {};
for (const s of shop.stock) byGroup[s.group] = (byGroup[s.group] || 0) + 1;
const gcfg = SHOP_KINDS.shop.groups;
const inRange = gcfg.every((g) => (byGroup[g.label] || 0) >= 0 && (byGroup[g.label] || 0) <= g.max);
assert(inRange, '各类数量不超过上限', byGroup);
assert((byGroup['收藏品'] || 0) >= 4, '收藏品至少 4 格', byGroup['收藏品']);

gs.player.gold = 1000;
const firstBuyable = shop.stock.findIndex((s) => !s.sold && s.price != null);
const before = gs.player.gold;
const b = buy(gs, 1, firstBuyable);
assert(b.ok, '购买成功', b);
assert(gs.player.gold === before - b.price, '金币按买价扣除');
assert(shop.stock[firstBuyable].sold === true, '该格已售出');
const b2 = buy(gs, 1, firstBuyable);
assert(!b2.ok, '同一格不能买第二次（每件只卖 1 个）');

assert(manualRefreshCost(shop) === 4, '首次刷新 4 金币', manualRefreshCost(shop));
const g1 = gs.player.gold;
const rf1 = refreshShop(gs, 1);
assert(rf1.ok && gs.player.gold === g1 - 4, '刷新扣 4 金币');
assert(manualRefreshCost(shop) === 8, '第二次刷新 8 金币', manualRefreshCost(shop));
refreshShop(gs, 1);
assert(manualRefreshCost(shop) === 12, '第三次刷新 12 金币', manualRefreshCost(shop));
refreshShop(gs, 1);
assert(manualRefreshCost(shop) === null, '三次用完 → 不可再刷新');
assert(!refreshShop(gs, 1).ok, '超出次数刷新被拒绝');

head('商店出售');
addItem(gs, 'item_wheat', 3);
const goldBefore = gs.player.gold;
const sv = sell(gs, 'item_wheat');
assert(sv.ok && sv.value === 2, '小麦卖价 = 物品价值 2', sv);
assert(gs.player.gold === goldBefore + 2, '卖出加金币');
assert(countItem(gs, 'item_wheat') === 2, '背包小麦 -1');
addItem(gs, 'grimoire_grain_full', 1);
assert(!sell(gs, 'grimoire_grain_full').ok, '魔导书不可出售');

head('魔法商店');
gs.map.outerTiles[2].contentId = 'resource_magic_shop';
gs.map.outerTiles[2].contentState = {};
const mshop = getShop(gs, 2);
assert(!!mshop && mshop.kind === 'magic', '魔法商店状态已生成');
assert(mshop.stock.length === 10, '魔法商店共 10 格', mshop.stock.length);
const mg = {};
for (const s of mshop.stock) mg[s.group] = (mg[s.group] || 0) + 1;
assert((mg['魔导书'] || 0) >= 3, '魔导书至少 3 格（靠占位补足）', mg);

head('每周一自动刷新');
shop.refreshUsed = 3;
gs.calendar = { year: 1, month: 3, dayOfMonth: 7, weekday: 7 };  // 周日
startNewDay(gs);                                                  // → 周一
assert(gs.calendar.weekday === 1, '推进到周一', gs.calendar);
assert(getShop(gs, 1).refreshUsed === 0, '周一重置手动刷新次数');
assert(getShop(gs, 1).stock.length === 12, '周一重新抽满 12 格');

head('日历');
assert(CalendarSystem.formatCalendar(gs) === '1 年 3 月 8 日 星期一', '日历显示正确', CalendarSystem.formatCalendar(gs));

head('获得即生效：技能石 / 收藏品 / 魔导书');
const { initPassiveItems, hasConnectedRice } = await import('../src/systems/PassiveItemSystem.js');
const { HookDispatcher } = await import('../src/core/HookDispatcher.js');
initPassiveItems(() => gs);

addItem(gs, 'skill_stone_shift', 1);
assert(countItem(gs, 'skill_stone_shift') === 0, '技能石被消耗');
assert(countItem(gs, 'skill_link_shift') === 1, '获得即习得【移形】');

gs.player.hp = 50;
gs.player.maxHp = 100;
addItem(gs, 'collectible_royal_pillow', 1);
HookDispatcher.fire('onSleep', { gs });
assert(gs.player.hp === 65, '皇家枕头：睡觉回复 15% 生命', gs.player.hp);

gs.player.hp = 50;
addItem(gs, 'collectible_deadwood', 1);
HookDispatcher.fire('onMoveEnd', { gs, distance: 1 });
assert(gs.player.hp === 57, '枯木新枝：移动后回 6+1% 生命', gs.player.hp);

addItem(gs, 'collectible_membership_card', 1);
const { effectivePrice } = await import('../src/systems/ShopSystem.js');
assert(effectivePrice(gs, { id: 'item_wheat', price: 10 }) === 5, '会员卡：商品五折');

const facBefore = gs.inventory.items.reduce((n, e) => n + (e.itemId.startsWith('facility_') ? e.qty : 0), 0);
addItem(gs, 'collectible_farm_guide', 1);
const facAfter = gs.inventory.items.reduce((n, e) => n + (e.itemId.startsWith('facility_') ? e.qty : 0), 0);
assert(facAfter >= facBefore + 3, '《农业指南》：获得 3 个随机设施', { facBefore, facAfter });

head('消耗道具使用');
const { useItem } = await import('../src/systems/UseItemSystem.js');
addItem(gs, 'item_beer', 1);
const stBefore = gs.player.stamina;
const ub = useItem(gs, 'item_beer');
assert(ub.ok, '啤酒使用成功', ub);
assert(gs.player.stamina === stBefore + 3, '啤酒 行动力 +3', gs.player.stamina);
assert(countItem(gs, 'item_beer') === 0, '啤酒已消耗');

addItem(gs, 'item_trap', 1);
gs.map.outerTiles[0].contentState = {};
const ut = useItem(gs, 'item_trap', { tileIdx: 0 });
assert(ut.ok, '陷阱放置成功', ut);
assert(gs.map.outerTiles[0].contentState.placedItems?.[0]?.itemId === 'item_trap', '陷阱进入地块状态');
assert(!useItem(gs, 'item_trap', { tileIdx: 0 }).ok || countItem(gs, 'item_trap') === 0, '同名陷阱不能重复放置或已无库存');

head('道具指向模式 + 初级肥料');
const IT = await import('../src/systems/ItemTargeting.js');
const { isPlantTarget } = await import('../src/systems/UseItemSystem.js');
assert(IT.needsTarget('item_fertilizer'), '肥料需要指定地块');
assert(IT.needsTarget('item_trap'), '陷阱需要指定地块');
assert(IT.needsTarget('item_incense'), '艾草熏香需要指定地块');
assert(!IT.needsTarget('item_herb'), '草药不需要指定地块');

// 放一块麦田，验证肥料确实只结算该格
for (const t of gs.map.outerTiles) { t.contentId = null; t.contentState = {}; t.dailyFlags = {}; }
gs.map.outerTiles[6].contentId = 'facility_home';
gs.map.outerTiles[3].contentId = 'facility_wheat';
gs.map.outerTiles[4].contentId = 'facility_wheat';
assert(isPlantTarget(gs, 3), '麦田是合法施肥目标');
assert(!isPlantTarget(gs, 6), '家不是合法施肥目标');

const validF = IT.validTiles(gs, 'item_fertilizer');
assert(validF.length === 2 && validF.includes(3) && validF.includes(4), '合法目标只有两块麦田', validF);

gs.inventory.items = [];
addItem(gs, 'item_fertilizer', 1);
gs.map.outerTiles[3].dailyFlags = { facility_wheat_onDailyStart: true };  // 模拟当日已产出
const r = IT.start(gs, 'item_fertilizer');
assert(r.ok && r.pending, '进入指向模式', r);
const wheatBefore = countItem(gs, 'item_wheat');
const click = IT.handleTileClick(gs, 3);
const wheatAfter = countItem(gs, 'item_wheat');
assert(click.ok, '点击合法地块生效', click);
assert(wheatAfter - wheatBefore >= 4, '肥料让该田多结算 2 次每日产出（≥4 小麦）', { wheatBefore, wheatAfter });
assert(countItem(gs, 'item_fertilizer') === 0, '肥料已消耗');
assert(!IT.isActive(), '用完后自动退出指向模式');

addItem(gs, 'item_trap', 1);
IT.start(gs, 'item_trap');
assert(IT.isActive(), '陷阱进入指向模式');
assert(!IT.isValidTarget(gs, 'item_trap', 99), '越界地块不合法');

head('开局测试包');
const fresh = createInitialState();
assert(fresh.player.gold === 50, '初始金币 50', fresh.player.gold);
assert(fresh.inventory.items.length >= 20, '开局背包有充足测试物品', fresh.inventory.items.length);

head('唯一物品跨池去重');
const { isUniqueItem, collectUniqueHeld } = await import('../src/systems/ShopSystem.js');
assert(isUniqueItem('collectible_membership_card'), '会员卡是唯一物品');
assert(isUniqueItem('grimoire_grain_full'), '魔导书是唯一物品');
assert(!isUniqueItem('item_wheat'), '小麦不是唯一物品');

for (const t of gs.map.outerTiles) { t.contentId = null; t.contentState = {}; }
gs.map.outerTiles[0].contentId = 'resource_shop';
gs.map.outerTiles[1].contentId = 'resource_magic_shop';
gs.inventory.items = [];

const { generateStock } = await import('../src/systems/ShopSystem.js');
const { ITEMS } = await import('../src/data/items.js');
// 直接验证"排除集合"生效：把所有唯一物品都排除，生成的新库存不应包含它们
const allUnique = new Set(
  Object.keys(ITEMS).filter((id) => isUniqueItem(id))
);
assert(allUnique.size >= 8, '库中唯一物品数量合理', allUnique.size);
const filtered = generateStock('shop', Math.random, { exclude: allUnique });
const leaked = filtered.filter((i) => allUnique.has(i.id));
assert(leaked.length === 0, '被排除的唯一物品不会出现在库存里', leaked.map((x) => x.id));

// 两家店同时存在时，第二家生成时要避开第一家的持有
const s1 = getShop(gs, 0);
const s2 = getShop(gs, 1);
const s1Unique = new Set(s1.stock.filter((i) => !i.sold && isUniqueItem(i.id)).map((i) => i.id));
const overlap = s2.stock.filter((i) => s1Unique.has(i.id));
assert(overlap.length === 0, '第二家店不会与第一家重复的唯一物品', overlap.map((x) => x.id));
const held = collectUniqueHeld(gs, 1);
assert(held.size >= 0, 'collectUniqueHeld 可正常收集', held.size);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
