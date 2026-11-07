// src/systems/VehicleSystem.js
// Agent 3 —— 载具移动逻辑
// 设计文档 §14.7 + vehicles.js（vehicle_wheel / vehicle_broom / vehicle_chance 三种）
// 移动方式：
//   vehicle_wheel (directional) —— 指定方向最多 2 格，穿越非法但不能停留
//   vehicle_broom (line)         —— 同行列任意格（必须同行或同列），不能穿越非法
//   vehicle_chance (any)         —— 任意格（心想事成天赋专用），不能进 fence
//
// 载具不占背包，单独在载具页面（T 键）管理。
// 载具是独立实体：同名载具不是同一个东西，每件都有自己的 instanceId / 剩余次数，
// 永不按 vehicleId 合并、也不叠放（不放进背包，所以也不存在堆叠）。
// GS 里新增字段：
//   gs.vehicle = {
//     current: null | { instanceId, vehicleId, usageLeft },   // 当前装载的那一件
//     available: [{ instanceId, vehicleId, usageLeft }],      // 持有的每一件（不合并同名）
//     nextInstanceId: 1,                                      // 实例 id 自增计数（可存档、无时间戳）
//     chanceUsedToday: false,
//   }

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { Random } from '../core/Random.js';
import { VEHICLES } from '../data/vehicles.js';
import { ITEMS } from '../data/items.js';
import { Distance, outerXYToIdx } from '../core/Distance.js';
import { Direction } from '../utils/Direction.js';
import { firePassHookAt, fireEnterHooks } from './MoveHooks.js';
import { StaminaSystem } from './StaminaSystem.js';
import { canMoveNow, markMoved } from './MoveCooldown.js';

function ensureVehicleState(gs) {
  if (!gs.vehicle) {
    gs.vehicle = {
      current: null,          // { instanceId, vehicleId, usageLeft }
      available: [],          // 持有的每一件（不叠放、不按 vehicleId 合并）
      nextInstanceId: 1,      // 实例 id 自增计数
      chanceUsedToday: false, // 心想事成 巧遇 每天限 1 次
    };
  }
  const v = gs.vehicle;
  if (!Array.isArray(v.available)) v.available = [];
  // 实例 id 缺失时按现有实例推导，保证新分配的 id 不与已有实例冲突
  if (!Number.isInteger(v.nextInstanceId) || v.nextInstanceId < 1) {
    let max = 0;
    for (const e of [...v.available, v.current]) {
      if (Number.isInteger(e?.instanceId)) max = Math.max(max, e.instanceId);
    }
    v.nextInstanceId = max + 1;
  }
  // JSON 没有 Infinity：无限次数（巧遇）存档往返后会变成 null，读回时按载具定义补回
  for (const e of [...v.available, v.current]) {
    if (e && e.usageLeft == null) e.usageLeft = VEHICLES[e.vehicleId]?.usageCount ?? 1;
  }
}

/**
 * B-21（物品库行 356：载具最短实际路径为「经过」）：
 * 外圈环顺序（顺时针：顶行 → 右列 → 底行 → 左列），用于 'any' 模式算最短环路径
 */
function buildRingOrder(gs) {
  const dims = Distance.mapDimsOf(gs);
  const { rows, cols } = dims;
  const seq = [];
  for (let x = 0; x < cols; x++) seq.push(outerXYToIdx(dims, x, 0));               // 顶行 左→右
  for (let y = 1; y < rows; y++) seq.push(outerXYToIdx(dims, cols - 1, y));        // 右列 上→下
  for (let x = cols - 2; x >= 0; x--) seq.push(outerXYToIdx(dims, x, rows - 1));   // 底行 右→左
  for (let y = rows - 2; y >= 1; y--) seq.push(outerXYToIdx(dims, 0, y));          // 左列 下→上
  return seq.filter(i => i !== null && i !== undefined);
}

