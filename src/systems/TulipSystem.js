// src/systems/TulipSystem.js
// 郁金香价值体系（魔导书 batch：泡沫 / 郁金香，简单！/ 经济上行）
//
// 口径（写入设计文档 §20.2）：
//   · 初始价值：物品库 note「郁金香初始价格为 3」→ 3；经济上行再 +6 → 9；
//   · 波动：默认【每一日开始时】-4~+10（历史值）；泡沫改为 -9~+18；
//     郁金香，简单！改为【每回合开始时】-4~+9（两者同时拥有时以「简单！」为准）；
//   · 叠放：简单！生效时可在郁金香上再叠一个郁金香，价值 += 初始价值，波动倍率 +1 倍；
//     波动量 = 区间随机值 ×（1 + 叠放层数），四舍五入取整；
//   · 结算：价值 > 50 时 ×1.5（向下取整），< -50 时 ×1.5（向上取整为负债）；
//     采摘/拆除时若结算值为负 → 仅当拥有《泡沫》才按负值结算（扣金币，金币可为负）；
//     没有《泡沫》时对外显示 max(0, 价值) 且按 max(0, 结算值) 结算，不扣金币；
//   · 内部价值永远按真实数值累加（波动/叠放/经济上行都在真实值上加减），绝不中途夹 0；
//   · 价值 < -100 时，日初波动结算后强制拆除（读【显示值】；不产出、不扣金币）。
//     没有《泡沫》时显示值恒为 max(0, 内部值) ≥ 0 → 永远不会触发强制拆除；
//     有《泡沫》时显示值 = 真实值，正常触发。
//     注意：这条与 settleTulipValue 的 |价值| > 50 → ×1.5 不同，后者读的是真实值。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { InventorySystem } from './InventorySystem.js';
import { hasGrimoire, syncPumpkin } from './PassiveItemSystem.js';
import { addGold } from './GoldSystem.js';

export const TULIP_ID = 'facility_tulip';
export const TULIP_BASE_INITIAL = 3;
export const TULIP_ECONOMY_BONUS = 6;
export const TULIP_FORCE_REMOVE_THRESHOLD = -100;
export const TULIP_HIGH_THRESHOLD = 50;

export const GRIMOIRE_BUBBLE = 'grimoire_bubble';
export const GRIMOIRE_TULIP_SIMPLE = 'grimoire_tulip_simple';
export const GRIMOIRE_ECONOMY_UP = 'grimoire_economy_up';

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export function hasTulipSimple(gs) {
  return hasGrimoire(gs, GRIMOIRE_TULIP_SIMPLE);
}

export function hasBubble(gs) {
  return hasGrimoire(gs, GRIMOIRE_BUBBLE);
}

export function hasEconomyUp(gs) {
  return hasGrimoire(gs, GRIMOIRE_ECONOMY_UP);
}

/** 郁金香初始价值（新放置 / 叠放增量都用它） */
export function tulipInitialValue(gs) {
  return TULIP_BASE_INITIAL + (hasEconomyUp(gs) ? TULIP_ECONOMY_BONUS : 0);
}

export function tulipValue(tile) {
  const v = tile?.contentState?.tulipValue;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function tulipStacks(tile) {
  const v = tile?.contentState?.tulipStacks;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** 新放置的郁金香：写入初始价值 / 0 层叠放（由 onPlace hook 调用） */
export function initTulipTile(gs, tile) {
  if (!tile) return;
  const cs = tile.contentState || (tile.contentState = {});
  cs.tulipValue = tulipInitialValue(gs);
  cs.tulipStacks = 0;
  cs.tulipInit = true;
}

/**
 * 叠放一个郁金香（简单！）：消耗 1 个设施物品由调用方负责，这里只改数值。
 * @returns {{ value: number, stacks: number }}
 */
export function stackTulip(gs, tile) {
  const cs = tile.contentState || (tile.contentState = {});
  // 旧档田块可能没有 tulipInit：先按「当前价值即初始价值」认领，不额外补 +3
  cs.tulipInit = true;
  cs.tulipValue = tulipValue(tile) + tulipInitialValue(gs);
  cs.tulipStacks = tulipStacks(tile) + 1;
  return { value: cs.tulipValue, stacks: cs.tulipStacks };
}

/** 波动区间基数（不含叠放倍率） */
function fluctuationBase(gs, mode) {
  if (mode === 'turn') return randInt(-4, 9);
  if (mode === 'bless') {
    if (hasTulipSimple(gs)) return randInt(-4, 9);
    return hasBubble(gs) ? randInt(-9, 18) : randInt(-4, 10);
  }
  // daily
  return hasBubble(gs) ? randInt(-9, 18) : randInt(-4, 10);
}

/**
 * 应用一次波动（bless 模式一次调用=2 次效果）。
 * mode: 'daily' | 'turn' | 'bless'
 * @returns {number} 波动后的价值
 */
export function applyTulipFluctuation(gs, tile, mode = 'daily') {
  if (!tile) return 0;
  if (mode === 'daily' && hasTulipSimple(gs)) return tulipValue(tile); // 日波动被回合波动替换
  if (mode === 'turn' && !hasTulipSimple(gs)) return tulipValue(tile); // 未拥有简单！不触发回合波动

  const cs = tile.contentState || (tile.contentState = {});
  const times = mode === 'bless' ? 2 : 1;
  const mult = 1 + tulipStacks(tile);
  let v = tulipValue(tile);
  for (let i = 0; i < times; i++) {
    v += Math.round(fluctuationBase(gs, mode) * mult);
  }
  cs.tulipValue = v;
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: tile.idx });
  maybeForceRemoveTulip(gs, tile);
  return v;
}

