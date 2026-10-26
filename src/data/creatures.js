// src/data/creatures.js
// Phase 3 —— 生物定义：小鸡 / 鸡 / 史莱姆 7 元素变体
// 设计文档 §13

/**
 * 生物分类（capacity 类型）：
 *   friendly —— 友善，小鸡/鸡
 *   danger   —— 危险，史莱姆
 *   extreme  —— 极度危险（Phase 3 先不生成，预留）
 */

export const CREATURES = {
  // ── 友善 ──
  chick: {
    kind: 'chick',
    name: '小鸡',
    emoji: '🐣',
    category: 'friendly',
    stage: 'chick',
    hp: 50,
    atk: 0,
    element: null,
    elementImmune: null,
    growthMax: 100,   // 成长值满 → 变鸡
    mood: 0,
    moveEverySec: 2,  // 每 2 秒换方向走 1 格
  },
  chicken: {
    kind: 'chicken',
    name: '鸡',
    emoji: '🐔',
    category: 'friendly',
    stage: 'adult',
    hp: 100,
    atk: 0,
    element: null,
    elementImmune: null,
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
  },

  // ── 危险：史莱姆 7 元素变体 ──
  slime_fire: {
    kind: 'slime_fire',
    name: '火史莱姆',
    emoji: '🟠',
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'fire',
    elementImmune: 'fire',
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
  },
  slime_water: {
    kind: 'slime_water',
    name: '水史莱姆',
    emoji: '🔵',
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'water',
    elementImmune: 'water',
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
  },
  slime_thunder: {
    kind: 'slime_thunder',
    name: '雷史莱姆',
    emoji: '🟡',
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'thunder',
    elementImmune: 'thunder',
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
  },
  slime_ice: {
    kind: 'slime_ice',
    name: '冰史莱姆',
    emoji: '🧊',
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'ice',
    elementImmune: 'ice',
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
  },
  slime_grass: {
    kind: 'slime_grass',
    name: '草史莱姆',
    emoji: '🟢',
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'grass',
    elementImmune: 'grass',
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
  },
  slime_wind: {
    kind: 'slime_wind',
    name: '风史莱姆',
    emoji: '🌀',
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'wind',
    elementImmune: 'wind',
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
  },
  slime_rock: {
    kind: 'slime_rock',
    name: '岩史莱姆',
    emoji: '🪨',
    category: 'danger',
    stage: 'adult',
    hp: 40,
    atk: 10,
    element: 'rock',
    elementImmune: 'rock',
    growthMax: 0,
    mood: 0,
    moveEverySec: 2,
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
