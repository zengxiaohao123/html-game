// src/systems/TulipSystem.js
// 郁金香价值体系（魔导书 batch：泡沫 / 郁金香，简单！/ 经济上行）
//
// 口径（2026-11-22 用户十条答复）：
//   · 初始价值：物品库 note「郁金香初始价格为 3」→ 3；经济上行再 +6 → 9；
//   · 泡沫与简单！修改的是同一条波动特性的两部分，只显示一条特性：
//       - 泡沫改数值：-9~+18；
//       - 简单！改节点：日初 → 每回合；
//       - 两书同持：节点=每回合、区间=-9~+18；
//   · 波动：未持书【每一日开始时】-4~+10；只持简单！【每回合开始时】-4~+9；
//     只持泡沫【每一日开始时】-9~+18；
//   · 叠放（简单！）：价值 += 初始价值（3 / 经济上行 9），每次叠放都加，无上限；
//     波动结果 ×(1 + 叠放层数)，同格共用一次随机，不出现层间不同数值；
//   · 【受祝福时】立即使价值波动 2 次，两次各自独立掷点，每次结果再乘叠放倍率；
//   · 结算：持《泡沫》时 |价值| > 50 → ×1.5（正向下取整 / 负向上取整为负债）；
//     不持《泡沫》时不做 ×1.5，且对外显示 / 采摘结算夹 0（不扣金币）；
//   · 内部价值永远按真实数值累加（波动 / 叠放 / 经济上行都在真实值上加减），不会中途夹 0；
//   · 价值 < -100（读显示值，严格小于）时强制拆除；拆除不结算金币、不产出。
//     没有《泡沫》时显示值恒为 max(0, 内部值) ≥ 0 → 永远不会触发强制拆除。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { InventorySystem } from './InventorySystem.js';
import { hasGrimoire, syncPumpkin } from './PassiveItemSystem.js';
import { addGold } from './GoldSystem.js';
import { isSuppressed } from './SuppressSystem.js';
import { isFenceRef, fenceIdxOf } from '../core/TileAccess.js';

export const TULIP_ID = 'facility_tulip';
export const TULIP_BASE_INITIAL = 3;
export const TULIP_ECONOMY_BONUS = 6;
export const TULIP_FORCE_REMOVE_THRESHOLD = -100;
export const TULIP_HIGH_THRESHOLD = 50;

export const GRIMOIRE_BUBBLE = 'grimoire_bubble';
export const GRIMOIRE_TULIP_SIMPLE = 'grimoire_tulip_simple';
export const GRIMOIRE_ECONOMY_UP = 'grimoire_economy_up';

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/** 地块事件载荷：外圈沿用旧字段；栅栏格追加 tileRef / fenceIdx */
function tulipPayload(gs, tile, ref) {
  if (ref != null && isFenceRef(ref)) {
    return { tileIdx: null, tileRef: ref, fenceIdx: fenceIdxOf(gs, ref) };
  }
  return { tileIdx: tile.idx };
}

export function hasTulipSimple(gs) {
  return hasGrimoire(gs, GRIMOIRE_TULIP_SIMPLE);
}

export function hasBubble(gs) {
  return hasGrimoire(gs, GRIMOIRE_BUBBLE);
}

