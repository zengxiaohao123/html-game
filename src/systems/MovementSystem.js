// src/systems/MovementSystem.js
// 移动系统：WASD 驱动，外圈 8 格回字形地图
// 核心约定：
//   1. Direction → Distance 邻居映射：dirToIndex(direction) → outerNeighbors 返回数组下标
//   2. 不可移动时返回 null，不扣 stamina、不触发 hook、不更新 GS

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Distance } from '../core/Distance.js';
import { Direction } from '../utils/Direction.js';
import { devLog } from '../core/Logger.js';

/**
 * 尝试移动玩家
 * @param {object} gs 全局状态（会被直接修改）
 * @param {string} direction 'up' | 'right' | 'down' | 'left'
 * @returns {number|null} 移动成功返回目标格 idx，失败返回 null
 */
export function move(gs, direction) {
  const dirIdx = Direction.dirToIndex(direction);
  if (dirIdx === -1) {
    devLog.warn('[MovementSystem] 非法方向:', direction);
    return null;
  }

  const neighbors = Distance.outerNeighbors(gs.map.size, gs.player.x);
  const targetIdx = neighbors[dirIdx];

  // 栅栏中心 / 不可通行：返回 null，不扣 stamina、不触发 hook
  if (targetIdx === null || targetIdx === undefined) {
    devLog.info('[MovementSystem] 方向', direction, '不可通行, neighbors:', neighbors);
    EventBus.emit(GE.MOVE_BLOCKED, { direction, currentIdx: gs.player.x });
    return null;
  }

  // === 可行走：执行移动 ===
  const fromIdx = gs.player.x;

  // 1. 扣 stamina（先 emit 再改 GS，符合 architecture-spec 约定）
  gs.player.stamina -= 1;
  EventBus.emit(GE.STAMINA_CHANGE, {
    newValue: gs.player.stamina,
    delta: -1,
    maxStamina: gs.player.maxStamina,
  });

  // 2. 触发 onPass：当前格 + 目标格（路径上的所有格）
  HookDispatcher.fire('onPass', { gs, tileIdx: fromIdx });
  HookDispatcher.fire('onPass', { gs, tileIdx: targetIdx });

  // 3. 更新玩家位置
  gs.player.x = targetIdx;

  // 4. 触发 onEnter：最终停留的目标格
  HookDispatcher.fire('onEnter', { gs, tileIdx: targetIdx });

  // 5. 广播 MOVE 事件
  EventBus.emit(GE.MOVE, { fromIdx, toIdx: targetIdx, direction });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: fromIdx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: targetIdx });

  devLog.info('[MovementSystem] 移动成功:', fromIdx, '→', targetIdx, direction);
  return targetIdx;
}

export const MovementSystem = {
  move,
};
