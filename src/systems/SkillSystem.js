// src/systems/SkillSystem.js
// Phase 4 重构：技能从"角色 team 遍历"改为"地块遍历"
// 核心职责：
//   triggerSkillByHook(hookType, params)
//     遍历所有 outerTiles，找 contentId 为 skill_* 的地块；
//     若 skillDef.hooks[hookType] 为 true + cooldown 通过 → 执行 CombatSystem.calculateDamage。
//     技能持续存在（不消耗 tile.contentId），按 tileIdx + skillId 独立 cooldown。
//     同时 fire HookDispatcher.fire('onUseSkill', ...) 让豌豆架储存豌豆。
//
//   triggerSkillAtTile(tileIdx)  —— 辅助：走到某格时主动触发 onEnter（由 facilities.js 或 UI 调用）
//
// 为什么不注册到 HookDispatcher？
//   HookDispatcher 是词条 hook（设施/资源/祝福/睡觉 等时机），是数据层写死时机；
//   SkillSystem 要额外做：合法目标筛选 + 技能冷却 & cooldown 递减 + 连携技检测。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Distance } from '../core/Distance.js';
import { devLog } from '../core/Logger.js';
import { getSkill, getSkillsByRole, CHARACTERS, SKILLS } from '../data/characters.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { HealSystem } from './HealSystem.js';
import { CreatureSystem } from './CreatureSystem.js';

/**
 * 每技能的运行时 cooldown：skillId → remainingTurns
 * §12.3：技能卡位置被移动时冷却保留 —— 冷却按技能卡（skillId）计，不绑地块。
 * GS 持久化（跨回合不丢失），resetSkillCooldowns 清空
 */

function getCreaturesInFence(gs) {
  const list = [];
  for (const t of gs.map.fence) {
    for (const cid of (t.creatures || [])) {
      const c = gs.creatures.find(cc => cc.id === cid);
      if (c) list.push(c);
    }
  }
  return list;
}

function findLegalTargets(gs, skill, tileIdx) {
  const allCreatures = getCreaturesInFence(gs);
  if (allCreatures.length === 0) return [];

  let pool = allCreatures;
  if (skill.targetCategory === 'danger_extreme') {
    // ITM-CON-004 感恩节的晚餐：本日我方把友善生物也视为敌人
    if (gs.flags?.friendlyAsEnemyToday) {
      pool = allCreatures.slice();
    } else {
      pool = allCreatures.filter(c => c.category === 'danger' || c.category === 'extreme');
    }
  } else if (skill.targetCategory === 'friendly_danger_extreme') {
    pool = allCreatures;
  }
  if (pool.length === 0) return [];

  // §12.3：目标 = 技能所在地块到敌人位置最近的合法单位。
  // 外圈格用网格 (x, y)；栅栏内生物 (row, col) 对应网格坐标 (col+1, row+1)，曼哈顿距离判最近。
  const { x: sx, y: sy } = Distance.outerIdxToXY(gs.map.size, tileIdx);
  const dist = (c) => Math.abs(sx - (c.col + 1)) + Math.abs(sy - (c.row + 1));
  pool.sort((a, b) => dist(a) - dist(b));

  // B-9：targetCount 多目标（SKL-A-002 拼命 2 个最近 / SKL-A-011 风止 2 个随机）
  const count = Math.max(1, skill.targetCount || 1);
  if ((skill.targetSelection || 'nearest') === 'random') {
    const src = pool.slice();
    const out = [];
    while (out.length < count && src.length > 0) {
      out.push(src.splice(Math.floor(Math.random() * src.length), 1)[0]);
    }
    return out;
  }
  return pool.slice(0, count);
}

/**
 * 触发某时机下，**params.tileIdx 所在地块上放置的技能**（§12：技能按其所在格的时机触发）
 * @param {string} hookType  'onEnter' / 'onPass' / 'onBlessed'
 * @param {{gs: object, tileIdx: number}} params
 */
