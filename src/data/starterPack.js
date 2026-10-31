// src/data/starterPack.js
// 开局背包（v0.5 开发期测试用）
//
// 设计文档要求"开局给玩家随机若干地块内容"，但随机数量太少不便验证功能。
// 这里给一份固定的测试包：每个分类都有代表条目，覆盖放置 / 使用 / 放置型 / 收集。
// 正式平衡时把 STARTER_ITEMS 换成随机抽取即可（接口不变）。

/** [itemId, 数量] */
export const STARTER_ITEMS = [
  // ── 地形（可像设施一样拖到地块上）──
  ['terrain_grass', 10],
  ['terrain_water', 5],
  ['terrain_ice', 5],
  ['terrain_none', 5],

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

  // ── 基础道具（技能石"获得即习得"只在游戏内获得时触发；开局直接给技能本体）──
  ['skill_link_shift', 1],
  ['grimoire_grain_full', 1],

  // ── 收藏品（验证获得即生效）──
  ['collectible_royal_pillow', 1],
  ['collectible_deadwood', 1],
];

/** 初始金币（开发期给足，便于测试商店刷新 4/8/12） */
export const STARTER_GOLD = 50;

/**
 * 生成初始背包条目
 * @returns {Array<{itemId:string, qty:number}>}
 */
export function createStarterInventory() {
  return STARTER_ITEMS.map(([itemId, qty]) => ({ itemId, qty }));
}
