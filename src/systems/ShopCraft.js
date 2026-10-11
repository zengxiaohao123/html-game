/**
 * systems/ShopSystem.js / CraftSystem.js —— 商店（§6.5）与合成（§6.6）
 */

import { SHOP_ITEMS, getItem } from '../data/items.js';
import { CRAFT_RECIPES, COOK_RECIPES } from '../data/recipes.js';
import { GameLog } from '../core/Logger.js';
import { rng } from '../core/Rng.js';

// ---------------- 商店 ----------------
export const ShopSystem = {
  list() { return SHOP_ITEMS; },

  buy(gs, itemId, n = 1) {
    const row = SHOP_ITEMS.find((r) => r.item === itemId);
    if (!row) return { ok: false, msg: '商品不存在' };
    const cost = row.buy * n;
    if (gs.inventory.gold < cost) return { ok: false, msg: '金币不足' };
    gs.inventory.spendGold(cost);
    gs.inventory.add(itemId, n);
    GameLog.good('explore', `购买 ${getItem(itemId).name}×${n}，花费 ${cost} 金币。`);
    return { ok: true };
  },

  sell(gs, itemId, n = 1) {
    const row = SHOP_ITEMS.find((r) => r.item === itemId);
    if (!row) return { ok: false, msg: '该物品不可出售' };
    if (gs.inventory.count(itemId) < n) return { ok: false, msg: '数量不足' };
    gs.inventory.remove(itemId, n);
    const gain = row.sell * n;
    gs.inventory.addGold(gain);
    GameLog.good('explore', `出售 ${getItem(itemId).name}×${n}，获得 ${gain} 金币。`);
    return { ok: true };
  },
};

// ---------------- 合成 ----------------
export const CraftSystem = {
  list() { return CRAFT_RECIPES; },
  cookList() { return COOK_RECIPES; },

  /**
   * 永久物品成本递增：第 N 个 = 基础 + 增量×(N-1)
   * @param {object} itemDef 永久物品 def（含 craft.base/increment）
   */
  permanentCostAt(itemDef, timesAlready) {
    const cost = {};
    for (const [mat, base] of Object.entries(itemDef.craft.base)) {
      const inc = itemDef.craft.increment?.[mat] ?? 0;
      cost[mat] = base + inc * timesAlready;
    }
    return cost;
  },

  /** 普通配方合成 N 份（材料不足整单失败，不做半份） */
  craft(gs, recipeId, times = 1) {
    const recipe = CRAFT_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return { ok: false, msg: '配方不存在' };
    const need = {};
    for (const [m, n] of Object.entries(recipe.consume)) need[m] = n * times;
    if (!gs.inventory.canAfford(need)) return { ok: false, msg: '材料不足' };
    gs.inventory.payCost(need);
    const [[outId, outN]] = Object.entries(recipe.produce);
    gs.inventory.add(outId, outN * times);
    // 陆悠悠·巧手：合成 25% 随机资源
    if (gs.party.has('luyouyou') && rng.roll(0.25)) {
      const pool = ['wood', 'linen', 'fruit', 'blueStone'];
      const it = rng.pick(pool);
      gs.inventory.add(it, 1);
      GameLog.good('explore', `巧手！额外获得 ${getItem(it).name}×1。`);
    }
    GameLog.good('explore', `合成 ${getItem(outId).name}×${outN * times}。`);
    return { ok: true };
  },

  /** 合成永久物品（单件，成本按已合成次数递增） */
  craftPermanent(gs, itemId) {
    const def = getItem(itemId);
    if (!def?.craft) return { ok: false, msg: '不可合成' };
    const times = gs.inventory.craftCount.get(itemId) ?? 0;
    const cost = this.permanentCostAt(def, times);
    if (!gs.inventory.canAfford(cost)) return { ok: false, msg: '材料不足' };
    gs.inventory.payCost(cost);
    gs.inventory.add(itemId, 1);
    gs.inventory.craftCount.set(itemId, times + 1);
    GameLog.good('explore', `打造了 ${def.name}。`);
    return { ok: true };
  },

  /** 篝火烹饪 */
  cook(gs, recipeId, times = 1) {
    const recipe = COOK_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return { ok: false, msg: '配方不存在' };
    const need = {};
    for (const [m, n] of Object.entries(recipe.consume)) need[m] = n * times;
    if (!gs.inventory.canAfford(need)) return { ok: false, msg: '材料不足' };
    gs.inventory.payCost(need);
    const [[outId, outN]] = Object.entries(recipe.produce);
    gs.inventory.add(outId, outN * times);
    GameLog.good('explore', `烹饪 ${getItem(outId).name}×${outN * times}。`);
    return { ok: true };
  },
};
