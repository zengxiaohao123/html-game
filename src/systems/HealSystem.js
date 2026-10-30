// src/systems/HealSystem.js
// 统一的"角色回复生命值"入口。
//
// 为什么需要它：v0.5 的【角色回复生命值时】是一个全局触发点（艾草田地依赖它），
// 如果各个回血来源各写一段 `hp = min(max, hp + x)`，就一定会漏订阅。
// 所有回血都必须走 healPlayer()，由它统一 clamp + 发事件 + fire onHeal。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';

/**
 * 为角色回复生命值
 * @param {object} gs
 * @param {number} amount 回复量（>0）
 * @param {object} opts   { source: string }
 * @returns {number} 实际回复量（被上限截断后的值）
 */
export function healPlayer(gs, amount, opts = {}) {
  if (!amount || amount <= 0) return 0;
  const before = gs.player.hp;
  gs.player.hp = Math.min(gs.player.maxHp, before + amount);
  const actual = gs.player.hp - before;

  if (actual > 0) {
    EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: actual, reason: opts.source || 'heal' });
    // 【角色回复生命值时】—— 任意途径都算
    HookDispatcher.fire('onHeal', { gs, amount: actual, source: opts.source || 'heal' });
  }
  devLog.info('[Heal]', opts.source || 'heal', '+', actual, `(${before}→${gs.player.hp})`);
  return actual;
}

/**
 * 按最大生命值百分比回复
 */
export function healPlayerByPercent(gs, pct, opts = {}) {
  return healPlayer(gs, Math.max(1, Math.floor(gs.player.maxHp * pct)), opts);
}

export const HealSystem = { healPlayer, healPlayerByPercent };
