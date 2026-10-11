/**
 * data/enemies.js —— 敌人模板（§4.13）
 *
 * 敌人 = 数据模板，本身不绑定奖励（奖励由战斗节点 §4.14 配置）。
 * 技能用声明式 effects（同 skills.js DSL）。
 * 意图 intent：
 *   type: 'always' 固定技能 / 'random' 权重 / 'script' 剧本序列
 * 天赋 talents.impl 在引擎中实现（新手之友、自爆、狗友、成长……）。
 *
 * "逻辑/备注"字段仅供内部，不展示给玩家。
 */

import { Element } from '../core/Const.js';

const dmg = (element, multiplier, extra = {}) => ({
  kind: 'damage', element, dmgKind: element === 'physical' ? 'physical' : 'elementProperty',
  multiplier, hits: 1, target: { select: 'leader' }, ...extra,
});
const dmgRandomAlly = (element, multiplier, extra = {}) => ({
  kind: 'damage', element, dmgKind: element === 'physical' ? 'physical' : 'elementProperty',
  multiplier, hits: 1, target: { select: 'randomAlly' }, ...extra,
});

// ---------------- 7 元素史莱姆（共性 20/0/100/speed4） ----------------
function slimeVariant(element, extra) {
  return {
    atk: 20, def: 0, maxHp: 100, speed: 4,
    resists: { [element]: 0 },
    talents: [
      { impl: 'newbieFriend' },                       // 前12天 -60血 -10攻
      { impl: 'elementAffinity', element },           // 免疫本元素伤、总附本元素
      ...(extra.talents || []),
    ],
    skills: extra.skills,
    intent: extra.intent,
  };
}

const SLIME_SKILLS = {
  impact: { id: 'slime_impact', name: '撞击', type: 'attack', desc: '造成 100% 攻击力物理伤害。', effects: [dmgRandomAlly('physical', 1.0)] },
  emerge: { id: 'grass_emerge', name: '破土而出', type: 'attack', desc: '对随机 1 名我方单位及其左右 1 格造成 120% 攻击力物理伤害。',
    effects: [dmgRandomAlly('physical', 1.2, { target: { select: 'randomAllyAndSide1' } })] },
  bubble: { id: 'water_bubble', name: '泡泡浴', type: 'support', desc: '使自身及场上除自身外生命值最低的敌人回复 75% 攻击力的生命值。',
    effects: [{ kind: 'heal', pctOfCasterAtk: 0.75, target: { select: 'lowestHpOtherEnemy' } }] },
  icefog: { id: 'ice_fog', name: '冰雾', type: 'attack', charge: 1, desc: '蓄力后对我方右侧 3 格造成 100% 攻击力冰元素伤害。',
    effects: [dmg('ice', 1.0, { dmgKind: 'elementReact', target: { select: 'allyRight3' } })] },
};

