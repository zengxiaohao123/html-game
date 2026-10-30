// src/data/potions.js
// v0.4 §14.11 消耗道具定义
// 消耗道具在背包中，玩家主动使用时触发效果
// Agent 3 的 InventorySystem / UseItemSystem 读取此文件执行使用逻辑

export const POTIONS = {
  item_herb: {
    id: 'item_herb',
    itemId: 'item_herb',
    name: '草药',
    emoji: '🌿',
    description: '使用后为角色回复 20 生命值。冷却时间 5 回合',
    useEffect: {
      type: 'hp_regen',
      amount: 20,
      cooldownTurns: 5,
    },
  },

  item_fertilizer: {
    id: 'item_fertilizer',
    itemId: 'item_fertilizer',
    name: '初级肥料',
    emoji: '💩',
    description: '对指定田块使用，使其立刻触发 2 次【每一日开始时】的效果',
    useEffect: {
      type: 'facility_trigger_twice',
      triggerCount: 2,
      validFacilityCategory: 'plant_field',  // 必须是植物类设施（田块/花田等）
      // 对鸡舍、史莱姆屋等无效；若该设施不含【每一日开始时】类效果也无效
      invalidNoReturn: true,                  // 无效时不返还已消耗的道具
      validFacilityIds: [
        'facility_wheat', 'facility_rice', 'facility_potato',
        'facility_tulip', 'facility_strawberry', 'facility_pea',
        'facility_corn', 'facility_cabbage',
      ],
    },
  },

  // ── ITM-CON-003 啤酒 🍺 ──
  item_beer: {
    id: 'item_beer',
    itemId: 'item_beer',
    name: '啤酒',
    emoji: '🍺',
    description: '使用后行动力 +3，且有 30% 概率使角色获得持续 1 天的【暴躁】buff：攻击力 +25%（不叠加）',
    useEffect: {
      type: 'stamina_and_buff',
      stamina: 3,
      buffChance: 0.3,
      buffId: 'grumpy',
      buffAtkBonus: 0.25,
      buffDays: 1,
    },
  },

  // ── ITM-CON-004 感恩节的晚餐 🍗 ──
  item_dinner: {
    id: 'item_dinner',
    itemId: 'item_dinner',
    name: '感恩节的晚餐',
    emoji: '🍗',
    description: '使用后，本日内我方单位会将友善生物也视为敌人',
    useEffect: {
      type: 'friendly_as_enemy',
      durationDays: 1,
      // 效果与持续时间不可叠加；我方单位含所有角色（及其技能）、精灵以及能发动攻击的设施
    },
  },

  // ── ITM-CON-005 陷阱 🪤（放置型）──
  item_trap: {
    id: 'item_trap',
    itemId: 'item_trap',
    name: '陷阱',
    emoji: '🪤',
    description: '放置在任意地块后，每一日开始时有 10% 概率获得 1 个随机物品。放置在资源地块时，概率变为 30%',
    useEffect: {
      type: 'placed_daily_roll',
      chance: 0.10,
      resourceChance: 0.30,
      pool: 'POOL-12',
      // 多个陷阱各自独立计算
    },
  },

  // ── ITM-CON-006 艾草熏香 🪔（放置型）──
  item_incense: {
    id: 'item_incense',
    itemId: 'item_incense',
    name: '艾草熏香',
    emoji: '🪔',
    description: '放置在任意地块后，在此处睡觉时，回复 30 点生命值',
    useEffect: {
      type: 'placed_sleep_heal',
      healAmount: 30,
    },
  },
};

export const ALL_POTION_IDS = Object.keys(POTIONS);
