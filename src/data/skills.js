/**
 * data/skills.js —— 角色技能（§5.6）与技能效果 DSL
 *
 * 技能用声明式 effects 描述，由战斗引擎 CombatEngine 解释执行。
 * 目标选择 / 范围 / 附着 / 反应 / 增益统一在引擎结算，避免在数据里写逻辑。
 *
 * 常用 effect 类型（详见 systems/CombatEngine.js）：
 *   damage: { element, kind, multiplier, hits, target:{select,range} }
 *   aura:   { element, target }                         施加元素附着
 *   buff:   { id, stat, value, duration, target, ... }  增益/减益
 *   shield: { value|pct, target }
 *   heal:   { pctOfCasterAtk|flat, target }
 *   summon: { unitId, side:'caster'|'enemy', count }
 *   consumeAura:{ element?, count }                     吸收附着
 *   consumeHand:{ [element]:n }                         消耗元素手牌
 *   selfHpCost:{ pct }                                  自身流失生命
 *   teleport/knockback/… 按需扩展
 *
 * target.select：
 *   selected 指示器主目标； randomEnemy / randomAlly / lowestHpEnemy …
 *   leftmostEnemy / allEnemy / sideLeft3 等位置语义（§4.1）
 * target.range：self/1/left1/right1/sideLeft3/row…
 */

import { SkillType, Element } from '../core/Const.js';

// ---------------- 主角（无元素） ----------------
const hero = {
  id: 'hero', name: '余默', isLeader: true,
  base: { atk: 10, maxHp: 100, def: 0, speed: 100 },
};

const heroActives = [
  {
    id: 'hero_slash', owner: 'hero', type: SkillType.ACTIVE, name: '斩击',
    desc: '造成相当于攻击力 100% 的物理伤害。',
    cost: {}, cooldown: 0,
    effects: [{ kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 1.0, hits: 1, target: { select: 'selected' } }],
  },
  {
    id: 'hero_desperate', owner: 'hero', type: SkillType.ACTIVE, name: '拼命',
    desc: '造成相当于攻击力 160% 的物理伤害。自身流失 10% 生命值（可致死）。',
    cost: {}, cooldown: 0,
    effects: [
      { kind: 'selfHpCost', pct: 0.10 },
      { kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 1.6, hits: 1, target: { select: 'selected' } },
    ],
  },
  {
    id: 'hero_balance', owner: 'hero', type: SkillType.ACTIVE, name: '均衡',
    desc: '造成相当于攻击力 70% 的物理伤害。获得持续 1 回合的 30%【减伤】。',
    cost: {}, cooldown: 0,
    effects: [
      { kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 0.7, hits: 1, target: { select: 'selected' } },
      { kind: 'buff', buffId: 'damageReduce', value: 0.30, duration: 1, target: { select: 'self' } },
    ],
  },
  {
    id: 'hero_spirit', owner: 'hero', type: SkillType.ACTIVE, name: '通灵',
    desc: '造成相当于攻击力 60% 的物理伤害。攻击前消耗至多 3 个元素，每消耗 1 个，技能倍率 +25%。',
    cost: {}, cooldown: 0,
    effects: [
      { kind: 'consumeAnyHand', max: 3, multiplierPer: 0.25 },
      { kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 0.6, multiplierBonusFromConsume: true, hits: 1, target: { select: 'selected' } },
    ],
  },
];

const heroChains = [
  {
    id: 'hero_luanmo', owner: 'hero', type: SkillType.CHAIN, name: '乱魔',
    desc: '移除所有单位的元素附着。',
    cooldown: 5,
    trigger: { kind: 'auraCountOnField', ge: 3 },
    effects: [{ kind: 'clearAllAura' }],
  },
  {
    id: 'hero_drain', owner: 'hero', type: SkillType.CHAIN, name: '汲取',
    desc: '吸收该元素附着（至多 1 个），下一次攻击的伤害类型改为对应的元素伤害，不可叠加。',
    cooldown: 3,
    trigger: { kind: 'allyApplyAura' },
    effects: [{ kind: 'absorbAuraNextAttack', max: 1 }],
  },
  {
    id: 'hero_cooperate', owner: 'hero', type: SkillType.CHAIN, name: '协同',
    desc: '对随机 1 名敌人施加指定元素附着。',
    cooldown: 3,
    trigger: { kind: 'otherAllyChain' },
    configurableElement: true,
    effects: [{ kind: 'aura', element: Element.FIRE, target: { select: 'randomEnemy' } }],
  },
];

