// src/systems/StatBonusSystem.js
// 最大生命 / 攻击 / 移速的「动态加成账本」。
//
// 为什么需要它：蓝息（+25%）、悲伤的南瓜（每储存 1 作物 +2%）这类效果会随位置 /
// 储存量反复增减。旧实现用「记录上次增量 → 求差 → 加到当前值」的方式，
// 每一步都基于已经被放大（或缩小）的数值再取整，反复加减后即使加成因全部移除，
// 也回不到原始数值（小数取整方向不对称）。
//
// 现在的口径：单位第一次获得动态加成时，把当前数值记成「基数」(base)；
// 所有加成只以「基数 × 百分比 / 固定值」的形式记账，每次变化都从基数整体重算。
// 加成全部移除时，目标值就是基数本身 → 必定精确还原。
//
// 外部永久改动（收藏品加上限、祝福加攻击等）会在下一次记账时被吸收进基数，
// 因此不会被光环移除误删。

import { applyMaxHp } from './HealSystem.js';

/** 动态加成来源（同一来源只保留最新一份，天然幂等） */
export const STAT_BONUS = {
  BLUE_AURA: 'blue_aura',
  SAD_PUMPKIN: 'sad_pumpkin',
};

/** 统一保留 1 位小数（角色 / 生物同一口径；整数结果仍是整数） */
function round1(v) {
  return Math.round(v * 10) / 10;
}

function ensureLedger(unit) {
  let led = unit._statLedger;
  if (!led) {
    led = unit._statLedger = {
      base: {
        hp: Number(unit.maxHp) || 0,
        atk: Number(unit.atk) || 0,
        speed: Number(unit.speedPerTile) || 0,
      },
      last: null,
      bonuses: {},
    };
  }
  return led;
}

/**
 * 把「上次记账后发生的外部永久改动」吸收进基数。
 * 例：光环生效期间获得收藏品（上限 +2%），移除光环时这 2% 必须保留。
 */
function absorbExternalChange(unit, led) {
  if (!led.last) return;
  const curHp = Number(unit.maxHp) || 0;
  const curAtk = Number(unit.atk) || 0;
  led.base.hp += curHp - led.last.hp;
  led.base.atk += curAtk - led.last.atk;
}

function recompute(unit, led) {
  let hpPct = 0;
  let atkPct = 0;
  let speedMult = 1;
  for (const b of Object.values(led.bonuses)) {
    hpPct += b.hpPct || 0;
    atkPct += b.atkPct || 0;
    speedMult *= b.speedMult || 1;
  }

  const targetHp = round1(led.base.hp * (1 + hpPct));
  const targetAtk = round1(led.base.atk * (1 + atkPct));

  if (Math.abs(targetHp - (Number(unit.maxHp) || 0)) > 1e-9) {
    applyMaxHp(unit, targetHp); // 上限变化 → 当前生命按原百分比同步
  }
  if (Math.abs(targetAtk - (Number(unit.atk) || 0)) > 1e-9) {
    unit.atk = targetAtk;
  }
  if (led.base.speed > 0) {
    const targetSpeed = Math.round((led.base.speed / speedMult) * 1000) / 1000;
    if (Math.abs(targetSpeed - (Number(unit.speedPerTile) || 0)) > 1e-9) {
      unit.speedPerTile = targetSpeed;
    }
  }

  led.last = {
    hp: Number(unit.maxHp) || 0,
    atk: Number(unit.atk) || 0,
  };
}

/**
 * 设置 / 覆盖某个来源的动态加成（幂等）；spec 传 null 表示移除该来源。
 * @param {object} unit 角色或生物（需含 maxHp / atk）
 * @param {string} source STAT_BONUS 中的来源名
 * @param {{hpPct?:number, atkPct?:number, speedMult?:number}|null} spec
 */
export function setStatBonus(unit, source, spec) {
  if (!unit) return;
  const led = ensureLedger(unit);
  absorbExternalChange(unit, led);
  if (!spec) delete led.bonuses[source];
  else {
    led.bonuses[source] = {
      hpPct: Number(spec.hpPct) || 0,
      atkPct: Number(spec.atkPct) || 0,
      speedMult: Number(spec.speedMult) || 1,
    };
  }
  recompute(unit, led);
}

/** 移除某个来源的动态加成（不存在时无副作用） */
export function clearStatBonus(unit, source) {
  if (!unit || !unit._statLedger) return;
  setStatBonus(unit, source, null);
}

/** 当前基数（调试 / 测试用） */
export function getStatBase(unit) {
  return unit?._statLedger ? { ...unit._statLedger.base } : null;
}

export const StatBonusSystem = {
  STAT_BONUS,
  setStatBonus,
  clearStatBonus,
  getStatBase,
};
