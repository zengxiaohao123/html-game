// 小径（terrain_path）专项冒烟：连通判定 / 生效 / 还原 / 移动 / 载具 / 祈福 / 扩建自动延续
// 用法：node tools/smoke-path.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import { registerFacilities } from '../src/data/facilities.js';
import { expandMapInPlace, EXPAND_AXIS } from '../src/systems/MapExpandSystem.js';
import { recomputePathEffect, initPathOnLoad } from '../src/systems/PathSystem.js';
import { harvestPotato, potatoStoredOf } from '../src/systems/PotatoSystem.js';
import { setFacilityDoorOpen } from '../src/systems/CreatureSystem.js';
import { enterShop, leaveShop } from '../src/systems/ShopSystem.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { rollSpawnTerrain, TERRAIN_SPAWN_WEIGHTS, OUTER_TERRAIN_SPAWN_WEIGHTS } from '../src/data/terrains.js';
import { computePathComponents } from '../src/core/PathGraph.js';
import { capacityExtra } from '../src/systems/CapacitySystem.js';
import { MovementSystem } from '../src/systems/MovementSystem.js';
import { VehicleSystem } from '../src/systems/VehicleSystem.js';
import { BuildSystem } from '../src/systems/BuildSystem.js';
import { BlessSystem } from '../src/systems/BlessSystem.js';
import { Storage } from '../src/state/storage.js';
import { Distance } from '../src/core/Distance.js';
import {
  playerRef, setPlayerRef, getTile, refsEqual, isLegalStandRef, tileRefKey,
} from '../src/core/TileAccess.js';
import { EventBus } from '../src/core/EventBus.js';
import { GE } from '../src/core/GameEvents.js';

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

registerFacilities();

// 让新地块地形抽样稳定落在「草地」，避免扩建随机刷出小径导致断言不稳定
Math.random = () => 0.5;

const PATH = 'terrain_path';
const fenceRef = (r, c) => ({ kind: 'fence', row: r, col: c });
const fIdx = (gs, r, c) => r * Distance.fenceDimsOf(gs).cols + c;

function makeGS() {
  const gs = createInitialState();
  gs.uiState = gs.uiState || {};
  gs.uiState.lastMoveAt = 0;
  while (Distance.mapDimsOf(gs.map).cols < 5) expandMapInPlace(gs, EXPAND_AXIS.LENGTH);
  while (Distance.mapDimsOf(gs.map).rows < 5) expandMapInPlace(gs, EXPAND_AXIS.WIDTH);
  return gs;
}

function paint(gs, cells, terrain = PATH) {
  for (const [r, c] of cells) {
    const cell = gs.map.fence[fIdx(gs, r, c)];
    cell.terrain = terrain;
    cell.terrainAmount = 0;
    cell.states = [];
  }
}

const oIdx = (gs, x, y) => Distance.outerXYToIdx(gs.map, x, y);

console.log('═══ 1. 连通判定 ═══');
{
  const gs = makeGS();
  check(Distance.fenceDimsOf(gs).rows === 3 && Distance.fenceDimsOf(gs).cols === 3, '测试地图 5×5（栅栏 3×3）');

  // 单格角格：fence(0,0) 邻接两个外圈格 → 生效
  paint(gs, [[0, 0]]);
  let res = recomputePathEffect(gs);
  check(gs.map.fence[fIdx(gs, 0, 0)].isPathOuter === true, '单格角格小径邻接 2 个外圈格 → 生效');
  check(res.effectiveCount === 1, `生效数 1（实际 ${res.effectiveCount}）`);

  // 长链：左列三格 → 全部生效
  paint(gs, [[0, 0], [1, 0], [2, 0]]);
  recomputePathEffect(gs);
  const comps = computePathComponents(gs);
  const comp = comps.components.find((c) => c.fenceIdx.length === 3);
  check(!!comp && comp.effective, '长链（3 格）连通且生效');
  check([0, 1, 2].every((r) => gs.map.fence[fIdx(gs, r, 0)].isPathOuter), '长链 3 格全部标记生效');
  void comps;

  // 双路线：另一条只有 1 个端点 → 不生效（(1,2) 在 3×3 栅栏中只邻接右外圈 1 格，且与左列链不相邻）
  paint(gs, [[0, 0], [1, 0], [2, 0], [1, 2]]);
  recomputePathEffect(gs);
  check(gs.map.fence[fIdx(gs, 1, 2)].isPathOuter !== true, '单端点小径不生效');
  check(gs.map.fence[fIdx(gs, 1, 0)].isPathOuter === true, '另一条已连通小径不受影响');
}

