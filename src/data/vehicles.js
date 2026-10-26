// src/data/vehicles.js
// v0.4 §14.7 载具系统定义
// 载具在载具页面（T 键）独立管理，不在背包中
// 字段严格从文档提取，文档没写的字段不添加

export const VEHICLES = {
  vehicle_wheel: {
    id: 'vehicle_wheel',
    name: '轮子',
    emoji: '⚙️',
    description: '装载后能够移动到沿上下左右方向最多 2 格内的任意地块（不能斜着，允许穿越非法位置但不能停留），可使用 1 次',
    movePattern: 'directional',  // directional=指定方向最多 N 格
    maxRange: 2,                 // 最多格数
    canCrossIllegal: true,       // 能穿越非法位置（但不能停留）
    usageCount: 1,               // 可使用次数
  },

  vehicle_broom: {
    id: 'vehicle_broom',
    name: '魔法扫帚',
    emoji: '🧹',
    description: '装载后能够移动到同一行（列）内的任意地块，可使用 2 次',
    movePattern: 'line',  // line=同行列任意格
    maxRange: null,       // 任意格
    canCrossIllegal: false,
    usageCount: 2,
  },

  vehicle_chance: {
    id: 'vehicle_chance',
    name: '巧遇',
    emoji: '✨',
    description: '夏阳心想事成天赋专用，移动至任意一格，每天限 1 次',
    movePattern: 'any',   // any=任意格
    maxRange: null,
    canCrossIllegal: true,
    usageCount: 1,
    talentExclusive: 'xiayang_want',  // 关联天赋 id（心想事成）
    perDayLimit: 1,
  },
};

export const ALL_VEHICLE_IDS = Object.keys(VEHICLES);
