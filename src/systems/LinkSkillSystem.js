// src/systems/LinkSkillSystem.js
// Agent 3 —— 连携技完整实现
// 7 个连携技：汲取 / 炽燃 / 焚灭 / 弱点击破 / 风暴眼 / 追猎 / 风起
// 触发时机：
//   - onSkillFired(roleId, skill, target)  —— SkillSystem.fireOneSkill 末尾 fire
//   - onElementDamage(element, byRoleId)   —— CombatSystem calculateDamage 造成元素伤害后 fire
//   - resetAll(gs)                          —— DaySystem.startNewDay 末尾
//
// 结算：pop 后对目标造成伤害 + 应用额外效果（按 characters.js 的 triggerCondition/extraEffect）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { getSkill, getSkillsByRole, CHARACTERS } from '../data/characters.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';

const WINDOW_MS = 3000; // 3 秒实时窗口

function getActiveGroupRoles(gs) {
  const group = gs.team?.groups?.[gs.team?.activeGroup ?? 0];
  return group ? (group.roles || []) : [];
}

/**
 * 入队（如果不在队列里且没冷却）
 */
function tryEnqueue(gs, skillId, opts = {}) {
  const { cooldownTurns = 0, context = null } = opts;
  if (!gs.linkSkillQueue) gs.linkSkillQueue = [];

  // 已在队列 → 跳过（同时解锁只入队一次）
  if (gs.linkSkillQueue.some(e => e.skillId === skillId)) {
    return null;
  }

  // 冷却检查
  if (gs.linkSkillCooldowns && gs.linkSkillCooldowns[skillId] > gs.turn) {
    return null;
  }

  const entry = {
    skillId,
    roleId: opts.roleId || null,
    expireAtMs: Date.now() + WINDOW_MS,
    cooldownTurns,
    context,  // 触发上下文（如元素类型、目标 creature 对象等）
  };
  gs.linkSkillQueue.push(entry);
  EventBus.emit(GE.LINK_SKILL_READY, { skillId, entry });
  devLog.info('[LinkSkillSystem] enqueue', skillId);
  return entry;
}

/**
 * 每次普通技能触发后 fire —— SkillSystem.fireOneSkill 末尾
 * 检测：焚灭 +1 计数、追猎 +1 计数、风暴眼、汲取/风起（由 onElementDamage 处理）
 */
export function onSkillFired(gs, { roleId, skillId, skill, target }) {
  // ── 焚灭：每次夏阳技能 → 计数 +1 ──
  if (roleId === 'xiayang') {
    if (!gs.team) gs.team = {};
    gs.team.xiayangSkillCount = (gs.team.xiayangSkillCount || 0) + 1;
    const count = gs.team.xiayangSkillCount;
    devLog.info('[LinkSkillSystem] 焚灭计数 →', count);

    // 检查是否到 3 或 7
    const annihilate = getSkill('skill_link_xiayang_annihilate');
    if (annihilate) {
      // 二段 7 优先（到了 7 就先入二段，到了 3 先入一段）
      if (count >= 7) {
        tryEnqueue(gs, 'skill_link_xiayang_annihilate', {
          roleId: 'xiayang',
          context: { tier: 2 },
        });
      } else if (count >= 3) {
        tryEnqueue(gs, 'skill_link_xiayang_annihilate', {
          roleId: 'xiayang',
          context: { tier: 1 },
        });
      }
    }
  }

  // ── 追猎：我方技能攻击敌人 +1 计数 ──
  if (!gs.team) gs.team = {};
  gs.team.huntAttackCount = (gs.team.huntAttackCount || 0) + 1;
  if (gs.team.huntAttackCount >= 3) {
    tryEnqueue(gs, 'skill_link_luyouyou_hunt', {
      roleId: 'luyouyou',
      context: { targetCreatureId: target ? target.id : null },
    });
  }

  // ── 风暴眼：累计 4 种及以上元素 ──
  const dailyEl = gs.team?.dailyElementDamages || [];
  if (dailyEl.length >= 4) {
    tryEnqueue(gs, 'skill_link_luyouyou_storm_eye', { roleId: 'luyouyou' });
  }
}