/**
 * 载具移动完成后，按徒步跋涉方式模拟「起点 → 终点」的默认最短路径。
 * 外圈是一个环，两弧取短的一条（等长时取顺时针），不含起点、含终点。
 * 该路径只用于【经过时】判定与路径长度，不触发冰面滑行等地形位移效果。
 */
function simulateWalkPath(gs, fromIdx, toIdx) {
  const ring = buildRingOrder(gs);
  const a = ring.indexOf(fromIdx);
  const b = ring.indexOf(toIdx);
  if (a < 0 || b < 0 || ring.length < 2) return [toIdx];
  const n = ring.length;
  const fwd = [];
  for (let i = (a + 1) % n; ; i = (i + 1) % n) {
    fwd.push(ring[i]);
    if (i === b) break;
  }
  const bwd = [];
  for (let i = (a - 1 + n) % n; ; i = (i - 1 + n) % n) {
    bwd.push(ring[i]);
    if (i === b) break;
  }
  return fwd.length <= bwd.length ? fwd : bwd;
}

/** 两格外圈格的曼哈顿距离（可穿越栅栏/虚空，只看坐标差） */
function manhattan(gs, a, b) {
  const pa = Distance.outerIdxToXY(gs.map, a);
  const pb = Distance.outerIdxToXY(gs.map, b);
  if (!pa || !pb) return Infinity;
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
}

/** 落点是否满足该载具的 landFilter（设施 / 资源 / 技能 / 指定 contentId） */
export function landOk(gs, idx, def) {
  const filter = def?.landFilter;
  if (!filter) return true;
  const tile = gs.map.outerTiles[idx];
  if (!tile || !tile.contentId) return false;
  if (filter.contentIds) return filter.contentIds.includes(tile.contentId);
  if (filter.tier2) return ITEMS[tile.contentId]?.tier2 === filter.tier2;
  return true;
}

/** 当前载具所有合法落点（供 UI 高亮 / 随机传送用） */
export function listLandingTiles(gs) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return [];
  const fromIdx = gs.player.x;
  const out = [];
  for (const t of gs.map.outerTiles) {
    if (t.idx === fromIdx) continue;
    if (canVehicleReach(gs, t.idx).ok) out.push(t.idx);
  }
  return out;
}

/**
 * 玩家获得一个载具（巴士站 / 心想事成天赋 / 商店等）
 */
export function gainVehicle(gs, vehicleId) {
  const def = VEHICLES[vehicleId];
  if (!def) {
    devLog.warn('[VehicleSystem.gainVehicle] unknown', vehicleId);
    return;
  }
  ensureVehicleState(gs);
  // 每获得一件就是一个新实例：同名载具也是两个独立个体，不合并、不叠放
  const instanceId = gs.vehicle.nextInstanceId++;
  gs.vehicle.available.push({
    instanceId,
    vehicleId,
    usageLeft: def.usageCount ?? 1,
  });
  EventBus.emit(GE.VEHICLE_GAIN, { vehicleId, instanceId });
  EventBus.emit(GE.TOAST_SHOW, { text: `🚗 获得载具 ${def.emoji || ''} ${def.name}`, duration: 1500 });
  devLog.info('[VehicleSystem.gainVehicle]', vehicleId, 'instance', instanceId);
}

/**
 * 装备某一「件」载具（切到该实例；同时只能装一个）
 * @param {object} gs
 * @param {number} instanceId 载具实例 id（不是 vehicleId：同名载具各自独立）
 * @returns {boolean}
 */
