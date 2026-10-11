/**
 * data/buffs.js —— 通用 buff / debuff 与元素反应状态定义
 *
 * status 分类：
 *   buff 增益 / debuff 减益 / control 控制 / reaction 反应增益 / special 特殊
 * 结算钩子由 CombatEngine 在对应时机调用：
 *   onTurnStart / onTurnEnd / onDealDamage / onReceiveDamage / modifyStat ...
 * 数值同名取最高、独立持续；层数类（中毒/激化）用 stacks。
 */

export const STATUS = {
  // ---------- 持续伤害 / 控制（§4.13.1） ----------
  poison: {
    id: 'poison', name: '中毒', category: 'debuff', stackable: true,
    desc: '回合结束时流失等同于层数的生命值（可致死）。可叠加层数。持续整场战斗。',
    duration: -1, // 整场
    hook: 'turnEndLoseHpPerStack',
  },
  fear: {
    id: 'fear', name: '恐惧', category: 'control',
    desc: '无法使用攻击型技能。持续时间不可叠加，取最高。',
    duration: 1, keepHighest: true,
    hook: 'blockAttackSkill',
  },
  sleep: {
    id: 'sleep', name: '睡眠', category: 'control',
    desc: '无法行动；受到伤害导致生命值降低时提前醒来。',
    duration: -1,
    hook: 'skipActionWakeOnHurt',
  },
  burn: {
    id: 'burn', name: '燃烧', category: 'debuff',
    desc: '回合开始掉 3% HP（可致死）；受水/冰附着立即消失；受草附着则自身+左右 1 格传染 1 回合。',
    duration: 3,
    hook: 'burn',
  },
  freeze: {
    id: 'freeze', name: '冻结', category: 'control',
    desc: '无法行动；受火/雷伤时本次伤害 +50% 并提前解冻；解冻后 3 回合【免疫冻结】。',
    duration: 2,
    hook: 'freeze',
  },
  freezeImmune: {
    id: 'freezeImmune', name: '免疫冻结', category: 'special',
    desc: '期间不会被冻结。', duration: 3,
    hook: 'immuneFreeze',
  },
  stun: {
    id: 'stun', name: '晕眩', category: 'control',
    desc: '本回合无法行动。', duration: 1,
    hook: 'skipAction',
  },
  depression: {
    id: 'depression', name: '抑郁', category: 'special',
    desc: '仅主角。基础攻击力、基础防御力固定降为 0；不可提前解除；持续一整天。',
    duration: -1, wholeDay: true,
    hook: 'zeroBaseAtkDef',
  },

  // ---------- 伤害修正三兄弟（同名取最高，独立持续） ----------
  damageReduce: {
    id: 'damageReduce', name: '减伤', category: 'buff',
    desc: '受到的伤害减少对应百分比。', duration: 1, keepHighest: true,
    hook: 'modifyIncomingPct', dir: -1,
  },
  weak: {
    id: 'weak', name: '虚弱', category: 'debuff',
    desc: '造成的伤害减少对应百分比。', duration: 1, keepHighest: true,
    hook: 'modifyOutgoingPct', dir: -1,
  },
  vulnerable: {
    id: 'vulnerable', name: '易伤', category: 'debuff',
    desc: '受到的伤害增加对应百分比。', duration: 1, keepHighest: true,
    hook: 'modifyIncomingPct', dir: 1,
  },

  // ---------- 数值类 ----------
  atkFlat: { id: 'atkFlat', name: '攻击力提升', category: 'buff', desc: '攻击力提高。', duration: -1, hook: 'statFlat', stat: 'atk' },
  atkPct: { id: 'atkPct', name: '攻击强化', category: 'buff', desc: '攻击力百分比提高。', duration: 3, hook: 'statPct', stat: 'atk' },
  nextCrit: { id: 'nextCrit', name: '瞄准', category: 'buff', desc: '下一次攻击暴击率提高。', duration: -1, consumeOnNextAttack: true, hook: 'critBonus' },

  // ---------- 蒸发 / 融化（顺序敏感，单次增伤） ----------
  vaporizeWater: {
    id: 'vaporizeWater', name: '蒸发·水', category: 'reaction',
    desc: '下次水属性伤害最终伤害 +100%。', duration: -1, consumeOnNextElement: 'water', bonus: 1.00,
  },
  vaporizeFire: {
    id: 'vaporizeFire', name: '蒸发·火',
    desc: '下次火属性伤害最终伤害 +50%。', duration: -1, consumeOnNextElement: 'fire', bonus: 0.50,
  },
  meltIce: {
    id: 'meltIce', name: '融化·冰',
    desc: '下次冰属性伤害 +50%。', duration: -1, consumeOnNextElement: 'ice', bonus: 0.50,
  },
  meltFire: {
    id: 'meltFire', name: '融化·火',
    desc: '下次火属性伤害 +100%。', duration: -1, consumeOnNextElement: 'fire', bonus: 1.00,
  },

  // ---------- 激化（草雷，阵营全体层数） ----------
  aggravate: {
    id: 'aggravate', name: '激化', category: 'buff', stackable: true, maxStacks: 10,
    desc: '下次草/雷伤 +10%/层；多段伤害每段分别消耗 1 层。',
    duration: -1,
  },

  // ---------- 超导：绑定地块，不挂单位（引擎单独处理地块抗性 debuff） ----------
  superconductTile: {
    id: 'superconductTile', name: '超导地带', category: 'special', bindTile: true,
    desc: '站在该地块上的单位雷/冰/物抗降低。',
  },
};