export function triggerSkillByHook(hookType, params) {
  const { gs, tileIdx } = params || {};
  if (!gs) return;
  // §12：只触发「事件发生格」上的技能；没有 tileIdx 不触发（此前遍历全部 outerTiles，
  // 踩任意一格会把所有地块上匹配 hook 的技能全部触发）
  if (typeof tileIdx !== 'number') return;

  gs.skillCooldowns = gs.skillCooldowns || {};

  const tile = gs.map.outerTiles[tileIdx];
  if (!tile?.contentId || !tile.contentId.startsWith('skill_')) return;

  const skillDef = SKILLS[tile.contentId];
  if (!skillDef) return;

  // triggerCondition 钩子匹配（用 hooks[hookType] 字段）
  if (!skillDef.hooks || !skillDef.hooks[hookType]) return;

  // cooldown 检查：按技能卡（skillId）独立 —— §12.3 技能卡位置被移动时冷却保留
  // 例外：爆炸狂欢（SKL-A-008）【受祝福时】即使冷却中也触发并刷新冷却
  const cdKey = `skill_${skillDef.id}`;
  const refreshOnBless = hookType === 'onBlessed' && skillDef.extraEffect?.onBlessedRefreshCooldown;
  if (!refreshOnBless && gs.skillCooldowns[cdKey] && gs.skillCooldowns[cdKey] > 0) return;

  // 连携技不走普通 hook 触发（它们是实时窗口按键触发的）
  if (skillDef.isLinkSkill) return;

  // 找目标（§12.3：最近合法单位；B-9：targetCount 多目标）
  const targets = findLegalTargets(gs, skillDef, tileIdx);
  if (targets.length === 0) return;

  // 触发！
  fireOneSkill(gs, skillDef, targets, cdKey, hookType, tileIdx);
  HookDispatcher.fire('onUseSkill', { gs });
}

/**
 * 开拓（SKL-A-003）：攻击前随机消耗 count 块有地形的地块（变为无地形），返回实际消耗数
 */
function consumeTerrainsForPioneer(gs, count) {
  let consumed = 0;
  for (let i = 0; i < count; i++) {
    const candidates = gs.map.outerTiles.filter(t => t.terrain && t.terrain !== 'terrain_none');
    if (candidates.length === 0) break;
    const tile = candidates[Math.floor(Math.random() * candidates.length)];
    tile.terrain = 'terrain_none';
    tile.terrainAmount = 0;
    EventBus.emit(GE.TILE_UPDATED, { tileIdx: tile.idx });
    consumed += 1;
  }
  if (consumed > 0) devLog.info('[SkillSystem] 开拓 消耗地形', consumed, '块');
  return consumed;
}

/**
 * 合纵连横（SKL-A-012）：技能所在格延伸出的行 + 列 覆盖的栅栏格
 * 外圈格 (sx, sy) → 栅栏行 sy-1 / 栅栏列 sx-1（栅栏 (row,col) 对应网格 (col+1, row+1)）
 */
function getFenceTilesInRowCol(gs, tileIdx) {
  const { x: sx, y: sy } = Distance.outerIdxToXY(gs.map.size, tileIdx);
  const fenceRow = sy - 1;
  const fenceCol = sx - 1;
  const n = gs.map.fenceRowCols || 1;
  const out = [];
  for (const t of gs.map.fence) {
    const inRow = fenceRow >= 0 && fenceRow < n && t.row === fenceRow;
    const inCol = fenceCol >= 0 && fenceCol < n && t.col === fenceCol;
    if (inRow || inCol) out.push(t);
  }
  return out;
}

/** 收集若干栅栏格内的全部存活生物（去重） */
function collectCreaturesInFenceTiles(gs, fenceTiles) {
  const seen = new Set();
  const out = [];
  for (const t of fenceTiles) {
    for (const cid of (t.creatures || [])) {
      if (seen.has(cid)) continue;
      const c = gs.creatures.find(cc => cc.id === cid);
      if (c && c.hp > 0) {
        seen.add(cid);
        out.push(c);
      }
    }
  }
  return out;
}

