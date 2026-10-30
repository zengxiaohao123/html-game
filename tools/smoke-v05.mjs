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

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