console.log('\n═══ 2. 容量 ═══');
{
  const gs = makeGS();
  const fenceCount = gs.map.fence.length;
  check(fenceCount === 9, `栅栏格 9（实际 ${fenceCount}）`);
  check(capacityExtra(gs) === fenceCount - 1, `无生效小径时容量加成 = 8（实际 ${capacityExtra(gs)}）`);
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  check(capacityExtra(gs) === fenceCount - 3 - 1, `3 格生效 → 容量加成 = 5（实际 ${capacityExtra(gs)}）`);
}

console.log('\n═══ 3. 切断还原（地形被改） ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  const mid = gs.map.fence[fIdx(gs, 1, 1)];
  mid.contentId = 'facility_wheat';
  mid.contentState = { planted: true };
  check(mid.isPathOuter === true, '切断前中格生效');

  gs.map.fence[fIdx(gs, 1, 1)].terrain = 'terrain_none';
  const res = recomputePathEffect(gs);
  // 中格被改成非小径后也不再生效，与两侧一起进入还原集合（内容会被拆除）
  check(res.reverted.length === 3, `3 格全部退出生效（实际 ${res.reverted.length}）`);
  check(gs.map.fence[fIdx(gs, 1, 0)].contentId === null, '还原时静默拆除地块内容');
  check(gs.map.fence[fIdx(gs, 1, 0)].isPathOuter === false, '失效格取消临时外圈标记');
}

console.log('\n═══ 4. 角色进入 / WASD ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  // 外圈左边缘 (0,2) 右侧即 fence(1,0)
  const from = oIdx(gs, 0, 2);
  setPlayerRef(gs, from);
  gs.player.stamina = 8;
  gs.uiState.lastMoveAt = 0;

  let moveEvent = null;
  const onMove = (p) => { moveEvent = p; };
  EventBus.on(GE.MOVE, onMove);
  const finalIdx = MovementSystem.move(gs, 'right');
  EventBus.off(GE.MOVE, onMove);

  check(finalIdx === null, '落点是生效小径格（无外圈 idx）');
  check(refsEqual(playerRef(gs), fenceRef(1, 0)), '玩家已站上生效小径格');
  check(gs.player.x === null, '兼容镜像 player.x 为 null');
  check(!!moveEvent && refsEqual(moveEvent.toRef, fenceRef(1, 0)), 'MOVE 事件携带 toRef');
  check(isLegalStandRef(gs, fenceRef(1, 0)), '生效小径格是合法落点');

  // 从生效小径格走回外圈
  gs.uiState.lastMoveAt = 0;
  MovementSystem.move(gs, 'left');
  check(refsEqual(playerRef(gs), oIdx(gs, 0, 2)), '可从生效小径格走回外圈');

  // 普通栅栏格不可进入
  gs.uiState.lastMoveAt = 0;
  setPlayerRef(gs, oIdx(gs, 1, 0));
  const blocked = MovementSystem.move(gs, 'down');
  check(blocked === null && refsEqual(playerRef(gs), oIdx(gs, 1, 0)), '普通栅栏格仍不可进入');
}

console.log('\n═══ 5. 内容放置 / 祈福池 ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  const ref = fenceRef(1, 0);

  const placed = BuildSystem.placeContent(gs, ref, 'facility_wheat');
  check(!!placed && placed.ok, '可在生效小径格放置地块内容');
  check(gs.map.fence[fIdx(gs, 1, 0)].contentId === 'facility_wheat', '内容已写入栅栏格');

  const homeBlocked = BuildSystem.placeContent(gs, fenceRef(1, 1), 'facility_home');
  check(!homeBlocked || homeBlocked.ok === false, '临时外圈禁止放置【永恒】内容（家）');

  // 祈福池：候选应包含生效小径格
  setPlayerRef(gs, oIdx(gs, 0, 0));
  gs.player.stamina = 20;
  gs.player.gold = 10;
  gs.uiState.blessing = false;
  const b = BlessSystem.blessStart(gs);
  if (b.ok) {
    const hasFence = b.candidates.some((c) => c.ref && c.ref.kind === 'fence');
    check(hasFence, '祈福候选池包含生效小径格');
    BlessSystem.blessFinish(gs);
  } else {
    check(false, `祈福启动失败：${b.reason}`);
  }
  void getTile; void tileRefKey;
}

console.log('\n═══ 6. 载具（落点 / 最短路径） ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  setPlayerRef(gs, oIdx(gs, 0, 2));
  gs.player.stamina = 20;
  gs.uiState.lastMoveAt = 0;
  gs.vehicle = {
    current: { instanceId: 1, vehicleId: 'vehicle_broom', usageLeft: 2 },
    available: [],
    nextInstanceId: 2,
    chanceUsedToday: false,
  };
  const res = VehicleSystem.tryMove(gs, { type: 'target', targetRef: fenceRef(1, 2) });
  check(res.ok, `扫帚可前往生效小径格（${res.reason || 'ok'}）`);
  check(refsEqual(res.finalRef, fenceRef(1, 2)), '载具落点为生效小径格');
  check(Array.isArray(res.path) && res.path.length > 0, '载具移动经过路径非空');
}

