// src/systems/SkillSystem.js
// Phase 4 重构：技能从"角色 team 遍历"改为"地块遍历"
// 核心职责：
//   triggerSkillByHook(hookType, params)
//     遍历所有 outerTiles，找 contentId 为 skill_* 的地块；
//     若 skillDef.hooks[hookType] 为 true + cooldown 通过 → 执行 CombatSystem.calculateDamage。
//     技能持续存在（不消耗 tile.contentId），按 tileIdx + skillId 独立 cooldown。
//     同时 fire HookDispatcher.fire('onUseSkill', ...) 让豌豆架储存豌豆。
//
//   ⚠ 技能没有任何手动使用入口：主动技能只由描述里的触发时机自动结算，
//     连携技只在实时窗口按 E 使用（§12.5）；信息区对技能只做展示。
//
// 为什么不注册到 HookDispatcher？
//   HookDispatcher 是词条 hook（设施/资源/祝福/睡觉 等时机），是数据层写死时机；
//   SkillSystem 要额外做：合法目标筛选 + 技能冷却 & cooldown 递减 + 连携技检测。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { SKILLS } from '../data/characters.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { HealSystem } from './HealSystem.js';
import {
  createSettlement,
  commitSettlement,
  judgeModeOf,
  liveById,
  selectSkillTargets,
  skillTileAnchor,
  playerAnchor,
  tileRefsForSkill,
  tileTargetsOf,
  circleTargetsOf,
  registerDamage,
} from './SkillResolve.js';

/**
 * 每技能的运行时 cooldown：skillId → remainingTurns
 * §12.3：技能卡位置被移动时冷却保留 —— 冷却按技能卡（skillId）计，不绑地块。
 * GS 持久化（跨回合不丢失），resetSkillCooldowns 清空
 */

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
  const refreshOnBless = hookType === 'onBlessed' && skillDef.onBlessedRefreshCooldown;
  if (!refreshOnBless && gs.skillCooldowns[cdKey] && gs.skillCooldowns[cdKey] > 0) return;

  // 连携技不走普通 hook 触发（它们是实时窗口按键触发的）
  if (skillDef.isLinkSkill) return;

  // §3.2 ⑦c / §3.6：一次结算一份快照 —— 本技能本次触发的判定几何只读这份
  const settlement = createSettlement(gs, {
    skillId: skillDef.id,
    instanceKey: `tile:${tileIdx}`,
    phase: hookType,
    roleId: skillDef.roleId,
    attackerRoleId: skillDef.roleId,
  });
  const judgeMode = judgeModeOf(skillDef);
  const anchor = skillTileAnchor(gs, tileIdx);

  // 主目标（也是 tile 型的锚点来源）：默认最近存活敌人
  const primary = selectSkillTargets(settlement.snapshot, skillDef, anchor, {
    friendlyAsEnemyToday: settlement.friendlyAsEnemyToday,
  });
  if (primary.length === 0) return; // 保持既有行为：无合法目标则不触发

  // 触发！
  fireOneSkill(gs, skillDef, primary, cdKey, hookType, tileIdx, settlement, judgeMode, anchor);
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

/** tile 型锚点参数：anchor='target' 用目标中心；'player+target' 用玩家格中心 + 目标中心 */
function tileAnchorParams(gs, skill, anchor, primaryEntry) {
  const targetPoint = primaryEntry ? { x: primaryEntry.x, y: primaryEntry.y } : null;
  if (skill.anchor === 'target') return { anchorPoint: targetPoint, targetPoint };
  if (skill.anchor === 'player+target') return { anchorPoint: playerAnchor(gs), targetPoint };
  return { anchorPoint: anchor, targetPoint };
}

