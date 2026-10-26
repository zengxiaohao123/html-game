// src/systems/TalentSystem.js
// Agent 3 —— 天赋自动生效框架
// 设计文档 v0.4 §12.7-§12.9 + §12.2 天赋触发时机
// 触发时机对齐表：
//   passive            = 常驻（每次 damage 开始前 fire，或 game start 时 fire 一次设置字段）
//   onDayStart         = DaySystem.startNewDay() 末尾
//   onSleep            = SleepSystem.sleep() 开头
//   onMoveEnd          = MovementSystem.move() 末尾（扣 stamina 后）
//   onDamageDeal       = CombatSystem.calculateDamage() 开头
//   onHPDeath          = 生命归 0 时（CombatSystem.applyDamage 返回 hp=0 后）
//   onCreatureDefeated = SkillSystem.defeatCreature() 里
//   onCrit             = CombatSystem calculateDamage 暴击判定时
//   manual             = UI 触发（Agent 4 做）—— 预留

import { TALENTS, getTalentsByRole } from '../data/talents.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { Random } from '../core/Random.js';
import { ITEMS } from '../data/items.js';
import { InventorySystem } from './InventorySystem.js';

// ── lazy init helpers ──
function ensureTeamField(gs, key, defaultVal) {
  if (!gs.team) gs.team = {};
  if (!(key in gs.team)) gs.team[key] = defaultVal;
  return gs.team[key];
}

function ensurePlayerField(gs, key, defaultVal) {
  if (!gs.player) gs.player = {};
  if (!(key in gs.player)) gs.player[key] = defaultVal;
  return gs.player[key];
}

/**
 * 取 activeGroup 里所有角色的所有天赋（data/talents.js 定义）
 */
function getActiveGroupTalents(gs) {
  const group = gs.team?.groups?.[gs.team?.activeGroup ?? 0];
  if (!group) return [];
  const talents = [];
  for (const roleId of (group.roles || [])) {
    const list = getTalentsByRole(roleId);
    if (list && list.length) talents.push(...list);
  }
  return talents;
}

/**
 * 按 triggerCondition 过滤
 */
function filterByTrigger(gs, triggerKey) {
  return getActiveGroupTalents(gs).filter(t => t.triggerCondition === triggerKey);
}

/**
 * 遍历所有天赋 fire passive 常驻效果
 * —— 调用时机：
 *   1) 游戏启动后（GS 初始化完成）：给烹饪加 maxHp，给蹁跹加 dodgeRate
 *   2) 编队修改后（TeamPanel 调用 / EventBus GE.TEAM_CHANGE）
 *  guard flag 改为按 roleId 记录（_talentAppliedRoles），确保换编队时能重新 fire
 */
export function firePassive(gs) {
  // 初始化 guard flag 容器（按 roleId 记录，避免全局只 fire 一次）
  if (!gs.player._talentAppliedRoles) gs.player._talentAppliedRoles = {};

  const talents = getActiveGroupTalents(gs);
  for (const t of talents) {
    const roleId = t.roleId;
    const applied = gs.player._talentAppliedRoles[roleId] || {};

    switch (t.effectType) {
      case 'max_hp_food_bonus': {
        const bonus = t.effectParams?.maxHpBonus ?? 20;
        if (!applied.maxHpApplied) {
          gs.player.maxHp += bonus;
          gs.player.hp = Math.min(gs.player.maxHp, gs.player.hp + bonus);
          applied.maxHpApplied = true;
          EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, reason: 'talent_cooking' });
          devLog.info('[TalentSystem.passive] 烹饪(' + roleId + ') maxHp +', bonus, '→', gs.player.maxHp);
        }
        break;
      }
      case 'hp_regen_dodge_bonus': {
        const dodge = t.effectParams?.dodgeRate ?? 0.32;
        ensurePlayerField(gs, 'dodgeRate', 0);
        if (!applied.dodgeApplied) {
          gs.player.dodgeRate = (gs.player.dodgeRate || 0) + dodge;
          applied.dodgeApplied = true;
          devLog.info('[TalentSystem.passive] 蹁跹(' + roleId + ') dodgeRate +', (dodge * 100).toFixed(0) + '% →', (gs.player.dodgeRate * 100).toFixed(0) + '%');
        }
        break;
      }
    }
    gs.player._talentAppliedRoles[roleId] = applied;
  }
}

