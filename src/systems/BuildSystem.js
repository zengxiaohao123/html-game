// src/systems/BuildSystem.js
// 建造系统：
//   enterBuildMode(gs) / exitBuildMode(gs)
//   placeContent(gs, tileIdx, contentId)   —— 放置地块内容（设施 / 资源 / 技能）
//   placeTerrain(gs, tileIdx, terrainId)   —— 放置地形（v0.5 新增：地形也是物品）
//   clearContent(gs, tileIdx)
//
// 替换规则（设计文档 **v0.5** §9）：
//   - 家（facility_home）不可替换（【永恒】）
//   - 技能被替换 / 拆除后**回背包**
//   - 其余旧内容一律直接消失（v0.5 已删除 v0.4 里"帐篷替换时旧内容回背包"的例外）
//   - 替换是原子操作：先拆后放，不出现中间态
//   - 替换后旧的 contentState（如郁金香价值、蒲公英储存）必须清空，不能带到新内容上
//
// 商店类额外约束（v0.5 §11.1 / §11.2）：每日至多放置 1 个；场上总数上限 2。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { ITEMS } from '../data/items.js';
import { TERRAINS } from '../data/terrains.js';
import { InventorySystem } from './InventorySystem.js';
import { devLog } from '../core/Logger.js';

/** 家（facility_home）拥有【永恒】词条，不可替换 */
const UNREPLACEABLE = new Set(['facility_home']);

/** 有"每日放置 1 个 / 场上上限 2"限制的地块内容 */
const PLACE_LIMITED = {
  resource_shop: { perDay: 1, onField: 2 },
  resource_magic_shop: { perDay: 1, onField: 2 },
};

/**
 * 进入建造模式（幂等：已在建造模式则静默返回）
 */
export function enterBuildMode(gs) {
  if (gs.buildMode) return;
  gs.buildMode = true;
  if (typeof document !== 'undefined') document.body.style.cursor = 'crosshair';
  EventBus.emit(GE.UI_MODE_CHANGE, { mode: 'build' });
  EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 进入建造模式', duration: 1500 });
  devLog.info('[Build] enterBuildMode');
}

/**
 * 退出建造模式（幂等：已在探索模式则静默返回）
 */
export function exitBuildMode(gs) {
  if (!gs.buildMode) return;
  gs.buildMode = false;
  if (typeof document !== 'undefined') document.body.style.cursor = '';
  EventBus.emit(GE.UI_MODE_CHANGE, { mode: 'explore' });
  EventBus.emit(GE.TOAST_SHOW, { text: '🚶 进入探索模式', duration: 1500 });
  devLog.info('[Build] exitBuildMode');
}

/** 统计场上某种内容的数量 */
function countOnField(gs, contentId) {
  return gs.map.outerTiles.filter((t) => t.contentId === contentId).length;
}

/**
 * 放置地形（v0.5 §4：地形在背包里是物品，放置后变成该地块的状态）
 * @returns {{ ok: boolean, reason?: string }}
 */
