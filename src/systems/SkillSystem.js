// src/systems/SkillSystem.js
// Phase 4 重构：技能从"角色 team 遍历"改为"地块遍历"
// 核心职责：
//   triggerSkillByHook(hookType, params)
//     遍历所有 outerTiles，找 contentId 为 skill_* 的地块；
//     若 skillDef.hooks[hookType] 为 true + cooldown 通过 → 执行 CombatSystem.calculateDamage。
//     技能持续存在（不消耗 tile.contentId），按 tileIdx + skillId 独立 cooldown。
//     同时 fire HookDispatcher.fire('onUseSkill', ...) 让豌豆架储存豌豆。
//
//   triggerSkillAtTile(tileIdx)  —— 辅助：走到某格时主动触发 onEnter（由 facilities.js 或 UI 调用）
//
// 为什么不注册到 HookDispatcher？
//   HookDispatcher 是词条 hook（设施/资源/祝福/睡觉 等时机），是数据层写死时机；
//   SkillSystem 要额外做：合法目标筛选 + 技能冷却 & cooldown 递减 + 连携技检测。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { getSkill, getSkillsByRole, CHARACTERS, SKILLS } from '../data/characters.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';

/**
 * 每技能的运行时 cooldown：tileIdx + skillId → remainingTurns
 * 改为 GS 持久化（跨回合/跨日不丢失），resetSkillCooldowns 清空
 */

function getCreaturesInFence(gs) {
  const list = [];
  for (const t of gs.map.fence) {
    for (const cid of (t.creatures || [])) {
      const c = gs.creatures.find(cc => cc.id === cid);
      if (c) list.push(c);
    }
  }
  return list;
}

function findLegalTarget(gs, skill, tileIdx) {
  const allCreatures = getCreaturesInFence(gs);
  if (allCreatures.length === 0) return null;

  let pool = allCreatures;
  if (skill.targetCategory === 'danger_extreme') {
    pool = allCreatures.filter(c => c.category === 'danger' || c.category === 'extreme');
  } else if (skill.targetCategory === 'friendly_danger_extreme') {
    pool = allCreatures;
  }
  if (pool.length === 0) return null;

  pool.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
  return pool[0];
}

/**
 * 触发某时机下，**所有 outerTiles 上放置的技能**
 * @param {string} hookType  'onEnter' / 'onPass' / 'onBlessed'
 * @param {{gs: object, tileIdx: number}} params
 */
export function triggerSkillByHook(hookType, params) {
  const { gs } = params || {};
  if (!gs) return;

  gs.skillCooldowns = gs.skillCooldowns || {};
  let anyTriggered = false;

  // 遍历所有 outerTiles 上的技能地块
  for (let i = 0; i < gs.map.outerTiles.length; i++) {
    const tile = gs.map.outerTiles[i];
    if (!tile?.contentId) continue;
    if (!tile.contentId.startsWith('skill_')) continue;

    const skillDef = SKILLS[tile.contentId];
    if (!skillDef) continue;

    // triggerCondition 钩子匹配（用 hooks[hookType] 字段）
    if (!skillDef.hooks || !skillDef.hooks[hookType]) continue;

    // cooldown 检查：按 tileIdx + skillId 独立
    const cdKey = `skill_${skillDef.id}_${i}`;
    if (gs.skillCooldowns[cdKey] && gs.skillCooldowns[cdKey] > 0) continue;

    // 连携技不走普通 hook 触发（它们是实时窗口按键触发的）
    if (skillDef.isLinkSkill) continue;

    // 找目标
    const target = findLegalTarget(gs, skillDef, i);
    if (!target) continue;

    // 触发！
    anyTriggered = true;
    fireOneSkill(gs, skillDef, target, cdKey);
  }

  if (anyTriggered) {
    HookDispatcher.fire('onUseSkill', { gs });
  }
}

