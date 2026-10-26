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
};

export const ALL_COLLECTIBLE_IDS = Object.keys(COLLECTIBLES);