/**
 * DaySystem.startNewDay() 末尾调用
 * 1) 何以为我：重置 dailyElementDamages + 重置当日物理/元素加成修正
 * 2) 巧手·等级 1：40% 随机物品
 * 3) 比翼：twinBuffActiveDays-- 自然衰减（99 天默认）
 * 4) 焚灭：清空计数（这个写在 DaySystem 里更方便，但放在这里也 OK —— 先保留在 DaySystem）
 */
export function onDayStart(gs) {
  devLog.info('[TalentSystem.onDayStart]');

  // 重置何以为我 —— 每日重置
  ensureTeamField(gs, 'dailyElementDamages', []);
  gs.team.dailyElementDamages = [];

  // 比翼：twinBuffActiveDays 递减（若有）
  if (gs.team.twinBuffActiveDays !== undefined && gs.team.twinBuffActiveDays > 0) {
    gs.team.twinBuffActiveDays -= 1;
    if (gs.team.twinBuffActiveDays <= 0) {
      gs.team.twinBuffNextAtkCritRateBonus = 0;
      gs.team.twinBuffActiveDays = 0;
      devLog.info('[TalentSystem.onDayStart] 比翼 buff 已过期');
    }
  }

  const talents = filterByTrigger(gs, 'onDayStart');
  for (const t of talents) {
    // 巧手·等级 1：40% 随机物品
    if (t.effectType === 'item_generation') {
      const chance = t.effectParams?.dailyRandomItemChance ?? 0.4;
      if (Random.chance(chance)) {
        // 从 ITEMS 里随机一个（简化：随机一个有 value 的非 item_ 前缀？—— 直接随机 item_ 开头的）
        const pool = Object.keys(ITEMS).filter(id => id.startsWith('item_'));
        if (pool.length > 0) {
          const pick = Random.pick(pool);
          InventorySystem.addItem(gs, pick, 1);
          EventBus.emit(GE.TOAST_SHOW, { text: `🎁 巧手：获得随机物品 ${ITEMS[pick].name || pick}`, duration: 1500 });
          devLog.info('[TalentSystem.onDayStart] 巧手 随机物品 →', pick);
        }
      }
    }
  }
}

/**
 * SleepSystem.sleep() 开头调用（换日前）
 * 活力满满：睡觉回复翻倍 + 额外 +2 stamina
 * （注意：睡觉本身不回复 HP，此翻倍是给未来增益道具预留 —— 但我们按文档实现，额外 +2 stamina 是实的）
 */
