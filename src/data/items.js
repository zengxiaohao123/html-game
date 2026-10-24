// src/data/items.js
// Phase 2A 产出物品表
// 每物品：{ id, name, emoji, category, value }
//   category:
//     'crop'    —— 作物（小麦 / 稻草 / 土豆 / 草莓 / 豌豆）
//     'creature' —— 生物产物（鸡蛋 / 生肉）
//     'slime'   —— 史莱姆产物（史莱姆胶）
//     'vehicle' —— 载具原料（轮子）
//   value: 基础出售价格（InventorySystem.loadFromOutbox 按 value × qty 合计金币）
//
// 设计文档 §9：背包叠放规则 = 同名同价值可叠；不同价值同名分堆
// 郁金香特殊：价值 -4~+10，不同价值郁金香占不同格（Phase 2B 背包 UI 处理，此处先占位）

export const ITEMS = {
  // ── 作物 ──
  item_wheat: {
    id: 'item_wheat',
    name: '小麦',
    emoji: '🌾',
    category: 'crop',
    value: 1,
  },
  item_rice_straw: {
    id: 'item_rice_straw',
    name: '稻草',
    emoji: '🌾',
    category: 'crop',
    value: 1,
  },
  item_potato: {
    id: 'item_potato',
    name: '土豆',
    emoji: '🥔',
    category: 'crop',
    value: 2,
  },
  item_strawberry: {
    id: 'item_strawberry',
    name: '草莓',
    emoji: '🍓',
    category: 'crop',
    value: 2,
  },
  item_pea: {
    id: 'item_pea',
    name: '豌豆',
    emoji: '🫛',
    category: 'crop',
    value: 2,
  },

  // ── 生物产物 ──
  item_egg: {
    id: 'item_egg',
    name: '鸡蛋',
    emoji: '🥚',
    category: 'creature',
    value: 3,
  },
  item_raw_meat: {
    id: 'item_raw_meat',
    name: '生肉',
    emoji: '🍖',
    category: 'creature',
    value: 5,
  },

  // ── 史莱姆产物 ──
  item_slime_gel: {
    id: 'item_slime_gel',
    name: '史莱姆胶',
    emoji: '🟢',
    category: 'slime',
    value: 4,
  },

  // ── 载具原料 ──
  item_wheel: {
    id: 'item_wheel',
    name: '轮子',
    emoji: '⚙️',
    category: 'vehicle',
    value: 5,
  },
};

export const ALL_ITEM_IDS = Object.keys(ITEMS);
