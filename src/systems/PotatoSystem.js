// src/systems/PotatoSystem.js
// 土豆田块储存体系（魔导书 batch：薯道难 / 薯条四重奏 的数值底座）
//
// 口径（写入设计文档 §20.1）：
//   · 单块基础容量 30（历史值），薯条四重奏生效时每块 +10；
//   · 薯道难生效时，所有土豆田块共用同一份容量池，总储存量受同一上限约束；
//   · 容量下调（田块数量不再是 4 的倍数）不会销毁已有土豆，只是后续增产被挡住，
//     所以 UI 允许显示「已储存 > 容量」；
//   · 收获（采摘）按「优先扣前排田块」的顺序分配；薯道难时一次可拿走全部田块的土豆。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { InventorySystem } from './InventorySystem.js';
import { hasGrimoire, syncPumpkin } from './PassiveItemSystem.js';

export const POTATO_ID = 'facility_potato';
export const POTATO_BASE_CAP = 30;
export const FRIES_BONUS = 10;
export const POTATO_DAILY_ADD = 3;
export const POTATO_BLESS_ADD = 5;

export const GRIMOIRE_POTATO_HARDSHIP = 'grimoire_potato_hardship';
export const GRIMOIRE_POTATO_MINE = 'grimoire_potato_mine';
export const GRIMOIRE_FRIES_QUARTET = 'grimoire_fries_quartet';

const potatoTilesOf = (gs) => (gs?.map?.outerTiles || []).filter((t) => t?.contentId === POTATO_ID);

/** 场上土豆田块数量 */
export function countPotatoTiles(gs) {
  return potatoTilesOf(gs).length;
}

/** 薯道难：所有土豆田块共用容量 */
export function hasPotatoHardship(gs) {
  return hasGrimoire(gs, GRIMOIRE_POTATO_HARDSHIP);
}

/** 薯条四重奏：田块数量恰为 4 的倍数（且至少 4 块）时，每块容量 +10 */
export function hasFriesQuartet(gs) {
  const n = countPotatoTiles(gs);
  return hasGrimoire(gs, GRIMOIRE_FRIES_QUARTET) && n > 0 && n % 4 === 0;
}

/** 单块 / 共用池容量（30 或 40） */
export function potatoCapacity(gs) {
  return POTATO_BASE_CAP + (hasFriesQuartet(gs) ? FRIES_BONUS : 0);
}

/** 某块的已储存数量 */
export function potatoStoredOf(tile) {
  const v = tile?.contentState?.potatoStored;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** 场上全部土豆田块的储存总量 */
export function potatoTotalStored(gs) {
  return potatoTilesOf(gs).reduce((sum, t) => sum + potatoStoredOf(t), 0);
}

/** 当前还能再存多少（薯道难看总量，否则看单块） */
export function potatoRoomFor(gs, tile) {
  const cap = potatoCapacity(gs);
  if (hasPotatoHardship(gs)) return Math.max(0, cap - potatoTotalStored(gs));
  return Math.max(0, cap - potatoStoredOf(tile));
}

/**
 * 往某块加土豆（自动按容量截断）
 * @returns {number} 实际增加的个数
 */
export function addPotatoStored(gs, tile, amount) {
  if (!tile || amount <= 0) return 0;
  const room = potatoRoomFor(gs, tile);
  const add = Math.min(Math.floor(amount), room);
  if (add <= 0) return 0;
  const cs = tile.contentState || (tile.contentState = {});
  cs.potatoStored = potatoStoredOf(tile) + add;
  return add;
}

/**
 * 收获土豆：薯道难时从所有田块依次扣减，否则只扣当前块。
 * @param {object} gs
 * @param {number} tileIdx 玩家所在的土豆田块
 * @param {number} qty 期望收获数量
 * @returns {{ actual: number, touched: number[] }}
 */
export function harvestPotato(gs, tileIdx, qty) {
  const num = Math.max(0, Math.floor(Number(qty) || 0));
  if (num <= 0) return { actual: 0, touched: [] };

  const touched = [];
  let actual = 0;
  if (hasPotatoHardship(gs)) {
    let left = num;
    for (const t of potatoTilesOf(gs)) {
      if (left <= 0) break;
      const stored = potatoStoredOf(t);
      if (stored <= 0) continue;
      const take = Math.min(stored, left);
      t.contentState.potatoStored = stored - take;
      if (t.contentState.potatoStored <= 0) t.contentState.potatoStored = 0;
      touched.push(t.idx);
      actual += take;
      left -= take;
    }
  } else {
    const tile = gs?.map?.outerTiles?.[tileIdx];
    const stored = potatoStoredOf(tile);
    const take = Math.min(stored, num);
    if (take > 0) {
      const cs = tile.contentState || (tile.contentState = {});
      cs.potatoStored = stored - take;
      if (cs.potatoStored <= 0) cs.potatoStored = 0;
      touched.push(tileIdx);
      actual = take;
    }
  }

  if (actual <= 0) return { actual: 0, touched: [] };

  InventorySystem.addItem(gs, 'item_potato', actual);
  syncPumpkin(gs);
  EventBus.emit(GE.INVENTORY_CHANGE);
  for (const idx of touched) EventBus.emit(GE.TILE_UPDATED, { tileIdx: idx });
  return { actual, touched };
}

/**
 * 土豆地雷伤害量：
 *   · 薯道难 → 场上土豆储存总数量；
 *   · 否则 → 埋雷来源田块当前储存数量（田块已被拆除则按 0）。
 */
export function potatoMineDamage(gs, sourceTileIdx) {
  if (hasPotatoHardship(gs)) return potatoTotalStored(gs);
  return potatoStoredOf(gs?.map?.outerTiles?.[sourceTileIdx]);
}

export const PotatoSystem = {
  POTATO_ID,
  POTATO_BASE_CAP,
  FRIES_BONUS,
  countPotatoTiles,
  hasPotatoHardship,
  hasFriesQuartet,
  potatoCapacity,
  potatoStoredOf,
  potatoTotalStored,
  potatoRoomFor,
  addPotatoStored,
  harvestPotato,
  potatoMineDamage,
};

export default PotatoSystem;
