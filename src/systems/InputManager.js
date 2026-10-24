// src/systems/InputManager.js
// 输入管理器：统一监听 window.keydown，路由到 GameDirector
// Phase 1 只处理 WASD（移动）、P（睡觉）、ESC（设置）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';

/**
 * 键盘 → 方向映射
 * 小写字母，因为用 event.key.toLowerCase() 统一处理
 */
const KEY_TO_DIRECTION = {
  'w': 'up',
  'a': 'left',
  's': 'down',
  'd': 'right',
};

/**
 * 键盘 → 动作映射
 */
const KEY_TO_ACTION = {
  'p': 'sleep',       // 睡觉
  'escape': 'settings', // 设置面板
};

export class InputManager {
  /**
   * @param {GameDirector} director 游戏主导演（暴露 move/sleep 方法）
   */
  constructor(director) {
    this.director = director;
    /** keydown 事件处理函数引用，供 off 时使用 */
    this._handler = null;
    /** 是否已绑定 */
    this._bound = false;
  }

  /**
   * 绑定键盘监听
   */
  bind() {
    if (this._bound) return;

    this._handler = (e) => {
      const key = (e.key || '').toLowerCase();

      // WASD 移动
      if (KEY_TO_DIRECTION[key]) {
        e.preventDefault();
        const direction = KEY_TO_DIRECTION[key];
        devLog.info('[InputManager] 方向键:', key, '→', direction);
        this.director.move(direction);
        return;
      }

      // 动作键
      if (KEY_TO_ACTION[key]) {
        e.preventDefault();
        const action = KEY_TO_ACTION[key];
        devLog.info('[InputManager] 动作键:', key, '→', action);
        this._dispatchAction(action);
        return;
      }
    };

    window.addEventListener('keydown', this._handler);
    this._bound = true;
    devLog.info('[InputManager] 键盘监听已绑定 (WASD / P / ESC)');
  }

  /**
   * 解绑键盘监听
   */
  unbind() {
    if (!this._bound || !this._handler) return;
    window.removeEventListener('keydown', this._handler);
    this._bound = false;
    this._handler = null;
    devLog.info('[InputManager] 键盘监听已解绑');
  }

  /**
   * 分发动作到 GameDirector 或 EventBus
   * @param {string} action
   */
  _dispatchAction(action) {
    switch (action) {
      case 'sleep':
        this.director.sleep();
        break;
      case 'settings':
        // 切换设置面板：打开时 emit UI_PANEL_OPEN('settings')，已打开时 emit UI_PANEL_CLOSE
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
        break;
      default:
        devLog.warn('[InputManager] 未知动作:', action);
    }
  }
}

export default InputManager;