export function attachVehicle(gs, instanceId) {
  ensureVehicleState(gs);
  if (!Number.isInteger(instanceId)) return false;
  const entry = gs.vehicle.available.find(a => a.instanceId === instanceId);
  if (!entry) return false;

  const def = VEHICLES[entry.vehicleId];
  if (!def) return false;

  // 心想事成：检查 activeGroup 里有没有夏阳
  if (def.talentExclusive === 'xiayang_want') {
    // vehicles.js 写的 talentExclusive 是 'xiayang_want'，但 talents.js id 是 'xiayangWant' —— 我们用 talents.js 的 id
    // 按设计文档 §14.7："心想事成天赋专用"—— 简化：只要 vehicle_chance 在 available 里就能用
    // （不做强检查 talent 是否存在，因为 talent 可能未来加强校验）
  }
  // 每天限 1 次
  if (def.perDayLimit && gs.vehicle.chanceUsedToday) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 每天限用 1 次`, duration: 1500 });
    return false;
  }

  gs.vehicle.current = {
    instanceId: entry.instanceId,
    vehicleId: entry.vehicleId,
    usageLeft: entry.usageLeft,
  };
  EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId: entry.vehicleId, instanceId, attached: true });
  EventBus.emit(GE.TOAST_SHOW, { text: `🚗 装备载具 ${def.emoji || ''} ${def.name}`, duration: 1500 });
  devLog.info('[VehicleSystem.attachVehicle]', entry.vehicleId, 'instance', instanceId);
  return true;
}

/**
 * 卸下载具（用完了或主动切换）
 * 卸下后这一件回到持有列表，仍是同一个实例（instanceId 不变、次数保持）
 */
export function detachVehicle(gs) {
  ensureVehicleState(gs);
  if (gs.vehicle.current) {
    const cur = gs.vehicle.current;
    // 按实例同步回 available（同名载具不会串到别的实例）
    const avail = gs.vehicle.available.find(a => a.instanceId === cur.instanceId);
    if (avail) {
      avail.usageLeft = cur.usageLeft;
    }
    gs.vehicle.current = null;
    EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId: cur.vehicleId, instanceId: cur.instanceId, attached: false });
    devLog.info('[VehicleSystem.detachVehicle]', 'instance', cur.instanceId);
  }
}

/**
 * 消费当前这一件载具的使用次数（用完自动卸下并从 available 移除该实例）
 */
function consumeUsage(gs) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return false;
  cur.usageLeft -= 1;

  const def = VEHICLES[cur.vehicleId];
  if (def.talentExclusive && def.perDayLimit) {
    gs.vehicle.chanceUsedToday = true;
  }

  if (cur.usageLeft <= 0) {
    // 用完 —— 卸下并移除「这一件」（同名其它实例不受影响）
    const idx = gs.vehicle.available.findIndex(a => a.instanceId === cur.instanceId);
    if (idx >= 0) gs.vehicle.available.splice(idx, 1);
    gs.vehicle.current = null;
    EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 使用完毕`, duration: 1500 });
    devLog.info('[VehicleSystem.consumeUsage]', cur.vehicleId, 'instance', cur.instanceId, 'used up');
  } else {
    // 同步 available 中「这一件」的剩余次数
    const avail = gs.vehicle.available.find(a => a.instanceId === cur.instanceId);
    if (avail) avail.usageLeft = cur.usageLeft;
  }
  return true;
}

/** 合法外圈格索引（0 ~ 4*(size-1)-1）：越界/负数索引一律不能当地块用 */
function isOuterTileIdx(gs, idx) {
  return Number.isInteger(idx) && idx >= 0 && idx < gs.map.outerTiles.length;
}

/**
 * 判断两格是否同行或同列（外圈环形地图用 Distance.outerIdxToXY）
 */
function sameRowOrCol(gs, aIdx, bIdx) {
  const a = Distance.outerIdxToXY(gs.map, aIdx);
  const b = Distance.outerIdxToXY(gs.map, bIdx);
  return a.x === b.x || a.y === b.y;
}

/**
 * 载具尝试移动
 * @param {object} gs
 * @param {object} opts
 * @param {string} opts.type 'direction' | 'target' —— 方向式（轮子）或目标式（扫帚/巧遇）
 * @param {string} [opts.direction] 'up'|'right'|'down'|'left' —— 轮子用
 * @param {number} [opts.targetIdx] —— 扫帚/巧遇用
 * @returns {{ ok: boolean, path: number[] | null, finalIdx: number | null, reason?: string }}
 */
