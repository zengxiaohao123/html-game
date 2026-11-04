// src/systems/UseItemSystem.js
// 消耗道具的使用逻辑（设计文档 v0.5 §14.1 三级分类：使用型 / 放置型）
//
// 使用型：使用后立刻生效、一次性结算、道具消失
//   草药（回 20 血，冷却 5 回合）
//   初级肥料（对植物类田块触发 2 次【每一日开始时】）
//   啤酒（行动力 +3，30% 获得【暴躁】）
//   感恩节的晚餐（本日我方把友善生物也视为敌人）
//
// 放置型：放到地块上后持续生效、道具不消失；同名道具同一地块不可重复放
//   陷阱（每日子开始 10% 得随机物品，资源地块 30%）
//   艾草熏香（在此处睡觉回复 30 生命）
//
// 冷却按回合计数（移动 / 祈福 / 睡觉 才算回合，见 §5.2）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { ITEMS } from '../data/items.js';
import { POTIONS } from '../data/potions.js';
import * as InventorySystem from './InventorySystem.js';
import { HealSystem } from './HealSystem.js';
import { StaminaSystem } from './StaminaSystem.js';
import { drawFromPool } from './RandomPool.js';
import { Random } from '../core/Random.js';

/** 可作为肥料目标的植物类设施（含 v0.5 新增的三种田地） */
const PLANT_FACILITIES = new Set([
  'facility_wheat', 'facility_rice', 'facility_potato', 'facility_tulip',
  'facility_strawberry', 'facility_pea', 'facility_corn', 'facility_cabbage',
  'facility_dandelion', 'facility_ghost_grass', 'facility_mugwort',
]);

/**
 * 只对某一块地结算 N 次【每一日开始时】效果。
 *
 * 做法：把其它地块的 contentId 临时置空，让设施 hook 的自然过滤只剩目标格，
 * 同时清掉该格的 dailyFlags 以绕过"每日限次"，结算完在 finally 里完整还原。
 * 好处是完全复用设施自身的产出逻辑，不另写一套数值（避免两处口径漂移）。
 * 只动 contentId，索引、地形、状态都不变，isMine() 判定依旧成立。
 */
export function runScopedDaily(gs, tileIdx, times = 1) {
  const tiles = gs.map.outerTiles;
  const target = tiles[tileIdx];
  if (!target) return 0;

  const stash = tiles.map((t) => t.contentId);
  const savedFlags = { ...(target.dailyFlags || {}) };
  try {
    for (let i = 0; i < tiles.length; i++) {
      if (i !== tileIdx) tiles[i].contentId = null;
    }
    for (let n = 0; n < times; n++) {
      target.dailyFlags = {};
      HookDispatcher.fire('onDailyStart', { gs, scopedTileIdx: tileIdx });
    }
  } finally {
    for (let i = 0; i < tiles.length; i++) tiles[i].contentId = stash[i];
    target.dailyFlags = savedFlags;
  }
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  return times;
}

function ensureCooldowns(gs) {
  if (!gs.itemCooldowns) gs.itemCooldowns = {};
}

/** 该格是否是肥料可作用的植物类田块 */
export function isPlantTarget(gs, tileIdx) {
  const t = gs.map.outerTiles[tileIdx];
  return !!(t && t.contentId && PLANT_FACILITIES.has(t.contentId));
}

/** 该道具当前是否可用（冷却是否结束） */
export function canUse(gs, itemId) {
  ensureCooldowns(gs);
  const def = POTIONS[itemId];
  if (!def) return { ok: false, reason: 'unknown' };
  const cd = def.useEffect?.cooldownTurns || 0;
  // B-10：冷却以「剩余回合数」存储（§14 冷却以回合计）—— 跨天 gs.turn 归零也不会提前结束
  const left = gs.itemCooldowns[itemId] ?? 0;
  if (cd > 0 && left > 0) {
    return { ok: false, reason: 'cooldown', left };
  }
  if (InventorySystem.countItem(gs, itemId) < 1) return { ok: false, reason: 'noItem' };
  return { ok: true };
}

/**
 * 使用消耗道具
 * @param {object} gs
 * @param {string} itemId
 * @param {object} opts { tileIdx } 放置型/肥料需要目标地块
 */