/**
 * 每次造成元素伤害后 fire —— CombatSystem calculateDamage 里（TalentSystem.recordElementDamage 之后同步 fire）
 * 触发：风起（火/水/雷/冰）、汲取（除余默外元素伤害）
 */
export function onElementDamage(gs, { element, byRoleId, target }) {
  // 风起：我方单位对敌人造成 火/水/雷/冰
  if (['fire', 'water', 'thunder', 'ice'].includes(element)) {
    tryEnqueue(gs, 'skill_link_luyouyou_rise_wind', {
      roleId: 'luyouyou',
      context: { element, targetCreatureId: target ? target.id : null },
    });
  }

  // 汲取：除余默外造成元素伤害
  if (byRoleId && byRoleId !== 'yumo') {
    tryEnqueue(gs, 'skill_link_yumo_drain', {
      roleId: 'yumo',
      context: { element },
    });
  }
}

/**
 * 检测某 creature 是否 burn（炽燃）
 */
function isTargetBurned(creature) {
  if (!creature || !Array.isArray(creature.activeBuffs)) return false;
  return creature.activeBuffs.some(b => b.id === 'burn');
}

/**
 * 检测某 creature 是否 charge（弱点击破）
 */
function isTargetCharging(creature) {
  if (!creature || !Array.isArray(creature.activeBuffs)) return false;
  return creature.activeBuffs.some(b => b.id === 'charge');
}

/**
 * 定时轮询（每秒）：扫描是否有敌人 burn/charge → 入队炽燃 / 弱点击破
 * 这个需要一个定时器；可以挂在 CreatureSystem 的 tick 里，或由 UI LinkSkillUI 每秒 prune 时顺便扫
 */
export function periodicConditionScan(gs) {
  if (!gs?.creatures) return;

  // 炽燃：有敌人 burn
  const hasBurned = gs.creatures.some(c => isTargetBurned(c));
  if (hasBurned) {
    tryEnqueue(gs, 'skill_link_xiayang_scorch', { roleId: 'xiayang' });
  }

  // 弱点击破：有敌人 charge
  const hasCharge = gs.creatures.some(c => isTargetCharging(c));
  if (hasCharge) {
    tryEnqueue(gs, 'skill_link_luyouyou_weak_point', { roleId: 'luyouyou' });
  }
}

/**
 * 触发结算（UI 按 E 触发后调这个）
 * @param {object} gs
 * @param {string} skillId 连携技 id
 * @returns {{ ok: boolean, message?: string }}
 */
export function fireLinkSkill(gs, skillId) {
  const entry = (gs.linkSkillQueue || []).find(e => e.skillId === skillId);
  if (!entry) return { ok: false, message: 'notInQueue' };

  // 移除
  gs.linkSkillQueue = gs.linkSkillQueue.filter(e => e.skillId !== skillId);
  EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId, triggered: true });

  const skill = getSkill(skillId);
  if (!skill) return { ok: false, message: 'skillNotFound' };

  const ctx = entry.context || {};
  const result = resolveLinkSkill(gs, skill, ctx);

  // 冷却：按 gs.turn 存下次可用回合
  if (!gs.linkSkillCooldowns) gs.linkSkillCooldowns = {};
  gs.linkSkillCooldowns[skillId] = gs.turn + (skill.cooldown || 0);

  devLog.info('[LinkSkillSystem] 结算', skill.name, '→', result);
  return { ok: true, result };
}

/**
 * 结算连携技 —— 按 characters.js 里的 triggerCondition / extraEffect
 */
