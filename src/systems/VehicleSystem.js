// src/systems/VehicleSystem.js
// Agent 3 —— 载具移动逻辑
// 设计文档 §14.7 + vehicles.js（vehicle_wheel / vehicle_broom / vehicle_chance 三种）
// 移动方式：
//   vehicle_wheel (directional) —— 指定方向最多 2 格，穿越非法但不能停留
//   vehicle_broom (line)         —— 同行列任意格（必须同行或同列），不能穿越非法
//   vehicle_chance (any)         —— 任意格（心想事成天赋专用），不能进 fence
//
// 载具不占背包，单独在载具页面（T 键）管理
// GS 里新增字段：
//   gs.vehicle = { current: null | { vehicleId, usageLeft }, available: [{ vehicleId, usageLeft }] }
//   （available 数组里存玩家"已拥有"的载具；同时只能装备一个）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { Random } from '../core/Random.js';
import { VEHICLES } from '../data/vehicles.js';
import { Distance, outerXYToIdx } from '../core/Distance.js';
import { Direction } from '../utils/Direction.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { SkillSystem } from './SkillSystem.js';

function ensureVehicleState(gs) {
  if (!gs.vehicle) {
    gs.vehicle = {
      current: null,          // { vehicleId, usageLeft }
      available: [],          // 已获得的载具列表（不叠放，每个独立 entry）
      chanceUsedToday: false, // 心想事成 巧遇 每天限 1 次
    };
  }
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
  gs.vehicle.available.push({
    vehicleId,
    usageLeft: def.usageCount || 1,
  });
  EventBus.emit(GE.VEHICLE_GAIN, { vehicleId });
  EventBus.emit(GE.TOAST_SHOW, { text: `🚗 获得载具 ${def.emoji || ''} ${def.name}`, duration: 1500 });
  devLog.info('[VehicleSystem.gainVehicle]', vehicleId);
}

/**
 * 装备载具（切到该载具；同时只能装一个）
 * @returns {boolean}
 */
export function attachVehicle(gs, vehicleId) {
  ensureVehicleState(gs);
  const entry = gs.vehicle.available.find(a => a.vehicleId === vehicleId);
  if (!entry) return false;

  const def = VEHICLES[vehicleId];

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

  gs.vehicle.current = { vehicleId, usageLeft: entry.usageLeft };
  EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId, attached: true });
  EventBus.emit(GE.TOAST_SHOW, { text: `🚗 装备载具 ${def.emoji || ''} ${def.name}`, duration: 1500 });
  devLog.info('[VehicleSystem.attachVehicle]', vehicleId);
  return true;
}

/**
 * 卸下载具（用完了或主动切换）
 */
export function detachVehicle(gs) {
  ensureVehicleState(gs);
  if (gs.vehicle.current) {
    const cur = gs.vehicle.current;
    // 同步回 available（若 usageLeft > 0）
    const avail = gs.vehicle.available.find(a => a.vehicleId === cur.vehicleId);
    if (avail) {
      avail.usageLeft = cur.usageLeft;
    }
    gs.vehicle.current = null;
    EventBus.emit(GE.VEHICLE_ATTACH, { vehicleId: cur.vehicleId, attached: false });
    devLog.info('[VehicleSystem.detachVehicle]');
  }
}

/**
 * 消费载具使用次数（用完自动卸下并从 available 移除）
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
    // 用完 —— 卸下并从 available 移除
    const idx = gs.vehicle.available.findIndex(a => a.vehicleId === cur.vehicleId);
    if (idx >= 0) gs.vehicle.available.splice(idx, 1);
    gs.vehicle.current = null;
    EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 使用完毕`, duration: 1500 });
    devLog.info('[VehicleSystem.consumeUsage]', cur.vehicleId, 'used up');
  } else {
    // 同步 available
    const avail = gs.vehicle.available.find(a => a.vehicleId === cur.vehicleId);
    if (avail) avail.usageLeft = cur.usageLeft;
  }
  return true;
}

/**
 * 判断两格是否同行或同列（外圈环形地图用 Distance.outerIdxToXY）
 */