/** 《泡沫》的常态性质是否生效：被【压制】时与该地块特性一起失效 */
function bubbleActive(gs, ref = null) {
  if (!hasBubble(gs)) return false;
  if (ref != null && isSuppressed(gs, ref)) return false;
  return true;
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

/**
 * 当前波动区间：[min, max]；返回 null 表示该时点不波动。
 * 泡沫只改数值，简单！只改节点：
 *   未持书 → 日初 -4~+10
 *   只持简单！ → 回合 -4~+9
 *   只持泡沫 → 日初 -9~+18
 *   两书同持 → 回合 -9~+18
 */
function fluctuationRange(gs, mode) {
  if (mode === 'turn' && !hasTulipSimple(gs)) return null;
  if (mode === 'daily' && hasTulipSimple(gs)) return null;
  if (hasBubble(gs)) return [-9, 18];
  if (hasTulipSimple(gs)) return [-4, 9];
  return [-4, 10];
}

/**
 * 应用一次波动（bless 模式一次调用 = 2 次独立波动）。
 * mode: 'daily' | 'turn' | 'bless'
 * @param {number|object} [ref] 地块 ref（外圈 idx / fence ref），仅用于事件载荷
 * @returns {number} 波动后的价值
 */
export function applyTulipFluctuation(gs, tile, mode = 'daily', ref = null) {
  if (!tile) return 0;
  const range = fluctuationRange(gs, mode);
  if (!range) return tulipValue(tile); // 该时点不波动（节点被另一本书替换）

  const cs = tile.contentState || (tile.contentState = {});
  const times = mode === 'bless' ? 2 : 1;
  const mult = 1 + tulipStacks(tile);
  let v = tulipValue(tile);
  for (let i = 0; i < times; i++) {
    // 每次波动独立掷点；同一格内的叠层共用这一次结果，只按倍率放大
    v += Math.round(randInt(range[0], range[1]) * mult);
  }
  cs.tulipValue = v;
  EventBus.emit(GE.TILE_UPDATED, tulipPayload(gs, tile, ref));
  maybeForceRemoveTulip(gs, tile, ref);
  return v;
}

/**
 * 价值 < -100：强制拆除（不产出、不扣金币）。
 * 判定读【显示值】：没有《泡沫》时显示值恒为 max(0, 内部值) ≥ 0，永远不会触发；
 * 有《泡沫》时显示值即真实值，内部值 < -100 时正常触发。
 */
export function maybeForceRemoveTulip(gs, tile, ref = null) {
  if (!tile || tile.contentId !== TULIP_ID) return false;
  if (tulipDisplayValue(gs, tile, ref) >= TULIP_FORCE_REMOVE_THRESHOLD) return false;

  tile.contentId = null;
  tile.contentState = {};
  syncPumpkin(gs);
  const payload = tulipPayload(gs, tile, ref);
  EventBus.emit(GE.TILE_CONTENT_CHANGED, payload);
  EventBus.emit(GE.TILE_UPDATED, payload);
  EventBus.emit(GE.TOAST_SHOW, {
    text: `🌷 郁金香价值过低（< ${-TULIP_FORCE_REMOVE_THRESHOLD}），已被强制拆除`,
    duration: 2400,
  });
  return true;
}

/** 结算价值：持《泡沫》（且未被压制）时 |价值| > 50 → ×1.5 */
export function settleTulipValue(gs, raw, ref = null) {
  let v = Math.round(Number(raw) || 0);
  if (!bubbleActive(gs, ref)) return v;
  if (v > TULIP_HIGH_THRESHOLD) v = Math.floor(v * 1.5);
  else if (v < -TULIP_HIGH_THRESHOLD) v = -Math.ceil(Math.abs(v) * 1.5);
  return v;
}

/**
 * 对外显示值：没有《泡沫》时显示 max(0, 内部真实值)；有《泡沫》时显示真实值（可为负）。
 * 注意只影响显示，不修改内部值。
 */
export function tulipDisplayValue(gs, tile, ref = null) {
  const v = tulipValue(tile);
  return bubbleActive(gs, ref) ? v : Math.max(0, v);
}

/**
 * 实际结算值：先按真实值算 ×1.5，再按是否拥有《泡沫》决定负值是否生效。
 * 没有《泡沫》→ max(0, settled)；有《泡沫》→ 真实 settled（可为负）。
 */
export function tulipSettleValue(gs, tile, ref = null) {
  const settled = settleTulipValue(gs, tulipValue(tile), ref);
  return bubbleActive(gs, ref) ? settled : Math.max(0, settled);
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
  const { silent = false, ref = null } = opts;
  if (!tile || tile.contentId !== TULIP_ID) return { settled: 0, rawSettled: 0, debt: 0, itemValue: 0 };
  const rawSettled = settleTulipValue(gs, tulipValue(tile), ref);
  const settled = bubbleActive(gs, ref) ? rawSettled : Math.max(0, rawSettled);
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
export function tulipInfo(gs, tile, ref = null) {
  return { value: tulipValue(tile), display: tulipDisplayValue(gs, tile, ref), stacks: tulipStacks(tile) };
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
