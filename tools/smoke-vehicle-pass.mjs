// tools/smoke-vehicle-pass.mjs —— 【经过时】路径结算回归测试（步行 / 载具共用）
//
// 设计文档 v0.5 §7 + 物品库词条「经过时」：
//   经过 = 移动途经的每一格 + 最终停留格，不含起点；每格独立触发一次。
//   载具走完后按徒步方式模拟一条最近路径作为「经过」路径。
//
// 覆盖：
//   1. 步行 1 格经过草莓田
//   2. 载具直线 2 格：中间格 + 终点都是草莓田
//   3. 载具只走 1 格（第 2 步出界）：终点也必须算「经过」
//   4. 冰面滑行多格，中间格 + 终点都触发 + 每格只触发一次
//   5. 载具撞墙未移动：不触发任何经过/进入
//   6. 扫帚（line）中间格 + 终点
//   7. 巧遇（any）最短环路径中间格 + 终点
//
// 用法：node tools/smoke-vehicle-pass.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities } = await import('../src/data/facilities.js');
const { HookDispatcher } = await import('../src/core/HookDispatcher.js');
const { MovementSystem } = await import('../src/systems/MovementSystem.js');
const { VehicleSystem } = await import('../src/systems/VehicleSystem.js');

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');

registerFacilities();

// 记录所有经过/进入触发（用于校验顺序、去重、起点排除）
const fired = [];
HookDispatcher.register('onPass', ({ tileIdx }) => fired.push(`pass:${tileIdx}`));
HookDispatcher.register('onEnter', ({ tileIdx }) => fired.push(`enter:${tileIdx}`));

function fresh(size = 3) {
  const gs = createInitialState();
  gs.inventory.items = [];
  gs.map.size = size;
  gs.map.outerTiles = Array.from({ length: 4 * (size - 1) }, (_, i) => ({
    idx: i,
    terrain: 'terrain_none',
    terrainAmount: 0,
    contentId: null,
    states: [],
    dailyFlags: {},
  }));
  gs.player.x = 0;
  gs.player.stamina = 8;
  gs.vehicle = { current: null, available: [], chanceUsedToday: false };
  gs.uiState.lastMoveAt = 0;
  fired.length = 0;
  return gs;
}

function setStrawberry(gs, idx) {
  gs.map.outerTiles[idx].contentId = 'facility_strawberry';
  gs.map.outerTiles[idx].contentState = {};
}
const stored = (gs, idx) => gs.map.outerTiles[idx].contentState?.strawberryStored || 0;
function equip(gs, vehicleId) {
  const entry = { vehicleId, usageLeft: 5 };
  gs.vehicle.available.push({ ...entry });
  gs.vehicle.current = { ...entry };
}

// ── 1. 步行 1 格经过草莓田 ──
head('步行 1 格经过草莓田');
{
  const gs = fresh();
  setStrawberry(gs, 1);
  const dest = MovementSystem.move(gs, 'right');
  assert(dest === 1, '步行到达 idx 1', dest);
  assert(stored(gs, 1) === 1, '草莓田【经过时】+1', stored(gs, 1));
  assert(fired.join('|') === 'pass:1|enter:1', '顺序 = 经过1 → 进入1', fired);
}

// ── 2. 载具直线 2 格：中间格 + 终点都是草莓田 ──
head('载具直线 2 格（轮子）：中间格与终点都是草莓田');
{
  const gs = fresh();
  setStrawberry(gs, 1); // 中间格
  setStrawberry(gs, 2); // 终点
  equip(gs, 'vehicle_wheel');
  const r = VehicleSystem.tryMove(gs, { direction: 'right' });
  assert(r.ok, '轮子移动成功', r.reason);
  assert(gs.player.x === 2, '落点为 idx 2', gs.player.x);
  assert(stored(gs, 1) === 1, '中间格草莓田【经过时】+1', stored(gs, 1));
  assert(stored(gs, 2) === 1, '终点草莓田【经过时】+1（经过包含进入）', stored(gs, 2));
  assert(
    fired.join('|') === 'pass:1|pass:2|enter:2',
    '顺序 = 经过1 → 经过2 → 进入2，起点0不计入',
    fired
  );
  assert(fired.filter((e) => e === 'pass:2').length === 1, '终点只触发一次经过');
}