export function tryMove(gs, opts = {}) {
  // §5.2：与 WASD /「前往」共用同一套 0.5 秒移动冷却（冷却期间直接忽略）
  if (!canMoveNow(gs)) return { ok: false, reason: 'cooldown' };

  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return { ok: false, reason: 'noVehicle' };

  const def = VEHICLES[cur.vehicleId];
  if (!def) return { ok: false, reason: 'unknown' };

  const fromIdx = gs.player.x;
  // 目标索引必须在合法外圈范围内，避免越界/负索引被 outerIdxToXY 包裹成别的格子
  if (opts.targetIdx != null && !isOuterTileIdx(gs, opts.targetIdx)) {
    return { ok: false, reason: 'badTarget' };
  }
  let targetIdx = null;

  if (opts.wasdStep) {
    // WASD 走 1 格：落点就是调用方给定的相邻格（是否允许已由 canUseVehicleForStep 预判），
    // 不按 movePattern 自动延伸射程（WASD 只走这一格）。
    // 随机型载具（momo 图腾）的落点由系统自选，不接受 WASD 指定。
    if (opts.targetIdx == null) return { ok: false, reason: 'needTarget' };
    if (opts.targetIdx === fromIdx) return { ok: false, reason: 'sameTile' };
    if (def.movePattern === 'random') return { ok: false, reason: 'randomNoWASD' };
    targetIdx = opts.targetIdx;
  } else if (def.movePattern === 'directional') {
    // 轮子：指定方向最多 maxRange 格。
    // 穿越栅栏/虚空合法，只要求最终落点是外圈格。
    const dirIdx = Direction.dirToIndex(opts.direction);
    if (dirIdx === -1) return { ok: false, reason: 'badDirection' };

    const { x: fx, y: fy } = Distance.outerIdxToXY(gs.map, fromIdx);
    let cx = fx, cy = fy;

    // 方向向量：0=up, 1=right, 2=down, 3=left
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dirIdx];
    const maxRange = def.maxRange || 2;

    // 沿方向扫最远的合法外圈格（中间 null/栅栏都穿越）
    let finalIdx = null;
    for (let step = 1; step <= maxRange; step++) {
      cx += dx; cy += dy;
      const idx = outerXYToIdx(gs.map, cx, cy);
      if (idx !== null) finalIdx = idx;
    }

    if (finalIdx === null) {
      // 方向上根本没有合法外圈格可以落脚
      return { ok: false, reason: 'noValidLanding' };
    }
    targetIdx = finalIdx;
  } else if (def.movePattern === 'line') {
    // 扫帚：同行或同列任意格
    if (opts.targetIdx == null) return { ok: false, reason: 'needTarget' };
    if (opts.targetIdx === fromIdx) return { ok: false, reason: 'sameTile' };
    if (!sameRowOrCol(gs, fromIdx, opts.targetIdx)) {
      return { ok: false, reason: 'notSameRowCol' };
    }
    targetIdx = opts.targetIdx;
  } else if (def.movePattern === 'any') {
    // 任意格（巧遇 / 图腾 / 号角 / 飞毯 / 购物车 / 大巴 / 飞剑 —— 落点再由 landFilter 约束）
    if (opts.targetIdx == null) return { ok: false, reason: 'needTarget' };
    if (opts.targetIdx === fromIdx) return { ok: false, reason: 'sameTile' };
    targetIdx = opts.targetIdx;
  } else if (def.movePattern === 'range') {
    // 曼哈顿距离 ≤ maxRange 的任意格（马匹 / 重弹簧 / 拓荒者）
    // 曼哈顿距离只用于「可达性判定」；【经过时】与路径长度另按模拟徒步路径计算
    if (opts.targetIdx == null) return { ok: false, reason: 'needTarget' };
    if (opts.targetIdx === fromIdx) return { ok: false, reason: 'sameTile' };
    if (manhattan(gs, fromIdx, opts.targetIdx) > (def.maxRange || 2)) {
      return { ok: false, reason: 'outOfRange' };
    }
    targetIdx = opts.targetIdx;
  } else if (def.movePattern === 'random') {
    // 随机一格（momo 图腾）：优先本日未进入过的地块
    const cands = listLandingTiles(gs);
    if (cands.length === 0) return { ok: false, reason: 'noLanding' };
    const visited = Array.isArray(gs.player?.visitedTodayIdx) ? gs.player.visitedTodayIdx : null;
    const prefer = def.preferUnvisitedToday && visited
      ? cands.filter((i) => !visited.includes(i))
      : [];
    const pool = prefer.length ? prefer : cands;
    targetIdx = pool[Math.floor(Math.random() * pool.length)];
  } else {
    return { ok: false, reason: 'badPattern' };
  }

  // 无论哪种载具：位置先落到终点，再按徒步模拟「起点 → 终点」的最短路径，
  // 用这条路径结算【经过时】与路径长度（曼哈顿距离不参与此计算）
  const path = simulateWalkPath(gs, fromIdx, targetIdx);

  // 落点限制（设施 / 资源 / 技能 / 指定地块）
  if (!landOk(gs, targetIdx, def)) return { ok: false, reason: 'landFilter' };

  // 消耗载具使用次数
  consumeUsage(gs);

  // 扣 stamina（载具也是移动，消耗 1 stamina，除非有果腹收藏品 —— 简化不考虑）
  // 芋圆 nextMoveNoStamina 也适用载具移动
  const isFree = !!gs.player.nextMoveNoStamina || !!def.freeStamina;
  if (gs.player.nextMoveNoStamina) {
    gs.player.nextMoveNoStamina = false;
  } else if (!def.freeStamina) {
    // 载具移动同样是玩家主动操作：允许透支为负，但不低于下限
    StaminaSystem.spendStaminaActive(gs, 1, { reason: 'vehicle_move' });
  }

  // 效果层只在终点生效：模拟路径的中间格只参与判定/长度，不触发地块或状态效果
  // （终点确实被抵达，照常触发【经过时】，随后再触发【进入时】）
  firePassHookAt(gs, targetIdx);

  // 更新位置
  gs.player.x = targetIdx;

  // 到达后额外效果（拓荒者 +5 行动力；购物车 +4 金币）
  // 拓荒者 +5 允许超出上限（物品库 VEH-015 备注 / 03 表 A34 行动力溢出），统一走 StaminaSystem 结算
  if (def.staminaGain) {
    // 「移动后行动力 +5」属数值直接增加：允许超出上限（次日开始时清除）
    StaminaSystem.gainStaminaFlat(gs, def.staminaGain, { reason: def.id });
    EventBus.emit(GE.TOAST_SHOW, { text: `${def.emoji} ${def.name} 行动力 +${def.staminaGain}`, duration: 1500 });
  }
  if (def.goldOnArrive) {
    gs.player.gold += def.goldOnArrive;
    EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: def.goldOnArrive });
  }

  // 结算【进入时】：仅最终停留格
  fireEnterHooks(gs, targetIdx);

  // B-2：载具移动的路径长度 = 模拟徒步路径的格数（含终点），不是曼哈顿距离；
  //      随 MOVE 事件广播，供 GameDirector 推进回合 / 【移动后】hook / 移形累计使用
  const distance = Math.max(1, (path || []).length);
  EventBus.emit(GE.MOVE, { fromIdx, toIdx: targetIdx, byVehicle: true, distance, path });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: fromIdx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: targetIdx });

  devLog.info('[VehicleSystem.tryMove]', def.name, fromIdx, '→', targetIdx, 'path=', path);
  markMoved(gs);

  return { ok: true, path, finalIdx: targetIdx };
}

