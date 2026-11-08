// src/data/characters.js
// Phase 3 —— 3 角色 + 3 精灵 + 技能定义
// 设计文档 §12

import { ITEMS } from './items.js';

// ════════════════════════════════════════════════════════════════
// 精灵定义（每角色 1 个，只影响祈福）
//   description: 玩家可见正文（设计文档 §12.2 逐字）
//   note:        内部备注，任何渲染层都不得读取
// ════════════════════════════════════════════════════════════════
export const SPIRITS = {
  momo: {
    id: 'momo', name: 'momo', emoji: '🐱', ownerRoleId: 'yumo',
    description: '每一日的首次祈福所需的行动力和金币各 -50%（至少 -1，最低减至 0）。',
    note: '如果本日首次祈福时所用精灵不是 momo，然后再编辑队伍换成 momo，则该效果无法生效。',
  },
  qingfeng: {
    id: 'qingfeng', name: '晴风', emoji: '🍃', ownerRoleId: 'xiayang',
    description: '每次祈福后为角色回复 6 点生命值，并使本日内角色攻击力 +8%。',
    note: '攻击力加成可叠加。即使后续切换精灵，本日内效果仍然存在。',
  },
  yuyuan: {
    id: 'yuyuan', name: '芋圆', emoji: '🧋', ownerRoleId: 'luyouyou',
    description: '每次祈福后，本日内的下一次移动不消耗行动力。',
    note: '次数不可叠加，最多就是下一次，不能是下两次，且仅限本日内。多种"不消耗行动力"效果叠加时，只会使行动力消耗变为 0，而不是增加行动力，需要和"行动力 +1"之类的效果区分。',
  },
};

