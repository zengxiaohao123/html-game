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
};

export const ALL_POTION_IDS = Object.keys(POTIONS);