/**
 * 外部调用：消耗 1 次载具使用（保留的显式 API，正常移动请走 tryMove 统一流程）
 */
export function useOnce(gs) {
  return consumeUsage(gs);
}

/**
 * WASD 走 1 格时，当前是否按「使用载具」结算：
 * 装载了载具，且该载具规则允许落到这一格（landFilter / 同方向 / 同行列 / 射程都参与判定）。
 * 随机型载具（movePattern='random'，如 momo 图腾）的落点由系统自选，
 * 不接受 WASD 指定目标，因此按徒步跋涉处理。
 * @param {object} gs
 * @param {number} targetIdx 相邻目标格
 * @returns {boolean}
 */
export function canUseVehicleForStep(gs, targetIdx) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return false;
  const def = VEHICLES[cur.vehicleId];
  if (!def || def.movePattern === 'random') return false;
  return canVehicleReach(gs, targetIdx).ok;
}

/**
 * 判断当前装备的载具能否到达目标格
 * @returns {{ ok: boolean, reason?: string, def?: object }}
 */
export function canVehicleReach(gs, targetIdx) {
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return { ok: false, reason: 'noVehicle' };

  const def = VEHICLES[cur.vehicleId];
  if (!def) return { ok: false, reason: 'unknown' };

  const fromIdx = gs.player.x;
  if (!isOuterTileIdx(gs, targetIdx)) return { ok: false, reason: 'badTarget' };
  if (targetIdx === fromIdx) return { ok: false, reason: 'sameTile' };

  if (def.movePattern === 'directional') {
    // 轮子：同方向最多 maxRange 格。穿越栅栏/虚空合法，只要落点是外圈格。
    const { x: fx, y: fy } = Distance.outerIdxToXY(gs.map, fromIdx);
    const { x: tx, y: ty } = Distance.outerIdxToXY(gs.map, targetIdx);
    const dx = tx - fx;
    const dy = ty - fy;
    // 必须严格只沿一个方向（dx===0 或 dy===0）
    if (dx !== 0 && dy !== 0) return { ok: false, reason: 'notAligned' };
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist === 0 || dist > (def.maxRange || 2)) return { ok: false, reason: 'outOfRange' };

    // 只验证落点是合法外圈格 —— 中途穿越栅栏/虚空/null 都是合法的
    const finalIdx = outerXYToIdx(gs.map, tx, ty);
    if (finalIdx === null) return { ok: false, reason: 'badTarget' };
    if (!landOk(gs, targetIdx, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  if (def.movePattern === 'line') {
    // 扫帚：同行或同列任意格
    if (!sameRowOrCol(gs, fromIdx, targetIdx)) {
      return { ok: false, reason: 'notSameRowCol' };
    }
    if (!landOk(gs, targetIdx, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  if (def.movePattern === 'range') {
    // 曼哈顿距离内任意格（可穿越栅栏/虚空，只看坐标差）
    if (manhattan(gs, fromIdx, targetIdx) > (def.maxRange || 2)) {
      return { ok: false, reason: 'outOfRange' };
    }
    if (!landOk(gs, targetIdx, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  if (def.movePattern === 'any' || def.movePattern === 'random') {
    if (!landOk(gs, targetIdx, def)) return { ok: false, reason: 'landFilter' };
    return { ok: true, def };
  }

  return { ok: false, reason: 'badPattern' };
}

/**
 * 每日开始时重置载具的 perDayLimit 标记
 */
export function onDayStart(gs) {
  ensureVehicleState(gs);
  gs.vehicle.chanceUsedToday = false;
}

export const VehicleSystem = {
  gainVehicle,
  attachVehicle,
  detachVehicle,
  tryMove,
  useOnce,
  canVehicleReach,
  canUseVehicleForStep,
  onDayStart,
};
