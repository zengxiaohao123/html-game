// src/systems/CapacitySystem.js
// 容量上限口径（唯一公式，CreatureSystem / PathSystem 共用）：
//   友善 = 危险 = 4 + (栅栏格数 − 生效小径格数 − 1)
//   —— 生效小径格被视为外圈地块，因此不再提供栅栏内空间（用户裁定 20/22）。
//
// 本模块只做「上限即时同步」，不推进超载计时/惩罚；
// 小径还原导致容量下降时，当天立即记为警告期第 1 天，但惩罚仍只在每日开始时生效
// （用户裁定 21）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { effectivePathCount } from '../core/TileAccess.js';

/** 栅栏提供的额外容量（已扣除生效小径格） */
export function capacityExtra(gs) {
  const fenceTiles = (gs.map?.fence && gs.map.fence.length) || 1;
  const pathTiles = effectivePathCount(gs);
  return Math.max(0, fenceTiles - pathTiles - 1);
}

/** 按当前栅栏面积写入容量上限（幂等；保留已累计的超载天数） */
export function applyCapacityLimits(gs) {
  const cap = gs.capacity || (gs.capacity = {});
  const extra = capacityExtra(gs);
  cap.friendly = 4 + extra;
  cap.danger = 4 + extra;
  cap.extreme = 0;
  cap.friendlyOverdue = cap.friendlyOverdue ?? 0;
  cap.dangerOverdue = cap.dangerOverdue ?? 0;
  cap.extremeOverdue = cap.extremeOverdue ?? 0;
  return cap;
}

/** 当前各类型存活生物数量（容量判定口径） */
export function countCreatures(gs) {
  const out = { friendly: 0, danger: 0, extreme: 0 };
  for (const c of gs.creatures || []) {
    if (!c || c.hp <= 0 || c.dead) continue;
    if (out[c.category] !== undefined) out[c.category] += 1;
  }
  return out;
}

/**
 * 小径失效导致容量下降后的即时警告：
 *   - 已超载 → 当天记为警告期第 1 天（不推进惩罚、不弹提示）
 *   - 未超载 → 清零警告期
 */
export function markCapacityWarningToday(gs) {
  const cap = applyCapacityLimits(gs);
  const count = countCreatures(gs);
  if (count.friendly > cap.friendly) cap.friendlyOverdue = Math.max(1, cap.friendlyOverdue || 0);
  else cap.friendlyOverdue = 0;
  if (count.danger > cap.danger) cap.dangerOverdue = Math.max(1, cap.dangerOverdue || 0);
  else cap.dangerOverdue = 0;
  if (count.extreme > cap.extreme) cap.extremeOverdue = Math.max(1, cap.extremeOverdue || 0);
  else cap.extremeOverdue = 0;
  return cap;
}

/**
 * 栅栏面积变化（农场扩建）或读档首次渲染前调用：同步上限并广播 CAPACITY_CHANGE，
 * TopBar 的监听会同步重绘（同一帧内完成）。
 */
export function syncCapacityLimits(gs, reason = 'sync') {
  const cap = applyCapacityLimits(gs);
  EventBus.emit(GE.CAPACITY_CHANGE, { reason });
  return cap;
}

export const CapacitySystem = {
  capacityExtra,
  applyCapacityLimits,
  countCreatures,
  markCapacityWarningToday,
  syncCapacityLimits,
};

export default CapacitySystem;
