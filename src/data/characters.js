// src/data/characters.js
// Phase 3 —— 3 角色 + 3 精灵 + 技能定义
// 设计文档 §12

// ════════════════════════════════════════════════════════════════
// 精灵定义（每角色 1 个，只影响祈福）
// ════════════════════════════════════════════════════════════════
export const SPIRITS = {
  momo:    { id: 'momo',    name: 'momo',    emoji: '👻', ownerRoleId: 'yumo' },
  qingfeng: { id: 'qingfeng', name: '晴风', emoji: '🌬️', ownerRoleId: 'xiayang' },
  yuyuan:  { id: 'yuyuan',  name: '芋圆',    emoji: '🍡', ownerRoleId: 'luyouyou' },
};

// ════════════════════════════════════════════════════════════════
// 角色定义
// ════════════════════════════════════════════════════════════════
export const CHARACTERS = {
  yumo: {
    id: 'yumo',
    name: '余默',
    emoji: '🧑‍🎤',
    element: 'physical',
    spiritId: 'momo',
    isMainChar: true,
  },
  xiayang: {
    id: 'xiayang',
    name: '夏阳',
    emoji: '🔥',
    element: 'fire',
    spiritId: 'qingfeng',
    isMainChar: false,
  },
  luyouyou: {
    id: 'luyouyou',
    name: '陆悠悠',
    emoji: '💧',
    element: 'water',
    spiritId: 'yuyuan',
    isMainChar: false,
  },
};

export function getCharacterDef(id) {
  return CHARACTERS[id] || null;
}

// ════════════════════════════════════════════════════════════════
// 技能定义（核心技能 —— 设计文档原文）
// 数据层：
//   hooks: 该技能注册到 SkillSystem 的触发类型
//     { onEnter: true, onPass: false, onBlessed: true }
//   cooldown: 冷却回合（-1 = 不受豌豆架每 2 回合限次影响，0 = 每次都能触发）
//   range: 目标范围（1 = 同栅格 / 同一 fence tile 内）
//   targetCategory: 'danger' / 'extreme' / 'friendly_danger_extreme'（默认不攻击友善）
//   description: 玩家可见描述
// ════════════════════════════════════════════════════════════════

/**
 * 技能对象通用形状：
 * {
 *   id, name, emoji, roleId, element, damageMultiplier,
 *   hooks, range, cooldown, isLinkSkill, realDamage,
 *   targetCategory, extraEffect, description
 * }
 *
 *   hooks.onEnter  时：SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx }) 会遍历
 *     team 里 activeGroup 的所有角色的所有技能；若 tileIdx 对应的 fence tile 里有危险生物
 *     则对其触发 CombatSystem.calculateDamage
 */
export const SKILLS = {
  // ──────────────────────── 余默 yumo ────────────────────────
  skill_yumo_slash: {
    id: 'skill_yumo_slash',
    name: '斩击',
    emoji: '⚔️',
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 1.0,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    description: '【进入时】【受祝福时】对 1 名敌人造成 100% 攻击力物理伤害',
  },
  skill_yumo_desperate: {
    id: 'skill_yumo_desperate',
    name: '拼命',
    emoji: '💢',
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 1.6,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 2,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'self_hp_drain',
      percent: 0.08,   // 8% 生命流失，可致死（设计文档：流失 8% 生命值）
    },
    description: '【进入时】【受祝福时】对敌人造成 160% 攻击力物理伤害；流失 8% 生命值（可致死）',
  },
  skill_yumo_pioneer: {
    id: 'skill_yumo_pioneer',
    name: '开拓',
    emoji: '⛏️',
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 0.6,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 3,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'pioneer_multiplier',
      perConsumeMultiplier: 0.7,   // 每消耗 1 块地形 +70%（Phase 3 简化：不真的消耗地形，直接按 1 块算 +70%）
      consumeCount: 1,
    },
    description: '【进入时】【受祝福时】对敌人造成 60% 攻击力物理伤害（小范围）；若地块有资源内容则消耗额外地形提升倍率',
  },

  // ──────────────────────── 夏阳 xiayang ────────────────────────
  skill_xiayang_flame_strike: {
    id: 'skill_xiayang_flame_strike',
    name: '淬火',
    emoji: '🔥',
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 0.8,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'apply_buff',
      buffId: 'burn',
      duration: 1,   // 持续 1 回合（设计文档：持续 1 回合）
    },
    description: '【进入时】【受祝福时】对敌人造成 80% 攻击力火元素伤害，并施加持续 1 回合【燃烧】',
  },
  skill_xiayang_ignite: {
    id: 'skill_xiayang_ignite',
    name: '引燃',
    emoji: '🟧',
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 0,   // 引燃本身不直接造成伤害，只施加燃烧
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    applyBuffOnly: true,
    extraEffect: {
      type: 'apply_buff',
      buffId: 'burn',
      duration: 5,
    },
    description: '【进入时】对敌人施加持续 5 回合【燃烧】',
  },

  // ──────────────────────── 陆悠悠 luyouyou ────────────────────────
  skill_luyouyou_careful_shot: {
    id: 'skill_luyouyou_careful_shot',
    name: '精巧射击',
    emoji: '🎯',
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.5,   // 2 段 × 50% = 每段 0.5×
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    hits: 2,
    description: '【进入时】【受祝福时】对 1 名敌人造成 2 段 50% 攻击力物理伤害',
  },
  skill_luyouyou_wind_stop: {
    id: 'skill_luyouyou_wind_stop',
    name: '风止',
    emoji: '🌬️',
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.8,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 4,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'apply_buff',
      buffId: 'weakened',
      duration: 1,
      strength: 0.25,   // 25% 虚弱
    },
    description: '【进入时】【受祝福时】对随机敌人造成 80% 攻击力物理伤害，施加持续 1 回合 25%【虚弱】',
  },
};

export const ALL_SKILL_IDS = Object.keys(SKILLS);

export function getSkill(id) {
  return SKILLS[id] || null;
}

// 方便 SkillSystem 按 roleId 查找技能
export function getSkillsByRole(roleId) {
  return Object.values(SKILLS).filter(s => s.roleId === roleId);
}