const heroTalents = [
  {
    id: 'hero_whoami', name: '何以为我',
    desc: '物理伤害加成 +50%。本局战斗中，每造成过 1 种不同属性的元素伤害后，物理伤害加成 −20%，其余所有元素伤害加成各 +10%。',
    impl: 'whoAmI',
  },
];

// ---------------- 夏阳（火） ----------------
const xiayang = {
  id: 'xiayang', name: '夏阳', isLeader: false, element: 'fire',
  // 攻击力 30+10×lv（羁绊等级）
  base: { atk: 30, atkPerBond: 10 },
};

const xyActives = [
  {
    id: 'xy_inspire', owner: 'xiayang', type: SkillType.ACTIVE, name: '鼓舞·等级1',
    desc: '为主角回复相当于夏阳攻击力 20% 的生命值。消耗 1 个火元素，若消耗成功，还会使攻击力最高的我方角色攻击力 +25。',
    cost: { fire: 1 }, cooldown: 0,
    effects: [
      { kind: 'heal', pctOfCasterAtk: 0.20, target: { select: 'leader' } },
      { kind: 'buffIfHandPaid', buffId: 'atkFlat', value: 25, duration: -1, target: { select: 'highestAtkAlly' } },
    ],
  },
  {
    id: 'xy_quench', owner: 'xiayang', type: SkillType.ACTIVE, name: '淬火',
    desc: '造成相当于 100% 攻击力的火属性伤害。',
    cost: {}, cooldown: 0,
    effects: [{ kind: 'damage', element: 'fire', dmgKind: 'elementProperty', multiplier: 1.0, hits: 1, target: { select: 'selected' } }],
  },
  {
    id: 'xy_ignite', owner: 'xiayang', type: SkillType.ACTIVE, name: '引燃',
    desc: '对 1 名敌人施加持续 5 回合的【燃烧】。',
    cost: {}, cooldown: 0,
    effects: [{ kind: 'buff', buffId: 'burn', duration: 5, target: { select: 'selected' } }],
  },
  {
    id: 'xy_wildfire', owner: 'xiayang', type: SkillType.ACTIVE, name: '燎原',
    desc: '对敌方阵营的左侧 3 格的敌人造成相当于 80% 攻击力的火元素伤害并施加持续 3 回合的【燃烧】。',
    cost: {}, cooldown: 5,
    effects: [{
      kind: 'damage', element: 'fire', dmgKind: 'elementReact', multiplier: 0.8, hits: 1,
      target: { select: 'sideLeft3' }, thenBuff: { buffId: 'burn', duration: 3 },
    }],
  },
  {
    id: 'xy_wishes', owner: 'xiayang', type: SkillType.ACTIVE, name: '众愿',
    desc: '【偷取】其余我方角色各 20% 攻击力，然后对该单位及其左右各 1 格的随机 1 名敌人造成相当于 160% 攻击力的火元素伤害。',
    cost: {}, cooldown: 3,
    effects: [
      { kind: 'stealAllyAtk', pct: 0.20 },
      { kind: 'damage', element: 'fire', dmgKind: 'elementReact', multiplier: 1.6, hits: 1, target: { select: 'randomFromSelectedNeighborhood' } },
    ],
  },
  {
    id: 'xy_carnival', owner: 'xiayang', type: SkillType.ACTIVE, name: '爆炸狂欢',
    desc: '消耗 2 个火元素，对 1 名敌人及其左右 1 格造成相当于 150% 攻击力的火元素伤害。',
    cost: { fire: 2 }, cooldown: 5,
    effects: [{
      kind: 'damage', element: 'fire', dmgKind: 'elementReact', multiplier: 1.5, hits: 1,
      target: { select: 'selectedAndSide1' }, requireHand: { fire: 2 },
    }],
  },
  {
    id: 'xy_firesource', owner: 'xiayang', type: SkillType.ACTIVE, name: '万火之源',
    desc: '吸收所有火元素附着。每吸收 1 个，攻击力 +10%，持续 3 回合。',
    cost: {}, cooldown: 3,
    effects: [{ kind: 'absorbAllAura', element: 'fire', buff: { buffId: 'atkPct', valuePer: 0.10, duration: 3 }, target: { select: 'self' } }],
  },
];

