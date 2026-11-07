// src/data/creatures.js
// Phase 3 —— 生物定义：小鸡 / 鸡 / 史莱姆 7 元素变体
// 设计文档 §13

/**
 * 生物分类（capacity 类型）：
 *   friendly —— 友善，小鸡/鸡
 *   danger   —— 危险，史莱姆
 *   extreme  —— 高危（Phase 3 先不生成，预留）
 */


// 玩家可见正文（设计文档 §13.3 逐字，按语义分行）；note 永不出现在 UI
const CHICK_DESC = '生命值 50，攻击力 0，抗性均为 0。成长值初始 0，心情值初始 0。\n每一日开始时消耗对应鸡舍内的稻草 ×1 或小麦 ×1，变为【已投喂】；或在栅栏内自由移动经过草地形时消耗 1 草元素量，下一日开始无需消耗即【已投喂】。两者都不满足则【饥饿】。\n已投喂：成长值 +（10 + 心情值）。饥饿：心情 -1，成长值 +5。\n来自鸡舍：玩家每次进入鸡舍心情 +1（每日限 1 次）；其他方式心情固定 0。\n成长值满 → 变为鸡。通常不受攻击，被击败掉生肉 ×1。';
const CHICKEN_DESC = '生命值 100，攻击力 0，心情值初始 0。\n投喂机制同小鸡。\n已投喂：产 1 个鸡蛋，并有（心情值 ×10%）概率产优质鸡蛋（心情负视为 0%）。饥饿：心情 -1。\n来自鸡舍：进鸡舍心情 +1（每日限 1 次）；其他方式心情固定 0。\n通常不受攻击，被击败掉生肉 ×3。';
const SLIME_DESC = '生命值 40，攻击力 10，抗性 0。\n【元素免疫】7 种类型，免疫自身对应元素伤害。\n【粘液喷吐】每一日开始时 5% 概率对随机 1 格施加【粘液】debuff。危险生物容量超负荷时改为 15%。\n被击败掉落史莱姆凝胶 ×1。';

