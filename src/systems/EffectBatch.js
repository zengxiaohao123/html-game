// src/systems/EffectBatch.js
// 技能结算的「批次去重」层 ——《空间碰撞与时序方案》§2.5 ② / §3.2 ⑦c / §3.5
//
// 一次结算 = 一份批次（一次主动技能触发 / 一次连携技 / 一次地块环境结算）；
// **批次对象不可复用**，结算结束即封存。
//
// 技能代码只负责「产出意图」，不自己判重：
//   const batch = new EffectBatch(gs, { sourceSkillId, instanceKey, phase });
//   batch.damage(target, multiplier, { element, hits, key });
//   batch.buff(target, buffId, { strength, duration });
//   const summary = batch.commit();   // 按登记顺序统一应用一次，返回摘要
//
// ── 去重口径（写死，各技能不得自行发挥） ──
// 1. 伤害：按「技能实例 + 目标实例 + 伤害键」去重，
//    去重键 = `${instanceKey}|${key}|${targetId}`（默认 key = `skill:${skillId}`）。
//    · 同一组重复登记 → 只应用一次，倍率取**最高**（同倍率时取段数更多的 hits），**不求和**；
//      这样「生物踩在两格之间」「同一技能因多格重复产出意图」都只挨一次。
//    · `hits` 的多段命中在这一次应用内部循环，不按格数放大。
//    · 不同技能实例 / 不同 key 命中同一目标 → 各组独立结算，不互相吞伤害。
// 2. buff/debuff：按「目标实例 + effectId（buffId）」去重（不含技能实例），
//    强度取**最高**、时长取**最长**（两个维度各自取 max，即文档 §2.5 的
//    「buff 取 max(strength) + max(duration)」口径）；每批次只应用一次。
//    与目标身上**已存在**的同名 buff 的合并仍交给 CombatSystem.applyBuff（同名取最高、不叠加）。
//
// ── 生命周期与边界 ──
// · commit() 之后批次封存：再登记 / 再 commit 一律**抛错**（防止复用半截批次造成重复伤害）。
// · 空批次 commit 安全：不调用任何结算函数，返回 empty=true 的摘要。
// · 目标在批次中途死亡（hp 归 0 或 dead=true）→ 同批次中该目标后续的分组全部跳过，摘要记 skippedDead。
// · 登记时目标已死亡 / 已在死亡队列 → 直接忽略，摘要记 ignoredDead。
//
// ── 本轮不接线 ──
// 接入点（下一阶段）：SkillSystem.fireOneSkill 与 LinkSkillSystem.resolveLinkSkill
// 把「逐目标 calculateDamage / applyBuff」换成 batch.damage(...) / batch.buff(...) + batch.commit()，
// 构造时传 `deathQueue`：commit 内部把 hp 归 0 的目标交给 PendingDeathQueue.markDead，
// 结算末尾统一 flush。本轮只交付可独立测试的模块，不改现有结算行为。

import { devLog } from '../core/Logger.js';
import { CombatSystem } from './CombatSystem.js';

let _nextBatchId = 1;

/** 目标实例 id：生物用 c.id；玩家等无 id 的单位需调用方显式给出 id */
function targetIdOf(target) {
  if (!target || typeof target !== 'object') return null;
  if (typeof target.id === 'string' && target.id) return target.id;
  return null;
}

/** 目标是否已死亡（hp 归 0 或已被死亡队列标记） */
export function isTargetDead(target) {
  if (!target) return true;
  if (target.dead === true) return true;
  return typeof target.hp === 'number' && target.hp <= 0;
}

