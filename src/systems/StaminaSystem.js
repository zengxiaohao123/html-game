// src/systems/StaminaSystem.js
// 行动力统一结算入口（2026-11-07 裁决，四类规则）：
//   1. 百分比增加（回一半 / 回满）→ 结果不超过上限；
//   2. 数值直接增加（+3 / 额外 +2 / 立即 +4）→ 可以超过上限（次日开始时清除超额）；
//   3. 百分比减少 / 负面效果扣除 → 不低于 0；
//   4. 玩家主动操作（移动 / 祈福 / 载具移动）→ 允许为负，但不低于下限 minStamina（-3）。
//   所有行动力变化必须走本模块，禁止各系统直接 gs.player.stamina += ...
//   超出上限的部分当日内可正常使用，下一日开始时清除（物品库 03 表 A34「行动力溢出」）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { MIN_STAMINA } from '../utils/constants.js';

/** 行动力下限（GS 缺字段时回落到全局常量 -3） */
function minStaminaOf(gs) {
  const v = gs.player?.minStamina;
  return Number.isFinite(v) ? v : MIN_STAMINA;
}

/**
 * 内部统一赋值 + 广播（不对外暴露，避免各系统各写一套夹取逻辑）
 * @param {object} gs 全局状态
 * @param {number} next 结算后的行动力
 * @param {object} [opts]
 * @param {string} [opts.reason] 来源标记（随 STAMINA_CHANGE 事件广播）
 * @returns {number} 实际变化量
 */
function apply(gs, next, opts = {}) {
  const p = gs.player;
  const before = p.stamina;
  p.stamina = next;
  const actual = next - before;
  EventBus.emit(GE.STAMINA_CHANGE, {
    newValue: next,
    delta: actual,
    maxStamina: p.maxStamina,
    minStamina: minStaminaOf(gs),
    reason: opts.reason,
  });
  return actual;
}

/**
 * 规则 1：百分比增加（回一半 / 回满）—— 结果不超过上限
 * 按上限的 ratio 恢复到目标值：1 = 回满，0.5 = 回一半（沿用睡觉回复的既有口径）。
 * 目标先夹到 maxStamina；当前高于目标时会被拉回目标值。
 * @param {number} ratio 上限的比例（0~1]
 * @returns {number} 实际变化量
 */
export function gainStaminaPercent(gs, ratio, opts = {}) {
  const cap = gs.player.maxStamina;
  const target = Math.min(Math.ceil(cap * ratio), cap);
  return apply(gs, target, opts);
}

/**
 * 规则 2：数值直接增加（+3 / 额外 +2 / 立即 +4）—— 可以超过上限
 * @param {number} amount 增加量（正数）
 * @returns {number} 实际变化量
 */
export function gainStaminaFlat(gs, amount, opts = {}) {
  if (!(amount > 0)) return 0;
  return apply(gs, gs.player.stamina + amount, opts);
}

/**
 * 规则 3：百分比减少 —— 不低于 0
 * @param {number} ratio 上限的比例（0~1]
 * @returns {number} 实际变化量（负数或 0）
 */
export function loseStaminaPercent(gs, ratio, opts = {}) {
  const cap = gs.player.maxStamina;
  const amount = Math.floor(cap * ratio);
  if (amount <= 0) return 0;
  return apply(gs, Math.max(0, gs.player.stamina - amount), opts);
}

/**
 * 规则 3：负面效果扣除行动力（粘液等）—— 不低于 0
 * @param {number} amount 扣除量（正数）
 * @returns {number} 实际变化量（负数或 0）
 */
export function loseStaminaNegativeEffect(gs, amount, opts = {}) {
  if (!(amount > 0)) return 0;
  return apply(gs, Math.max(0, gs.player.stamina - amount), opts);
}

/**
 * 规则 4：玩家主动操作消耗（移动 / 祈福 / 载具移动）—— 允许为负，但不低于下限 minStamina
 * @param {number} amount 消耗量（正数）
 * @returns {number} 实际变化量（负数或 0）
 */
export function spendStaminaActive(gs, amount, opts = {}) {
  if (!(amount > 0)) return 0;
  return apply(gs, Math.max(minStaminaOf(gs), gs.player.stamina - amount), opts);
}

/**
 * 跨日清超额：只把高于上限的部分夹回上限，不会抬高低于上限的值
 * @returns {number} 实际变化量（负数或 0）
 */
export function clampStaminaToCap(gs, opts = {}) {
  const cap = gs.player.maxStamina;
  return apply(gs, Math.min(gs.player.stamina, cap), opts);
}

export const StaminaSystem = {
  gainStaminaPercent,
  gainStaminaFlat,
  loseStaminaPercent,
  loseStaminaNegativeEffect,
  spendStaminaActive,
  clampStaminaToCap,
};
