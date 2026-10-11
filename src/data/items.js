/**
 * data/items.js —— 物品 / 材料 / 地块物品数据（§6.9、§3.4.2、§3.9.1）
 *
 * 描述严格按设计文档原文，AI 不得改写润色。
 * literary 字段为"文学性描述"，UI 用浅蓝字体单独成段。
 * 备注 notes 仅供内部，不展示给玩家。
 */

import { InvCategory as C, Terrain } from '../core/Const.js';

/**
 * @typedef {Object} ItemDef
 * @property {string} id
 * @property {string} name
 * @property {string} category  InvCategory
 * @property {string} desc      游戏性描述（原文）
 * @property {string} [literary] 文学性描述（浅蓝字段）
 * @property {string} [subcat]  子分类
 * @property {boolean} craftable 可合成
 * @property {boolean} tradable  可交易（出现在商店）
 * @property {boolean} buildable 可建造材料
 * @property {{canSell?:boolean,buy?:number,sell?:number}} [shop]
 * @property {object} [use]      使用效果（仅探索态）
 * @property {boolean} [unique]  【唯一】
 * @property {string} [terrain]  地块物品放置后的地形
 * @property {string} [notes]    内部备注（不展示）
 */

export const ITEMS = {
  // ---------- 基础材料 / 消耗品（§6.9.2） ----------
  wood: {
    id: 'wood', name: '木材', category: C.CONSUMABLE, subcat: '自然资源',
    desc: '基础材料。', craftable: true, tradable: true, buildable: true,
    shop: { buy: 1, sell: 1 },
  },
  linen: {
    id: 'linen', name: '亚麻', category: C.CONSUMABLE, subcat: '自然资源',
    desc: '基础材料。', craftable: true, tradable: true, buildable: true,
    shop: { buy: 1, sell: 1 },
  },
  water: {
    id: 'water', name: '水', category: C.CONSUMABLE, subcat: '自然资源',
    desc: '基础材料。', craftable: true, tradable: true, buildable: true,
    shop: { buy: 1, sell: 1 },
    notes: '初始无法正常获得，需通过抽水泵等途径获取。',
  },
  fruit: {
    id: 'fruit', name: '果子', category: C.CONSUMABLE, subcat: '自然资源/食物',
    desc: '可食用的野果。', craftable: true, tradable: true, buildable: false,
    shop: { buy: 2, sell: 1 },
    use: { healHp: 20, healthChance: { p: 0.20, value: 1 } },
  },
  rawMeat: {
    id: 'rawMeat', name: '生肉', category: C.CONSUMABLE, subcat: '自然资源/食物',
    desc: '未处理的肉块。', craftable: true, tradable: true, buildable: false,
    shop: { buy: 2, sell: 1 },
    use: { healHp: 20 },
  },
  cookedMeat: {
    id: 'cookedMeat', name: '熟肉', category: C.CONSUMABLE, subcat: '合成物/食物',
    desc: '香喷喷的肉排。', craftable: false, tradable: true, buildable: false,
    shop: { buy: 8, sell: 4 },
    use: { healHp: 70 },
    notes: '篝火烹饪：1 生肉 + 1 木材 = 1 熟肉。',
  },
  bottle: {
    id: 'bottle', name: '空瓶子', category: C.CONSUMABLE, subcat: '城市资源',
    desc: '随处可见的空瓶子。', craftable: true, tradable: true, buildable: false,
    shop: { buy: 1, sell: 1 },
    notes: '啤酒使用后产出。',
  },
  iron: {
    id: 'iron', name: '铁块', category: C.CONSUMABLE, subcat: '其他',
    desc: '相对罕见的基础材料。', craftable: true, tradable: true, buildable: true,
    shop: { buy: 5, sell: 3 },
  },
  blueStone: {
    id: 'blueStone', name: '蓝星石', category: C.CONSUMABLE, subcat: '自然资源/消耗品',
    desc: '偶尔能捡到的矿石。',
    literary: '表面黯黑，但遇光或被研磨时，会分解出蓝色的粉末，犹如蓝色星光，因而得名。蓝色粉末有安神效果，熬制成浆后效果会进一步增强。',
    craftable: true, tradable: false, buildable: false,
    notes: '8 蓝星石 = 1 明心浆。',
  },
  bluePowder: {
    id: 'bluePowder', name: '蓝星粉末', category: C.CONSUMABLE, subcat: '城市资源/消耗品',
    desc: '随处可见的一种带有药效的粉末。',
    literary: '由蓝星石遇光或被研磨而得，具有安神效果。许多人将其作为熏香随身携带，但时间长了会失效，被随手抛弃。熬制成浆后效果会进一步增强。',
    craftable: true, tradable: false, buildable: false,
    notes: '16 蓝星粉末 = 1 明心浆。',
  },
  mingxin: {
    id: 'mingxin', name: '明心浆', category: C.CONSUMABLE, subcat: '合成物/消耗品',
    desc: '游戏中重要的软货币。',
    literary: '饮料？毒药？兴奋剂？若你心已明，便不会纠结它的用途。',
    craftable: false, tradable: false, buildable: false,
    use: {
      mental: 4, fullHpAndAp: true, cureDepression: true,
      dayBuff: { atkPct: 0.25, dmgTakenPct: -0.25 },
    },
    notes: '软货币，仅事件交易；剧情别名"蓝浆"不对玩家展示。',
  },
  amethyst: {
    id: 'amethyst', name: '紫水晶', category: C.CONSUMABLE,
    desc: '非常漂亮的宝石。', craftable: false, tradable: false, buildable: false,
    use: { giftAffinity: 3 }, notes: '喜好度等级 2。',
  },
  diamond: {
    id: 'diamond', name: '钻石', category: C.CONSUMABLE,
    desc: '闪闪发光，十分稀有。', craftable: false, tradable: false, buildable: false,
    use: { giftAffinity: 8 }, notes: '喜好度等级 2。',
  },
  beer: {
    id: 'beer', name: '啤酒', category: C.CONSUMABLE,
    desc: '游戏中重要的软通币。', craftable: false, tradable: false, buildable: false,
    use: {
      ap: 2, grantBottle: 1,
      dayBuffChance: { p: 0.25, atkPct: 0.30 },
      anotherChance: { p: 0.10, item: 'beer', count: 1 },
    },
    notes: '同日多次攻击加成不叠加、不延长。',
  },

  // ---------- 永久物品（§6.9.3，获得即生效，不可手动使用） ----------
  club: {
    id: 'club', name: '木棒', category: C.PERMANENT,
    desc: '主角基础攻击力+10，暴击率+2%，可叠加。',
    craftable: true, tradable: false, buildable: false,
    perm: { baseAtk: 10, critRate: 0.02 },
    craft: { base: { wood: 6 }, increment: { wood: 2 } },
  },
  clothCloth: {
    id: 'clothCloth', name: '布衣', category: C.PERMANENT,
    desc: '主角基础最大生命值+50，受到攻击时有2%概率【格挡】该伤害。',
    craftable: true, tradable: false, buildable: false,
    perm: { baseMaxHp: 50, blockRate: 0.02 },
    craft: { base: { linen: 8 }, increment: { linen: 2 } },
  },
  trap: {
    id: 'trap', name: '陷阱', category: C.PERMANENT,
    desc: '睡觉时，有50%获得1个随机自然资源，可叠加。',
    craftable: true, tradable: false, buildable: false,
    perm: { sleepResource: { p: 0.50 } },
    craft: { base: { wood: 4 }, increment: { wood: 2 } },
  },
  quilt: {
    id: 'quilt', name: '被子', category: C.PERMANENT,
    desc: '睡觉时，主角回复30点生命值，可叠加。',
    craftable: true, tradable: false, buildable: false,
    perm: { sleepHeal: 30 },
    craft: { base: { linen: 6 }, increment: { linen: 2 } },
  },
  dagger: {
    id: 'dagger', name: '匕首', category: C.PERMANENT,
    desc: '主角基础攻击力+20，攻击时有2%概率回复相当于本次伤害量50%的生命值，可叠加。',
    craftable: false, tradable: true, buildable: false,
    shop: { buy: 50, sell: 25 },
    perm: { baseAtk: 20, lifesteal: { chance: 0.02, pct: 0.5 } },
  },
  leather: {
    id: 'leather', name: '皮衣', category: C.PERMANENT,
    desc: '主角基础防御力+10。受到攻击时有6%概率回复12%生命值，可叠加。',
    craftable: false, tradable: true, buildable: false,
    shop: { buy: 50, sell: 25 },
    perm: { baseDef: 10, hurtHeal: { chanceFirst: 0.06, chanceStep: 0.04, pct: 0.12 } },
  },
  ironSword: {
    id: 'ironSword', name: '铁剑', category: C.PERMANENT,
    desc: '主角基础攻击力+30。主角每次使用主动技能攻击后，本场战斗中攻击力+4%，可叠加。',
    craftable: true, tradable: false, buildable: false,
    perm: { baseAtk: 30, combatAtkPerActive: 0.04 },
    craft: { base: { iron: 10 }, increment: { iron: 2 } },
  },
  armor: {
    id: 'armor', name: '盔甲', category: C.PERMANENT,
    desc: '主角基础最大生命值+250。主角每次受到伤害后，立即获得20护盾，可叠加。',
    craftable: true, tradable: false, buildable: false,
    perm: { baseMaxHp: 250, hurtShield: { first: 20, step: 10 } },
    craft: { base: { iron: 14 }, increment: { iron: 3 } },
  },
  luckyCoin: {
    id: 'luckyCoin', name: '幸运硬币', category: C.PERMANENT,
    desc: '战斗胜利时，有2%概率额外获得1次战斗奖励，可叠加。',
    literary: '永远会停留在你想要的那一面。',
    craftable: false, tradable: false, buildable: false,
    perm: { extraReward: 0.02 },
  },
 枯木新枝: {
    id: '枯木新枝', name: '枯木新枝', category: C.PERMANENT,
    desc: '探索中，每次移动后回复12点生命值，可叠加。',
    literary: '无论折断多少次，它总会长出新的枝丫。',
    craftable: false, tradable: false, buildable: false,
    perm: { moveHeal: 12 },
  },
  kuizuo: {
    id: 'kuizuo', name: '《愧怍》', category: C.PERMANENT,
    desc: '探索空地时，若什么也没有找到，则有50%概率获得补偿，可叠加。',
    literary: '一幅含义深刻的肖像画。',
    craftable: false, tradable: false, buildable: false,
    perm: { emptyCompensate: 0.50 },
  },
  windChime: {
    id: 'windChime', name: '风铃', category: C.PERMANENT,
    desc: '每日与陆悠悠聊天的成功率+2%，可叠加。',
    literary: '风吹过时有悦耳的声音，某人会特别喜欢。',
    craftable: false, tradable: false, buildable: false,
    perm: { chatBonusLyy: 0.02 },
  },
  woodBadge: {
    id: 'woodBadge', name: '伐木工徽章', category: C.PERMANENT,
    desc: '【唯一】。森林的最大生命值-50%。',
    literary: '精通伐木的证明。',
    craftable: false, tradable: false, buildable: false,
    perm: { forestHpPct: -0.50 }, unique: true,
  },
  mineBadge: {
    id: 'mineBadge', name: '矿工徽章', category: C.PERMANENT,
    desc: '【唯一】。矿脉的最大生命值-50%。',
    literary: '精通挖矿的证明。',
    craftable: false, tradable: false, buildable: false,
    perm: { mineHpPct: -0.50 }, unique: true,
  },

  // ---------- 地块物品（§3.4.2 / §3.9.1，存背包，可放置到 Void） ----------
  tilePlain: {
    id: 'tilePlain', name: '地块', category: C.MISC, subcat: '地块',
    desc: '一块可以铺在虚空上的无地形地块。',
    craftable: false, tradable: false, buildable: false,
    terrain: Terrain.NONE, placeTile: true,
  },
  tileGrass: {
    id: 'tileGrass', name: '草地块', category: C.MISC, subcat: '地块',
    desc: '铺上后成为草地地形的地块。',
    craftable: false, tradable: false, buildable: false,
    terrain: Terrain.GRASS, placeTile: true,
  },
  tileWater: {
    id: 'tileWater', name: '水地块', category: C.MISC, subcat: '地块',
    desc: '铺上后成为水面地形的地块。',
    craftable: false, tradable: false, buildable: false,
    terrain: Terrain.WATER, placeTile: true,
  },
  tileIce: {
    id: 'tileIce', name: '冰地块', category: C.MISC, subcat: '地块',
    desc: '铺上后成为冰面地形的地块。',
    craftable: false, tradable: false, buildable: false,
    terrain: Terrain.ICE, placeTile: true,
  },
  tileSnow: {
    id: 'tileSnow', name: '雪地块', category: C.MISC, subcat: '地块',
    desc: '铺上后成为雪地区形的地块。',
    craftable: false, tradable: false, buildable: false,
    terrain: Terrain.SNOW, placeTile: true,
  },
  tileForest: {
    id: 'tileForest', name: '森林地块', category: C.MISC, subcat: '地块',
    desc: '铺上后成为森林地形的地块。',
    craftable: false, tradable: false, buildable: false,
    terrain: Terrain.FOREST, placeTile: true,
  },
  tileMine: {
    id: 'tileMine', name: '矿脉地块', category: C.MISC, subcat: '地块',
    desc: '铺上后成为矿脉地形的地块。',
    craftable: false, tradable: false, buildable: false,
    terrain: Terrain.MINE, placeTile: true,
  },
};

export function getItem(id) { return ITEMS[id] ?? null; }

/** 商店商品（§6.5，固定预设，永不刷新） */
export const SHOP_ITEMS = Object.values(ITEMS)
  .filter((it) => it.shop)
  .map((it) => ({
    item: it.id,
    buy: it.shop.buy,
    sell: it.shop.sell ?? Math.ceil((it.shop.buy ?? 0) * 0.5),
  }));