const xyChains = [
  {
    id: 'xy_blaze', owner: 'xiayang', type: SkillType.CHAIN, name: '炽燃',
    desc: '对处于【燃烧】状态下的至多 3 名敌人造成相当于 80% 攻击力的火属性伤害。若没有符合条件的目标，改为攻击最左侧的敌人。',
    cooldown: 2,
    trigger: { kind: 'enemyBurning' },
    effects: [{
      kind: 'damage', element: 'fire', dmgKind: 'elementProperty', multiplier: 0.8,
      target: { select: 'burningEnemies', max: 3, fallback: 'leftmostEnemy' },
    }],
  },
  {
    id: 'xy_incinerate', owner: 'xiayang', type: SkillType.CHAIN, name: '焚灭',
    desc: '累计吸收 3 个火附着后可用一段；累计 7 个后改为二段。',
    cooldown: 2,
    trigger: { kind: 'absorbedFireCount', thresholds: [3, 7] },
    stages: [
      { need: 3, consume: 3, effects: [{ kind: 'damage', element: 'fire', dmgKind: 'elementProperty', multiplier: 1.4, target: { select: 'selectedAndSide1' } }] },
      { need: 7, consume: 7, effects: [{ kind: 'damage', element: 'fire', dmgKind: 'elementReact', multiplier: 2.2, target: { select: 'allEnemy' } }] },
    ],
  },
];

const xyTalents = [
  { id: 'xy_fearless', name: '无所畏惧·等级1', desc: '主角基础攻击力 +30，自身基础攻击力 +45。', impl: 'fearless' },
  { id: 'xy_vitality', name: '活力满满', desc: '睡觉时回复的生命值、健康翻倍，额外回复 1 点行动力。', impl: 'vitality' },
  { id: 'xy_curious', name: '好奇心', desc: '战斗胜利后有 30% 概率额外获得 1 次奖励，有 50% 概率额外获得 1 金币。', impl: 'curious' },
  { id: 'xy_wishcome', name: '心想事成', desc: '可切换载具为【巧遇】（当前版本载具未实现，仅保留描述）。', impl: 'wishcome' },
  { id: 'xy_nirvana', name: '涅槃', desc: '战斗中主角受到致命伤害时不倒下，回复 50% 生命值并使所有我方角色攻击力 +25%。每天限 1 次。', impl: 'nirvana' },
];

// ---------------- 陆悠悠（风） ----------------
const luyouyou = {
  id: 'luyouyou', name: '陆悠悠', isLeader: false, element: 'wind',
  base: { atk: 35, atkPerBond: 10 },
};

const lyyActives = [
  {
    id: 'lyy_sharp', owner: 'luyouyou', type: SkillType.ACTIVE, name: '精巧射击',
    desc: '造成 2 段相当于 50% 攻击力的物理伤害。',
    cost: {}, cooldown: 0,
    effects: [{ kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 0.5, hits: 2, target: { select: 'selected' } }],
  },
  {
    id: 'lyy_escape', owner: 'luyouyou', type: SkillType.ACTIVE, name: '脱身矢',
    desc: '造成相当于 100% 攻击力的物理伤害并将敌人击退 1 格。',
    cost: {}, cooldown: 3,
    effects: [
      { kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 1.0, hits: 1, target: { select: 'selected' } },
      { kind: 'knockback', dir: 1, distance: 1, target: { select: 'selected' } },
    ],
  },
  {
    id: 'lyy_aim', owner: 'luyouyou', type: SkillType.ACTIVE, name: '屏息瞄准',
    desc: '下一次攻击的暴击率 +100%，不可叠加。',
    cost: {}, cooldown: 2,
    effects: [{ kind: 'buff', buffId: 'nextCrit', value: 1.0, duration: -1, target: { select: 'self' }, noStack: true }],
  },
  {
    id: 'lyy_windstop', owner: 'luyouyou', type: SkillType.ACTIVE, name: '风止',
    desc: '对随机 2 名敌人造成相当于 80% 攻击力的物理伤害、施加持续 1 回合的 25%【虚弱】。',
    cost: {}, cooldown: 4,
    effects: [{
      kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 0.8, hits: 1,
      target: { select: 'randomEnemies', count: 2 }, thenBuff: { buffId: 'weak', value: 0.25, duration: 1 },
    }],
  },
  {
    id: 'lyy_soar', owner: 'luyouyou', type: SkillType.ACTIVE, name: '腾空击',
    desc: '对主角施加风元素附着。对 1 名敌人及其左右 1 格造成相当于 100% 攻击力的风元素属性伤害。',
    cost: {}, cooldown: 3,
    effects: [
      { kind: 'aura', element: 'wind', target: { select: 'leader' } },
      { kind: 'damage', element: 'wind', dmgKind: 'elementProperty', multiplier: 1.0, hits: 1, target: { select: 'selectedAndSide1' } },
    ],
  },
];