export function useItem(gs, itemId, opts = {}) {
  const check = canUse(gs, itemId);
  if (!check.ok) {
    if (check.reason === 'cooldown') {
      EventBus.emit(GE.TOAST_SHOW, { text: `⏳ 冷却中，还需 ${check.left} 回合`, duration: 1500 });
    }
    return check;
  }

  const def = POTIONS[itemId];
  const eff = def.useEffect || {};

  let consumed = true;
  switch (eff.type) {
    case 'hp_regen': {
      const actual = HealSystem.healPlayer(gs, eff.amount, { source: itemId });
      EventBus.emit(GE.TOAST_SHOW, { text: `🌿 回复 ${actual} 生命`, duration: 1500 });
      break;
    }

    case 'facility_trigger_twice': {
      const tileIdx = opts.tileIdx;
      const tile = gs.map.outerTiles[tileIdx];
      // 无效目标也照常消耗（物品库备注：无效时不返还已消耗的道具）
      if (!tile || !tile.contentId || !PLANT_FACILITIES.has(tile.contentId)) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🧪 这里不是可施肥的田块（道具已消耗）', duration: 1800 });
        break;
      }
      runScopedDaily(gs, tileIdx, eff.triggerCount || 2);
      EventBus.emit(GE.TOAST_SHOW, { text: `🧪 ${ITEMS[tile.contentId]?.name || '田块'} 立刻结算 ${eff.triggerCount || 2} 次每日效果`, duration: 1800 });
      break;
    }

    case 'stamina_and_buff': {
      // 啤酒 +3：保持既有行为（允许临时超出上限，超出部分次日开始时清除），统一走 StaminaSystem 结算
      StaminaSystem.settleStamina(gs, eff.stamina || 3, { allowOverflow: true, reason: 'item_beer' });
      if (Math.random() < (eff.buffChance ?? 0.3)) {
        gs.activeBuffs = gs.activeBuffs || [];
        // §15 / ITM-CON-003：暴躁 = 攻击力 +25%，持续 1 天，不可叠加。
        // 加成以 buff 形式挂在 activeBuffs（remainingDays 由 DaySystem 每日 -1、归零移除），
        // 伤害结算时由 CombatSystem 统一乘算——不再永久修改 gs.player.atk（此前乘算无法还原）。
        const buffId = eff.buffId || 'grumpy';
        if (!gs.activeBuffs.some((b) => b.id === buffId)) {
          gs.activeBuffs.push({
            id: buffId,
            name: '暴躁',
            remainingDays: eff.buffDays ?? 1,
            atkBonus: eff.buffAtkBonus ?? 0.25,
          });
        }
        EventBus.emit(GE.TOAST_SHOW, { text: '🍺 行动力 +3，并获得【暴躁】攻击力 +25%（持续 1 天，不叠加）', duration: 2000 });
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '🍺 行动力 +3', duration: 1500 });
      }
      break;
    }

    case 'friendly_as_enemy': {
      gs.flags = gs.flags || {};
      gs.flags.friendlyAsEnemyToday = true;   // 每日开始时由 DaySystem 清除
      EventBus.emit(GE.TOAST_SHOW, { text: '🍗 本日我方将友善生物也视为敌人', duration: 2000 });
      break;
    }

    case 'placed_daily_roll':
    case 'placed_sleep_heal': {
      const tileIdx = opts.tileIdx;
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile) return { ok: false, reason: 'invalidTileIdx' };
      tile.contentState = tile.contentState || {};
      tile.contentState.placedItems = tile.contentState.placedItems || [];
      if (tile.contentState.placedItems.some((p) => p.itemId === itemId)) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🪤 该地块已有同名放置道具', duration: 1600 });
        return { ok: false, reason: 'duplicate' };
      }
      tile.contentState.placedItems.push({ itemId, placedDay: gs.day });
      consumed = false;  // A-11：§14.2 放置型「被放置到地块后持续生效，道具不消失」—— 放置后仍留在背包
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
      EventBus.emit(GE.TOAST_SHOW, { text: `📦 已放置 ${ITEMS[itemId]?.name || itemId}`, duration: 1600 });
      break;
    }

    default:
      EventBus.emit(GE.TOAST_SHOW, { text: '🚫 该道具暂未实现使用效果', duration: 1600 });
      return { ok: false, reason: 'notImplemented' };
  }

  if (consumed) InventorySystem.removeItem(gs, itemId, 1);

  const cd = eff.cooldownTurns || 0;
  if (cd > 0) {
    ensureCooldowns(gs);
    gs.itemCooldowns[itemId] = cd; // B-10：剩余回合数（TurnSystem.advanceTurn 每回合 -1）
  }

  HookDispatcher.fire('onUseItem', { gs, itemId, tileIdx: opts.tileIdx });
  EventBus.emit(GE.INVENTORY_CHANGE);
  devLog.info('[UseItem]', itemId, 'used, effect=', eff.type);
  return { ok: true };
}

/** 每日开始：结算放置型道具 */
export function onDailyStart(gs) {
  for (const tile of gs.map.outerTiles) {
    const list = tile.contentState?.placedItems;
    if (!Array.isArray(list) || list.length === 0) continue;
    for (const p of list) {
      const def = POTIONS[p.itemId];
      const eff = def?.useEffect || {};
      if (eff.type !== 'placed_daily_roll') continue;
      const isResource = ITEMS[tile.contentId]?.tier2 === '资源';
      const chance = isResource ? (eff.resourceChance ?? 0.3) : (eff.chance ?? 0.1);
      if (Math.random() < chance) {
        const [hit] = drawFromPool(eff.pool || 'POOL-12', 1);
        if (hit?.id) {
          InventorySystem.addItem(gs, hit.id, 1);
          EventBus.emit(GE.TOAST_SHOW, { text: `🪤 陷阱触发：获得 ${ITEMS[hit.id]?.name || hit.id}`, duration: 1800 });
        }
      }
    }
  }
}

/** 睡觉时：结算放置型道具（艾草熏香） */
export function onSleep(gs) {
  const tile = gs.map.outerTiles[gs.player.x];
  const list = tile?.contentState?.placedItems;
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const p of list) {
    const eff = POTIONS[p.itemId]?.useEffect;
    if (eff?.type === 'placed_sleep_heal') {
      total += HealSystem.healPlayer(gs, eff.healAmount ?? 30, { source: p.itemId });
    }
  }
  return total;
}

/** 初始化：把放置型道具的睡觉结算挂到 onSleep */
let wired = false;
export function initUseItems() {
  if (wired) return;
  wired = true;
  HookDispatcher.register('onSleep', ({ gs }) => onSleep(gs));
}

export const UseItemSystem = { useItem, canUse, onDailyStart, onSleep, initUseItems, runScopedDaily, isPlantTarget };
