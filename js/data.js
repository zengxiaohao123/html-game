// =============================================================
// data.js — 静态数据表
// 注意：角色/技能/物品/任务数据等后续会重新设计，暂保留旧结构框架
// 新敌人 + 战斗场景配置 完整重写
// =============================================================

// ---------------------------------------------------------------
// 七种史莱姆 —— 敌人静态数据
// ---------------------------------------------------------------
// 所有史莱姆共享的基础数值
const SLIME_BASE = {
  atk: 10,
  def: 0,
  maxHp: 100,
  speed: 4,
  faction: 'enemy',
  allResist: 0,  // 所有元素抗性为 0
  healthPenalty: 1, // 战败主角健康减少 1（默认）
};

// 七种史莱姆元素亲和天赋
// 冰史莱姆额外免疫冻结；雷史莱姆额外免疫感电
const SLIME_AFFINITIES = {
  grass: { element: 'grass', extraImmune: [] },
  fire:  { element: 'fire',  extraImmune: [] },
  water: { element: 'water', extraImmune: [] },
  thunder:{ element: 'thunder', extraImmune: ['electrocute'] },
  ice:   { element: 'ice',   extraImmune: ['freeze'] },
  wind:  { element: 'wind',  extraImmune: [] },
  rock:  { element: 'rock',  extraImmune: [] },
};

const ELEMENT_NAME_CN = {
  grass: '草', fire: '火', water: '水', thunder: '雷',
  ice: '冰', wind: '风', rock: '岩',
};

