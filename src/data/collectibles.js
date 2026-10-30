// src/data/collectibles.js
// v0.4 §14.14 收藏品定义
// 收藏品获得后自动生效，无需手动使用。绝大部分自带【唯一】性质
// Agent 3 的 CollectibleSystem 读取此文件注册自动生效 hook

export const COLLECTIBLES = {
  collectible_sad_pumpkin: {
    id: 'collectible_sad_pumpkin',
    itemId: 'collectible_sad_pumpkin',
    name: '悲伤的南瓜',
    emoji: '🎃',
    description: '场上每储存 1 个作物，角色最大生命值和攻击力各 +2%',
    triggerCondition: 'passive',
    effectType: 'storedCrop_scaling',
    effectParams: {
      hpMaxBonusPerStored: 0.02,   // 每储存 1 个作物，最大生命值 +2%
      atkBonusPerStored: 0.02,     // 每储存 1 个作物，攻击力 +2%
      storedSource: 'facilities_with_storage',  // 储存指设施描述中明确说了会把作物储存的那些
      autoDecreaseOnRemove: true,  // 作物被取走后数值对应减少
      unique: true,
    },
  },

  collectible_fullness: {
    id: 'collectible_fullness',
    itemId: 'collectible_fullness',
    name: '果腹',
    emoji: '🍽️',
    description: '载具的最后一次移动不消耗行动力',
    triggerCondition: 'passive',
    effectType: 'vehicle_last_move_free',
    effectParams: {
      freeLastUsage: true,         // 载具的最后一次移动不消耗行动力
      note: '载具 usageCount 减到 0 前的那一次移动，不消耗行动力',
      unique: true,
    },
  },

  // ── ITM-COL-003 皇家枕头 🛏️ ──
  collectible_royal_pillow: {
    id: 'collectible_royal_pillow',
    itemId: 'collectible_royal_pillow',
    name: '皇家枕头',
    emoji: '🛏️',
    description: '睡觉时为角色回复 15% 生命值',
    triggerCondition: 'onSleep',
    effectType: 'sleep_heal_percent',
    effectParams: { percent: 0.15, unique: true },
  },

  // ── ITM-COL-004 回忆录 📔（占位收藏品，允许叠加，无【唯一】）──
  collectible_memoir: {
    id: 'collectible_memoir',
    itemId: 'collectible_memoir',
    name: '回忆录',
    emoji: '📔',
    description: '角色最大生命值 +2%。所有角色好感度 +1',
    triggerCondition: 'passive',
    effectType: 'maxhp_percent',
    effectParams: { percent: 0.02, unique: false, stackable: true },
  },

  // ── ITM-COL-005 《农业指南》📘 ──
  collectible_farm_guide: {
    id: 'collectible_farm_guide',
    itemId: 'collectible_farm_guide',
    name: '《农业指南》',
    emoji: '📘',
    description: '获得 3 个随机设施',
    triggerCondition: 'onAcquire',
    effectType: 'grant_facilities',
    effectParams: { count: 3, pool: 'POOL-01', unique: true, sequential: true },
  },

  // ── ITM-COL-006 枯木新枝 🪵 ──
  collectible_deadwood: {
    id: 'collectible_deadwood',
    itemId: 'collectible_deadwood',
    name: '枯木新枝',
    emoji: '🪵',
    description: '移动后为角色回复（6 点 + 1%）生命值',
    triggerCondition: 'onMoveEnd',
    effectType: 'move_heal_flat_percent',
    effectParams: { flat: 6, percent: 0.01, unique: true },
  },

  // ── ITM-COL-007 会员卡 💳 ──
  collectible_membership_card: {
    id: 'collectible_membership_card',
    itemId: 'collectible_membership_card',
    name: '会员卡',
    emoji: '💳',
    description: '商店与魔法商店的所有商品售价 -50%',
    triggerCondition: 'passive',
    effectType: 'shop_discount',
    effectParams: { discount: 0.5, unique: true, affectsItemValue: false },
  },
};

export const ALL_COLLECTIBLE_IDS = Object.keys(COLLECTIBLES);