function fireOneSkill(gs, skill, targets, cdKey, hookName = 'onEnter', tileIdx = null) {
  const roleDef = CHARACTERS[skill.roleId];
  const target = Array.isArray(targets) ? targets[0] : targets; // 主目标（日志/范围中心/连携上下文）
  const targetList = Array.isArray(targets) ? targets : [targets];
  devLog.info('[SkillSystem] fire', skill.name, '→', target.kind, '(hp', target.hp, '/', target.maxHp, ') x', targetList.length);
  EventBus.emit(GE.SKILL_TRIGGERED, { skillId: skill.id, roleId: skill.roleId, targetKind: target.kind });
  // §16.3：主动技能在其所在地块结算 → UI 层据此做地块红色瞬时高亮（纯视觉，不参与结算）
  if (typeof tileIdx === 'number') {
    EventBus.emit(GE.SKILL_USED_ON_TILE, { tileIdx, skillId: skill.id, roleId: skill.roleId });
  }

  const eff = skill.extraEffect;

  // ── 特殊结算：合纵连横（行 + 列范围伤害，替代单体流程） ──
  if (eff?.type === 'line_row_column') {
    const tiles = typeof tileIdx === 'number' ? getFenceTilesInRowCol(gs, tileIdx) : [];
    const targets = collectCreaturesInFenceTiles(gs, tiles)
      .filter(c => c.category === 'danger' || c.category === 'extreme' || gs.flags?.friendlyAsEnemyToday);
    for (const t of targets) {
      CombatSystem.calculateDamage({
        atk: gs.player.atk,
        skill,
        defender: t,
        element: 'physical',
        player: gs.player,
        gs,
        roleId: skill.roleId,
        attackerRoleId: skill.roleId,
      });
      if (t.hp <= 0) defeatCreature(gs, t);
    }
    devLog.info('[SkillSystem] 合纵连横 命中', targets.length, '名敌人');
  } else if (eff?.type === 'aoe_radius') {
    // ── 特殊结算：爆炸狂欢（目标所在栅栏格半径 1 格大范围） ──
    const nearTiles = gs.map.fence.filter(t =>
      Math.abs(t.row - target.row) <= (eff.radius ?? 1) && Math.abs(t.col - target.col) <= (eff.radius ?? 1));
    const targets = collectCreaturesInFenceTiles(gs, nearTiles)
      .filter(c => c.category === 'danger' || c.category === 'extreme' || gs.flags?.friendlyAsEnemyToday);
    for (const t of targets) {
      CombatSystem.calculateDamage({
        atk: gs.player.atk,
        skill,
        defender: t,
        element: skill.element,
        player: gs.player,
        gs,
        roleId: skill.roleId,
        attackerRoleId: skill.roleId,
      });
      if (t.hp <= 0) defeatCreature(gs, t);
    }
    devLog.info('[SkillSystem] 爆炸狂欢 命中', targets.length, '名敌人');
  } else {
    // ── 伤害前生效的额外效果 ──
    let multiplierBonus = 0;
    if (eff?.type === 'pioneer_multiplier') {
      // 开拓（SKL-A-003）：攻击前随机消耗地形，每消耗 1 块本次攻击倍率 +70%
      const consumed = consumeTerrainsForPioneer(gs, eff.consumeCount || 2);
      multiplierBonus = (eff.perConsumeMultiplier || 0.7) * consumed;
    } else if (eff?.type === 'damage_modifier_self') {
      // 众愿（SKL-A-007）：本日内我方火元素伤害 +20%，其余元素及物理 -10%（DaySystem 跨天重置）
      if (!gs.team) gs.team = {};
      gs.team.allWishesActive = true;
      devLog.info('[SkillSystem] 众愿：本日火伤 +20% / 其余 -10% 已生效');
    }

    const effSkill = multiplierBonus > 0
      ? { ...skill, damageMultiplier: skill.damageMultiplier + multiplierBonus }
      : skill;

    const hits = skill.hits || 1;

    // B-9：逐目标结算（单体技能 targetList.length === 1）
    for (const t of targetList) {
      if (t.hp <= 0) continue;
      for (let h = 0; h < hits; h++) {
        const result = CombatSystem.calculateDamage({
          atk: gs.player.atk,
          skill: effSkill,
          defender: t,
          element: skill.element,
          realDamage: !!skill.realDamage,
          player: gs.player,
          gs,
          roleId: skill.roleId,
          attackerRoleId: skill.roleId,
        });
        if (result.immune) break;
        if (t.hp <= 0) break;
      }

      // 目标类额外效果（如 apply_buff：风止的虚弱对每个目标施加）
      applySkillExtraEffects(gs, skill, t, hookName, 'perTarget');

      if (t.hp <= 0) {
        defeatCreature(gs, t);
      }
    }

    // 自身类额外效果（每次触发仅一次，如拼命的 self_hp_drain）
    applySkillExtraEffects(gs, skill, target, hookName, 'self');
  }

  // 设置 cooldown（按技能卡独立）
  if (cdKey && skill.cooldown && skill.cooldown > 0) {
    gs.skillCooldowns = gs.skillCooldowns || {};
    gs.skillCooldowns[cdKey] = skill.cooldown;
  }
  // 爆炸狂欢（SKL-A-008）：【受祝福时】立即刷新冷却
  if (cdKey && eff?.type === 'aoe_radius' && eff.onBlessedRefreshCooldown && hookName === 'onBlessed') {
    delete gs.skillCooldowns[cdKey];
    devLog.info('[SkillSystem] 爆炸狂欢【受祝福时】冷却已刷新');
  }

  if (!skill.isLinkSkill) {
    LinkSkillSystem.onSkillFired(gs, { roleId: skill.roleId, skillId: skill.id, skill, target });
  }
}

