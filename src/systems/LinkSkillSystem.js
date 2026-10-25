// src/systems/LinkSkillSystem.js
// Phase 3 —— 连携技最小骨架（Phase 4 补 UI）
// 职责：
//   checkReady(gs)   —— 条件达成 → enqueue(skillId)
//   enqueue(skillId) —— 加 skillId + expireAtMs（3 秒后）
//   pop(skillId)     —— 触发后移除
//   cooldown 按回合计数（gs.lastTurnLinkSkill）
//
// Phase 4 做 UI 时只需订阅 gs.linkSkillQueue 变化（每次 enqueue/pop 时 emit LINK_SKILL_READY / LINK_SKILL_EXPIRE）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';

const WINDOW_MS = 3000; // 3 秒窗口

/**
 * 把 skill 放入实时队列
 * @param {object} gs
 * @param {object} opts
 * @param {string} opts.skillId
 * @param {string} [opts.roleId]
 * @param {number} [opts.cooldownTurns]
 */
export function enqueueLinkSkill(gs, opts) {
  const { skillId, roleId, cooldownTurns = 0 } = opts;
  if (!skillId) return null;
  const entry = {
    skillId,
    roleId: roleId || null,
    expireAtMs: Date.now() + WINDOW_MS,
    cooldownTurns,
  };
  gs.linkSkillQueue.push(entry);
  gs.lastTurnLinkSkill = gs.turn;
  EventBus.emit(GE.LINK_SKILL_READY, { skillId, entry });
  devLog.info('[LinkSkillSystem] enqueue', skillId);
  return entry;
}

/**
 * 触发并从队列弹出
 */
export function popLinkSkill(gs, skillId) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return null;
  const idx = gs.linkSkillQueue.findIndex(e => e.skillId === skillId);
  if (idx >= 0) {
    const e = gs.linkSkillQueue.splice(idx, 1)[0];
    EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId, triggered: true });
    return e;
  }
  return null;
}

/**
 * 清理超时的（可以每秒调用一次；也可以 Phase 4 UI 主动轮询）
 */
export function pruneExpired(gs) {
  if (!gs || !Array.isArray(gs.linkSkillQueue)) return 0;
  const now = Date.now();
  const before = gs.linkSkillQueue.length;
  gs.linkSkillQueue = gs.linkSkillQueue.filter(e => {
    if (e.expireAtMs < now) {
      EventBus.emit(GE.LINK_SKILL_EXPIRE, { skillId: e.skillId, triggered: false });
      devLog.info('[LinkSkillSystem] expired', e.skillId);
      return false;
    }
    return true;
  });
  return before - gs.linkSkillQueue.length;
}

/**
 * 条件达成 → 入队（Phase 3 简化：骨架实现，后续补条件检测）
 */
export function checkReady(gs, conditionKey) {
  // 目前只做 stub —— Phase 4 根据角色/技能条件注册
  return false;
}

/**
 * 新一天重置：清空队列 + 清零 lastTurnLinkSkill
 */
export function resetAll(gs) {
  if (gs && Array.isArray(gs.linkSkillQueue)) {
    gs.linkSkillQueue.length = 0;
    gs.lastTurnLinkSkill = 0;
  }
}

export const LinkSkillSystem = {
  enqueue: enqueueLinkSkill,
  pop: popLinkSkill,
  pruneExpired,
  checkReady,
  resetAll,
};
