// src/systems/CombatSystem.js
// Phase 3 —— 伤害计算核心
// 设计文档 §12.5 + §13 元素免疫
// Agent 3 天赋接入：
//   - passive: 烹饪 +maxHp（TalentSystem.firePassive 在游戏启动时 fire）
//              蹁跹 +dodgeRate（同 passive）
//   - damage_flat_bonus: 无所畏惧 +5 物理/火（onDamageDeal 返回 flatBonus 数组）
//   - element_switcher: 何以为我物理/元素乘算（onDamageDeal 返回 physicalMul/elementMul）
//   - wind_crit_bonus: 风息 +20 风元素 / 陆悠悠 +30% 暴击率 / 暴击改风
//   - team_crit_chain: 比翼 陆悠悠暴击后队友下次 +100% 暴击率
//   - death_immunity: 涅槃 致命时 50% HP + 25% atk + 3 天冷却
//   - hp_regen_dodge_bonus: 蹁跹 闪避时主角 +12HP

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { getBuff } from '../data/buffs.js';
import { TalentSystem } from './TalentSystem.js';

// 注：CombatSystem 不直接 import LinkSkillSystem（循环依赖），
// 而是 emit GE.ELEMENT_DAMAGE_APPLIED 事件，由 LinkSkillSystem 在 main.js 里订阅

// ── 暴击基础概率（默认 5%，文档未特别指定天赋外的暴击率，给个小值） ──
const BASE_CRIT_RATE = 0.05;
const CRIT_MULTIPLIER = 1.5; // 暴击伤害 ×1.5

/**
 * 判定元素免疫
 */
export function elementImmuneCheck(target, element) {
  if (!element || !target) return false;
  if (target.elementImmune && target.elementImmune === element) return true;
  return false;
}

/**
 * 计算并应用伤害（完整天赋接入版）
 * @param {object} opts
 * @returns {{ rawDamage: number, finalDamage: number, dodged: boolean, immune: boolean, isCrit: boolean, finalElement: string }}
 */
