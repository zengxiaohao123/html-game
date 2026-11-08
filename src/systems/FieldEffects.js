// src/systems/FieldEffects.js
// 田块通用工具（稻草 / 水稻 / 小麦 系列魔导书共用）
//
// 为什么单独抽一层：
//   1. 「稻草田块」与「水稻田块」在数据里是同一设施（facility_rice：稻田产出稻草），
//      但物品库描述里两种叫法混用；这里统一按"田块类型"建模，避免各处手写 id 判断。
//   2. 魔导书「仓廪实」让稻草田块 / 小麦田块互为视同 —— 这个"视同"必须同时作用于
//      数量统计、连片判定、产出结算三处，所以全部收敛到本模块，任何新效果都从这里取数，
//      不允许在效果实现里再直接 filter(contentId === 'facility_rice')。
//
// 对外 API（供其它系统与并行任务复用）：
//   FIELD_TYPES                        田块类型常量 { RICE:'rice', WHEAT:'wheat' }
//   hasFieldAlias(gs)                  是否持有仓廪实（稻草↔小麦 双向视同）
//   tileFieldKinds(gs, tile)           该格"视同"的田块类型数组
//   isFieldTile(gs, tile, kind)        该格是否视同某类田块
//   countFieldTiles(gs, kind)          视同某类田块的地块数
//   fieldClusterSizeMap(gs, kind)      连通块大小 { Map<idx, size> }（四方向相邻）
//   fieldTilesInCluster(gs, kind, n)   处于"≥n 相连"簇内的地块 idx 集合
//   isFieldInCluster(gs, tileIdx, kind, n)
//   harvestMultiplier(gs, tileIdx)     「庆丰收」该格产出倍率（2 或 1）
//   hasGoldenWaveTrait(gs, tileIdx)    「黄金浪」该格是否具备【经过时】获得小麦 ×1
//   grassElementMultiplier(gs)         「春光好」草元素伤害倍率（1 + 2% × 水稻田块数）
//
// 口径说明（与设计文档同步）：
//   - 田块"数量"按外圈地块个数计，栅栏内不算（与既有实现一致）。
//   - 「相连」= 四方向相邻（上下左右），不含斜角；拐角处只要相邻即算。
//   - 仓廪实只影响"魔导书效果"的田块类型视同，不改任何设施的基础产出。

import { Distance } from '../core/Distance.js';
import { countItem } from './InventorySystem.js';

/** 田块类型常量 */
export const FIELD_TYPES = {
  RICE: 'rice',
  WHEAT: 'wheat',
};

/** 田块类型 → 地块内容 id（稻草田块与水稻田块同为稻田） */
const FACILITY_BY_FIELD = {
  [FIELD_TYPES.RICE]: 'facility_rice',
  [FIELD_TYPES.WHEAT]: 'facility_wheat',
};

const GRIMOIRE_GRANARY_FULL = 'grimoire_granary_full';
const GRIMOIRE_HARVEST_CEREAL = 'grimoire_harvest_cereal';
const GRIMOIRE_GOLDEN_WAVE = 'grimoire_golden_wave';
const GRIMOIRE_SPRING_GLOW = 'grimoire_spring_glow';

/** 持有某魔导书（获得后自动生效；未放置也算） */
function owns(gs, id) {
  return countItem(gs, id) >= 1;
}

/** 是否持有「仓廪实」：稻草田块 ↔ 小麦田块 双向视同 */
export function hasFieldAlias(gs) {
  return owns(gs, GRIMOIRE_GRANARY_FULL);
}

/** 该格真实属于哪种田块（不看仓廪实） */
function realFieldKind(tile) {
  if (!tile || !tile.contentId) return null;
  if (tile.contentId === FACILITY_BY_FIELD[FIELD_TYPES.RICE]) return FIELD_TYPES.RICE;
  if (tile.contentId === FACILITY_BY_FIELD[FIELD_TYPES.WHEAT]) return FIELD_TYPES.WHEAT;
  return null;
}

/**
 * 该格"视同"的田块类型（含仓廪实带来的双向视同）
 * @returns {string[]} FIELD_TYPES 子集；非田块返回 []
 */