console.log('\n═══ 7. 传送（失效格上角色） ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  setPlayerRef(gs, fenceRef(1, 1));
  const dayBefore = gs.day;
  const turnBefore = gs.turn;
  const staminaBefore = gs.player.stamina;

  gs.map.fence[fIdx(gs, 1, 1)].terrain = 'terrain_none';
  recomputePathEffect(gs);

  check(isLegalStandRef(gs, playerRef(gs)), '角色被传送到合法格');
  check(refsEqual(playerRef(gs), oIdx(gs, 0, 2)) || typeof playerRef(gs) === 'number', '传送目标为外圈（同距优先外圈）');
  check(gs.day === dayBefore && gs.turn === turnBefore, '传送不推进回合 / 天数');
  check(gs.player.stamina === staminaBefore, '传送不消耗行动力');
}

console.log('\n═══ 8. 扩建自动延续 ═══');
{
  const gs = makeGS();
  // 横向连通：外圈左 (0,2) ← fence(1,0) ← fence(1,1) ← fence(1,2) → 外圈右 (4,2)
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  const keep = gs.map.fence[fIdx(gs, 1, 1)];
  keep.contentId = 'facility_wheat';
  check(gs.map.fence[fIdx(gs, 1, 2)].isPathOuter === true, '扩建前右侧端点生效');

  const out = expandMapInPlace(gs, EXPAND_AXIS.LENGTH);
  check(!!out.ok, '扩建成功');
  check(Array.isArray(out.continued) && out.continued.length === 1, `自动补 1 格（实际 ${out.continued?.length}）`);
  const cont = out.continued?.[0];
  const expected = fenceRef(1, 3);
  check(refsEqual(cont, expected), '补格位置 = 从右往左第二列、同一行');

  const cell = gs.map.fence[fIdx(gs, 1, 3)];
  check(cell.terrain === PATH, '补格地形为小径');
  check(cell.isPathOuter === true, '补格已生效');
  check(keep.contentId === 'facility_wheat', '扩建未误拆原生效小径格内容');
  check(gs.map.fence[fIdx(gs, 1, 3)].contentId === null, '补格免费（无物品消耗，格子也无内容）');

  // 玩家物品数量不变
  const before = JSON.stringify(gs.inventory || {});
  expandMapInPlace(gs, EXPAND_AXIS.LENGTH);
  check(JSON.stringify(gs.inventory || {}) === before, '自动延续不消耗玩家物品');
}

console.log('\n═══ 8b. 扩建自动延续（上侧） ═══');
{
  const gs = makeGS();
  // 纵向连通：外圈上 (1,0) ← fence(0,0) ← fence(1,0) ← fence(2,0) → 外圈下 (1,4)
  paint(gs, [[0, 0], [1, 0], [2, 0]]);
  recomputePathEffect(gs);
  check(gs.map.fence[fIdx(gs, 0, 0)].isPathOuter === true, '扩建前上侧端点生效');

  const out = expandMapInPlace(gs, EXPAND_AXIS.WIDTH);
  check(!!out.ok, '宽度扩建成功');
  check(Array.isArray(out.continued) && out.continued.length === 1, `上侧自动补 1 格（实际 ${out.continued?.length}）`);
  check(refsEqual(out.continued?.[0], fenceRef(0, 0)), '补格位置 = 从上往下第二行、同一列');
  check(gs.map.fence[fIdx(gs, 0, 0)].terrain === PATH, '上侧补格地形为小径');
  check(gs.map.fence[fIdx(gs, 0, 0)].isPathOuter === true, '上侧补格已生效');
  check(gs.map.fence[fIdx(gs, 2, 0)].isPathOuter === true, '原纵向小径仍保持生效');
}

console.log('\n═══ 8c. 原外圈小径不触发自动延续 ═══');
{
  const gs = makeGS();
  // 真实外圈右边缘三格改成小径（互相连通 → 属于同一个生效连通块），
  // 但它们本来就是外圈格，不属于「原栅栏内、因连通被视为外圈」的对象。
  for (const y of [1, 2, 3]) {
    const t = gs.map.outerTiles[oIdx(gs, 4, y)];
    t.terrain = PATH;
    t.terrainAmount = 0;
  }
  recomputePathEffect(gs);
  const comps = computePathComponents(gs);
  check(comps.components.some((c) => c.effective && c.fenceIdx.length === 0),
    '纯外圈小径也能形成生效连通块（前置条件成立）');

  const out = expandMapInPlace(gs, EXPAND_AXIS.LENGTH);
  check(!!out.ok, '扩建成功');
  check(Array.isArray(out.continued) && out.continued.length === 0,
    `原外圈小径不启用自动延续（实际补 ${out.continued?.length} 格）`);
}

