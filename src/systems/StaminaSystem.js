// src/systems/StaminaSystem.js
// 行动力统一结算入口（2026-11-03 裁决）：
//   结算顺序：先结算「不允许超出上限」的回复（睡觉回满/回一半、巴士站 +1、天赋活力满满等），
//   再结算「允许超出上限」的额外增加（帐篷受祝福 +3、拓荒者 +5 等）。
//   所有回复/增加行动力的路径统一走本模块，不再直接 gs.player.stamina += ...
//   超出上限的部分当日内可正常使用，下一日开始时清除（物品库 03 表 A34「行动力溢出」）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';

/**
 * 行动力变化统一结算
 * @param {object} gs 全局状态
 * @param {number} delta 正 = 回复/增加，负 = 扣除
 * @param {object} [opts]
 * @param {boolean} [opts.allowOverflow=false] 是否允许超出 maxStamina 上限（帐篷祝福 +3 / 拓荒者 +5 等）
 * @param {string} [opts.reason] 来源标记（随 STAMINA_CHANGE 事件广播）
 * @returns {number} 实际变化量
 */
export function settleStamina(gs, delta, opts = {}) {
  const p = gs.player;
  const before = p.stamina;
  let next = before + delta;
  if (delta > 0 && !opts.allowOverflow) next = Math.min(next, p.maxStamina);
  p.stamina = next;
  const actual = next - before;
  EventBus.emit(GE.STAMINA_CHANGE, {
    newValue: next,
    delta: actual,
    maxStamina: p.maxStamina,
    reason: opts.reason,
  });
  return actual;
}

/**
 * 回复到目标值（不允许超出上限）：睡觉回满 / 回一半等
 * 目标值先夹到 maxStamina；当前高于目标（如残留溢出）时会被拉回目标值。
 * @returns {number} 实际变化量
 */
export function recoverStaminaTo(gs, target, opts = {}) {
  const capped = Math.min(target, gs.player.maxStamina);
  return settleStamina(gs, capped - gs.player.stamina, { ...opts, allowOverflow: false });
}

export const StaminaSystem = {
  settleStamina,
  recoverStaminaTo,
};