export class EffectBatch {
  /**
   * @param {object} gs 全局状态
   * @param {object} [opts]
   * @param {string} [opts.sourceSkillId] 技能 id（默认伤害键 `skill:${id}`）
   * @param {string} [opts.instanceKey]   技能实例键（同一技能卡不同实例用不同键；缺省用 `skill:${skillId}`）
   * @param {string} [opts.phase]         结算阶段标记（日志/测试用，如 'onEnter' / 'onPass' / 'link'）
   * @param {number} [opts.atk]           攻击力（缺省 gs.player.atk）
   * @param {object} [opts.player]        攻击方玩家对象（传给 CombatSystem）
   * @param {string} [opts.roleId]        角色 id
   * @param {string} [opts.attackerRoleId] 攻击者角色 id（天赋判定用）
   * @param {object} [opts.deathQueue]    PendingDeathQueue 实例（可选，接入后自动入队）
   * @param {Function} [opts.resolveDamage] 伤害结算函数，默认 CombatSystem.calculateDamage
   * @param {Function} [opts.applyBuff]     buff 应用函数，默认 CombatSystem.applyBuff
   */
  constructor(gs, opts = {}) {
    this.gs = gs;
    this.batchId = `batch_${_nextBatchId++}`;
    this.sourceSkillId = opts.sourceSkillId ?? null;
    this.instanceKey = opts.instanceKey ?? (opts.sourceSkillId ? `skill:${opts.sourceSkillId}` : `batch:${this.batchId}`);
    this.phase = opts.phase ?? 'default';
    this.atk = typeof opts.atk === 'number' ? opts.atk : (gs?.player?.atk ?? 0);
    this.player = opts.player ?? (gs?.player ?? null);
    // 归属者由调用方显式解析（通用技能 = 当前队伍 1 号位）；绝不用技能 id 冒充角色 id
    this.roleId = opts.roleId ?? null;
    this.attackerRoleId = opts.attackerRoleId ?? opts.roleId ?? null;
    this._deathQueue = opts.deathQueue ?? null;
    this._resolveDamage = opts.resolveDamage ?? CombatSystem.calculateDamage;
    this._applyBuff = opts.applyBuff ?? CombatSystem.applyBuff;

    this._damageGroups = new Map(); // 去重键 → 意图
    this._buffGroups = new Map();   // 去重键 → 意图
    this._order = [];               // 按**首次登记顺序**保存的唯一意图（commit 按此顺序应用）
    this._sealed = false;
    this._ignoredDead = 0;
  }

  /** 已登记的意图数（去重后） */
  get size() { return this._order.length; }

  /** 批次是否已封存（commit 过） */
  get sealed() { return this._sealed; }

  /**
   * 登记一条伤害意图（同组重复登记只保留更强的一次）
   * @param {object} target 目标实例（必须有 id）
   * @param {number} multiplier 伤害倍率（1 = 100%）
   * @param {object} [options] { element, hits, realDamage, key, meta }
   * @returns {object|null} 登记后的意图；目标已死时返回 null
   */
  damage(target, multiplier, options = {}) {
    this._assertOpen('damage');
    const targetId = targetIdOf(target);
    if (!targetId) throw new Error('[EffectBatch.damage] 目标必须有 id（生物实例 id / 玩家 id）');
    const m = Number(multiplier);
    if (!Number.isFinite(m) || m <= 0) throw new Error(`[EffectBatch.damage] 非法倍率: ${multiplier}`);
    if (isTargetDead(target) || this._deathQueue?.has(targetId)) {
      this._ignoredDead += 1;
      devLog.info('[EffectBatch] 跳过已死目标', targetId);
      return null;
    }

    const key = options.key || (this.sourceSkillId ? `skill:${this.sourceSkillId}` : 'damage');
    const groupKey = `${this.instanceKey}|${key}|${targetId}`;
    const hits = Math.max(1, Math.floor(options.hits ?? 1));

    const existing = this._damageGroups.get(groupKey);
    if (existing) {
      existing.registrations += 1;
      // 取更高的一次：倍率高者胜；倍率相同时取段数更多者
      if (m > existing.multiplier || (m === existing.multiplier && hits > existing.hits)) {
        existing.multiplier = m;
        existing.hits = hits;
        existing.element = options.element ?? existing.element;
        existing.realDamage = !!options.realDamage;
        existing.meta = { ...existing.meta, ...(options.meta || {}) };
      }
      return existing;
    }

    const intent = {
      kind: 'damage',
      groupKey,
      target,
      targetId,
      key,
      multiplier: m,
      hits,
      element: options.element ?? null,
      realDamage: !!options.realDamage,
      meta: { ...(options.meta || {}) },
      registrations: 1,
    };
    this._damageGroups.set(groupKey, intent);
    this._order.push(intent);
    return intent;
  }

  /**
   * 登记一条 buff/debuff 意图（同「目标 + buffId」只保留最高强度与最长时长）
   * @param {object} target 目标实例（必须有 id）
   * @param {string} buffId 效果 id（data/buffs.js 中的 id）
   * @param {object} [options] { strength, duration, params }
   * @returns {object|null} 登记后的意图；目标已死时返回 null
   */
  buff(target, buffId, options = {}) {
    this._assertOpen('buff');
    if (!buffId) throw new Error('[EffectBatch.buff] 缺少 buffId');
    const targetId = targetIdOf(target);
    if (!targetId) throw new Error('[EffectBatch.buff] 目标必须有 id（生物实例 id / 玩家 id）');
    if (isTargetDead(target) || this._deathQueue?.has(targetId)) {
      this._ignoredDead += 1;
      devLog.info('[EffectBatch] 跳过已死目标的 buff', buffId, targetId);
      return null;
    }

    const strength = typeof options.strength === 'number' ? options.strength : undefined;
    const duration = typeof options.duration === 'number' ? options.duration : undefined;
    const groupKey = `buff|${targetId}|${buffId}`;

    const existing = this._buffGroups.get(groupKey);
    if (existing) {
      existing.registrations += 1;
      if (strength !== undefined && (existing.strength === undefined || strength > existing.strength)) {
        existing.strength = strength;
        existing.params.strength = strength;
      }
      if (duration !== undefined && (existing.duration === undefined || duration > existing.duration)) {
        existing.duration = duration;
      }
      Object.assign(existing.params, options.params || {});
      return existing;
    }

    const params = { ...(options.params || {}) };
    if (strength !== undefined) params.strength = strength;
    const intent = {
      kind: 'buff',
      groupKey,
      target,
      targetId,
      buffId,
      strength,
      duration,
      params,
      registrations: 1,
    };
    this._buffGroups.set(groupKey, intent);
    this._order.push(intent);
    return intent;
  }