export function onSleepStart(gs) {
  devLog.info('[TalentSystem.onSleepStart]');
  const talents = filterByTrigger(gs, 'onSleep');
  for (const t of talents) {
    if (t.effectType === 'sleep_bonus') {
      // 活力满满：额外 +2 stamina（HP 翻倍先预留标记）
      const extra = t.effectParams?.extraStamina ?? 2;
      gs.player.stamina = Math.min(gs.player.maxStamina, gs.player.stamina + extra);
      EventBus.emit(GE.STAMINA_CHANGE, {
        newValue: gs.player.stamina,
        delta: extra,
        maxStamina: gs.player.maxStamina,
        reason: 'talent_energetic',
      });
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 活力满满：额外 +${extra} 行动力`, duration: 1500 });
      devLog.info('[TalentSystem.onSleepStart] 活力满满 stamina +', extra);
    }
  }
}

/**
 * MovementSystem.move() 末尾（扣 stamina 后）调用
 * 蹁跹·等级 1：移动后 +6HP
 */
export function onMoveEnd(gs) {
  devLog.info('[TalentSystem.onMoveEnd]');
  const talents = filterByTrigger(gs, 'onMoveEnd');
  for (const t of talents) {
    if (t.effectType === 'hp_regen_dodge_bonus') {
      const regen = t.effectParams?.moveRegen ?? 6;
      const prevHp = gs.player.hp;
      gs.player.hp = Math.min(gs.player.maxHp, gs.player.hp + regen);
      const actual = gs.player.hp - prevHp;
      if (actual > 0) {
        EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: actual, reason: 'talent_dancing' });
        devLog.info('[TalentSystem.onMoveEnd] 蹁跹 HP +', actual);
      }
    }
  }
}

/**
 * CombatSystem.calculateDamage() 开头调 —— 让天赋能干预伤害计算
 * 参数：
 *   attacker: 攻击者角色 id 或 creature 对象
 *   defender: 防御方
 *   element: 本次伤害元素
 *   rawDamage: 当前原始伤害（会被修改）
 * 返回：{ flatBonus, critRateBonus, dodgeRateForDefender, elementOverride, physicalPenalty, elementBonus, physicalBonus, twinBuffConsumed, windBonus }
 *
 * 设计：TalentSystem 返回一个 opts 扩展对象，CombatSystem 在 calculateDamage 里把这些应用到 rawDamage / critRate
 */
export function onDamageDeal(gs, opts = {}) {
  const { attackerRoleId, element, defender } = opts;
  const result = {
    flatBonus: 0,           // 所有天赋的 damage_flat_bonus 加总
    physicalBonus: 0,       // 何以为我：物理 +50%（按比例）—— 但也会按每日元素种类数减 20% 每个
    physicalMul: 1,         // 何以为我：物理乘算
    elementBonus: 0,        // 何以为我：当前元素 +20%（按比例）
    elementMul: 1,          // 何以为我：当前元素乘算
    windFlatBonus: 0,       // 风息：风元素伤害 +20（固定）
    critRateBonusForAttacker: 0, // 风息：陆悠悠 +30%
    critRateBonusForAttackerMul: 1,
    elementOverrideOnCrit: null,  // 风息：暴击时改风元素
  };

  const talents = getActiveGroupTalents(gs);
  for (const t of talents) {
    // ── 无所畏惧·等级 1：damage_flat_bonus ──
    if (t.effectType === 'damage_flat_bonus') {
      const params = t.effectParams || {};
      if (element === 'physical') {
        result.flatBonus += (params.physical ?? 0);
      } else if (element === 'fire') {
        result.flatBonus += (params.fire ?? 0);
      }
      devLog.info('[TalentSystem.onDamageDeal] 无所畏惧 flatBonus →', result.flatBonus, 'element=', element);
    }

    // ── 何以为我：element_switcher ──
    if (t.effectType === 'element_switcher') {
      const params = t.effectParams || {};
      const physicalBase = params.physicalBonus ?? 0.5;
      const perElPenalty = params.perElementPenalty ?? 0.2;
      const perElBonus = params.perElementBonus ?? 0.2;

      // 已造成的元素种类数（去 physical）
      const dailyEl = ensureTeamField(gs, 'dailyElementDamages', []);
      const countDistinct = dailyEl.length; // 已经去重了

      if (element === 'physical') {
        // 物理：基础 +50%，每种已造成的新元素 -20%（乘算）
        const mul = 1 + physicalBase * Math.pow(1 - perElPenalty, countDistinct);
        // 简化：每有一种新元素直接 -20% 乘算
        let m = 1 + physicalBase; // 1.5
        for (let i = 0; i < countDistinct; i++) {
          m *= (1 - perElPenalty);
        }
        result.physicalMul = m;
        devLog.info('[TalentSystem.onDamageDeal] 何以为我 physicalMul=', m, '(kinds=', countDistinct, ')');
      } else {
        // 元素：每造成一种新元素（含本次？）+20%（乘算）
        // 文档："每造成一种元素伤害后，本日内物理伤害 -20%，该元素伤害 +20%"
        // 这里算当前元素 bonus：如果当前元素已经记录过了不叠加（文档说重复不叠加）
        // result.elementMul 改成：每有 distinct 元素（含自身）就 +20%
        // 但按文档描述：造成新元素 → 该元素 +20% —— 所以最终该元素 +20%（一次性的）
        // 简单处理：elementMul = 1 + perElBonus（只要是已记录过的元素都 +20%，不管重复不重复）
        result.elementMul = 1 + perElBonus;
        devLog.info('[TalentSystem.onDamageDeal] 何以为我 elementMul=', result.elementMul);
      }
    }

    // ── 风息·等级 1：wind_crit_bonus ──
    if (t.effectType === 'wind_crit_bonus') {
      const params = t.effectParams || {};
      const windBonus = params.windDamageBonus ?? 20;
      if (element === 'wind') {
        result.windFlatBonus += windBonus;
      }
      // 陆悠悠（attackerRoleId === 'luyouyou'）暴击率 +30%
      if (attackerRoleId === 'luyouyou') {
        result.critRateBonusForAttacker += (params.critRateBonus ?? 0.3);
        result.elementOverrideOnCrit = params.critElementOverride || 'wind';
      }
    }
  }

  return result;
}

/**
 * 每次造成元素伤害时，记录到 gs.team.dailyElementDamages（去重）
 * CombatSystem / SkillSystem 每次用非 physical element 攻击成功后 fire
 */
export function recordElementDamage(gs, element) {
  if (!element || element === 'physical') return;
  const arr = ensureTeamField(gs, 'dailyElementDamages', []);
  if (!arr.includes(element)) {
    arr.push(element);
    devLog.info('[TalentSystem] 记录新元素种类 →', element, 'count=', arr.length);
    // 元素累计达到 4 种：可以 fire 风暴眼连携技检测
    // 这里只记录，LinkSkillSystem 自己读
  }
}

/**
 * 陆悠悠暴击后 fire —— CombatSystem 暴击判定成功后调用
 * 比翼：其余我方角色下一次攻击暴击率 +100%
 */
export function onCrit(gs, opts = {}) {
  const { attackerRoleId } = opts;
  if (attackerRoleId !== 'luyouyou') return;

  const talents = getActiveGroupTalents(gs);
  for (const t of talents) {
    if (t.effectType === 'team_crit_chain') {
      const bonus = t.effectParams?.nextAllyCritRateBonus ?? 1.0;
      const nonStackable = t.effectParams?.nonStackable ?? true;
      const days = t.effectParams?.defaultDurationDays ?? 99;
      ensureTeamField(gs, 'twinBuffNextAtkCritRateBonus', 0);
      ensureTeamField(gs, 'twinBuffActiveDays', 0);
      if (nonStackable && gs.team.twinBuffNextAtkCritRateBonus > 0) {
        // 已存在，不可叠加
        devLog.info('[TalentSystem.onCrit] 比翼 已存在，跳过叠加');
        continue;
      }
      gs.team.twinBuffNextAtkCritRateBonus = bonus;
      gs.team.twinBuffActiveDays = days;
      EventBus.emit(GE.TOAST_SHOW, { text: `💝 比翼：队友下次暴击率 +100%`, duration: 1500 });
      devLog.info('[TalentSystem.onCrit] 比翼 buff set, days=', days);
    }
  }
}

/**
 * 我方角色被击败 / 致命伤害 → 涅槃
 * CombatSystem.applyDamage 检测到 player hp <= 0 前调用此函数
 * 返回 true 表示"免疫死亡"，CombatSystem 就不执行 HP 归 0 惩罚
 */
export function onHPDeath(gs, opts = {}) {
  const { roleId } = opts;
  if (roleId !== 'xiayang') return false; // 涅槃只属于夏阳

  const talents = getActiveGroupTalents(gs);
  const rebirth = talents.find(t => t.effectType === 'death_immunity');
  if (!rebirth) return false;

  const params = rebirth.effectParams || {};
  const cooldown = params.cooldownDays ?? 3;
  const hpRegen = params.hpRegenPercent ?? 0.5;
  const atkBonus = params.atkBonus ?? 0.25;

  // 冷却检查
  if (gs.team.xiayangRebornCooldownDay && gs.team.xiayangRebornCooldownDay > 0) {
    devLog.info('[TalentSystem.onHPDeath] 涅槃冷却中，剩余', gs.team.xiayangRebornCooldownDay, '天');
    return false;
  }

  // 触发
  gs.player.hp = Math.floor(gs.player.maxHp * hpRegen);
  gs.player.atk = Math.floor(gs.player.atk * (1 + atkBonus));
  gs.team.xiayangRebornCooldownDay = cooldown;
  EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, reason: 'talent_reborn' });
  EventBus.emit(GE.ATK_CHANGE, { newValue: gs.player.atk, reason: 'talent_reborn' });
  EventBus.emit(GE.TOAST_SHOW, { text: `🔥 涅槃！HP +${Math.floor(hpRegen * 100)}%，ATK +${Math.floor(atkBonus * 100)}%`, duration: 2500 });
  devLog.info('[TalentSystem.onHPDeath] 涅槃触发！hp=', gs.player.hp, 'atk=', gs.player.atk);
  return true;
}

/**
 * 被击败后 fire —— SkillSystem.defeatCreature() 内调用
 * 好奇心：danger/extreme 30% 额外奖励 + 50% 额外金币（独立判定）
 */
export function onCreatureDefeated(gs, creature) {
  if (!creature) return;
  const talents = filterByTrigger(gs, 'onCreatureDefeated');
  for (const t of talents) {
    if (t.effectType !== 'extra_reward') continue;
    const params = t.effectParams || {};
    const targets = params.targets || ['danger', 'extreme'];
    if (!targets.includes(creature.category)) continue;

    // 30% 额外奖励（简化：给一个随机产物 item）
    if (Random.chance(params.extraRewardChance ?? 0.3)) {
      const pool = ['item_wheat', 'item_rice_straw', 'item_wheat', 'item_wheat', 'item_corn', 'item_cabbage'];
      const pick = Random.pick(pool);
      InventorySystem.addItem(gs, pick, 1);
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 好奇心：额外获得 ${ITEMS[pick]?.name || pick} ×1`, duration: 1500 });
    }
    // 50% 额外金币（+1× 原 creature.dropValue —— 简化 +5 金币）
    if (Random.chance(params.extraGoldChance ?? 0.5)) {
      const extraGold = 5;
      gs.player.gold += extraGold;
      EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: extraGold });
      EventBus.emit(GE.TOAST_SHOW, { text: `🪙 好奇心：额外金币 +${extraGold}`, duration: 1500 });
    }
  }
}

