// src/systems/InputManager.js
// Phase 2B 扩展：加 B（背包）/ Tab（建造模式切换）/ 多 ESC 二级面板关闭
//
// 当前键位：
//   WASD  → 移动
//   P     → 睡觉
//   ESC   → 关背包 → 关设置 → 回到探索（多按顺序关）
//   B     → 背包 InventoryPanel 切换
//   Tab   → 建造模式 / 探索模式 切换（e.preventDefault() 防浏览器焦点跳转）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { BuildSystem } from './BuildSystem.js';
import { devLog } from '../core/Logger.js';

const KEY_TO_DIRECTION = {
  'w': 'up',
  'a': 'left',
  's': 'down',
  'd': 'right',
};

const KEY_TO_ACTION = {
  'p': 'sleep',
  'b': 'inventory',
  'tab': 'buildMode',
  'escape': 'settings',
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

      // Tab 必须 preventDefault（否则浏览器会跳转焦点）
      if (key === 'tab') {
        e.preventDefault();
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
    devLog.info('[InputManager] 键盘监听已绑定 (WASD / P / B / Tab / ESC)');
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

      case 'inventory':
        // 让 InventoryPanel 自己订阅 GE.UI_PANEL_OPEN('inventory')
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
        devLog.info('[InputManager] inventory toggle');
        break;

      case 'buildMode':
        if (!gs) return;
        if (gs.buildMode) {
          BuildSystem.exitBuildMode(gs);
        } else {
          BuildSystem.enterBuildMode(gs);
        }
        break;

      case 'settings': {
        // 正确的多关顺序：先关已开的二级面板，全部关完再打开设置
        // 二级面板由各自订阅 UI_PANEL_CLOSE 自动 hide()
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