console.log('\n═══ 8d. 连续快速扩建：外圈地块不会随机成小径 ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);

  const prevRandom = Math.random;
  // 极端抽样：任何随机池都不应再产出小径
  Math.random = () => 0.999;
  let carriedBroken = 0;
  let addedPath = 0;
  let badContinued = 0;
  const seq = [EXPAND_AXIS.LENGTH, EXPAND_AXIS.LENGTH, EXPAND_AXIS.WIDTH, EXPAND_AXIS.LENGTH, EXPAND_AXIS.WIDTH];
  for (const axis of seq) {
    const before = gs.map.outerTiles.map((t) => ({ idx: t.idx, terrain: t.terrain }));
    const out = expandMapInPlace(gs, axis);
    if (!out.ok) { carriedBroken++; continue; }
    // 1) 搬运过来的外圈地块地形必须原样保留
    for (const o of before) {
      const ni = out.idxMap.get(o.idx);
      if (ni === undefined) continue;
      if (gs.map.outerTiles[ni]?.terrain !== o.terrain) carriedBroken++;
    }
    // 2) 新增外圈地块不得随机成小径（生成池在源头剔除）
    for (const i of out.remap.addedOuterIdx) {
      if (gs.map.outerTiles[i]?.terrain === PATH) addedPath++;
    }
    // 3) 自动延续只能落在栅栏内（原本属于栅栏、因连通被视为外圈的格子）
    for (const r of out.continued || []) {
      if (!r || r.kind !== 'fence') badContinued++;
    }
    recomputePathEffect(gs);
  }
  check(carriedBroken === 0, '连续扩建后搬运的外圈地块地形均未被改写');
  check(addedPath === 0, '连续扩建新增的外圈地块不会随机成小径');
  check(badContinued === 0, '自动延续只落在栅栏内格，从不触碰外圈地块');
  check(rollSpawnTerrain(() => 0.999) !== PATH, '初始地形池不会随机出小径');
  check(!TERRAIN_SPAWN_WEIGHTS.some((x) => x.id === PATH), '初始地形权重表不含小径');
  check(!OUTER_TERRAIN_SPAWN_WEIGHTS.some((x) => x.id === PATH), '外圈地形权重表不含小径');
  Math.random = prevRandom;
}

console.log('\n═══ 8e. 生效小径格上的专属功能（ref 级） ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  const pathRef = fenceRef(1, 1);
  const cell = getTile(gs, pathRef);

  // 土豆田块：按 fence ref 收获
  cell.contentId = 'facility_potato';
  cell.contentState = { potatoStored: 5 };
  const potatoBefore = InventorySystem.countItem(gs, 'item_potato');
  const r = harvestPotato(gs, pathRef, 3);
  check(r.actual === 3 && r.touched.length === 1, '生效小径格上的土豆田块按 ref 正常结算');
  check(potatoStoredOf(getTile(gs, pathRef)) === 2, '生效小径格上的土豆库存正确扣减');
  check(InventorySystem.countItem(gs, 'item_potato') === potatoBefore + 3, '收获土豆进入背包');

  // 鸡舍：按 fence ref 开门 / 关门
  cell.contentId = 'facility_henhouse';
  cell.contentState = {};
  const door = setFacilityDoorOpen(gs, pathRef, false);
  check(door.ok && getTile(gs, pathRef).contentState.doorOpen === false, '生效小径格上的鸡舍按 ref 关门');

  // 商店：按 fence ref 进入 / 离开
  cell.contentId = 'resource_shop';
  cell.contentState = {};
  setPlayerRef(gs, pathRef);
  const enter = enterShop(gs, pathRef);
  check(enter.ok === true, '生效小径格上的商店按 ref 可进入');
  leaveShop(gs, pathRef);
}

console.log('\n═══ 9. 存档往返 ═══');
{
  const gs = makeGS();
  paint(gs, [[1, 0], [1, 1], [1, 2]]);
  recomputePathEffect(gs);
  setPlayerRef(gs, fenceRef(1, 1));
  const saved = Storage.save(2, gs);
  check(saved === true, 'save(2) 成功');
  const loaded = Storage.load(2);
  check(!!loaded, 'load(2) 成功');
  check(!!loaded && refsEqual(playerRef(loaded), fenceRef(1, 1)), '读档后玩家位置在生效小径格');
  initPathOnLoad(loaded);
  check(loaded.map.fence[fIdx(loaded, 1, 1)].isPathOuter === true, '读档重算后生效标记正确');
  check(capacityExtra(loaded) === loaded.map.fence.length - 3 - 1, '读档后容量加成一致');
  Storage.clearSlot(2);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-path 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
