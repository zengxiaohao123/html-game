// src/systems/ProduceSystem.js
// 【产出时】统一结算漏斗（物品库 词条字典 / 设计文档 v0.6 §16.5）
//
// 判定口径（用户 2026-11-21 确认）：
//   · 只有「来源于地块内容自身特性」的产出才算（含魔导书赋予该地块的特性）
//   · 魔导书直接发东西、事件奖励等非地块来源不算
//   · 储存已满导致没有实际产出时不算
//   · 价值变化而非数量增加不算（channel = 'value'）
//
// 结算顺序（一次产出事件）：
//   1. 基础产出落地：背包 / 储存（容量截断）/ 价值（不参与）
//   1b. 啤酒花田块：相邻有水面时本次基础产量 +2（常规 1 + 额外 2 = 3，答案不叠加覆盖）
//   2. 若该地块本日带【产出时】临时特性（向日葵授予）且未被【压制】：
//      本次产量 +1（该次事件只 +1，不按件数放大）
//   3. 若 +1 真的落地，再以 10% 概率获得向日葵 ×1（入背包），
//      该次获得向日葵本身又是一次产出事件 → 递归触发【产出时】
//   4. 背包产出逐件判定蓝息变异（10% → 【湛蓝】【违禁品】）
//
// 所有调用方都不应直接 addItem 产出作物，统一走本模块，避免遗漏【产出时】。

import { getTile, neighborRefs, playerRef } from '../core/TileAccess.js';
import { ITEMS } from '../data/items.js';
import { Random } from '../core/Random.js';
import { devLog } from '../core/Logger.js';
import { addGold } from './GoldSystem.js';
import { addItem } from './InventorySystem.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { isSuppressed } from './SuppressSystem.js';
import { rollBlueMutation } from './BlueBreathSystem.js';
import { normalizeTerrain } from '../data/terrains.js';

export const CHANNEL = { BAG: 'bag', STORE: 'store', VALUE: 'value', NONE: 'none' };
export const SUNFLOWER_ID = 'item_sunflower';
export const HOPS_FIELD_ID = 'facility_hops';
export const PRODUCE_BONUS_RATE = 0.1;
const MAX_RECURSION = 60;

/** 相邻格（4 方向）是否有水面地形 */
export function hasAdjacentWater(gs, ref) {
  for (const nRef of neighborRefs(gs, ref)) {
    const nTile = getTile(gs, nRef);
    if (nTile && normalizeTerrain(nTile.terrain) === 'terrain_water') return true;
  }
  return false;
}

/** 授予某地块「持续一天」的【产出时】临时特性（不叠加，刷新为当天） */
export function grantProduceBonus(tile, day) {
  if (!tile) return false;
  const state = tile.contentState || (tile.contentState = {});
  state.produceBonusDay = day;
  return true;
}

/** 该地块本日是否带【产出时】临时特性（向日葵授予，且未被压制） */
export function hasProduceBonus(gs, ref) {
  const tile = getTile(gs, ref);
  if (!tile) return false;
  const day = tile.contentState?.produceBonusDay;
  if (day !== gs.day) return false;
  if (isSuppressed(gs, ref)) return false;
  return true;
}

/** 清除过期特性（跨天后 produceBonusDay 自动不等于今天，这里顺手清干净） */
export function clearExpiredProduceBonus(gs) {
  for (const tile of gs.map?.outerTiles || []) {
    const st = tile?.contentState;
    if (st && typeof st.produceBonusDay === 'number' && st.produceBonusDay < gs.day) st.produceBonusDay = null;
  }
  for (const tile of gs.map?.fence || []) {
    const st = tile?.contentState;
    if (st && typeof st.produceBonusDay === 'number' && st.produceBonusDay < gs.day) st.produceBonusDay = null;
  }
}

/** 背包产出（逐件判定蓝息变异） */
function addToBagWithMutation(gs, ref, itemId, qty) {
  let normal = 0;
  let blue = 0;
  for (let i = 0; i < qty; i += 1) {
    if (rollBlueMutation(gs, ref, itemId)) blue += 1;
    else normal += 1;
  }
  if (normal > 0) addItem(gs, itemId, normal);
  if (blue > 0) addItem(gs, itemId, blue, { tags: ['湛蓝', '违禁品'] });
  return qty;
}

/** 取走储存作物入背包：逐件判定蓝息变异 */
export function takeStoredToBag(gs, ref, itemId, qty) {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return addToBagWithMutation(gs, ref, itemId, qty);
}

