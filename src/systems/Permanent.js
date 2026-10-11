/**
 * systems/Permanent.js —— 永久物品效果聚合（§6.9.3）
 *
 * 每次永久物品增删后重算 gs.permAgg，供探索/战斗直接读取：
 *   baseAtk/baseMaxHp/baseDef/critRate/blockRate
 *   lifesteal / hurtHeal / hurtShield（按叠加规则）
 *   moveHealTotal / sleepHealTotal / extraReward / emptyCompensate ...
 */

import { getItem } from '../data/items.js';
import { InvCategory } from '../core/Const.js';

export function recomputePermanent(gs) {
  const inv = gs.inventory;
  const agg = {
    baseAtk: 0, baseMaxHp: 0, baseDef: 0,
    critRate: 0, blockRate: 0,
    lifeteal: null, hurtHeal: null, hurtShield: null,
    moveHealTotal: 0, sleepHealTotal: 0,
    extraReward: 0, emptyCompensate: 0,
    forestHpPct: 0, mineHpPct: 0,
    sleepResource: 0, chatBonusLyy: 0,
  };

  let lifestealChance = 0;
  let hurtHealChance = 0;
  let hurtHealPct = 0.12;
  let hurtShieldVal = 0;

  for (const [id, count] of inv.items) {
    const def = getItem(id);
    if (!def || def.category !== InvCategory.PERMANENT || count <= 0) continue;
    const p = def.perm || {};
    const n = count;
    agg.baseAtk += (p.baseAtk || 0) * n;
    agg.baseMaxHp += (p.baseMaxHp || 0) * n;
    agg.baseDef += (p.baseDef || 0) * n;
    agg.critRate += (p.critRate || 0) * n;
    agg.blockRate += (p.blockRate || 0) * n;
    agg.moveHealTotal += (p.moveHeal || 0) * n;
    agg.sleepHealTotal += (p.sleepHeal || 0) * n;
    agg.extraReward += (p.extraReward || 0) * n;
    agg.emptyCompensate += (p.emptyCompensate || 0) * n;
    agg.chatBonusLyy += (p.chatBonusLyy || 0) * n;
    agg.forestHpPct += (p.forestHpPct || 0);
    agg.mineHpPct += (p.mineHpPct || 0);
    if (p.sleepResource) agg.sleepResource += p.sleepResource.p * n;

    if (p.lifesteal) lifestealChance += p.lifesteal.chance * n; // 吸血率叠加，50%量不变
    if (p.hurtHeal) {
      // 首件 6%，之后每件 +4%
      hurtHealChance += (n === 1 ? p.hurtHeal.chanceFirst : (p.hurtHeal.chanceFirst + p.hurtHeal.chanceStep * (n - 1)));
      hurtHealPct = p.hurtHeal.pct;
    }
    if (p.hurtShield) {
      // 第1件20，之后每件递增10：20,30,40… 这里要累加每件
      for (let i = 0; i < n; i++) hurtShieldVal += p.hurtShield.first + p.hurtShield.step * i;
    }
  }

  if (lifestealChance > 0) agg.lifesteal = { chance: lifestealChance, pct: 0.5 };
  if (hurtHealChance > 0) agg.hurtHeal = { chance: hurtHealChance, pct: hurtHealPct };
  if (hurtShieldVal > 0) {
    // 每次受击获得的护盾：当前总件数对应"下一件"值；简化为最高那件的值（20+10*(n-1)）
    // 由 count 推导
    agg.hurtShield = { next: hurtShieldValPerHit(gs) };
  }

  gs.permAgg = agg;
  return agg;
}

function hurtShieldValPerHit(gs) {
  const n = gs.inventory.count('armor');
  if (n <= 0) return 0;
  return 20 + 10 * (n - 1);
}
