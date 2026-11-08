// src/systems/TurnSystem.js
// 回合推进系统：turn++、stamina 扣减、心力交瘁检查、强制睡觉触发

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { MIN_STAMINA } from '../utils/constants.js';
import { CombatSystem } from './CombatSystem.js';
import { SkillSystem } from './SkillSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { PendingDeathQueue } from './PendingDeathQueue.js';

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

  // ── 【每回合开始时】───────────────────────────────────────────────
  // 时序：turn +1 之后、回合内的 buff tick / 冷却递减 / 心力交瘁判定之前。
  // 只在 advanceTurn 里 fire 一次；本函数是所有回合推进的唯一入口
  // （移动 → GameDirector.move、载具移动 → GE.MOVE 订阅、祈福 → BlessSystem），
  // 因此不会重复触发。睡觉换日走 DaySystem，不额外 fire 本 hook。
  HookDispatcher.fire('onTurnStart', { gs, turn: gs.turn });

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
  // B-13：§15 心力交瘁「持续 1 日」—— 由 DaySystem 跨天衰减移除；
  //       不能因 stamina 回到 >= 0 就提前移除（旧逻辑错误地在回合内移除）
  const hasExhausted = gs.activeBuffs.some(b => b.id === BUFF_EXHAUSTED);
  if (gs.player.stamina < 0 && !hasExhausted) {
    gs.activeBuffs.push({
      id: BUFF_EXHAUSTED,
      target: 'player',
      remainingTurns: 1, // 持续 1 天（DaySystem 衰减；SleepSystem 睡觉后也会移除）
      params: {},
    });
    EventBus.emit(GE.TOAST_SHOW, { text: '你感到心力交瘁…', duration: 2000 });
    devLog.info('[TurnSystem] 玩家获得心力交瘁 buff');
  }

  // Phase 3：回合推进时 tick 所有生物身上的 buff（burn 每回合流失 3% hp 等）
  // §3.5：死亡延迟 —— 遍历期间不删对象，hp 归零只入队，批次（回合 tick）末统一 flush，
  // 修复"遍历中途从 gs.creatures 删除导致漏算 / 重复掉落"
  const burnDeaths = new PendingDeathQueue(gs);
  for (const c of gs.creatures.slice()) {
    if (c.hp <= 0) continue;
    CombatSystem.tickBuffsOnTarget(c);
    if (c.hp <= 0) {
      devLog.info('[TurnSystem] creature died from burn:', c.kind, c.id);
      burnDeaths.markDead(c);
    }
  }
  burnDeaths.flush();

  // Phase 3：技能 cooldown 递减
  SkillSystem.advanceSkillCooldowns(gs);

  // B-10：道具冷却按剩余回合递减（§14 冷却以回合计，跨天不清零）
  if (gs.itemCooldowns) {
    for (const k of Object.keys(gs.itemCooldowns)) {
      gs.itemCooldowns[k] -= 1;
      if (gs.itemCooldowns[k] <= 0) delete gs.itemCooldowns[k];
    }
  }

  // B-11：连携技冷却按剩余回合递减（§12.7 冷却均以回合计，跨天不清零）
  LinkSkillSystem.advanceCooldowns(gs);

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
