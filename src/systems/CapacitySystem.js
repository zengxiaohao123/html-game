// src/systems/CapacitySystem.js
// 容量上限只由栅栏格数决定（§13.1 / 物品库 05）：栅栏每多 1 格空间 → 友善 +1、危险 +1；
// 初始栅栏 1 格 → 基础 友善 4 / 危险 4 / 高危 0。
//
// 与 CreatureSystem.updateCapacityAndPunish（日结算）共用同一口径。
// 本模块只做「上限即时同步」，不推进超载计时/惩罚——扩建等改变栅栏面积的操作
// 只应刷新上限，不能凭空推进当天超载警告期。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';

/** 按当前栅栏面积写入容量上限（幂等；保留已累计的超载天数） */
export function applyCapacityLimits(gs) {
  const cap = gs.capacity || (gs.capacity = {});
  const fenceTiles = (gs.map?.fence && gs.map.fence.length) || 1;
  const extra = Math.max(0, fenceTiles - 1);
  cap.friendly = 4 + extra;
  cap.danger = 4 + extra;
  cap.extreme = 0;
  cap.friendlyOverdue = cap.friendlyOverdue ?? 0;
  cap.dangerOverdue = cap.dangerOverdue ?? 0;
  cap.extremeOverdue = cap.extremeOverdue ?? 0;
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

export const CapacitySystem = { applyCapacityLimits, syncCapacityLimits };

export default CapacitySystem;
