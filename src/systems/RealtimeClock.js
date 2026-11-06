// src/systems/RealtimeClock.js
// 统一实时时钟 —— 《设计文档 v0.5》§18.3 / §18.5
//
// 结构（单一定时器，不叠加第二个逻辑定时器）：
//   - 固定逻辑步长 200ms（LOGIC_STEP_MS）：连携窗口过期 → 条件扫描 → 生物连续积分
//     → 移动后的地块效果（啃草）→ 一次性广播（仅在地块真的变化时）。
//   - 真实 dt 只在两个地方消费：
//       ① 逻辑累加器：把真实帧时长按 200ms 切片，保证逻辑积分速率与帧率无关；
//       ② 渲染插值：独立推进 renderPos（不受结算冻结影响）。
//   - 一个 40ms 定时器驱动；页面不可见 / 主菜单暂停时由调用方 stop()。
//
// 结算冻结（§18.3 / §18.5）：
//   - runSettlement(gs, fn) 只用于毫秒级同步结算栈；进入时取 snapshotGeometry(gs)
//     不可变快照，期间 advance() 不推进逻辑积分（pos 冻结），但 renderPos 继续推进。
//   - 绝不允许把 settling 延长到动画 / 飞字 / 淡出 / 面板打开期间；
//     演出只消费各自的快照，不持有 settle 锁。

import { snapshotGeometry } from '../core/Geometry.js';
import { devLog } from '../core/Logger.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { CreatureSystem } from './CreatureSystem.js';

/** 逻辑步长（设计文档 §18.3 固定 200ms） */
export const LOGIC_STEP_MS = 200;

/** 真实帧 dt 上限（切后台回来时避免一次补几十秒） */
export const MAX_FRAME_DT_MS = 100;

const DRIVER_INTERVAL_MS = 40;

export class RealtimeClock {
  /**
   * @param {() => object|null} getGs 每次需要时读取当前 GS（读档/重开后仍指向最新对象）
   */
  constructor(getGs) {
    this._getGs = typeof getGs === 'function' ? getGs : defaultGetGs;
    this._timerId = null;
    this._lastFrameMs = 0;
    this._accumulatorMs = 0;
    this._settlingDepth = 0;
    this._stepListeners = new Set();
  }

  get running() {
    return this._timerId != null;
  }

  /** 是否处于同步结算栈内（只允许毫秒级） */
  get settling() {
    return this._settlingDepth > 0;
  }

  /** 累计未消费的真实时间（测试用） */
  get pendingMs() {
    return this._accumulatorMs;
  }

  start() {
    if (this._timerId != null) return;
    this._lastFrameMs = nowMs();
    this._timerId = setInterval(() => this._frame(nowMs()), DRIVER_INTERVAL_MS);
    devLog.info('[RealtimeClock] started（逻辑步 200ms / 驱动 40ms）');
  }

  stop() {
    if (this._timerId == null) return;
    clearInterval(this._timerId);
    this._timerId = null;
    this._lastFrameMs = 0;
    this._accumulatorMs = 0;
    devLog.info('[RealtimeClock] stopped');
  }

  _frame(frameNowMs) {
    const dt = Math.max(0, Math.min(MAX_FRAME_DT_MS, frameNowMs - this._lastFrameMs));
    this._lastFrameMs = frameNowMs;
    this.advance(dt);
  }

  /**
   * 推进真实时间（浏览器由 _frame 调用；Node 测试可直接调用）
   * 结算栈内：只推进渲染位置，不推进逻辑积分。
   * @param {number} realDtMs
   */
  advance(realDtMs) {
    const dt = Math.max(0, Number(realDtMs) || 0);
    const gs = this._getGs();

    if (this._settlingDepth === 0) {
      this._accumulatorMs += dt;
      while (this._accumulatorMs >= LOGIC_STEP_MS) {
        this._accumulatorMs -= LOGIC_STEP_MS;
        this._logicStep(gs);
      }
    }

    // 渲染插值：任何情况下都继续（结算只冻结判定用的 pos）
    if (gs) CreatureSystem.advanceCreatureRendering(gs, dt / 1000);

    if (this._settlingDepth === 0 && dt > 0) {
      for (const fn of this._stepListeners) {
        try { fn(dt, gs); } catch (e) { devLog.warn('[RealtimeClock] step listener error', e); }
      }
    }
  }

  /** 固定 200ms 逻辑步：顺序按设计文档 §18.3 */
  _logicStep(gs) {
    if (!gs) return;
    // ① 连携窗口过期（8 秒窗口语义在 LinkSkillSystem 内用 Date.now 判定，不变）
    LinkSkillSystem.pruneExpired(gs);
    // ② 条件扫描入队（原 GameDirector 1000ms 轮询合并到这里）
    LinkSkillSystem.periodicConditionScan(gs);
    // ③④ 生物连续积分 + 移动后地块效果（啃草）；⑤ 只在真的变化时广播
    CreatureSystem.stepCreatures(gs, LOGIC_STEP_MS / 1000);
  }

  /**
   * 毫秒级同步结算：取不可变几何快照，期间冻结逻辑积分。
   * 只能同步调用；不要在里面 await / setTimeout / 开动画。
   * @param {object} gs
   * @param {(snapshot:object, gs:object) => any} fn
   * @returns {any} fn 的返回值
   */
  runSettlement(gs, fn) {
    const target = gs || this._getGs();
    const snapshot = snapshotGeometry(target);
    this._settlingDepth += 1;
    try {
      return fn(snapshot, target);
    } finally {
      this._settlingDepth -= 1;
    }
  }

  /**
   * 订阅逻辑步（每 200ms 一次，结算栈内不触发）。
   * 连携窗口 UI 进度条用它，替代原来的 200ms 独立定时器。
   * @param {(dtMs:number, gs:object)=>void} fn
   * @returns {() => void} 取消订阅
   */
  onStep(fn) {
    if (typeof fn !== 'function') return () => {};
    this._stepListeners.add(fn);
    return () => this._stepListeners.delete(fn);
  }
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function defaultGetGs() {
  if (typeof window !== 'undefined' && window.__gameDirector?.getGS) return window.__gameDirector.getGS();
  return null;
}

let _singleton = null;

/**
 * 进程内单例（一局游戏只有一个实时时钟）。
 * @param {() => object|null} [getGs] 首次创建时可用
 */
export function getRealtimeClock(getGs) {
  if (!_singleton) _singleton = new RealtimeClock(getGs);
  return _singleton;
}

/** 测试 / 重开用：停止并丢弃单例 */
export function resetRealtimeClock() {
  if (_singleton) _singleton.stop();
  _singleton = null;
}

export default RealtimeClock;
