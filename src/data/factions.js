// src/data/factions.js
// 阵营（敌对关系）唯一真相源 —— 设计文档「阵营合法性」条目
//
// 三个阵营：
//   party    我方角色 —— **共用一个实体** `gs.player`（生命 / 攻击等属性完全共用）。
//            不同角色只体现在技能倍率与技能归属者；通用技能的归属者视作「我方角色」。
//            外圈使用余默模型只是 UI 表现，不影响战斗数据。
//   friendly 友善生物（小鸡 / 鸡）—— 不攻击、不追人；也不会被默认为敌方技能目标。
//   hostile  危险 / 高危生物 —— 不会普通攻击；若其技能本身带攻击倾向，则按该技能自己的逻辑使用。
//
// 敌对关系矩阵（唯一允许攻击的方向）：
//   party    → hostile
//   hostile  → party
//   friendly → （无）
//
// 说明：
//   · 目标合法性 = `isHostileTo(攻击方阵营, 目标阵营)`；技能默认只选阵营合法目标。
//   · 【不分敌我】词条存在，但当前技能库 0 条；出现时该技能跳过阵营过滤（skill.ignoreFaction = true）。
//   · 「感恩节的晚餐」当日 `gs.flags.friendlyAsEnemyToday` 是既有例外：友善生物当日视同敌人。
//
// 本文件只做纯数据 + 纯函数判定，不读写 gs、不触发事件；供 SkillResolve（几何/结算层）消费。

export const FACTION = Object.freeze({
  PARTY: 'party',
  FRIENDLY: 'friendly',
  HOSTILE: 'hostile',
});

/** 攻击方阵营 → 可攻击的目标阵营（未列出的阵营一律不可攻击） */
export const HOSTILE_TO = Object.freeze({
  [FACTION.PARTY]: Object.freeze([FACTION.HOSTILE]),
  [FACTION.FRIENDLY]: Object.freeze([]),
  [FACTION.HOSTILE]: Object.freeze([FACTION.PARTY]),
});

/**
 * 取实体阵营。
 * @param {object|string|null} entity 生物实例 / 几何快照条目 / gs.player / 阵营字符串
 *   gs.player 通过显式 `faction: 'party'` 标记；生物按 `category` 判定。
 * @returns {'party'|'friendly'|'hostile'|null}
 */
export function factionOf(entity) {
  if (!entity) return null;
  if (typeof entity === 'string') {
    return Object.values(FACTION).includes(entity) ? entity : null;
  }
  if (entity.faction) return entity.faction;
  if (entity.category === 'friendly') return FACTION.FRIENDLY;
  // danger / extreme，以及未声明分类的生物（测试或临时构造对象）一律按敌对处理：
  // 漏过滤友善生物比多过滤更危险，本方实体必须显式声明 faction。
  return FACTION.HOSTILE;
}

/**
 * 攻击方是否能攻击目标（阵营合法性）。
 * @param {object|string} attacker 攻击方实体或阵营
 * @param {object|string} target   目标实体或阵营
 * @returns {boolean}
 */
export function isHostileTo(attacker, target) {
  const a = factionOf(attacker);
  const t = factionOf(target);
  if (!a || !t) return false;
  return (HOSTILE_TO[a] || []).some(f => f === t);
}
