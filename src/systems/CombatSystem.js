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

  // ── 0. §5.4 停战解除：玩家主动攻击任意生物时，生物停战状态即告结束 ──
  // （player 存在 = 攻击者是我方；defender.kind 存在 = 目标是生物）
  if (gs && player && defender && defender !== player && defender.kind && gs.flags?.creatureTruce) {
    gs.flags.creatureTruce = false;
    devLog.info('[CombatSystem] 玩家主动攻击生物 → 解除生物停战');
  }

  // ── 0.5 连携技汲取（SKL-L-005）：余默下一次攻击元素改写 ──
  // yumoNextElementOverride 由 LinkSkillSystem.onElementDamage 写入，这里消费（一次性）
  let effectiveElement = element;
  if (gs && !realDamage && attackerRoleId === 'yumo' && gs.team?.yumoNextElementOverride) {
    effectiveElement = gs.team.yumoNextElementOverride;
    delete gs.team.yumoNextElementOverride;
    EventBus.emit(GE.TOAST_SHOW, { text: `💧 汲取：余默本次攻击转为 ${effectiveElement} 元素`, duration: 1500 });
    devLog.info('[CombatSystem] 汲取：余默攻击元素 →', effectiveElement);
  }

  // ── 1. 元素免疫 ──
  if (!realDamage && elementImmuneCheck(defender, effectiveElement)) {
    EventBus.emit(GE.ELEMENT_IMMUNE_HIT, { element: effectiveElement, target: defender });
    EventBus.emit(GE.TOAST_SHOW, { text: `🛡️ ${defender.name || defender.kind || '单位'} 免疫 ${effectiveElement} 伤害`, duration: 1500 });
    devLog.info('[CombatSystem] element immune! target=', defender.kind || defender.name, 'element=', effectiveElement);
    return { rawDamage: 0, finalDamage: 0, dodged: false, immune: true, isCrit: false, finalElement: effectiveElement };
  }

  // ── 2. 基础伤害 ──
  const effAtk = atk ?? (player ? player.atk : 0);
  const dmgMul = skill ? skill.damageMultiplier : 1;
  let dmgElement = effectiveElement || (skill ? skill.element : 'physical');

  let rawDamage = effAtk * dmgMul;

  // ── 2.1 §15 / ITM-CON-003：【暴躁】攻击力 +25%，持续 1 天，不可叠加 ──
  // 加成在伤害结算时统一乘算（buff 本体挂在 gs.activeBuffs，由 DaySystem 每日衰减移除），
  // 不永久修改 gs.player.atk。
  if (gs && player && Array.isArray(gs.activeBuffs) && gs.activeBuffs.some(b => b.id === 'grumpy')) {
    rawDamage *= 1.25;
  }

  // ── 2.2 众愿（SKL-A-007）：本日内我方火元素伤害 +20%，其余元素及物理 -10% ──
  // gs.team.allWishesActive 由 SkillSystem 在技能结算前置位，DaySystem 跨天清除
  if (gs && !realDamage && gs.team?.allWishesActive) {
    rawDamage *= (dmgElement === 'fire') ? 1.2 : 0.9;
  }

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

  // ── 3. 虚弱（攻击者侧）── §15：同名效果取最高，不叠乘
  // 虚弱属于「造成伤害」的一方：谁出手就读谁身上的 weakened（我方角色或生物攻击者）
  const attackerUnit = attacker || player;
  const attackerBuffs = (attackerUnit && Array.isArray(attackerUnit.activeBuffs)) ? attackerUnit.activeBuffs : [];
  let weakenedStrength = 0;
  for (const b of attackerBuffs) {
    if (b.id !== 'weakened') continue;
    const def = getBuff('weakened');
    const strength = b.params?.strength ?? def?.strength ?? 0.30;
    if (strength > weakenedStrength) weakenedStrength = strength;
  }
  if (weakenedStrength > 0) rawDamage *= (1 - weakenedStrength);

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

    // 屏息瞄准（SKL-A-010）：陆悠悠下一次攻击暴击率 +100%（一次性消费）
    if (gs && attackerRoleId === 'luyouyou' && gs.team?.luyouyouNextCritBonus) {
      critRate += gs.team.luyouyouNextCritBonus;
      gs.team.luyouyouNextCritBonus = 0;
      devLog.info('[CombatSystem] 屏息瞄准消耗 → 本次暴击率 =', (critRate * 100).toFixed(1) + '%');
    }

    // 比翼（§12.9）：陆悠悠暴击后，其余我方角色下一次攻击暴击率 +100 百分点（加算；陆悠悠本人不享受）
    if (gs && attackerRoleId !== 'luyouyou') {
      const twin = TalentSystem.consumeTwinBuffIfAny(gs, attackerRoleId);
      if (twin.consumed) {
        critRate += twin.add;
        devLog.info('[CombatSystem] 比翼 buff 消耗，本次暴击率 =', (critRate * 100).toFixed(1) + '%');
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

  // ── 8. 防御方易伤 ── §15：同名效果取最高，不叠加
  let vulnerableStrength = 0;
  for (const b of (defender.activeBuffs || [])) {
    if (b.id !== 'vulnerable') continue;
    const def = getBuff('vulnerable');
    const strength = b.params?.strength ?? def?.strength ?? 0.30;
    if (strength > vulnerableStrength) vulnerableStrength = strength;
  }
  let finalDamage = rawDamage * (1 + vulnerableStrength);
  finalDamage = Math.max(0, Math.floor(finalDamage));

  // ── 8.5 涅槃 death immunity ──
  // 仅当受击者就是玩家本人时判定：玩家攻击生物时 player 是攻击方，
  // 若用「对生物的最终伤害 >= 玩家当前生命」判定，会在玩家低血量时
  // 误触发涅槃并吞掉本次攻击伤害（表现为攻击无效）。
  if (gs && player && defender === player && finalDamage >= player.hp) {
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

  // ── 11. 生命归 0 惩罚（§5.4，如果最终还是打到 0） ──
  if (defender === player && player.hp <= 0 && !opts._skipDeathPenalty) {
    applyDeathPenalty(gs, player);
  }

  return { rawDamage, finalDamage, dodged: false, immune: false, isCrit, finalElement: dmgElement };
}

/**
 * §5.4 生命归 0 惩罚：
 *   - 行动力变为 0（已为负数的不变）
 *   - 生命回到 1
 *   - 扣除 10% 金币（扣除额限制在 0~1000）
 *   - 所有生物停止主动攻击，直到玩家下次主动攻击任意生物
 */
export function applyDeathPenalty(gs, player) {
  if (!player) return;
  if (player.hp <= 0) {
    player.hp = 1;
    EventBus.emit(GE.HP_CHANGE, { newValue: 1, reason: 'death_penalty' });
  }
  // §5.4：行动力变为 0；已为负数的不变
  if (player.stamina > 0) {
    player.stamina = 0;
    EventBus.emit(GE.STAMINA_CHANGE, { newValue: 0, reason: 'death_penalty' });
  }
  const goldLoss = Math.max(0, Math.min(1000, Math.floor((player.gold || 0) * 0.1)));
  if (goldLoss > 0) {
    player.gold -= goldLoss;
    EventBus.emit(GE.GOLD_CHANGE, { newValue: player.gold, delta: -goldLoss, reason: 'death_penalty' });
  }
  if (gs) {
    gs.flags = gs.flags || {};
    gs.flags.creatureTruce = true;
  }
  EventBus.emit(GE.TOAST_SHOW, { text: `💀 生命归 0！生命回 1，扣 🪙 ${goldLoss}，生物停战`, duration: 2500 });
  devLog.info('[CombatSystem] death penalty applied: gold -', goldLoss, ', creatureTruce = true');
}

/**
 * 对玩家施加真实伤害（粘液、容量超载等不走常规伤害结算的来源）。
 * 生命归 0 时：先检查夏阳【涅槃】天赋（与常规伤害同路径），未获救则走 §5.4 惩罚。
 */
export function applyTrueDamageToPlayer(gs, player, amount, extra = {}) {
  if (!player || amount <= 0) return;
  amount = Math.floor(amount);
  player.hp -= amount;
  if (player.hp < 0) player.hp = 0;
  EventBus.emit(GE.HP_CHANGE, { newValue: player.hp, delta: -amount, ...extra });
  EventBus.emit(GE.DAMAGE_TAKEN, { target: 'player', damage: amount, isReal: true, ...extra });
  devLog.info('[CombatSystem] player takes true damage', amount, 'hp now', player.hp);

  if (player.hp <= 0) {
    const saved = gs ? TalentSystem.onHPDeath(gs, { roleId: 'xiayang' }) : false;
    if (saved) {
      EventBus.emit(GE.HP_CHANGE, { newValue: player.hp, reason: 'talent_reborn_saved' });
      EventBus.emit(GE.TOAST_SHOW, { text: '🔥 涅槃触发！致命伤害被免疫', duration: 2000 });
    } else {
      applyDeathPenalty(gs, player);
    }
  }
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
  // C-8（设计文档 line 307）：状态持续时间上限 99（新建与合并刷新共用）
  const actualDur = Math.min(99, duration != null ? duration : def.duration);

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
    const oldStrength = existing.params?.strength;
    existing.params = { ...(existing.params || {}), ...params };
    // §15：同名效果取最高值 —— 易伤/虚弱等强度类 buff 不被更低的强度覆盖
    if (typeof oldStrength === 'number' && typeof params?.strength === 'number') {
      existing.params.strength = Math.max(oldStrength, params.strength);
    }
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
  applyDeathPenalty,
  applyTrueDamageToPlayer,
  applyBuff,
  removeBuff,
  tickBuffsOnTarget,
};
