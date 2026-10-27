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
import { InventorySystem } from './InventorySystem.js';
import { TalentSystem } from './TalentSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';

/** 初始小麦田放置的格 idx（Phase 1 演示用） */
const INITIAL_WHEAT_TILE_IDX = 2; // 右上位置

export class GameDirector {
  constructor() {
    /** @type {object} 全局状态对象（单一真相源） */
    this.gs = null;
    /** 是否已启动 */
    this.started = false;
    /** Panel 栈 —— 后开的在上，ESC 先关栈顶 */
    this.openPanels = [];
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

    // 5. Phase 4：Agent 3 —— 天赋 passive + EventBus 订阅连携技解耦事件
    TalentSystem.firePassive(this.gs);

    // 解耦订阅：CombatSystem.emit ELEMENT_DAMAGE_APPLIED → LinkSkillSystem.onElementDamage
    EventBus.on(GE.ELEMENT_DAMAGE_APPLIED, (payload) => {
      if (payload && payload.gs) {
        LinkSkillSystem.onElementDamage(payload.gs, {
          element: payload.element,
          byRoleId: payload.byRoleId,
          target: payload.target,
        });
      }
    });

    // 编队修改 → 重新 fire passive（烹饪/蹁跹等常驻天赋按 roleId guard）
    EventBus.on(GE.TEAM_CHANGE, () => {
      TalentSystem.firePassive(this.gs);
    });

    // v0.4-1: Panel 栈维护
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (!panel) return;
      // 避免重复入栈（同一个 panel 打开时 toggle 可能触发）
      if (!this.openPanels.includes(panel)) {
        this.openPanels.push(panel);
      }
      devLog.info('[GameDirector] openPanels +', panel, '→', this.openPanels);
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (!panel) return;
      const idx = this.openPanels.indexOf(panel);
      if (idx >= 0) this.openPanels.splice(idx, 1);
      devLog.info('[GameDirector] openPanels -', panel, '→', this.openPanels);
    });

    // 每秒定时：pruneExpired（连携技超时）+ periodicConditionScan（炽燃/弱点击破条件检测）
    this._linkSkillTimer = setInterval(() => {
      LinkSkillSystem.pruneExpired(this.gs);
      LinkSkillSystem.periodicConditionScan(this.gs);
    }, 1000);

    // 6. 初始背包物品（让玩家有东西可选来建造）
    const INITIAL_ITEMS = [
      { id: 'facility_tent',       qty: 2 },
      { id: 'facility_rice',       qty: 2 },
      { id: 'facility_potato',     qty: 2 },
      { id: 'facility_tulip',      qty: 1 },
      { id: 'resource_shop',       qty: 1 },
      { id: 'resource_bus',        qty: 1 },
      { id: 'skill_yumo_slash',    qty: 1 },
      { id: 'skill_heart_force',   qty: 1 },
    ];
    for (const it of INITIAL_ITEMS) {
      InventorySystem.addItem(this.gs, it.id, it.qty);
    }
    devLog.info('[GameDirector] 初始化背包物品 ✓');

    // 6. 广播 BOOT 事件（UI 模块会收到）
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

    // 清理旧的定时器（防止 loadGame 多次调用时 timer 累积）
    if (this._linkSkillTimer) {
      clearInterval(this._linkSkillTimer);
      this._linkSkillTimer = null;
    }
    // 重新启动 linkSkill 定时（loadGame 后 GameDirector 没调 start()，所以这里补）
    this._linkSkillTimer = setInterval(() => {
      LinkSkillSystem.pruneExpired(this.gs);
      LinkSkillSystem.periodicConditionScan(this.gs);
    }, 1000);

    // 读档后重新 fire passive（确保烹饪/蹁跹 maxHp/dodgeRate 正确）
    TalentSystem.firePassive(this.gs);

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

  /**
   * ESC 层级栈关闭：关栈顶的 Panel，栈空则打开设置
   * 二级子面板（如 TeamPanel 的快捷编队）由各 Panel 内部自行关闭
   */
  handleESC() {
    // 栈顶优先关
    const stackTop = this.openPanels[this.openPanels.length - 1];
    if (stackTop) {
      // emit UI_PANEL_CLOSE，对应的 Panel._subscribe 会收到并 helper.hide()
      EventBus.emit(GE.UI_PANEL_CLOSE, { panel: stackTop });
      devLog.info('[GameDirector] ESC 关闭栈顶:', stackTop);
      return;
    }
    // 栈空 → 打开设置
    EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
    devLog.info('[GameDirector] ESC 栈空 → 打开设置');
  }
}

export default GameDirector;
