/**
 * core/Const.js —— 全游戏枚举与常量（与设计文档术语一一对应）
 */

// 顶层状态机
export const TopState = Object.freeze({
  EXPLORE: 'EXPLORE',
  COMBAT: 'COMBAT',
});

// 地形（§3.2.1）
export const Terrain = Object.freeze({
  NONE: 'none',     // 无地形
  MOUNTAIN: 'mountain',
  WATER: 'water',
  GRASS: 'grass',
  ICE: 'ice',
  SNOW: 'snow',
  LAVA: 'lava',
  FOREST: 'forest',
  MINE: 'mine',
});

/** 地形 → 总是附着的元素（无则 null） */
export const TERRAIN_AURA = Object.freeze({
  water: 'water',
  grass: 'grass',
  snow: 'ice',
  lava: 'fire',
  none: null, mountain: null, ice: null, forest: null, mine: null,
});

/** 不可进入地形 */
export const BLOCKED_TERRAIN = new Set([Terrain.MOUNTAIN, Terrain.FOREST, Terrain.MINE]);

// 地块内容（§3.4）
export const ContentType = Object.freeze({
  EMPTY: 'empty',
  EVENT: 'event',
  BATTLE: 'battle',
  ELITE: 'elite',
  REWARD: 'reward',
});

/** 每日 content 刷新概率（§3.8.2） */
export const CONTENT_ROLL = Object.freeze([
  { type: 'empty', p: 0.40 },
  { type: 'event', p: 0.20 },
  { type: 'battle', p: 0.15 },
  { type: 'elite', p: 0.15 },
  { type: 'reward', p: 0.10 },
]);

// 区域（§3.4.1）
export const Area = Object.freeze({ WILD: 'wild', CITY: 'city' });

// 元素（§4.4.1）
export const Element = Object.freeze({
  FIRE: 'fire', WATER: 'water', GRASS: 'grass',
  THUNDER: 'thunder', ICE: 'ice', WIND: 'wind', ROCK: 'rock',
});
export const ALL_ELEMENTS = ['fire', 'water', 'grass', 'thunder', 'ice', 'wind', 'rock'];

export const ELEMENT_NAME = Object.freeze({
  fire: '火', water: '水', grass: '草', thunder: '雷',
  ice: '冰', wind: '风', rock: '岩', physical: '物理',
});

// 伤害类型（x属性伤害 / x元素伤害 区分）
export const DamageKind = Object.freeze({
  PHYSICAL: 'physical',                 // 物理，不附着
  ELEMENT_PROPERTY: 'elementProperty',  // x 属性伤害：伤害不附着
  ELEMENT_REACT: 'elementReact',        // x 元素伤害：先附着→反应→再伤害
  TRUE: 'true',                         // 真实伤害
});

// 技能分类（§4.5.1）
export const SkillType = Object.freeze({
  ACTIVE: 'active',
  CHAIN: 'chain',
  TALENT: 'talent',
});

// 背包六分类（§6.2）
export const InvCategory = Object.freeze({
  CONSUMABLE: 'consumable',
  PERMANENT: 'permanent',
  FACILITY: 'facility',
  QUEST: 'quest',
  ELEMENT: 'element',
  MISC: 'misc',
});

// 战斗结果（§4.10.1）
export const BattleResult = Object.freeze({
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT',
  FLEE: 'FLEE_SUCCESS',
});

// 全局常量
export const CONFIG = Object.freeze({
  START_MAP_SIZE: 3,        // 初始 3×3
  AP_MAX_START: 5,          // 初始 AP 上限
  HEALTH_START: 30,         // 初始健康
  HERO_HP_START: 100,
  HERO_ATK_START: 10,
  HERO_DEF_START: 0,
  HERO_SPEED_START: 100,
  HERO_LEVEL_CAP: 999,
  BATTLE_ROW: 5,            // 每阵营 5 格
  HAND_SIZE: 5,             // 元素手牌
  ACTIVE_SKILL_CAP: 4,      // 整队主动上限
  SAVE_SLOTS: 8,            // 存档槽
  AUTO_SLOT: 0,             // 自动存档位（1 号）
  CHAIN_WINDOW_MS: 2000,    // 连携窗口 2 秒
  RESIST_MIN: -1.0,
  RESIST_MAX: 0.95,
});

// 面板快捷键（§3.13.3）
export const PanelKey = Object.freeze({
  j: 'quest', b: 'inventory', e: 'craft', q: 'build',
  c: 'character', l: 'party', v: 'shop',
});

// 行动记录/日志类型
export const LogKind = Object.freeze({
  INFO: 'info', GOOD: 'good', BAD: 'bad', REACTION: 'reaction', SYSTEM: 'system',
});
