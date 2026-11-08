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
  // ── 土豆系列（土豆田块 = facility_potato）─────────────────────────────

  grimoire_potato_hardship: {
    id: 'grimoire_potato_hardship',
    itemId: 'grimoire_potato_hardship',
    name: '薯道难',
    emoji: '📖',
    description: ITEMS.grimoire_potato_hardship.description,
    triggerCondition: 'passive_potato_storage', // 常驻：土豆储存共用容量 + 地雷伤害口径 + 进入词条改写
    effectType: 'potato_shared_storage',
    effectParams: {
      facilityId: 'facility_potato',
      sharedCapacity: true,                  // 所有土豆田块共用一份容量池（基础 30，薯条四重奏 +10）
      mineDamageSource: 'total_stored',       // 【土豆地雷】伤害量 = 土豆储存总数量
      enterTrait: 'take_all_potato',          // 土豆田块词条改为【进入时】可取走所有土豆田块储存
      unique: true,
    },
  },

  grimoire_potato_mine: {
    id: 'grimoire_potato_mine',
    itemId: 'grimoire_potato_mine',
    name: '土豆地雷',
    emoji: '📖',
    description: ITEMS.grimoire_potato_mine.description,
    triggerCondition: 'onDailyStart',        // 【每一日开始时】每个土豆田块埋 1 个地雷
    effectType: 'spawn_field_mine',
    effectParams: {
      facilityId: 'facility_potato',
      minePerTile: 1,
      maxOnField: 5,                          // 场上至多同时存在 5 个
      surfaceTurns: 5,                        // 埋下 5 回合后探出头
      triggerAxis: 'creature_collision',      // 敌人碰撞触发
      damageSource: 'tile_stored_potato',     // 伤害量 = 本田块当前储存的土豆数量
      element: 'fire',
      blastRadius: 1,                         // 小范围 = 半径 1 米（= 1 格）
      stunTurns: 1,                           // 命中者【晕眩】1 回合
      unique: true,
    },
  },

  grimoire_fries_quartet: {
    id: 'grimoire_fries_quartet',
    itemId: 'grimoire_fries_quartet',
    name: '薯条四重奏',
    emoji: '📖',
    description: ITEMS.grimoire_fries_quartet.description,
    triggerCondition: 'passive_tile_count',  // 常驻：田块数量实时判定
    effectType: 'potato_capacity_bonus',
    effectParams: {
      facilityId: 'facility_potato',
      countMultiple: 4,                       // 数量恰为 4 的倍数
      capacityBonus: 10,                      // 所有土豆田块储存容量 +10
      unique: true,
    },
  },

  // ── 郁金香系列（郁金香花田 = facility_tulip）───────────────────────────

  grimoire_bubble: {
    id: 'grimoire_bubble',
    itemId: 'grimoire_bubble',
    name: '泡沫',
    emoji: '📖',
    description: ITEMS.grimoire_bubble.description,
    triggerCondition: 'onDailyStart',        // 【每一日开始时】价值波动 -9~+18
    effectType: 'tulip_value_volatility',
    effectParams: {
      facilityId: 'facility_tulip',
      mode: 'daily',
      deltaMin: -9,
      deltaMax: 18,
      allowNegative: true,                    // 价值可为负
      negativePickup: 'deduct_gold',          // 负价值采摘/拆除扣金币（允许负数金币）
      highLowMultiplier: 1.5,                 // |价值|>50 时采摘/拆除结算 ×1.5
      highLowThreshold: 50,
      forceRemoveBelow: -100,                 // 价值 < -100 强制拆除
      unique: true,
    },
  },

  grimoire_tulip_simple: {
    id: 'grimoire_tulip_simple',
    itemId: 'grimoire_tulip_simple',
    name: '郁金香，简单！',
    emoji: '📖',
    description: ITEMS.grimoire_tulip_simple.description,
    triggerCondition: 'onTurnStart',         // 【每回合开始时】价值波动 -4~+9
    effectType: 'tulip_value_volatility',
    effectParams: {
      facilityId: 'facility_tulip',
      mode: 'turn',
      deltaMin: -4,
      deltaMax: 9,
      allowStacking: true,                    // 可叠放新郁金香田块
      stackValue: 'initial_value',            // 当前价值 += 初始价值（3 / 经济上行 9）
      stackVolatilityMultiplierPerStack: 1,    // 此后波动效果 +1 倍 / 层
      precedenceOver: ['grimoire_bubble'],    // 与泡沫同时拥有时以本魔导书为准
      unique: true,
    },
  },

  grimoire_economy_up: {
    id: 'grimoire_economy_up',
    itemId: 'grimoire_economy_up',
    name: '经济上行',
    emoji: '📖',
    description: ITEMS.grimoire_economy_up.description,
    triggerCondition: 'passive_tulip_initial_value',
    effectType: 'tulip_initial_value_bonus',
    effectParams: {
      facilityId: 'facility_tulip',
      initialValueBonus: 6,                   // 郁金香初始价值 +6（3 → 9）
      applyTo: 'new_tulip_tiles',             // 只影响之后放置 / 叠放的郁金香
      unique: true,
    },
  },
};

export const ALL_GRIMOIRE_IDS = Object.keys(GRIMOIRES);
