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
import { takeStoredToBag } from './ProduceSystem.js';
import { hasGrimoire, syncPumpkin } from './PassiveItemSystem.js';
import { contentEntries, getTile, isFenceRef } from '../core/TileAccess.js';
import { isSuppressed } from './SuppressSystem.js';
import { fenceDimsOf } from '../core/Distance.js';

export const POTATO_ID = 'facility_potato';
export const POTATO_BASE_CAP = 30;
export const FRIES_BONUS = 10;
export const POTATO_DAILY_ADD = 3;
export const POTATO_BLESS_ADD = 5;

export const GRIMOIRE_POTATO_HARDSHIP = 'grimoire_potato_hardship';
export const GRIMOIRE_POTATO_MINE = 'grimoire_potato_mine';
export const GRIMOIRE_FRIES_QUARTET = 'grimoire_fries_quartet';

/** 场上全部土豆田块（含放在生效小径格上的——生效小径格按外圈地块对待） */
const potatoEntriesOf = (gs) => contentEntries(gs).filter((e) => e.tile?.contentId === POTATO_ID);
const potatoTilesOf = (gs) => potatoEntriesOf(gs).map((e) => e.tile);

/** 地块变化通知：外圈 idx → TILE_UPDATED；栅栏生效格 → FENCE_TILE_UPDATED */
function emitPotatoTileChanged(gs, ref) {
  if (typeof ref === 'number') {
    EventBus.emit(GE.TILE_UPDATED, { tileIdx: ref });
    return;
  }
  if (isFenceRef(ref)) {
    const dims = fenceDimsOf(gs);
    EventBus.emit(GE.FENCE_TILE_UPDATED, { fenceIdx: ref.row * dims.cols + ref.col, tileRef: ref });
  }
}

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
 * @param {number|object} tileRef 玩家所在的土豆田块（外圈 idx / 栅栏生效格 ref）
 * @param {number} qty 期望收获数量
 * @returns {{ actual: number, touched: (number|object)[] }}
 */
export function harvestPotato(gs, tileRef, qty) {
  const num = Math.max(0, Math.floor(Number(qty) || 0));
  if (num <= 0) return { actual: 0, touched: [] };

  const touched = [];
  const takes = [];           // 每块田实际取走的数量（逐块入包 → 逐件判定蓝息变异）
  let actual = 0;
  if (hasPotatoHardship(gs)) {
    let left = num;
    for (const e of potatoEntriesOf(gs)) {
      if (left <= 0) break;
      if (isSuppressed(gs, e.ref)) continue; // 取走型特性受【压制】约束
      const stored = potatoStoredOf(e.tile);
      if (stored <= 0) continue;
      const take = Math.min(stored, left);
      e.tile.contentState.potatoStored = stored - take;
      if (e.tile.contentState.potatoStored <= 0) e.tile.contentState.potatoStored = 0;
      touched.push(e.ref);
      takes.push({ ref: e.ref, qty: take });
      actual += take;
      left -= take;
    }
  } else {
    if (isSuppressed(gs, tileRef)) return { actual: 0, touched: [] }; // 取走型特性受【压制】约束
    const tile = getTile(gs, tileRef);
    const stored = potatoStoredOf(tile);
    const take = Math.min(stored, num);
    if (take > 0) {
      const cs = tile.contentState || (tile.contentState = {});
      cs.potatoStored = stored - take;
      if (cs.potatoStored <= 0) cs.potatoStored = 0;
      touched.push(tileRef);
      takes.push({ ref: tileRef, qty: take });
      actual = take;
    }
  }

  if (actual <= 0) return { actual: 0, touched: [] };

  for (const t of takes) takeStoredToBag(gs, t.ref, 'item_potato', t.qty);
  syncPumpkin(gs);
  EventBus.emit(GE.INVENTORY_CHANGE);
  for (const ref of touched) emitPotatoTileChanged(gs, ref);
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
