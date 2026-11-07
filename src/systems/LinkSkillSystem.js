// src/systems/LinkSkillSystem.js
// Agent 3 —— 连携技完整实现
// 7 个连携技：汲取 / 炽燃 / 焚灭 / 弱点击破 / 风暴眼 / 追猎 / 风起（+ 移形）
//
// 实例化语义（v0.5 §12.1 / §12.5，用户裁定）：
//   - 每一份「放置在外圈地块上的技能卡」= 一个独立实例：instanceKey = `${tileIdx}|${skillId}`
//   - 队列条目 / 冷却 / 计数都按实例标识，同名多份互不共享
//   - 未放置 → 不入队、不累计；拆卡/替换 → 该实例的计数、冷却、队列条目立即作废
//   - 计数型效果（焚灭 / 追猎 / 风暴眼）从放置那一刻开始计数，拆除后清零
//   - 角色必须仍在编队内（离队时由 BuildSystem 自动拆回背包）
//
// 触发时机：
//   - onSkillFired(roleId, skill, target)  —— SkillSystem.fireOneSkill 末尾 fire
//   - onElementDamage(element, byRoleId)   —— CombatSystem calculateDamage 造成元素伤害后 fire
//   - resetAll(gs)                          —— DaySystem.startNewDay 末尾
//
// 结算：pop 后对目标造成伤害 + 应用额外效果（按 characters.js 的 triggerCondition/extraEffect）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { getSkill, SKILLS } from '../data/characters.js';
import {
  createSettlement,
  commitSettlement,
  judgeModeOf,
  liveById,
  enemyPool,
  orderByDistance,
  selectNearestEnemies,
  selectRandomEnemies,
  entriesNearPoint,
  instanceAnchor,
  playerAnchor,
  circleTargetsOf,
  lineTileRefs,
  tileTargetsOf,
  registerDamage,
} from './SkillResolve.js';

export const WINDOW_MS = 8000; // 8 秒实时窗口

// ── 实例标识 ──────────────────────────────────────────────

/** 放置实例键：地块下标 + 技能 id（同名多份 → 不同 tileIdx → 不同实例） */
export function makeInstanceKey(tileIdx, skillId) {
  return `${tileIdx}|${skillId}`;
}

function parseInstanceKey(key) {
  if (typeof key !== 'string') return null;
  const i = key.indexOf('|');
  if (i <= 0) return null;
  const tileIdx = Number(key.slice(0, i));
  if (!Number.isInteger(tileIdx) || tileIdx < 0) return null;
  return { tileIdx, skillId: key.slice(i + 1) };
}

/** 当前编队（activeGroup）内的角色 id 列表 */
export function getActiveGroupRoles(gs) {
  const group = gs.team?.groups?.[gs.team?.activeGroup ?? 0];
  return group ? (group.roles || []) : [];
}

/**
 * 扫描外圈地块，返回所有「有效放置实例」
 * 有效 = contentId 是连携技 + 该技能归属角色仍在编队内（通用技能 roleId 为 null 不受限）
 * @param {object} gs
 * @param {string|null} skillId 只取某个技能
 */
export function getPlacedInstances(gs, skillId = null) {
  const tiles = gs?.map?.outerTiles;
  if (!Array.isArray(tiles)) return [];
  const roles = getActiveGroupRoles(gs);
  const out = [];
  for (let tileIdx = 0; tileIdx < tiles.length; tileIdx++) {
    const cid = tiles[tileIdx]?.contentId;
    if (!cid || !cid.startsWith('skill_')) continue;
    if (skillId && cid !== skillId) continue;
    const def = SKILLS[cid];
    if (!def || !def.isLinkSkill) continue;
    if (def.roleId && !roles.includes(def.roleId)) continue;
    out.push({
      key: makeInstanceKey(tileIdx, cid),
      tileIdx,
      skillId: cid,
      roleId: def.roleId || null,
    });
  }
  return out;
}

/** 该实例是否仍真实放置在某外圈格上 */
export function findInstance(gs, key) {
  const parsed = parseInstanceKey(key);
  if (!parsed) return null;
  const tile = gs?.map?.outerTiles?.[parsed.tileIdx];
  if (!tile || tile.contentId !== parsed.skillId) return null;
  const def = SKILLS[parsed.skillId];
  if (!def || !def.isLinkSkill) return null;
  if (def.roleId && !getActiveGroupRoles(gs).includes(def.roleId)) return null;
  return {
    key,
    tileIdx: parsed.tileIdx,
    skillId: parsed.skillId,
    roleId: def.roleId || null,
  };
}

