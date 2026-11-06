// tools/smoke-vehicle-pass.mjs —— 【经过时】路径结算回归测试（步行 / 载具）
//
// 设计文档 v0.5 §7 + 物品库词条「经过时」：
//   经过 = 移动途经的每一格 + 最终停留格，不含起点；每格独立触发一次。
//   载具：移动先完成（位置到终点）→ 按徒步模拟「起点→终点」默认最短路径 →
//         模拟路径用于【经过时】判定与路径长度 → 效果层只在终点生效。
//   中间格不触发地块/状态效果（含冰面滑行等位移效果），终点照常触发经过 + 进入 + 地块效果。
//   路径长度 ≠ 曼哈顿距离：曼哈顿距离只用于 range 可达性。
//
// 覆盖：步行/冰面、directional(轮子)、line(扫帚，含跨栅栏)、any(巧遇)、
//      range(马匹，含曼哈顿≠路径长度)、random(momo 图腾)、撞墙、非法索引。
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
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const { Distance } = await import('../src/core/Distance.js');
const { MovementSystem } = await import('../src/systems/MovementSystem.js');
const { VehicleSystem } = await import('../src/systems/VehicleSystem.js');

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');

registerFacilities();

// 记录所有经过/进入触发（校验顺序、去重、起点排除、中间格不触发）
const fired = [];
HookDispatcher.register('onPass', ({ tileIdx }) => fired.push(`pass:${tileIdx}`));
HookDispatcher.register('onEnter', ({ tileIdx }) => fired.push(`enter:${tileIdx}`));

// 记录 MOVE 事件里的路径长度
let lastMove = null;
EventBus.on(GE.MOVE, (p) => { lastMove = p; });

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
  gs.player.visitedTodayIdx = [];
  gs.vehicle = { current: null, available: [], chanceUsedToday: false };
  gs.uiState.lastMoveAt = 0;
  fired.length = 0;
  lastMove = null;
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
const pathText = (p) => JSON.stringify(p);
const manhattan = (gs, a, b) => {
  const pa = Distance.outerIdxToXY(gs.map.size, a);
  const pb = Distance.outerIdxToXY(gs.map.size, b);
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
};

// ── 1. 步行 1 格经过草莓田（真实经过，效果逐格生效） ──
head('步行 1 格经过草莓田');
{
  const gs = fresh();
  setStrawberry(gs, 1);
  const dest = MovementSystem.move(gs, 'right');
  assert(dest === 1, '步行到达 idx 1', dest);
  assert(stored(gs, 1) === 1, '草莓田【经过时】+1', stored(gs, 1));
  assert(fired.join('|') === 'pass:1|enter:1', '顺序 = 经过1 → 进入1', fired);
  assert(lastMove?.distance === 1, 'MOVE 路径长度 = 1', lastMove?.distance);
}

// ── 2. 载具 directional（轮子）2 格：中间格 + 终点都是草莓田 ──
head('载具 directional（轮子）2 格：中间格与终点都是草莓田');
{
  const gs = fresh();
  setStrawberry(gs, 1); // 模拟路径中间格
  setStrawberry(gs, 2); // 终点
  equip(gs, 'vehicle_wheel');
  const r = VehicleSystem.tryMove(gs, { direction: 'right' });
  assert(r.ok, '轮子移动成功', r.reason);
  assert(gs.player.x === 2, '落点为 idx 2', gs.player.x);
  assert(pathText(r.path) === '[1,2]', '模拟路径 = [1,2]', r.path);
  assert(lastMove?.distance === 2, '路径长度 = 2', lastMove?.distance);
  assert(manhattan(gs, 0, 2) === 2, '曼哈顿距离 = 2');
  assert(stored(gs, 1) === 0, '中间格草莓田：只判定经过，不结算地块效果', stored(gs, 1));
  assert(stored(gs, 2) === 1, '终点草莓田：照常结算经过时 +1', stored(gs, 2));
  assert(fired.join('|') === 'pass:2|enter:2', '效果层只在终点：经过2 → 进入2', fired);
  assert(fired.includes('pass:2') && fired.includes('enter:2'), '终点同时触发经过与进入');
}

// ── 3. 载具只走 1 格（第 2 步出界） ──
head('载具只走 1 格（第 2 步出界）');
{
  const gs = fresh();
  gs.player.x = 7; // (0,1)，向上第 1 步到 0，第 2 步出界
  setStrawberry(gs, 0);
  equip(gs, 'vehicle_wheel');
  const r = VehicleSystem.tryMove(gs, { direction: 'up' });
  assert(r.ok, '轮子移动成功', r.reason);
  assert(gs.player.x === 0, '落点为 idx 0', gs.player.x);
  assert(pathText(r.path) === '[0]', '模拟路径 = [0]', r.path);
  assert(stored(gs, 0) === 1, '终点草莓田【经过时】+1', stored(gs, 0));
  assert(fired.join('|') === 'pass:0|enter:0', '顺序 = 经过0 → 进入0', fired);
}

