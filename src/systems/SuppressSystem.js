// src/systems/SuppressSystem.js
// 【压制】：禁用该地块所有特性（依据 物品库 词条字典 / 设计文档 v0.6 §16.5）
//
// 施加来源：
//   1. 黑莓田块【每一日开始时】压制周围 8 格的非黑莓田块（日初优先结算，见 FieldAuraSystem）
//   2. 酢浆草田块【经过时】本日内压制自身
// 解除：
//   黑莓田块【受祝福时】立刻清除周围 8 格压制，且本日与接下来 3 日的日初不再施加
//
// 存储口径：tile.contentState.suppressUntilDay = 天数（含当天有效）
//   - 日初重算时直接覆盖为当天；跨天后自然失效，无需每天全图清理
//   - 属于「日内状态」，随日初基线存档回滚（符合存档策略）

import { contentEntries, getTile, neighborRefs8 } from '../core/TileAccess.js';
import { ITEMS } from '../data/items.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';

export const BLACKBERRY_ID = 'facility_blackberry';
export const SORREL_ID = 'facility_sorrel';

/** 是否为「田块」二级分类的地块内容 */
export function isFieldContent(contentId) {
  return !!contentId && ITEMS[contentId]?.tier2 === '田块';
}

/** 该地块本日是否处于【压制】 */
export function isSuppressed(gs, ref) {
  const tile = getTile(gs, ref);
  const until = tile?.contentState?.suppressUntilDay;
  return typeof until === 'number' && until >= gs.day;
}

/** 施加压制（untilDay 默认当天） */
export function suppressTile(tile, day = null, gs = null) {
  if (!tile) return;
  const state = tile.contentState || (tile.contentState = {});
  state.suppressUntilDay = day ?? gs?.day ?? state.suppressUntilDay;
}

/** 清除压制 */
export function clearSuppression(tile) {
  if (tile?.contentState && 'suppressUntilDay' in tile.contentState) {
    tile.contentState.suppressUntilDay = null;
  }
}

/** 酢浆草【经过时】自压制 */
export function suppressSelfToday(gs, ref) {
  const tile = getTile(gs, ref);
  if (!tile) return;
  suppressTile(tile, gs.day, gs);
}

/**
 * 日初：黑莓田块重新施加压制（必须在其它田块 onDailyStart 之前调用）
 * 处于「受祝福解除期」的黑莓不施加。
 */
export function applyBlackberrySuppression(gs) {
  let applied = 0;
  for (const { ref, tile } of contentEntries(gs)) {
    if (tile.contentId !== BLACKBERRY_ID) continue;
    const state = tile.contentState || {};
    const releaseUntil = state.blackberryReleaseUntilDay;
    if (typeof releaseUntil === 'number' && releaseUntil >= gs.day) continue;
    if (isSuppressed(gs, ref)) continue; // 黑莓自身被压制时不施加
    for (const nb of neighborRefs8(gs, ref)) {
      const nTile = getTile(gs, nb);
      if (!nTile || !isFieldContent(nTile.contentId)) continue;
      if (nTile.contentId === BLACKBERRY_ID) continue;
      suppressTile(nTile, gs.day, gs);
      applied += 1;
    }
  }
  if (applied > 0) {
    EventBus.emit(GE.TILE_UPDATED);
  }
  return applied;
}

/**
 * 黑莓【受祝福时】：立刻清除周围 8 格压制，并设置解除期：
 * 本日 + 接下来 3 日的日初不再施加（重复祝福重置为 4 天）。
 */
export function releaseBlackberry(gs, ref) {
  const tile = getTile(gs, ref);
  if (!tile) return 0;
  const state = tile.contentState || (tile.contentState = {});
  state.blackberryReleaseUntilDay = gs.day + 3;
  let cleared = 0;
  for (const nb of neighborRefs8(gs, ref)) {
    const nTile = getTile(gs, nb);
    if (!nTile || !isFieldContent(nTile.contentId)) continue;
    if (isSuppressed(gs, nb)) cleared += 1;
    clearSuppression(nTile);
  }
  return cleared;
}

export const SuppressSystem = {
  BLACKBERRY_ID,
  SORREL_ID,
  isFieldContent,
  isSuppressed,
  suppressTile,
  clearSuppression,
  suppressSelfToday,
  applyBlackberrySuppression,
  releaseBlackberry,
};