/**
 * @param {string} phase 'all'（兼容旧调用）| 'perTarget'（目标类，逐目标）| 'self'（自身类，每次触发一次）
 */
function applySkillExtraEffects(gs, skill, target, hookName = 'onEnter', phase = 'all') {
  const eff = skill.extraEffect;
  if (!eff) return;
  const isSelfPhase = phase === 'all' || phase === 'self';
  const isTargetPhase = phase === 'all' || phase === 'perTarget';

  switch (eff.type) {
    case 'self_hp_drain': {
      if (!isSelfPhase) break;
      const loss = Math.max(1, Math.floor(gs.player.hp * eff.percent));
      gs.player.hp -= loss;
      if (gs.player.hp < 0) gs.player.hp = 0;
      EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: -loss, source: skill.id });
      devLog.info('[SkillSystem]', skill.name, 'self drain', loss, '→ hp', gs.player.hp);
      // C-14（SKL-A-002「可致死」+ §5.4）：自损致死立即结算 —— 先查涅槃，未获救走归 0 惩罚
      if (gs.player.hp <= 0) {
        const saved = TalentSystem.onHPDeath(gs, { roleId: 'xiayang' });
        if (saved) {
          EventBus.emit(GE.TOAST_SHOW, { text: '🔥 涅槃触发！致命伤害被免疫', duration: 2000 });
        } else {
          CombatSystem.applyDeathPenalty(gs, gs.player);
        }
      }
      break;
    }
    case 'apply_buff': {
      if (!isTargetPhase) break;
      // 引燃（SKL-A-006）：【进入时】施加燃烧；【受祝福时】随机 1 名燃烧中的敌人燃烧剩余回合翻倍
      if (eff.enterOnly && hookName !== 'onEnter') {
        if (eff.onBlessedDoubleBurn && hookName === 'onBlessed') {
          const burned = gs.creatures.filter(c => c.hp > 0 && (c.activeBuffs || []).some(b => b.id === 'burn'));
          if (burned.length > 0) {
            const pick = burned[Math.floor(Math.random() * burned.length)];
            const burn = pick.activeBuffs.find(b => b.id === 'burn');
            burn.remainingTurns = Math.min(99, (burn.remainingTurns || 0) * 2); // C-8：状态上限 99
            EventBus.emit(GE.TOAST_SHOW, { text: `🟧 引燃【受祝福】：${pick.name || pick.kind} 的燃烧剩余回合翻倍（${burn.remainingTurns}）`, duration: 1800 });
            devLog.info('[SkillSystem] 引燃【受祝福】燃烧翻倍 →', pick.kind, burn.remainingTurns);
          }
        }
        break;
      }
      CombatSystem.applyBuff({
        buffId: eff.buffId,
        target,
        duration: eff.duration,
        params: { strength: eff.strength },
      });
      break;
    }
    case 'self_regen_and_buff': {
      if (!isSelfPhase) break;
      // 鼓舞（SKL-A-004）：【经过时】【受祝福时】回复 20% 攻击力生命；【进入时】【受祝福时】本日攻击力 +15（可叠加）
      if (hookName === 'onPass' || hookName === 'onBlessed') {
        const amount = Math.max(1, Math.round(gs.player.atk * (eff.regenPercentOfAtk || 0.2)));
        HealSystem.healPlayer(gs, amount, { source: skill.id });
        devLog.info('[SkillSystem] 鼓舞 回复', amount);
      }
      if (hookName === 'onEnter' || hookName === 'onBlessed') {
        const add = eff.atkBuffPerDay || 15;
        gs.player.atk += add;
        if (!gs.team) gs.team = {};
        gs.team.dailyInspireAtkApplied = (gs.team.dailyInspireAtkApplied || 0) + add; // 跨天回滚（DaySystem）
        EventBus.emit(GE.ATK_CHANGE, { newValue: gs.player.atk, reason: skill.id });
        devLog.info('[SkillSystem] 鼓舞 攻击力 +', add, '→', gs.player.atk);
      }
      break;
    }
    case 'self_crit_buff': {
      if (!isSelfPhase) break;
      // 屏息瞄准（SKL-A-010）：陆悠悠下一次攻击暴击率 +100%，不可叠加（CombatSystem 消费）
      if (!gs.team) gs.team = {};
      gs.team.luyouyouNextCritBonus = eff.critRateBonus || 1.0;
      devLog.info('[SkillSystem] 屏息瞄准：下次攻击暴击率 +', eff.critRateBonus || 1.0);
      break;
    }
    case 'pioneer_multiplier':
      // 已在伤害前结算（consumeTerrainsForPioneer）
      break;
    case 'damage_modifier_self':
      // 已在伤害前结算（gs.team.allWishesActive）
      break;
    case 'aoe_radius':
    case 'line_row_column':
      // 特殊结算路径已处理
      break;
  }
}

