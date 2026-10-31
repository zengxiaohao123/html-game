// src/systems/ItemTargeting.js
// 消耗道具的"指向模式"（v0.5 §16.15 的补充交互）
//
// 问题：初级肥料 / 陷阱 / 艾草熏香都必须指明目标地块，而它们是在背包里点的。
// 做法：点「使用」后自动关闭背包，进入指向模式 —— 地图上合法地块高亮，
//       不合法地块变暗；点合法地块即结算，ESC 或点空白取消。
//
// 合法性：
//   初级肥料   → 必须是植物类田块（作物 / 花田 / 草地类设施）
//   陷阱       → 任意外圈地块（无内容也可以；同一地块不能放同名陷阱）
//   艾草熏香   → 任意外圈地块（同上）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { POTIONS } from '../data/potions.js';
import { isPlantTarget, useItem } from './UseItemSystem.js';

let state = { active: false, itemId: null, gs: null };

/** 该道具是否需要玩家指定目标地块 */
export function needsTarget(itemId) {
  const eff = POTIONS[itemId]?.useEffect;
  if (!eff) return false;
  return eff.type === 'facility_trigger_twice'
    || eff.type === 'placed_daily_roll'
    || eff.type === 'placed_sleep_heal';
}

/** 判断某格是否是合法目标 */
export function isValidTarget(gs, itemId, tileIdx) {
  const eff = POTIONS[itemId]?.useEffect;
  if (!eff) return false;
  const tile = gs.map.outerTiles[tileIdx];
  if (!tile) return false;

  if (eff.type === 'facility_trigger_twice') return isPlantTarget(gs, tileIdx);

  // 放置型：任意外圈地块，但同一地块不能重复放同名道具
  const placed = tile.contentState?.placedItems || [];
  return !placed.some((p) => p.itemId === itemId);
}

/** 所有合法目标格 */
export function validTiles(gs, itemId) {
  const out = [];
  for (const t of gs.map.outerTiles) {
    if (isValidTarget(gs, itemId, t.idx)) out.push(t.idx);
  }
  return out;
}

/** 进入指向模式（背包会自动关闭） */
export function start(gs, itemId) {
  if (!needsTarget(itemId)) {
    // 不需要目标的道具直接使用
    return useItem(gs, itemId, {});
  }
  const valid = validTiles(gs, itemId);
  if (valid.length === 0) {
    EventBus.emit(GE.TOAST_SHOW, { text: '没有可指定的地块', duration: 1600 });
    return { ok: false, reason: 'noValidTile' };
  }
  state = { active: true, itemId, gs };
  EventBus.emit(GE.TARGETING_START, { itemId, valid });
  EventBus.emit(GE.TOAST_SHOW, {
    text: `${POTIONS[itemId]?.emoji || '📦'} 请点击高亮地块使用（ESC 取消）`,
    duration: 2600,
  });
  devLog.info('[Targeting] start', itemId, 'valid tiles =', valid);
  return { ok: true, pending: true };
}

/** 退出指向模式 */
export function cancel(reason = 'manual') {
  if (!state.active) return;
  const { itemId } = state;
  state = { active: false, itemId: null, gs: null };
  EventBus.emit(GE.TARGETING_END, { itemId, reason });
  devLog.info('[Targeting] end', itemId, reason);
}

export function isActive() {
  return state.active;
}

export function currentItem() {
  return state.active ? state.itemId : null;
}

/**
 * 地图点击入口（MapView 在指向模式下把点击交给这里）
 * @returns {{ok:boolean, reason?:string}}
 */
export function handleTileClick(gs, tileIdx) {
  if (!state.active) return { ok: false, reason: 'inactive' };
  const itemId = state.itemId;

  if (!isValidTarget(gs, itemId, tileIdx)) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🚫 这里不能使用该道具', duration: 1500 });
    return { ok: false, reason: 'invalidTarget' };
  }

  const res = useItem(gs, itemId, { tileIdx });
  if (res.ok) {
    cancel('done');
  } else if (res.reason === 'noItem' || res.reason === 'cooldown') {
    cancel('aborted');
  }
  return res;
}

export const ItemTargeting = {
  needsTarget,
  isValidTarget,
  validTiles,
  start,
  cancel,
  isActive,
  currentItem,
  handleTileClick,
};
