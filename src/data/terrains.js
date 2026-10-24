// src/data/terrains.js
// 4 种地形定义：grass / water / none / mud
// 地形是地块三属性中最底层的一层，决定元素量上限与设施词条条件（例：麦田草地 +1）

/**
 * 地形数据表
 * id 会被 Assets.terrains 映射为 emoji；elementAmount 表示该格可提供的元素量。
 * 稻田地：草地额外 +1、相邻水面额外 +2 —— 判断通过 checkAdjacentWater(gs, tileIdx)。
 */
export const TERRAINS = {
  grass: {
    id: 'grass',
    name: '草地',
    elementAmount: 10,
  },
  water: {
    id: 'water',
    name: '水面',
    elementAmount: 10,
  },
  none: {
    id: 'none',
    name: '虚空',
    elementAmount: 0,
  },
  mud: {
    id: 'mud',
    name: '泥地',
    elementAmount: 10,
  },
};

export const ALL_TERRAIN_IDS = Object.keys(TERRAINS);
