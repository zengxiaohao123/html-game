// src/data/starterPack.js
// 开局背包（v0.5 开发期测试用）
//
// 设计文档要求"开局给玩家随机若干地块内容"，但随机数量太少不便验证功能。
// 这里给一份固定的测试包：每个分类都有代表条目，覆盖放置 / 使用 / 放置型 / 收集。
// 正式平衡时把 STARTER_ITEMS 换成随机抽取即可（接口不变）。

import { ITEMS } from './items.js';
import { isUniqueItem } from '../systems/ItemUniqueness.js';

/** [itemId, 数量] */
export const STARTER_ITEMS = [
  // ── 地形（可像设施一样拖到地块上）──
  ['terrain_grass', 10],
  ['terrain_water', 5],
  ['terrain_ice', 5],
  ['terrain_none', 5],
  // v0.6 §9.6：小径便于测试连通/还原
  ['terrain_path', 12],

  // ── 设施（16 种全给一份，便于逐一验证词条）──
  ['facility_tent', 1],
  ['facility_wheat', 2],
  ['facility_rice', 2],
  ['facility_potato', 1],
  ['facility_tulip', 1],
  ['facility_strawberry', 1],
  ['facility_pea', 1],
  ['facility_henhouse', 1],
  ['facility_slimehouse', 1],
  ['facility_corn', 1],
  ['facility_cabbage', 1],
  ['facility_wild_seed', 2],
  ['facility_dandelion', 1],
  ['facility_ghost_grass', 1],
  ['facility_mugwort', 1],

  // ── 资源（含魔法商店）──
  ['resource_event', 1],
  ['resource_reward', 1],
  ['resource_hunt', 1],
  ['resource_shop', 1],
  ['resource_bus', 1],
  ['resource_magic_shop', 1],

  // ── 技能卡（主动 / 连携各来几张）──
  ['skill_yumo_slash', 1],
  ['skill_yumo_desperate', 1],
  ['skill_yumo_pioneer', 1],
  ['skill_xiayang_flame_strike', 1],
  ['skill_luyouyou_careful_shot', 1],
  ['skill_zongheng', 1],
  ['skill_link_yumo_drain', 1],
  ['skill_link_luyouyou_hunt', 1],

  // ── 产物 ──
  ['item_wheat', 10],
  ['item_rice_straw', 10],
  ['item_potato', 5],
  ['item_corn', 5],
  ['item_cabbage', 5],
  ['item_egg', 5],
  ['item_raw_meat', 3],

  // ── 消耗道具（使用型 + 放置型，覆盖指向交互）──
  ['item_herb', 3],
  ['item_fertilizer', 3],
  ['item_beer', 3],
  ['item_dinner', 2],
  ['item_trap', 2],
  ['item_incense', 2],

  // ── 农场扩建（开发期测试：I 型 / II 型各 3 个，便于验证多次扩建与上限边界）──
  ['item_farm_expand_length', 3],
  ['item_farm_expand_width', 3],

  // ── 技能与魔导书（技能在未放置前即物品；开局直接给技能本体）──
  ['skill_link_shift', 1],
  ['grimoire_grain_full', 1],

  // ── 收藏品（验证获得即生效）──
  ['collectible_royal_pillow', 1],
  ['collectible_deadwood', 1],
];

// ════════════════════════════════════════════════════════════════
// 【测试便利 · 非游戏内容】覆盖式测试背包
//
// 用途：开发期一次性拿到全部田块 / 资源 / 道具，逐条验证词条与交互。
// 正式配置（STARTER_ITEMS）不含这些物品，二者互不影响。
//
// 关闭方式：
//   1) 把 TEST_GIVE_ALL_CONTENT 改为 false（保留代码、随时可开）；
//   2) 或整段删除本区块，并删掉 createStarterInventory() 里对
//      createTestCoverageItems() 的调用。
//
// 数量口径：每种至少 3 个；带【唯一】的物品按唯一规则只给 1 个；
//   其余叠放 / 上限按 InventorySystem.addItem 的常规规则处理，不另开特例。
// ════════════════════════════════════════════════════════════════
export const TEST_GIVE_ALL_CONTENT = true;
export const TEST_ITEM_QTY = 3;

/** 覆盖范围：物品库二级分类为「田块」「资源」，或一级分类为「道具」 */
const TEST_TIER2 = new Set(['田块', '资源']);
const TEST_TIER1 = new Set(['道具']);

export function createTestCoverageItems() {
  if (!TEST_GIVE_ALL_CONTENT) return [];
  const out = [];
  for (const it of Object.values(ITEMS)) {
    if (!(TEST_TIER2.has(it.tier2) || TEST_TIER1.has(it.tier1))) continue;
    out.push({ itemId: it.id, qty: isUniqueItem(it.id) ? 1 : TEST_ITEM_QTY });
  }
  return out;
}

/**
 * 生成初始背包条目
 * @returns {Array<{itemId:string, qty:number}>}
 */
export function createStarterInventory() {
  // 同一 itemId 只保留一条，取两者较大数量（测试包要求"至少 3 个"）
  const merged = new Map(STARTER_ITEMS);
  for (const { itemId, qty } of createTestCoverageItems()) {
    merged.set(itemId, Math.max(merged.get(itemId) || 0, qty));
  }
  return [...merged].map(([itemId, qty]) => ({ itemId, qty }));
}
