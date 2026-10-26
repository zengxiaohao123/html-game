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
    emoji: '🍃',
    element: 'wind',
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

  // ──────────────────────── 夏阳剩余主动技能 ────────────────────────

  skill_xiayang_inspire_lv1: {
    id: 'skill_xiayang_inspire_lv1',
    name: '鼓舞·等级 1',
    emoji: '💪',
    roleId: 'xiayang',
    element: 'physical',
    damageMultiplier: 0,   // 本身不直接造成伤害，只有生命回复 + 攻击力 buff
    hooks: { onEnter: true, onPass: true, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'self_regen_and_buff',
      regenPercentOfAtk: 0.2,   // 回复相当于 20% 攻击力的生命值（经过时触发）
      atkBuffPerDay: 15,         // 本日内攻击力 +15，可叠加（进入时触发）
      // 注意：两个效果的触发词条不同，Phase 3 SkillSystem 需区分 onEnter/onPass 分别执行
    },
    description: '【经过时】【受祝福时】回复相当于 20% 攻击力的生命值。【进入时】【受祝福时】本日内攻击力 +15，可叠加',
  },

  skill_xiayang_all_wishes: {
    id: 'skill_xiayang_all_wishes',
    name: '众愿',
    emoji: '🔥',
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 1.6,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 3,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'damage_modifier_self',
      fireDamageBonus: 0.2,            // 本日内我方火元素伤害 +20%
      othersDamagePenalty: 0.1,        // 其余元素及物理伤害 -10%
      duration: 'permanent_until_day', // 本日内
    },
    description: '【进入时】【受祝福时】本日内我方火元素伤害 +20%，其余元素及物理伤害 -10%。然后对 1 名敌人造成 160% 攻击力火元素伤害。冷却 3 回合',
  },

  skill_xiayang_blast_carnival: {
    id: 'skill_xiayang_blast_carnival',
    name: '爆炸狂欢',
    emoji: '💥',
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 1.5,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 7,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'aoe_radius',
      radius: 1,                       // 半径 1 格大范围
      onBlessedRefreshCooldown: true,  // 【受祝福时】立即刷新冷却
    },
    description: '【进入时】对 1 名敌人造成 150% 攻击力大范围火元素伤害（半径 1 格）。冷却 7 回合。【受祝福时】立即刷新冷却',
  },

  // ──────────────────────── 陆悠悠剩余主动技能 ────────────────────────

  skill_luyouyou_breathe_aim: {
    id: 'skill_luyouyou_breathe_aim',
    name: '屏息瞄准',
    emoji: '🎯',
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0,   // 本身不造成伤害，只给下一次攻击加 buff
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'self_crit_buff',
      critRateBonus: 1.0,   // 下一次攻击暴击率 +100%
      stackable: false,     // 不可叠加
    },
    description: '【进入时】【受祝福时】陆悠悠下一次攻击暴击率 +100%，不可叠加',
  },

  // ──────────────────────── 通用主动技能 ────────────────────────

  skill_zongheng: {
    id: 'skill_zongheng',
    name: '合纵连横',
    emoji: '⚔️',
    roleId: null,   // 通用，不属于任何角色
    element: 'physical',
    damageMultiplier: 1.0,
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: null,    // 行+列所有敌人，不是普通范围
    cooldown: 0,
    isLinkSkill: false,
    targetCategory: 'danger_extreme',
    extraEffect: {
      type: 'line_row_column',
      // 对该地块所在行以及所在列的所有敌人造成伤害
    },
    description: '【进入时】【受祝福时】对该地块所在行以及所在列的所有敌人造成相当于 100% 攻击力的物理伤害',
  },

  // ════════════════════════════════════════════════════════════
  // 连携技（isLinkSkill: true）
  // 不走 onEnter/onPass/onBlessed 自动触发，走实时窗口按键
  // ════════════════════════════════════════════════════════════

  // 余默 连携技
  skill_link_yumo_drain: {
    id: 'skill_link_yumo_drain',
    name: '汲取',
    emoji: '💧',
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 0,   // 本身不造成伤害，只切换下次攻击元素类型
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 3,
    isLinkSkill: true,
    triggerCondition: 'elementDamageDealtByOther', // 除余默外角色造成元素伤害时
    extraEffect: {
      type: 'next_attack_element_switch',
      useSameElementAsTrigger: true,  // 使余默下一次攻击伤害类型变为对应元素
    },
    description: '【连携技】除余默外角色造成元素伤害时可用。使余默下一次攻击伤害类型变为对应元素。冷却：3 回合',
  },

  // 夏阳 连携技
  skill_link_xiayang_scorch: {
    id: 'skill_link_xiayang_scorch',
    name: '炽燃',
    emoji: '🔥',
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 0.7,
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 2,
    isLinkSkill: true,
    triggerCondition: 'enemyHasBurn',  // 有敌人正处于【燃烧】时
    extraEffect: {
      type: 'target_filter',
      maxTargetsWithBurn: 3,           // 对处于【燃烧】的至多 3 名敌人
      fallbackNoTarget: true,           // 若无符合条件目标，改为攻击 1 名敌人
    },
    description: '【连携技】有敌人正处于【燃烧】时可用。对处于【燃烧】的至多 3 名敌人造成 70% 攻击力火元素伤害。若无符合条件目标，改为攻击 1 名敌人。冷却 2 回合',
  },

  skill_link_xiayang_annihilate: {
    id: 'skill_link_xiayang_annihilate',
    name: '焚灭',
    emoji: '🔥',
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 1.4,   // 一段 140%，二段 260%；Phase 3 LinkSkillSystem 实际计算
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 0,   // 这个技能不走冷却，走计数：3 一段 / 7 二段
    isLinkSkill: true,
    triggerCondition: 'skillUseCountReach',  // 每次使用夏阳技能计数 +1
    extraEffect: {
      type: 'count_based',
      countPerTierUse: 3,               // 计数达 3 用一段，计数 -3
      countPerTierTwo: 7,               // 计数达 7 用二段，计数 -7
      tier1Multiplier: 1.4,
      tier1Radius: 0.4,                 // 小范围半径 0.4
      tier2Multiplier: 2.6,
      tier2Radius: 1.5,                 // 超大范围半径 1.5
      clearOnDayStart: true,            // 【每一日开始时】清空计数
    },
    description: '【连携技】每次使用夏阳技能计数 +1。计数达 3 用一段，达 7 用二段。一段：140% 攻击力小范围火伤（半径 0.4），计数 -3。二段：260% 攻击力超大范围火伤（半径 1.5），计数 -7。【每一日开始时】清空计数',
  },

  // 陆悠悠 连携技
  skill_link_luyouyou_weak_point: {
    id: 'skill_link_luyouyou_weak_point',
    name: '弱点击破',
    emoji: '🎯',
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.7,
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 6,
    isLinkSkill: true,
    triggerCondition: 'enemyEnterCharge',  // 敌人进入【蓄力】时
    extraEffect: {
      type: 'apply_buff',
      buffId: 'weakened',
      duration: 3,
      strength: 0.25,
      critRateBonusThisAttack: 1.0,   // 本次攻击暴击率 +100%
      note: '敌人蓄力状态在其技能介绍中说明。',
    },
    description: '【连携技】敌人进入【蓄力】时可用。对该敌人（至多 1 名）造成 70% 攻击力物理伤害，施加持续 3 回合的【虚弱】。本次攻击暴击率 +100%。冷却 6 回合',
  },

  skill_link_luyouyou_storm_eye: {
    id: 'skill_link_luyouyou_storm_eye',
    name: '风暴眼',
    emoji: '🌀',
    roleId: 'luyouyou',
    element: 'wind',
    damageMultiplier: 0.8,
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 5,
    isLinkSkill: true,
    triggerCondition: 'fourElementDamageAccumulated',  // 本日内我方累计造成 4 种及以上元素伤害后
    extraEffect: {
      type: 'line_tornado',
      targetCount: 1,                  // 锁定随机 1 名敌人
      clearCountAfterUse: true,        // 随后清空计数
    },
    description: '【连携技】本日内我方累计造成 4 种及以上元素伤害后可用。锁定随机 1 名敌人，召唤龙卷风沿直线前进，对碰撞到的所有敌人造成 80% 攻击力风元素伤害。随后清空计数。冷却 5 回合',
  },

  skill_link_luyouyou_hunt: {
    id: 'skill_link_luyouyou_hunt',
    name: '追猎',
    emoji: '🏹',
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.2,   // 每次弹射 20%
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 1,
    isLinkSkill: true,
    triggerCondition: 'skillAttackEnemy3Times',  // 我方角色使用技能攻击敌人 3 次后
    extraEffect: {
      type: 'bounce_arrow',
      bounceCount: 3,                  // 弹射 3 次
      bounceRadius: 0.3,               // 每次弹射以当前目标为中心半径 0.3 格内随机 1 名敌人（含目标自身）
      allowRepeat: true,               // 允许重复弹射
      clearCountAfterUse: true,        // 随后清空计数
    },
    description: '【连携技】我方角色使用技能攻击敌人 3 次后可用。以上一次攻击的敌人为目标，发射弹射 3 次的箭矢，每次弹射造成 20% 攻击力物理伤害。随后清空计数。冷却 1 回合。每次弹射以当前目标为中心半径 0.3 格内随机 1 名敌人（含目标自身）为新目标，允许重复弹射。',
  },

  skill_link_luyouyou_rise_wind: {
    id: 'skill_link_luyouyou_rise_wind',
    name: '风起',
    emoji: '🌬️',
    roleId: 'luyouyou',
    element: 'wind',
    damageMultiplier: 0.15,
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 5,
    isLinkSkill: true,
    triggerCondition: 'fire_water_thunder_iceDamageDealt',  // 我方单位对敌人造成火/水/雷/冰元素伤害时
    extraEffect: {
      type: 'apply_buff',
      buffId: 'vulnerable',            // 易伤
      duration: 3,
      strength: 0.30,                  // 30% 易伤
    },
    description: '【连携技】我方单位对敌人造成火 / 水 / 雷 / 冰元素伤害时可用。对该敌人（至多 1 名）造成 15% 攻击力风元素伤害，施加持续 3 回合的 30%【易伤】。冷却 5 回合',
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
