// src/systems/ForgeSystem.js
// Agent 3 —— 合成系统
// 设计文档 §16.13（简略）—— 先写死几个简单配方，recipes.js 后续补
// TalentSystem.onCraftCheck 巧手·等级 1 返原材料概率接入
//
// 配方（Phase 5 之前先用写死版本，待补 recipes.js 后迁移）
//   forge_wheat_to_straw   : item_wheat ×3 → item_rice_straw ×5
//   forge_straw_to_rope    : item_rice_straw ×5 → item_rope ×1（虚构示例）
//   forge_corn_to_food     : item_corn ×2 + item_wheat ×1 → item_food_simple ×1（虚构）
//   forge_cabbage_to_salad : item_cabbage ×2 → item_salad ×1（虚构）
//   forge_strawberry_to_jam: item_strawberry ×3 → item_jam ×1（虚构）
//
// 注：虚构物品在 items.js 里还没定义，合成后 TalentSystem 会 addItem 时走不上 —— 简化：
//     先用已存在的物品配方（小麦 ↔ 稻草 双向、土豆数量翻倍等）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { InventorySystem } from './InventorySystem.js';
import { TalentSystem } from './TalentSystem.js';

// TODO: Phase 5 把这些移到 src/data/recipes.js
const RECIPES = {
  forge_wheat_to_straw: {
    id: 'forge_wheat_to_straw',
    name: '小麦 → 稻草',
    emoji: '🌾',
    ingredients: [
      { itemId: 'item_wheat', qty: 3 },
    ],
    outputs: [
      { itemId: 'item_rice_straw', qty: 5 },
    ],
    description: '3 小麦 → 5 稻草',
  },
  forge_straw_to_wheat: {
    id: 'forge_straw_to_wheat',
    name: '稻草 → 小麦',
    emoji: '🌾',
    ingredients: [
      { itemId: 'item_rice_straw', qty: 4 },
    ],
    outputs: [
      { itemId: 'item_wheat', qty: 3 },
    ],
    description: '4 稻草 → 3 小麦',
  },
  forge_wheat_to_corn: {
    id: 'forge_wheat_to_corn',
    name: '小麦 → 玉米',
    emoji: '🌽',
    ingredients: [
      { itemId: 'item_wheat', qty: 3 },
    ],
    outputs: [
      { itemId: 'item_corn', qty: 1 },
    ],
    description: '3 小麦 → 1 玉米',
  },
  forge_corn_to_cabbage: {
    id: 'forge_corn_to_cabbage',
    name: '玉米 → 卷心菜',
    emoji: '🥬',
    ingredients: [
      { itemId: 'item_corn', qty: 2 },
      { itemId: 'item_wheat', qty: 1 },
    ],
    outputs: [
      { itemId: 'item_cabbage', qty: 2 },
    ],
    description: '2 玉米 + 1 小麦 → 2 卷心菜',
  },
  forge_strawberry_to_pea: {
    id: 'forge_strawberry_to_pea',
    name: '草莓 → 豌豆',
    emoji: '🫛',
    ingredients: [
      { itemId: 'item_strawberry', qty: 2 },
    ],
    outputs: [
      { itemId: 'item_pea', qty: 3 },
    ],
    description: '2 草莓 → 3 豌豆',
  },
  forge_pea_to_herb: {
    id: 'forge_pea_to_herb',
    name: '豌豆 → 草药',
    emoji: '🌿',
    ingredients: [
      { itemId: 'item_pea', qty: 3 },
    ],
    outputs: [
      { itemId: 'item_herb', qty: 1 },
    ],
    description: '3 豌豆 → 1 草药',
  },
};

export const ALL_RECIPE_IDS = Object.keys(RECIPES);

export function getRecipe(id) {
  return RECIPES[id] || null;
}

export function getAllRecipes() {
  return Object.values(RECIPES);
}

/**
 * 检查配方是否满足（所有 ingredient 都有足够数量）
 */
export function canCraft(gs, recipeId) {
  const r = getRecipe(recipeId);
  if (!r) return false;
  for (const ing of r.ingredients) {
    const have = InventorySystem.countItem(gs, ing.itemId);
    if (have < ing.qty) return false;
  }
  return true;
}

/**
 * 执行合成
 * @returns {{ ok: boolean, message?: string, returnedMaterial?: { itemId: string, qty: number } }}
 */
export function craft(gs, recipeId) {
  const r = getRecipe(recipeId);
  if (!r) return { ok: false, message: 'unknownRecipe' };

  if (!canCraft(gs, recipeId)) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🔨 ${r.name}：材料不足`, duration: 1500 });
    return { ok: false, message: 'notEnoughMaterials' };
  }

  // 1. 扣材料（先检查巧手·等级 1 返原材料 —— 在扣之前 check）
  // 简化：先执行 TalentSystem.onCraftCheck，若要返就记下来返哪个
  const craftMaterialsClone = r.ingredients.map(i => ({ ...i }));
  const refundCheck = TalentSystem.onCraftCheck(gs, craftMaterialsClone);

  // 扣材料
  for (const ing of r.ingredients) {
    InventorySystem.removeItem(gs, ing.itemId, ing.qty);
  }

  // 产出物品
  for (const out of r.outputs) {
    InventorySystem.addItem(gs, out.itemId, out.qty);
  }

  // 巧手返原材料
  let returnedMaterial = null;
  if (refundCheck.returned && refundCheck.itemId) {
    InventorySystem.addItem(gs, refundCheck.itemId, refundCheck.qty || 1);
    returnedMaterial = { itemId: refundCheck.itemId, qty: refundCheck.qty || 1 };
    EventBus.emit(GE.TOAST_SHOW, { text: `✨ 巧手：返原材料 ${refundCheck.itemId} ×${refundCheck.qty || 1}`, duration: 1500 });
  }

  EventBus.emit(GE.FORGE_COMPLETE, { recipeId });
  EventBus.emit(GE.TOAST_SHOW, { text: `🔨 合成 ${r.name} 完成`, duration: 1500 });
  devLog.info('[ForgeSystem.craft]', recipeId, '→', r.outputs);

  return { ok: true, returnedMaterial };
}

export const ForgeSystem = {
  getRecipe,
  getAllRecipes,
  canCraft,
  craft,
};