const lyyChains = [
  {
    id: 'lyy_weakpoint', owner: 'luyouyou', type: SkillType.CHAIN, name: '弱点击破',
    desc: '敌人进入【蓄力】时，对该敌人造成相当于 130% 攻击力的物理伤害、施加持续 3 回合的【虚弱】。本次攻击暴击率 +100%。',
    cooldown: 6,
    trigger: { kind: 'enemyCharging' },
    effects: [{
      kind: 'damage', element: 'physical', dmgKind: 'physical', multiplier: 1.3, hits: 1,
      critBonus: 1.0, target: { select: 'chargingEnemy' },
      thenBuff: { buffId: 'weak', value: 0.25, duration: 3 },
    }],
  },
  {
    id: 'lyy_StormEye', owner: 'luyouyou', type: SkillType.CHAIN, name: '风暴眼',
    desc: '场上累计触发 4 次扩散反应后，锁定随机 1 名敌人，对其 2 格距离内的所有敌人造成相当于 80% 攻击力的风元素伤害。',
    cooldown: 1,
    trigger: { kind: 'spreadCount', ge: 4 },
    effects: [{ kind: 'damage', element: 'wind', dmgKind: 'elementReact', multiplier: 0.8, target: { select: 'within2OfRandomEnemy' }, resetCounter: 'spread' }],
  },
  {
    id: 'lyy_hunt', owner: 'luyouyou', type: SkillType.CHAIN, name: '追猎',
    desc: '我方角色使用 3 次攻击型技能后，以上一次攻击的敌人为目标，发射可弹射 3 次的箭矢，每次造成相当于 20% 攻击力的物理伤害。',
    cooldown: 1,
    trigger: { kind: 'attackSkillCount', ge: 3 },
    effects: [{ kind: 'bounceDamage', element: 'physical', multiplier: 0.2, bounces: 3, target: { select: 'lastAttacked' } }],
  },
  {
    id: 'lyy_windrise', owner: 'luyouyou', type: SkillType.CHAIN, name: '风起',
    desc: '我方单位对敌人施加火/水/雷/冰附着时，对该敌人造成相当于 15% 攻击力的风元素伤害、施加持续 3 回合的 30%【易伤】。',
    cooldown: 5,
    trigger: { kind: 'allyApplyAuraElement', elements: ['fire', 'water', 'thunder', 'ice'] },
    effects: [{
      kind: 'damage', element: 'wind', dmgKind: 'elementProperty', multiplier: 0.15,
      target: { select: 'auraAppliedEnemy' }, thenBuff: { buffId: 'vulnerable', value: 0.30, duration: 3 },
    }],
  },
];

const lyyTalents = [
  { id: 'lyy_handy', name: '巧手·等级1', desc: '睡觉时 40% 概率获得 1 个随机资源；合成时 25% 概率获得 1 个随机资源。', impl: 'handy' },
  { id: 'lyy_cook', name: '烹饪', desc: '食物能提供更好的回复效果。主角基础最大生命值 +100。', impl: 'cooking' },
  { id: 'lyy_dance', name: '蹁跹·等级1', desc: '探索时每次移动后为主角回复 30 点生命值。战斗中主角闪避时回复 30 点生命值。', impl: 'dance' },
  { id: 'lyy_windbreath', name: '风息·等级1', desc: '基础攻击力 +60，暴击率 +30%。暴击时本次技能伤害类型由物理改为风元素伤害。', impl: 'windbreath' },
  { id: 'lyy_pair', name: '比翼', desc: '自身暴击后，其余我方角色的下一次攻击暴击率 +100%。', impl: 'pairwing' },
];

export const CHARACTERS = {
  hero: { def: hero, actives: heroActives, chains: heroChains, talents: heroTalents },
  xiayang: { def: xiayang, actives: xyActives, chains: xyChains, talents: xyTalents },
  luyouyou: { def: luyouyou, actives: lyyActives, chains: lyyChains, talents: lyyTalents },
};

export const ALL_SKILLS = [
  ...heroActives, ...heroChains,
  ...xyActives, ...xyChains,
  ...lyyActives, ...lyyChains,
];

export function getSkill(id) {
  return ALL_SKILLS.find((s) => s.id === id) ?? null;
}

export function skillsOf(ownerId) {
  const c = CHARACTERS[ownerId];
  if (!c) return { actives: [], chains: [], talents: [] };
  return { actives: c.actives, chains: c.chains, talents: c.talents };
}
