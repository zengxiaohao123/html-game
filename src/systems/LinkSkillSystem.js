// src/systems/LinkSkillSystem.js
// Agent 3 —— 连携技完整实现
// 7 个连携技：汲取 / 炽燃 / 焚灭 / 弱点击破 / 风暴眼 / 追猎 / 风起
// 触发时机：
//   - onSkillFired(roleId, skill, target)  —— SkillSystem.fireOneSkill 末尾 fire
//   - onElementDamage(element, byRoleId)   —— CombatSystem calculateDamage 造成元素伤害后 fire
//   - resetAll(gs)                          —— DaySystem.startNewDay 末尾
//
// 结算：pop 后对目标造成伤害 + 应用额外效果（按 characters.js 的 triggerCondition/extraEffect）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { getSkill, getSkillsByRole, CHARACTERS } from '../data/characters.js';
import { Distance } from '../core/Distance.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { InventorySystem } from './InventorySystem.js';
import { CreatureSystem } from './CreatureSystem.js';

const WINDOW_MS = 3000; // 3 秒实时窗口

function getActiveGroupRoles(gs) {
  const group = gs.team?.groups?.[gs.team?.activeGroup ?? 0];
  return group ? (group.roles || []) : [];
}

/**
 * M-09（§12.5）：3 秒窗口只在条目成为队首（可触发）时开始计时，排队不计时。
 * 队首条目尚无窗口时立即开始计时。
 */
function armHeadWindow(gs) {
  const q = gs.linkSkillQueue;
  if (!Array.isArray(q) || q.length === 0) return;
  const head = q[0];
  if (!head.expireAtMs) {
    head.expireAtMs = Date.now() + WINDOW_MS;
    devLog.info('[LinkSkillSystem] 队首窗口开始计时', head.skillId);
  }
}

/**
 * 入队（如果不在队列里且没冷却）
 */
function tryEnqueue(gs, skillId, opts = {}) {
  const { cooldownTurns = 0, context = null } = opts;
  if (!gs.linkSkillQueue) gs.linkSkillQueue = [];

  // 已在队列 → 跳过（同时解锁只入队一次）
  if (gs.linkSkillQueue.some(e => e.skillId === skillId)) {
    return null;
  }

  // 冷却检查（B-11：剩余回合数语义，§12.7 冷却以回合计、跨天不清零）
  if (gs.linkSkillCooldowns && gs.linkSkillCooldowns[skillId] > 0) {
    return null;
  }

  const entry = {
    skillId,
    roleId: opts.roleId || null,
    // M-09（§12.5）：排队不计时，成为队首时才开始 3 秒窗口
    expireAtMs: null,
    cooldownTurns,
    context,  // 触发上下文（如元素类型、目标 creature 对象等）
  };
  gs.linkSkillQueue.push(entry);
  armHeadWindow(gs);
  EventBus.emit(GE.LINK_SKILL_READY, { skillId, entry });
  devLog.info('[LinkSkillSystem] enqueue', skillId);
  return entry;
}

/**
 * 每次普通技能触发后 fire —— SkillSystem.fireOneSkill 末尾
 * 检测：焚灭 +1 计数、追猎 +1 计数、风暴眼、汲取/风起（由 onElementDamage 处理）
 */
