// src/systems/DaySystem.js
// 每日开始系统：day++、turn=0、触发 onDailyStart hook、重置每日计数器
//  stamina 回复逻辑由 SleepSystem 在上层处理（家回满 / 帐篷回满 / 其他回一半）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { MAX_STAMINA } from '../utils/constants.js';

/**
 * 开始新的一天
 * @param {object} gs 全局状态（会被直接修改）
 */
export function startNewDay(gs) {
  gs.day += 1;
  gs.turn = 0;
  devLog.info('[DaySystem] 新的一天！day =', gs.day);

  // 1. 重置所有每日计数器为 0
  gs.dailyCounters = {};

  // 2. 清除所有每日限次标记（每格的 dailyFlags）
  for (const tile of gs.map.outerTiles) {
    tile.dailyFlags = {};
  }
  for (const fenceTile of gs.map.fence) {
    if (fenceTile.dailyFlags) fenceTile.dailyFlags = {};
  }

  // 3. 触发所有 onDailyStart hook（设施产出、生物刷新等）
  HookDispatcher.fire('onDailyStart', { gs });

  // 4. 广播 DAY_START 事件
  EventBus.emit(GE.DAY_START, { day: gs.day });
  EventBus.emit(GE.TILE_UPDATED); // 地图整体刷新
  EventBus.emit(GE.STAT_CHANGE);  // 所有 UI 数值刷新
}

export const DaySystem = {
  startNewDay,
};