/**
 * 一次产出事件
 * @param {object} gs
 * @param {object} opts
 * @param {(number|object)} opts.ref 产出源地块 ref（必须传，用于【产出时】/ 蓝息判定）
 * @param {string} opts.itemId 产物 id
 * @param {number} [opts.qty=1] 基础产量
 * @param {string} [opts.channel='bag'] 'bag' | 'store' | 'value' | 'none'
 * @param {(n:number)=>number} [opts.apply] store 通道的实际落库函数，返回实际数量
 * @param {boolean} [opts.mutate=true] 背包产出是否参与蓝息变异
 * @param {boolean} [opts.bonus=true] 是否允许【产出时】加成（递归事件仍允许）
 * @param {number} [opts.depth=0] 递归深度保护
 * @returns {number} 实际产出数量（含 +1）
 */
export function produce(gs, opts) {
  const {
    ref, itemId, qty = 1, channel = CHANNEL.BAG, apply = null,
    mutate = true, bonus = true, depth = 0,
  } = opts || {};
  if (!itemId || !Number.isFinite(qty) || qty <= 0) return 0;
  // 被【压制】的田块：全部特性失效（日初 / 日末 / 受祝福 / 进入等所有产出路径统一拦截）
  if (ref !== undefined && ref !== null && isSuppressed(gs, ref)) return 0;

  let applied = 0;
  if (channel === CHANNEL.VALUE || channel === CHANNEL.NONE) {
    return 0; // 价值变化 / 非产出：不消耗特性、不掷变异
  }
  if (channel === CHANNEL.STORE) {
    applied = typeof apply === 'function' ? Math.max(0, apply(qty)) : 0;
  } else {
    applied = mutate ? addToBagWithMutation(gs, ref, itemId, qty) : addItem(gs, itemId, qty);
  }
  if (applied <= 0) return 0; // 储存已满 → 没有实际产出，不算
  HookDispatcher.fire('onProduce', { gs, ref, itemId, qty: applied, channel });

  // 啤酒花田块水面特性：相邻有水面时基础产量 +2（常规 1 + 额外 2 = 3）
  // 只作用于啤酒花本体产出；向日葵递归等其它产物的 ref 同样是该田块，不能连带 +2
  if (itemId === 'item_hops' && ref !== undefined && ref !== null
      && getTile(gs, ref)?.contentId === HOPS_FIELD_ID && hasAdjacentWater(gs, ref)) {
    const waterExtra = channel === CHANNEL.STORE
      ? (typeof apply === 'function' ? Math.max(0, apply(2)) : 0)
      : (mutate ? addToBagWithMutation(gs, ref, itemId, 2) : addItem(gs, itemId, 2));
    applied += waterExtra;
  }

  const traitOn = bonus && ref !== undefined && ref !== null && hasProduceBonus(gs, ref);
  if (traitOn) {
    const extra = channel === CHANNEL.STORE
      ? (typeof apply === 'function' ? Math.max(0, apply(1)) : 0)
      : (mutate ? addToBagWithMutation(gs, ref, itemId, 1) : addItem(gs, itemId, 1));
    applied += extra;

    // 只有 +1 真的落地，才继续掷 10% 向日葵；向日葵本身也是一次产出事件（可递归）
    if (extra > 0 && depth < MAX_RECURSION && Random.chance(PRODUCE_BONUS_RATE)) {
      devLog.info('[produce] 产出时 → 向日葵 ×1（递归 depth', depth + 1, '）');
      produce(gs, {
        ref, itemId: SUNFLOWER_ID, qty: 1, channel: CHANNEL.BAG, mutate: true, bonus: true, depth: depth + 1,
      });
    }
  }
  return applied;
}

/** 金币产出（薰衣草花田等）：不参与【产出时】 */
export function grantGold(gs, qty, reason) {
  return addGold(gs, qty, reason);
}

/** 物品是否为产物（用于事件/奖励类判断，不参与地块特性） */
export function isProductItem(itemId) {
  return ITEMS[itemId]?.tier1 === '产物';
}

export const ProduceSystem = {
  CHANNEL,
  SUNFLOWER_ID,
  HOPS_FIELD_ID,
  PRODUCE_BONUS_RATE,
  hasAdjacentWater,
  grantProduceBonus,
  hasProduceBonus,
  clearExpiredProduceBonus,
  produce,
  takeStoredToBag,
  grantGold,
  isProductItem,
};