// ── 4. 冰面滑行多格（步行，真实经过逐格结算） ──
head('冰面滑行多格经过草莓田');
{
  const gs = fresh(5); // 16 格外圈，0..4 为顶行
  for (const i of [1, 2, 3]) gs.map.outerTiles[i].terrain = 'terrain_ice';
  setStrawberry(gs, 2);
  setStrawberry(gs, 3);
  setStrawberry(gs, 4);
  const path = MovementSystem.resolvePath(gs, 1); // right
  assert(pathText(path) === '[1,2,3,4]', '滑行路径 = 1→2→3→4', path);
  const dest = MovementSystem.move(gs, 'right');
  assert(dest === 4, '停在冰面滑行终点 4', dest);
  assert(stored(gs, 2) === 1 && stored(gs, 3) === 1 && stored(gs, 4) === 1,
    '步行逐格结算：滑行中间格 + 终点都 +1', [stored(gs, 2), stored(gs, 3), stored(gs, 4)]);
  assert(fired.join('|') === 'pass:1|pass:2|pass:3|pass:4|enter:4',
    '顺序 = 逐格经过 → 终点进入', fired);
  assert(lastMove?.distance === 4, '路径长度 = 4', lastMove?.distance);
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

// ── 5b. 非法目标索引（越界/负数）不得被当成地块 ──
head('非法目标索引');
{
  for (const bad of [99, -1]) {
    const gs = fresh();
    equip(gs, 'vehicle_horse'); // range 无 landFilter，最容易被幽灵索引蒙混过关
    const r = VehicleSystem.tryMove(gs, { targetIdx: bad });
    assert(!r.ok && r.reason === 'badTarget', `targetIdx=${bad} 被拒绝`, r);
    assert(gs.player.x === 0, `targetIdx=${bad} 未移动位置`, gs.player.x);
    assert(fired.length === 0, `targetIdx=${bad} 未触发任何钩子`, fired);
  }
}

// ── 6. line（扫帚）：同行 2 格，中间格 + 终点 ──
head('line（扫帚）同行 2 格');
{
  const gs = fresh();
  gs.player.x = 6; // (0,2)
  setStrawberry(gs, 5);
  setStrawberry(gs, 4);
  equip(gs, 'vehicle_broom');
  const r = VehicleSystem.tryMove(gs, { targetIdx: 4 });
  assert(r.ok, '扫帚移动成功', r.reason);
  assert(pathText(r.path) === '[5,4]', '模拟路径 = [5,4]', r.path);
  assert(lastMove?.distance === 2, '路径长度 = 2', lastMove?.distance);
  assert(stored(gs, 5) === 0, '中间格草莓田不结算', stored(gs, 5));
  assert(stored(gs, 4) === 1, '终点草莓田【经过时】+1', stored(gs, 4));
  assert(fired.join('|') === 'pass:4|enter:4', '效果层只在终点', fired);
}

// ── 6b. line（扫帚）跨栅栏：模拟徒步绕环，而不是 1 格直达 ──
head('line（扫帚）跨栅栏：路径长度 ≠ 曼哈顿距离');
{
  const gs = fresh();
  gs.player.x = 1; // (1,0) 顶边中点
  setStrawberry(gs, 2);
  setStrawberry(gs, 3);
  setStrawberry(gs, 4);
  setStrawberry(gs, 5); // 终点 (1,2) 底边中点
  equip(gs, 'vehicle_broom');
  const r = VehicleSystem.tryMove(gs, { targetIdx: 5 });
  assert(r.ok, '扫帚移动成功', r.reason);
  assert(pathText(r.path) === '[2,3,4,5]', '模拟最短徒步路径 = [2,3,4,5]', r.path);
  assert(lastMove?.distance === 4, '路径长度 = 4', lastMove?.distance);
  assert(manhattan(gs, 1, 5) === 2, '曼哈顿距离 = 2（与路径长度分开计算）');
  assert([2, 3, 4].every((i) => stored(gs, i) === 0), '中间格全部不结算地块效果',
    [stored(gs, 2), stored(gs, 3), stored(gs, 4)]);
  assert(stored(gs, 5) === 1, '终点照常结算【经过时】+1', stored(gs, 5));
  assert(fired.join('|') === 'pass:5|enter:5', '效果层只在终点', fired);
}

// ── 7. any（巧遇）：最短环路径中间格 + 终点 ──
head('any（巧遇）最短环路径');
{
  const gs = fresh();
  gs.player.x = 6; // (0,2) → (0,0) 最短弧经过 7
  setStrawberry(gs, 7);
  setStrawberry(gs, 0);
  equip(gs, 'vehicle_chance');
  const r = VehicleSystem.tryMove(gs, { targetIdx: 0 });
  assert(r.ok, '巧遇移动成功', r.reason);
  assert(pathText(r.path) === '[7,0]', '模拟路径 = [7,0]', r.path);
  assert(lastMove?.distance === 2, '路径长度 = 2', lastMove?.distance);
  assert(stored(gs, 7) === 0, '中间格草莓田不结算', stored(gs, 7));
  assert(stored(gs, 0) === 1, '终点草莓田【经过时】+1', stored(gs, 0));
  assert(fired.join('|') === 'pass:0|enter:0', '效果层只在终点', fired);
}

// ── 8. range（马匹）走 3 格：经过 3 格而不是 1 格 ──
head('range（马匹）3 格：路径长度 = 3');
{
  const gs = fresh();
  setStrawberry(gs, 1);
  setStrawberry(gs, 2);
  setStrawberry(gs, 3);
  equip(gs, 'vehicle_horse');
  const r = VehicleSystem.tryMove(gs, { targetIdx: 3 }); // (0,0) → (2,1)，曼哈顿 3
  assert(r.ok, '马匹移动成功', r.reason);
  assert(pathText(r.path) === '[1,2,3]', '模拟路径 = [1,2,3]', r.path);
  assert(lastMove?.distance === 3, '路径长度 = 3（不是 1）', lastMove?.distance);
  assert(manhattan(gs, 0, 3) === 3, '曼哈顿距离 = 3');
  assert(stored(gs, 1) === 0 && stored(gs, 2) === 0, '中间格不结算地块效果', [stored(gs, 1), stored(gs, 2)]);
  assert(stored(gs, 3) === 1, '终点【经过时】+1', stored(gs, 3));
  assert(fired.join('|') === 'pass:3|enter:3', '效果层只在终点', fired);
}

// ── 9. range（马匹）跨越栅栏：曼哈顿 2，路径长度 4 ──
head('range（马匹）曼哈顿 2 / 路径长度 4');
{
  const gs = fresh();
  gs.player.x = 7; // (0,1)
  for (const i of [0, 1, 2, 3]) setStrawberry(gs, i);
  equip(gs, 'vehicle_horse');
  const r = VehicleSystem.tryMove(gs, { targetIdx: 3 }); // (2,1)
  assert(r.ok, '马匹移动成功', r.reason);
  assert(pathText(r.path) === '[0,1,2,3]', '模拟最短徒步路径 = [0,1,2,3]', r.path);
  assert(lastMove?.distance === 4, '路径长度 = 4', lastMove?.distance);
  assert(manhattan(gs, 7, 3) === 2, '曼哈顿距离 = 2（仅用于可达性）');
  assert([0, 1, 2].every((i) => stored(gs, i) === 0), '中间格全部不结算',
    [stored(gs, 0), stored(gs, 1), stored(gs, 2)]);
  assert(stored(gs, 3) === 1, '终点照常结算【经过时】+1', stored(gs, 3));
  assert(fired.join('|') === 'pass:3|enter:3', '效果层只在终点', fired);
}

// ── 10. random（momo 图腾传送）：传送后照样模拟最短路径 ──
head('random（momo 图腾）：传送后模拟路径，且不再次触发冰面位移');
{
  const gs = fresh();
  gs.player.x = 7; // (0,1)
  // 模拟路径 [0,1,2,3] 上的中间格放草莓田 + 冰面，验证既不结算效果、也不引发滑行
  for (const i of [0, 1, 2]) {
    setStrawberry(gs, i);
    gs.map.outerTiles[i].terrain = 'terrain_ice';
  }
  setStrawberry(gs, 3);
  gs.map.outerTiles[3].terrain = 'terrain_ice';
  equip(gs, 'vehicle_totem_momo');
  const rnd = Math.random;
  Math.random = () => 0.5; // 落点池 [0..6] → idx 3
  let r;
  try {
    r = VehicleSystem.tryMove(gs, {});
  } finally {
    Math.random = rnd;
  }
  assert(r.ok, 'momo 图腾传送成功', r.reason);
  assert(gs.player.x === 3, '落点为 idx 3', gs.player.x);
  assert(pathText(r.path) === '[0,1,2,3]', '传送后模拟最短路径 = [0,1,2,3]', r.path);
  assert(lastMove?.distance === 4, '路径长度 = 4', lastMove?.distance);
  assert(manhattan(gs, 7, 3) === 2, '曼哈顿距离 = 2');
  assert([0, 1, 2].every((i) => stored(gs, i) === 0), '中间格不结算地块/状态效果',
    [stored(gs, 0), stored(gs, 1), stored(gs, 2)]);
  assert(stored(gs, 3) === 1, '终点照常结算【经过时】+1', stored(gs, 3));
  assert(gs.player.x === 3, '冰面不因模拟徒步再次引发位移（仍停在 3）', gs.player.x);
  assert(fired.join('|') === 'pass:3|enter:3', '效果层只在终点', fired);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
