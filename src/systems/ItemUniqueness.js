// src/systems/ItemUniqueness.js
// 【唯一】物品的全局占用表（设计文档 v0.6 §12.2 / §16.4）
//
// 口径（用户 2026-11-14 确认）：
//   1. "已拥有"只看背包持有（qty > 0）。收藏品与魔导书不能放置在地块上，
//      不存在"已放置"状态，不写地块归属判定。
//   2. 某家商店里已抽取但**尚未售出**的唯一物品，也算被占用 ——
//      在它被买走或随刷新消失之前，其他商店、魔法商店、事件奖励、
//      其他随机池都不得再抽到它。
//
// 本模块只负责"谁被占用了"，不负责抽取；抽取侧（RandomPool / ShopSystem）
// 把结果当作 exclude 集合使用。占位物品一定不具有【唯一】，由 isUniqueItem 直接排除。

import { ITEMS } from '../data/items.js';

/**
 * 是否带【唯一】。
 * 判定依据来自物品库：显性词条含【唯一】，或叠放规则里写明"自带【唯一】"。
 * 占位物品写的是"无【唯一】"，不能误判。
 */
export function isUniqueItem(itemId) {
  const it = ITEMS[itemId];
  if (!it) return false;
  if ((it.traits || []).includes('唯一')) return true;
  const rule = it.stackRule || '';
  return /【唯一】/.test(rule) && !/无【唯一】/.test(rule);
}

/** 是否占位物品（物品库 hiddenTags / 备注里的「占位」） */
export function isPlaceholderItem(itemId) {
  const it = ITEMS[itemId];
  if (!it) return false;
  if ((it.hiddenTags || []).includes('占位')) return true;
  return (it.notes || '').includes('占位物品');
}

/**
 * 玩家已拥有的唯一物品：只看背包持有。
 * 收藏品 / 魔导书不能放置在地块上，不做地块归属判定。
 * @returns {Set<string>}
 */
export function collectOwnedUniqueIds(gs) {
  const owned = new Set();
  for (const e of gs?.inventory?.items || []) {
    if ((e.qty || 0) > 0 && isUniqueItem(e.itemId)) owned.add(e.itemId);
  }
  return owned;
}

/**
 * 已被商店占用（已抽取、未售出）的唯一物品。
 * @param {number|null} exceptTileIdx 生成库存的这家店自身要排除（刷新时旧货会消失）
 * @returns {Set<string>}
 */
export function collectReservedUniqueIds(gs, exceptTileIdx = null) {
  const held = new Set();
  for (const t of gs?.map?.outerTiles || []) {
    if (exceptTileIdx != null && t.idx === exceptTileIdx) continue;
    const stock = t.contentState?.shop?.stock;
    if (!Array.isArray(stock)) continue;
    for (const item of stock) {
      if (!item.sold && isUniqueItem(item.id)) held.add(item.id);
    }
  }
  return held;
}

/** 全部不可再抽取的唯一物品 = 已拥有 ∪ 已被商店占用 */
export function unavailableUniqueIds(gs, exceptTileIdx = null) {
  const all = collectOwnedUniqueIds(gs);
  for (const id of collectReservedUniqueIds(gs, exceptTileIdx)) all.add(id);
  return all;
}