/**
 * 价值 < -100：强制拆除（不产出、不扣金币）。
 * 判定读【显示值】：没有《泡沫》时显示值恒为 max(0, 内部值) ≥ 0，永远不会触发；
 * 有《泡沫》时显示值即真实值，内部值 < -100 时正常触发。
 */
export function maybeForceRemoveTulip(gs, tile) {
  if (!tile || tile.contentId !== TULIP_ID) return false;
  if (tulipDisplayValue(gs, tile) >= TULIP_FORCE_REMOVE_THRESHOLD) return false;

  tile.contentId = null;
  tile.contentState = {};
  syncPumpkin(gs);
  EventBus.emit(GE.TILE_CONTENT_CHANGED, { tileIdx: tile.idx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: tile.idx });
  EventBus.emit(GE.TOAST_SHOW, {
    text: `🌷 郁金香价值过低（< ${-TULIP_FORCE_REMOVE_THRESHOLD}），已被强制拆除`,
    duration: 2400,
  });
  return true;
}

/** 结算价值：|价值| > 50 时 ×1.5（读传入的真实值，不做显示夹取） */
export function settleTulipValue(raw) {
  let v = Math.round(Number(raw) || 0);
  if (v > TULIP_HIGH_THRESHOLD) v = Math.floor(v * 1.5);
  else if (v < -TULIP_HIGH_THRESHOLD) v = -Math.ceil(Math.abs(v) * 1.5);
  return v;
}

/**
 * 对外显示值：没有《泡沫》时显示 max(0, 内部真实值)；有《泡沫》时显示真实值（可为负）。
 * 注意只影响显示，不修改内部值。
 */
export function tulipDisplayValue(gs, tile) {
  const v = tulipValue(tile);
  return hasBubble(gs) ? v : Math.max(0, v);
}

/**
 * 实际结算值：先按真实值算 ×1.5，再按是否拥有《泡沫》决定负值是否生效。
 * 没有《泡沫》→ max(0, settled)；有《泡沫》→ 真实 settled（可为负）。
 */
export function tulipSettleValue(gs, tile) {
  const settled = settleTulipValue(tulipValue(tile));
  return hasBubble(gs) ? settled : Math.max(0, settled);
}

function clearTulipTile(tile) {
  tile.contentId = null;
  tile.contentState = {};
}

/**
 * 采摘郁金香：结算价值 → 正价值写入花朵物品的 value；
 * 负价值仅在拥有《泡沫》时扣金币（金币可为负），否则按 0 结算、不扣金币。
 * @param {{silent?: boolean}} [opts] silent：不弹采摘 toast（拆除前自动采摘用）
 * @returns {{ settled: number, rawSettled: number, debt: number, itemValue: number }}
 */
export function pickTulip(gs, tile, opts = {}) {
  const { silent = false } = opts;
  if (!tile || tile.contentId !== TULIP_ID) return { settled: 0, rawSettled: 0, debt: 0, itemValue: 0 };
  const rawSettled = settleTulipValue(tulipValue(tile));
  const settled = hasBubble(gs) ? rawSettled : Math.max(0, rawSettled);
  let itemValue = 0;
  let debt = 0;
  if (settled < 0) {
    debt = -settled;
    addGold(gs, settled, 'tulip:pick');
  } else {
    itemValue = settled;
  }

  InventorySystem.addItem(gs, 'item_tulip', 1, { value: itemValue });
  clearTulipTile(tile);
  syncPumpkin(gs);
  EventBus.emit(GE.TILE_CONTENT_CHANGED, { tileIdx: tile.idx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: tile.idx });
  EventBus.emit(GE.INVENTORY_CHANGE);
  if (silent) return { settled, rawSettled, debt, itemValue };
  if (debt > 0) {
    EventBus.emit(GE.TOAST_SHOW, {
      text: `🌷 采摘负价值郁金香，扣除 ${debt} 金币（获得 0 价值郁金香）`,
      duration: 2400,
    });
  } else {
    EventBus.emit(GE.TOAST_SHOW, {
      text: `🌷 采摘成功！获得价值 ${itemValue} 的郁金香`,
      duration: 2000,
    });
  }
  return { settled, rawSettled, debt, itemValue };
}

/** UI 用：当前内部价值 + 对外显示值 + 叠放层数 */
export function tulipInfo(gs, tile) {
  return { value: tulipValue(tile), display: tulipDisplayValue(gs, tile), stacks: tulipStacks(tile) };
}

export const TulipSystem = {
  TULIP_ID,
  TULIP_BASE_INITIAL,
  TULIP_ECONOMY_BONUS,
  TULIP_FORCE_REMOVE_THRESHOLD,
  hasTulipSimple,
  hasBubble,
  hasEconomyUp,
  tulipInitialValue,
  tulipValue,
  tulipStacks,
  initTulipTile,
  stackTulip,
  applyTulipFluctuation,
  maybeForceRemoveTulip,
  settleTulipValue,
  tulipDisplayValue,
  tulipSettleValue,
  pickTulip,
  tulipInfo,
};

export default TulipSystem;
