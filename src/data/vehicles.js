// src/data/vehicles.js
// 载具表 —— 对齐《物品库》VEH-001 ~ VEH-015（设计文档 v0.5 §14.7）
//
// 载具不在背包里，独立走载具页面（T）。每辆载具次数独立，用尽即消失，
// 只有【巧遇】例外（天天可用、不因次数耗尽消失）。
//
// 字段说明：
//   movePattern  'directional' 直线 N 格（同方向）
//                'line'        同一行或同一列任意格
//                'range'       曼哈顿距离 ≤ maxRange 任意格
//                'any'         任意格
//                'random'      随机一格（系统自选，不需要玩家指定目标）
//   landFilter   落点必须是"设施 / 资源 / 技能"等，null 表示无限制
//   freeStamina  本次移动不消耗行动力
//   staminaGain  到达后额外回复的行动力（允许超出上限，次日清除）
//   goldOnArrive 到达后获得金币
//   usageCount   可使用次数（Infinity = 用不完，配 perDayLimit 使用）
//   perDayLimit  每日可用次数
//
// canCrossIllegal：中途可穿越栅栏/虚空，但落点必须合法。

export const VEHICLES = {
  // ── VEH-001 轮子 ──
  vehicle_wheel: {
    id: 'vehicle_wheel',
    name: '轮子',
    emoji: '🛞',
    description: '装载后能够移动到直线 2 格内的任意地块，可使用 1 次',
    movePattern: 'directional',
    maxRange: 2,
    canCrossIllegal: true,
    usageCount: 1,
    rarity: 1,
  },

  // ── VEH-002 魔法扫帚 ──
  vehicle_broom: {
    id: 'vehicle_broom',
    name: '魔法扫帚',
    emoji: '🧹',
    description: '装载后能够移动到同一行（列）内的任意地块，可使用 2 次',
    movePattern: 'line',
    maxRange: null,
    canCrossIllegal: false,
    usageCount: 2,
    rarity: 3,
  },

  // ── VEH-003 巧遇（夏阳天赋【心想事成】专属，不因次数耗尽消失）──
  vehicle_chance: {
    id: 'vehicle_chance',
    name: '巧遇',
    emoji: '🍀',
    description: '装载后能够移动至任意地块，每天限 1 次',
    movePattern: 'any',
    maxRange: null,
    canCrossIllegal: true,
    usageCount: Infinity,
    perDayLimit: 1,
    persistent: true,          // 用完不消失
    cannotEnterFence: true,    // 不能进入栅栏内
    talentExclusive: 'xiayang_want',
    rarity: 99,
  },

  // ── VEH-004 农场图腾 ──
  vehicle_totem_farm: {
    id: 'vehicle_totem_farm',
    name: '农场图腾',
    emoji: '🗿',
    description: '装载后能够移动至任意家或帐篷所在地块，可使用 1 次',
    movePattern: 'any',
    maxRange: null,
    canCrossIllegal: true,
    landFilter: { contentIds: ['facility_home', 'facility_tent'] },
    usageCount: 1,
    rarity: 1,
  },

  // ── VEH-005 购物车 ──
  vehicle_cart: {
    id: 'vehicle_cart',
    name: '购物车',
    emoji: '🛒',
    description: '装载后能够移动至任意商店或魔法商店所在地块且移动后获得金币 ×4，可使用 2 次',
    movePattern: 'any',
    maxRange: null,
    canCrossIllegal: true,
    landFilter: { contentIds: ['resource_shop', 'resource_magic_shop'] },
    goldOnArrive: 4,
    usageCount: 2,
    rarity: 3,
  },

  // ── VEH-006 momo 图腾 ──
  vehicle_totem_momo: {
    id: 'vehicle_totem_momo',
    name: 'momo 图腾',
    emoji: '🐱',
    description: '装载后能够移动至随机地块（不消耗行动力，优先传送至本日内未进入过的地块），可使用 1 次',
    movePattern: 'random',
    maxRange: null,
    canCrossIllegal: true,
    preferUnvisitedToday: true,
    freeStamina: true,
    usageCount: 1,
    rarity: 2,
  },

  // ── VEH-007 唤风号角 ──
  vehicle_horn: {
    id: 'vehicle_horn',
    name: '唤风号角',
    emoji: '📯',
    description: '装载后能够移动至任意地块（不消耗行动力），可使用 1 次',
    movePattern: 'any',
    maxRange: null,
    canCrossIllegal: true,
    freeStamina: true,
    usageCount: 1,
    rarity: 3,
  },

  // ── VEH-008 马匹 ──
  vehicle_horse: {
    id: 'vehicle_horse',
    name: '马匹',
    emoji: '🐎',
    description: '装载后能够移动至 3 格距离内的任意地块，可使用 3 次',
    movePattern: 'range',
    maxRange: 3,
    canCrossIllegal: true,
    usageCount: 3,
    rarity: 2,
  },

  // ── VEH-009 地龙 ──
  vehicle_earth_dragon: {
    id: 'vehicle_earth_dragon',
    name: '地龙',
    emoji: '🐉',
    description: '装载后能够移动至直线 4 格内的任意地块，可使用 2 次',
    movePattern: 'directional',
    maxRange: 4,
    canCrossIllegal: true,
    usageCount: 2,
    rarity: 2,
  },

  // ── VEH-010 拖拉机 ──
  vehicle_tractor: {
    id: 'vehicle_tractor',
    name: '拖拉机',
    emoji: '🚜',
    description: '装载后能够移动至同一行（列）内的任意设施所在地块，可使用 1 次',
    movePattern: 'line',
    maxRange: null,
    canCrossIllegal: false,
    landFilter: { tier2: '设施' },
    usageCount: 1,
    rarity: 1,
  },

  // ── VEH-011 旅游大巴 ──
  vehicle_tour_bus: {
    id: 'vehicle_tour_bus',
    name: '旅游大巴',
    emoji: '🚌',
    description: '装载后能够移动至任意资源所在地块，可使用 1 次',
    movePattern: 'any',
    maxRange: null,
    canCrossIllegal: true,
    landFilter: { tier2: '资源' },
    usageCount: 1,
    rarity: 2,
  },

  // ── VEH-012 飞剑 ──
  vehicle_flying_sword: {
    id: 'vehicle_flying_sword',
    name: '飞剑',
    emoji: '🗡️',
    description: '装载后能够移动至任意技能所在地块，可使用 1 次',
    movePattern: 'any',
    maxRange: null,
    canCrossIllegal: true,
    landFilter: { tier2: '技能' },
    usageCount: 1,
    rarity: 2,
  },

  // ── VEH-013 魔法飞毯 ──
  vehicle_flying_carpet: {
    id: 'vehicle_flying_carpet',
    name: '魔法飞毯',
    emoji: '🧞',
    description: '装载后能够移动至任意地块，可使用 3 次',
    movePattern: 'any',
    maxRange: null,
    canCrossIllegal: true,
    usageCount: 3,
    rarity: 4,
  },

  // ── VEH-014 重弹簧 ──
  vehicle_spring: {
    id: 'vehicle_spring',
    name: '重弹簧',
    emoji: '🌀',
    description: '装载后能够移动至 2 格距离内的任意地块（不消耗行动力），可使用 1 次',
    movePattern: 'range',
    maxRange: 2,
    canCrossIllegal: true,
    freeStamina: true,
    usageCount: 1,
    rarity: 2,
  },

  // ── VEH-015 拓荒者 ──
  vehicle_pioneer: {
    id: 'vehicle_pioneer',
    name: '拓荒者',
    emoji: '🛻',
    description: '装载后能够移动至 2 格距离内的任意地块（不消耗行动力）且移动后行动力 +5，可使用 1 次',
    movePattern: 'range',
    maxRange: 2,
    canCrossIllegal: true,
    freeStamina: true,
    staminaGain: 5,      // 允许超出上限；超出部分次日开始时清除
    usageCount: 1,
    rarity: 5,
  },
};

export const ALL_VEHICLE_IDS = Object.keys(VEHICLES);

/** 物品 id（item_*）→ 载具 id（vehicle_*），用于背包/商店发奖时转换 */
export const ITEM_TO_VEHICLE = {
  item_wheel: 'vehicle_wheel',
  item_broom: 'vehicle_broom',
  item_chance: 'vehicle_chance',
  item_totem_farm: 'vehicle_totem_farm',
  item_cart: 'vehicle_cart',
  item_totem_momo: 'vehicle_totem_momo',
  item_horn: 'vehicle_horn',
  item_horse: 'vehicle_horse',
  item_earth_dragon: 'vehicle_earth_dragon',
  item_tractor: 'vehicle_tractor',
  item_tour_bus: 'vehicle_tour_bus',
  item_flying_sword: 'vehicle_flying_sword',
  item_flying_carpet: 'vehicle_flying_carpet',
  item_spring: 'vehicle_spring',
  item_pioneer: 'vehicle_pioneer',
};

export function getVehicle(id) {
  return VEHICLES[id] || null;
}