function resolveLinkSkill(gs, skill, ctx) {
  devLog.info('[LinkSkillSystem.resolve]', skill.name, 'ctx=', ctx);
  EventBus.emit(GE.TOAST_SHOW, { text: `💥 连携技：${skill.name}！`, duration: 1500 });

  // 找到 fence 里所有 creature
  const allCreatures = [];
  for (const t of gs.map.fence) {
    for (const cid of (t.creatures || [])) {
      const c = gs.creatures.find(cc => cc.id === cid);
      if (c) allCreatures.push(c);
    }
  }

  switch (skill.id) {
    case 'skill_link_yumo_drain': {
      // 汲取：除余默外造成元素伤害时可用 → 余默下次攻击变该元素
      if (ctx.element) {
        gs.team.yumoNextElementOverride = ctx.element;
        devLog.info('[LinkSkill] 汲取 → 下次攻击元素 =', ctx.element);
      }
      break;
    }

    case 'skill_link_xiayang_scorch': {
      // 炽燃：对 burn 的至多 3 名敌人 70% 火伤 + 挂额外燃烧层；无则 1 名
      const burned = allCreatures.filter(c => isTargetBurned(c));
      const targets = burned.length > 0 ? burned.slice(0, 3) : (allCreatures.length > 0 ? [allCreatures[0]] : []);
      for (const t of targets) {
        dealLinkSkillDamage(gs, skill, t, 'xiayang');
        // 额外挂一个燃烧层（持续 1 回合 —— 已有的话刷新）
        CombatSystem.applyBuff({ buffId: 'burn', target: t, duration: 1 });
      }
      break;
    }

    case 'skill_link_xiayang_annihilate': {
      // 焚灭：计数 -3 或 -7，一段 140% 小范围 / 二段 260% 超大范围
      const tier = ctx.tier || 1;
      const eff = skill.extraEffect || {};
      const multiplier = tier === 2 ? eff.tier2Multiplier : eff.tier1Multiplier;
      const radius = tier === 2 ? eff.tier2Radius : eff.tier1Radius;

      const currentCount = gs.team.xiayangSkillCount || 0;
      const tierCost = tier === 2 ? (eff.countPerTierTwo || 7) : (eff.countPerTierUse || 3);
      gs.team.xiayangSkillCount = Math.max(0, currentCount - tierCost);
      devLog.info('[LinkSkill] 焚灭 tier', tier, 'consume', tierCost, 'remaining', gs.team.xiayangSkillCount);

      // 范围伤害：简化为对所有 creature 造成伤害（用 multiplier）
      for (const c of allCreatures) {
        dealLinkSkillDamage(gs, { ...skill, damageMultiplier: multiplier }, c, 'xiayang');
      }
      // radius 只是视觉，伤害简化按所有目标算
      break;
    }

    case 'skill_link_luyouyou_weak_point': {
      // 弱点击破：敌人蓄力时 70% 物理 + 3 回合虚弱 25% + 本次暴击率 +100%
      const target = allCreatures.find(c => isTargetCharging(c)) || (allCreatures.length > 0 ? allCreatures[0] : null);
      if (target) {
        // 本次暴击率 +100%：简化 —— 强制暴击（伤害 × 1.5）
        const critResult = CombatSystem.calculateDamage({
          atk: gs.player.atk,
          skill: { ...skill, damageMultiplier: skill.damageMultiplier * 1.5 },
          defender: target,
          element: 'physical',
          player: gs.player,
          gs,
          roleId: 'luyouyou',
          attackerRoleId: 'luyouyou',
          _weakPointForceCrit: true,
        });
        CombatSystem.applyBuff({ buffId: 'weakened', target, duration: 3, params: { strength: 0.25 } });
      }
      break;
    }

    case 'skill_link_luyouyou_storm_eye': {
      // 风暴眼：锁定随机 1 名敌人，直线行进对所有碰撞敌人 80% 风伤 + 清空计数
      if (allCreatures.length > 0) {
        const lockTarget = allCreatures[Math.floor(Math.random() * allCreatures.length)];
        for (const c of allCreatures) {
          dealLinkSkillDamage(gs, skill, c, 'luyouyou', { overrideElement: 'wind' });
        }
      }
      // 清空元素累计
      gs.team.dailyElementDamages = [];
      break;
    }

    case 'skill_link_luyouyou_hunt': {
      // 追猎：上一次攻击的目标 → 3 次弹射 20% 物理；允许重复弹射
      let lastTarget = allCreatures.find(c => c.id === ctx.targetCreatureId);
      if (!lastTarget && allCreatures.length > 0) lastTarget = allCreatures[0];
      if (!lastTarget) break;

      let cur = lastTarget;
      for (let i = 0; i < 3; i++) {
        dealLinkSkillDamage(gs, skill, cur, 'luyouyou', { overrideMultiplier: skill.damageMultiplier });
        // 随机弹射到半径 0.3 内 —— 简化：在 allCreatures 里随机一个（含自身）
        if (allCreatures.length > 0) {
          cur = allCreatures[Math.floor(Math.random() * allCreatures.length)];
        }
      }
      // 清空计数
      gs.team.huntAttackCount = 0;
      break;
    }

    case 'skill_link_luyouyou_rise_wind': {
      // 风起：对 1 名敌人 15% 风伤 + 3 回合 30% 易伤
      const target = allCreatures.find(c => c.id === ctx.targetCreatureId) || (allCreatures.length > 0 ? allCreatures[0] : null);
      if (target) {
        dealLinkSkillDamage(gs, skill, target, 'luyouyou', { overrideElement: 'wind' });
        CombatSystem.applyBuff({ buffId: 'vulnerable', target, duration: 3, params: { strength: 0.30 } });
      }
      break;
    }
  }
}