// ════════════════════════════════════════════════════════════════
// 角色定义
// ════════════════════════════════════════════════════════════════
export const CHARACTERS = {
  yumo: {
    id: 'yumo',
    name: '余默',
    emoji: '🧑‍🎤',
    icon: 'assets/images/characters/hero.png',
    element: 'physical',
    spiritId: 'momo',
    isMainChar: true,
  },
  xiayang: {
    id: 'xiayang',
    name: '夏阳',
    emoji: '🔥',
    icon: null,
    element: 'fire',
    spiritId: 'qingfeng',
    isMainChar: false,
  },
  luyouyou: {
    id: 'luyouyou',
    name: '陆悠悠',
    emoji: '🍃',
    icon: null,
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
//   targetSide: 'enemy'（默认，只选阵营合法目标）/ 'self' / 'ally'（我方共用实体）
//     阵营合法性见 data/factions.js：我方 → 危险 / 高危；友善生物永不被默认选中。
//   ignoreFaction: true = 【不分敌我】词条（当前技能库 0 条；出现时跳过阵营过滤）
//   description: 玩家可见描述
// ════════════════════════════════════════════════════════════════

/**
 * 技能对象通用形状：
 * {
 *   id, name, emoji, roleId, element, damageMultiplier,
 *   hooks, range, cooldown, isLinkSkill, realDamage,
 *   targetSide, ignoreFaction, extraEffect, description
 * }
 *
 * 伤害类型口径：未特殊说明的一律为常规伤害；元素未说明则默认物理。
 * 真实伤害必须在技能描述中明确写出（当前技能库无真实伤害技能）。
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
    icon: null,
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 1.0,
    // §2.8：对 1 名敌人 → target 流（默认取最近存活敌人）
    judgeMode: 'target',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetSide: 'enemy',
    description: ITEMS.skill_yumo_slash.description,
  },
  skill_yumo_desperate: {
    id: 'skill_yumo_desperate',
    name: '拼命',
    emoji: '💢',
    icon: null,
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 1.6,
    // §2.8：对 2 名敌人 → target 流（最近 2 名，targetSelection='nearest'）
    judgeMode: 'target',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 2,
    isLinkSkill: false,
    targetSide: 'enemy',
    targetCount: 2,               // SKL-A-002：对 2 个敌人
    targetSelection: 'nearest',   // 取最近的 2 名
    extraEffect: {
      type: 'self_hp_drain',
      percent: 0.08,   // 8% 生命流失，可致死（设计文档：流失 8% 生命值）
    },
    description: ITEMS.skill_yumo_desperate.description,
  },
  skill_yumo_pioneer: {
    id: 'skill_yumo_pioneer',
    name: '开拓',
    emoji: '⛏️',
    icon: null,
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 0.6,
    // §2.8：混合型（先选 1 名再小范围）→ tile 流，锚点 = 目标连续中心
    // 半径 0.3 米（1 格边长 = 1 米）：与生物碰撞圆重叠即命中
    judgeMode: 'tile',
    anchor: 'target',
    areaShape: 'circle',
    areaRadius: 0.3,         // 单位：米
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 3,
    isLinkSkill: false,
    targetSide: 'enemy',
    extraEffect: {
      type: 'pioneer_multiplier',
      perConsumeMultiplier: 0.7,   // 每消耗 1 块有地形的地块，本次攻击倍率 +70%（物品库 SKL-A-003）
      consumeCount: 2,             // 攻击前随机消耗 2 块有地形的地块（变为无地形）
    },
    description: ITEMS.skill_yumo_pioneer.description,
  },

  // ──────────────────────── 夏阳 xiayang ────────────────────────
  skill_xiayang_flame_strike: {
    id: 'skill_xiayang_flame_strike',
    name: '淬火',
    emoji: '🔥',
    icon: null,
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 0.8,
    // §2.8：对 1 名敌人 → target 流
    judgeMode: 'target',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetSide: 'enemy',
    extraEffect: {
      type: 'apply_buff',
      buffId: 'burn',
      duration: 1,   // 持续 1 回合（设计文档：持续 1 回合）
    },
    description: ITEMS.skill_xiayang_flame_strike.description,
  },
  skill_xiayang_ignite: {
    id: 'skill_xiayang_ignite',
    name: '引燃',
    emoji: '🟧',
    icon: null,
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 0,   // 引燃本身不直接造成伤害，只施加燃烧
    // §2.8：对 1 名敌人施加燃烧 → target 流（受祝福时另选"随机 1 名燃烧敌人"，仍属 target 流）
    judgeMode: 'target',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetSide: 'enemy',
    applyBuffOnly: true,
    extraEffect: {
      type: 'apply_buff',
      buffId: 'burn',
      duration: 5,
      enterOnly: true,             // 【进入时】施加燃烧（物品库 SKL-A-006）
      onBlessedDoubleBurn: true,   // 【受祝福时】随机 1 名正处于燃烧状态的敌人，其燃烧剩余回合翻倍
    },
    description: ITEMS.skill_xiayang_ignite.description,
  },

  // ──────────────────────── 陆悠悠 luyouyou ────────────────────────
  skill_luyouyou_careful_shot: {
    id: 'skill_luyouyou_careful_shot',
    name: '精巧射击',
    emoji: '🎯',
    icon: null,
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.5,   // 2 段 × 50% = 每段 0.5×
    // §2.8：对 1 名敌人 2 段 → target 流；hits 在单次应用内循环，禁止按格放大
    judgeMode: 'target',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    targetSide: 'enemy',
    hits: 2,
    description: ITEMS.skill_luyouyou_careful_shot.description,
  },
  skill_luyouyou_wind_stop: {
    id: 'skill_luyouyou_wind_stop',
    name: '风止',
    emoji: '🌬️',
    icon: null,
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.8,
    // §2.8：随机 2 名敌人 → target 流（targetSelection='random'，不放回）
    judgeMode: 'target',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 4,
    isLinkSkill: false,
    targetSide: 'enemy',
    targetCount: 2,              // SKL-A-011：对 2 个随机敌人
    targetSelection: 'random',   // 不放回随机 2 名
    extraEffect: {
      type: 'apply_buff',
      buffId: 'weakened',
      duration: 1,
      strength: 0.25,   // 25% 虚弱
    },
    description: ITEMS.skill_luyouyou_wind_stop.description,
  },

  // ──────────────────────── 夏阳剩余主动技能 ────────────────────────

  skill_xiayang_inspire_lv1: {
    id: 'skill_xiayang_inspire_lv1',
    name: '鼓舞・等级 1',
    emoji: '💪',
    icon: null,
    roleId: 'xiayang',
    element: 'physical',
    damageMultiplier: 0,   // 本身不直接造成伤害，只有生命回复 + 攻击力 buff
    // §2.8：自身 buff + 回血，无敌人目标 → target 流（targetSide = self）
    judgeMode: 'target',
    targetSide: 'self',
    hooks: { onEnter: true, onPass: true, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    extraEffect: {
      type: 'self_regen_and_buff',
      regenPercentOfAtk: 0.2,   // 回复相当于 20% 攻击力的生命值（经过时触发）
      atkBuffPerDay: 15,         // 本日内攻击力 +15，可叠加（进入时触发）
      // 注意：两个效果的触发词条不同，Phase 3 SkillSystem 需区分 onEnter/onPass 分别执行
    },
    description: ITEMS.skill_xiayang_inspire_lv1.description,
  },

  skill_xiayang_all_wishes: {
    id: 'skill_xiayang_all_wishes',
    name: '众愿',
    emoji: '🔥',
    icon: null,
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 1.6,
    // §2.8：对 1 名敌人 160% → target 流
    judgeMode: 'target',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 3,
    isLinkSkill: false,
    targetSide: 'enemy',
    extraEffect: {
      type: 'damage_modifier_self',
      fireDamageBonus: 0.2,            // 本日内我方火元素伤害 +20%
      othersDamagePenalty: 0.1,        // 其余元素及物理伤害 -10%
      duration: 'permanent_until_day', // 本日内
    },
    description: ITEMS.skill_xiayang_all_wishes.description,
  },

  skill_xiayang_blast_carnival: {
    id: 'skill_xiayang_blast_carnival',
    name: '爆炸狂欢',
    emoji: '💥',
    icon: null,
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 1.5,
    // §2.8：混合型（先选 1 名再小范围）→ tile 流，锚点 = 目标连续中心
    // 半径 1 米（1 格边长 = 1 米）：圆形范围，与生物碰撞圆重叠即命中（不绑定地块枚举）
    judgeMode: 'tile',
    anchor: 'target',
    areaShape: 'circle',
    areaRadius: 1,           // 单位：米
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 7,
    isLinkSkill: false,
    targetSide: 'enemy',
    onBlessedRefreshCooldown: true,  // 【受祝福时】只立即刷新冷却，不再结算/不造成伤害（SkillSystem 读取）
    description: ITEMS.skill_xiayang_blast_carnival.description,
  },

  // ──────────────────────── 陆悠悠剩余主动技能 ────────────────────────

  skill_luyouyou_breathe_aim: {
    id: 'skill_luyouyou_breathe_aim',
    name: '屏息瞄准',
    emoji: '🎯',
    icon: null,
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0,   // 本身不造成伤害，只给下一次攻击加 buff
    // §2.8：自身暴击 buff，无敌人目标 → target 流（targetSide = self）
    judgeMode: 'target',
    targetSide: 'self',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: 1,
    cooldown: 0,
    isLinkSkill: false,
    extraEffect: {
      type: 'self_crit_buff',
      critRateBonus: 1.0,   // 下一次攻击暴击率 +100%
      stackable: false,     // 不可叠加
    },
    description: ITEMS.skill_luyouyou_breathe_aim.description,
  },

  // ──────────────────────── 通用主动技能 ────────────────────────

  skill_zongheng: {
    id: 'skill_zongheng',
    name: '合纵连横',
    emoji: '⚔️',
    icon: null,
    roleId: null,   // 通用，不属于任何角色
    element: 'physical',
    damageMultiplier: 1.0,
    // §2.8：行+列所有敌人 → tile 流，锚点 = 技能所在格，形状 rowColumn
    judgeMode: 'tile',
    anchor: 'skillTile',
    areaShape: 'rowColumn',
    hooks: { onEnter: true, onPass: false, onBlessed: true },
    range: null,    // 行+列所有敌人，不是普通范围
    cooldown: 0,
    isLinkSkill: false,
    targetSide: 'enemy',
    description: ITEMS.skill_zongheng.description,
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
    icon: null,
    roleId: 'yumo',
    element: 'physical',
    damageMultiplier: 0,   // 本身不造成伤害，只切换下次攻击元素类型
    // §2.8：自身效果，无敌人目标 → target 流（targetSide = self）
    judgeMode: 'target',
    targetSide: 'self',
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 3,
    isLinkSkill: true,
    triggerCondition: 'elementDamageDealtByOther', // 除余默外角色造成元素伤害时
    extraEffect: {
      type: 'next_attack_element_switch',
      useSameElementAsTrigger: true,  // 使余默下一次攻击伤害类型变为对应元素
    },
    description: ITEMS.skill_link_yumo_drain.description,
  },

  // 夏阳 连携技
  skill_link_xiayang_scorch: {
    id: 'skill_link_xiayang_scorch',
    name: '炽燃',
    emoji: '🔥',
    icon: null,
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 0.7,
    // §2.8：燃烧集合内最近 3 名 → target 流（条件集合，集合先定后排序）
    judgeMode: 'target',
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
    description: ITEMS.skill_link_xiayang_scorch.description,
  },

  skill_link_xiayang_annihilate: {
    id: 'skill_link_xiayang_annihilate',
    name: '焚灭',
    emoji: '🔥',
    icon: null,
    roleId: 'xiayang',
    element: 'fire',
    damageMultiplier: 1.4,   // 一段 140%，二段 260%；Phase 3 LinkSkillSystem 实际计算
    // §2.8：锚点=目标中心，circle 0.4 / 1.5（按计数档位取 extraEffect 的 tier 半径）
    judgeMode: 'tile',
    anchor: 'target',
    areaShape: 'circle',
    areaRadius: 1.5,         // 声明上限；运行时按档位用 tier1Radius / tier2Radius
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
      tier1Radius: 0.4,                 // 小范围半径 0.4 米
      tier2Multiplier: 2.6,
      tier2Radius: 1.5,                 // 超大范围半径 1.5 米
      clearOnDayStart: true,            // 【每一日开始时】清空计数
    },
    description: ITEMS.skill_link_xiayang_annihilate.description,
  },

  // 陆悠悠 连携技
  skill_link_luyouyou_weak_point: {
    id: 'skill_link_luyouyou_weak_point',
    name: '弱点击破',
    emoji: '🎯',
    icon: null,
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.7,
    // §2.8：蓄力集合内最近 1 名 → target 流
    judgeMode: 'target',
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
    },
    description: ITEMS.skill_link_luyouyou_weak_point.description,
    note: '敌人蓄力状态在其技能介绍中说明。',
  },

  skill_link_luyouyou_storm_eye: {
    id: 'skill_link_luyouyou_storm_eye',
    name: '风暴眼',
    emoji: '🌀',
    icon: null,
    roleId: 'luyouyou',
    element: 'wind',
    damageMultiplier: 0.8,
    // §2.8：线带型 → tile 流，锚点 = 玩家+目标（玩家格中心 → 随机锁定目标中心），半宽 0.5 米
    judgeMode: 'tile',
    anchor: 'player+target',
    areaShape: 'line',
    areaRadius: 0.5,          // 线带半宽 0.5 米（单位：米）
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
    description: ITEMS.skill_link_luyouyou_storm_eye.description,
  },

  skill_link_luyouyou_hunt: {
    id: 'skill_link_luyouyou_hunt',
    name: '追猎',
    emoji: '🏹',
    icon: null,
    roleId: 'luyouyou',
    element: 'physical',
    damageMultiplier: 0.2,   // 每次弹射 20%
    // §2.8：弹射 3 次 → target 流（以当前目标为锚点、0.3 米接触半径内随机）
    judgeMode: 'target',
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 1,
    isLinkSkill: true,
    triggerCondition: 'skillAttackEnemy3Times',  // 我方角色使用技能攻击敌人 3 次后
    extraEffect: {
      type: 'bounce_arrow',
      bounceCount: 3,                  // 弹射 3 次
      bounceRadius: 0.3,               // 每次弹射以当前目标为中心半径 0.3 米内随机 1 名敌人（含目标自身）
      allowRepeat: true,               // 允许重复弹射
      clearCountAfterUse: true,        // 随后清空计数
    },
    description: ITEMS.skill_link_luyouyou_hunt.description,
    note: '每次弹射以当前目标为中心半径 0.3 米内随机 1 名敌人（含目标自身）为新目标，允许重复弹射。',
  },

  skill_link_luyouyou_rise_wind: {
    id: 'skill_link_luyouyou_rise_wind',
    name: '风起',
    emoji: '🌬️',
    icon: null,
    roleId: 'luyouyou',
    element: 'wind',
    damageMultiplier: 0.15,
    // §2.8：1 名敌人（无明确索敌 → 最近存活敌人）→ target 流
    judgeMode: 'target',
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
    description: ITEMS.skill_link_luyouyou_rise_wind.description,
  },

  // ── SKL-L-008 移形（通用连携技，魔法商店购买技能物品）──
  skill_link_shift: {
    id: 'skill_link_shift',
    name: '移形',
    emoji: '👣',
    icon: null,
    roleId: null,                     // 通用技能，不归属任何角色
    element: 'physical',
    damageMultiplier: 0.5,            // 基础 50%，本日每经过 1 格 +5%
    // §2.8：1 名敌人（无明确索敌 → 最近存活敌人）→ target 流
    judgeMode: 'target',
    hooks: { onEnter: false, onPass: false, onBlessed: false },
    range: 1,
    cooldown: 4,
    isLinkSkill: true,
    triggerCondition: 'afterVehicleMove',   // 使用载具移动后可用
    extraEffect: {
      type: 'scaling_by_daily_distance',
      base: 0.5,
      perTile: 0.05,
    },
    description: ITEMS.skill_link_shift.description,
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

/**
 * 当前启用队伍的 1 号位角色 id（通用技能的默认归属者）。
 * 队伍为空时返回 null。
 */
export function getLeadRoleId(gs) {
  const idx = gs?.team?.activeGroup ?? 0;
  const roles = gs?.team?.groups?.[idx]?.roles || [];
  return roles.find((r) => r) || null;
}

/**
 * 技能归属者：专属技能用技能自身的 roleId；
 * 通用技能（roleId: null）归属当前队伍 1 号位。
 */
export function resolveSkillOwnerId(gs, skillDef) {
  return skillDef?.roleId ?? getLeadRoleId(gs);
}