function fireOneSkill(gs, skill, target, cdKey) {
  const roleDef = CHARACTERS[skill.roleId];
  devLog.info('[SkillSystem] fire', skill.name, '→', target.kind, '(hp', target.hp, '/', target.maxHp, ')');
  EventBus.emit(GE.SKILL_TRIGGERED, { skillId: skill.id, roleId: skill.roleId, targetKind: target.kind });

  const hits = skill.hits || 1;
  for (let h = 0; h < hits; h++) {
    const result = CombatSystem.calculateDamage({
      atk: gs.player.atk,
      skill,
      defender: target,
      element: skill.element,
      realDamage: !!skill.realDamage,
      player: gs.player,
      gs,
      roleId: skill.roleId,
      attackerRoleId: skill.roleId,
    });
    if (result.immune) break;
  }

  applySkillExtraEffects(gs, skill, target);

  // 设置 cooldown（如果 skill 有 cooldown 字段，按 tile + skill 独立）
  if (cdKey && skill.cooldown && skill.cooldown > 0) {
    gs.skillCooldowns = gs.skillCooldowns || {};
    gs.skillCooldowns[cdKey] = skill.cooldown;
  }

  if (target.hp <= 0) {
    defeatCreature(gs, target);
  }

  if (!skill.isLinkSkill) {
    LinkSkillSystem.onSkillFired(gs, { roleId: skill.roleId, skillId: skill.id, skill, target });
  }
}

function applySkillExtraEffects(gs, skill, target) {
  const eff = skill.extraEffect;
  if (!eff) return;

  switch (eff.type) {
    case 'self_hp_drain': {
      const loss = Math.max(1, Math.floor(gs.player.hp * eff.percent));
      gs.player.hp -= loss;
      if (gs.player.hp < 0) gs.player.hp = 0;
      EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: -loss, source: skill.id });
      devLog.info('[SkillSystem]', skill.name, 'self drain', loss, '→ hp', gs.player.hp);
      break;
    }
    case 'apply_buff': {
      CombatSystem.applyBuff({
        buffId: eff.buffId,
        target,
        duration: eff.duration,
        params: { strength: eff.strength },
      });
      break;
    }
    case 'pioneer_multiplier': {
      break;
    }
  }
}

function defeatCreature(gs, target) {
  devLog.info('[SkillSystem] creature defeated:', target.kind);
  EventBus.emit(GE.CREATURE_DEFEATED, { creature: target });
  EventBus.emit(GE.TOAST_SHOW, { text: `✓ 击败 ${target.name || target.kind}`, duration: 1500 });

  for (const t of gs.map.fence) {
    t.creatures = (t.creatures || []).filter(cid => cid !== target.id);
  }
  gs.creatures = gs.creatures.filter(c => c.id !== target.id);

  HookDispatcher.fire('onCreatureDefeated', { gs, creature: target });
  TalentSystem.onCreatureDefeated(gs, target);
}

/**
 * 主动触发某格的所有技能（外部辅助：UI 手动触发）
 */
export function triggerSkillAtTile(gs, tileIdx) {
  triggerSkillByHook('onEnter', { gs, tileIdx });
}

/**
 * 推进回合后，递减所有技能 cooldown（GameDirector 上层调用 TurnSystem 后再调这个）
 */
export function advanceSkillCooldowns(gs) {
  if (!gs.skillCooldowns) return;
  for (const key of Object.keys(gs.skillCooldowns)) {
    if (gs.skillCooldowns[key] > 0) {
      gs.skillCooldowns[key] -= 1;
    } else {
      delete gs.skillCooldowns[key];
    }
  }
}

/**
 * 清除所有技能 cooldown（新一天重置）
 */
export function resetSkillCooldowns(gs) {
  if (gs) gs.skillCooldowns = {};
}

/** 辅助：按 id 取技能（UI 层用） */
export function getSkillById(id) {
  return SKILLS[id] || null;
}

export const SkillSystem = {
  triggerSkillByHook,
  triggerSkillAtTile,
  advanceSkillCooldowns,
  resetSkillCooldowns,
  getSkillById,
};