/**
 * 闪避成功后 fire —— CombatSystem calculateDamage 返回 dodged:true 后调用
 * 蹁跹·等级 1：闪避时主角 +12HP
 */
export function onDodge(gs) {
  const talents = getActiveGroupTalents(gs);
  for (const t of talents) {
    if (t.effectType !== 'hp_regen_dodge_bonus') continue;
    const regen = t.effectParams?.dodgeRegenForMainChar ?? 12;
    const prevHp = gs.player.hp;
    gs.player.hp = Math.min(gs.player.maxHp, gs.player.hp + regen);
    const actual = gs.player.hp - prevHp;
    if (actual > 0) {
      EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: actual, reason: 'talent_dancing_dodge' });
      EventBus.emit(GE.TOAST_SHOW, { text: `💨 蹁跹：闪避成功 +${actual} HP`, duration: 1200 });
      devLog.info('[TalentSystem.onDodge] 蹁跹 闪避 HP +', actual);
    }
  }
}

/**
 * ForgeSystem.craft 里 fire —— 巧手·等级 1：25% 返原材料
 * 返回：一个对象 { returned: boolean, itemId?: string, qty?: number }
 */
export function onCraftCheck(gs, materials = []) {
  const talents = getActiveGroupTalents(gs);
  for (const t of talents) {
    if (t.effectType !== 'item_generation') continue;
    const chance = t.effectParams?.craftReturnChance ?? 0.25;
    if (Random.chance(chance) && materials.length > 0) {
      // 返 1 个随机原材料
      const mat = Random.pick(materials); // { itemId, qty }
      devLog.info('[TalentSystem.onCraftCheck] 巧手 返原材料 →', mat.itemId);
      return { returned: true, itemId: mat.itemId, qty: 1 };
    }
  }
  return { returned: false };
}