export function placeTerrain(gs, tileIdx, terrainId) {
  const terrain = TERRAINS[terrainId];
  if (!terrain) return { ok: false, reason: 'unknownTerrain' };

  const tile = gs.map.outerTiles[tileIdx];
  if (!tile) return { ok: false, reason: 'invalidTileIdx' };

  if (InventorySystem.countItem(gs, terrainId) < 1) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 背包里没有 ${terrain.name}`, duration: 1600 });
    return { ok: false, reason: 'noItem' };
  }

  // 同种地形重复施加：地形不变、元素量回满（等价于用新的替换旧的）
  tile.terrain = terrainId;
  tile.terrainAmount = terrain.elementAmount;
  InventorySystem.removeItem(gs, terrainId, 1);

  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  EventBus.emit(GE.TOAST_SHOW, { text: `🧱 地形变为 ${terrain.name}（元素量 ${terrain.elementAmount}）`, duration: 1600 });
  devLog.info('[Build] placeTerrain tile', tileIdx, '→', terrainId);
  return { ok: true };
}

/**
 * 放置地块内容（设施 / 资源 / 技能）
 * @returns {{ ok: boolean, reason?: string }}
 */
export function placeContent(gs, tileIdx, contentId) {
  if (!Number.isInteger(tileIdx) || tileIdx < 0 || tileIdx >= gs.map.outerTiles.length) {
    devLog.warn('[Build] invalid tileIdx:', tileIdx);
    return { ok: false, reason: 'invalidTileIdx' };
  }
  if (!contentId) return { ok: false, reason: 'noContent' };

  // 地形走单独通道（不占「内容」槽位）
  if (contentId.startsWith('terrain_')) return placeTerrain(gs, tileIdx, contentId);

  const tile = gs.map.outerTiles[tileIdx];
  const oldContentId = tile.contentId;

  // 天赋不可放置（天赋前缀 talent_）
  if (contentId.startsWith('talent_')) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🚫 天赋不可放置到地图上', duration: 2000 });
    devLog.info('[Build] refuse talent placement:', contentId);
    return { ok: false, reason: 'talentForbidden' };
  }

  // 前缀校验：只接受 facility_ / resource_ / skill_ 三类
  if (!/^(facility_|resource_|skill_)/.test(contentId)) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 未知内容类型：${contentId}`, duration: 1500 });
    devLog.warn('[Build] unknown contentId prefix:', contentId);
    return { ok: false, reason: 'unknownType' };
  }

  // 库存检查
  if (InventorySystem.countItem(gs, contentId) < 1) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 背包里没有 ${ITEMS[contentId]?.name || contentId}`, duration: 1800 });
    devLog.info('[Build] no item in inventory:', contentId);
    return { ok: false, reason: 'noItem' };
  }

  // 永恒词条保护
  if (oldContentId && UNREPLACEABLE.has(oldContentId)) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🏠 家拥有【永恒】词条，不可替换', duration: 2000 });
    devLog.info('[Build] refuse to replace unreplaceable:', oldContentId);
    return { ok: false, reason: 'unreplaceable' };
  }

  // 商店类：每日 1 个 / 场上 2 个
  const limit = PLACE_LIMITED[contentId];
  if (limit) {
    const placedToday = gs.buildDailyPlaced?.[contentId] || 0;
    if (placedToday >= limit.perDay) {
      EventBus.emit(GE.TOAST_SHOW, { text: `🏪 今日已放置过 ${ITEMS[contentId]?.name || contentId}`, duration: 2000 });
      return { ok: false, reason: 'dailyLimit' };
    }
    if (countOnField(gs, contentId) >= limit.onField) {
      EventBus.emit(GE.TOAST_SHOW, { text: `🏪 场上最多 ${limit.onField} 个 ${ITEMS[contentId]?.name || contentId}`, duration: 2000 });
      return { ok: false, reason: 'fieldLimit' };
    }
  }

  // ── 旧内容处理（v0.5：只有技能回背包，其余一律消失）──
  if (oldContentId) {
    if (oldContentId.startsWith('skill_')) {
      InventorySystem.addItem(gs, oldContentId, 1);
      devLog.info('[Build] skill card returned to inventory:', oldContentId);
    } else {
      devLog.info('[Build] old content', oldContentId, 'discarded');
    }
    HookDispatcher.fire('onReplace', { gs, tileIdx, oldContentId, newContentId: contentId });
  }
  // 旧的内容状态（郁金香价值 / 蒲公英储存 / 幽怜草价值…）必须清空
  tile.contentState = {};

  // ── 放置新内容 ──
  tile.contentId = contentId;

  const removed = InventorySystem.removeItem(gs, contentId, 1);
  if (removed < 1) {
    // 防御：库存被外部清空了 → 回滚
    tile.contentId = oldContentId;
    EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 库存不足（请稍后重试）', duration: 1800 });
    devLog.warn('[Build] removeItem failed, rollback:', contentId);
    return { ok: false, reason: 'noItem' };
  }

  if (limit) {
    if (!gs.buildDailyPlaced) gs.buildDailyPlaced = {};
    gs.buildDailyPlaced[contentId] = (gs.buildDailyPlaced[contentId] || 0) + 1;
  }

  EventBus.emit(GE.TILE_UPDATED, { tileIdx, newContentId: contentId, oldContentId });
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'place', tileIdx, contentId, oldContentId });
  EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 放置 ${ITEMS[contentId]?.name || contentId}`, duration: 1500 });

  // 【放置时】词条（野生种子变身、蒲公英/幽怜草初始化）
  HookDispatcher.fire('onPlace', { gs, tileIdx, contentId });

  devLog.info('[Build] placeContent tile', tileIdx, ':', oldContentId, '→', contentId, '(inventory -1)');
  return { ok: true };
}

/**
 * 拆除（清空 contentId）。skill_* 被拆除后回背包。
 */
export function clearContent(gs, tileIdx) {
  if (!gs.buildMode) return { ok: false, reason: 'notInBuildMode' };
  const tile = gs.map.outerTiles[tileIdx];
  if (!tile || tile.contentId === null) return { ok: false, reason: 'empty' };
  if (UNREPLACEABLE.has(tile.contentId)) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🏠 【永恒】不可拆除', duration: 2000 });
    return { ok: false, reason: 'unreplaceable' };
  }
  const removedId = tile.contentId;
  tile.contentId = null;
  tile.contentState = {};

  if (removedId.startsWith('skill_')) {
    InventorySystem.addItem(gs, removedId, 1);
    EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 拆除技能卡 ${ITEMS[removedId]?.name || removedId} → 回背包`, duration: 1500 });
    devLog.info('[Build] skill card returned to inventory on clear:', removedId);
  }

  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'clear', tileIdx, contentId: removedId });
  return { ok: true };
}

export const BuildSystem = {
  enterBuildMode,
  exitBuildMode,
  placeContent,
  placeTerrain,
  clearContent,
};
