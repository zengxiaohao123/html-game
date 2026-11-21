// src/systems/BlueBreathSystem.js
// 【蓝息】：蓝星果田块储存蓝星果后散发的圆形光环（物品库 FAC-025）
//
// 规则口径（用户 2026-11-21 确认）：
//   · 半径 = 0.6 + 0.2 × (储存数 - 1) 米；1 格 = 1 米，按地块中心点距离判定，含边界
//   · 蓝星果田块自身一定在范围内，但不参与变异（它产出的蓝星果恒为【湛蓝】）
//   · 范围重叠取最高、不叠加、不重复判定（变异只掷一次）
//   · 角色 / 生物 +25% 最大生命与攻击为动态光环；生物移速 +50%（speedPerTile ÷ 1.5）
//   · NPC 例行搜查系统尚未开发，本模块不实现
//
// 存档：光环本身不落盘，只由「地块储存数 + 玩家/生物当前位置」实时推导；
//       _blueAura 只是运行期增量记录，不进日初基线。

import {
  contentEntries,
  getTile,
  playerRef,
  refXY,
} from '../core/TileAccess.js';
import { ITEMS } from '../data/items.js';
import { Random } from '../core/Random.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { isSuppressed } from './SuppressSystem.js';

export const BLUE_FIELD_ID = 'facility_blue_star_fruit';
export const BLUE_MAX = 7;
export const BLUE_MUTATION_RATE = 0.1;
export const BLUE_STAT_MULT = 1.25;
export const BLUE_SPEED_MULT = 1.5;

/** 储存数（0~7） */
export function blueStoredOf(tile) {
  const n = tile?.contentState?.blueStored;
  return Math.max(0, Math.min(BLUE_MAX, Number.isFinite(n) ? n : 0));
}

/** 蓝息半径（米）：n=0 → 0；n≥1 → 0.6 + 0.2×(n-1) */
export function blueRadiusFor(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return 0.6 + 0.2 * (n - 1);
}

/** 全部生效中的蓝息源（储存数 > 0） */
export function blueBreathSources(gs) {
  const out = [];
  for (const { ref, tile } of contentEntries(gs)) {
    if (tile.contentId !== BLUE_FIELD_ID) continue;
    // 被【压制】的田块特性失效：蓝息随之关闭
    if (isSuppressed(gs, ref)) continue;
    const n = blueStoredOf(tile);
    if (n <= 0) continue;
    const p = refXY(gs, ref);
    if (!p) continue;
    out.push({ ref, tile, stored: n, radius: blueRadiusFor(n), x: p.x + 0.5, y: p.y + 0.5 });
  }
  return out;
}

/** 该地块中心到最近蓝息源的距离是否 ≤ 半径；返回覆盖它的最大半径（0 表示不在范围内） */
export function blueBreathMaxRadiusAt(gs, ref) {
  const p = refXY(gs, ref);
  if (!p) return 0;
  const cx = p.x + 0.5;
  const cy = p.y + 0.5;
  let best = 0;
  for (const src of blueBreathSources(gs)) {
    const d = Math.hypot(cx - src.x, cy - src.y);
    if (d <= src.radius + 1e-9 && src.radius > best) best = src.radius;
  }
  return best;
}

/** 地块是否处于蓝息范围内 */
export function isInBlueBreath(gs, ref) {
  return blueBreathMaxRadiusAt(gs, ref) > 0;
}

/** 该格是否可作为变异来源的目标（其他田块、非蓝星果田块） */
function isMutationTargetTile(gs, ref) {
  const tile = getTile(gs, ref);
  if (!tile || !tile.contentId) return false;
  if (tile.contentId === BLUE_FIELD_ID) return false;
  return ITEMS[tile.contentId]?.tier2 === '田块';
}

/** 该物品是否属于「种出的作物」（产物 / 作物） */
export function isCropItem(itemId) {
  const def = ITEMS[itemId];
  return !!def && def.tier1 === '产物' && def.tier2 === '作物';
}

/**
 * 产出变异判定：在蓝息范围内的其他田块产出的作物，10% 概率变异为【湛蓝】【违禁品】。
 * 范围重叠不重复判定（只掷一次）。
 * @returns {string[]|null} 命中返回展示词条数组，否则 null
 */
export function rollBlueMutation(gs, ref, itemId) {
  if (!isCropItem(itemId)) return null;
  if (itemId === 'item_blue_starfruit') return null; // 恒为湛蓝，无需变异
  if (!isMutationTargetTile(gs, ref)) return null;
  if (!isInBlueBreath(gs, ref)) return null;
  return Random.chance(BLUE_MUTATION_RATE) ? ['湛蓝', '违禁品'] : null;
}

/** 取走储存作物时逐件判定变异（储存类田块在蓝息范围内） */
export function rollBlueMutationPerUnit(gs, ref, itemId, qty) {
  let blue = 0;
  for (let i = 0; i < qty; i += 1) {
    if (rollBlueMutation(gs, ref, itemId)) blue += 1;
  }
  return blue;
}

function auraDelta(base, mult) {
  return Math.round(base * mult * 10) / 10 - base;
}