export const CREATURES = {
  // ── 友善 ──
  chick: {
    kind: 'chick',
    name: '小鸡',
    emoji: '🐣',
    icon: null,
    description: CHICK_DESC,
    category: 'friendly',
    stage: 'chick',
    hp: 50,
    atk: 0,
    element: null,
    elementImmune: null,
    growthMax: 100,   // 成长值满 → 变鸡
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.167 米（1 格边长 = 1 米）= 1 格可排 6 只小鸡（3×2，直径 1/3 米）
    radius: 1 / 6,
    // 连续移动（§2.3）：秒/格，合法区间 3~6；小鸡体型最轻 → 取最快 3.0 秒/格（待美术/手感细调）
    speedPerTile: 3.0,
    // 以草为食：栅栏内走到草地消耗 1 草元素量即可达成当日「已投喂」（§13.3）
    feedByGrass: true,
    drops: [{ itemId: 'item_raw_meat', qty: 1 }], // BIO-001 击败掉落：生肉 ×1
  },
  chicken: {
    kind: 'chicken',
    name: '鸡',
    emoji: '🐔',
    icon: null,
    description: CHICKEN_DESC,
    category: 'friendly',
    stage: 'adult',
    hp: 100,
    atk: 0,
    element: null,
    elementImmune: null,
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25 米（1 格边长 = 1 米）= 1 格可排 4 只鸡（2×2）
    radius: 0.25,
    // 秒/格：成鸡体型更大、步态更沉 → 4.2 秒/格（区间内取值，待手感细调）
    speedPerTile: 4.2,
    // 以草为食：栅栏内走到草地消耗 1 草元素量即可达成当日「已投喂」（§13.3）
    feedByGrass: true,
    drops: [{ itemId: 'item_raw_meat', qty: 3 }], // BIO-002 击败掉落：生肉 ×3
  },

  // ── 危险：史莱姆 7 元素变体 ──
  slime_fire: {
    kind: 'slime_fire',
    name: '火史莱姆',
    emoji: '🟠',
    icon: 'assets/images/enemies/slime_fire.png',
    description: SLIME_DESC,
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'fire',
    elementImmune: 'fire',
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25（无逐种依据，统一按 0.25，待定）
    radius: 0.25,
    // 秒/格：史莱姆移动最慢 → 5.0 秒/格（区间内取值，无逐种依据，待定）
    speedPerTile: 5.0,
    drops: [{ itemId: 'item_slime_gel', qty: 1 }], // BIO-003 击败掉落：史莱姆凝胶 ×1
  },
  slime_water: {
    kind: 'slime_water',
    name: '水史莱姆',
    emoji: '🔵',
    icon: 'assets/images/enemies/slime_water.png',
    description: SLIME_DESC,
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'water',
    elementImmune: 'water',
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25（无逐种依据，统一按 0.25，待定）
    radius: 0.25,
    // 秒/格：史莱姆移动最慢 → 5.0 秒/格（区间内取值，无逐种依据，待定）
    speedPerTile: 5.0,
    drops: [{ itemId: 'item_slime_gel', qty: 1 }], // BIO-003 击败掉落：史莱姆凝胶 ×1
  },
  slime_thunder: {
    kind: 'slime_thunder',
    name: '雷史莱姆',
    emoji: '🟡',
    icon: 'assets/images/enemies/slime_thunder.png',
    description: SLIME_DESC,
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'thunder',
    elementImmune: 'thunder',
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25（无逐种依据，统一按 0.25，待定）
    radius: 0.25,
    // 秒/格：史莱姆移动最慢 → 5.0 秒/格（区间内取值，无逐种依据，待定）
    speedPerTile: 5.0,
    drops: [{ itemId: 'item_slime_gel', qty: 1 }], // BIO-003 击败掉落：史莱姆凝胶 ×1
  },
  slime_ice: {
    kind: 'slime_ice',
    name: '冰史莱姆',
    emoji: '🧊',
    icon: 'assets/images/enemies/slime_ice.png',
    description: SLIME_DESC,
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'ice',
    elementImmune: 'ice',
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25（无逐种依据，统一按 0.25，待定）
    radius: 0.25,
    // 秒/格：史莱姆移动最慢 → 5.0 秒/格（区间内取值，无逐种依据，待定）
    speedPerTile: 5.0,
    drops: [{ itemId: 'item_slime_gel', qty: 1 }], // BIO-003 击败掉落：史莱姆凝胶 ×1
  },
  slime_grass: {
    kind: 'slime_grass',
    name: '草史莱姆',
    emoji: '🟢',
    icon: 'assets/images/enemies/slime_grass.png',
    description: SLIME_DESC,
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'grass',
    elementImmune: 'grass',
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25（无逐种依据，统一按 0.25，待定）
    radius: 0.25,
    // 秒/格：史莱姆移动最慢 → 5.0 秒/格（区间内取值，无逐种依据，待定）
    speedPerTile: 5.0,
    drops: [{ itemId: 'item_slime_gel', qty: 1 }], // BIO-003 击败掉落：史莱姆凝胶 ×1
  },
  slime_wind: {
    kind: 'slime_wind',
    name: '风史莱姆',
    emoji: '🌀',
    icon: 'assets/images/enemies/slime_wind.png',
    description: SLIME_DESC,
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'wind',
    elementImmune: 'wind',
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25（无逐种依据，统一按 0.25，待定）
    radius: 0.25,
    // 秒/格：史莱姆移动最慢 → 5.0 秒/格（区间内取值，无逐种依据，待定）
    speedPerTile: 5.0,
    drops: [{ itemId: 'item_slime_gel', qty: 1 }], // BIO-003 击败掉落：史莱姆凝胶 ×1
  },
  slime_rock: {
    kind: 'slime_rock',
    name: '岩史莱姆',
    emoji: '🪨',
    icon: 'assets/images/enemies/slime_rock.png',
    description: SLIME_DESC,
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'rock',
    elementImmune: 'rock',
    growthMax: 0,
    mood: 0,
    // 空间几何（设计文档 §2.2）：半径 0.25（无逐种依据，统一按 0.25，待定）
    radius: 0.25,
    // 秒/格：史莱姆移动最慢 → 5.0 秒/格（区间内取值，无逐种依据，待定）
    speedPerTile: 5.0,
    drops: [{ itemId: 'item_slime_gel', qty: 1 }], // BIO-003 击败掉落：史莱姆凝胶 ×1
  },
};

export const SLIME_KINDS = [
  'slime_fire', 'slime_water', 'slime_thunder', 'slime_ice',
  'slime_grass', 'slime_wind', 'slime_rock',
];

export const ALL_CREATURE_IDS = Object.keys(CREATURES);

export function getCreatureDef(kind) {
  return CREATURES[kind] || null;
}
