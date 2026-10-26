// src/systems/DaySystem.js
// 每日开始系统：day++、turn=0、触发 onDailyStart hook、重置每日计数器、处理 blessed 状态、出货箱结算
//  stamina 回复逻辑由 SleepSystem 在上层处理（家回满 / 帐篷回满 / 其他回一半）
//
// Phase 3 扩展：
//   - 末尾 CreatureSystem.dailyTick(gs)  生物饥饿/成长/心情/产蛋/容量
//   - 友善超载 → 当天产出归 0（在此统一做，让 wheat/rice/strawberry/pea/henhouse hook 跳过）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { InventorySystem } from './InventorySystem.js';
import { CreatureSystem } from './CreatureSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { Storage } from '../state/storage.js';
import { VehicleSystem } from './VehicleSystem.js';

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

  // 4. Phase 3：生物系统 dailyTick（饥饿/成长/心情/产蛋/容量超载惩罚 —— 先跑，让 capacity 状态就绪）
  CreatureSystem.dailyTick(gs);

  // 5. 出货箱自动换成金币（InventorySystem.loadFromOutbox 按 items[].value 合计）
  InventorySystem.loadFromOutbox(gs);

  // 6. 触发所有 onDailyStart hook（设施产出、生物刷新等 —— 此时 capacity.friendlyOverloaded 已就绪，wheat 等可据此归 0）
  HookDispatcher.fire('onDailyStart', { gs });

  // 7. Phase 3：玩家身上 buff 衰减（burn 每回合流失 3% 这里是每日 —— 实际 burn 按回合 tick；
  //     这里每日只处理心力交瘁的剩余天数）
  const exhausted = gs.activeBuffs.find(b => b.id === 'exhausted');
  if (exhausted && exhausted.remainingTurns !== undefined && exhausted.remainingTurns > 0) {
    exhausted.remainingTurns -= 1;
    if (exhausted.remainingTurns <= 0) {
      gs.activeBuffs = gs.activeBuffs.filter(b => b !== exhausted);
      devLog.info('[DaySystem] exhausted buff expired');
    }
  }

  // 8. 精灵每日字段重置（§12.2：momo 首次祈福计数、晴风攻击加成层数、芋圆免移动标志）
  if (gs.team) {
    gs.team.dailyBlessCount = 0;
    gs.team.dailyQingfengAtkBonus = 0;
    // Agent 3：焚灭计数每日清空（连携技 焚灭：【每一日开始时】清空计数）
    gs.team.xiayangSkillCount = 0;
  }
  if (gs.player && gs.player.nextMoveNoStamina) {
    gs.player.nextMoveNoStamina = false; // 芋圆效果仅限本日内
  }

  // 8.5 Agent 3：连携技重置
  LinkSkillSystem.resetAll(gs);

  // 8.6 Agent 3：天赋 onDayStart（巧手随机物品 + 比翼 buff 天数 + 涅槃冷却）
  TalentSystem.onDayStart(gs);
  TalentSystem.onDayStartCooldownTick(gs);

  // 8.7 Agent 3：载具 巧遇 每天限次重置
  VehicleSystem.onDayStart(gs);

  // 8.8 Agent 3：自动存档 slot 1
  Storage.autoSave(gs);

  // 9. 广播 DAY_START 事件
  EventBus.emit(GE.DAY_START, { day: gs.day });
  EventBus.emit(GE.TILE_UPDATED); // 地图整体刷新
  EventBus.emit(GE.STAT_CHANGE);  // 所有 UI 数值刷新
}

export const DaySystem = {
  startNewDay,
};
