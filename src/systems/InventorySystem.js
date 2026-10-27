// src/systems/InventorySystem.js
// Phase 2A 背包系统：
//   addItem(gs, itemId, qty)
//   removeItem(gs, itemId, qty)
//   addToOutbox(gs, itemId, qty)      出货箱，满 12 格时提示
//   loadFromOutbox(gs)                DaySystem.startNewDay 调用：全部按 items[].value 合计为金币，outbox 清空
//   moveItemBetween(gs, from, to, qty) from/to 为 'items' | 'outbox'
//   countItem(gs, itemId, bag='items') 背包内查询总数
//
// 设计文档 §9：
//   - 同名同价值可叠；不同价值同名占不同格（Phase 2A 简化：背包内只按 itemId 分组，暂不处理 value 差异分堆；
//     郁金香 Phase 2B 再加 value 分堆逻辑）
//   - 替换地块内容：旧内容默认消失（帐篷例外：回背包）
//   - Outbox 上限 12 格（OUTBOX_SLOTS = 12）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { ITEMS } from '../data/items.js';
import { OUTBOX_SLOTS } from '../utils/constants.js';

/** Outbox 格数 = 12；每格一个 itemId（不叠放，符合"最多 12 格"定义） */
const OUTBOX_MAX = OUTBOX_SLOTS;

/**
 * 背包中某个 itemId 总数（含可能多个分堆 —— Phase 2A 简化只一个分堆）
 */
export function countItem(gs, itemId, bag = 'items') {
  const list = gs.inventory[bag] || [];
  const entry = list.find(i => i.itemId === itemId);
  return entry ? entry.qty : 0;
}

/**
 * 增加物品到背包（自动叠放同名）
 * @param {object} gs
 * @param {string} itemId
 * @param {number} qty
 * @returns {number} 实际添加数量
 */
export function addItem(gs, itemId, qty, extra = {}) {
  if (!itemId || qty <= 0) return 0;
  const list = gs.inventory.items;
  // 带 value 的物品（如郁金香）不能合并到同一 itemId 的堆里 —— 分堆存 value
  const useValue = extra?.value !== undefined;
  let targetIdx = -1;
  if (!useValue) {
    targetIdx = list.findIndex(i => i.itemId === itemId && i.value === undefined);
  } else {
    targetIdx = list.findIndex(i => i.itemId === itemId && i.value === extra.value);
  }
  if (targetIdx >= 0) {
    list[targetIdx].qty += qty;
  } else {
    const entry = { itemId, qty };
    if (useValue) entry.value = extra.value;
    list.push(entry);
  }
  EventBus.emit(GE.ITEM_GAINED, { itemId, qty });
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'add', bag: 'items', itemId, qty });
  devLog.info('[Inventory] addItem', itemId, 'x', qty, 'extra=', extra, '→', countItem(gs, itemId));
  return qty;
}

/**
 * 从背包移除物品
 * @returns {number} 实际移除数量（若不足则只移除现有）
 */
export function removeItem(gs, itemId, qty) {
  if (!itemId || qty <= 0) return 0;
  const list = gs.inventory.items;
  const entry = list.find(i => i.itemId === itemId);
  if (!entry || entry.qty <= 0) return 0;
  const remove = Math.min(qty, entry.qty);
  entry.qty -= remove;
  if (entry.qty <= 0) {
    const idx = list.indexOf(entry);
    list.splice(idx, 1);
  }
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'remove', bag: 'items', itemId, qty: remove });
  devLog.info('[Inventory] removeItem', itemId, 'x', remove);
  return remove;
}

/**
 * 放入出货箱（Outbox）。设计文档 §9：物品放进去，次日开始自动换成金币。
 * 上限：12 格。满时提示，拒绝放入。
 * （Phase 2A：按"每格一个 itemId、可叠放"处理；严格格数上限 = 不同 itemId 种类数 ≤ 12）
 */