// 七种史莱姆数据 —— 每个都有基础属性 + 专属技能/天赋/moveLogic
const SLIMES = {
  grass: {
    key: 'slime_grass',
    name: '草史莱姆',
    element: 'grass',
    ...SLIME_BASE,
    maxHp: 100,
    // --- 专属技能 ---
    uniqueSkills: [
      {
        kind: 'attack',
        name: '破土而出',
        desc: '瞬移到最近的一名我方单位周围 4 格随机 1 格，然后对周围 4 格造成相当于攻击力 75% 的草元素伤害。',
        effect: 'blinkAndAOE',
        param: { range: 4, mult: 0.75, element: 'grass' },
        cd: 0, // 一次性技能（每个史莱姆只有一个破土而出），或每回合都可放一次（等你后续确认）
        cdDecl: 1,
      },
    ],
    // --- 天赋 ---
    talents: [
      { kind: 'affinity', element: 'grass' },
      { kind: 'newbieFriend', days: 12, maxHpPenalty: 60 },  // 前 12 天 maxHp -60
    ],
    // --- 移动逻辑 ---
    moveLogic: {
      kind: 'hop',           // 蹦蹦跳跳
      defaultDir: 'cw',      // 默认顺时针
      cornerRule: 'cw',      // 拐弯按当前顺/逆时针方向决定
    },
  },

  fire: {
    key: 'slime_fire',
    name: '火史莱姆',
    element: 'fire',
    ...SLIME_BASE,
    // --- 专属技能 ---
    uniqueSkills: [],
    talents: [
      { kind: 'affinity', element: 'fire', immuneBurn: true },
    ],
    moveLogic: { kind: 'hop', defaultDir: 'cw', cornerRule: 'cw' },
    // --- 死亡触发 ---
    onDeath: {
      kind: 'selfDestruct',
      explosionDelay: 2,     // 2 个行动节点后爆炸
      explosionRange: 9,     // 周围 9 格
      explosionMult: 1.2,    // 120% 攻击力
      explosionElement: 'fire',
      explosionTarget: 'allEnemiesAndFriendlyUnits', // 不分敌我
      summonName: '即将爆炸的火史莱姆',
      summonFaction: 'neutral',  // 中立，不视为敌人
    },
  },

  water: {
    key: 'slime_water',
    name: '水史莱姆',
    element: 'water',
    ...SLIME_BASE,
    uniqueSkills: [
      {
        kind: 'support',
        name: '水泡',
        desc: '对目标当前所在位置投掷水泡。水史莱姆的下一个回合行动时，水泡落下，禁锢该格单位 2 回合。若我方移动离开当前位置，水泡会打空。',
        effect: 'waterBubble',
        param: { duration: 2, cd: 4 },
        cd: 0,
        cdDecl: 4,
        // 描述补充：水泡优先使用；用了本回合不移动；下回合水史莱姆自己行动时先结算水泡；冷却立即进入 4 回合
      },
    ],
    talents: [
      { kind: 'affinity', element: 'water' },
    ],
    moveLogic: { kind: 'hop', defaultDir: 'cw', cornerRule: 'cw' },
  },

  thunder: {
    key: 'slime_thunder',
    name: '雷史莱姆',
    element: 'thunder',
    ...SLIME_BASE,
    uniqueSkills: [],
    talents: [
      { kind: 'affinity', element: 'thunder', immuneElectrocute: true },
      {
        kind: 'conductive',
        desc: '每回合结束时，有 10% 概率对周围 5 格造成不分敌我的相当于攻击力 40% 的雷元素伤害。',
        trigger: 'roundEnd',  // 特殊说明：每回合结束（它自己的回合结束）
        param: { chance: 0.1, range: 5, mult: 0.4, element: 'thunder' },
      },
    ],
    moveLogic: { kind: 'hop', defaultDir: 'cw', cornerRule: 'cw' },
  },

  ice: {
    key: 'slime_ice',
    name: '冰史莱姆',
    element: 'ice',
    ...SLIME_BASE,
    uniqueSkills: [
      {
        kind: 'attack',
        name: '冰雾',
        desc: '向前方 3 格所有我方单位喷射冰雾，造成相当于攻击力 80% 的冰元素伤害。该攻击持续 2 回合，期间无法移动或转向或使用其他攻击。全部完成后进入冷却 5 回合。',
        effect: 'iceFog',
        param: {
          range: 3,
          mult: 0.8,
          element: 'ice',
          durationTurns: 2,   // 连续执行 2 次（两个敌方回合）
          cdAfterDuration: 5, // 全部打完才开始冷却 5
        },
        cd: 0,
        cdDecl: 5,
      },
    ],
    talents: [
      { kind: 'affinity', element: 'ice', immuneFreeze: true },
    ],
    moveLogic: { kind: 'hop', defaultDir: 'cw', cornerRule: 'cw' },
    // 攻击持续期间自动禁用移动/转向/其他技能
  },

  wind: {
    key: 'slime_wind',
    name: '风史莱姆',
    element: 'wind',
    ...SLIME_BASE,
    uniqueSkills: [],
    talents: [
      { kind: 'affinity', element: 'wind' },
    ],
    moveLogic: { kind: 'hop', defaultDir: 'cw', cornerRule: 'cw' },
    onDeath: {
      kind: 'windSwirl',
      desc: '被击败时（战斗未结束），将 2 格距离内的随机 1 格的所有单位传送至自身所在格，对这格上的我方单位额外造成相当于攻击力 40% 的风元素伤害。',
      param: { range: 2, mult: 0.4, element: 'wind' },
    },
  },

  rock: {
    key: 'slime_rock',
    name: '岩史莱姆',
    element: 'rock',
    ...SLIME_BASE,
    maxHp: Math.floor(SLIME_BASE.maxHp * 0.9),  // maxHp -10% = 90
    def: SLIME_BASE.def + 10,                     // def +10
    uniqueSkills: [],
    talents: [
      { kind: 'affinity', element: 'rock' },
      {
        kind: 'rockShield',
        desc: '每次被攻击（任何类型、任何来源、任何敌我、无论是否扣 HP，只要被命中），自身 def -1。结算时 clamp [0, 99999]。',
        param: { defPenaltyPerHit: 1, clampMin: 0, clampMax: 99999 },
      },
    ],
    moveLogic: { kind: 'hop', defaultDir: 'cw', cornerRule: 'cw' },
  },
};

