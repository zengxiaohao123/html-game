// src/systems/CombatSystem.js
// Phase 3 —— 伤害计算核心
// 设计文档 §12.5 + §13 元素免疫
//
// 核心逻辑：
//   基础伤害 = attacker.atk × skill.damageMultiplier
//   元素免疫 → 0 伤害（emit ELEMENT_IMMUNE_HIT）
//   真实伤害 (realDamage=true) 绕过闪避
//   闪避：多个闪避来源乘算，不是加算；真实伤害/流失生命不触发闪避
//   易伤：受到伤害 +strength
//   虚弱：造成伤害 -strength（攻击者侧）
//   蓄力：下次造成伤害 ×2
//
// 这里的 defender 可以是：
//   - 生物对象（CreatureSystem 里的 gs.creatures[i]）
//   - 玩家对象 gs.player（真实伤害/扣血）
// 我们用 duck typing：只要有 hp/maxHp 就可以。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { getBuff } from '../data/buffs.js';

/**
 * 判定元素免疫
 * @param {object} target  生物对象（defender），必须有 elementImmune 字段
 * @param {string} [element] 技能/攻击的元素类型
 * @returns {boolean}
 */
export function elementImmuneCheck(target, element) {
  if (!element || !target) return false;
  if (target.elementImmune && target.elementImmune === element) return true;
  return false;
}

/**
 * 计算并应用伤害
 * @param {object} opts
 * @param {number} opts.atk                 攻击者攻击力
 * @param {object} [opts.skill]            技能对象（含 element / damageMultiplier / realDamage / range 等）
 * @param {object} opts.defender            防御方（duck: 有 hp / maxHp / 可选 elementImmune / 可选 activeBuffs[] ）
 * @param {string} [opts.element]           伤害元素
 * @param {boolean} [opts.realDamage=false] 真实伤害：绕过闪避、不受虚弱/蓄力影响
 * @param {object} [opts.player]            玩家对象（若 defender 是生物，则玩家是攻击者，用于应用易伤的 player.buff 未来扩展）
 * @returns {{ rawDamage: number, finalDamage: number, dodged: boolean, immune: boolean }}
 */