export function tileFieldKinds(gs, tile) {
  const real = realFieldKind(tile);
  if (!real) return [];
  if (!hasFieldAlias(gs)) return [real];
  return [real, real === FIELD_TYPES.RICE ? FIELD_TYPES.WHEAT : FIELD_TYPES.RICE];
}

/** 该格是否视同某类田块 */
export function isFieldTile(gs, tile, kind) {
  return tileFieldKinds(gs, tile).includes(kind);
}

/** 视同某类田块的全部地块 idx（顺序 = outerTiles 顺序，稳定） */
export function fieldTileIndices(gs, kind) {
  const out = [];
  const tiles = gs?.map?.outerTiles || [];
  for (let i = 0; i < tiles.length; i++) {
    if (isFieldTile(gs, tiles[i], kind)) out.push(i);
  }
  return out;
}

/** 视同某类田块的地块数量 */
export function countFieldTiles(gs, kind) {
  return fieldTileIndices(gs, kind).length;
}

/**
 * 以四方向相邻求连通块，返回每个地块 idx 所属连通块的大小。
 * @returns {Map<number, number>}
 */
export function fieldClusterSizeMap(gs, kind) {
  const members = new Set(fieldTileIndices(gs, kind));
  const sizes = new Map();
  const seen = new Set();

  for (const start of members) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component = [];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      component.push(cur);
      for (const nb of Distance.outerNeighbors(gs.map, cur)) {
        if (nb == null || !members.has(nb) || seen.has(nb)) continue;
        seen.add(nb);
        stack.push(nb);
      }
    }
    for (const idx of component) sizes.set(idx, component.length);
  }
  return sizes;
}

/**
 * 处于"≥n 个相连"簇内的田块 idx 集合
 * @returns {Set<number>}
 */
export function fieldTilesInCluster(gs, kind, n) {
  const sizes = fieldClusterSizeMap(gs, kind);
  const out = new Set();
  for (const [idx, size] of sizes) {
    if (size >= n) out.add(idx);
  }
  return out;
}

/** 某格是否属于"≥n 个相连"的田块簇 */
export function isFieldInCluster(gs, tileIdx, kind, n) {
  if (tileIdx == null) return false;
  const size = fieldClusterSizeMap(gs, kind).get(tileIdx) || 0;
  return size >= n;
}

/** 是否存在"≥n 个田块相连"的簇 */
export function hasFieldCluster(gs, kind, n) {
  const sizes = fieldClusterSizeMap(gs, kind);
  for (const size of sizes.values()) if (size >= n) return true;
  return false;
}

/**
 * 「庆丰收」：该格产出倍率。
 * 该格视同水稻田块，且处在"≥3 个水稻田块相连"的簇内 → 2，否则 1。
 * 仓廪实生效时，小麦田块同样视同水稻田块，享受本效果。
 */
export function harvestMultiplier(gs, tileIdx) {
  if (!owns(gs, GRIMOIRE_HARVEST_CEREAL)) return 1;
  return isFieldInCluster(gs, tileIdx, FIELD_TYPES.RICE, 3) ? 2 : 1;
}

/**
 * 「黄金浪」：该格是否具备新特性【经过时】获得小麦 ×1。
 * 该格视同小麦田块，且处在"≥3 个小麦田块相连"的簇内 → true。
 */
export function hasGoldenWaveTrait(gs, tileIdx) {
  if (!owns(gs, GRIMOIRE_GOLDEN_WAVE)) return false;
  return isFieldInCluster(gs, tileIdx, FIELD_TYPES.WHEAT, 3);
}

/**
 * 「春光好」：我方单位造成的草元素伤害倍率 = 1 + 2% × 水稻田块数量。
 * 不取整：倍率直接参与乘算，最终伤害由伤害结算统一向下取整。
 */
export function grassElementMultiplier(gs) {
  if (!owns(gs, GRIMOIRE_SPRING_GLOW)) return 1;
  return 1 + 0.02 * countFieldTiles(gs, FIELD_TYPES.RICE);
}

export const FieldEffects = {
  FIELD_TYPES,
  hasFieldAlias,
  tileFieldKinds,
  isFieldTile,
  fieldTileIndices,
  countFieldTiles,
  fieldClusterSizeMap,
  fieldTilesInCluster,
  isFieldInCluster,
  hasFieldCluster,
  harvestMultiplier,
  hasGoldenWaveTrait,
  grassElementMultiplier,
};
