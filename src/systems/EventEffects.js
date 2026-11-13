// src/systems/EventEffects.js
// ─────────────────────────────────────────────────────────────────────────────
// 事件选项的结算效果执行器（设计文档 §18.2 / §18.5）
// ─────────────────────────────────────────────────────────────────────────────
// 唯一入口：applyEventEffects(gs, effects, ctx) → string[]（每条效果一行摘要）
//
// 设计口径：
//   · 事件本身**不再进入即结算**；只有玩家确认某个选项时，才由 StoryUI 调用本入口，
//     在确认的同一 tick 执行该选项的 effects（且同一选项在一次事件里只执行一次）。
//   · 不新建平行系统：金币 / 背包 / 行动力 / 治疗 / 地形 / 状态 / 生物全部复用
//     既有系统与既有 EventBus 事件，UI 只订阅既有事件刷新。
//   · 词表是有限的；新增效果类型时只在本文件加一个 case，事件数据无需改 UI。
//
// 效果词表（EventEffect）：
//   { type:'gold',     amount }                正数获得 / 负数失去（最多扣到 0；金币本身可为负）
//   { type:'item',     itemId, qty }           qty > 0 获得；qty < 0 失去（最多扣到现有）
//   { type:'stamina',  amount }                正数增加（允许超上限）/ 负数扣除（不低于 0）
//   { type:'heal',     amount | percent }      固定值或最大生命百分比
//   { type:'terrain',  terrainId, tileIdx? }   缺省作用在事件所在地块（ctx.tileIdx）
//   { type:'buff',     buffId, days?, params? }挂到角色身上（remainingDays，每日 -1）
//   { type:'creature', kind }                  生成 1 只生物（进栅栏，容量规则不变）
// ─────────────────────────────────────────────────────────────────────────────

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { InventorySystem } from './InventorySystem.js';
import { StaminaSystem } from './StaminaSystem.js';
import { HealSystem } from './HealSystem.js';
import { CreatureSystem } from './CreatureSystem.js';
import { BUFFS } from '../data/buffs.js';
import { TERRAINS, normalizeTerrain } from '../data/terrains.js';
import { CREATURES } from '../data/creatures.js';
import { itemName } from '../data/items.js';
import { addGold, getGold } from './GoldSystem.js';

/**
 * 按顺序执行一组事件结算效果。
 * @param {object} gs 全局状态
 * @param {Array<object>} effects EventEffect[]
 * @param {object} [ctx] { tileIdx, eventId, option, script, ... }
 * @returns {string[]} 每条成功执行的效果摘要（供 Toast / 冒烟断言；空数组=无效果）
 */
export function applyEventEffects(gs, effects, ctx = {}) {
  if (!gs || !Array.isArray(effects) || effects.length === 0) return [];
  const out = [];
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object') continue;
    try {
      const desc = applyOne(gs, effect, ctx);
      if (desc) out.push(desc);
    } catch (err) {
      devLog.error('[EventEffects] 效果执行失败', effect, err);
    }
  }
  if (out.length) devLog.info('[EventEffects] 结算完成', ctx.eventId || '', '→', out.join(' / '));
  return out;
}

/** 单条效果 */
function applyOne(gs, eff, ctx) {
  switch (eff.type) {
    case 'gold': return applyGold(gs, eff);
    case 'item': return applyItem(gs, eff);
    case 'stamina': return applyStamina(gs, eff);
    case 'heal': return applyHeal(gs, eff);
    case 'terrain': return applyTerrain(gs, eff, ctx);
    case 'buff': return applyBuff(gs, eff);
    case 'creature': return applyCreature(gs, eff, ctx);
    default:
      devLog.warn('[EventEffects] 未知效果类型', eff.type);
      return '';
  }
}

