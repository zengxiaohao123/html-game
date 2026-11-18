// src/data/rewardPool.js
// ─────────────────────────────────────────────────────────────────────────────
// 奖励池：奖励点（RES-002）进入时按权重抽取并发放。
// ─────────────────────────────────────────────────────────────────────────────
// 池条目结构：{ id, name, weight, highValue, itemId?, qty?, gold? }
//   · highValue=true 的条目在奖励点受祝福时权重 ×REWARD_BLESS_WEIGHT_MULT
//   · 正式条目尚未提供；池为空时奖励点不发放任何东西（不生成占位内容）。

import { Random } from '../core/Random.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { addGold } from '../systems/GoldSystem.js';

/** 正式奖励池条目（待填） */
export const REWARD_POOL = [];

/** 受祝福时高价值条目的权重倍数 */
export const REWARD_BLESS_WEIGHT_MULT = 3;

/**
 * 奖励池加权抽取。
 * @param {boolean} blessed 受祝福 → 高价值条目权重 ×REWARD_BLESS_WEIGHT_MULT
 * @returns {object|null} 池为空时返回 null
 */
export function drawReward(blessed) {
  if (!REWARD_POOL.length) return null;
  const pairs = REWARD_POOL.map((e) => ({
    weight: e.weight * (blessed && e.highValue ? REWARD_BLESS_WEIGHT_MULT : 1),
    value: e,
  }));
  return Random.weightedPick(pairs);
}

/**
 * 发放奖励。
 * @returns {string} 奖励摘要（用于 toast）；条目为空时返回空串
 */
export function grantReward(gs, entry) {
  if (!entry) return '';
  if (entry.gold) {
    addGold(gs, entry.gold, 'reward');
    return `🪙 ×${entry.gold}`;
  }
  if (!entry.itemId) return '';
  InventorySystem.addItem(gs, entry.itemId, entry.qty || 1);
  return `📦 ${entry.itemId} ×${entry.qty || 1}`;
}

export default { REWARD_POOL, REWARD_BLESS_WEIGHT_MULT, drawReward, grantReward };
