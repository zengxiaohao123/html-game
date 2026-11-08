// src/data/buffs.js
// Phase 3 —— 扩展到完整 6 种 debuff/buff
// 设计文档 §14

/**
 * 每 buff 对象通用形状：
 * { id, name, emoji, type: 'debuff'|'buff', target, description,
 *   strength,       // 虚弱/易伤的百分比值（0.25 = 25%）
 *   duration,       // 默认持续时间（回合计数/天数，不同 buff 计量不同）
 *   phase2AImplemented,
 *   phase3Implemented: true  // Phase 3 生效
 * }
 *
 * activeBuffs[] 实例形状：
 *   { id, targetRef, remainingTurns/remainingDays, params }
 *     targetRef  —— 'player' / { type: 'creature', creatureId } / { type: 'tile', tileIdx }
 */

export const BUFFS = {
  exhausted: {
    id: 'exhausted',
    name: '心力交瘁',
    emoji: '💫',
    type: 'debuff',
    target: 'player',
    description: '行动力 <0 时获得，持续 1 天；\n睡觉固定回复上限一半且所有睡觉增益失效。',
    duration: 1,
    phase2AImplemented: true,
    phase3Implemented: true,
  },

  slime: {
    id: 'slime',
    name: '粘液',
    emoji: '🟢',
    type: 'debuff',
    target: 'player',
    description: '玩家进入该格时生命 -5、行动力 -1，然后移除。',
    duration: 1,
    oneShot: true,
    phase2AImplemented: false,
    phase3Implemented: true,
  },

  burn: {
    id: 'burn',
    name: '燃烧',
    emoji: '🔥',
    type: 'debuff',
    target: 'creature',
    description: '每个回合开始时，该单位流失 3% 生命值（可致死）。',
    duration: 3,   // 默认 3 回合（夏阳引燃单独传 5）
    phase2AImplemented: false,
    phase3Implemented: true,
  },

  weakened: {
    id: 'weakened',
    name: '虚弱',
    emoji: '😵',
    type: 'debuff',
    target: 'creature',
    description: '造成的伤害减少对应百分比。\n同名效果取最高，持续时间独立。',
    strength: 0.30,
    duration: 5,
    phase2AImplemented: false,
    phase3Implemented: true,
  },

  vulnerable: {
    id: 'vulnerable',
    name: '易伤',
    emoji: '💔',
    type: 'debuff',
    target: 'creature',
    description: '受到的伤害增加对应百分比。\n同名效果取最高，持续时间独立。',
    strength: 0.30,
    duration: 3,
    phase2AImplemented: false,
    phase3Implemented: true,
  },

  grumpy: {
    id: 'grumpy',
    name: '暴躁',
    emoji: '😠',
    type: 'buff',
    target: 'player',
    description: '角色攻击力 +25%，持续 1 天，不可叠加。',
    duration: 1,
    phase2AImplemented: false,
    phase3Implemented: true,
  },

  charge: {
    id: 'charge',
    name: '蓄力',
    emoji: '⚡',
    type: 'buff',
    target: 'creature',
    description: '敌人专属状态，具体在敌人技能介绍中说明。',
    duration: 1,
    phase2AImplemented: false,
    phase3Implemented: true,
  },

  // 魔导书《土豆地雷》附带状态：词条字典已定义，此处登记为真实生效的 debuff
  stunned: {
    id: 'stunned',
    name: '晕眩',
    emoji: '🌀',
    type: 'debuff',
    target: 'creature',
    description: '该单位无法行动，持续对应回合数。',
    duration: 1,
    phase2AImplemented: false,
    phase3Implemented: true,
  },
};

export const ALL_BUFF_IDS = Object.keys(BUFFS);

export function getBuff(id) {
  return BUFFS[id] || null;
}