// ── 实例计数（每实例独立） ────────────────────────────────

function ensureCounters(gs) {
  if (!gs.linkSkillCounters || typeof gs.linkSkillCounters !== 'object') gs.linkSkillCounters = {};
  return gs.linkSkillCounters;
}

function getCounter(gs, key) {
  const map = ensureCounters(gs);
  if (!map[key]) map[key] = { count: 0, elements: [] };
  return map[key];
}

/**
 * 放置钩子（BuildSystem.placeContent 成功后调用）：实例计数/冷却从 0 起算
 */
export function onSkillCardPlaced(gs, tileIdx, skillId) {
  const def = SKILLS[skillId];
  if (!def?.isLinkSkill) return;
  const key = makeInstanceKey(tileIdx, skillId);
  ensureCounters(gs)[key] = { count: 0, elements: [] };
  if (gs.linkSkillCooldowns) delete gs.linkSkillCooldowns[key];
  if (Array.isArray(gs.linkSkillQueue)) {
    gs.linkSkillQueue = gs.linkSkillQueue.filter(e => e.key !== key);
  }
  devLog.info('[LinkSkillSystem] 实例放置 → 计数清零', key);
}

/**
 * 拆除/替换钩子：清该实例的计数、冷却、队列条目（窗口立即作废）
 */
export function onSkillCardRemoved(gs, tileIdx, skillId) {
  const def = SKILLS[skillId];
  if (!def?.isLinkSkill) return;
  const key = makeInstanceKey(tileIdx, skillId);
  if (gs.linkSkillCounters) delete gs.linkSkillCounters[key];
  if (gs.linkSkillCooldowns) delete gs.linkSkillCooldowns[key];
  if (Array.isArray(gs.linkSkillQueue)) {
    gs.linkSkillQueue = gs.linkSkillQueue.filter(e => e.key !== key);
  }
  devLog.info('[LinkSkillSystem] 实例拆除 → 计数/冷却/队列清零', key);
}

/**
 * 按实例清理：丢弃已不存在实例的队列条目、计数、冷却（兜底，防止拆卡后残留窗口）
 */
export function pruneUnplaced(gs) {
  if (!gs) return 0;
  const valid = new Set(getPlacedInstances(gs).map(i => i.key));
  let removed = 0;
  if (Array.isArray(gs.linkSkillQueue)) {
    const before = gs.linkSkillQueue.length;
    gs.linkSkillQueue = gs.linkSkillQueue.filter(e => e.key && valid.has(e.key));
    removed = before - gs.linkSkillQueue.length;
    if (removed > 0) armHeadWindow(gs);
  }
  for (const map of [gs.linkSkillCounters, gs.linkSkillCooldowns]) {
    if (!map || typeof map !== 'object') continue;
    for (const k of Object.keys(map)) {
      if (!valid.has(k)) delete map[k];
    }
  }
  return removed;
}

/**
 * M-09（§12.5）：8 秒窗口只在条目成为队首（可触发）时开始计时，排队不计时。
 * 队首条目尚无窗口时立即开始计时。
 */
function armHeadWindow(gs) {
  const q = gs.linkSkillQueue;
  if (!Array.isArray(q) || q.length === 0) return;
  const head = q[0];
  if (!head.expireAtMs) {
    head.expireAtMs = Date.now() + WINDOW_MS;
    devLog.info('[LinkSkillSystem] 队首窗口开始计时', head.key, head.skillId);
  }
}

/**
 * 入队（按实例去重 + 按实例冷却；实例必须真实放置）
 * @param {object} gs
 * @param {{key:string, tileIdx:number, skillId:string, roleId:string|null}} instance
 * @param {{cooldownTurns?:number, context?:object}} opts
 */