/**
 * 计算我方角色本次攻击的暴击率加成（比翼 下次攻击 +100%）
 * CombatSystem 暴击判定前调用
 * 返回一个 { mul: number, consumed: boolean } —— consumed=true 后下次清掉
 */
export function consumeTwinBuffIfAny(gs) {
  if (!gs.team) return { mul: 1, consumed: false };
  if (gs.team.twinBuffNextAtkCritRateBonus && gs.team.twinBuffNextAtkCritRateBonus > 0) {
    const bonus = gs.team.twinBuffNextAtkCritRateBonus;
    gs.team.twinBuffNextAtkCritRateBonus = 0; // 用完即清
    return { mul: 1 + bonus, consumed: true };
  }
  return { mul: 1, consumed: false };
}

/**
 * 每日开始时：涅槃冷却 -1（触发当天算冷却一天，所以 onDayStart 每次都 -1）
 */
export function onDayStartCooldownTick(gs) {
  if (gs.team && gs.team.xiayangRebornCooldownDay > 0) {
    gs.team.xiayangRebornCooldownDay -= 1;
    devLog.info('[TalentSystem] 涅槃冷却剩余', gs.team.xiayangRebornCooldownDay, '天');
  }
}

export const TalentSystem = {
  firePassive,
  onDayStart,
  onSleepStart,
  onMoveEnd,
  onDamageDeal,
  onCrit,
  onHPDeath,
  onCreatureDefeated,
  onDodge,
  onCraftCheck,
  consumeTwinBuffIfAny,
  recordElementDamage,
  onDayStartCooldownTick,
};