function defeatCreature(gs, target) {
  devLog.info('[SkillSystem] creature defeated:', target.kind);
  EventBus.emit(GE.CREATURE_DEFEATED, { creature: target });
  EventBus.emit(GE.TOAST_SHOW, { text: `✓ 击败 ${target.name || target.kind}`, duration: 1500 });

  for (const t of gs.map.fence) {
    t.creatures = (t.creatures || []).filter(cid => cid !== target.id);
  }
  gs.creatures = gs.creatures.filter(c => c.id !== target.id);

  CreatureSystem.grantKillDrops(gs, target); // 击杀掉落（物品库 BIO drops）

  HookDispatcher.fire('onCreatureDefeated', { gs, creature: target });
  TalentSystem.onCreatureDefeated(gs, target);
}

/**
 * 主动触发某格的所有技能（外部辅助：UI 手动触发）
 */
export function triggerSkillAtTile(gs, tileIdx) {
  triggerSkillByHook('onEnter', { gs, tileIdx });
}

/**
 * 推进回合后，递减所有技能 cooldown（GameDirector 上层调用 TurnSystem 后再调这个）
 */
export function advanceSkillCooldowns(gs) {
  if (!gs.skillCooldowns) return;
  for (const key of Object.keys(gs.skillCooldowns)) {
    if (gs.skillCooldowns[key] > 0) {
      gs.skillCooldowns[key] -= 1;
    } else {
      delete gs.skillCooldowns[key];
    }
  }
}

/**
 * 清除所有技能 cooldown（新一天重置）
 */
export function resetSkillCooldowns(gs) {
  if (gs) gs.skillCooldowns = {};
}

/** 辅助：按 id 取技能（UI 层用） */
export function getSkillById(id) {
  return SKILLS[id] || null;
}

export const SkillSystem = {
  triggerSkillByHook,
  triggerSkillAtTile,
  advanceSkillCooldowns,
  resetSkillCooldowns,
  getSkillById,
};