export function calculateDamage({ atk, skill, defender, element, realDamage = false, player }) {
  const effAtk = atk ?? (player ? player.atk : 0);
  const dmgMul = skill ? skill.damageMultiplier : 1;
  const dmgElement = element || (skill ? skill.element : 'physical');

  // 1. 元素免疫 → 0 伤害（非真实伤害才会免疫，真实伤害不免疫）
  if (!realDamage && elementImmuneCheck(defender, dmgElement)) {
    EventBus.emit(GE.ELEMENT_IMMUNE_HIT, { element: dmgElement, target: defender });
    EventBus.emit(GE.TOAST_SHOW, { text: `🛡️ ${defender.name || defender.kind || '单位'} 免疫 ${dmgElement} 伤害`, duration: 1500 });
    devLog.info('[CombatSystem] element immune! target=', defender.kind || defender.name, 'element=', dmgElement);
    return { rawDamage: 0, finalDamage: 0, dodged: false, immune: true };
  }

  // 2. 基础伤害
  let rawDamage = effAtk * dmgMul;

  // 3. 虚弱（攻击者侧：从 attacker 的 activeBuffs 读取 weakened，减少 rawDamage）
  //    虚弱 buff 由风止技能等施加给敌人。这里 player 作为 attacker 时，读 player.activeBuffs；
  //    如果未来敌人作为 attacker（攻击我方角色），也需要从那个 creature 的 activeBuffs 读。
  const attackerBuffs = (player && Array.isArray(player.activeBuffs)) ? player.activeBuffs : [];
  for (const b of attackerBuffs) {
    if (b.id === 'weakened') {
      const def = getBuff('weakened');
      const strength = b.params?.strength ?? def?.strength ?? 0.30;
      rawDamage *= (1 - strength);
      devLog.info('[CombatSystem] attacker weakened: rawDamage reduced by', (strength * 100).toFixed(0) + '%');
    }
  }

  // 4. 蓄力（从 defender.activeBuffs 读 charge buff，有则 rawDamage ×2 并移除）
  //    设计文档 §15 蓄力定义为"敌人专属，下一次攻击伤害 ×2"——语义上应该是 attacker 身上的 buff，
  //    但 BUG-4 任务指示从 defender 身上读取（可能是为弱点击破连携技服务：敌人蓄力时我方攻击翻倍）。
  //    这里按任务指示实现，加 TODO 留待 Agent 3 校准。
  if (defender && Array.isArray(defender.activeBuffs)) {
    const chargeIdx = defender.activeBuffs.findIndex(b => b.id === 'charge');
    if (chargeIdx >= 0) {
      rawDamage *= 2;
      devLog.info('[CombatSystem] charge consumed! rawDamage doubled →', rawDamage);
      defender.activeBuffs.splice(chargeIdx, 1);
      EventBus.emit(GE.BUFF_REMOVED, { buffId: 'charge', target: defender });
    }
  }

  // 5. 真实伤害不受后续任何修正（绕过闪避/虚弱/蓄力）
  if (realDamage) {
    rawDamage = Math.max(0, Math.floor(rawDamage));
    applyDamage(defender, rawDamage, { isReal: true, element: dmgElement });
    return { rawDamage, finalDamage: rawDamage, dodged: false, immune: false };
  }

  // ── 5.5 闪避（设计文档 §12.6：多个来源乘算，真实伤害不触发） ──
  let totalDodgeRate = 1; // 乘算，初始 1 表示 100% 不闪避
  let hasDodgeSource = false;

  // 来源 A：defender 直接字段（天赋蹁跹 +32% 会设置此值）
  if (defender && typeof defender.dodgeRate === 'number' && defender.dodgeRate > 0) {
    totalDodgeRate *= (1 - defender.dodgeRate);
    hasDodgeSource = true;
  }

  // 来源 B：defender.activeBuffs 里的 dodge 类 buff
  if (defender && Array.isArray(defender.activeBuffs)) {
    for (const b of defender.activeBuffs) {
      if (b.id && b.id.startsWith('dodge_')) {
        const strength = b.params?.strength ?? 0;
        if (strength > 0) {
          totalDodgeRate *= (1 - strength);
          hasDodgeSource = true;
        }
      }
    }
  }

  // 来源 C：player.talentDodgeRates[] —— 来自我方角色天赋（蹁跹 +32% 等）
  //   这些是在我方角色身上，但防御方是敌方生物 —— 不对，闪避是防御方属性。
  //   不过蹁跹天赋写的是"角色闪避率 +32%"，也就是我方角色作为 defender 时有 +32%。
  //   如果 player 作为 defender（真实伤害路径已提前 return，这里不会到），或者我方角色作为 defender 时。
  //   这里预留从 params.talentDodgeRates[] 乘算的口子，Agent 3 TalentSystem 会传进来。
  const talentDodgeRates = arguments[0]?.talentDodgeRates; // 从 opts 里读
  if (Array.isArray(talentDodgeRates)) {
    for (const r of talentDodgeRates) {
      if (typeof r === 'number' && r > 0) {
        totalDodgeRate *= (1 - r);
        hasDodgeSource = true;
      }
    }
  }

  if (hasDodgeSource) {
    const finalDodgeRate = 1 - totalDodgeRate; // 还原成百分比
    if (Math.random() < finalDodgeRate) {
      // 闪避成功
      devLog.info('[CombatSystem] DODGED! target=', defender.kind || defender.name,
        'totalDodgeRate=', (finalDodgeRate * 100).toFixed(1) + '%');
      EventBus.emit(GE.DAMAGE_DODGED, { target: defender, attacker: player, skill });
      EventBus.emit(GE.TOAST_SHOW, { text: `💨 ${defender.name || defender.kind || '单位'} 闪避了攻击！`, duration: 1200 });
      return { rawDamage, finalDamage: 0, dodged: true, immune: false };
    }
  }

  // 6. 防御方易伤（vulnerable → 受到伤害 +strength）
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

  // 7. 虚弱（攻击者侧，玩家身上的 —— 玩家目前不会挂；但玩家身上 activeBuffs 会在 calculatePlayerDamage 算）
  finalDamage = Math.max(0, Math.floor(finalDamage));

  // 8. 应用到目标
  applyDamage(defender, finalDamage, { isReal: false, element: dmgElement });

  return { rawDamage, finalDamage, dodged: false, immune: false };
}

/**
 * 玩家受到真实伤害（容量惩罚、HP 归 0 惩罚等）
 * @param {object} player GS.player
 * @param {number} amount 伤害量
 * @param {object} [extra] 可选附加信息
 */
