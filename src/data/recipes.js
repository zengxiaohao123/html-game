// src/data/recipes.js
// Forge 合成配方表（阶段 1 从 ForgeSystem.js 抽离）
// 来源：原 ForgeSystem.js L23-97 写死配方（虚构占位数值，物品库尚无 recipes 表）
// 未来物品库补充 recipes 定义后，此文件改为 gen_library.py 自动生成。
//
// 字段说明：
//   ingredients: [{ itemId, qty }]  消耗材料
//   outputs:     [{ itemId, qty }]  产出物品
//
// 注：所有 itemId 必须在 src/data/generated/library.js 的 ITEMS 表里存在，
//     否则 ForgeSystem.addItem 时会因为找不到 ITEMS[itemId] 而在 InventorySystem 里报错。

export const RECIPES = {
  forge_wheat_to_straw: {
    id: 'forge_wheat_to_straw',
    name: '小麦 → 稻草',
    emoji: '🌾',
    icon: null,
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
    icon: null,
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
    icon: null,
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
    icon: null,
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
    icon: null,
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
    icon: null,
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
