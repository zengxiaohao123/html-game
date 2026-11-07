// src/data/placeholderPools.js
// ─────────────────────────────────────────────────────────────────────────────
// 占位数据表（第 7 批，2026-11-04 裁决⑥）：事件池 / 奖励池
// ─────────────────────────────────────────────────────────────────────────────
// 目的：让 RES-001 事件点 / RES-002 奖励点的流程可跑通。
//   本表所有条目均为【占位】，不是最终文案与数值（条目名均带「占位」前缀）。
// 替换方式：正式条目定稿后，整组替换本文件的
//   EVENT_POOL_PLACEHOLDER / REWARD_POOL_PLACEHOLDER 两张表（及效果字段），
//   调用方 facilities.js 的 resolveEventTile / resolveRewardTile 无需改动。
//   正式池应录入物品库「随机池」工作表并经 tools/gen_library.py 生成。
// ─────────────────────────────────────────────────────────────────────────────

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Random } from '../core/Random.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { StaminaSystem } from '../systems/StaminaSystem.js';
import { HealSystem } from '../systems/HealSystem.js';

/**
 * 事件池（占位）：每项 { id, name, weight, effect }
 * effect.type：'gold' | 'item' | 'stamina' | 'heal' | 'nothing'
 */
export const EVENT_POOL_PLACEHOLDER = [
  { id: 'evt_ph_01', name: '占位事件·一小堆金币', weight: 1, effect: { type: 'gold', amount: 5 } },
  { id: 'evt_ph_02', name: '占位事件·丢失的钱袋', weight: 1, effect: { type: 'gold', amount: -3 } },
  { id: 'evt_ph_03', name: '占位事件·遗落的饲料', weight: 1, effect: { type: 'item', itemId: 'item_wheat', qty: 1 } },
  { id: 'evt_ph_04', name: '占位事件·野果丛', weight: 1, effect: { type: 'item', itemId: 'item_strawberry', qty: 1 } },
  { id: 'evt_ph_05', name: '占位事件·清爽的风', weight: 1, effect: { type: 'stamina', amount: 1 } },
  { id: 'evt_ph_06', name: '占位事件·温暖的阳光', weight: 1, effect: { type: 'heal', percent: 0.1 } },
  { id: 'evt_ph_07', name: '占位事件·什么也没发生', weight: 1, effect: { type: 'nothing' } },
];

/**
 * 奖励池（占位）：每项 { id, name, weight, highValue, itemId?/gold?, qty? }
 * highValue=true 为「高价值」条目 —— 奖励点受祝福时其权重 ×REWARD_BLESS_WEIGHT_MULT。
 */
export const REWARD_POOL_PLACEHOLDER = [
  { id: 'rwd_ph_01', name: '占位奖励·小麦', itemId: 'item_wheat', qty: 2, weight: 3, highValue: false },
  { id: 'rwd_ph_02', name: '占位奖励·稻草', itemId: 'item_rice_straw', qty: 2, weight: 3, highValue: false },
  { id: 'rwd_ph_03', name: '占位奖励·土豆', itemId: 'item_potato', qty: 2, weight: 2, highValue: false },
  { id: 'rwd_ph_04', name: '占位奖励·金币袋', gold: 10, weight: 2, highValue: false },
  { id: 'rwd_ph_05', name: '占位奖励·鸡蛋', itemId: 'item_egg', qty: 2, weight: 2, highValue: false },
  { id: 'rwd_ph_06', name: '占位奖励(高价值)·优质蛋', itemId: 'item_golden_egg', qty: 1, weight: 1, highValue: true },
  { id: 'rwd_ph_07', name: '占位奖励(高价值)·大金币袋', gold: 30, weight: 1, highValue: true },
];

/** 受祝福时高价值条目的权重倍数 */
export const REWARD_BLESS_WEIGHT_MULT = 3;

/** 事件池加权抽取（占位） @returns {typeof EVENT_POOL_PLACEHOLDER[number]} */
export function drawPlaceholderEvent() {
  return Random.weightedPick(EVENT_POOL_PLACEHOLDER.map((e) => ({ weight: e.weight, value: e })));
}

/**
 * 奖励池加权抽取（占位）
 * @param {boolean} blessed 受祝福 → 高价值条目权重 ×REWARD_BLESS_WEIGHT_MULT
 * @returns {typeof REWARD_POOL_PLACEHOLDER[number]}
 */
export function drawPlaceholderReward(blessed) {
  const pairs = REWARD_POOL_PLACEHOLDER.map((e) => ({
    weight: e.weight * (blessed && e.highValue ? REWARD_BLESS_WEIGHT_MULT : 1),
    value: e,
  }));
  return Random.weightedPick(pairs);
}

function addGold(gs, delta, reason) {
  if (!delta) return 0;
  const actual = delta < 0 ? Math.max(delta, -(gs.player.gold || 0)) : delta;
  if (!actual) return 0;
  gs.player.gold = (gs.player.gold || 0) + actual;
  EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: actual, reason });
  return actual;
}

/**
 * 应用事件效果（占位）。
 * @returns {string} 效果摘要（用于 toast）
 */
export function applyPlaceholderEventEffect(gs, entry) {
  const eff = entry?.effect || { type: 'nothing' };
  switch (eff.type) {
    case 'gold': {
      const got = addGold(gs, eff.amount, 'placeholder_event');
      return got >= 0 ? `🪙 +${got}` : `🪙 ${got}`;
    }
    case 'item':
      InventorySystem.addItem(gs, eff.itemId, eff.qty || 1);
      return `📦 ${eff.itemId} ×${eff.qty || 1}`;
    case 'stamina':
      // 数值直接增加：允许超出上限
      StaminaSystem.gainStaminaFlat(gs, eff.amount || 1, { reason: 'placeholder_event' });
      return `⚡ 行动力 +${eff.amount || 1}`;
    case 'heal':
      HealSystem.healPlayerByPercent(gs, eff.percent || 0.1, { source: 'placeholder_event' });
      return `❤️ 恢复 ${Math.round((eff.percent || 0.1) * 100)}% 生命`;
    default:
      return '什么也没发生';
  }
}

/**
 * 发放奖励（占位）。
 * @returns {string} 奖励摘要（用于 toast）
 */
export function grantPlaceholderReward(gs, entry) {
  if (entry.gold) {
    addGold(gs, entry.gold, 'placeholder_reward');
    return `🪙 ×${entry.gold}`;
  }
  InventorySystem.addItem(gs, entry.itemId, entry.qty || 1);
  return `📦 ${entry.itemId} ×${entry.qty || 1}`;
}
