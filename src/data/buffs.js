// src/data/buffs.js
// 6 种 debuff / buff 定义
// Phase 2A：定义数据结构 + 心力交瘁（TurnSystem 已挂，SleepSystem 已处理，这里只做静态表）
// Phase 3：实现粘液/燃烧/虚弱/易伤/蓄力 的战斗触发逻辑
//
// 心力交瘁：stamina < 0 时 TurnSystem 自动挂；SleepSystem 睡觉时固定回一半、
// 所有睡觉增益失效。此处登记数据以便 UI 显示。

/**
 * 状态表
 * type: 'debuff' / 'buff'
 * target: 'player' / 'enemy' / 'creature' / 'tile'
 * params: 效果参数（Phase 3 战斗里用）
 */
export const BUFFS = {
  exhausted: {
    id: 'exhausted',
    name: '心力交瘁',
    emoji: '💫',
    type: 'debuff',
    target: 'player',
    description: '睡觉时固定回一半，所有睡觉增益失效',
    phase2AImplemented: true,
  },
  slime: {
    id: 'slime',
    name: '粘液',
    emoji: '🟢',
    type: 'debuff',
    target: 'player',
    description: '【进入时】hp -5 stamina -1，然后移除',
    phase2AImplemented: false,
  },
  burn: {
    id: 'burn',
    name: '燃烧',
    emoji: '🔥',
    type: 'debuff',
    target: 'enemy',
    description: '每回合开始流失 3% hp，可致死',
    phase2AImplemented: false,
  },
  weakened: {
    id: 'weakened',
    name: '虚弱',
    emoji: '😵',
    type: 'debuff',
    target: 'enemy',
    description: '造成伤害 -30%（可叠加，但伤害最低 1）',
    phase2AImplemented: false,
  },
  vulnerable: {
    id: 'vulnerable',
    name: '易伤',
    emoji: '💔',
    type: 'debuff',
    target: 'enemy',
    description: '受到伤害 +50%',
    phase2AImplemented: false,
  },
  charge: {
    id: 'charge',
    name: '蓄力',
    emoji: '⚡',
    type: 'buff',
    target: 'enemy',
    description: '下一次攻击伤害 ×2（敌人专属）',
    phase2AImplemented: false,
  },
};

export const ALL_BUFF_IDS = Object.keys(BUFFS);
