// src/systems/DaySystem.js
// 每日开始系统：day++、turn=0、触发 onDailyStart hook、重置每日计数器、处理 blessed 状态、出货箱结算
//  stamina 回复逻辑由 SleepSystem 在上层处理（家回满 / 帐篷回满 / 其他回一半）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { InventorySystem } from './InventorySystem.js';

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

  // 3. blessed 状态 -1 天，0 天移除
  //    设计文档 §8：祈福给某格挂 1 天祝福，DaySystem 统一处理倒计时
  for (const tile of gs.map.outerTiles) {
    tile.states = (tile.states || []).filter(s => {
      if (s.type === 'blessed') {
        s.remainingDays -= 1;
        if (s.remainingDays <= 0) {
          devLog.info('[DaySystem] blessed state expired on tile', tile.idx);
          return false;
        }
      }
      return true;
    });
  }

  // 4. 出货箱自动换成金币（InventorySystem.loadFromOutbox 按 items[].value 合计）
  InventorySystem.loadFromOutbox(gs);

  // 5. 触发所有 onDailyStart hook（设施产出、生物刷新等）
  HookDispatcher.fire('onDailyStart', { gs });

  // 6. 广播 DAY_START 事件
  EventBus.emit(GE.DAY_START, { day: gs.day });
  EventBus.emit(GE.TILE_UPDATED); // 地图整体刷新
  EventBus.emit(GE.STAT_CHANGE);  // 所有 UI 数值刷新
}

export const DaySystem = {
  startNewDay,
};