function tryEnqueue(gs, instance, opts = {}) {
  if (!instance || !instance.key) return null;
  // ── 统一闸门：实例必须仍放置在外圈地块上 ──
  if (!findInstance(gs, instance.key)) return null;

  const { cooldownTurns = 0, context = null } = opts;
  if (!gs.linkSkillQueue) gs.linkSkillQueue = [];

  // 同一实例已在队列 → 跳过（不同地块的同名实例各自独立）
  if (gs.linkSkillQueue.some(e => e.key === instance.key)) {
    return null;
  }

  // 实例冷却检查（B-11：剩余回合数语义，§12.7 冷却以回合计、跨天不清零）
  if (gs.linkSkillCooldowns && gs.linkSkillCooldowns[instance.key] > 0) {
    return null;
  }

  const entry = {
    key: instance.key,
    skillId: instance.skillId,
    tileIdx: instance.tileIdx,
    roleId: instance.roleId,
    // M-09（§12.5）：排队不计时，成为队首时才开始 8 秒窗口
    expireAtMs: null,
    cooldownTurns,
    context,  // 触发上下文（如元素类型、目标 creature 对象等）
  };
  gs.linkSkillQueue.push(entry);
  armHeadWindow(gs);
  EventBus.emit(GE.LINK_SKILL_READY, { skillId: instance.skillId, key: instance.key, entry });
  devLog.info('[LinkSkillSystem] enqueue', instance.key);
  return entry;
}

/**
 * 每次普通技能触发后 fire —— SkillSystem.fireOneSkill 末尾
 * 焚灭 +1 计数（逐实例）、追猎 +1 计数（逐实例）、风暴眼检查
 */
export function onSkillFired(gs, { roleId, skillId, skill, target }) {
  // ── 焚灭：每份已放置实例各自计数（未放置不累计）──
  if (roleId === 'xiayang') {
    const annihilate = SKILLS.skill_link_xiayang_annihilate;
    if (annihilate) {
      for (const inst of getPlacedInstances(gs, 'skill_link_xiayang_annihilate')) {
        const counter = getCounter(gs, inst.key);
        counter.count += 1;
        devLog.info('[LinkSkillSystem] 焚灭计数 →', inst.key, counter.count);
        // 二段 7 优先（到了 7 就先入二段，到了 3 先入一段）
        // C-2：context 带上触发目标，结算时以其所在围栏格为范围中心
        if (counter.count >= 7) {
          tryEnqueue(gs, inst, { context: { tier: 2, targetCreatureId: target ? target.id : null } });
        } else if (counter.count >= 3) {
          tryEnqueue(gs, inst, { context: { tier: 1, targetCreatureId: target ? target.id : null } });
        }
      }
    }
  }

  // ── 追猎：我方技能攻击敌人 +1 计数（逐实例）──
  for (const inst of getPlacedInstances(gs, 'skill_link_luyouyou_hunt')) {
    const counter = getCounter(gs, inst.key);
    counter.count += 1;
    if (counter.count >= 3) {
      tryEnqueue(gs, inst, { context: { targetCreatureId: target ? target.id : null } });
    }
  }

  // ── 风暴眼：逐实例累计 4 种及以上元素（C-10：与 onElementDamage 共用检查）──
  checkStormEyeReady(gs);
}

/**
 * 每次造成元素伤害后 fire —— CombatSystem calculateDamage 里（TalentSystem.recordElementDamage 之后同步 fire）
 * 触发：风起（火/水/雷/冰）、汲取（除余默外元素伤害）
 */
export function onElementDamage(gs, { element, byRoleId, target }) {
  // 风起：我方单位对敌人造成 火/水/雷/冰（逐实例）
  if (['fire', 'water', 'thunder', 'ice'].includes(element)) {
    for (const inst of getPlacedInstances(gs, 'skill_link_luyouyou_rise_wind')) {
      tryEnqueue(gs, inst, { context: { element, targetCreatureId: target ? target.id : null } });
    }
  }

  // 汲取：除余默外造成元素伤害（逐实例）
  if (byRoleId && byRoleId !== 'yumo') {
    for (const inst of getPlacedInstances(gs, 'skill_link_yumo_drain')) {
      tryEnqueue(gs, inst, { context: { element } });
    }
  }

  // 风暴眼：逐实例记录本日元素种类
  recordStormEyeElement(gs, element);
  checkStormEyeReady(gs);
}

/** 风暴眼逐实例记录元素种类（物理不计） */
function recordStormEyeElement(gs, element) {
  if (!element || element === 'physical') return;
  for (const inst of getPlacedInstances(gs, 'skill_link_luyouyou_storm_eye')) {
    const counter = getCounter(gs, inst.key);
    if (!counter.elements.includes(element)) counter.elements.push(element);
  }
}

// ── 结算辅助 ──────────────────────────────────────────────