export function onSkillFired(gs, { roleId, skillId, skill, target }) {
  // ── 焚灭：每次夏阳技能 → 计数 +1 ──
  if (roleId === 'xiayang') {
    if (!gs.team) gs.team = {};
    gs.team.xiayangSkillCount = (gs.team.xiayangSkillCount || 0) + 1;
    const count = gs.team.xiayangSkillCount;
    devLog.info('[LinkSkillSystem] 焚灭计数 →', count);

    // 检查是否到 3 或 7
    const annihilate = getSkill('skill_link_xiayang_annihilate');
    if (annihilate) {
      // 二段 7 优先（到了 7 就先入二段，到了 3 先入一段）
      // C-2：context 带上触发目标，结算时以其所在围栏格为范围中心
      if (count >= 7) {
        tryEnqueue(gs, 'skill_link_xiayang_annihilate', {
          roleId: 'xiayang',
          context: { tier: 2, targetCreatureId: target ? target.id : null },
        });
      } else if (count >= 3) {
        tryEnqueue(gs, 'skill_link_xiayang_annihilate', {
          roleId: 'xiayang',
          context: { tier: 1, targetCreatureId: target ? target.id : null },
        });
      }
    }
  }

  // ── 追猎：我方技能攻击敌人 +1 计数 ──
  if (!gs.team) gs.team = {};
  gs.team.huntAttackCount = (gs.team.huntAttackCount || 0) + 1;
  if (gs.team.huntAttackCount >= 3) {
    tryEnqueue(gs, 'skill_link_luyouyou_hunt', {
      roleId: 'luyouyou',
      context: { targetCreatureId: target ? target.id : null },
    });
  }

  // ── 风暴眼：累计 4 种及以上元素（C-10：与 onElementDamage 共用检查） ──
  checkStormEyeReady(gs);
}

/**
 * 每次造成元素伤害后 fire —— CombatSystem calculateDamage 里（TalentSystem.recordElementDamage 之后同步 fire）
 * 触发：风起（火/水/雷/冰）、汲取（除余默外元素伤害）
 */
export function onElementDamage(gs, { element, byRoleId, target }) {
  // 风起：我方单位对敌人造成 火/水/雷/冰
  if (['fire', 'water', 'thunder', 'ice'].includes(element)) {
    tryEnqueue(gs, 'skill_link_luyouyou_rise_wind', {
      roleId: 'luyouyou',
      context: { element, targetCreatureId: target ? target.id : null },
    });
  }

  // 汲取：除余默外造成元素伤害
  if (byRoleId && byRoleId !== 'yumo') {
    tryEnqueue(gs, 'skill_link_yumo_drain', {
      roleId: 'yumo',
      context: { element },
    });
  }

  // C-10：第 4 种元素由连携/天赋记录时（不经过 onSkillFired）也立即检查风暴眼入队
  checkStormEyeReady(gs);
}

// ── C-2 范围语义辅助 ──

/** 找到包含指定生物的围栏格 */
function findFenceTileOfCreature(gs, creatureId) {
  for (const t of gs.map.fence) {
    if ((t.creatures || []).includes(creatureId)) return t;
  }
  return null;
}

/** 收集若干围栏格内的全部存活生物（去重） */
function collectCreaturesInTiles(gs, tiles) {
  const seen = new Set();
  const out = [];
  for (const t of tiles) {
    for (const cid of (t.creatures || [])) {
      if (seen.has(cid)) continue;
      const c = gs.creatures.find(cc => cc.id === cid);
      if (c && c.hp > 0) { seen.add(cid); out.push(c); }
    }
  }
  return out;
}

/** 点 (px,py) 到线段 (ax,ay)-(bx,by) 的距离 */
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * C-10：风暴眼入队检查 —— onSkillFired 与 onElementDamage 共用
 * （第 4 种元素无论由谁记录，都应立即入队）
 */
function checkStormEyeReady(gs) {
  const dailyEl = gs.team?.dailyElementDamages || [];
  if (dailyEl.length >= 4) {
    tryEnqueue(gs, 'skill_link_luyouyou_storm_eye', { roleId: 'luyouyou' });
  }
}

/**
 * 检测某 creature 是否 burn（炽燃）
 */
function isTargetBurned(creature) {
  if (!creature || !Array.isArray(creature.activeBuffs)) return false;
  return creature.activeBuffs.some(b => b.id === 'burn');
}

/**
 * 检测某 creature 是否 charge（弱点击破）
 */
function isTargetCharging(creature) {
  if (!creature || !Array.isArray(creature.activeBuffs)) return false;
  return creature.activeBuffs.some(b => b.id === 'charge');
}