const SLIME_KEYS = Object.keys(SLIMES);  // ['grass','fire','water','thunder','ice','wind','rock']

// ---------------------------------------------------------------
// 战斗场景配置（两种，替换所有旧的）
// ---------------------------------------------------------------
const BATTLE_SCENES = {
  slimeNormal: {
    key: 'slime_normal',
    label: '史莱姆时间',
    matchContentTypes: ['battle'],  // 地图上 content.type === 'battle' 时触发
    healthPenalty: 1,                // 战败主角健康 -1
    spawnPointsAtStart: 1,
    enemyGeneration: {
      turns: 3,                      // 前 3 回合
      perTurn: 1,                    // 每回合 1 只
      fromPool: SLIME_KEYS,          // 7 种史莱姆随机
      random: 'independent',         // 每次独立判定
    },
    rewards: {
      items: [
        { key: 'fruit', count: 3 },
      ],
      statChoice: '二选一',
      statChoices: [
        { kind: 'hp', amount: 5, text: '主角最大生命值 +5' },
        { kind: 'atk', amount: 1, text: '主角攻击力 +1' },
      ],
      statChoiceCount: 2,  // 二选一
    },
  },

  slimeEmergency: {
    key: 'slime_emergency',
    label: '史莱姆暴走！',
    matchContentTypes: ['emergency'],
    healthPenalty: 1,
    spawnPointsAtStart: 3,           // 3 个进攻点，优先避免重叠
    enemyGeneration: {
      turns: 3,
      perTurn: 1,
      fromPool: SLIME_KEYS,
      random: 'independent',
    },
    rewards: {
      items: [
        { key: 'fruit',  count: 3 },
        { key: 'wood',   count: 1 },
        { key: 'linen',  count: 1 },
      ],
      statChoice: '三选一',
      statChoices: [
        { kind: 'hp',   amount: 5, text: '主角最大生命值 +5' },
        { kind: 'atk',  amount: 1, text: '主角攻击力 +1' },
        { kind: 'def',  amount: 1, text: '主角防御力 +1' },
      ],
      statChoiceCount: 3,  // 三选一
    },
  },
};

// 根据 content.type 查战斗场景
function getBattleSceneByContentType(ct) {
  for (const scene of Object.values(BATTLE_SCENES)) {
    if (scene.matchContentTypes.includes(ct)) return scene;
  }
  return null;
}

// ---------------------------------------------------------------
// 角色静态数据（保留旧结构框架 —— 后续重新设计时替换）
// 说明：主角和队友是主角方，目前无头像（用指示点表示）
// ---------------------------------------------------------------
const HERO_BASE_DATA = {
  // 旧数据占位，具体数值后续重新设计
  key: 'pro',
  name: '主角',
  kind: 'hero',
  faction: 'player',
};

const ALLY_BASE_DATA = [
  // 旧队友数据占位，后续重新设计
];

// ---------------------------------------------------------------
// 物品/合成/任务等静态表（保留旧结构框架，后续替换）
// ---------------------------------------------------------------
// ITEMS, CRAFTS, QUESTS 等常量 —— 暂保留旧结构，后续替换

// ---------------------------------------------------------------
// 技能数据（保留旧结构框架 —— 后续重新设计时替换）
// ---------------------------------------------------------------
// SKILLS, SKILL_GROUPS 相关常量 —— 暂保留旧结构，后续替换

// ---------------------------------------------------------------
// 导出
// ---------------------------------------------------------------
window.DATA = {
  SLIMES,
  SLIME_KEYS,
  SLIME_BASE,
  SLIME_AFFINITIES,
  BATTLE_SCENES,
  getBattleSceneByContentType,
  HERO_BASE_DATA,
  ALLY_BASE_DATA,
  ELEMENT_NAME_CN,
};
