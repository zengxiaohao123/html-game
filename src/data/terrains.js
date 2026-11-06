// src/data/terrains.js
// 地形表 —— 对齐《物品库》TRN-000 ~ TRN-003（设计文档 v0.5 §4）
//
// v0.5 的变化：
//   1. 地形升为一级物品分类：背包里是物品，拖到地块后变成该格的「状态」；
//   2. 新增「冰面」；废弃 v0.3 草案里的「泥地」——泥地从来不是设计文档里的地形，
//      它来自早期把【粘液】debuff 误当地形，v0.5 已无此概念；
//   3. 地块生成时的初始地形分布：50% 无地形 / 40% 草地 / 10% 水面。
//
// id 与物品库一致（terrain_*），这样「背包里的地形物品」与「地块上的 terrain 字段」
// 是同一个字符串，放置时不需要任何转换。
//
// 兼容：旧存档/旧代码里可能还写着 'none' / 'grass' / 'water' / 'mud'，
// 统一用 normalizeTerrain() 归一化，不要在各处手写 if。

import { ITEMS } from './items.js';
export const TERRAINS = {
  terrain_none: {
    id: 'terrain_none',
    key: 'none',
    name: '无地形',
    elementAmount: 0,      // 无地形没有元素量
    blocksMove: false,
    description: ITEMS.terrain_none.description,
  },
  terrain_grass: {
    id: 'terrain_grass',
    key: 'grass',
    name: '草地',
    elementAmount: 10,
    blocksMove: false,
    description: ITEMS.terrain_grass.description,
  },
  terrain_water: {
    id: 'terrain_water',
    key: 'water',
    name: '水面',
    elementAmount: 10,
    blocksMove: false,     // v0.5 明确：水面不阻碍移动
    description: ITEMS.terrain_water.description,
  },
  terrain_ice: {
    id: 'terrain_ice',
    key: 'ice',
    name: '冰面',
    elementAmount: 10,
    blocksMove: false,     // 不阻挡，但会强制滑行
    slippery: true,        // 徒步进入时被迫向前滑行（见 MovementSystem）
    description: ITEMS.terrain_ice.description,
  },
};

export const ALL_TERRAIN_IDS = Object.keys(TERRAINS);

/** 地图生成时的初始地形权重（v0.5 §4：50% 无地形 / 40% 草地 / 10% 水面） */
export const TERRAIN_SPAWN_WEIGHTS = [
  { id: 'terrain_none', weight: 50 },
  { id: 'terrain_grass', weight: 40 },
  { id: 'terrain_water', weight: 10 },
];

/** 旧值 → 新 id 的别名（'mud' 是历史遗留，v0.5 无此地形，归一无地形） */
const LEGACY_ALIAS = {
  none: 'terrain_none',
  grass: 'terrain_grass',
  water: 'terrain_water',
  mud: 'terrain_none',
  ice: 'terrain_ice',
};

/** 把任意历史写法归一化为地形 id；未知值按无地形处理 */
export function normalizeTerrain(value) {
  if (!value) return 'terrain_none';
  if (TERRAINS[value]) return value;
  return LEGACY_ALIAS[value] || 'terrain_none';
}

/** 取地形定义（永不返回 null） */
export function getTerrain(value) {
  return TERRAINS[normalizeTerrain(value)];
}

/** 该地形是否还有元素量可消耗 */
export function terrainHasElement(value) {
  return getTerrain(value).elementAmount > 0;
}

/** 按权重随机一个初始地形 id（供地图生成用） */
export function rollSpawnTerrain(rand = Math.random) {
  const total = TERRAIN_SPAWN_WEIGHTS.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const x of TERRAIN_SPAWN_WEIGHTS) {
    r -= x.weight;
    if (r <= 0) return x.id;
  }
  return 'terrain_none';
}
