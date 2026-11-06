// src/systems/InputManager.js
// Phase 4 —— 按设计文档 §15.x 正确绑定
//
// 键位（全部来自设计文档原文）：
//   WASD  → 移动
//   P     → 睡觉
//   B     → 背包 InventoryPanel（Phase 2B）
//   Tab   → 建造模式 / 探索模式 切换（e.preventDefault()）
//   ESC   → 关二级面板 → 开设置（Phase 2B 多关顺序）
//   空格  → 祈福（BlessSystem.blessStart → BlessAnimation 播抽奖）
//
// Phase 4 新增（§15.x）：
//   C     → 角色页面 RolePanel
//   L     → 编队页面 TeamPanel
//   F     → 合成页面 ForgePanel
//   T     → 载具页面 VehiclePanel
//   J     → 任务面板 TaskPanel
//
// ⚠️ 设计文档没有写祈福的快捷键，保留空格键（Phase 2B 约定）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { BlessSystem } from './BlessSystem.js';
import { BuildSystem } from './BuildSystem.js';
import {
  isBlessBlocked, isHotbarBlocked, isMovementBlocked, isSleepBlocked,
} from './InputGate.js';
import { devLog } from '../core/Logger.js';

const KEY_TO_DIRECTION = {
  'w': 'up',
  'a': 'left',
  's': 'down',
  'd': 'right',
};

// 设计文档 §15.x 原文：
//   §15.11 角色 C  §15.12 编队 L  §15.13 合成 F  §15.16 载具 T  §15.17 任务 J
const KEY_TO_ACTION = {
  'p': 'sleep',
  'b': 'inventory',
  'tab': 'buildMode',
  'escape': 'settings',
  ' ': 'bless',
  'space': 'bless',
  // Phase 4 —— 设计文档 §15.x
  'c': 'role',
  'l': 'team',
  'f': 'forge',
  't': 'vehicle',
  'j': 'task',
  'k': 'codex',
};

export class InputManager {
  constructor(director) {
    this.director = director;
    this._handler = null;
    this._bound = false;
  }

  bind() {
    if (this._bound) return;

    this._handler = (e) => {
      const key = (e.key || '').toLowerCase();
      const gs = this.director?.getGS?.();
      const director = this.director;

      // ── 主菜单（全屏模态遮罩）：任何游戏快捷键都不得穿透（含 ESC） ──
      if (director?.mainMenu?.visible) {
        if (key === 'tab' || key === ' '
          || KEY_TO_DIRECTION[key] || KEY_TO_ACTION[key]) {
          e.preventDefault();
        }
        return;
      }

      // ── 输入门控：显式阻塞原因（§16.4 / §16.5 / §16.6 / §16.14 / §16.20） ──
      // 只有真正独占输入的模态才阻塞；信息区（info）是常驻侧栏，不阻塞探索操作。
      const movementBlocked = isMovementBlocked(director);
      const hotbarBlocked = isHotbarBlocked(director);
      const dialogOpen = !!director?.dialogBox?.visible;

      // Tab / 空格 必须 preventDefault
      if (key === 'tab' || key === ' ') {
        e.preventDefault();
      }

      // ── 1-0 数字键 → HotBar 选中 ──
      // 弹窗打开时数字键归选项模式（§16.4 数字键 1~6 选择选项），此处不抢
      // 建造模式 / 信息区打开时仍可选中（§16.14 / §16.4）
      if (gs && !hotbarBlocked) {
        const num = parseInt(key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          e.preventDefault();
          EventBus.emit(GE.HOTBAR_SELECT_SLOT, { slotIdx: num - 1 });
          return;
        }
        if (key === '0') {
          e.preventDefault();
          EventBus.emit(GE.HOTBAR_SELECT_SLOT, { slotIdx: 9 });
          return;
        }
      }

      if (KEY_TO_DIRECTION[key]) {
        // §16.20：模态界面 / 剧情事件 / 建造模式下 WASD 移动无效
        e.preventDefault();
        if (movementBlocked) return;
        this.director.move(KEY_TO_DIRECTION[key]);
        return;
      }

      // ── 弹窗打开时 ESC 归弹窗 ──
      // DialogBox 自己监听 ESC 关闭；若其监听先于本处执行，弹窗已关、visible 已为 false，
      // 因此同时认 DialogBox 在事件上打的消费标记，保证与监听注册顺序无关。
      // 否则会出现「ESC 关弹窗的同时又打开设置」的状态错乱。
      if (KEY_TO_ACTION[key] === 'settings'
        && (dialogOpen || e._dialogConsumedEsc)) {
        return;
      }

      if (KEY_TO_ACTION[key]) {
        e.preventDefault();
        this._dispatchAction(KEY_TO_ACTION[key]);
        return;
      }
    };

    window.addEventListener('keydown', this._handler);
    this._bound = true;
    devLog.info('[InputManager] 键盘监听已绑定 (WASD / P / B / Tab / ESC / C / L / F / T / J / 空格)');
  }

  unbind() {
    if (!this._bound || !this._handler) return;
    window.removeEventListener('keydown', this._handler);
    this._bound = false;
    this._handler = null;
  }

  _dispatchAction(action) {
    const gs = this.director?.getGS?.();
    // §16.20 / §16.10 / §16.6：模态界面、剧情/事件、建造模式下主界面快捷键无效；
    // 信息区（info）不算阻塞；祈福动画期间可睡觉，但不可再次祈福（BlessSystem 自身亦互斥）。
    switch (action) {
      case 'sleep': {
        // §16.10：P 键只在主界面有效，其他界面按 P 无反应（弹窗打开时不得顶替弹窗）
        if (isSleepBlocked(this.director)) break;
        this.director.sleep();
        break;
      }

      case 'bless':
        // 祈福走两步式：blessStart 扣消耗 + 选目标 → BlessAnimation 播完 → blessCommit
        if (!gs || isBlessBlocked(this.director)) break;
        BlessSystem.blessStart(gs);
        break;

      case 'inventory':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
        break;

      case 'buildMode':
        if (!gs) return;
        if (gs.buildMode) BuildSystem.exitBuildMode(gs);
        else BuildSystem.enterBuildMode(gs);
        break;

      // ══ Phase 4 —— 设计文档 §15.x ══
      case 'role':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'role' });
        break;
      case 'team':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'team' });
        break;
      case 'forge':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'forge' });
        break;
      case 'vehicle':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'vehicle' });
        break;
      case 'task':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
        EventBus.emit(GE.TASK_OPEN, {});
        break;

      case 'codex':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'codex' });
        break;

      case 'settings': {
        // §16.9：ESC 走 GameDirector 的层级栈逻辑（弹窗门禁在 _handler 里统一处理）
        this.director?.handleESC?.();
        break;
      }

      default:
        devLog.warn('[InputManager] 未知动作:', action);
    }
  }
}

export default InputManager;