/** 连携技参照点（§12.3）：实例所在地块中心；未带 tileIdx 时退回玩家格中心 */
function linkAnchorOf(gs, ctx) {
  if (typeof ctx?.tileIdx === 'number') return instanceAnchor(gs, ctx.tileIdx);
  return playerAnchor(gs);
}

/** 快照条目对应的活体是否带有指定 buff（集合先定：几何读快照，状态读最新） */
function entryHasBuff(gs, entry, buffId) {
  const live = liveById(gs, entry.id);
  if (!live || !Array.isArray(live.activeBuffs)) return false;
  return live.activeBuffs.some(b => b.id === buffId);
}

/**
 * C-10：风暴眼入队检查 —— 逐实例（只检查真实放置的实例）
 */
function checkStormEyeReady(gs) {
  for (const inst of getPlacedInstances(gs, 'skill_link_luyouyou_storm_eye')) {
    const counter = getCounter(gs, inst.key);
    if (counter.elements.length >= 4) tryEnqueue(gs, inst);
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
 * 定时轮询（每秒）：扫描是否有敌人 burn/charge → 逐实例入队炽燃 / 弱点击破
 */
export function periodicConditionScan(gs) {
  if (!gs?.creatures) return;
  pruneUnplaced(gs);

  // 炽燃：有敌人 burn
  if (gs.creatures.some(c => isTargetBurned(c))) {
    for (const inst of getPlacedInstances(gs, 'skill_link_xiayang_scorch')) {
      tryEnqueue(gs, inst);
    }
  }

  // 弱点击破：有敌人 charge
  if (gs.creatures.some(c => isTargetCharging(c))) {
    for (const inst of getPlacedInstances(gs, 'skill_link_luyouyou_weak_point')) {
      tryEnqueue(gs, inst);
    }
  }
}

/**
 * 触发结算（UI 按 E 触发后调这个）
 * @param {object} gs
 * @param {string} key 放置实例键（`tileIdx|skillId`）
 * @returns {{ ok: boolean, message?: string }}
 */
export function fireLinkSkill(gs, key) {
  const queue = Array.isArray(gs.linkSkillQueue) ? gs.linkSkillQueue : [];
  const entry = queue.find(e => e.key === key);
  if (!entry) return { ok: false, message: 'notInQueue' };

  // 裁定 4：拆卡 / 替换后窗口立即作废 —— 结算前再校验实例是否仍在场
  if (!findInstance(gs, entry.key)) {
    gs.linkSkillQueue = queue.filter(e => e.key !== entry.key);
    EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId: entry.skillId, key: entry.key, triggered: false });
    devLog.info('[LinkSkillSystem] 实例已不在场，作废窗口', entry.key);
    return { ok: false, message: 'unplaced' };
  }

  // 移除
  gs.linkSkillQueue = gs.linkSkillQueue.filter(e => e.key !== entry.key);
  armHeadWindow(gs); // M-09：新队首开始计时
  EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId: entry.skillId, key: entry.key, triggered: true });

  const skill = getSkill(entry.skillId);
  if (!skill) return { ok: false, message: 'skillNotFound' };

  // ctx.tileIdx：连携技实例所在地块 —— 目标型索敌的参照点（§12.3）
  const ctx = { ...(entry.context || {}), instanceKey: entry.key, tileIdx: entry.tileIdx };
  const result = resolveLinkSkill(gs, skill, ctx);

  // 冷却：剩余回合数（TurnSystem.advanceTurn 每回合 -1；跨天不清零 —— §12.7）
  if (!gs.linkSkillCooldowns) gs.linkSkillCooldowns = {};
  gs.linkSkillCooldowns[entry.key] = skill.cooldown || 0;

  devLog.info('[LinkSkillSystem] 结算', skill.name, '实例', entry.key, '→', result);
  return { ok: true, result };
}

/**
 * 结算连携技 —— 按 characters.js 里的 triggerCondition / extraEffect
 */
