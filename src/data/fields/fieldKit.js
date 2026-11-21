// src/data/fields/fieldKit.js
// 田块增量结构的公共工具：一田块一文件，文件内自带 register()。
// 约定与 facilities.js 完全一致，避免两套写法。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { getTile, contentEntries, isFenceRef, fenceIdxOf } from '../../core/TileAccess.js';
import { ITEMS } from '../items.js';
import { Assets } from '../../core/Assets.js';
import { syncPumpkin } from '../../systems/PassiveItemSystem.js';
import { isSuppressed } from '../../systems/SuppressSystem.js';

export const refOf = (tileIdx, tileRef) => (tileRef ?? tileIdx);

export const isMine = (gs, ref, id) => getTile(gs, ref)?.contentId === id;

export const flagKey = (id, hook) => `${id}_${hook}`;

/** 按 ref 取地块（外圈 / 小径通用） */
export function tileOf(gs, ref) {
  if (ref == null) return null;
  return (gs.map.outerTiles || []).find(t => t.idx === ref)
    || (gs.map.fence || []).find(t => t.ref === ref)
    || null;
}

/** TILE_UPDATED 载荷（外圈格 / 小径格统一） */
export function tilePayloadOf(gs, ref) {
  if (ref == null) return {};
  return isFenceRef(ref)
    ? { tileIdx: null, tileRef: ref, fenceIdx: fenceIdxOf(gs, ref) }
    : { tileIdx: ref, tileRef: ref };
}

/** 刷新该格 UI */
export function refreshTile(gs, ref, extra = {}) {
  EventBus.emit(GE.TILE_UPDATED, { ...tilePayloadOf(gs, ref), ...extra });
}

export function toast(text, duration = 2000) {
  EventBus.emit(GE.TOAST_SHOW, { text, duration });
}

/** 储存变化后的统一收尾：刷新格子 + 悲恸南瓜统计 */
export function afterStorageChange(gs, ref) {
  refreshTile(gs, ref);
  syncPumpkin(gs);
}

/**
 * 注册"只作用于自己这一格"的田块 hook：
 * 自动做 归属判断 + 【压制】判断（压制期间所有特性失效）。
 */
export function registerSelfHook(type, def, fn) {
  HookDispatcher.register(type, (params) => {
    const { gs, tileIdx, tileRef } = params;
    const ref = refOf(tileIdx, tileRef);
    if (!isMine(gs, ref, def.id)) return;
    if (isSuppressed(gs, ref)) return;
    fn(params, ref);
  }, def);
}

/**
 * 遍历自己所有的田块；默认跳过被【压制】的格子。
 * @param {(ref, tile) => void} fn
 */
export function eachOwnTile(gs, id, fn, { skipSuppressed = true } = {}) {
  for (const { ref, tile } of contentEntries(gs)) {
    if (tile.contentId !== id) continue;
    if (skipSuppressed && isSuppressed(gs, ref)) continue;
    fn(ref, tile);
  }
}

/** 生成田块定义：名称 / 描述 / emoji 从物品库同步，避免两处文本不一致 */
export function defineField({ id, emoji, value = 1, register }) {
  return {
    id,
    get name() { return ITEMS[id]?.name || id; },
    emoji,
    value,
    get description() { return ITEMS[id]?.description || ''; },
    register,
  };
}

/** 快捷取/建 contentState */
export function stateOf(tile) {
  return tile.contentState || (tile.contentState = {});
}

/** Assets 引用（避免各文件重复 import） */
export { Assets, ITEMS, getTile, contentEntries };
