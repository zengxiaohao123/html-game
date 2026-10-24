// src/systems/SleepSystem.js
// 睡觉系统：换日 + 行动力回复 + 强制睡觉金币惩罚
// 核心逻辑：
//   - 在家 / 帐篷 → stamina 回满
//   - 心力交瘁 debuff 存在时 → 所有睡觉增益失效，固定回一半
//   - 强制睡觉（stamina <= -3）→ 金币 10% 惩罚（0~1000 范围）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { DaySystem } from './DaySystem.js';
import { SLEEP_STAMINA_PENALTY_GOLD_RATIO } from '../utils/constants.js';
import { TurnSystem } from './TurnSystem.js';

/** 金币惩罚上下限 */
const GOLD_PENALTY_MIN = 0;
const GOLD_PENALTY_MAX = 1000;

/**
 * 睡觉
 * @param {object} gs 全局状态（会被直接修改）
 * @param {boolean} [isAuto=false] 是否为强制睡觉（stamina 过低触发）
 * @returns {{ goldPenalty: number, staminaRestored: number }}
 */
export function sleep(gs, isAuto = false) {
  devLog.info('[SleepSystem] 开始睡觉, isAuto =', isAuto);

  // 1. 触发 onSleep hook
  HookDispatcher.fire('onSleep', { gs });

  // 2. 换日
  DaySystem.startNewDay(gs);

  // 3. 判断行动力回复量
  const hasExhausted = gs.activeBuffs.some(b => b.id === TurnSystem.BUFF_EXHAUSTED);
  const currentTile = gs.map.outerTiles[gs.player.x];
  const atHome = currentTile && (currentTile.contentId === 'facility_home' || currentTile.contentId === 'facility_tent');

  let newStamina;
  if (hasExhausted) {
    // 心力交瘁：所有睡觉增益失效，固定回一半
    newStamina = Math.ceil(gs.player.maxStamina / 2);
    devLog.info('[SleepSystem] 心力交瘁，固定回一半 stamina:', newStamina);
  } else if (atHome) {
    // 在家 / 帐篷：回满
    newStamina = gs.player.maxStamina;
    devLog.info('[SleepSystem] 在家，stamina 回满:', newStamina);
  } else {
    // 其他地点：回一半
    newStamina = Math.ceil(gs.player.maxStamina / 2);
    devLog.info('[SleepSystem] 其他地点，stamina 回一半:', newStamina);
  }

  const staminaDelta = newStamina - gs.player.stamina;
  gs.player.stamina = newStamina;
  EventBus.emit(GE.STAMINA_CHANGE, {
    newValue: newStamina,
    delta: staminaDelta,
    maxStamina: gs.player.maxStamina,
  });

  // 4. 移除心力交瘁 buff
  if (hasExhausted) {
    gs.activeBuffs = gs.activeBuffs.filter(b => b.id !== TurnSystem.BUFF_EXHAUSTED);
    devLog.info('[SleepSystem] 心力交瘁 buff 已移除');
  }

  // 5. 强制睡觉金币惩罚
  let goldPenalty = 0;
  if (isAuto) {
    const rawPenalty = Math.floor(gs.player.gold * SLEEP_STAMINA_PENALTY_GOLD_RATIO);
    goldPenalty = Math.max(GOLD_PENALTY_MIN, Math.min(GOLD_PENALTY_MAX, rawPenalty));
    if (goldPenalty > 0) {
      gs.player.gold -= goldPenalty;
      EventBus.emit(GE.GOLD_CHANGE, {
        newValue: gs.player.gold,
        delta: -goldPenalty,
      });
      EventBus.emit(GE.TOAST_SHOW, { text: `心力交瘁自动睡觉，扣 🪙 ${goldPenalty}`, duration: 2500 });
      devLog.info('[SleepSystem] 强制睡觉金币惩罚:', goldPenalty);
    }
  }

  // 6. 广播 SLEEP 事件
  EventBus.emit(GE.SLEEP, { day: gs.day, isAuto, goldPenalty });
  EventBus.emit(GE.TOAST_SHOW, { text: `🌙 晚安～第 ${gs.day} 天开始`, duration: 2000 });

  return { goldPenalty, staminaRestored: staminaDelta };
}

export const SleepSystem = {
  sleep,
};