export function calculateDamage(opts) {
  const {
    atk, skill, defender, element, realDamage = false, player, gs,
    roleId: attackerRoleId,     // 攻击者角色 id（TalentSystem 需要）
    attacker,                  // 攻击者对象（预留）
  } = opts || {};

  // ── 1. 元素免疫 ──
  if (!realDamage && elementImmuneCheck(defender, element)) {
    EventBus.emit(GE.ELEMENT_IMMUNE_HIT, { element, target: defender });
    EventBus.emit(GE.TOAST_SHOW, { text: `🛡️ ${defender.name || defender.kind || '单位'} 免疫 ${element} 伤害`, duration: 1500 });
    devLog.info('[CombatSystem] element immune! target=', defender.kind || defender.name, 'element=', element);
    return { rawDamage: 0, finalDamage: 0, dodged: false, immune: true, isCrit: false, finalElement: element };
  }

  // ── 2. 基础伤害 ──
  const effAtk = atk ?? (player ? player.atk : 0);
  const dmgMul = skill ? skill.damageMultiplier : 1;
  let dmgElement = element || (skill ? skill.element : 'physical');

  let rawDamage = effAtk * dmgMul;

  // ── 2.5 天赋 onDamageDeal 接入 ──
  // 无所畏惧 / 何以为我 / 风息 —— 影响 rawDamage 和暴击率
  let talentOpts = null;
  let talentFlatBonus = 0;
  let talentPhysicalMul = 1;
  let talentElementMul = 1;
  let talentWindFlatBonus = 0;
  let talentCritRateBonus = 0;
  let talentCritElementOverride = null;

  if (gs && !realDamage) {
    talentOpts = TalentSystem.onDamageDeal(gs, {
      attackerRoleId: attackerRoleId,
      element: dmgElement,
      defender,
    });
    talentFlatBonus = talentOpts.flatBonus || 0;
    talentPhysicalMul = talentOpts.physicalMul || 1;
    talentElementMul = talentOpts.elementMul || 1;
    talentWindFlatBonus = talentOpts.windFlatBonus || 0;
    talentCritRateBonus = talentOpts.critRateBonusForAttacker || 0;
    talentCritElementOverride = talentOpts.elementOverrideOnCrit || null;

    // 应用何以为我乘算 + 风息 flat bonus + 无所畏惧 flat
    if (dmgElement === 'physical') {
      rawDamage *= talentPhysicalMul;
    } else {
      rawDamage *= talentElementMul;
    }
    if (dmgElement === 'wind') {
      rawDamage += talentWindFlatBonus;
    }
    rawDamage += talentFlatBonus;
  }

  // ── 3. 虚弱（攻击者侧） ──
  const attackerBuffs = (player && Array.isArray(player.activeBuffs)) ? player.activeBuffs : [];
  for (const b of attackerBuffs) {
    if (b.id === 'weakened') {
      const def = getBuff('weakened');
      const strength = b.params?.strength ?? def?.strength ?? 0.30;
      rawDamage *= (1 - strength);
    }
  }

  // ── 4. 蓄力（defender 身上 —— BUG-4 修复路径） ──
  if (defender && Array.isArray(defender.activeBuffs)) {
    const chargeIdx = defender.activeBuffs.findIndex(b => b.id === 'charge');
    if (chargeIdx >= 0) {
      rawDamage *= 2;
      defender.activeBuffs.splice(chargeIdx, 1);
      EventBus.emit(GE.BUFF_REMOVED, { buffId: 'charge', target: defender });
    }
  }

  // ── 5. 暴击判定（realDamage 不走暴击） ──
  let isCrit = false;
  if (!realDamage) {
    let critRate = BASE_CRIT_RATE + talentCritRateBonus;

    // 比翼：队友下次攻击 +100% 暴击率
    if (gs) {
      const twin = TalentSystem.consumeTwinBuffIfAny(gs);
      if (twin.consumed) {
        critRate *= twin.mul;
        devLog.info('[CombatSystem] 比翼 buff 消耗，本次暴击率 =', critRate * 100 + '%');
      }
    }

    if (Math.random() < critRate) {
      isCrit = true;
      rawDamage *= CRIT_MULTIPLIER;
      devLog.info('[CombatSystem] CRIT! rate=', (critRate * 100).toFixed(1) + '%');
      // 风息：暴击时本次技能伤害类型改为风元素
      if (talentCritElementOverride) {
        dmgElement = talentCritElementOverride;
        devLog.info('[CombatSystem] 风息暴击 → 伤害类型改为', dmgElement);
      }
      // 比翼：陆悠悠暴击 fire TalentSystem.onCrit
      if (gs && attackerRoleId === 'luyouyou') {
        TalentSystem.onCrit(gs, { attackerRoleId });
      }
    }
  }

  // ── 6. 真实伤害不受后续修正 ──
  if (realDamage) {
    rawDamage = Math.max(0, Math.floor(rawDamage));
    applyDamage(defender, rawDamage, { isReal: true, element: dmgElement });
    return { rawDamage, finalDamage: rawDamage, dodged: false, immune: false, isCrit: false, finalElement: dmgElement };
  }

  // ── 7. 闪避（多个来源乘算） ──
  let totalDodgeRate = 1; // 乘算初始 1（100% 不闪避）
  let hasDodgeSource = false;

  // 来源 A：defender 直接字段（蹁跹 +32% 设置到 player.dodgeRate）
  if (defender && typeof defender.dodgeRate === 'number' && defender.dodgeRate > 0) {
    totalDodgeRate *= (1 - defender.dodgeRate);
    hasDodgeSource = true;
  }
  // 来源 B：defender.activeBuffs 里 dodge_ 前缀
  if (defender && Array.isArray(defender.activeBuffs)) {
    for (const b of defender.activeBuffs) {
      if (b.id && b.id.startsWith('dodge_')) {
        const s = b.params?.strength ?? 0;
        if (s > 0) { totalDodgeRate *= (1 - s); hasDodgeSource = true; }
      }
    }
  }
  // 来源 C：opts.talentDodgeRates[]（预留）
  if (Array.isArray(opts.talentDodgeRates)) {
    for (const r of opts.talentDodgeRates) {
      if (typeof r === 'number' && r > 0) { totalDodgeRate *= (1 - r); hasDodgeSource = true; }
    }
  }

  if (hasDodgeSource) {
    const finalDodgeRate = 1 - totalDodgeRate;
    if (Math.random() < finalDodgeRate) {
      devLog.info('[CombatSystem] DODGED! totalDodgeRate=', (finalDodgeRate * 100).toFixed(1) + '%');
      EventBus.emit(GE.DAMAGE_DODGED, { target: defender, attacker: player, skill });
      EventBus.emit(GE.TOAST_SHOW, { text: `💨 ${defender.name || defender.kind || '单位'} 闪避了攻击！`, duration: 1200 });
      // 蹁跹：闪避时主角 +12HP
      if (gs) TalentSystem.onDodge(gs);
      return { rawDamage, finalDamage: 0, dodged: true, immune: false, isCrit, finalElement: dmgElement };
    }
  }

  // ── 8. 防御方易伤 ──
  let vulnerableMul = 1;
  const buffsOfTarget = defender.activeBuffs || [];
  for (const b of buffsOfTarget) {
    if (b.id === 'vulnerable') {
      const def = getBuff('vulnerable');
      const strength = b.params?.strength ?? def?.strength ?? 0.30;
      vulnerableMul += strength;
    }
  }
  let finalDamage = rawDamage * vulnerableMul;
  finalDamage = Math.max(0, Math.floor(finalDamage));

  // ── 8.5 涅槃 death immunity ──
  if (gs && player && finalDamage >= player.hp) {
    // 攻击者是我方角色时（skill 里 player=gs.player），检查涅槃
    // 涅槃是属于夏阳的天赋 —— 如果 player.hp 是最终会被打到 0，夏阳在不在 activeGroup？
    // 按设计：涅槃是"角色受到致命伤害时"的天赋 —— 简化：player 就是主角余默，涅槃应该是在我方角色任意一个受到致命伤害时触发？
    // 再看文档 §12.8："夏阳 · 涅槃" → 角色受到致命伤害时 —— 意思是夏阳自己？还是主角？
    // 文档说"回复 50% 生命值且攻击力 +25%" —— 看起来是主角的 hp 和 atk（我们整个游戏共用 player.hp/atk）。
    // 所以检查：player hp 要被打到 0 时，activeGroup 里有没有夏阳且有涅槃天赋 → 触发
    // TalentSystem.onHPDeath(gs, { roleId: 'xiayang' }) 就是检查 activeGroup 里夏阳有没有涅槃
    const saved = TalentSystem.onHPDeath(gs, { roleId: 'xiayang' });
    if (saved) {
      // 不扣 hp、不扣金币、不扣行动力
      // 已经在 onHPDeath 里设置了 hp 和 atk
      EventBus.emit(GE.HP_CHANGE, { newValue: player.hp, reason: 'talent_reborn_saved' });
      EventBus.emit(GE.TOAST_SHOW, { text: `🔥 涅槃触发！致命伤害被免疫`, duration: 2000 });
      // emit DAMAGE_DEALT 但 finalDamage 改为 0（其实改了 hp，不扣血）
      EventBus.emit(GE.DAMAGE_DEALT, {
        targetRef: { type: 'player' }, damage: 0, element: dmgElement, isReal: false, rebornTriggered: true,
      });
      return { rawDamage, finalDamage: 0, dodged: false, immune: false, isCrit, finalElement: dmgElement };
    }
  }

  // ── 9. 应用伤害 ──
  applyDamage(defender, finalDamage, { isReal: false, element: dmgElement });

  // ── 10. 天赋 recordElementDamage ──
  if (gs && dmgElement && dmgElement !== 'physical') {
    TalentSystem.recordElementDamage(gs, dmgElement);
    // LinkSkill 解耦：emit ELEMENT_DAMAGE_APPLIED —— 由 LinkSkillSystem 订阅处理风起/汲取
    EventBus.emit(GE.ELEMENT_DAMAGE_APPLIED, {
      gs,
      element: dmgElement,
      byRoleId: attackerRoleId,
      target: defender,
    });
  }

  // ── 11. HP 归 0 惩罚（如果最终还是打到 0） ──
  if (defender === player && player.hp <= 0 && !opts._skipDeathPenalty) {
    // HP 归 0：行动力变 0，生命回 1，扣 10% 金币（0~1000），生物停战
    player.hp = 1;
    EventBus.emit(GE.HP_CHANGE, { newValue: 1, reason: 'death_penalty' });
    player.stamina = 0;
    EventBus.emit(GE.STAMINA_CHANGE, { newValue: 0, reason: 'death_penalty' });
    const goldLoss = Math.max(0, Math.min(1000, Math.floor(player.gold * 0.1)));
    if (goldLoss > 0) {
      player.gold -= goldLoss;
      EventBus.emit(GE.GOLD_CHANGE, { newValue: player.gold, delta: -goldLoss, reason: 'death_penalty' });
    }
    EventBus.emit(GE.TOAST_SHOW, { text: `💀 HP 归 0！生命回 1，扣 🪙 ${goldLoss}`, duration: 2500 });
    devLog.info('[CombatSystem] HP=0 penalty: gold -', goldLoss);
  }

  return { rawDamage, finalDamage, dodged: false, immune: false, isCrit, finalElement: dmgElement };
}

