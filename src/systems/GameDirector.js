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
import { migrateGS } from '../state/migrate.js';
import { devLog } from '../core/Logger.js';
import { registerFacilities } from '../data/facilities.js';
import { MovementSystem } from './MovementSystem.js';
import { TurnSystem } from './TurnSystem.js';
import { SleepSystem } from './SleepSystem.js';
import { exitBuildMode, autoRemoveSkillsOutsideTeam } from './BuildSystem.js';
import { CreatureSystem } from './CreatureSystem.js';
import { SkillSystem } from './SkillSystem.js';
import { InventorySystem } from './InventorySystem.js';
import { TalentSystem } from './TalentSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { canMoveNow, markMoved, resetMoveCooldown } from './MoveCooldown.js';

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
    /** 面板实例登记表（key → 面板/helper）：用于校验栈内条目是否真的显示着 */
    this.panelRefs = {};
    /** 已注册的 EventBus listener 标记（防止 start() 重复注册） */
    this._listenersRegistered = false;
  }

  /**
   * 登记面板实例（供栈自愈校验用；main.js 装配时调用）
   * @param {string} key UI_PANEL_OPEN 使用的 panel key
   * @param {object} instance 面板实例（暴露 visible 或 helper.visible）
   */
  registerPanel(key, instance) {
    if (!key || !instance) return;
    this.panelRefs[key] = instance;
  }

  /** 读取面板实际可见性；未登记或无法判断时返回 null（不做判断） */
  _panelVisible(key) {
    const inst = this.panelRefs[key];
    if (!inst) return null;
    if (typeof inst.visible === 'boolean') return inst.visible;
    if (typeof inst.helper?.visible === 'boolean') return inst.helper.visible;
    return null;
  }

  /** 回收「栈里有、屏幕外没有」的幽灵条目（自愈，不抛错、不影响正常面板） */
  pruneOpenPanels(reason = '') {
    let removed = 0;
    for (const panel of [...this.openPanels]) {
      if (this._panelVisible(panel) === false) {
        this.openPanels = this.openPanels.filter((p) => p !== panel);
        removed += 1;
        devLog.warn('[GameDirector] 栈自愈：移除未显示的面板', panel, '原因=', reason || 'unknown');
      }
    }
    if (removed > 0) devLog.info('[GameDirector] openPanels 自愈后 →', this.openPanels);
    return removed;
  }

  /**
   * 校验刚入栈的面板是否真的打开了（面板 open 失败 / 提前 return 时不留下幽灵条目）
   * 延迟到当前事件分发结束后执行，等面板自身的 show() 完成。
   */
  _validatePanelEntry(key) {
    if (!this.openPanels.includes(key)) return;
    if (this._panelVisible(key) === false) {
      this.openPanels = this.openPanels.filter((p) => p !== key);
      devLog.warn('[GameDirector] 面板', key, '未实际显示 → 回收栈条目 →', this.openPanels);
    }
  }

  _registerOnce() {
    if (this._listenersRegistered) return;
    this._listenersRegistered = true;

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

    // B-2：载具移动同样推进回合（§6.3 一切移动消耗回合），并补【移动后】hook、
    //      移形距离累计（A-6）与强制睡觉检查 —— 与 GameDirector.move 的徒步路径对齐
    EventBus.on(GE.MOVE, (payload) => {
      if (!payload || !payload.byVehicle) return;
      const gs = this.gs;
      if (!gs) return;
      const distance = payload.distance || 1;
      LinkSkillSystem.onVehicleMoved(gs, { distance });
      HookDispatcher.fire('onMoveEnd', { gs, distance, fromIdx: payload.fromIdx, toIdx: payload.toIdx });
      TalentSystem.onMoveEnd(gs);
      const turnResult = TurnSystem.advanceTurn(gs, 1);
      if (turnResult.forcedSleep) {
        SleepSystem.sleep(gs, /* isAuto = */ true);
      }
    });

    // 编队修改 → 重新 fire passive（烹饪/蹁跹等常驻天赋按 roleId guard）
    EventBus.on(GE.TEAM_CHANGE, () => {
      // 裁定 3：角色离队 → 其已放置技能自动拆除回背包，再重算常驻天赋
      autoRemoveSkillsOutsideTeam(this.gs);
      TalentSystem.firePassive(this.gs);
    });

    // Panel 栈维护（§16.20 / §16.21 / §16.14 中央接线）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (!panel) return;
      // 'magicShop' 与 'shop' 是同一个商店面板（§16.22），栈内统一记作 'shop'
      const key = panel === 'magicShop' ? 'shop' : panel;

      // §16.14：打开其他任何界面 → 退出建造模式
      if (this.gs?.buildMode) exitBuildMode(this.gs);

      // §16.20：按其他界面快捷键 → 立即关闭当前界面，再打开新界面
      // §16.21 例外：商店已打开时，其他界面叠在商店之上（保留商店，关闭叠层回商店）
      const keepShop = key !== 'shop' && this.openPanels.includes('shop');
      for (const p of [...this.openPanels]) {
        if (p === key) continue;
        if (keepShop && p === 'shop') continue;
        EventBus.emit(GE.UI_PANEL_CLOSE, { panel: p });
      }

      if (!this.openPanels.includes(key)) {
        this.openPanels.push(key);
      }
      devLog.info('[GameDirector] openPanels +', key, '→', this.openPanels);
      // 只记录「确实已显示」的面板：当前事件分发结束后校验，open 失败的立刻回收
      if (this.panelRefs[key]) {
        setTimeout(() => this._validatePanelEntry(key), 0);
      }
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (!panel) return;
      const idx = this.openPanels.indexOf(panel);
      if (idx >= 0) this.openPanels.splice(idx, 1);
      devLog.info('[GameDirector] openPanels -', panel, '→', this.openPanels);
      // 关闭路径兜底：顺手回收其他「不可见却仍在栈里」的幽灵条目
      this.pruneOpenPanels('panelClose:' + panel);
    });
  }

  /**
   * 新游戏（主菜单入口）：先清理 Panel 栈再 start()
   */
  startNewGame() {
    this.openPanels = [];
    resetMoveCooldown(this.gs);
    // 先关闭所有已开的 Panel（逐个发 CLOSE 事件让 UI 清理）
    // 不发 STATE_RESET —— 某些订阅者（MapView 等）会解构 {gs}，但 start() 之前 gs 是 null
    // start() 末尾会发 BOOT 事件，所有 UI 模块都会收到并初始化
    this.start();
  }

  /**
   * 启动游戏：创建 GS + 注册设施 + 广播 BOOT
   */
  start() {
    devLog.info('=== GameDirector.start() ===');

    // 防重复注册 EventBus listener
    this._registerOnce();

    // 清理旧的 timer（防止 startNewGame 多次调用时 timer 累积）
    if (this._linkSkillTimer) {
      clearInterval(this._linkSkillTimer);
      this._linkSkillTimer = null;
    }

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

    // 5. Phase 4：Agent 3 —— 天赋 passive
    TalentSystem.firePassive(this.gs);

    // 每秒定时：pruneExpired（连携技超时）+ periodicConditionScan（炽燃/弱点击破条件检测）
    this._linkSkillTimer = setInterval(() => {
      LinkSkillSystem.pruneExpired(this.gs);
      LinkSkillSystem.periodicConditionScan(this.gs);
    }, 1000);

    // 6. 初始背包物品（让玩家有东西可选来建造）
    // A-13：skill_heart_force 为未知物品（物品库/设计文档均无此条目）—— 移除
    const INITIAL_ITEMS = [
      { id: 'facility_tent',       qty: 2 },
      { id: 'facility_rice',       qty: 2 },
      { id: 'facility_potato',     qty: 2 },
      { id: 'facility_tulip',      qty: 1 },
      { id: 'resource_shop',       qty: 1 },
      { id: 'resource_bus',        qty: 1 },
      { id: 'skill_yumo_slash',    qty: 1 },
    ];
    for (const it of INITIAL_ITEMS) {
      InventorySystem.addItem(this.gs, it.id, it.qty);
    }
    devLog.info('[GameDirector] 初始化背包物品 ✓');

    // 6. 广播 BOOT 事件（UI 模块会收到）
    EventBus.emit(GE.BOOT, { gs: this.gs });
    // 7. 同步 STATE_RESET（让缓存了 this.gs 的 UI 模块（TopBar 等）也能更新到新 GS 引用）
    EventBus.emit(GE.STATE_RESET, { gs: this.gs });

    // 8. 标记启动完成
    this.started = true;
    resetMoveCooldown(this.gs);
    // 9. 栈自愈：BOOT / STATE_RESET 后只保留真正显示着的面板
    this.pruneOpenPanels('start');
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
    migrateGS(loadedGs);  // ← 迁移：补全旧存档缺失的 Phase 4 字段
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
    resetMoveCooldown(this.gs);
    this.pruneOpenPanels('loadGame');
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
    // §5.2：两次移动之间至少间隔 0.5 秒。冷却期间直接忽略（不排队、不累积）。
    if (!canMoveNow(this.gs)) {
      devLog.info('[GameDirector] 移动冷却中，忽略本次移动:', direction);
      return null;
    }
    const result = MovementSystem.move(this.gs, direction);
    if (result === null) return null;

    // 只有真正走动了才记录时间戳（撞墙/边界不占用冷却）
    markMoved(this.gs);

    // 推进回合
    const turnResult = TurnSystem.advanceTurn(this.gs, 1);

    // 检查是否强制睡觉
    if (turnResult.forcedSleep) {
      SleepSystem.sleep(this.gs, /* isAuto = */ true);
    }

    return result;
  }

  /**
   * 睡觉换日（立即执行，不做二次确认）
   * 玩家入口请走 requestSleep()：按钮 / P 键共用 ConfirmAction 状态机。
   * @returns {boolean} 是否成功睡觉
   */
  sleep() {
    if (!this.gs) return false;
    SleepSystem.sleep(this.gs, /* isAuto = */ false);
    return true;
  }

  /**
   * 玩家主动睡觉入口（🛌 按钮 / P 键，二者同一条链路）
   * §16.10：行动力 > 0 → 先弹文字弹窗（说明行动力尚未耗尽，选项 取消 / 睡觉）；
   * 弹窗里点「睡觉」才进入二次确认（按钮变底色 + 「你确定这么做？」），再点一次同一 tick 换日。
   * 行动力已耗尽 → 无需弹窗，直接睡。
   * @returns {boolean} 本次是否已真正执行睡觉
   */
  requestSleep() {
    if (!this.gs) return false;
    if (this.gs.player.stamina <= 0) return this.sleep();
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '睡觉',
      content: '行动力尚未耗尽，是否确定睡觉？',
      options: [
        { label: '取消', safe: true, onSelect: () => {} },
        { label: '睡觉', onSelect: () => { SleepSystem.sleep(this.gs, /* isAuto = */ false); } },
      ],
    });
    return false;
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
    // §16.14：建造模式下 ESC 只退出建造模式（不得打开设置面板）
    if (this.gs?.buildMode) {
      exitBuildMode(this.gs);
      devLog.info('[GameDirector] ESC → 退出建造模式');
      return;
    }
    // SettingsPanel 打开时：直接关闭它，不经过 openPanels 栈
    // （SettingsPanel 通过 GE.UI_PANEL_OPEN/CLOSE 自己管理 visible，不在 openPanels 里）
    if (this.settingsPanel?.visible) {
      this.settingsPanel.hide();
      devLog.info('[GameDirector] ESC → 关闭设置面板');
      return;
    }
    // 栈顶优先关
    const stackTop = this.openPanels[this.openPanels.length - 1];
    if (stackTop) {
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
