// src/data/items.js
// 物品数据入口。
//
// ⚠️ 自 v0.5 起，物品的**全部字段**以《转盘农场_物品库.xlsx》为唯一真相源，
// 由 tools/gen_library.py 生成到 ./generated/library.js。
// 本文件只做"再导出 + 查询辅助"，**不要再往里手写条目**——要加物品请改表格，
// 再到 tools/lib_meta.json 登记「编号 → id / emoji」，然后重跑生成脚本。
//
// 生成命令：python tools/gen_library.py

import {
  ITEMS as LIB_ITEMS,
  LIB_STAT,
  POOLS,
  OUTPUTS,
  GLOSSARY,
  CREATURES_REF,
  TODO_LIST,
} from './generated/library.js';

/** 物品总表：id → 物品定义（93 条，按表格顺序） */
export const ITEMS = LIB_ITEMS;

/** 全部物品 id（稳定顺序，便于遍历渲染） */
export const ALL_ITEM_IDS = Object.keys(ITEMS);

/** 表格统计（与物品库「说明」表第 5 节一致） */
export { LIB_STAT, POOLS, OUTPUTS, GLOSSARY, CREATURES_REF, TODO_LIST };

// ────────────────────────────────────────── 查询辅助

/** 取物品定义，找不到返回 null（不抛异常，缺条目由调用方兜底） */
export function getItem(id) {
  return ITEMS[id] || null;
}

/** 取物品显示名 */
export function itemName(id) {
  return ITEMS[id]?.name || id;
}

/** 取物品 emoji */
export function itemEmoji(id) {
  return ITEMS[id]?.emoji || '❓';
}

/** 按一级分类取（地块内容 / 道具 / 产物 / 载具 / 地形 / 杂物） */
export function itemsByTier1(tier1) {
  return ALL_ITEM_IDS.map((id) => ITEMS[id]).filter((it) => it.tier1 === tier1);
}

/** 按二级分类取（设施 / 资源 / 技能 / 消耗道具 / 基础道具 / 作物 / 畜产品 / 战利品 …） */
export function itemsByTier2(tier2) {
  return ALL_ITEM_IDS.map((id) => ITEMS[id]).filter((it) => it.tier2 === tier2);
}

/** 按库编号取（FAC-001 / PRD-CROP-001 …），便于与表格对照 */
export function itemByLibCode(code) {
  const id = ALL_ITEM_IDS.find((k) => ITEMS[k].libCode === code);
  return id ? ITEMS[id] : null;
}

/** 该物品在随机池里的买价（同一条目可能出现在多个池，取第一个非空） */
export function getBuyPrice(id) {
  for (const pool of Object.values(POOLS)) {
    const hit = pool.entries.find((e) => e.id === id && e.price != null);
    if (hit) return hit.price;
  }
  return null;
}
