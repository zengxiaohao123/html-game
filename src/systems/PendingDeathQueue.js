// src/systems/PendingDeathQueue.js
// 技能结算的「延迟死亡」层 ——《空间碰撞与时序方案》§2.5 ④ / §3.2 ⑬ / §3.5 第 8 步
//
// 结算过程中目标生命归 0 时**只入队、不立即从数组删除**：
//   · 本批次内其余目标仍按快照位置正常结算（不会因先死的被移出集合而少打一只）；
//   · 同批次内已被标记的目标后续不再被结算（EffectBatch 通过 `has()` / `dead` 判定跳过）。
// 批次（回合）结束后统一 flush：
//   按实例 id 升序 → 去重 → 发 CREATURE_DEFEATED → 从栅栏格缓存与 gs.creatures 移除
//   → 结算击杀掉落 → fire 'onCreatureDefeated' 词条 hook → 天赋回调。
//
// 不变量：
//   1. 同一实例多次入队只死一次（Map 去重 + flush 前再次校验实例仍在 gs.creatures）；
//   2. 击杀掉落只结算一次（已移除的实例在后续 flush 中只计 skipped，不再掉落、不再发事件）；
//   3. 空队列 flush 安全，返回 empty=true 的摘要。
//
// 接入点（本轮不接线）：SkillSystem.defeatCreature / LinkSkillSystem 的即时删除改为
//   markDead(...)（结算内）+ flushDeaths()（回合末，§3.2 ⑬）。构造函数可注入 deps 便于测试。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { CreatureSystem } from './CreatureSystem.js';
import { TalentSystem } from './TalentSystem.js';

/** 实例 id 的数值后缀（'creature_12' → 12）；无数字后缀回落到 0，交给字符串比较 */
function idOrder(id) {
  const m = String(id).match(/(\d+)(?!.*\d)/);
  return m ? Number(m[1]) : 0;
}

export class PendingDeathQueue {
  /**
   * @param {object} gs 全局状态
   * @param {object} [deps] 可注入的依赖（默认走真实系统，测试时可替换）
   * @param {Function} [deps.grantKillDrops] 击杀掉落
   * @param {Function} [deps.fireDefeatedHook] 词条 hook
   * @param {Function} [deps.onTalentDefeated] 天赋回调
   * @param {object}   [deps.bus] 事件总线（默认全局 EventBus）
   */
  constructor(gs, deps = {}) {
    this.gs = gs;
    this._queue = new Map(); // id → creature（保持入队顺序，flush 时再按 id 升序）
    this._deps = {
      grantKillDrops: deps.grantKillDrops ?? ((state, c) => CreatureSystem.grantKillDrops(state, c)),
      fireDefeatedHook: deps.fireDefeatedHook ?? ((payload) => HookDispatcher.fire('onCreatureDefeated', payload)),
      onTalentDefeated: deps.onTalentDefeated ?? ((state, c) => TalentSystem.onCreatureDefeated(state, c)),
      bus: deps.bus ?? EventBus,
    };
  }

  /** 待处理数量 */
  get size() { return this._queue.size; }

  /** 待处理实例 id 列表（入队顺序） */
  get ids() { return [...this._queue.keys()]; }

  /** 该实例是否已在死亡队列中 */
  has(targetOrId) {
    const id = typeof targetOrId === 'string' ? targetOrId : targetOrId?.id;
    return !!(id && this._queue.has(id));
  }

  /** 是否仍然存活且未被标记死亡（供结算层"已死实例不再结算"判定） */
  isAlive(target) {
    if (!target) return false;
    if (target.dead === true) return false;
    if (this.has(target)) return false;
    return typeof target.hp === 'number' ? target.hp > 0 : true;
  }

  /**
   * 登记死亡：结算中只标记 + 入队，**不删除实例**
   * @param {object} target 生物实例
   * @param {object} [opts]
   * @param {boolean} [opts.force] 不看血量强制入队（如被移除类效果）
   * @returns {boolean} 本次是否为**新入队**（重复入队返回 false）
   */
  markDead(target, opts = {}) {
    if (!target || typeof target !== 'object' || !target.id) return false;
    if (!opts.force && !(typeof target.hp === 'number' && target.hp <= 0)) return false;
    // 已从 gs.creatures 移除（本批次已 flush / 已被其他路径击杀）→ 不再入队，避免重复掉落与重复事件
    if (Array.isArray(this.gs?.creatures) && !this.gs.creatures.some(c => c.id === target.id)) return false;

    if (typeof target.hp === 'number' && target.hp < 0) target.hp = 0;
    target.dead = true;

    if (this._queue.has(target.id)) return false;
    this._queue.set(target.id, target);
    devLog.info('[PendingDeathQueue] markDead →', target.id, target.kind || '');
    return true;
  }

  /**
   * 批次末统一处理死亡
   * @returns {object} { defeated: [{id,kind}], skipped: [{id,reason}], empty }
   */
  flush() {
    if (this._queue.size === 0) {
      return { defeated: [], skipped: [], empty: true };
    }

    const entries = [...this._queue.values()]
      .sort((a, b) => (idOrder(a.id) - idOrder(b.id)) || String(a.id).localeCompare(String(b.id)));
    this._queue.clear();

    const defeated = [];
    const skipped = [];
    const gs = this.gs;

    for (const c of entries) {
      if (!c || !c.id) continue;

      // 去重：已被其他路径移除（或重复 flush）→ 不再发事件、不再掉落
      const stillPresent = Array.isArray(gs?.creatures) && gs.creatures.some(x => x.id === c.id);
      if (!stillPresent) {
        skipped.push({ id: c.id, reason: 'already-removed' });
        continue;
      }

      devLog.info('[PendingDeathQueue] flush defeat', c.id, c.kind || '');
      this._deps.bus.emit(GE.CREATURE_DEFEATED, { creature: c });
      this._deps.bus.emit(GE.TOAST_SHOW, { text: `✓ 击败 ${c.name || c.kind}`, duration: 1500 });

      // 移除：栅栏格缓存 + 生物数组（几何归属以 pos+radius 计算，缓存只是主格兼容字段）
      for (const t of (gs.map?.fence || [])) {
        if (Array.isArray(t.creatures)) t.creatures = t.creatures.filter(cid => cid !== c.id);
      }
      gs.creatures = gs.creatures.filter(x => x.id !== c.id);

      this._deps.grantKillDrops(gs, c);
      this._deps.fireDefeatedHook({ gs, creature: c });
      this._deps.onTalentDefeated(gs, c);

      defeated.push({ id: c.id, kind: c.kind || null });
    }

    devLog.info('[PendingDeathQueue] flush 完成 → 死亡', defeated.length, '跳过', skipped.length);
    return { defeated, skipped, empty: false };
  }

  /** 丢弃队列（读档 / 重开时用，不触发任何死亡结算） */
  clear() {
    this._queue.clear();
  }
}

export default PendingDeathQueue;