export function resolveLinkSkill(gs, skill, ctx = {}) {
  devLog.info('[LinkSkillSystem.resolve]', skill.name, 'ctx=', ctx);
  EventBus.emit(GE.TOAST_SHOW, { text: `💥 连携技：${skill.name}！`, duration: 1500 });

  // §3.2 ⑦c / §3.6：一次结算一份快照 —— 本次连携技的判定几何只读这份
  const judgeMode = judgeModeOf(skill);
  const settlement = createSettlement(gs, {
    skillId: skill.id,
    instanceKey: ctx.instanceKey || `link:${skill.id}`,
    phase: 'link',
    roleId: skill.roleId,
    attackerRoleId: skill.roleId,
  });
  const anchor = linkAnchorOf(gs, ctx);
  const eff = skill.extraEffect || {};
  let hitCount = 0;
  let clearStormEyeElements = false;

  /** 登记伤害（跨格 / 重复目标由批次去重；同一目标多段合并） */
  const register = (entries, opts = {}) => {
    const applied = registerDamage(settlement, entries, {
      element: skill.element,
      ...opts,
    });
    hitCount += applied.length;
    return applied;
  };

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
      // 炽燃（SKL-L-004）：燃烧集合内**最近**至多 3 名敌人 70% 火伤；无燃烧目标则最近 1 名
      // C-3：文档无「额外施加燃烧」效果，不施加 burn
      const burned = enemyPool(settlement.snapshot).filter(e => entryHasBuff(gs, e, 'burn'));
      const targets = burned.length > 0
        ? orderByDistance(burned, anchor, settlement.snapshot).slice(0, eff.maxTargetsWithBurn || 3)
        : selectNearestEnemies(settlement.snapshot, anchor, { count: 1 });
      register(targets, { multiplier: skill.damageMultiplier, key: skill.id });
      devLog.info('[LinkSkill] 炽燃 燃烧集合', burned.length, '→ 命中', targets.length);
      break;
    }

    case 'skill_link_xiayang_annihilate': {
      // 焚灭：计数 -3 或 -7，一段 140% 小范围 / 二段 260% 超大范围
      // 计数按放置实例独立（ctx.instanceKey）
      const tier = ctx.tier || 1;
      const cEff = skill.extraEffect || {};
      const multiplier = tier === 2 ? cEff.tier2Multiplier : cEff.tier1Multiplier;
      const radius = tier === 2 ? cEff.tier2Radius : cEff.tier1Radius;

      const counter = ctx.instanceKey ? getCounter(gs, ctx.instanceKey) : null;
      const currentCount = counter ? counter.count : 0;
      const tierCost = tier === 2 ? (cEff.countPerTierTwo || 7) : (cEff.countPerTierUse || 3);
      if (counter) counter.count = Math.max(0, currentCount - tierCost);
      devLog.info('[LinkSkill] 焚灭 tier', tier, 'consume', tierCost, 'remaining', counter ? counter.count : 0);

      // C-2（SKL-L-002）：tile 型 —— 锚点 = 目标**中心点**，半径按米计（1 格边长 = 1 米），
      // 命中 = 锚点圆与生物碰撞圆重叠（§12.3，不绑定地块枚举）
      const targetEntry = (ctx.targetCreatureId
        ? settlement.snapshot.creatures.find(e => e.id === ctx.targetCreatureId)
        : null) || selectNearestEnemies(settlement.snapshot, anchor, { count: 1 })[0];
      if (!targetEntry) break;
      const targets = circleTargetsOf(settlement, skill, { x: targetEntry.x, y: targetEntry.y }, radius);
      register(targets, { multiplier, key: skill.id });
      devLog.info('[LinkSkill] 焚灭 tier', tier, '半径', radius, '目标', targets.length);
      break;
    }

    case 'skill_link_luyouyou_weak_point': {
      // 弱点击破：蓄力集合内**最近** 1 名 70% 物理 + 3 回合虚弱 25% + 本次暴击率 +100%
      const charging = enemyPool(settlement.snapshot).filter(e => entryHasBuff(gs, e, 'charge'));
      const targetEntry = orderByDistance(charging, anchor, settlement.snapshot)[0]
        || selectNearestEnemies(settlement.snapshot, anchor, { count: 1 })[0];
      if (targetEntry) {
        const live = liveById(gs, targetEntry.id);
        // C-1（SKL-L-004）：本次暴击率 +100% 走真实暴击判定（CombatSystem 消费该字段），
        // 不再用伤害 ×1.5 捷径 —— 可正常触发 onCrit（比翼 / 风息元素转换联动）
        if (!gs.team) gs.team = {};
        gs.team.luyouyouNextCritBonus = Math.max(gs.team.luyouyouNextCritBonus || 0, 1.0);
        register([targetEntry], { multiplier: skill.damageMultiplier, key: skill.id });
        if (live) settlement.batch.buff(live, 'weakened', { strength: eff.strength ?? 0.25, duration: eff.duration ?? 3 });
      }
      break;
    }

    case 'skill_link_luyouyou_storm_eye': {
      // 风暴眼（SKL-L-007）：随机锁定 1 名敌人，龙卷风从玩家格中心沿直线飞向目标中心；
      // tile 型：线段经过（地块中心到线段距离 ≤ areaRadius）的地块内所有生物吃 80% 风伤
      const lockEntry = selectRandomEnemies(settlement.snapshot, { count: 1 })[0];
      if (lockEntry) {
        const from = playerAnchor(gs);
        const nearTiles = lineTileRefs(gs, from, { x: lockEntry.x, y: lockEntry.y }, skill.areaRadius ?? 0.5);
        const targets = tileTargetsOf(settlement, skill, nearTiles);
        register(targets, { multiplier: skill.damageMultiplier, element: 'wind', key: skill.id });
        devLog.info('[LinkSkill] 风暴眼 锁定', lockEntry.id, '线带', nearTiles.length, '格 →', targets.length, '目标');
      }
      // 清空该实例的元素累计（在批次提交后执行，避免本次伤害又把元素记回去）
      if (ctx.instanceKey) clearStormEyeElements = true;
      break;
    }

    case 'skill_link_luyouyou_hunt': {
      // 追猎：上一次攻击的目标 → 3 次弹射 20% 物理；允许重复弹射（每次独立伤害键）
      let cur = (ctx.targetCreatureId
        ? settlement.snapshot.creatures.find(e => e.id === ctx.targetCreatureId)
        : null) || selectNearestEnemies(settlement.snapshot, anchor, { count: 1 })[0];
      if (!cur) break;

      const bounceCount = eff.bounceCount || 3;
      const bounceRadius = eff.bounceRadius ?? 0.3;
      for (let i = 0; i < bounceCount; i++) {
        // 每次弹射独立 key，允许同一目标被多次弹射（不叠加、但逐段结算）
        register([cur], { multiplier: skill.damageMultiplier, key: `bounce:${i}` });
        // C-2 / characters.js note：以当前目标**中心点**为锚点、0.3 圆-圆接触半径内随机 1 名（含自身）
        const candidates = entriesNearPoint(settlement.snapshot, { x: cur.x, y: cur.y }, bounceRadius);
        if (candidates.length > 0) {
          cur = candidates[Math.floor(Math.random() * candidates.length)];
        }
      }
      // 清空该实例计数
      if (ctx.instanceKey) getCounter(gs, ctx.instanceKey).count = 0;
      break;
    }

    case 'skill_link_luyouyou_rise_wind': {
      // 风起：对 1 名敌人（触发目标优先，否则最近）15% 风伤 + 3 回合 30% 易伤
      const targetEntry = (ctx.targetCreatureId
        ? settlement.snapshot.creatures.find(e => e.id === ctx.targetCreatureId)
        : null) || selectNearestEnemies(settlement.snapshot, anchor, { count: 1 })[0];
      if (targetEntry) {
        const live = liveById(gs, targetEntry.id);
        register([targetEntry], { multiplier: skill.damageMultiplier, element: 'wind', key: skill.id });
        if (live) settlement.batch.buff(live, 'vulnerable', { strength: eff.strength ?? 0.30, duration: eff.duration ?? 3 });
      }
      break;
    }

    case 'skill_link_shift': {
      // 移形（SKL-L-008）：对 1 名敌人（最近）50% 物理伤害；本日内每经过 1 格倍率 +5%
      const targetEntry = selectNearestEnemies(settlement.snapshot, anchor, { count: 1 })[0];
      if (targetEntry) {
        const dist = gs.team?.dailyDistanceMoved || 0;
        const multiplier = (eff.base ?? skill.damageMultiplier) + (eff.perTile ?? 0.05) * dist;
        devLog.info('[LinkSkill] 移形 今日移动', dist, '格 → 倍率', multiplier.toFixed(2));
        register([targetEntry], { multiplier, key: skill.id });
      }
      break;
    }
  }

  // 批次末统一应用（登记顺序）+ flush 死亡（掉落 / 移除只结算一次）
  const { summary, deaths } = commitSettlement(settlement);
  if (clearStormEyeElements) getCounter(gs, ctx.instanceKey).elements = [];
  devLog.info('[LinkSkill]', skill.name, '结算完成：', summary.damages.length, '伤害组 /',
    summary.buffs.length, 'buff组 / 击败', deaths.defeated.length);
  return { judgeMode, hitCount, batch: summary, deaths: deaths.defeated };
}