export function applyTrueDamageToPlayer(player, amount, extra = {}) {
  if (!player || amount <= 0) return;
  amount = Math.floor(amount);
  player.hp -= amount;
  if (player.hp < 0) player.hp = 0;
  EventBus.emit(GE.HP_CHANGE, { newValue: player.hp, delta: -amount, ...extra });
  EventBus.emit(GE.DAMAGE_TAKEN, { target: 'player', damage: amount, isReal: true, ...extra });
  devLog.info('[CombatSystem] player takes true damage', amount, 'hp now', player.hp);
}

function applyDamage(defender, finalDamage, opts) {
  if (!defender || finalDamage <= 0) {
    EventBus.emit(GE.DAMAGE_DEALT, { target: defender, damage: finalDamage, ...opts });
    return;
  }
  defender.hp -= finalDamage;
  if (defender.hp < 0) defender.hp = 0;

  EventBus.emit(GE.DAMAGE_DEALT, {
    targetRef: defender.id ? { type: 'creature', creatureId: defender.id } : { type: 'player' },
    damage: finalDamage,
    element: opts.element,
    isReal: !!opts.isReal,
  });

  if (defender.kind) {
    devLog.info('[CombatSystem] creature', defender.kind, 'hp -', finalDamage, '→', defender.hp, '/', defender.maxHp);
  }
}