function applyGold(gs, eff) {
  const delta = Math.trunc(Number(eff.amount) || 0);
  if (!delta) return '';
  // 事件支出口径：最多把金币扣到 0（负债只来自郁金香《泡沫》等既有机制）。
  // 金币本身允许为负，所以可扣额度 = max(0, 当前金币)，不能直接用 -(gold)。
  const actual = delta < 0
    ? -Math.min(-delta, Math.max(0, getGold(gs)))
    : delta;
  if (!actual) return '';
  addGold(gs, actual, 'event');
  return `🪙 ${actual > 0 ? '+' : ''}${actual}`;
}

function applyItem(gs, eff) {
  const qty = Math.trunc(Number(eff.qty ?? 1));
  if (!eff.itemId || !qty) return '';
  if (qty > 0) {
    InventorySystem.addItem(gs, eff.itemId, qty);
    return `📦 ${itemName(eff.itemId)} ×${qty}`;
  }
  const removed = InventorySystem.removeItem(gs, eff.itemId, -qty);
  if (!removed) return '';
  EventBus.emit(GE.ITEM_LOST, { itemId: eff.itemId, qty: removed });
  return `📦 ${itemName(eff.itemId)} -${removed}`;
}

function applyStamina(gs, eff) {
  const amount = Math.trunc(Number(eff.amount) || 0);
  if (!amount) return '';
  if (amount > 0) {
    StaminaSystem.gainStaminaFlat(gs, amount, { reason: 'event' });
    return `⚡ 行动力 +${amount}`;
  }
  const lost = StaminaSystem.loseStaminaNegativeEffect(gs, -amount, { reason: 'event' });
  return lost ? `⚡ 行动力 ${lost}` : '';
}

function applyHeal(gs, eff) {
  let actual = 0;
  if (Number.isFinite(Number(eff.amount))) {
    actual = HealSystem.healPlayer(gs, Number(eff.amount), { source: 'event' });
  } else if (Number.isFinite(Number(eff.percent))) {
    actual = HealSystem.healPlayerByPercent(gs, Number(eff.percent), { source: 'event' });
  }
  return actual > 0 ? `❤️ 生命 +${actual}` : '';
}

function applyTerrain(gs, eff, ctx) {
  const terrainId = normalizeTerrain(eff.terrainId);
  const terrain = TERRAINS[terrainId];
  const tileIdx = eff.tileIdx ?? ctx.tileIdx;
  if (!terrain || tileIdx === undefined || tileIdx === null) return '';
  const tile = gs.map?.outerTiles?.[tileIdx];
  if (!tile) return '';
  tile.terrain = terrainId;
  tile.terrainAmount = terrain.elementAmount || 0;
  EventBus.emit(GE.TILE_TERRAIN_CHANGED, { tileIdx });
  return `🗺️ ${terrain.name}`;
}

function applyBuff(gs, eff) {
  const def = BUFFS[eff.buffId];
  if (!def) {
    devLog.warn('[EventEffects] 未知 buff', eff.buffId);
    return '';
  }
  const days = Math.max(
    1,
    Math.trunc(Number(eff.days ?? eff.duration ?? def.duration ?? 1)),
  );
  const params = { ...(eff.params || {}) };
  gs.activeBuffs = gs.activeBuffs || [];
  // 与 UseItemSystem 的玩家 buff 口径一致：remainingDays 由 DaySystem 每日 -1
  const existing = gs.activeBuffs.find((b) => b.id === def.id);
  if (existing) {
    existing.remainingDays = Math.max(existing.remainingDays || 0, days);
    Object.assign(existing.params || (existing.params = {}), params);
  } else {
    gs.activeBuffs.push({ id: def.id, name: def.name, remainingDays: days, params });
  }
  EventBus.emit(GE.BUFF_APPLIED, {
    buffId: def.id,
    target: null,
    refreshed: !!existing,
    duration: days,
    params,
  });
  return `✨ ${def.name}`;
}

function applyCreature(gs, eff, ctx) {
  const created = CreatureSystem.spawnCreature(gs, eff.kind, {
    sourceTileIdx: ctx.tileIdx ?? null,
  });
  if (!created) return '';
  const def = CREATURES[eff.kind];
  return `🐾 ${def?.name || eff.kind}`;
}

export default { applyEventEffects };