export function addToOutbox(gs, itemId, qty) {
  if (!itemId || qty <= 0) return false;
  const outbox = gs.inventory.outbox;
  const existing = outbox.find(i => i.itemId === itemId);
  if (!existing && outbox.length >= OUTBOX_MAX) {
    EventBus.emit(GE.TOAST_SHOW, { text: '📦 出货箱已满！', duration: 2000 });
    devLog.info('[Inventory] outbox full, reject', itemId);
    return false;
  }
  if (existing) {
    existing.qty += qty;
  } else {
    outbox.push({ itemId, qty });
  }
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'add', bag: 'outbox', itemId, qty });
  devLog.info('[Inventory] addToOutbox', itemId, 'x', qty);
  return true;
}

/**
 * 从出货箱移除物品（玩家手动撤回）
 */
export function removeFromOutbox(gs, itemId, qty) {
  if (!itemId || qty <= 0) return 0;
  const outbox = gs.inventory.outbox;
  const entry = outbox.find(i => i.itemId === itemId);
  if (!entry || entry.qty <= 0) return 0;
  const remove = Math.min(qty, entry.qty);
  entry.qty -= remove;
  if (entry.qty <= 0) {
    const idx = outbox.indexOf(entry);
    outbox.splice(idx, 1);
  }
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'remove', bag: 'outbox', itemId, qty: remove });
  return remove;
}

/**
 * 次日开始时把出货箱所有物品按 items[].value 合计为金币，然后清空 outbox。
 * 由 DaySystem.startNewDay() 调用。
 * @returns {{ earnedGold: number, clearedItems: Array }}
 */
export function loadFromOutbox(gs) {
  const outbox = gs.inventory.outbox;
  if (outbox.length === 0) return { earnedGold: 0, clearedItems: [] };

  let earnedGold = 0;
  const clearedItems = [];
  for (const entry of outbox) {
    const itemDef = ITEMS[entry.itemId];
    const unitValue = itemDef ? itemDef.value : 0;
    earnedGold += unitValue * entry.qty;
    clearedItems.push({ itemId: entry.itemId, qty: entry.qty, unitValue });
  }

  if (earnedGold > 0) {
    gs.player.gold += earnedGold;
    EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: earnedGold });
    EventBus.emit(GE.TOAST_SHOW, { text: `📦 出货自动结算 → +${earnedGold} 🪙`, duration: 2200 });
    devLog.info('[Inventory] loadFromOutbox earned gold =', earnedGold);
  } else {
    devLog.info('[Inventory] loadFromOutbox (no items)');
  }

  // 清空
  gs.inventory.outbox = [];
  EventBus.emit(GE.INVENTORY_CHANGE, { type: 'clearOutbox' });

  return { earnedGold, clearedItems };
}

/**
 * 在背包 <-> 出货箱之间搬移物品（Phase 2B UI 会调此函数）
 * @param {object} gs
 * @param {'items'|'outbox'} from
 * @param {'items'|'outbox'} to
 * @param {string} itemId
 * @param {number} qty
 */
export function moveItemBetween(gs, from, to, itemId, qty) {
  if (from === to) return false;
  if (qty <= 0) return false;

  // 从 from 里先拿（避免 outbox 满时只拿一半）
  let removed;
  if (from === 'items') {
    removed = removeItem(gs, itemId, qty);
  } else {
    removed = removeFromOutbox(gs, itemId, qty);
  }
  if (removed <= 0) return false;

  // 放回 to
  let ok;
  if (to === 'items') {
    addItem(gs, itemId, removed);
    ok = true;
  } else {
    ok = addToOutbox(gs, itemId, removed);
    // 若 outbox 满无法放入，回滚 —— 放回原背包
    if (!ok) {
      addItem(gs, itemId, removed);
    }
  }
  return ok;
}

export const InventorySystem = {
  countItem,
  addItem,
  removeItem,
  addToOutbox,
  removeFromOutbox,
  loadFromOutbox,
  moveItemBetween,
};
