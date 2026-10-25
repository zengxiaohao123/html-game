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
    description: '睡觉时固定回一半，所有睡觉增益失效',
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
    description: '【进入时】hp -5 stamina -1，然后移除（一次性）',
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
    description: '每回合开始流失 3% hp，可致死',
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
    description: '造成伤害 -30%（strength 可配置）',
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
    description: '受到伤害 +30%（strength 可配置）',
    strength: 0.30,
    duration: 3,
    phase2AImplemented: false,
    phase3Implemented: true,
  },

  charge: {
    id: 'charge',
    name: '蓄力',
    emoji: '⚡',
    type: 'buff',
    target: 'creature',
    description: '下一次攻击伤害 ×2（敌人专属）',
    duration: 1,
    phase2AImplemented: false,
    phase3Implemented: true,
  },
};

export const ALL_BUFF_IDS = Object.keys(BUFFS);

export function getBuff(id) {
  return BUFFS[id] || null;
}