/**
 * 定时轮询（每秒）：扫描是否有敌人 burn/charge → 入队炽燃 / 弱点击破
 * 这个需要一个定时器；可以挂在 CreatureSystem 的 tick 里，或由 UI LinkSkillUI 每秒 prune 时顺便扫
 */
export function periodicConditionScan(gs) {
  if (!gs?.creatures) return;

  // 炽燃：有敌人 burn
  const hasBurned = gs.creatures.some(c => isTargetBurned(c));
  if (hasBurned) {
    tryEnqueue(gs, 'skill_link_xiayang_scorch', { roleId: 'xiayang' });
  }

  // 弱点击破：有敌人 charge
  const hasCharge = gs.creatures.some(c => isTargetCharging(c));
  if (hasCharge) {
    tryEnqueue(gs, 'skill_link_luyouyou_weak_point', { roleId: 'luyouyou' });
  }
}

/**
 * 触发结算（UI 按 E 触发后调这个）
 * @param {object} gs
 * @param {string} skillId 连携技 id
 * @returns {{ ok: boolean, message?: string }}
 */
export function fireLinkSkill(gs, skillId) {
  const entry = (gs.linkSkillQueue || []).find(e => e.skillId === skillId);
  if (!entry) return { ok: false, message: 'notInQueue' };

  // 移除
  gs.linkSkillQueue = gs.linkSkillQueue.filter(e => e.skillId !== skillId);
  armHeadWindow(gs); // M-09：新队首开始计时
  EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId, triggered: true });

  const skill = getSkill(skillId);
  if (!skill) return { ok: false, message: 'skillNotFound' };

  const ctx = entry.context || {};
  const result = resolveLinkSkill(gs, skill, ctx);

  // 冷却：剩余回合数（TurnSystem.advanceTurn 每回合 -1；跨天不清零 —— §12.7）
  if (!gs.linkSkillCooldowns) gs.linkSkillCooldowns = {};
  gs.linkSkillCooldowns[skillId] = skill.cooldown || 0;

  devLog.info('[LinkSkillSystem] 结算', skill.name, '→', result);
  return { ok: true, result };
}

/**
 * 结算连携技 —— 按 characters.js 里的 triggerCondition / extraEffect
 */
