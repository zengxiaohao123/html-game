/**
 * data/recipes.js —— 合成 / 烹饪配方（§6.6、§6.9.4 篝火）
 *
 * 合成面板（E）：产出物品/材料，不能直接生成设施实体。
 * 篝火烹饪：独立配方列表（目前仅熟肉）。
 * 永久物品"成本递增"规则写在 items.js 的 craft.increment，
 * 由合成系统在结算时按已拥有数量动态计算。
 */

export const CRAFT_RECIPES = [
  // 明心浆两条配方
  { id: 'mingxin_stone', name: '熬制明心浆（蓝星石）', consume: { blueStone: 8 }, produce: { mingxin: 1 } },
  { id: 'mingxin_powder', name: '熬制明心浆（蓝星粉末）', consume: { bluePowder: 16 }, produce: { mingxin: 1 } },
];

/** 篝火烹饪配方 */
export const COOK_RECIPES = [
  { id: 'cook_meat', name: '烤肉', consume: { rawMeat: 1, wood: 1 }, produce: { cookedMeat: 1 } },
];
