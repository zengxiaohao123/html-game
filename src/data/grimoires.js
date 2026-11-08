// src/data/grimoires.js
// v0.5 §14.1 魔导书定义（基础道具 → 魔导书）
// 魔导书获得后自动生效，无需手动使用。自带【唯一】效果（通用规则，不在词条中显示）
// Agent 3 的 GrimoireSystem 读取此文件注册自动生效 hook

import { ITEMS } from './items.js';
export const GRIMOIRES = {
  grimoire_harvest_cereal: {
    id: 'grimoire_harvest_cereal',
    itemId: 'grimoire_harvest_cereal',   // 对应 items.js 里的 id
    name: '庆丰收',
    emoji: '📖',
    description: ITEMS.grimoire_harvest_cereal.description,
    triggerCondition: 'onDailyStart',    // 每日开始时按当日相连状态逐格结算
    effectType: 'field_output_multiplier',
    effectParams: {
      fieldType: 'rice',                    // 作用对象：水稻（稻草）田块
      facilityId: 'facility_rice',
      minAdjacentCount: 3,                  // 至少 3 个水稻田块相连
      multiplier: 2,                        // 簇内田块产出 +100%
      perTileCluster: true,                 // 只加成"处在 ≥3 相连簇内"的那些田块
      adjacencyRule: 'four_directions',     // 相连指相邻地块有水稻田块即算，拐角处同样计算
      unique: true,                          // 自带【唯一】
    },
  },

  grimoire_grain_full: {
    id: 'grimoire_grain_full',
    itemId: 'grimoire_grain_full',
    name: '穗粒满',
    emoji: '📖',
    description: ITEMS.grimoire_grain_full.description,
    triggerCondition: 'onDailyEnd',          // DaySystem.startNewDay 开头 fire onDailyEnd
    effectType: 'new_facility_trait',
    effectParams: {
      fieldType: 'wheat',                    // 作用对象：小麦田块
      facilityId: 'facility_wheat',
      traitType: 'onDailyEnd',               // 新增词条类型
      traitValue: { itemId: 'item_wheat', qty: 1 },
      unique: true,
    },
  },

  // ── 稻草系列（水稻 = 稻草田块 = facility_rice）─────────────────────────

  grimoire_rice_scent: {
    id: 'grimoire_rice_scent',
    itemId: 'grimoire_rice_scent',
    name: '稻香远',
    emoji: '📖',
    description: ITEMS.grimoire_rice_scent.description,
    triggerCondition: 'onTurnStart',         // 回合计数 +1 之后、回合内其它结算之前
    effectType: 'heal_per_turn',
    effectParams: {
      fieldType: 'rice',
      facilityId: 'facility_rice',
      healPerTile: 2,                        // 回复 2 × 稻草田块数量 点生命
      unique: true,
    },
  },

  grimoire_spring_glow: {
    id: 'grimoire_spring_glow',
    itemId: 'grimoire_spring_glow',
    name: '春光好',
    emoji: '📖',
    description: ITEMS.grimoire_spring_glow.description,
    triggerCondition: 'onDamageDeal',        // 伤害结算时读取
    effectType: 'element_damage_bonus',
    effectParams: {
      fieldType: 'rice',
      element: 'grass',
      percentPerTile: 0.02,                  // 草元素伤害 +（2% × 水稻田块数量）
      unique: true,
    },
  },

  // ── 小麦系列 ─────────────────────────────────────────────────────────

  grimoire_food_first: {
    id: 'grimoire_food_first',
    itemId: 'grimoire_food_first',
    name: '食为先',
    emoji: '📖',
    description: ITEMS.grimoire_food_first.description,
    triggerCondition: 'onHpBelowHalf',       // 生命值下降后检查是否低于 50%
    effectType: 'emergency_heal',
    effectParams: {
      fieldType: 'wheat',
      facilityId: 'facility_wheat',
      hpThreshold: 0.5,
      percentPerTile: 0.03,                  // 回复（3% × 小麦田块数量）最大生命值
      dailyLimit: 1,
      unique: true,
    },
  },

  grimoire_golden_wave: {
    id: 'grimoire_golden_wave',
    itemId: 'grimoire_golden_wave',
    name: '黄金浪',
    emoji: '📖',
    description: ITEMS.grimoire_golden_wave.description,
    triggerCondition: 'onPass',              // 【经过时】
    effectType: 'new_facility_trait',
    effectParams: {
      fieldType: 'wheat',
      facilityId: 'facility_wheat',
      minAdjacentCount: 3,                   // ≥3 个小麦田块相连时
      traitType: 'onPass',
      traitValue: { itemId: 'item_wheat', qty: 1 },
      adjacencyRule: 'four_directions',
      unique: true,
    },
  },

  // ── 水稻 + 小麦 ───────────────────────────────────────────────────────

  grimoire_granary_full: {
    id: 'grimoire_granary_full',
    itemId: 'grimoire_granary_full',
    name: '仓廪实',
    emoji: '📖',
    description: ITEMS.grimoire_granary_full.description,
    triggerCondition: 'passive_field_alias', // 常驻：田块类型双向视同
    effectType: 'field_type_alias',
    effectParams: {
      fields: ['rice', 'wheat'],
      mutual: true,                          // 稻草田块 ↔ 小麦田块 互为视同
      affectedScopes: ['count', 'cluster', 'output'],
      unique: true,
    },
  },
};

export const ALL_GRIMOIRE_IDS = Object.keys(GRIMOIRES);