function resolveLinkSkill(gs, skill, ctx) {
  devLog.info('[LinkSkillSystem.resolve]', skill.name, 'ctx=', ctx);
  EventBus.emit(GE.TOAST_SHOW, { text: `💥 连携技：${skill.name}！`, duration: 1500 });

  // 找到 fence 里所有 creature
  const allCreatures = [];
  for (const t of gs.map.fence) {
    for (const cid of (t.creatures || [])) {
      const c = gs.creatures.find(cc => cc.id === cid);
      if (c) allCreatures.push(c);
    }
  }

  switch (skill.id) {
    case 'skill_link_yumo_drain': {
      // 汲取：除余默外造成元素伤害时可用 → 余默下次攻击变该元素
      if (ctx.element) {
        gs.team.yumoNextElementOverride = ctx.element;
        devLog.info('[LinkSkill] 汲取 → 下次攻击元素 =', ctx.element);
      }
      break;
    }

    case 'skill_link_xiayang_scorch': {
      // 炽燃（SKL-L-004）：对 burn 的至多 3 名敌人 70% 火伤；无则 1 名
      // C-3：文档无「额外施加燃烧」效果，移除原 applyBuff burn 1
      const burned = allCreatures.filter(c => isTargetBurned(c));
      const targets = burned.length > 0 ? burned.slice(0, 3) : (allCreatures.length > 0 ? [allCreatures[0]] : []);
      for (const t of targets) {
        dealLinkSkillDamage(gs, skill, t, 'xiayang');
      }
      break;
    }

    case 'skill_link_xiayang_annihilate': {
      // 焚灭：计数 -3 或 -7，一段 140% 小范围 / 二段 260% 超大范围
      const tier = ctx.tier || 1;
      const eff = skill.extraEffect || {};
      const multiplier = tier === 2 ? eff.tier2Multiplier : eff.tier1Multiplier;
      const radius = tier === 2 ? eff.tier2Radius : eff.tier1Radius;

      const currentCount = gs.team.xiayangSkillCount || 0;
      const tierCost = tier === 2 ? (eff.countPerTierTwo || 7) : (eff.countPerTierUse || 3);
      gs.team.xiayangSkillCount = Math.max(0, currentCount - tierCost);
      devLog.info('[LinkSkill] 焚灭 tier', tier, 'consume', tierCost, 'remaining', gs.team.xiayangSkillCount);

      // C-2（SKL-L-002）：以触发目标所在围栏格为中心，欧氏距离 ≤ radius 的围栏格内生物吃伤害
      // 半径 0.4 → 仅同格（相邻格中心距 = 1）；半径 1.5 → 含对角（√2 ≈ 1.414）
      const centerTile = findFenceTileOfCreature(gs, ctx.targetCreatureId)
        || (allCreatures.length > 0 ? findFenceTileOfCreature(gs, allCreatures[0].id) : null);
      if (!centerTile) break;
      const nearTiles = gs.map.fence.filter(t =>
        Math.hypot(t.row - centerTile.row, t.col - centerTile.col) <= radius);
      const targets = collectCreaturesInTiles(gs, nearTiles);
      for (const c of targets) {
        dealLinkSkillDamage(gs, { ...skill, damageMultiplier: multiplier }, c, 'xiayang');
      }
      devLog.info('[LinkSkill] 焚灭 tier', tier, '半径', radius, '命中格', nearTiles.length, '目标', targets.length);
      break;
    }

    case 'skill_link_luyouyou_weak_point': {
      // 弱点击破：敌人蓄力时 70% 物理 + 3 回合虚弱 25% + 本次暴击率 +100%
      const target = allCreatures.find(c => isTargetCharging(c)) || (allCreatures.length > 0 ? allCreatures[0] : null);
      if (target) {
        // C-1（SKL-L-004）：本次暴击率 +100% 走真实暴击判定（CombatSystem 消费该字段），
        // 不再用伤害 ×1.5 捷径 —— 可正常触发 onCrit（比翼 / 风息元素转换联动）
        if (!gs.team) gs.team = {};
        gs.team.luyouyouNextCritBonus = Math.max(gs.team.luyouyouNextCritBonus || 0, 1.0);
        CombatSystem.calculateDamage({
          atk: gs.player.atk,
          skill,
          defender: target,
          element: 'physical',
          player: gs.player,
          gs,
          roleId: 'luyouyou',
          attackerRoleId: 'luyouyou',
        });
        CombatSystem.applyBuff({ buffId: 'weakened', target, duration: 3, params: { strength: 0.25 } });
      }
      break;
    }

    case 'skill_link_luyouyou_storm_eye': {
      // 风暴眼（SKL-L-007）：锁定随机 1 名敌人，龙卷风从玩家位置沿直线飞向该敌人，
      // C-2：对线段经过（格子中心到线段距离 ≤ 0.5）的所有敌人 80% 风伤 + 清空计数
      if (allCreatures.length > 0) {
        const lockTarget = allCreatures[Math.floor(Math.random() * allCreatures.length)];
        const start = Distance.outerIdxToXY(gs.map.size, gs.player.x);
        const tx = lockTarget.col + 1, ty = lockTarget.row + 1;
        for (const c of allCreatures) {
          const cx = c.col + 1, cy = c.row + 1;
          const d = start ? pointSegDist(cx, cy, start.x, start.y, tx, ty) : 0;
          if (d <= 0.5) {
            dealLinkSkillDamage(gs, skill, c, 'luyouyou', { overrideElement: 'wind' });
          }
        }
      }
      // 清空元素累计
      gs.team.dailyElementDamages = [];
      break;
    }

    case 'skill_link_luyouyou_hunt': {
      // 追猎：上一次攻击的目标 → 3 次弹射 20% 物理；允许重复弹射
      let lastTarget = allCreatures.find(c => c.id === ctx.targetCreatureId);
      if (!lastTarget && allCreatures.length > 0) lastTarget = allCreatures[0];
      if (!lastTarget) break;

      let cur = lastTarget;
      for (let i = 0; i < 3; i++) {
        dealLinkSkillDamage(gs, skill, cur, 'luyouyou', { overrideMultiplier: skill.damageMultiplier });
        // C-2（SKL-L-006）：每次弹射以当前目标为中心半径 0.3 格内（含自身）随机 1 名敌人
        // —— 围栏格中心距最小为 1，半径 0.3 内候选即当前目标同围栏格的存活生物
        const curTile = findFenceTileOfCreature(gs, cur.id);
        const candidates = curTile ? collectCreaturesInTiles(gs, [curTile]) : [];
        if (candidates.length > 0) {
          cur = candidates[Math.floor(Math.random() * candidates.length)];
        }
      }
      // 清空计数
      gs.team.huntAttackCount = 0;
      break;
    }

    case 'skill_link_luyouyou_rise_wind': {
      // 风起：对 1 名敌人 15% 风伤 + 3 回合 30% 易伤
      const target = allCreatures.find(c => c.id === ctx.targetCreatureId) || (allCreatures.length > 0 ? allCreatures[0] : null);
      if (target) {
        dealLinkSkillDamage(gs, skill, target, 'luyouyou', { overrideElement: 'wind' });
        CombatSystem.applyBuff({ buffId: 'vulnerable', target, duration: 3, params: { strength: 0.30 } });
      }
      break;
    }

    case 'skill_link_shift': {
      // 移形（SKL-L-008）：对 1 名敌人 50% 物理伤害；本日内每经过 1 格倍率 +5%（按结算时的今日累计移动距离）
      const target = allCreatures.length > 0 ? allCreatures[0] : null;
      if (target) {
        const eff = skill.extraEffect || {};
        const dist = gs.team?.dailyDistanceMoved || 0;
        const multiplier = (eff.base ?? skill.damageMultiplier) + (eff.perTile ?? 0.05) * dist;
        devLog.info('[LinkSkill] 移形 今日移动', dist, '格 → 倍率', multiplier.toFixed(2));
        dealLinkSkillDamage(gs, { ...skill, damageMultiplier: multiplier }, target, null);
      }
      break;
    }
  }
}