/**
 * UI 入口：按 E 时调这个
 */
export function fireCurrentQueueTop(gs) {
  if (!gs.linkSkillQueue || gs.linkSkillQueue.length === 0) return false;
  const top = gs.linkSkillQueue[0];
  if (!top?.key) return false;
  return fireLinkSkill(gs, top.key);
}

/** 入队 API：opts = { key } | { tileIdx, skillId } | { skillId }（未放置 → null） */
export function enqueueLinkSkill(gs, opts = {}) {
  const instance = resolveInstanceFromOpts(gs, opts);
  if (!instance) return null;
  return tryEnqueue(gs, instance, opts);
}

function resolveInstanceFromOpts(gs, opts) {
  if (opts.key) return findInstance(gs, opts.key);
  if (Number.isInteger(opts.tileIdx) && opts.skillId) {
    return findInstance(gs, makeInstanceKey(opts.tileIdx, opts.skillId));
  }
  if (opts.skillId) {
    // 未指定地块：仅当该技能恰好只有一份放置实例时才可定位（否则无法区分实例）
    const list = getPlacedInstances(gs, opts.skillId);
    return list.length === 1 ? list[0] : null;
  }
  return null;
}

export function popLinkSkill(gs, key) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return null;
  const idx = gs.linkSkillQueue.findIndex(e => e.key === key);
  if (idx >= 0) {
    const popped = gs.linkSkillQueue.splice(idx, 1)[0];
    armHeadWindow(gs); // M-09：新队首开始计时
    return popped;
  }
  return null;
}

