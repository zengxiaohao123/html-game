// src/systems/GoldSystem.js
// 金币唯一写入口：所有金币增减都必须经过这里，统一夹取到 [GOLD_MIN, GOLD_MAX]。
// 金币允许为负（《泡沫》负价值结算、强制睡觉惩罚等），因此不要在任何地方用 Math.max(0, gold) 兜底。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { GOLD_MIN, GOLD_MAX } from '../utils/constants.js';

export { GOLD_MIN, GOLD_MAX };

/** 夹取金币到合法区间（含端点） */
export function clampGold(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(GOLD_MAX, Math.max(GOLD_MIN, n));
}

/** 读取当前金币（读取时也夹取，避免旧存档/外部写入越界值扩散） */
export function getGold(gs) {
  return clampGold(gs?.player?.gold ?? 0);
}

/**
 * 直接设置为某个值（夹取后写入），返回实际生效的增量
 * @param {object} gs
 * @param {number} value
 * @param {{reason?: string}} [opts]
 */
export function setGold(gs, value, opts = {}) {
  if (!gs?.player) return 0;
  const before = clampGold(gs.player.gold);
  const next = clampGold(value);
  gs.player.gold = next;
  const applied = next - before;
  if (applied !== 0) {
    EventBus.emit(GE.GOLD_CHANGE, { newValue: next, gold: next, delta: applied, reason: opts.reason });
  }
  return applied;
}

/**
 * 增减金币（夹取后写入），返回实际生效的增量
 * @param {object} gs
 * @param {number} delta
 * @param {string} [reason]
 */
export function addGold(gs, delta, reason) {
  if (!gs?.player) return 0;
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) return 0;
  return setGold(gs, clampGold(gs.player.gold) + d, { reason });
}