export function getStatus(id) { return STATUS[id] ?? null; }

/**
 * 元素反应表（§4.4.5）。
 * key 用排序后的稳定对（无向）或 a|b（有向，蒸发/融化顺序敏感）。
 * 引擎在施加第二种附着时查此表。
 */
export const REACTIONS = {
  // —— 顺序敏感：两种 key 都列 ——
  'fire|water': { id: 'vaporizeFW', name: '蒸发', ordered: true, result: 'vaporizeWater' },
  'water|fire': { id: 'vaporizeWF', name: '蒸发', ordered: true, result: 'vaporizeFire' },
  'fire|ice': { id: 'meltFI', name: '融化', ordered: true, result: 'meltIce' },
  'ice|fire': { id: 'meltIF', name: '融化', ordered: true, result: 'meltFire' },

  // —— 无向 ——
  'fire|grass': { id: 'burn', name: '燃烧', applyStatus: { buffId: 'burn', duration: 3 } },
  'fire|thunder': { id: 'overload', name: '超载', aoeSide1: { multiplier: 0.50, element: 'fire' } },
  'wind|fire': { id: 'spread_fire', name: '扩散', spread: 'fire' },
  'wind|water': { id: 'spread_water', name: '扩散', spread: 'water' },
  'wind|thunder': { id: 'spread_thunder', name: '扩散', spread: 'thunder' },
  'wind|ice': { id: 'spread_ice', name: '扩散', spread: 'ice' },
  'rock|fire': { id: 'crystallize_fire', name: '结晶', crystallize: true },
  'rock|water': { id: 'crystallize_water', name: '结晶', crystallize: true },
  'rock|thunder': { id: 'crystallize_thunder', name: '结晶', crystallize: true },
  'rock|ice': { id: 'crystallize_ice', name: '结晶', crystallize: true },
  'water|grass': { id: 'bloom', name: '绽放', summon: 'grassSlime' },
  'water|thunder': { id: 'electrocharged', name: '感电', electro: true },
  'water|ice': { id: 'freeze', name: '冻结', applyStatus: { buffId: 'freeze', duration: 2 } },
  'grass|thunder': { id: 'aggravate', name: '激化', aggravate: { stacks: 2 } },
  'thunder|ice': { id: 'superconduct', name: '超导', bindTile: true },
};

const ELEMENT_ORDER = ['fire', 'water', 'grass', 'thunder', 'ice', 'wind', 'rock'];

/**
 * 查询反应。
 * @param {string} first  先存在的附着
 * @param {string} second 新施加的附着
 * @returns {object|null}
 */
export function lookupReaction(first, second) {
  if (!first || !second || first === second) return null;
  // 先查有向键
  const directed = REACTIONS[`${first}|${second}`];
  if (directed) return directed;
  // 再查无向（按元素固定顺序归一键）
  const key = [first, second]
    .slice()
    .sort((a, b) => ELEMENT_ORDER.indexOf(a) - ELEMENT_ORDER.indexOf(b))
    .join('|');
  return REACTIONS[key] ?? null;
}