export const ENEMIES = {
  // ---- 草 ----
  slimeGrass: {
    id: 'slimeGrass', name: '草史莱姆', sprite: 'slime.grass',
    ...slimeVariant('grass', {
      skills: [SLIME_SKILLS.emerge, SLIME_SKILLS.impact],
      intent: { type: 'script', seq: ['grass_emerge', 'slime_impact', 'slime_impact'] },
    }),
  },
  // ---- 火（自爆） ----
  slimeFire: {
    id: 'slimeFire', name: '火史莱姆', sprite: 'slime.fire',
    ...slimeVariant('fire', {
      talents: [{ impl: 'elementAffinity', element: 'fire', immuneBurn: true }, { impl: 'selfDestruct' }],
      skills: [SLIME_SKILLS.impact],
      intent: { type: 'always', skill: 'slime_impact' },
    }),
  },
  // ---- 水 ----
  slimeWater: {
    id: 'slimeWater', name: '水史莱姆', sprite: 'slime.water',
    ...slimeVariant('water', {
      skills: [SLIME_SKILLS.impact, SLIME_SKILLS.bubble],
      intent: { type: 'random', table: [{ skill: 'slime_impact', w: 1 }, { skill: 'water_bubble', w: 1 }], skipIf: { water_bubble: 'allEnemyFullHp' } },
    }),
  },
  // ---- 雷 ----
  slimeThunder: {
    id: 'slimeThunder', name: '雷史莱姆', sprite: 'slime.thunder',
    ...slimeVariant('thunder', {
      talents: [{ impl: 'elementAffinity', element: 'thunder', immuneElectro: true }, { impl: 'conductive' }],
      skills: [SLIME_SKILLS.impact],
      intent: { type: 'always', skill: 'slime_impact' },
    }),
  },
  // ---- 冰 ----
  slimeIce: {
    id: 'slimeIce', name: '冰史莱姆', sprite: 'slime.ice',
    ...slimeVariant('ice', {
      talents: [{ impl: 'elementAffinity', element: 'ice', immuneFreeze: true }, { impl: 'icefogPattern' }],
      skills: [SLIME_SKILLS.impact, SLIME_SKILLS.icefog],
      // 冰雾：蓄力1→连续3次→冷却5；被打断立即进冷却；冷却或无目标用撞击
      intent: { type: 'special', impl: 'icefogPattern' },
    }),
  },
  // ---- 风 ----
  slimeWind: {
    id: 'slimeWind', name: '风史莱姆', sprite: 'slime.wind',
    ...slimeVariant('wind', {
      talents: [{ impl: 'windSwirl' }],
      skills: [SLIME_SKILLS.impact],
      intent: { type: 'always', skill: 'slime_impact' },
    }),
  },
  // ---- 岩 ----
  slimeRock: {
    id: 'slimeRock', name: '岩史莱姆', sprite: 'slime.rock',
    ...slimeVariant('rock', {
      talents: [{ impl: 'rockShield' }],
      skills: [SLIME_SKILLS.impact],
      intent: { type: 'always', skill: 'slime_impact' },
    }),
  },

  // ---- 奇怪的史莱姆（奖励型） ----
  strangeSlime: {
    id: 'strangeSlime', name: '奇怪的史莱姆',
    atk: 0, def: 0, maxHp: 599, speed: 0,
    talents: [],
    skills: [{
      id: 'strange_spit', name: '吐果子', type: 'support',
      desc: '使 1 名我方单位回复 200 生命值，自身流失 200 生命值（可致死）。',
      effects: [
        { kind: 'heal', flat: 200, target: { select: 'randomAlly' } },
        { kind: 'selfLoseHp', flat: 200 },
      ],
    }],
    intent: { type: 'always', skill: 'strange_spit' },
  },

  // ---- 人类小怪 ----
  chuuniBoy: {
    id: 'chuuniBoy', name: '中二病男孩', tier: 'normal',
    atk: 15, def: 0, maxHp: 20, speed: 10,
    talents: [
      { impl: 'comeBack', perDefeat: { atk: 15, hp: 40, speed: 5, xp: 3 }, max: 5, global: true },
      { impl: 'dodgeRate', value: 0.20 },
      { impl: 'amaterasu' },
    ],
    skills: [{ id: 'chuuni_slash', name: '稻草剑法', type: 'attack', desc: '100% 物理伤害。', effects: [dmgRandomAlly('physical', 1.0)] }],
    intent: { type: 'always', skill: 'chuuni_slash' },
  },
  littleSnake: {
    id: 'littleSnake', name: '小小蛇', tier: 'normal',
    atk: 15, def: 0, maxHp: 150, speed: 4,
    talents: [
      { impl: 'firstActionFear' },
      { impl: 'poisonBite', stacks: 14, chance: 0.50 },
    ],
    skills: [
      { id: 'snake_bite', name: '撕咬', type: 'attack', desc: '100% 物理伤害，命中 50% 施加 14 层中毒。', effects: [dmgRandomAlly('physical', 1.0, { onHit: { chance: 0.50, buff: { buffId: 'poison', stacks: 14 } } })] },
      { id: 'snake_coil', name: '缠绕', type: 'support', desc: '获得 1 回合 50% 减伤。', effects: [{ kind: 'buff', buffId: 'damageReduce', value: 0.50, duration: 1, target: { select: 'self' } }] },
    ],
    intent: { type: 'script', seq: ['snake_bite', 'snake_coil'] }, // 奇撕咬偶缠绕
  },
  bambooViper: {
    id: 'bambooViper', name: '竹叶青', tier: 'elite',
    atk: 20, def: 0, maxHp: 300, speed: 13,
    talents: [{ impl: 'poisonBite', stacks: 19, chance: 1.0 }],
    skills: [
      { id: 'viper_bite', name: '撕咬', type: 'attack', desc: '100% 物理伤害，施加 19 层中毒。', effects: [dmgRandomAlly('physical', 1.0, { onHit: { chance: 1.0, buff: { buffId: 'poison', stacks: 19 } } })] },
      { id: 'viper_coil', name: '恐惧缠绕', type: 'support', desc: '获得 1 回合 50% 减伤；对主角施加 1 回合恐惧。',
        effects: [
          { kind: 'buff', buffId: 'damageReduce', value: 0.50, duration: 1, target: { select: 'self' } },
          { kind: 'buff', buffId: 'fear', duration: 1, target: { select: 'leader' } },
        ] },
    ],
    intent: { type: 'script', seq: ['viper_bite', 'viper_coil'] },
  },

  // ---- 古树 ----
  ancientTree: {
    id: 'ancientTree', name: '古树', tier: 'normal',
    atk: 20, def: 0, maxHp: 799, speed: 0,
    talents: [{ impl: 'thornCounter' }, { impl: 'fleeAtRound', round: 10 }],
    skills: [
      { id: 'tree_wait', name: '等待', type: 'support', desc: '静静伫立。', effects: [] },
      { id: 'tree_run', name: '长脚就跑！', type: 'support', desc: '逃跑（视为玩家胜利）。', effects: [{ kind: 'flee' }] },
    ],
    intent: { type: 'scriptWait', waitSkill: 'tree_wait', untilRound: 10, thenSkill: 'tree_run' },
  },

  // ---- 猎犬 ----
  hound: {
    id: 'hound', name: '猎犬', tier: 'normal',
    atk: 10, def: 0, maxHp: 60, speed: 15,
    talents: [
      { impl: 'dailyGrowth', atkPct: 0.05, hpPct: 0.05, speed: 1, max: 20 },
      { impl: 'dogFriends', table: [{ count: 1, p: 0.80 }, { count: 2, p: 0.15 }, { count: 3, p: 0.05 }], spawn: 'hound' },
    ],
    skills: [{ id: 'hound_bite', name: '撕咬', type: 'attack', desc: '100% 物理伤害。', effects: [dmgRandomAlly('physical', 1.0)] }],
    intent: { type: 'always', skill: 'hound_bite' },
  },
  houndPro: {
    id: 'houndPro', name: '猎犬 Pro', tier: 'elite',
    atk: 35, def: 0, maxHp: 150, speed: 25,
    talents: [
      { impl: 'dailyGrowth', atkPct: 0.08, hpPct: 0.10, speed: 1, max: 20 },
      { impl: 'dogFriends', table: [{ count: 1, spawn: 'hound', p: 0.80 }, { count: 1, spawn: 'houndPro', p: 0.20 }] },
    ],
    skills: [{ id: 'houndpro_bite', name: '撕咬', type: 'attack', desc: '100% 物理伤害。', effects: [dmgRandomAlly('physical', 1.0)] }],
    intent: { type: 'always', skill: 'houndpro_bite' },
  },

  // ---- 镖客 ----
  blueDart: {
    id: 'blueDart', name: '蓝羽镖客', tier: 'normal',
    atk: 12, def: 0, maxHp: 120, speed: 4,
    talents: [{ impl: 'deadlyRhythm', value: 8 }],
    skills: [
      { id: 'blue_feather', name: '飞羽', type: 'attack', desc: '100% 物理伤害。', effects: [dmgRandomAlly('physical', 1.0)] },
      { id: 'blue_blink', name: '飘忽不定', type: 'support', desc: '瞬移至 2 格距离内随机空格。', effects: [{ kind: 'teleport', range: 2 }] },
    ],
    intent: { type: 'special', impl: 'dartPattern', every: 3, blink: 'blue_blink', attack: 'blue_feather' },
  },
  redDart: {
    id: 'redDart', name: '红羽镖客', tier: 'elite',
    atk: 16, def: 0, maxHp: 180, speed: 12,
    talents: [{ impl: 'deadlyRhythm', value: 8 }],
    skills: [
      { id: 'red_feather', name: '飞羽', type: 'attack', desc: '100% 物理伤害。', effects: [dmgRandomAlly('physical', 1.0)] },
      { id: 'red_blink', name: '飘忽不定+', type: 'support', desc: '瞬移至全场随机空格。', effects: [{ kind: 'teleport', range: -1 }] },
    ],
    intent: { type: 'special', impl: 'dartPattern', every: 3, blink: 'red_blink', attack: 'red_feather' },
  },

  // ---- 暴躁的熊 ----
  angryBear: {
    id: 'angryBear', name: '暴躁的熊', tier: 'elite', rare: true,
    atk: 50, def: 10, maxHp: 800, speed: 0,
    resists: { physical: 0.20 },
    talents: [
      { impl: 'hibernate', rounds: 3 },
      { impl: 'rage' },
      { impl: 'rareCreature' },
    ],
    skills: [
      { id: 'bear_slap', name: '掌掴', type: 'attack', desc: '80% 物理伤害；狂躁期对最近的我方单位造成 100%。', effects: [dmgRandomAlly('physical', 0.8)] },
      { id: 'bear_roar', name: '怒吼', type: 'support', cooldown: 4, desc: '降低所有我方单位 20 点防御力。',
        effects: [{ kind: 'defDownAllAlly', flat: 20 }] },
    ],
    intent: { type: 'special', impl: 'bearPattern' },
  },

  // ---- 机关 ----
  abandonedMech: {
    id: 'abandonedMech', name: '遗弃机关', tier: 'elite',
    atk: 40, def: 10, maxHp: 260, speed: 4,
    resists: { fire: 0.20, water: 0.20, grass: 0.20, thunder: 0.20, ice: 0.20, wind: 0.20, rock: 0.20 },
    talents: [],
    skills: [
      { id: 'mech_patrol', name: '巡逻', type: 'support', desc: '随机向左/右移动 1 格。', effects: [{ kind: 'moveRandomSide', distance: 1 }] },
      { id: 'mech_trample', name: '践踏', type: 'attack', desc: '对随机我方及其左右 1 格造成不分敌我 100% 物理伤害。',
        effects: [dmgRandomAlly('physical', 1.0, { target: { select: 'randomAllyAndSide1' } })] },
      { id: 'mech_missile', name: '飞弹', type: 'attack', desc: '朝左发射 3 枚飞弹，各造成 40% 物理伤害。',
        effects: [{ kind: 'missilesLeft', shots: 3, multiplier: 0.40 }] },
      { id: 'mech_sweep', name: '大清扫', type: 'attack', charge: 1, maxConsecutive: 3, cooldown: 6, desc: '蓄力后对所有我方造成 140% 物理伤害。',
        effects: [{ kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 1.4, target: { select: 'allAlly' } }] },
    ],
    intent: { type: 'special', impl: 'mechPattern' },
  },
  ironLump: {
    id: 'ironLump', name: '铁疙瘩', tier: 'elite',
    atk: 40, def: 20, maxHp: 500, speed: 10,
    resists: { physical: 1.00 },
    talents: [],
    skills: [
      { id: 'iron_smash', name: '重砸', type: 'attack', desc: '对随机我方及其左右 1 格造成 75% 物理伤害。',
        effects: [dmgRandomAlly('physical', 0.75, { target: { select: 'randomAllyAndSide1' } })] },
      { id: 'iron_ram', name: '撞击', type: 'attack', desc: '对随机我方造成 100% 物理伤害。', effects: [dmgRandomAlly('physical', 1.0)] },
      { id: 'iron_fortify', name: '自我加固', type: 'support', desc: '防御力 +10、攻击力 +20。',
        effects: [{ kind: 'selfBuff', atk: 20, def: 10 }] },
    ],
    intent: { type: 'special', impl: 'ironPattern' },
  },
};

export function getEnemy(id) { return ENEMIES[id] ?? null; }

export const SLIME_IDS = ['slimeGrass', 'slimeFire', 'slimeWater', 'slimeThunder', 'slimeIce', 'slimeWind', 'slimeRock'];

/** 绽放反应召唤物：草史莱姆（§4.12） */
export const SUMMONS = {
  grassSlimeSummon: {
    id: 'grassSlimeSummon', name: '草史莱姆（召唤）',
    atk: 10, def: 0, maxHp: 20, speed: null,
    isSummon: true,
    talents: [{ impl: 'summonGrowth' }],
    skills: [SLIME_SKILLS.emerge, SLIME_SKILLS.impact],
    intent: { type: 'script', seq: ['grass_emerge', 'slime_impact', 'slime_impact'] },
  },
};

/** 火史莱姆自爆残留物（不算敌人，不影响胜利判定） */
export const BOMB_RESIDUE = {
  id: 'fireSlimeBomb', name: '即将爆炸的火史莱姆',
  isResidue: true, notEnemy: true,
  skills: [{ id: 'bomb_explode', name: '爆炸', effects: [{ kind: 'bombAfter', turns: 2, multiplier: 0.60, element: 'fire', range: 'side1' }] }],
};
