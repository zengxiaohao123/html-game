// src/data/grimoires.js
// v0.4 §14.12 魔导书定义
// 魔导书获得后自动生效，无需手动使用。自带【唯一】效果（通用规则，不在词条中显示）
// Agent 3 的 GrimoireSystem 读取此文件注册自动生效 hook

export const GRIMOIRES = {
  grimoire_harvest_cereal: {
    id: 'grimoire_harvest_cereal',
    itemId: 'grimoire_harvest_cereal',   // 对应 items.js 里的 id
    name: '庆丰收',
    emoji: '📖',
    description: '有至少 3 个水稻田块相连时，这些水稻田块产出的作物数量翻倍',
    triggerCondition: 'passive_aoe_check',  // Agent 3 每日开始时检查
    effectType: 'field_output_multiplier',
    effectParams: {
      facilityId: 'facility_rice',          // 作用对象：稻田
      minAdjacentCount: 3,                  // 至少 3 个相连稻田
      multiplier: 2,                        // 产出翻倍
      adjacencyRule: 'four_directions',     // 相连指相邻地块有水稻田块即算，拐角处同样计算
      unique: true,                          // 自带【唯一】
    },
  },

  grimoire_grain_full: {
    id: 'grimoire_grain_full',
    itemId: 'grimoire_grain_full',
    name: '穗粒满',
    emoji: '📖',
    description: '小麦田块获得新特性：【每一日结束时】获得小麦 ×1',
    triggerCondition: 'onDayEnd',            // Agent 3 DaySystem 结束日时 fire
    effectType: 'new_facility_trait',
    effectParams: {
      facilityId: 'facility_wheat',          // 作用对象：麦田
      traitType: 'onDayEnd',                 // 新增词条类型
      traitValue: { itemId: 'item_wheat', qty: 1 },
      unique: true,
    },
  },
};

export const ALL_GRIMOIRE_IDS = Object.keys(GRIMOIRES);
