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
import { TalentSystem } from './TalentSystem.js';
import { StaminaSystem } from './StaminaSystem.js';

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

  // 0. 重置本次睡觉的「允许超上限」待结算行动力（帐篷祝福 +3 等 hook 会累加进来）
  gs.pendingSleepStaminaBonus = 0;

  // 0.1 B-14：心力交瘁快照必须在任何睡觉增益 hook 之前捕获
  //     （§15：debuff 期间所有睡觉增益失效 —— 皇家枕头 onSleepStart / 艾草 onSleep 同样失效）
  const wasExhausted = gs.activeBuffs.some(b => b.id === TurnSystem.BUFF_EXHAUSTED);

  // 0. Agent 3：天赋 活力满满 onSleep（换日前 fire）—— 心力交瘁时失效
  if (!wasExhausted) {
    TalentSystem.onSleepStart(gs);
  } else {
    devLog.info('[SleepSystem] 心力交瘁 → 睡觉增益 hook 全部失效（onSleepStart 跳过）');
  }

  // 0.5 §5.2：推进回合的行为只有三种——移动 / 祈福 / 睡觉。睡觉推进 1 回合。
  //     advanceTurn 内部处理心力交瘁挂、生物 burn tick、技能冷却递减。
  //     此刻已在睡觉流程内，忽略返回的 forcedSleep，避免递归。
  TurnSystem.advanceTurn(gs, 0);

  // 2. 触发 onSleep hook —— 心力交瘁时失效（B-14：艾草 / 皇家枕头等睡觉增益不生效）
  if (!wasExhausted) {
    HookDispatcher.fire('onSleep', { gs });
  }

  // 3. 换日
  DaySystem.startNewDay(gs);

  // 4. 行动力结算（2026-11-03 裁决的统一结算顺序，见 StaminaSystem.js）：
  //    第一步：结算不允许超出上限的回复（心力交瘁固定回一半 / 家、帐篷回满 / 其他回一半）
  //    第二步：结算允许超出上限的额外增加（帐篷受祝福 +3，onSleep hook 已累加到
  //            gs.pendingSleepStaminaBonus）——必须在「回满」之后结算且可超上限。
  const currentTile = gs.map.outerTiles[gs.player.x];
  const atHome = currentTile && (currentTile.contentId === 'facility_home' || currentTile.contentId === 'facility_tent');

  let newStamina;
  if (wasExhausted) {
    // 心力交瘁（§15）：所有睡觉增益失效，固定回一半
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

  const beforeRecover = gs.player.stamina;
  StaminaSystem.recoverStaminaTo(gs, newStamina, { reason: 'sleep_recover' });

  // 第二步：允许超上限的额外增加。心力交瘁时所有睡觉增益失效（§15），待结算奖励作废。
  const pendingBonus = gs.pendingSleepStaminaBonus || 0;
  gs.pendingSleepStaminaBonus = 0;
  if (!wasExhausted && pendingBonus > 0) {
    StaminaSystem.settleStamina(gs, pendingBonus, { allowOverflow: true, reason: 'sleep_bonus_overflow' });
    EventBus.emit(GE.TOAST_SHOW, { text: `⛺ 祝福帐篷额外 +${pendingBonus} 🔷（可超出行动力上限）`, duration: 1800 });
    devLog.info('[SleepSystem] 回满后结算超上限行动力 +', pendingBonus, '→', gs.player.stamina);
  }
  const staminaDelta = gs.player.stamina - beforeRecover;

  // 5. 移除心力交瘁 buff（§15：睡一觉后解除）
  if (wasExhausted) {
    gs.activeBuffs = gs.activeBuffs.filter(b => b.id !== TurnSystem.BUFF_EXHAUSTED);
    devLog.info('[SleepSystem] 心力交瘁 buff 已移除');
  }

  // 6. 强制睡觉金币惩罚
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

  // 7. 广播 SLEEP 事件
  EventBus.emit(GE.SLEEP, { day: gs.day, isAuto, goldPenalty });
  EventBus.emit(GE.TOAST_SHOW, { text: `🌙 晚安～第 ${gs.day} 天开始`, duration: 2000 });

  return { goldPenalty, staminaRestored: staminaDelta };
}

export const SleepSystem = {
  sleep,
};