/**
 * 对 creature 造成一次技能伤害（内部 helper）
 */
function dealLinkSkillDamage(gs, skill, target, attackerRoleId, opts = {}) {
  if (!target || target.hp <= 0) return;
  const dmg = CombatSystem.calculateDamage({
    atk: gs.player.atk,
    skill,
    defender: target,
    element: opts.overrideElement || skill.element,
    player: gs.player,
    gs,
    roleId: attackerRoleId,
    attackerRoleId,
  });
  if (target.hp <= 0) {
    // 击败了 —— fire 击败逻辑（TalentSystem.onCreatureDefeated 会 fire 好奇心）
    devLog.info('[LinkSkill] defeated', target.kind);
    EventBus.emit(GE.CREATURE_DEFEATED, { creature: target });
    for (const t of gs.map.fence) {
      t.creatures = (t.creatures || []).filter(cid => cid !== target.id);
    }
    gs.creatures = gs.creatures.filter(c => c.id !== target.id);
    CreatureSystem.grantKillDrops(gs, target); // 击杀掉落（物品库 BIO drops）
    TalentSystem.onCreatureDefeated(gs, target);
  }
  return dmg;
}

/**
 * UI 入口：按 E 时调这个
 */
export function fireCurrentQueueTop(gs) {
  if (!gs.linkSkillQueue || gs.linkSkillQueue.length === 0) return false;
  const top = gs.linkSkillQueue[0];
  return fireLinkSkill(gs, top.skillId);
}