function fireOneSkill(gs, skill, primaryEntries, cdKey, hookName = 'onEnter', tileIdx = null, settlement, judgeMode, anchor) {
  const primaryEntry = primaryEntries[0] || null;
  const primaryLive = primaryEntry ? liveById(gs, primaryEntry.id) : null;
  const displayTarget = primaryLive || primaryEntry;
  devLog.info('[SkillSystem] fire', skill.name, '→', displayTarget?.kind, '(hp', displayTarget?.hp, '/', displayTarget?.maxHp, ') x', primaryEntries.length);
  EventBus.emit(GE.SKILL_TRIGGERED, { skillId: skill.id, roleId: skill.roleId, targetKind: displayTarget?.kind ?? null });
  // §16.3：主动技能在其所在地块结算 → UI 层据此做地块红色瞬时高亮（纯视觉，不参与结算）
  if (typeof tileIdx === 'number') {
    EventBus.emit(GE.SKILL_USED_ON_TILE, { tileIdx, skillId: skill.id, roleId: skill.roleId });
  }

  const eff = skill.extraEffect;

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

  const multiplier = skill.damageMultiplier + multiplierBonus;
  const hits = skill.hits || 1;

  // ── 结算：只产出意图，判重 / 应用 / 死亡全部交给批次与死亡队列 ──
  let hitCount = 0;
  if (judgeMode === 'tile') {
    // tile 型：circle 走圆-圆重叠；row / column / rowColumn / line 走地块集合 + 碰撞框
    const anchorParams = tileAnchorParams(gs, skill, anchor, primaryEntry);
    let entries;
    let rangeDesc;
    if (skill.areaShape === 'circle') {
      // §12.3：半径按米计（1 格边长 = 1 米），命中 = 锚点圆与生物碰撞圆重叠（不绑定地块枚举）
      entries = circleTargetsOf(settlement, skill, anchorParams.anchorPoint);
      rangeDesc = `半径 ${skill.areaRadius} 圆`;
    } else {
      const tiles = tileRefsForSkill(gs, skill, { skillTileIdx: tileIdx, ...anchorParams });
      entries = tileTargetsOf(settlement, skill, tiles);
      rangeDesc = `${tiles.length} 格`;
    }
    if (multiplier > 0) {
      registerDamage(settlement, entries, { multiplier, element: skill.element, hits, key: skill.id });
    }
    hitCount = entries.length;
    devLog.info('[SkillSystem]', skill.name, 'tile 结算', rangeDesc, '→', entries.length, '名目标');
  } else {
    // target 型：主目标集合已由 selectSkillTargets 按中心点距离 / 随机选出
    for (const entry of primaryEntries) {
      const live = liveById(gs, entry.id);
      if (!live) continue;
      // 纯 buff / 自身效果型技能（damageMultiplier = 0）不登记伤害，只登记目标类 buff
      if (multiplier > 0) {
        registerDamage(settlement, [entry], { multiplier, element: skill.element, hits, key: skill.id });
      }
      // 目标类额外效果（buff/debuff 也登记进同一批次，相同 buffId 取最高）
      applySkillExtraEffects(gs, skill, live, hookName, 'perTarget', settlement.batch);
      hitCount += 1;
    }
  }

  // 批次末统一应用（按登记顺序）+ flush 死亡（掉落 / 移除只结算一次）
  const { summary, deaths } = commitSettlement(settlement);

  // 自身类额外效果：每次触发一次，且必须在伤害之后（如拼命的 self_hp_drain）
  applySkillExtraEffects(gs, skill, primaryLive, hookName, 'self', null);

  devLog.info('[SkillSystem]', skill.name, '结算完成：目标', hitCount,
    '伤害组', summary.damages.length, 'buff组', summary.buffs.length, '击败', deaths.defeated.length);

  // 设置 cooldown（按技能卡独立）
  if (cdKey && skill.cooldown && skill.cooldown > 0) {
    gs.skillCooldowns = gs.skillCooldowns || {};
    gs.skillCooldowns[cdKey] = skill.cooldown;
  }
  // 爆炸狂欢（SKL-A-008）：【受祝福时】立即刷新冷却
  if (cdKey && skill.onBlessedRefreshCooldown && hookName === 'onBlessed') {
    delete gs.skillCooldowns[cdKey];
    devLog.info('[SkillSystem] 爆炸狂欢【受祝福时】冷却已刷新');
  }

  if (!skill.isLinkSkill) {
    LinkSkillSystem.onSkillFired(gs, { roleId: skill.roleId, skillId: skill.id, skill, target: displayTarget });
  }
}

/**
 * @param {string} phase 'all'（兼容旧调用）| 'perTarget'（目标类，逐目标）| 'self'（自身类，每次触发一次）
 * @param {object|null} batch 传入 EffectBatch 时 buff 登记进批次（批次末统一应用），null 时立即应用
 */
function applySkillExtraEffects(gs, skill, target, hookName = 'onEnter', phase = 'all', batch = null) {
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
      // 目标类 buff 登记进同一结算批次（同「目标 + buffId」取最高强度 / 最长时长）
      if (batch) {
        batch.buff(target, eff.buffId, {
          strength: eff.strength,
          duration: eff.duration,
        });
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
  }
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
  advanceSkillCooldowns,
  resetSkillCooldowns,
  getSkillById,
};