  /**
   * 按登记顺序统一应用（每个去重后的意图只应用一次）
   * @returns {object} 应用摘要（供日志 / 测试断言）
   */
  commit() {
    if (this._sealed) throw new Error('[EffectBatch.commit] 批次已提交，一次结算一份批次，不可复用');
    this._sealed = true;

    const summary = {
      batchId: this.batchId,
      sourceSkillId: this.sourceSkillId,
      instanceKey: this.instanceKey,
      phase: this.phase,
      empty: this._order.length === 0,
      damages: [],
      buffs: [],
      ignoredDead: this._ignoredDead,
      skippedDead: 0,
    };

    if (summary.empty) {
      devLog.info('[EffectBatch] 空批次 commit（安全返回）', this.batchId, this.phase);
      return summary;
    }

    for (const intent of this._order) {
      if (intent.kind === 'damage') summary.damages.push(this._applyDamage(intent));
      else summary.buffs.push(this._applyBuffIntent(intent));
    }
    summary.skippedDead = summary.damages.filter(d => d.skipped === 'target-dead').length
      + summary.buffs.filter(b => b.skipped === 'target-dead').length;

    devLog.info('[EffectBatch] commit', this.batchId, this.phase,
      'damage组', summary.damages.length, 'buff组', summary.buffs.length,
      '跳过已死', summary.skippedDead);
    return summary;
  }

  _applyDamage(intent) {
    const t = intent.target;
    const out = {
      targetId: intent.targetId,
      key: intent.key,
      multiplier: intent.multiplier,
      hits: intent.hits,
      appliedHits: 0,
      damage: 0,
      element: intent.element,
      dodged: false,
      immune: false,
      isCrit: false,
      skipped: null,
    };

    if (isTargetDead(t) || this._deathQueue?.has(intent.targetId)) {
      out.skipped = 'target-dead';
      devLog.info('[EffectBatch] 目标已死，跳过结算', intent.targetId, intent.key);
      return out;
    }

    // 合成一个最小 skill 对象：CombatSystem.calculateDamage 只读 damageMultiplier / element
    const skill = {
      id: this.sourceSkillId,
      damageMultiplier: intent.multiplier,
      element: intent.element,
      realDamage: intent.realDamage,
    };

    for (let h = 0; h < intent.hits; h++) {
      const res = this._resolveDamage({
        atk: this.atk,
        skill,
        defender: t,
        element: intent.element,
        realDamage: intent.realDamage,
        player: this.player,
        gs: this.gs,
        roleId: this.roleId,
        attackerRoleId: this.attackerRoleId,
      });
      out.appliedHits += 1;
      out.damage += (res?.finalDamage ?? 0);
      out.dodged = out.dodged || !!res?.dodged;
      out.immune = out.immune || !!res?.immune;
      out.isCrit = out.isCrit || !!res?.isCrit;
      if (res?.immune || isTargetDead(t)) break;
    }

    // 战斗内只入队，不立即移除（死亡批量处理见 PendingDeathQueue）
    if (isTargetDead(t)) this._deathQueue?.markDead(t);
    return out;
  }

  _applyBuffIntent(intent) {
    const t = intent.target;
    const out = {
      targetId: intent.targetId,
      buffId: intent.buffId,
      strength: intent.strength ?? null,
      duration: intent.duration ?? null,
      applied: false,
      refreshed: false,
      skipped: null,
    };

    if (isTargetDead(t) || this._deathQueue?.has(intent.targetId)) {
      out.skipped = 'target-dead';
      return out;
    }

    const had = Array.isArray(t.activeBuffs) && t.activeBuffs.some(b => b.id === intent.buffId);
    const instance = this._applyBuff({
      buffId: intent.buffId,
      target: t,
      duration: intent.duration,
      params: { ...intent.params },
      creatureId: t.id,
    });
    out.applied = !!instance;
    out.refreshed = had;
    return out;
  }

  _assertOpen(action) {
    if (this._sealed) {
      throw new Error(`[EffectBatch.${action}] 批次已提交，一次结算一份批次，不可复用`);
    }
  }
}

export default EffectBatch;
