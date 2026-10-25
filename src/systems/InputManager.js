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

      // ── 建造模式 gating（优先级1） ──
      if (gs?.buildMode === true) {
        // 建造模式禁用 WASD（移动）和空格（祈福）
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === ' ' || key === 'space') {
          e.preventDefault();
          return; // 吞掉不响应
        }
      }

      // Tab / 空格 必须 preventDefault（否则浏览器会跳焦点或滚动）
      if (key === 'tab' || key === ' ') {
        e.preventDefault();
      }

      // ── 1-0 数字键 → HotBar 选中（优先级2） ──
      if (gs) {
        const num = parseInt(key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          e.preventDefault();
          // 数字 1-9 对应 HotBar slot 0-8
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
        e.preventDefault();
        this.director.move(KEY_TO_DIRECTION[key]);
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
    switch (action) {
      case 'sleep':
        this.director.sleep();
        break;

      case 'bless':
        // 祈福走两步式：blessStart 扣消耗 + 选目标 → BlessAnimation 播完 → blessCommit
        if (!gs) break;
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

      case 'settings': {
        // 正确的多关顺序：先关已开的二级面板，全部关完再打开设置
        const curActive = gs?.uiState?.activePanel || null;
        if (curActive) {
          EventBus.emit(GE.UI_PANEL_CLOSE, { panel: curActive });
        } else {
          EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
        }
        break;
      }

      default:
        devLog.warn('[InputManager] 未知动作:', action);
    }
  }
}

export default InputManager;