export function applyTrueDamageToPlayer(player, amount, extra = {}) {
  if (!player || amount <= 0) return;
  amount = Math.floor(amount);
  player.hp -= amount;
  if (player.hp < 0) player.hp = 0;
  EventBus.emit(GE.HP_CHANGE, { newValue: player.hp, delta: -amount, ...extra });
  EventBus.emit(GE.DAMAGE_TAKEN, { target: 'player', damage: amount, isReal: true, ...extra });
  devLog.info('[CombatSystem] player takes true damage', amount, 'hp now', player.hp);
}

/**
 * 内部：把伤害扣到 defender（duck typing）
 */
function applyDamage(defender, finalDamage, opts) {
  if (!defender || finalDamage <= 0) {
    // 0 伤害也 emit，方便 UI 监听
    EventBus.emit(GE.DAMAGE_DEALT, { target: defender, damage: finalDamage, ...opts });
    return;
  }
  defender.hp -= finalDamage;
  if (defender.hp < 0) defender.hp = 0;

  // emit
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

/**
 * 给目标挂 buff
 * @param {object} opts
 * @param {string} opts.buffId
 * @param {object} opts.target   生物对象（会有 activeBuffs）或 'player'
 * @param {number} [opts.duration]  持续回合数 / 天数（不填用 buff 默认）
 * @param {object} [opts.params]    额外参数（如 strength）
 * @param {number} [opts.creatureId] 若 target 是生物
 * @param {object} [opts.player]      若 target 是玩家
 */
export function applyBuff({ buffId, target, duration, params = {}, creatureId, player }) {
  const def = getBuff(buffId);
  if (!def) {
    devLog.warn('[CombatSystem.applyBuff] unknown buff id:', buffId);
    return null;
  }
  const actualDur = duration != null ? duration : def.duration;

  // 目标可能是 creature 对象（直接带 activeBuffs），也可能是字符串 'player'
  let targetBuffs;
  if (target && typeof target === 'object' && Array.isArray(target.activeBuffs)) {
    targetBuffs = target.activeBuffs;
  } else if (player) {
    // 玩家身上的 buff 在 gs.activeBuffs[]（Phase 2A TurnSystem 已这么干）
    // 但传进来的 player 不一定有 activeBuffs 字段 —— 所以我们通过 params 接收 gs
    devLog.warn('[CombatSystem.applyBuff] player target 请传 gs 对象（含 activeBuffs）或 creature 对象；当前调用路径跳过');
    return null;
  }

  if (!targetBuffs) return null;

  // 相同 buff 取 duration 最长的（同名取 max，不叠加）
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

/**
 * 从目标身上移除 buff（查找并 fire 事件）
 */
export function removeBuff(target, buffId) {
  if (!target || !Array.isArray(target.activeBuffs)) return;
  const idx = target.activeBuffs.findIndex(b => b.id === buffId);
  if (idx >= 0) {
    target.activeBuffs.splice(idx, 1);
    EventBus.emit(GE.BUFF_REMOVED, { buffId, target });
  }
}

/**
 * 回合推进时 tick 身上的 buff（每回合流失 1），并处理：
 *   - burn：流失 3% hp 可致死
 *   - weakened/vulnerable：倒计时到 0 移除
 *   - charge：下次攻击后移除（这里只做倒计时）
 * 返回被移除的 buff 列表，方便上层继续处理
 */
export function tickBuffsOnTarget(target) {
  if (!target || !Array.isArray(target.activeBuffs)) return [];
  const removed = [];
  const burnDef = getBuff('burn');
  for (const b of [...target.activeBuffs]) {
    if (b.id === 'burn' && burnDef) {
      // 流失 3% hp 可致死
      const loss = Math.max(1, Math.floor((target.maxHp || target.hp) * 0.03));
      target.hp -= loss;
      if (target.hp < 0) target.hp = 0;
      EventBus.emit(GE.DAMAGE_TAKEN, {
        target: target.id ? { type: 'creature', creatureId: target.id } : { type: 'player' },
        damage: loss, element: 'fire', isBurn: true,
      });
      devLog.info('[CombatSystem.tickBuffs] burn drain', target.kind || target.name, '-', loss, 'hp→', target.hp);
    }

    // 倒计时
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