export function pruneExpired(gs) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return 0;
  // 裁定 4：先按实例清理已拆除/替换的窗口
  pruneUnplaced(gs);
  const now = Date.now();
  let removed = 0;
  // M-09（§12.5）：只有队首在计时 —— 仅修剪队首；队首过期后为新队首开始计时并继续检查
  while (gs.linkSkillQueue.length > 0) {
    const head = gs.linkSkillQueue[0];
    if (head.expireAtMs && head.expireAtMs < now) {
      gs.linkSkillQueue.shift();
      EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId: head.skillId, key: head.key, triggered: false });
      devLog.info('[LinkSkillSystem] expired', head.key);
      removed++;
      armHeadWindow(gs);
    } else {
      break;
    }
  }
  return removed;
}

/** 条件 key → 所有满足条件的已放置实例入队 */
export function checkReady(gs, conditionKey) {
  const matched = getPlacedInstances(gs).filter(inst => SKILLS[inst.skillId]?.triggerCondition === conditionKey);
  if (matched.length === 0) return false;
  for (const inst of matched) tryEnqueue(gs, inst);
  return true;
}

export function resetAll(gs) {
  if (!gs) return;
  if (Array.isArray(gs.linkSkillQueue)) gs.linkSkillQueue.length = 0;
  gs.lastTurnLinkSkill = 0;
  // B-11：§12.7 冷却均以回合计、跨天不清零 —— 跨天只清队列，不清冷却
  // （冷却由 TurnSystem.advanceTurn → advanceCooldowns 每回合递减）
  pruneUnplaced(gs);
  // 每日计数：焚灭计数 / 风暴眼元素累计逐实例清空（拆除才清其余实例的计数）
  const counters = gs.linkSkillCounters;
  if (counters && typeof counters === 'object') {
    for (const [key, c] of Object.entries(counters)) {
      if (!c) continue;
      c.elements = [];
      if (key.includes('|skill_link_xiayang_annihilate')) c.count = 0;
    }
  }
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
 * 移形与其他连携技同一语义：只有放置在外圈地块上的实例才生效（不再判背包持有）。
 */
export function onVehicleMoved(gs, { distance = 1 } = {}) {
  if (!gs) return;
  if (!gs.team) gs.team = {};
  gs.team.dailyDistanceMoved = (gs.team.dailyDistanceMoved || 0) + Math.max(1, distance);
  for (const inst of getPlacedInstances(gs, 'skill_link_shift')) {
    tryEnqueue(gs, inst, { context: { distance } });
  }
}

export const LinkSkillSystem = {
  // 事件驱动入口
  onSkillFired,
  onElementDamage,
  periodicConditionScan,
  // 放置生命周期
  onSkillCardPlaced,
  onSkillCardRemoved,
  pruneUnplaced,
  getPlacedInstances,
  findInstance,
  makeInstanceKey,
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