// ── 3. 载具只走 1 格（第 2 步出界）：终点也算「经过」 ──
head('载具只走 1 格（第 2 步出界）');
{
  const gs = fresh();
  gs.player.x = 7; // (0,1)，向上第 1 步到 0，第 2 步出界
  setStrawberry(gs, 0);
  equip(gs, 'vehicle_wheel');
  const r = VehicleSystem.tryMove(gs, { direction: 'up' });
  assert(r.ok, '轮子移动成功', r.reason);
  assert(gs.player.x === 0, '落点为 idx 0', gs.player.x);
  assert(stored(gs, 0) === 1, '终点草莓田【经过时】+1', stored(gs, 0));
  assert(fired.join('|') === 'pass:0|enter:0', '顺序 = 经过0 → 进入0', fired);
}

// ── 4. 冰面滑行多格（步行） ──
head('冰面滑行多格经过草莓田');
{
  const gs = fresh(5); // 16 格外圈，0..4 为顶行
  for (const i of [1, 2, 3]) gs.map.outerTiles[i].terrain = 'terrain_ice';
  setStrawberry(gs, 2);
  setStrawberry(gs, 3);
  setStrawberry(gs, 4);
  const path = MovementSystem.resolvePath(gs, 1); // right
  assert(JSON.stringify(path) === '[1,2,3,4]', '滑行路径 = 1→2→3→4', path);
  const dest = MovementSystem.move(gs, 'right');
  assert(dest === 4, '停在冰面滑行终点 4', dest);
  assert(stored(gs, 2) === 1 && stored(gs, 3) === 1 && stored(gs, 4) === 1,
    '滑行中间格 + 终点都触发【经过时】', [stored(gs, 2), stored(gs, 3), stored(gs, 4)]);
  assert(fired.join('|') === 'pass:1|pass:2|pass:3|pass:4|enter:4',
    '顺序 = 逐格经过 → 终点进入', fired);
  assert(fired.filter((e) => e === 'pass:3').length === 1, '每一格只触发一次经过');
}

// ── 5. 载具撞墙未移动 ──
head('载具撞墙未移动');
{
  const gs = fresh();
  equip(gs, 'vehicle_wheel');
  const staminaBefore = gs.player.stamina;
  const usageBefore = gs.vehicle.current.usageLeft;
  const r = VehicleSystem.tryMove(gs, { direction: 'left' }); // 左上角向左出界
  assert(!r.ok, '移动失败', r);
  assert(gs.player.x === 0, '位置未变化');
  assert(fired.length === 0, '未触发任何经过/进入', fired);
  assert(gs.player.stamina === staminaBefore, '未扣行动力');
  assert(gs.vehicle.current.usageLeft === usageBefore, '未消耗载具次数');
}

// ── 6. 扫帚（line）：中间格 + 终点 ──
head('扫帚（line）中间格与终点');
{
  const gs = fresh();
  gs.player.x = 6; // (0,2)
  setStrawberry(gs, 5);
  setStrawberry(gs, 4);
  equip(gs, 'vehicle_broom');
  const r = VehicleSystem.tryMove(gs, { targetIdx: 4 });
  assert(r.ok, '扫帚移动成功', r.reason);
  assert(stored(gs, 5) === 1, '中间格草莓田【经过时】+1', stored(gs, 5));
  assert(stored(gs, 4) === 1, '终点草莓田【经过时】+1', stored(gs, 4));
  assert(fired.join('|') === 'pass:5|pass:4|enter:4', '顺序 = 经过5 → 经过4 → 进入4', fired);
}

// ── 7. 巧遇（any）：最短环路径中间格 + 终点 ──
head('巧遇（any）最短环路径中间格与终点');
{
  const gs = fresh();
  gs.player.x = 6; // (0,2) → (0,0) 最短弧经过 7
  setStrawberry(gs, 7);
  setStrawberry(gs, 0);
  equip(gs, 'vehicle_chance');
  const r = VehicleSystem.tryMove(gs, { targetIdx: 0 });
  assert(r.ok, '巧遇移动成功', r.reason);
  assert(stored(gs, 7) === 1, '最短路径中间格【经过时】+1', stored(gs, 7));
  assert(stored(gs, 0) === 1, '终点草莓田【经过时】+1', stored(gs, 0));
  assert(fired.join('|') === 'pass:7|pass:0|enter:0', '顺序 = 经过7 → 经过0 → 进入0', fired);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
