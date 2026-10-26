// src/data/items.js
// v0.4 —— 五级分类体系（严格对照 §14.1 分类体系 + §14.4-§14.14 数值）
// 每物品字段：
//   id, name, emoji, description, value,
//   tier1: 一级分类（产物/道具/载具/杂物）
//   tier2: 二级分类（道具→消耗道具/基础道具；null 表示无）
//   tier3: 三级分类（基础道具→魔导书/技能石/收藏品；null 表示无）
//   hiddenTags: 四级分类，隐藏词条数组
//   rarity: 1-5 或 99（99=特殊值）
//   stackable: 载具=false，大部分=true
//   stackMax: 叠放上限（默认 999）

export const ITEMS = {
  // ════════════════════════════════════════════════════════════
  // §14.4 产物·作物   tier1='产物'
  // ════════════════════════════════════════════════════════════

  item_wheat: {
    id: 'item_wheat',
    name: '小麦',
    emoji: '🌾',
    description: '可用于合成、喂食动物',
    value: 2,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_rice_straw: {
    id: 'item_rice_straw',
    name: '稻草',
    emoji: '🌾',
    description: '水稻的茎秆，可用于合成、喂食动物',
    value: 2,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_potato: {
    id: 'item_potato',
    name: '土豆',
    emoji: '🥔',
    description: '淀粉丰富的块茎，可用于合成、喂食动物',
    value: 2,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_tulip: {
    id: 'item_tulip',
    name: '郁金香',
    emoji: '🌷',
    description: '颜色鲜艳的花朵，价值随花田每日波动',
    // 价值动态：采摘时根据花田 contentState.tulipValue 而定，不同价值郁金香分堆
    value: 0, // 占位，实际价值在采摘时赋值
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物', '花朵'],
    rarity: 2,
    stackable: true,
    stackMax: 999,
  },

  item_strawberry: {
    id: 'item_strawberry',
    name: '草莓',
    emoji: '🍓',
    description: '酸甜多汁的浆果，可用于合成、喂食动物',
    value: 6,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物'],
    rarity: 2,
    stackable: true,
    stackMax: 999,
  },

  item_pea: {
    id: 'item_pea',
    name: '豌豆',
    emoji: '🫛',
    description: '圆润饱满的豆粒，可用于合成、喂食动物',
    value: 2,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_corn: {
    id: 'item_corn',
    name: '玉米',
    emoji: '🌽',
    description: '颗粒饱满的粮食，可用于合成、喂食动物',
    value: 4,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_cabbage: {
    id: 'item_cabbage',
    name: '卷心菜',
    emoji: '🥬',
    description: '紧实脆嫩的叶菜，可用于合成、喂食动物',
    value: 2,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '农作物'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  // ════════════════════════════════════════════════════════════
  // §14.5 产物·畜产品   tier1='产物'
  // ════════════════════════════════════════════════════════════

  item_egg: {
    id: 'item_egg',
    name: '鸡蛋',
    emoji: '🥚',
    description: '鸡产下的普通鸡蛋，营养丰富，可用于合成、烹饪',
    value: 2,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '畜产品'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_golden_egg: {
    id: 'item_golden_egg',
    name: '优质鸡蛋',
    emoji: '🥚',
    description: '心情好的鸡产下的优质鸡蛋，比普通鸡蛋更有营养',
    value: 3,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '畜产品', '优质'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_raw_meat: {
    id: 'item_raw_meat',
    name: '生肉',
    emoji: '🍖',
    description: '从击败的动物身上获得的生肉，可用于合成、烹饪',
    value: 4,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '畜产品'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  // ════════════════════════════════════════════════════════════
  // §14.6 产物·战利品   tier1='产物'
  // ════════════════════════════════════════════════════════════

  item_slime_gel: {
    id: 'item_slime_gel',
    name: '史莱姆胶',
    emoji: '🟢',
    description: '击败史莱姆后掉落的凝胶，具有弹性，可用于合成',
    value: 4,
    tier1: '产物',
    tier2: null,
    tier3: null,
    hiddenTags: ['作物', '战利品'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  // ════════════════════════════════════════════════════════════
  // §14.7 载具系统（物品视角）   tier1='载具'
  // 注意：载具在游戏内独立有载具页面，但巴士站等还是通过 item_wheel 给，保守保留
  // ════════════════════════════════════════════════════════════

  item_wheel: {
    id: 'item_wheel',
    name: '轮子',
    emoji: '⚙️',
    description: '装载后能够移动到沿上下左右方向最多 2 格内的任意地块（不能斜着，允许穿越非法位置但不能停留），可使用 1 次',
    value: 1,
    tier1: '载具',
    tier2: null,
    tier3: null,
    hiddenTags: ['载具'],
    rarity: 1,
    stackable: false,
    stackMax: 1,
  },

  // ════════════════════════════════════════════════════════════
  // §14.11 道具·消耗道具   tier1='道具', tier2='消耗道具'
  // ════════════════════════════════════════════════════════════

  item_herb: {
    id: 'item_herb',
    name: '草药',
    emoji: '🌿',
    description: '使用后为角色回复 20 生命值。冷却时间 5 回合',
    value: 2,
    tier1: '道具',
    tier2: '消耗道具',
    tier3: null,
    hiddenTags: ['消耗道具', '药品'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  item_fertilizer: {
    id: 'item_fertilizer',
    name: '初级肥料',
    emoji: '💩',
    description: '对指定田块使用，使其立刻触发 2 次【每一日开始时】的效果。必须是植物类设施（田块 / 花田等），对鸡舍、史莱姆屋等无效；若该设施不含【每一日开始时】类效果也无效。无效时不返还已消耗的道具',
    value: 4,
    tier1: '道具',
    tier2: '消耗道具',
    tier3: null,
    hiddenTags: ['消耗道具'],
    rarity: 2,
    stackable: true,
    stackMax: 999,
  },

  // ════════════════════════════════════════════════════════════
  // §14.12 道具·基础道具·魔导书   tier1='道具', tier2='基础道具', tier3='魔导书'
  // ════════════════════════════════════════════════════════════

  grimoire_harvest_cereal: {
    id: 'grimoire_harvest_cereal',
    name: '庆丰收',
    emoji: '📖',
    description: '有至少 3 个水稻田块相连时，这些水稻田块产出的作物数量翻倍。相连指相邻地块有水稻田块即算，拐角处同样计算',
    value: 15,
    tier1: '道具',
    tier2: '基础道具',
    tier3: '魔导书',
    hiddenTags: ['基础道具', '魔导书'],
    rarity: 3,
    stackable: false,
    stackMax: 1,
  },

  grimoire_grain_full: {
    id: 'grimoire_grain_full',
    name: '穗粒满',
    emoji: '📖',
    description: '小麦田块获得新特性：【每一日结束时】获得小麦 ×1',
    value: 5,
    tier1: '道具',
    tier2: '基础道具',
    tier3: '魔导书',
    hiddenTags: ['基础道具', '魔导书'],
    rarity: 1,
    stackable: false,
    stackMax: 1,
  },

  // ════════════════════════════════════════════════════════════
  // §14.13 道具·基础道具·技能石   tier1='道具', tier2='基础道具', tier3='技能石'
  // ════════════════════════════════════════════════════════════

  skill_stone_zongheng: {
    id: 'skill_stone_zongheng',
    name: '技能石：合纵连横',
    emoji: '💎',
    description: '使用后获得合纵连横 ×1',
    value: 1,
    tier1: '道具',
    tier2: '基础道具',
    tier3: '技能石',
    hiddenTags: ['基础道具', '技能石'],
    rarity: 1,
    stackable: true,
    stackMax: 999,
  },

  // ════════════════════════════════════════════════════════════
  // §14.14 道具·基础道具·收藏品   tier1='道具', tier2='基础道具', tier3='收藏品'
  // ════════════════════════════════════════════════════════════

  collectible_sad_pumpkin: {
    id: 'collectible_sad_pumpkin',
    name: '悲伤的南瓜',
    emoji: '🎃',
    description: '场上每储存 1 个作物，角色最大生命值和攻击力各 +2%。储存指设施描述中明确说了会把作物储存的那些，被取走后数值对应减少',
    value: 12,
    tier1: '道具',
    tier2: '基础道具',
    tier3: '收藏品',
    hiddenTags: ['基础道具', '收藏品'],
    rarity: 3,
    stackable: false,
    stackMax: 1,
  },

  collectible_fullness: {
    id: 'collectible_fullness',
    name: '果腹',
    emoji: '🍽️',
    description: '载具的最后一次移动不消耗行动力',
    value: 16,
    tier1: '道具',
    tier2: '基础道具',
    tier3: '收藏品',
    hiddenTags: ['基础道具', '收藏品'],
    rarity: 5,
    stackable: false,
    stackMax: 1,
  },
};

export const ALL_ITEM_IDS = Object.keys(ITEMS);
