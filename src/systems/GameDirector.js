// src/systems/GameDirector.js
// 主导演类：游戏核心逻辑的入口和调度中心
// 职责：
//   1. 持有全局 GS 对象（单一真相源）
//   2. 启动时注册所有设施 hook（registerFacilities）
//   3. 提供对外操作接口（move / sleep），被 InputManager 调用
//   4. 手动放置 Phase 1 所需的设施（因为 gameState 初始只有 home）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { createInitialState } from '../state/gameState.js';
import { devLog } from '../core/Logger.js';
import { registerFacilities } from '../data/facilities.js';
import { MovementSystem } from './MovementSystem.js';
import { TurnSystem } from './TurnSystem.js';
import { SleepSystem } from './SleepSystem.js';
import { CreatureSystem } from './CreatureSystem.js';
import { SkillSystem } from './SkillSystem.js';

/** 初始小麦田放置的格 idx（Phase 1 演示用） */
const INITIAL_WHEAT_TILE_IDX = 2; // 右上位置

export class GameDirector {
  constructor() {
    /** @type {object} 全局状态对象（单一真相源） */
    this.gs = null;
    /** 是否已启动 */
    this.started = false;
  }

  /**
   * 启动游戏：创建 GS + 注册设施 + 广播 BOOT
   */
  start() {
    devLog.info('=== GameDirector.start() ===');

    // 1. 创建初始 GS
    this.gs = createInitialState();

    // 2. 手动放置小麦田（Phase 1 演示用：gameState 初始只有 home）
    if (this.gs.map.outerTiles[INITIAL_WHEAT_TILE_IDX]) {
      this.gs.map.outerTiles[INITIAL_WHEAT_TILE_IDX].contentId = 'facility_wheat';
      devLog.info('[GameDirector] 放置初始麦田, idx =', INITIAL_WHEAT_TILE_IDX);
    }

    // 3. 注册所有设施 hook 到 HookDispatcher
    HookDispatcher.clearAll(); // 先清空 Phase 0 的 demo hook
    registerFacilities();

    // 4. Phase 3：启动生物实时 tick 循环
    CreatureSystem.startRealtimeLoop(() => this.gs);

    // 5. 广播 BOOT 事件（UI 模块会收到）
    EventBus.emit(GE.BOOT, { gs: this.gs });

    // 6. 标记启动完成
    this.started = true;
    devLog.info('GameDirector 启动完成 ✓ day=', this.gs.day, 'stamina=', this.gs.player.stamina);
  }

  /**
   * 重新从存档加载 GS（Storage.load 成功后调用）
   * @param {object} loadedGs 从 Storage.load 拿到的 GS
   */
  loadGame(loadedGs) {
    if (!loadedGs) {
      devLog.warn('[GameDirector.loadGame] loadedGs 为空');
      return false;
    }
    this.gs = loadedGs;
    EventBus.emit(GE.STATE_RESET, { gs: this.gs });
    EventBus.emit(GE.TILE_UPDATED);
    EventBus.emit(GE.STAT_CHANGE);
    devLog.info('[GameDirector.loadGame] 读档成功 day=', this.gs.day);
    return true;
  }

  // ── 对外操作接口（供 InputManager 调用） ──

  /**
   * 尝试移动玩家
   * @param {string} direction 'up' | 'right' | 'down' | 'left'
   * @returns {number|null} 成功返回目标格 idx，失败返回 null
   */
  move(direction) {
    const result = MovementSystem.move(this.gs, direction);
    if (result === null) return null;

    // 推进回合
    const turnResult = TurnSystem.advanceTurn(this.gs, 1);

    // 检查是否强制睡觉
    if (turnResult.forcedSleep) {
      SleepSystem.sleep(this.gs, /* isAuto = */ true);
    }

    return result;
  }

  /**
   * 睡觉换日（手动触发 / P 键 / 🛌 按钮）
   * @param {boolean} [skipConfirm=false] 是否跳过确认（强制睡觉时用）
   * @returns {boolean} 是否成功睡觉
   */
  sleep(skipConfirm = false) {
    if (!skipConfirm) {
      // Phase 1 简化：不做 confirm 弹窗，直接睡觉
      // （完整 confirm 逻辑 Phase 4 UI 层再实现）
      if (this.gs.player.stamina <= 0) {
        EventBus.emit(GE.TOAST_SHOW, { text: '行动力不足，直接睡觉吧～', duration: 1500 });
      }
    }
    SleepSystem.sleep(this.gs, /* isAuto = */ false);
    return true;
  }

  /**
   * 获取当前 GS（供 UI 层只读使用）
   * @returns {object}
   */
  getGS() {
    return this.gs;
  }
}

export default GameDirector;
