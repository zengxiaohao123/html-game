// src/systems/FieldAuraSystem.js
// 田块光环/光环类效果的「日初优先结算」层（设计文档 v0.6 §16.5）
//
// 为什么单独一层：
//   向日葵授予【产出时】、黑莓施加【压制】都会影响「同一天其它田块的产出」，
//   必须在其它田块的 onDailyStart 之前结算（用户 2026-11-21 明确要求「优先结算、当次生效」）。
//   DaySystem.startNewDay() 在 fire('onDailyStart') 之前调用 preDailyStart()。
//
// 结算顺序：
//   1. 清理过期的【产出时】临时特性（produceBonusDay 跨天）
//   2. 黑莓重新施加【压制】（受祝福解除期内跳过）
//   3. 向日葵按外圈顺序依次授予【产出时】临时特性（同一格不重复给）
//   4. 蓝息光环重新同步（角色 / 生物）

import { contentEntries, getTile, neighborRefs8 } from '../core/TileAccess.js';
import { ITEMS } from '../data/items.js';
import { Random } from '../core/Random.js';
import { clearExpiredProduceBonus, grantProduceBonus } from './ProduceSystem.js';
import { applyBlackberrySuppression, isFieldContent, isSuppressed } from './SuppressSystem.js';
import { syncBlueBreath } from './BlueBreathSystem.js';

export const SUNFLOWER_FIELD_ID = 'facility_sunflower';

/** 8 邻格中的田块（不含自身） */
export function neighborFieldTiles(gs, ref) {
  const out = [];
  for (const nb of neighborRefs8(gs, ref)) {
    const tile = getTile(gs, nb);
    if (tile && isFieldContent(tile.contentId)) out.push({ ref: nb, tile });
  }
  return out;
}

/**
 * 向日葵授予【产出时】临时特性。
 * @param {object} gs
 * @param {object} [opts]
 * @param {(number|object)} [opts.onlyRef] 只结算这一块向日葵（受祝福即时结算用）
 * @param {boolean} [opts.all=false] true = 给全部 8 邻格；false = 随机 1 格
 * @returns {number} 实际授予的格数
 */
export function grantSunflowerTraits(gs, opts = {}) {
  const { onlyRef = null, all = false } = opts;
  let granted = 0;
  for (const { ref, tile } of contentEntries(gs)) {
    if (tile.contentId !== SUNFLOWER_FIELD_ID) continue;
    if (onlyRef !== null && String(ref) !== String(onlyRef)) continue;
    if (isSuppressed(gs, ref)) continue; // 被压制：特性失效

    if (all) {
      for (const { ref: nbRef, tile: nbTile } of neighborFieldTiles(gs, ref)) {
        if (nbTile.contentState?.produceBonusDay === gs.day) continue; // 不重复、不叠加
        grantProduceBonus(nbTile, gs.day);
        granted += 1;
      }
      continue;
    }

    // 日初：随机 1 格「本日尚未获得该特性」的田块
    const candidates = neighborFieldTiles(gs, ref)
      .filter(({ tile: nbTile }) => nbTile.contentState?.produceBonusDay !== gs.day);
    if (candidates.length === 0) continue;
    const picked = Random.pick(candidates);
    grantProduceBonus(picked.tile, gs.day);
    granted += 1;
  }
  return granted;
}

/** 日初优先结算入口：必须在 HookDispatcher.fire('onDailyStart') 之前调用 */
export function preDailyStart(gs, opts = {}) {
  const { onlyRef = null } = opts;
  clearExpiredProduceBonus(gs);
  applyBlackberrySuppression(gs, { onlyRef });
  grantSunflowerTraits(gs, { onlyRef });
  syncBlueBreath(gs);
}

/** 地块内容是否为田块（UI / 测试复用） */
export function isFieldTileContent(contentId) {
  return !!ITEMS[contentId] && ITEMS[contentId].tier2 === '田块';
}

export const FieldAuraSystem = {
  SUNFLOWER_FIELD_ID,
  neighborFieldTiles,
  grantSunflowerTraits,
  preDailyStart,
  isFieldTileContent,
};
