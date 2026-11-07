// tools/smoke-wasd-vehicle.mjs —— WASD 走 1 格的载具判定回归测试
//
// 设计文档 v0.5 §7「WASD 在载具允许时等价于使用载具」：
//   未装备载具            → WASD 按徒步跋涉正常走；
//   装备载具且允许这 1 格 → 按载具移动结算（次数 -1、只结算终点、MOVE byVehicle → 移形联动）；
//   装备载具但不允许这格  → 本次 WASD 整体拦截：不移动、不扣行动力、不推进回合、不记冷却、
//                          不扣次数、不卸下载具、无任何提示/事件/钩子。
//
// 用法：node tools/smoke-wasd-vehicle.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { GameDirector } = await import('../src/systems/GameDirector.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const { MovementSystem } = await import('../src/systems/MovementSystem.js');
const { HookDispatcher } = await import('../src/core/HookDispatcher.js');

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');
const SHIFT_SKILL_ID = 'skill_link_shift';
const SHIFT_TILE_IDX = 3;

// 事件 / 钩子观测器（校验「无事件广播、无联动」）
const seen = { move: [], toast: [], blocked: [], hooks: [] };
EventBus.on(GE.MOVE, (p) => seen.move.push(p));
EventBus.on(GE.TOAST_SHOW, (p) => seen.toast.push(p));
EventBus.on(GE.MOVE_BLOCKED, (p) => seen.blocked.push(p));
HookDispatcher.register('onPass', ({ tileIdx }) => seen.hooks.push(`pass:${tileIdx}`));
HookDispatcher.register('onEnter', ({ tileIdx }) => seen.hooks.push(`enter:${tileIdx}`));
HookDispatcher.register('onMoveEnd', ({ distance }) => seen.hooks.push(`moveEnd:${distance}`));
const resetSeen = () => {
  seen.move.length = 0; seen.toast.length = 0; seen.blocked.length = 0; seen.hooks.length = 0;
  lastMove = null;
};
let lastMove = null;
EventBus.on(GE.MOVE, (p) => { lastMove = p; });

// 只注册 GameDirector 的事件订阅（不 start，避免启动实时时钟 / 注入生物）
const director = new GameDirector();
director._registerOnce();

