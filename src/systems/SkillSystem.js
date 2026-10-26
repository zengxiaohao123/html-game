// src/systems/SkillSystem.js
// Phase 3 —— 技能触发入口
// 核心职责：
//   triggerSkillByHook(hookType, params)
//     遍历 team.activeGroup 里所有角色的所有技能，找 hooks[hookType] === true 的；
//     用 findLegalTarget 找目标；调 CombatSystem.calculateDamage；emit SKILL_TRIGGERED。
//     同时 fire HookDispatcher.fire('onUseSkill', ...) 让豌豆架储存豌豆。
//   triggerSkillAtTile(tileIdx)  —— 辅助：走到某格时主动触发 onEnter
//
// 为什么不用 HookDispatcher 直接注册技能？
//   HookDispatcher 是词条 hook（设施/资源/祝福/睡觉 等时机），是数据层写死时机；
//   SkillSystem 要额外做：
//     1) 过滤当前 team（只对编队角色生效）
//     2) 合法目标筛选（找生物）
//     3) 技能冷却 & cooldown 递减
//   所以技能不注册到 HookDispatcher，而是 SkillSystem 统一按 hook 时机 fire。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { getSkill, getSkillsByRole, CHARACTERS } from '../data/characters.js';
import { CombatSystem } from './CombatSystem.js';

// 每技能的运行时 cooldown（回合数）：skillId → remainingTurns
// GS 本身不持久化 cooldown（每次从 max 重启也 OK；Phase 3 简化为内存）
const skillCooldown = new Map();

/**
 * 触发类型映射到"我能攻击的 fence tile"筛选逻辑：
//   'onEnter' / 'onPass' → 当前玩家所在 tileIdx 对应哪块 fence tile？
//     Phase 3 简化：onEnter 表示玩家进入某外圈格；外圈 8 格 与 中心 1×1 fence
//     不在同一坐标空间 —— 但设计文档 §13 说"默认离 tile 最近的敌人"。
//     初始 1×1 fence，所以默认直接攻击 fence[0] 里的所有 danger 生物。
//     扩图后再做邻居/距离计算。
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

/**
 * 找合法目标：默认不打友善；取离 tileIdx 最近（Phase 3 简化：离"中心"最近 = 直接列第 1 只 danger）
 */
function findLegalTarget(gs, skill, tileIdx) {
  const allCreatures = getCreaturesInFence(gs);
  if (allCreatures.length === 0) return null;

  // targetCategory: 'danger_extreme' → 只打危险/极度危险
  let pool = allCreatures;
  if (skill.targetCategory === 'danger_extreme') {
    pool = allCreatures.filter(c => c.category === 'danger' || c.category === 'extreme');
  } else if (skill.targetCategory === 'friendly_danger_extreme') {
    pool = allCreatures;
  }
  if (pool.length === 0) return null;

  // 简化：取 hp 最低的一只（方便快速击杀）
  pool.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
  return pool[0];
}

/**
 * 触发某时机下的所有角色技能
 * @param {string} hookType  'onEnter' / 'onPass' / 'onBlessed'
 * @param {{gs: object, tileIdx: number}} params
 */
export function triggerSkillByHook(hookType, params) {
  const { gs, tileIdx } = params || {};
  if (!gs) return;

  const activeGroup = gs.team?.activeGroup ?? 0;
  const group = gs.team?.groups?.[activeGroup];
  if (!group) return;

  const rolesInTeam = group.roles || [];
  let anyTriggered = false;

  // 每个角色的所有技能依次检查
  for (const roleId of rolesInTeam) {
    const roleDef = CHARACTERS[roleId];
    if (!roleDef) continue;
    const skills = getSkillsByRole(roleId);
    for (const skill of skills) {
      if (!skill.hooks || !skill.hooks[hookType]) continue;

      // 冷却检查
      const cd = skillCooldown.get(skill.id) || 0;
      if (cd > 0) continue;

      // 找目标
      const target = findLegalTarget(gs, skill, tileIdx);
      if (!target) continue;

      // 触发！
      anyTriggered = true;
      fireOneSkill(gs, roleDef, skill, target);
    }
  }

  if (anyTriggered) {
    // 让豌豆架储存豌豆（豌豆架只关心"有技能被用"，不关心目标）
    HookDispatcher.fire('onUseSkill', { gs, tileIdx });
  }
}

function fireOneSkill(gs, roleDef, skill, target) {
  devLog.info('[SkillSystem] fire', skill.name, '→', target.kind, '(hp', target.hp, '/', target.maxHp, ')');
  EventBus.emit(GE.SKILL_TRIGGERED, { skillId: skill.id, roleId: roleDef.id, targetKind: target.kind });

  // 多段（精巧射击 hits=2）
  const hits = skill.hits || 1;
  for (let h = 0; h < hits; h++) {
    const result = CombatSystem.calculateDamage({
      atk: gs.player.atk,
      skill,
      defender: target,
      element: skill.element,
      realDamage: !!skill.realDamage,
      player: gs.player,
    });
    if (result.immune) {
      // 免疫就停，不再继续后续 hit
      break;
    }
  }

  // 额外效果
  applySkillExtraEffects(gs, skill, target);

  // 冷却
  if (skill.cooldown && skill.cooldown > 0) {
    skillCooldown.set(skill.id, skill.cooldown);
  }

  // 击败判定
  if (target.hp <= 0) {
    defeatCreature(gs, target);
  }
}

function applySkillExtraEffects(gs, skill, target) {
  const eff = skill.extraEffect;
  if (!eff) return;

  switch (eff.type) {
    case 'self_hp_drain': {
      // 拼命：流失 8% hp，可致死
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
      // Phase 3 简化：开拓技能已在 damageMultiplier 体现了 0.6×；
      // 设计文档的 "每消耗 1 块 +70%" 先不做真实地形消耗
      break;
    }
  }
}

function defeatCreature(gs, target) {
  devLog.info('[SkillSystem] creature defeated:', target.kind);
  EventBus.emit(GE.CREATURE_DEFEATED, { creature: target });
  EventBus.emit(GE.TOAST_SHOW, { text: `✓ 击败 ${target.name || target.kind}`, duration: 1500 });

  // 从 fence tile 和 gs.creatures 里移除
  for (const t of gs.map.fence) {
    t.creatures = (t.creatures || []).filter(cid => cid !== target.id);
  }
  gs.creatures = gs.creatures.filter(c => c.id !== target.id);

  // HookDispatcher.fire('onCreatureDefeated', { gs, creature: target }) —— Phase 4 用
  HookDispatcher.fire('onCreatureDefeated', { gs, creature: target });
}

/**
 * 主动触发某格的所有技能（外部辅助）
 */
export function triggerSkillAtTile(gs, tileIdx) {
  triggerSkillByHook('onEnter', { gs, tileIdx });
}

/**
 * 推进回合后，递减所有技能 cooldown（GameDirector 上层调用 TurnSystem 后再调这个）
 */
export function advanceSkillCooldowns(gs) {
  for (const [skillId, remaining] of skillCooldown.entries()) {
    if (remaining > 0) {
      skillCooldown.set(skillId, remaining - 1);
    } else {
      skillCooldown.delete(skillId);
    }
  }
}

/**
 * 清除所有技能 cooldown（新一天重置）
 */
export function resetSkillCooldowns() {
  skillCooldown.clear();
}

export const SkillSystem = {
  triggerSkillByHook,
  triggerSkillAtTile,
  advanceSkillCooldowns,
  resetSkillCooldowns,
};
