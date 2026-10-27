// src/ui/MainMenu.js
// 主菜单：启动时显示遮罩层，等玩家点"新的游戏"或"读取存档"才进游戏
// 同时 SettingsPanel 里点"返回主菜单"也会调用 show()

import { createEl, qs } from './dom.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';

export class MainMenu {
  /**
   * @param {GameDirector} director 游戏主导演
   */
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.visible = false;
  }

  show() {
    if (this.mask) {
      // 已存在，直接显示
      this.mask.style.display = 'flex';
      this.visible = true;
      return;
    }

    this.mask = createEl('div', {
      style: {
        position: 'fixed',
        inset: '0',
        background: 'linear-gradient(180deg, #87CEEB 0%, #B0E0E6 40%, #FFEFD5 100%)',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        fontFamily: '"LXGW WenKai TC", "Segoe UI", sans-serif',
      },
      parent: document.body,
    });

    // 标题
    createEl('div', {
      style: {
        fontSize: '56px',
        fontWeight: '900',
        color: '#3a2e20',
        textShadow: '2px 2px 0 #fffbe6, 4px 4px 0 rgba(0,0,0,0.1)',
        marginBottom: '10px',
        textAlign: 'center',
      },
      text: '🌾 转盘农场',
      parent: this.mask,
    });

    createEl('div', {
      style: {
        fontSize: '16px',
        color: '#5a4a3a',
        marginBottom: '10px',
        fontStyle: 'italic',
      },
      text: '轮转动画 · 策略经营 · 实时战斗',
      parent: this.mask,
    });

    // 按钮组
    const btnStyle = {
      padding: '14px 48px',
      fontSize: '18px',
      fontFamily: 'inherit',
      border: '3px solid #3a3a3a',
      borderRadius: '14px',
      backgroundColor: '#fffbe6',
      color: '#3a2e20',
      cursor: 'pointer',
      fontWeight: '700',
      boxShadow: '4px 4px 0 rgba(0,0,0,0.15)',
      transition: 'transform 0.08s, box-shadow 0.08s',
      minWidth: '240px',
    };

    createEl('button', {
      class: 'action-btn',
      style: btnStyle,
      text: '🎮 新的游戏',
      parent: this.mask,
      onclick: () => {
        this.hide();
        if (typeof this.director?.startNewGame === 'function') {
          this.director.startNewGame();
        } else {
          EventBus.emit(GE.TOAST_SHOW, { text: '🎮 开始新的游戏', duration: 1500 });
        }
      },
    });

    createEl('button', {
      class: 'action-btn',
      style: btnStyle,
      text: '📂 读取存档',
      parent: this.mask,
      onclick: () => {
        this.hide();
        // 打开 SettingsPanel 的存档槽（slot 1~8）
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
      },
    });

    createEl('button', {
      class: 'action-btn',
      style: btnStyle,
      text: '📖 图鉴',
      parent: this.mask,
      onclick: () => {
        this.hide();
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'codex' });
      },
    });

    createEl('div', {
      style: {
        position: 'absolute',
        bottom: '12px',
        fontSize: '11px',
        color: '#8a7a66',
      },
      text: 'v0.4 · 转盘农场项目组',
      parent: this.mask,
    });

    this.visible = true;
  }

  hide() {
    if (this.mask) {
      this.mask.style.display = 'none';
    }
    this.visible = false;
  }

  remove() {
    if (this.mask && this.mask.parentNode) {
      this.mask.parentNode.removeChild(this.mask);
    }
    this.mask = null;
    this.visible = false;
  }
}

export default MainMenu;
