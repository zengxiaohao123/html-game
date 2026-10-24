// src/ui/FuncBar.js
// 功能区：从右往左 8 图标
// Phase 1 只实现 ❌ 设置 和 🛌 睡觉 两个完整功能，其余 6 个 Toast 提示"即将推出"
// 位置：按 ui-main.png 偏右上角

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';
import { InputManager } from '../systems/InputManager.js';

export class FuncBar {
  /**
   * @param {GameDirector} director 游戏主导演
   */
  constructor(director) {
    this.director = director;
    this.root = null;
  }

  /**
   * 挂载功能区
   */
  mount(parent = qs('#app')) {
    // 8 个图标定义（从右到左的顺序）
    // 注意：CSS 里 direction: rtl 或者用 flex-direction: row-reverse 实现"从右往左"
    const icons = [
      { id: 'settings', emoji: Assets.ui.settings, label: '设置', action: 'openSettings' },
      { id: 'sleep',    emoji: Assets.ui.sleep,    label: '睡觉', action: 'sleep' },
      { id: 'role',     emoji: Assets.ui.role,     label: '角色', action: 'comingSoon' },
      { id: 'team',     emoji: Assets.ui.team,     label: '编队', action: 'comingSoon' },
      { id: 'forge',    emoji: Assets.ui.forge,    label: '合成', action: 'comingSoon' },
      { id: 'build',    emoji: Assets.ui.build,    label: '建造', action: 'comingSoon' },
      { id: 'inventory',emoji: Assets.ui.inventory,label: '背包', action: 'comingSoon' },
      { id: 'vehicle',  emoji: Assets.ui.vehicle,  label: '载具', action: 'comingSoon' },
    ];

    this.root = createEl('div', {
      class: ['func-bar'],
      style: {
        position: 'absolute',
        top: '8px',
        right: '12px',
        display: 'flex',
        flexDirection: 'row-reverse', // 从右往左排列（第一个在最右）
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        backgroundColor: 'rgba(255, 251, 230, 0.95)',
        border: '3px solid #3a3a3a',
        borderRadius: '14px',
        boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      },
      parent,
    });

    // 创建每个图标按钮
    icons.forEach(icon => this._createIconButton(icon));

    return this.root;
  }

  /**
   * 创建单个图标按钮
   */
  _createIconButton(icon) {
    const btn = createEl('button', {
      class: ['func-icon', `func-${icon.id}`],
      attrs: { title: icon.label, 'data-action': icon.action },
      style: {
        width: '42px',
        height: '42px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '22px',
        border: '2px solid #3a3a3a',
        borderRadius: '10px',
        backgroundColor: '#fff',
        cursor: 'pointer',
        transition: 'transform 0.1s, background-color 0.1s',
        padding: 0,
        lineHeight: '1',
        fontFamily: 'inherit',
      },
      onclick: () => this._handleAction(icon.action, icon.label),
      parent: this.root,
    });

    createEl('span', { text: icon.emoji }, btn);

    // hover 效果
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.1)';
      btn.style.backgroundColor = '#ffeaa7';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.backgroundColor = '#fff';
    });
  }

  /**
   * 处理图标点击动作
   */
  _handleAction(action, label) {
    switch (action) {
      case 'openSettings':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
        break;
      case 'sleep':
        if (this.director && this.director.sleep) {
          this.director.sleep();
        }
        break;
      case 'comingSoon':
        EventBus.emit(GE.TOAST_SHOW, { text: `${label}功能即将推出～`, duration: 1500 });
        break;
      default:
        break;
    }
  }
}

export default FuncBar;