// ── 这些是保留的 stub，提供一致的 API ──
export function enqueueLinkSkill(gs, opts) {
  return tryEnqueue(gs, opts.skillId, opts);
}

export function popLinkSkill(gs, skillId) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return null;
  const idx = gs.linkSkillQueue.findIndex(e => e.skillId === skillId);
  if (idx >= 0) {
    const popped = gs.linkSkillQueue.splice(idx, 1)[0];
    armHeadWindow(gs); // M-09：新队首开始计时
    return popped;
  }
  return null;
}

export function pruneExpired(gs) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return 0;
  const now = Date.now();
  let removed = 0;
  // M-09（§12.5）：只有队首在计时 —— 仅修剪队首；队首过期后为新队首开始计时并继续检查
  while (gs.linkSkillQueue.length > 0) {
    const head = gs.linkSkillQueue[0];
    if (head.expireAtMs && head.expireAtMs < now) {
      gs.linkSkillQueue.shift();
      EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId: head.skillId, triggered: false });
      devLog.info('[LinkSkillSystem] expired', head.skillId);
      removed++;
      armHeadWindow(gs);
    } else {
      break;
    }
  }
  return removed;
}

export function checkReady(gs, conditionKey) {
  const allLinkSkills = Object.values(getSkillsByRole('yumo').concat(getSkillsByRole('xiayang')).concat(getSkillsByRole('luyouyou'))).filter(s => s.isLinkSkill);
  for (const ls of allLinkSkills) {
    if (ls.triggerCondition === conditionKey) {
      // 简化：直接 tryEnqueue
      tryEnqueue(gs, ls.id, { roleId: ls.roleId });
      return true;
    }
  }
  return false;
}

export function resetAll(gs) {
  if (!gs) return;
  if (Array.isArray(gs.linkSkillQueue)) gs.linkSkillQueue.length = 0;
  gs.lastTurnLinkSkill = 0;
  // B-11：§12.7 冷却均以回合计、跨天不清零 —— 跨天只清队列，不清冷却
  // （冷却由 TurnSystem.advanceTurn → advanceCooldowns 每回合递减）
}

/**
 * B-11：连携技冷却每回合递减（由 TurnSystem.advanceTurn 调用）
 */
export function advanceCooldowns(gs) {
  if (!gs || !gs.linkSkillCooldowns) return;
  for (const k of Object.keys(gs.linkSkillCooldowns)) {
    gs.linkSkillCooldowns[k] -= 1;
    if (gs.linkSkillCooldowns[k] <= 0) delete gs.linkSkillCooldowns[k];
  }
}

/**
 * A-6：载具移动后触发移形（SKL-L-008）入队 —— 由 GameDirector 的载具移动订阅调用。
 * 仅当已通过技能石习得（背包持有 skill_link_shift）时生效。
 */
export function onVehicleMoved(gs, { distance = 1 } = {}) {
  if (!gs) return;
  if (!gs.team) gs.team = {};
  gs.team.dailyDistanceMoved = (gs.team.dailyDistanceMoved || 0) + Math.max(1, distance);
  const learned = InventorySystem.countItem(gs, 'skill_link_shift') >= 1;
  if (!learned) return;
  tryEnqueue(gs, 'skill_link_shift', { roleId: null, context: { distance } });
}

export const LinkSkillSystem = {
  // 事件驱动入口
  onSkillFired,
  onElementDamage,
  periodicConditionScan,
  // 结算
  fireLinkSkill,
  fireCurrentQueueTop,
  resolveLinkSkill,
  // 队列 API
  enqueue: enqueueLinkSkill,
  pop: popLinkSkill,
  pruneExpired,
  checkReady,
  resetAll,
  advanceCooldowns,
  onVehicleMoved,
};