/**
 * 对 creature 造成一次技能伤害（内部 helper）
 */
function dealLinkSkillDamage(gs, skill, target, attackerRoleId, opts = {}) {
  if (!target || target.hp <= 0) return;
  const dmg = CombatSystem.calculateDamage({
    atk: gs.player.atk,
    skill,
    defender: target,
    element: opts.overrideElement || skill.element,
    player: gs.player,
    gs,
    roleId: attackerRoleId,
    attackerRoleId,
  });
  if (target.hp <= 0) {
    // 击败了 —— fire 击败逻辑（TalentSystem.onCreatureDefeated 会 fire 好奇心）
    devLog.info('[LinkSkill] defeated', target.kind);
    EventBus.emit(GE.CREATURE_DEFEATED, { creature: target });
    for (const t of gs.map.fence) {
      t.creatures = (t.creatures || []).filter(cid => cid !== target.id);
    }
    gs.creatures = gs.creatures.filter(c => c.id !== target.id);
    TalentSystem.onCreatureDefeated(gs, target);
  }
  return dmg;
}

/**
 * UI 入口：按 E 时调这个
 */
export function fireCurrentQueueTop(gs) {
  if (!gs.linkSkillQueue || gs.linkSkillQueue.length === 0) return false;
  const top = gs.linkSkillQueue[0];
  return fireLinkSkill(gs, top.skillId);
}

// ── 这些是保留的 stub，提供一致的 API ──
export function enqueueLinkSkill(gs, opts) {
  return tryEnqueue(gs, opts.skillId, opts);
}

export function popLinkSkill(gs, skillId) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return null;
  const idx = gs.linkSkillQueue.findIndex(e => e.skillId === skillId);
  if (idx >= 0) {
    return gs.linkSkillQueue.splice(idx, 1)[0];
  }
  return null;
}

export function pruneExpired(gs) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return 0;
  const now = Date.now();
  gs.linkSkillQueue = gs.linkSkillQueue.filter(e => {
    if (e.expireAtMs < now) {
      EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId: e.skillId, triggered: false });
      devLog.info('[LinkSkillSystem] expired', e.skillId);
      return false;
    }
    return true;
  });
  return 0;
}

export function checkReady(gs, conditionKey) {
  const allLinkSkills = Object.values(getSkillsByRole('yumo').concat(getSkillsByRole('xiayang')).concat(getSkillsByRole('luyouyou'))).filter(s => s.isLinkSkill);
  for (const ls of allLinkSkills) {
    if (ls.triggerCondition === conditionKey) {
      // 简化：直接 tryEnqueue
      tryEnqueue(gs, ls.id, { roleId: ls.roleId });
      return true;
    }
  }
  return false;
}

export function resetAll(gs) {
  if (!gs) return;
  if (Array.isArray(gs.linkSkillQueue)) gs.linkSkillQueue.length = 0;
  gs.lastTurnLinkSkill = 0;
  gs.linkSkillCooldowns = {}; // 冷却清空（新一天重算）
}

export const LinkSkillSystem = {
  // 事件驱动入口
  onSkillFired,
  onElementDamage,
  periodicConditionScan,
  // 结算
  fireLinkSkill,
  fireCurrentQueueTop,
  // 队列 API
  enqueue: enqueueLinkSkill,
  pop: popLinkSkill,
  pruneExpired,
  checkReady,
  resetAll,
};
