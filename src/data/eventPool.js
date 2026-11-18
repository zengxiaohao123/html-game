// src/data/eventPool.js
// ─────────────────────────────────────────────────────────────────────────────
// 事件池：从正式事件定义（src/data/events.js 的 EVENT_DEFS）按权重抽取。
// ─────────────────────────────────────────────────────────────────────────────
// 可重复性（EventDef.repeatability）：
//   'repeatable' 可重复   —— 允许马上再次出现，不记录占用
//   'daily'      每日限1次 —— 本日内只能出现一次（含被受祝福揭露）
//   'once'       一次性     —— 本存档一局只能进入一次；仅被揭露不消耗
//
// 事件在「进入事件格」或「该事件格受祝福」时才抽取，并把该格本日固定为
// 抽中的事件（tile.contentState.eventTodayId）。抽取时排除本日已揭露 / 已进入的
// 每日限1次与一次性事件，避免同一事件本日在其他格子重复出现。

import { Random } from '../core/Random.js';
import { EVENT_DEFS } from './events.js';

export const REPEATABILITY = {
  REPEATABLE: 'repeatable',
  DAILY: 'daily',
  ONCE: 'once',
};

/** 事件的可重复性（未填 = 可重复） */
export function repeatabilityOf(def) {
  const value = def?.repeatability;
  return value === REPEATABILITY.DAILY || value === REPEATABILITY.ONCE
    ? value
    : REPEATABILITY.REPEATABLE;
}

/**
 * 取（必要时初始化 / 跨天重置）事件占用状态。
 * 挂在 GS 上，随日初基线存档一起保存。
 */
function eventState(gs) {
  if (!gs) return null;
  const st = gs.eventPool || (gs.eventPool = {});
  if (st.day !== gs.day) {
    st.day = gs.day;
    st.revealedToday = [];
  }
  if (!Array.isArray(st.revealedToday)) st.revealedToday = [];
  if (!Array.isArray(st.consumedOnce)) st.consumedOnce = [];
  return st;
}

/** 本日是否已被占用（不可再抽取） */
export function isEventBlocked(gs, def) {
  const st = eventState(gs);
  if (!st || !def) return false;
  const mode = repeatabilityOf(def);
  if (mode === REPEATABILITY.REPEATABLE) return false;
  if (mode === REPEATABILITY.ONCE && st.consumedOnce.includes(def.id)) return true;
  return st.revealedToday.includes(def.id);
}

/** 记录「本日已揭露」（受祝福显示内容 / 进入事件都算揭露） */
export function markEventRevealed(gs, def) {
  const st = eventState(gs);
  if (!st || !def || repeatabilityOf(def) === REPEATABILITY.REPEATABLE) return;
  if (!st.revealedToday.includes(def.id)) st.revealedToday.push(def.id);
}

/** 记录「已进入」；一次性事件进入后本存档内不再出现 */
export function markEventEntered(gs, def) {
  const st = eventState(gs);
  if (!st || !def) return;
  markEventRevealed(gs, def);
  if (repeatabilityOf(def) === REPEATABILITY.ONCE && !st.consumedOnce.includes(def.id)) {
    st.consumedOnce.push(def.id);
  }
}

/**
 * 按权重抽取一个当前可用的事件定义。
 * @param {object} [gs] 传入时按可重复性排除本日已占用的事件
 * @returns {object|null} 没有可用事件时返回 null
 */
export function drawEventDef(gs) {
  const pool = EVENT_DEFS.filter((e) => !isEventBlocked(gs, e));
  if (!pool.length) return null;
  return Random.weightedPick(pool.map((e) => ({ weight: e.weight ?? 1, value: e })));
}

export default {
  REPEATABILITY,
  repeatabilityOf,
  drawEventDef,
  isEventBlocked,
  markEventRevealed,
  markEventEntered,
};