export function applyBuff({ buffId, target, duration, params = {}, creatureId, player }) {
  const def = getBuff(buffId);
  if (!def) {
    devLog.warn('[CombatSystem.applyBuff] unknown buff id:', buffId);
    return null;
  }
  const actualDur = duration != null ? duration : def.duration;

  let targetBuffs;
  if (target && typeof target === 'object' && Array.isArray(target.activeBuffs)) {
    targetBuffs = target.activeBuffs;
  } else if (player) {
    devLog.warn('[CombatSystem.applyBuff] player target 请传 gs 或 creature；当前调用路径跳过');
    return null;
  }
  if (!targetBuffs) return null;

  const existing = targetBuffs.find(b => b.id === buffId);
  if (existing) {
    existing.remainingTurns = Math.max(existing.remainingTurns || 0, actualDur);
    existing.params = { ...(existing.params || {}), ...params };
    EventBus.emit(GE.BUFF_APPLIED, { buffId, target, refreshed: true });
    devLog.info('[CombatSystem.applyBuff] buff refreshed', buffId);
    return existing;
  }

  const instance = {
    id: buffId,
    creatureId: creatureId || (target && target.id) || undefined,
    remainingTurns: actualDur,
    params,
  };
  targetBuffs.push(instance);
  EventBus.emit(GE.BUFF_APPLIED, { buffId, target, refreshed: false, duration: actualDur, params });
  devLog.info('[CombatSystem.applyBuff] applied', buffId, 'duration=', actualDur);
  return instance;
}

export function removeBuff(target, buffId) {
  if (!target || !Array.isArray(target.activeBuffs)) return;
  const idx = target.activeBuffs.findIndex(b => b.id === buffId);
  if (idx >= 0) {
    target.activeBuffs.splice(idx, 1);
    EventBus.emit(GE.BUFF_REMOVED, { buffId, target });
  }
}

export function tickBuffsOnTarget(target) {
  if (!target || !Array.isArray(target.activeBuffs)) return [];
  const removed = [];
  const burnDef = getBuff('burn');
  for (const b of [...target.activeBuffs]) {
    if (b.id === 'burn' && burnDef) {
      const loss = Math.max(1, Math.floor((target.maxHp || target.hp) * 0.03));
      target.hp -= loss;
      if (target.hp < 0) target.hp = 0;
      EventBus.emit(GE.DAMAGE_TAKEN, {
        target: target.id ? { type: 'creature', creatureId: target.id } : { type: 'player' },
        damage: loss, element: 'fire', isBurn: true,
      });
      devLog.info('[CombatSystem.tickBuffs] burn drain', target.kind || target.name, '-', loss, 'hp→', target.hp);
    }

    if (b.remainingTurns !== undefined) b.remainingTurns -= 1;
    if ((b.remainingTurns ?? 1) <= 0) {
      removeBuff(target, b.id);
      removed.push(b);
    }
  }
  return removed;
}

export const CombatSystem = {
  elementImmuneCheck,
  calculateDamage,
  applyTrueDamageToPlayer,
  applyBuff,
  removeBuff,
  tickBuffsOnTarget,
};
