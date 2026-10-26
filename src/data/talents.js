// src/data/talents.js
// v0.4 §12.7-§12.9 天赋定义（共 11 个）
// 字段说明（Agent 3 TalentSystem 读取）：
//   triggerCondition: 触发时机的字符串 key（Agent 3 需要自己 fire 对应事件）
//   effectType: 效果类型字符串 key
//   effectParams: 数值参数，精确从文档抄
//   文档没给 triggerCondition/effectType 的字面值，以下按天赋效果选最贴切的字符串

export const TALENTS = {
  // ════════════════════════════════════════════════════════════
  // §12.7 余默（精灵 momo）
  // ════════════════════════════════════════════════════════════

  yumo_heyixiangwo: {
    id: 'yumo_heyixiangwo',
    name: '何以为我',
    emoji: '📖',
    roleId: 'yumo',
    triggerCondition: 'onDamageDeal',   // 造成伤害时触发，判断元素种类
    effectType: 'element_switcher',
    effectParams: {
      physicalBonus: 0.5,              // 物理伤害 +50%（基础）
      perElementPenalty: 0.2,          // 每造成一种新元素伤害，物理伤害 -20%
      perElementBonus: 0.2,            // 对应元素伤害 +20%
      dailyReset: true,                // 新一日重置
    },
    description: '【天赋】物理伤害加成 +50%。每造成一种元素伤害后，本日内物理伤害 -20%，该元素伤害 +20%。按种类计，重复不叠加；新一日重置。',
  },

  // ════════════════════════════════════════════════════════════
  // §12.8 夏阳（精灵晴风）
  // ════════════════════════════════════════════════════════════

  xiayangFearless_lv1: {
    id: 'xiayangFearless_lv1',
    name: '无所畏惧·等级 1',
    emoji: '📖',
    roleId: 'xiayang',
    triggerCondition: 'passive',
    effectType: 'damage_flat_bonus',
    effectParams: {
      physical: 5,                      // 物理伤害 +5（固定值，非百分比）
      fire: 5,                          // 火元素伤害 +5
    },
    description: '【天赋】我方角色造成的物理伤害 +5，火元素伤害 +5。固定值，不是百分比。',
  },

  xiayangEnergetic: {
    id: 'xiayangEnergetic',
    name: '活力满满',
    emoji: '📖',
    roleId: 'xiayang',
    triggerCondition: 'onSleep',
    effectType: 'sleep_bonus',
    effectParams: {
      hpRegenMultiplier: 2,             // 睡觉时回复的生命值翻倍
      extraStamina: 2,                  // 额外回复 2 点行动力
      note: '睡觉本身不回复生命值。此翻倍效果为未来的睡觉增益道具预留。',
    },
    description: '【天赋】睡觉时回复的生命值翻倍，额外回复 2 点行动力。睡觉本身不回复生命值，此翻倍效果为未来的睡觉增益道具预留。',
  },

  xiayangCurious: {
    id: 'xiayangCurious',
    name: '好奇心',
    emoji: '📖',
    roleId: 'xiayang',
    triggerCondition: 'onCreatureDefeated',
    effectType: 'extra_reward',
    effectParams: {
      targets: ['danger', 'extreme'],   // 危险生物与极度危险生物
      extraRewardChance: 0.3,           // 30% 概率额外获得 1 次奖励
      extraGoldChance: 0.5,             // 50% 概率额外获得金币 ×1
      independentRoll: true,            // 两个概率独立判定，可同时触发
    },
    description: '【天赋】危险生物与极度危险生物被击败时，30% 概率额外获得 1 次奖励，50% 概率额外获得金币 ×1。两个概率独立判定，可同时触发。',
  },

  xiayangWant: {
    id: 'xiayangWant',
    name: '心想事成',
    emoji: '📖',
    roleId: 'xiayang',
    triggerCondition: 'manual',          // 玩家主动使用载具时触发
    effectType: 'unlock_vehicle',
    effectParams: {
      vehicleId: 'vehicle_chance',      // 解锁载具【巧遇】
      perDayLimit: 1,                   // 每天限 1 次
      note: '不能进入栅栏内。移动时选最短实际路径作为"经过"路径。',
    },
    description: '【天赋】可使用载具【巧遇】：移动至任意一格，每天限 1 次。不能进入栅栏内。移动时选最短实际路径作为"经过"路径。',
  },

  xiayangReborn: {
    id: 'xiayangReborn',
    name: '涅槃',
    emoji: '📖',
    roleId: 'xiayang',
    triggerCondition: 'onHPDeath',       // 生命归 0 时触发
    effectType: 'death_immunity',
    effectParams: {
      cooldownDays: 3,                   // 冷却 3 天（触发当天算冷却一天）
      hpRegenPercent: 0.5,              // 回复 50% 生命值
      atkBonus: 0.25,                   // 攻击力 +25%
      priorityOverDeathPenalty: true,    // 优先于生命归 0 惩罚（不扣金币、不变行动力、不触发生物停战）
    },
    description: '【天赋】角色受到致命伤害时不倒下，回复 50% 生命值且攻击力 +25%。冷却 3 天。触发当天算冷却一天。涅槃优先于生命归 0 惩罚（不扣金币、不变行动力、不触发生物停战）。',
  },

  // ════════════════════════════════════════════════════════════
  // §12.9 陆悠悠（精灵芋圆）
  // ════════════════════════════════════════════════════════════

  luyouyouSkilled_lv1: {
    id: 'luyouyouSkilled_lv1',
    name: '巧手·等级 1',
    emoji: '📖',
    roleId: 'luyouyou',
    triggerCondition: 'onDayStart',
    effectType: 'item_generation',
    effectParams: {
      dailyRandomItemChance: 0.4,        // 【每一日开始时】40% 概率获得 1 个随机物品
      craftReturnChance: 0.25,           // 【合成或加工时】25% 概率返还 1 个原材料
      note: '原材料指本次合成/加工用到的物品。',
    },
    description: '【天赋】【每一日开始时】40% 概率获得 1 个随机物品。【天赋】【合成或加工时】25% 概率返还 1 个原材料。原材料指本次合成/加工用到的物品。',
  },

  luyouyouCooking: {
    id: 'luyouyouCooking',
    name: '烹饪',
    emoji: '📖',
    roleId: 'luyouyou',
    triggerCondition: 'passive',
    effectType: 'max_hp_food_bonus',
    effectParams: {
      maxHpBonus: 20,                    // 角色最大生命值 +20
      note: '食物提供更好回复效果且价值更高（食物系统 Agent 3 具体实现）。',
    },
    description: '【天赋】食物提供更好回复效果且价值更高。角色最大生命值 +20。',
  },

  luyouyouDancing_lv1: {
    id: 'luyouyouDancing_lv1',
    name: '蹁跹·等级 1',
    emoji: '📖',
    roleId: 'luyouyou',
    triggerCondition: 'onMoveEnd',
    effectType: 'hp_regen_dodge_bonus',
    effectParams: {
      moveRegen: 6,                       // 【移动后】回复 6 点生命值
      dodgeRate: 0.32,                    // 闪避率 +32%
      dodgeRegenForMainChar: 12,          // 【闪避时】为主角回复 12 点生命值
      note: '【移动后】指走完一整段路径后触发一次，不是每走一格触发。',
    },
    description: '【天赋】【移动后】回复 6 点生命值。【天赋】角色闪避率 +32%。【天赋】【闪避时】为主角回复 12 点生命值。【移动后】指走完一整段路径后触发一次，不是每走一格触发。',
  },

  luyouyouWindBreath_lv1: {
    id: 'luyouyouWindBreath_lv1',
    name: '风息·等级 1',
    emoji: '📖',
    roleId: 'luyouyou',
    triggerCondition: 'passive',
    effectType: 'wind_crit_bonus',
    effectParams: {
      windDamageBonus: 20,                // 我方角色造成的风元素伤害 +20
      critRateBonus: 0.3,                 // 陆悠悠所有技能暴击率 +30%
      critElementOverride: 'wind',        // 暴击时本次技能伤害类型改为风元素伤害
    },
    description: '【天赋】我方角色造成的风元素伤害 +20。【天赋】陆悠悠所有技能暴击率 +30%，暴击时本次技能伤害类型改为风元素伤害。',
  },

  luyouyouTwin: {
    id: 'luyouyouTwin',
    name: '比翼',
    emoji: '📖',
    roleId: 'luyouyou',
    triggerCondition: 'onCrit',           // 陆悠悠暴击时触发
    effectType: 'team_crit_chain',
    effectParams: {
      nextAllyCritRateBonus: 1.0,         // 其余我方角色下一次攻击暴击率 +100%
      nonStackable: true,                 // 不可叠加
      defaultDurationDays: 99,            // 未说明持续时间默认 99 天
    },
    description: '【天赋】陆悠悠攻击暴击后，其余我方角色下一次攻击暴击率 +100%，不可叠加。未说明持续时间默认 99 天。',
  },
};

export const ALL_TALENT_IDS = Object.keys(TALENTS);

export function getTalent(id) {
  return TALENTS[id] || null;
}

export function getTalentsByRole(roleId) {
  return Object.values(TALENTS).filter(t => t.roleId === roleId);
}