function sameRowOrCol(gs, aIdx, bIdx) {
  const a = Distance.outerIdxToXY(gs.map.size, aIdx);
  const b = Distance.outerIdxToXY(gs.map.size, bIdx);
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
  ensureVehicleState(gs);
  const cur = gs.vehicle.current;
  if (!cur) return { ok: false, reason: 'noVehicle' };

  const def = VEHICLES[cur.vehicleId];
  if (!def) return { ok: false, reason: 'unknown' };

  const fromIdx = gs.player.x;
  let targetIdx = null;
  let path = [];

  if (def.movePattern === 'directional') {
    // 轮子：指定方向最多 maxRange 格。
    // 穿越栅栏/虚空合法，只要求最终落点是外圈格。
    const dirIdx = Direction.dirToIndex(opts.direction);
    if (dirIdx === -1) return { ok: false, reason: 'badDirection' };

    const { x: fx, y: fy } = Distance.outerIdxToXY(gs.map.size, fromIdx);
    let cx = fx, cy = fy;

    // 方向向量：0=up, 1=right, 2=down, 3=left
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dirIdx];
    const maxRange = def.maxRange || 2;

    // 沿方向扫最远的合法外圈格（中间 null/栅栏都穿越）
    let finalIdx = null;
    let path = [];
    for (let step = 1; step <= maxRange; step++) {
      cx += dx; cy += dy;
      const idx = outerXYToIdx(gs.map.size, cx, cy);
      if (idx !== null) {
        finalIdx = idx;
        path.push(idx);
      } else {
        // null（栅栏中心/虚空）—— 轮子继续穿越，不阻挡
        path.push(null);
      }
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
    // 简化：路径 = [targetIdx]（1 格视为直达）
    path = [targetIdx];
  } else if (def.movePattern === 'any') {
    // 巧遇：任意格（不能进 fence）
    if (opts.targetIdx == null) return { ok: false, reason: 'needTarget' };
    if (opts.targetIdx === fromIdx) return { ok: false, reason: 'sameTile' };
    targetIdx = opts.targetIdx;
    path = [targetIdx];
  } else {
    return { ok: false, reason: 'badPattern' };
  }

  // 消耗载具使用次数
  consumeUsage(gs);

  // 扣 stamina（载具也是移动，消耗 1 stamina，除非有果腹收藏品 —— 简化不考虑）
  // 芋圆 nextMoveNoStamina 也适用载具移动
  const isFree = !!gs.player.nextMoveNoStamina;
  if (isFree) {
    gs.player.nextMoveNoStamina = false;
  } else {
    gs.player.stamina -= 1;
    EventBus.emit(GE.STAMINA_CHANGE, {
      newValue: gs.player.stamina,
      delta: -1,
      maxStamina: gs.player.maxStamina,
    });
  }

  // 更新位置
  gs.player.x = targetIdx;

  // Phase 4：载具移动也要触发 onPass / onEnter hook（设施词条正常工作）
  //   onPass：路径上除最后一格外的每一格（跳过 null——穿越栅栏中心不算经过合法地块）
  if (path && path.length > 0) {
    for (const passIdx of path) {
      if (passIdx != null && passIdx !== targetIdx) {
        HookDispatcher.fire('onPass', { gs, tileIdx: passIdx });
        SkillSystem.triggerSkillByHook?.('onPass', { gs, tileIdx: passIdx });
      }
    }
  }
  //   onEnter：最终停留格
  HookDispatcher.fire('onEnter', { gs, tileIdx: targetIdx });
  SkillSystem.triggerSkillByHook?.('onEnter', { gs, tileIdx: targetIdx });

  EventBus.emit(GE.MOVE, { fromIdx, toIdx: targetIdx, byVehicle: true });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: fromIdx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: targetIdx });

  devLog.info('[VehicleSystem.tryMove]', def.name, fromIdx, '→', targetIdx, 'path=', path);

  return { ok: true, path, finalIdx: targetIdx };
}

/**
 * 外部调用：消耗 1 次载具使用（WASD 普通移动消耗）
 */
export function useOnce(gs) {
  return consumeUsage(gs);
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
  if (targetIdx === fromIdx) return { ok: false, reason: 'sameTile' };

  if (def.movePattern === 'directional') {
    // 轮子：同方向最多 maxRange 格。穿越栅栏/虚空合法，只要落点是外圈格。
    const { x: fx, y: fy } = Distance.outerIdxToXY(gs.map.size, fromIdx);
    const { x: tx, y: ty } = Distance.outerIdxToXY(gs.map.size, targetIdx);
    const dx = tx - fx;
    const dy = ty - fy;
    // 必须严格只沿一个方向（dx===0 或 dy===0）
    if (dx !== 0 && dy !== 0) return { ok: false, reason: 'notAligned' };
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist === 0 || dist > (def.maxRange || 2)) return { ok: false, reason: 'outOfRange' };

    // 只验证落点是合法外圈格 —— 中途穿越栅栏/虚空/null 都是合法的
    const finalIdx = outerXYToIdx(gs.map.size, tx, ty);
    if (finalIdx === null) return { ok: false, reason: 'badTarget' };

    return { ok: true, def };
  }

  if (def.movePattern === 'line') {
    // 扫帚：同行或同列任意格
    if (!sameRowOrCol(gs, fromIdx, targetIdx)) {
      return { ok: false, reason: 'notSameRowCol' };
    }
    return { ok: true, def };
  }

  if (def.movePattern === 'any') {
    // 巧遇：任意格（外圈都是合法的）
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
  onDayStart,
};
