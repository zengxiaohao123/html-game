// src/systems/BuildSystem.js
// Phase 2A 建造系统：
//   enterBuildMode(gs)
//   exitBuildMode(gs)
//   placeContent(gs, tileIdx, contentId)
//
// 替换规则（设计文档 §9 + §10.2）：
//   - Home（facility_home）不可替换（【永恒】词条）
//   - Tent（facility_tent）被替换时 → fire onReplace hook 让帐篷自己处理旧内容回背包
//   - 其他设施/资源 → 被替换时旧内容直接消失
//   - 空地：直接放置
//
// 建造模式 UI 由 Phase 2B 处理；此处只实现逻辑。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { InventorySystem } from './InventorySystem.js';
import { devLog } from '../core/Logger.js';

/** 家（facility_home）拥有【永恒】词条，不可替换 */
const UNREPLACEABLE = new Set(['facility_home']);

/**
 * 进入建造模式
 */
export function enterBuildMode(gs) {
  gs.buildMode = true;
  if (typeof document !== 'undefined') document.body.style.cursor = 'crosshair';
  EventBus.emit(GE.UI_MODE_CHANGE, { mode: 'build' });
  EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 进入建造模式', duration: 1500 });
  devLog.info('[Build] enterBuildMode');
}

/**
 * 退出建造模式
 */
export function exitBuildMode(gs) {
  gs.buildMode = false;
  if (typeof document !== 'undefined') document.body.style.cursor = '';
  EventBus.emit(GE.UI_MODE_CHANGE, { mode: 'explore' });
  EventBus.emit(GE.TOAST_SHOW, { text: '🚶 进入探索模式', duration: 1500 });
  devLog.info('[Build] exitBuildMode');
}

/**
 * 放置地块内容
 * @returns {{ ok: boolean, reason?: string }}
 */
export function placeContent(gs, tileIdx, contentId) {
  // 基础校验
  if (!Number.isInteger(tileIdx) || tileIdx < 0 || tileIdx >= gs.map.outerTiles.length) {
    devLog.warn('[Build] invalid tileIdx:', tileIdx);
    return { ok: false, reason: 'invalidTileIdx' };
  }
  if (!contentId) {
    return { ok: false, reason: 'noContent' };
  }

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
  const invEntry = gs.inventory?.items?.find(e => e.itemId === contentId);
  if (!invEntry || invEntry.qty < 1) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 背包里没有 ${contentId}`, duration: 1800 });
    devLog.info('[Build] no item in inventory:', contentId);
    return { ok: false, reason: 'noItem' };
  }

  // 永恒词条保护
  if (oldContentId && UNREPLACEABLE.has(oldContentId)) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🏠 家拥有【永恒】词条，不可替换', duration: 2000 });
    devLog.info('[Build] refuse to replace unreplaceable:', oldContentId);
    return { ok: false, reason: 'unreplaceable' };
  }

  // 旧内容处理
  if (oldContentId) {
    if (oldContentId === 'facility_tent') {
      // 帐篷【替换时】词条：fire onReplace hook，让帐篷自己把旧内容回背包
      HookDispatcher.fire('onReplace', { gs, tileIdx, oldContentId });
      devLog.info('[Build] tent replaced, onReplace fired');
    } else if (oldContentId.startsWith('skill_')) {
      // §9 行 217：技能被替换后回背包（不消失）
      InventorySystem.addItem(gs, oldContentId, 1);
      devLog.info('[Build] skill card returned to inventory:', oldContentId);
    } else {
      // 其他：直接消失
      devLog.info('[Build] old content', oldContentId, 'discarded');
    }
  }

  // 4. 放置新内容
  tile.contentId = contentId;

  // 5. 从背包扣 1 个（HotBar 与背包同步：物品本质属于背包）
  const removed = InventorySystem.removeItem(gs, contentId, 1);
  if (removed < 1) {
    // 防御：removeItem 失败（库存被外部清空了）→ 回滚
    tile.contentId = oldContentId;
    EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 库存不足（请稍后重试）', duration: 1800 });
    devLog.warn('[Build] removeItem failed, rollback:', contentId);
    return { ok: false, reason: 'noItem' };
  }

  EventBus.emit(GE.TILE_UPDATED, { tileIdx, newContentId: contentId, oldContentId });
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'place', tileIdx, contentId, oldContentId });
  EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 放置 ${contentId}`, duration: 1500 });

  devLog.info('[Build] placeContent tile', tileIdx, ':', oldContentId, '→', contentId, '(inventory -1)');
  return { ok: true };
}

/**
 * 拆除（清空 contentId）。Phase 2B UI 可能需要，但不作为放置的必经路径，单独提供。
 * 修复 4b：skill_* 被拆除后回背包。
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

  // 修复 4b：skill_* 被拆除后回背包（不消失）
  if (removedId.startsWith('skill_')) {
    InventorySystem.addItem(gs, removedId, 1);
    EventBus.emit(GE.TOAST_SHOW, { text: `🛠️ 拆除技能卡 ${removedId} → 回背包`, duration: 1500 });
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
  clearContent,
};