function fresh() {
  const gs = createInitialState();
  gs.inventory.items = [];
  gs.map.size = 3; // 外圈 8 格：0 左上, 1 上, 2 右上, 3 右, 4 右下, 5 下, 6 左下, 7 左
  gs.map.outerTiles = Array.from({ length: 8 }, (_, i) => ({
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
  gs.vehicle = { current: null, available: [], nextInstanceId: 1, chanceUsedToday: false };
  gs.linkSkillQueue = [];
  gs.linkSkillCooldowns = {};
  gs.linkSkillCounters = {};
  gs.team.dailyDistanceMoved = 0;
  gs.creatures.length = 0;
  gs.uiState.lastMoveAt = 0;
  resetSeen();
  director.gs = gs;
  return gs;
}

/** 装载一件载具（独立实例；次数可自定义，便于测「次数 -1 / 耗尽」） */
function equip(gs, vehicleId, usageLeft) {
  const defLeft = usageLeft ?? 3;
  const instanceId = gs.vehicle.nextInstanceId++;
  gs.vehicle.available.push({ instanceId, vehicleId, usageLeft: defLeft });
  gs.vehicle.current = { instanceId, vehicleId, usageLeft: defLeft };
}
/** 放置一份移形（连携技必须放置才生效） */
function placeShift(gs) {
  gs.map.outerTiles[SHIFT_TILE_IDX].contentId = SHIFT_SKILL_ID;
  gs.linkSkillCounters[`${SHIFT_TILE_IDX}|${SHIFT_SKILL_ID}`] = { count: 0, elements: [] };
}
const queueHasShift = (gs) => gs.linkSkillQueue.some(
  (e) => e.skillId === SHIFT_SKILL_ID && e.key === `${SHIFT_TILE_IDX}|${SHIFT_SKILL_ID}`,
);
const resetCooldown = (gs) => { gs.uiState.lastMoveAt = 0; };

/** 状态快照（用于「整体拦截」时逐项比对不变） */
const snapshot = (gs) => JSON.stringify({
  x: gs.player.x,
  stamina: gs.player.stamina,
  turn: gs.turn,
  dailyDistanceMoved: gs.team.dailyDistanceMoved,
  lastMoveAt: gs.uiState.lastMoveAt,
  queueLen: gs.linkSkillQueue.length,
  current: gs.vehicle.current,
  available: gs.vehicle.available,
  visited: gs.player.visitedTodayIdx,
});

/** 断言一次 WASD 被整体拦截（位置/数值/载具/事件全部不变） */
function assertBlocked(gs, before, dest, label) {
  assert(dest === null, `${label}：director.move 返回 null`, dest);
  assert(snapshot(gs) === before, `${label}：位置/行动力/回合/次数/装备/冷却全不变`, snapshot(gs));
  assert(seen.move.length === 0, `${label}：无 GE.MOVE 广播`, seen.move.length);
  assert(seen.toast.length === 0, `${label}：无 Toast 提示`, seen.toast.length);
  assert(seen.blocked.length === 0, `${label}：无 MOVE_BLOCKED 广播`, seen.blocked.length);
  assert(seen.hooks.length === 0, `${label}：无任何移动钩子`, seen.hooks);
  assert(!queueHasShift(gs), `${label}：未解锁移形`, gs.linkSkillQueue);
}

// ── 1. 载具允许这 1 格：WASD 按「使用载具」结算 ──
head('载具允许 1 格：WASD → 次数 -1 + 移形解锁');
{
  const gs = fresh();
  placeShift(gs);
  equip(gs, 'vehicle_horse', 3); // range 3，可达相邻 1 格
  const staminaBefore = gs.player.stamina;
  const turnBefore = gs.turn;
  const dest = director.move('right');

  assert(dest === 1 && gs.player.x === 1, 'WASD 落到 idx 1', gs.player.x);
  assert(gs.vehicle.current?.usageLeft === 2, '载具使用次数 3 → 2', gs.vehicle.current?.usageLeft);
  assert(queueHasShift(gs), '移形窗口解锁（已放置实例入队）', gs.linkSkillQueue);
  assert(gs.linkSkillQueue[0]?.expireAtMs > Date.now(), '队首窗口已开始计时（可用）',
    gs.linkSkillQueue[0]?.expireAtMs);
  assert(lastMove?.byVehicle === true, 'MOVE 事件带 byVehicle', lastMove);
  assert(lastMove?.distance === 1 && JSON.stringify(lastMove?.path) === '[1]',
    '模拟路径 = 最短路径 1 格 [1]', [lastMove?.distance, lastMove?.path]);
  assert(gs.turn === turnBefore + 1, '载具移动只推进 1 回合', [turnBefore, gs.turn]);
  assert(gs.team.dailyDistanceMoved === 1, '移形今日移动距离 +1', gs.team.dailyDistanceMoved);
  assert(gs.player.stamina === staminaBefore - 1, '载具移动照常扣 1 行动力', gs.player.stamina);
  assert(gs.uiState.lastMoveAt > 0, '载具移动记录移动冷却', gs.uiState.lastMoveAt);
}

// ── 2. 无载具：WASD 徒步正常移动 ──
head('无载具（徒步）：正常移动、正常扣行动力与回合');
{
  const gs = fresh();
  placeShift(gs);
  const staminaBefore = gs.player.stamina;
  const turnBefore = gs.turn;
  const dest = director.move('right');

  assert(dest === 1 && gs.player.x === 1, '徒步落到 idx 1', gs.player.x);
  assert(gs.vehicle.current === null && gs.vehicle.available.length === 0, '无载具保持不变');
  assert(!queueHasShift(gs), '徒步不触发移形', gs.linkSkillQueue);
  assert(!lastMove?.byVehicle, 'MOVE 事件不带 byVehicle', lastMove);
  assert(lastMove?.distance === 1, '徒步路径长度 = 1', lastMove?.distance);
  assert(gs.turn === turnBefore + 1, '徒步只推进 1 回合', [turnBefore, gs.turn]);
  assert(gs.player.stamina === staminaBefore - 1, '徒步扣 1 行动力', gs.player.stamina);
  assert(gs.team.dailyDistanceMoved === 1, '徒步同样累计移形距离', gs.team.dailyDistanceMoved);
}

// ── 3. 载具不允许（地形/落点限制）：整体拦截 ──
head('地形/落点限制（拖拉机 landFilter）：整键拦截');
{
  const gs = fresh();
  placeShift(gs);
  // 拖拉机：line + landFilter tier2=设施；idx 1 是空地 → 载具不允许落该格
  equip(gs, 'vehicle_tractor', 2);
  resetSeen();
  const before = snapshot(gs);
  const dest = director.move('right');
  assertBlocked(gs, before, dest, '拖拉机落在空地');
}

// ── 4. 载具不允许（边界/射程无合法落点）：整体拦截 ──
head('方向越界（无相邻格）：整键拦截');
{
  const gs = fresh();
  placeShift(gs);
  gs.player.x = 2; // 右上：再往右越界，没有相邻外圈格
  equip(gs, 'vehicle_wheel', 2); // 方向型，射程 2
  resetSeen();
  const before = snapshot(gs);
  const dest = director.move('right');
  assertBlocked(gs, before, dest, '轮子朝边界');
}

// ── 5. 随机型载具（momo 图腾）不接受 WASD 指定落点：整体拦截 ──
head('随机型载具不接受 WASD 指定目标：整键拦截');
{
  const gs = fresh();
  placeShift(gs);
  equip(gs, 'vehicle_totem_momo', 1);
  resetSeen();
  const before = snapshot(gs);
  const dest = director.move('right');
  assertBlocked(gs, before, dest, 'momo 图腾');
}

// ── 6. 次数耗尽：再次 WASD 回到徒步语义（无载具）──
head('次数耗尽后：WASD 回到徒步语义');
{
  const gs = fresh();
  placeShift(gs);
  equip(gs, 'vehicle_horse', 1); // 只剩 1 次

  director.move('right'); // 载具移动 → 次数 -1 → 自动卸下
  assert(gs.player.x === 1 && gs.vehicle.current === null, '用完 1 次自动卸下、落到 idx 1',
    [gs.player.x, gs.vehicle.current]);
  assert(queueHasShift(gs), '本次载具移动仍解锁移形（次数此前未耗尽）', gs.linkSkillQueue);

  // 清空本次窗口与冷却，再按一次 WASD，验证纯徒步语义
  gs.linkSkillQueue.length = 0;
  resetCooldown(gs);
  resetSeen();
  const staminaBefore = gs.player.stamina;
  const turnBefore = gs.turn;
  const dest = director.move('right');

  assert(dest === 2 && gs.player.x === 2, '徒步落到 idx 2', gs.player.x);
  assert(gs.vehicle.current === null && gs.vehicle.available.length === 0, '无载具可扣（已耗尽）',
    gs.vehicle);
  assert(!queueHasShift(gs), '次数耗尽后不再解锁移形', gs.linkSkillQueue);
  assert(!lastMove?.byVehicle, 'MOVE 事件不带 byVehicle', lastMove);
  assert(gs.turn === turnBefore + 1, '徒步只推进 1 回合', [turnBefore, gs.turn]);
  assert(gs.player.stamina === staminaBefore - 1, '徒步扣 1 行动力', gs.player.stamina);
}

// ── 7. 载具移动的路径模拟只用于判定/长度，不结算中间格（既有规则回归）──
head('载具 WASD 1 格：模拟路径不结算中间格');
{
  const gs = fresh();
  placeShift(gs);
  equip(gs, 'vehicle_flying_carpet', 3); // any，无 landFilter
  resetSeen();
  MovementSystem.moveStep(gs, 'right');
  assert(seen.hooks.join('|') === 'pass:1|enter:1|moveEnd:1',
    '1 格载具移动：仅终点经过 + 进入 + 一次移动后钩子', seen.hooks);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