/** 角色光环：在蓝息范围内时最大生命 / 攻击 +25% */
export function syncPlayerBlueAura(gs) {
  if (!gs?.player) return false;
  const ref = playerRef(gs);
  const covered = ref !== null && isInBlueBreath(gs, ref);
  const rec = gs._blueAura || (gs._blueAura = { hpApplied: 0, atkApplied: 0, active: false });

  if (covered) {
    const baseHp = gs.player.maxHp - rec.hpApplied;
    const baseAtk = gs.player.atk - rec.atkApplied;
    const targetHp = Math.round(baseHp * BLUE_STAT_MULT);
    const targetAtk = Math.round(baseAtk * BLUE_STAT_MULT * 10) / 10;
    rec.hpApplied = targetHp - baseHp;
    rec.atkApplied = Math.round((targetAtk - baseAtk) * 10) / 10;
    gs.player.maxHp = targetHp;
    gs.player.atk = targetAtk;
    if (gs.player.hp > gs.player.maxHp) gs.player.hp = gs.player.maxHp;
    if (!rec.active) {
      rec.active = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '💙 进入蓝息范围：最大生命 / 攻击 +25%', duration: 1800 });
    }
  } else if (rec.active || rec.hpApplied || rec.atkApplied) {
    gs.player.maxHp = Math.round((gs.player.maxHp - rec.hpApplied) * 10) / 10;
    gs.player.atk = Math.round((gs.player.atk - rec.atkApplied) * 10) / 10;
    if (gs.player.hp > gs.player.maxHp) gs.player.hp = gs.player.maxHp;
    rec.hpApplied = 0;
    rec.atkApplied = 0;
    if (rec.active) {
      rec.active = false;
      EventBus.emit(GE.TOAST_SHOW, { text: '💙 离开蓝息范围', duration: 1500 });
    }
  }
  return covered;
}

/** 生物光环：范围内最大生命 / 攻击 +25%，移速 +50%（speedPerTile 为秒/格，按 ÷1.5 提速） */
export function syncCreatureBlueAura(gs) {
  const sources = blueBreathSources(gs);
  for (const c of gs.creatures || []) {
    if (!c || c.hp <= 0) continue;
    let covered = false;
    const cx = Number.isFinite(c.pos?.x) ? c.pos.x : c.x;
    const cy = Number.isFinite(c.pos?.y) ? c.pos.y : c.y;
    if (sources.length > 0 && Number.isFinite(cx) && Number.isFinite(cy)) {
      for (const src of sources) {
        if (Math.hypot(cx - src.x, cy - src.y) <= src.radius + 1e-9) { covered = true; break; }
      }
    }
    const rec = c._blueAura || (c._blueAura = { hpApplied: 0, atkApplied: 0, speedApplied: false });
    if (covered) {
      const baseHp = (c.maxHp || 0) - rec.hpApplied;
      const baseAtk = (c.atk || 0) - rec.atkApplied;
      if (baseHp > 0) {
        const targetHp = Math.round(baseHp * BLUE_STAT_MULT);
        rec.hpApplied = targetHp - baseHp;
        c.maxHp = targetHp;
        if (c.hp > c.maxHp) c.hp = c.maxHp;
      }
      if (baseAtk > 0) {
        const targetAtk = Math.round(baseAtk * BLUE_STAT_MULT);
        rec.atkApplied = targetAtk - baseAtk;
        c.atk = targetAtk;
      }
      if (!rec.speedApplied && c.speedPerTile > 0) {
        c.speedPerTile = Math.round((c.speedPerTile / BLUE_SPEED_MULT) * 1000) / 1000;
        rec.speedApplied = true;
      }
    } else if (rec.hpApplied || rec.atkApplied || rec.speedApplied) {
      c.maxHp = Math.round(((c.maxHp || 0) - rec.hpApplied) * 10) / 10;
      c.atk = Math.round(((c.atk || 0) - rec.atkApplied) * 10) / 10;
      if (c.hp > c.maxHp) c.hp = c.maxHp;
      if (rec.speedApplied) {
        c.speedPerTile = Math.round(c.speedPerTile * BLUE_SPEED_MULT * 1000) / 1000;
        rec.speedApplied = false;
      }
      rec.hpApplied = 0;
      rec.atkApplied = 0;
    }
  }
}

/** 统一同步入口：位置变化 / 储存变化 / 换日后调用 */
export function syncBlueBreath(gs) {
  syncPlayerBlueAura(gs);
  syncCreatureBlueAura(gs);
  EventBus.emit(GE.STAT_CHANGE);
}

export const BlueBreathSystem = {
  BLUE_FIELD_ID,
  BLUE_MAX,
  BLUE_MUTATION_RATE,
  BLUE_STAT_MULT,
  BLUE_SPEED_MULT,
  blueStoredOf,
  blueRadiusFor,
  blueBreathSources,
  blueBreathMaxRadiusAt,
  isInBlueBreath,
  isCropItem,
  rollBlueMutation,
  rollBlueMutationPerUnit,
  syncPlayerBlueAura,
  syncCreatureBlueAura,
  syncBlueBreath,
};
