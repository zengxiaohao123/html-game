/**
 * data/loot.js —— 空地搜索资源池（§3.4.2）与区域过滤（§3.4.1）
 *
 * 三档独立 roll：1 档 50%、2 档 40%、3 档 20%，命中后等概率抽 1。
 * 野外：不能出现 空瓶子/金币/蓝星粉末；城市：不能出现 木材/亚麻/果子/蓝星石。
 * 过滤后换一个同等级合法物品，不减少收获数量。
 */

import { Area } from '../core/Const.js';

// 金币作为独立堆叠物品 id
export const GOLD_ID = 'gold';

/** 资源池：每档等概率抽取。条目为 {item,count} */
export const EMPTY_TILE_POOL = {
  1: [
    { item: 'wood', count: 1 }, { item: 'linen', count: 1 },
    { item: 'fruit', count: 1 }, { item: 'bottle', count: 1 },
    { item: GOLD_ID, count: 1 }, { item: 'bluePowder', count: 1 },
  ],
  2: [
    { item: 'wood', count: 2 }, { item: 'linen', count: 2 }, { item: 'fruit', count: 2 },
    { item: 'blueStone', count: 1 }, { item: 'bottle', count: 2 }, { item: GOLD_ID, count: 2 },
    { item: 'bluePowder', count: 2 }, { item: 'tilePlain', count: 1 },
  ],
  3: [
    { item: 'wood', count: 3 }, { item: 'linen', count: 3 }, { item: 'fruit', count: 3 },
    { item: 'blueStone', count: 2 }, { item: 'bottle', count: 3 }, { item: GOLD_ID, count: 3 },
    { item: 'bluePowder', count: 3 }, { item: 'amethyst', count: 1 }, { item: 'iron', count: 1 },
    { item: 'tilePlain', count: 1 }, { item: 'tileGrass', count: 1 },
    { item: 'tileWater', count: 1 }, { item: 'tileIce', count: 1 },
  ],
};

export const EMPTY_TILE_TIER_PROB = { 1: 0.50, 2: 0.40, 3: 0.20 };

const WILD_FORBIDDEN = new Set(['bottle', GOLD_ID, 'bluePowder']);
const CITY_FORBIDDEN = new Set(['wood', 'linen', 'fruit', 'blueStone']);

export function isLootLegal(itemId, area) {
  if (area === Area.WILD) return !WILD_FORBIDDEN.has(itemId);
  if (area === Area.CITY) return !CITY_FORBIDDEN.has(itemId);
  return true;
}

/**
 * 从指定档抽取一个"区域合法"物品；若抽中非法则在该档合法池中等概率重抽。
 * 若该档没有任何合法物品（理论不会发生），返回 null。
 */
export function sampleTier(tier, area, rngSource) {
  const pool = EMPTY_TILE_POOL[tier];
  const legal = pool.filter((e) => isLootLegal(e.item, area));
  if (legal.length === 0) {
    // 兜底：从其他档合法池中找
    return null;
  }
  return rngSource.pick(legal);
}

/** 《愧怍》补偿：当前区域资源池（§3.4.3 简化为自然资源/城市资源） */
export function compensationResource(area, rngSource, count = 1) {
  const wildPool = ['wood', 'linen', 'fruit', 'blueStone'];
  const cityPool = ['bottle', GOLD_ID, 'bluePowder'];
  const pool = area === Area.WILD ? wildPool : cityPool;
  return { item: rngSource.pick(pool), count };
}

/** 矿脉摧毁掉落（§3.2.1.1）：蓝星石75/铁块10/紫水晶10/钻石5 */
export const MINE_DROP_TABLE = [
  { item: 'blueStone', p: 0.75 },
  { item: 'iron', p: 0.10 },
  { item: 'amethyst', p: 0.10 },
  { item: 'diamond', p: 0.05 },
];
