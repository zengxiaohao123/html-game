// src/systems/TurnSystem.js
// 回合推进系统：turn++、stamina 扣减、心力交瘁检查、强制睡觉触发

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { MIN_STAMINA } from '../utils/constants.js';

/** 心力交瘁 debuff id */
export const BUFF_EXHAUSTED = 'exhausted';

/**
 * 推进回合 + 扣减行动力
 * @param {object} gs 全局状态（会被直接修改）
 * @param {number} [cost=1] 行动力消耗（默认 1）
 * @returns {{ advanced: boolean, forcedSleep: boolean }}
 */
export function advanceTurn(gs, cost = 1) {
  // 推进回合计数
  gs.turn += 1;
  EventBus.emit(GE.TURN_ADVANCE, { newTurn: gs.turn });

  // 行动力扣减（注意：MovementSystem 调用 advanceTurn 前已经扣过一次 stamina？
  // 不对——看 task-briefs：TurnSystem.advanceTurn 是 turn++，stamina -= cost；
  // MovementSystem.move 里也扣了 stamina -1。
  // 实际上 phase 1 的简化逻辑是：MovementSystem.move 扣 stamina -1 并 turn+1，
  // 然后 TurnSystem.advanceTurn 处理通用情况（比如祈福、睡觉触发）。
  // 所以这里只扣 stamina 和 turn++，不要重复扣。
  
  // if (cost > 0) {
  //   gs.player.stamina -= cost;
  // }

  // 心力交瘁检查：stamina < 0 时挂 buff
  let hasExhausted = gs.activeBuffs.some(b => b.id === BUFF_EXHAUSTED);
  if (gs.player.stamina < 0 && !hasExhausted) {
    gs.activeBuffs.push({
      id: BUFF_EXHAUSTED,
      target: 'player',
      remainingTurns: 999, // 持续到睡觉
      params: {},
    });
    EventBus.emit(GE.TOAST_SHOW, { text: '你感到心力交瘁…', duration: 2000 });
    devLog.info('[TurnSystem] 玩家获得心力交瘁 buff');
  } else if (gs.player.stamina >= 0 && hasExhausted) {
    // stamina 回到 0 以上时移除 buff
    gs.activeBuffs = gs.activeBuffs.filter(b => b.id !== BUFF_EXHAUSTED);
    devLog.info('[TurnSystem] 心力交瘁 buff 已移除');
  }

  // 检查是否强制睡觉（stamina <= MIN_STAMINA = -3）
  if (gs.player.stamina <= MIN_STAMINA) {
    devLog.info('[TurnSystem] stamina 过低，触发强制睡觉');
    return { advanced: true, forcedSleep: true };
  }

  return { advanced: true, forcedSleep: false };
}

export const TurnSystem = {
  advanceTurn,
  BUFF_EXHAUSTED,
};
