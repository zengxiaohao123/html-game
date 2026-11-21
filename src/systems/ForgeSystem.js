// src/systems/ForgeSystem.js
// Agent 3 —— 合成系统
// 设计文档 §16.13（简略）
// 配方数据已抽到 src/data/recipes.js，本文件只负责合成判定/扣除逻辑。
// TalentSystem.onCraftCheck 巧手·等级 1 返原材料概率接入

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { InventorySystem } from './InventorySystem.js';
import { TalentSystem } from './TalentSystem.js';
import { ALL_RECIPE_IDS, getRecipe, getAllRecipes } from '../data/recipes.js';

export { ALL_RECIPE_IDS, getRecipe, getAllRecipes };

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

/**
 * 找出能产出该物品、且材料足够的第一个配方（没有则 null）。
 * 快捷栏「数量为 0 但可合成」的判定与放置兜底共用这一处，避免两处口径漂移。
 */
export function findCraftableRecipe(gs, itemId) {
  for (const r of getAllRecipes()) {
    const isOutput = (r.outputs || []).some(o => o.itemId === itemId);
    if (isOutput && canCraft(gs, r.id)) return r;
  }
  return null;
}

/**
 * 快捷栏「数量为 0 但可合成」的放置兜底：
 * 库存不足时自动消耗材料合成 1 次；返回是否已有库存可继续放置。
 */
export function ensureStockForPlace(gs, itemId) {
  if (InventorySystem.countItem(gs, itemId) > 0) return true;
  const r = findCraftableRecipe(gs, itemId);
  if (!r) return false;
  return craft(gs, r.id).ok === true;
}

export const ForgeSystem = {
  getRecipe,
  getAllRecipes,
  canCraft,
  craft,
  findCraftableRecipe,
  ensureStockForPlace,
};
