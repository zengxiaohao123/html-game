// src/ui/SpiritArea.js
// Phase 2B 扩展：点击 momo 触发 InfoPanel 切到祈福 tab（滑入 + 切 tab 3）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { createEl, qs } from './dom.js';

export class SpiritArea {
  constructor() {
    this.root = null;
  }

  mount(parent = qs('#app')) {
    this.root = createEl('div', {
      class: ['spirit-area'],
      style: {
        position: 'absolute',
        left: '15px',
        top: '150px',
        width: '60px',
        height: '60px',
        borderRadius: '50%',
        border: '3px solid #e8c547',
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        cursor: 'pointer',
        transition: 'transform 0.15s',
      },
      attrs: { title: 'momo（点击打开祈福面板）' },
      parent,
    });

    createEl('span', {
      text: '👻',
      style: {
        fontSize: '32px',
        lineHeight: '1',
        display: 'inline-block',
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif',
      },
      parent: this.root,
    });

    // hover 效果
    this.root.addEventListener('mouseenter', () => {
      this.root.style.transform = 'scale(1.08)';
    });
    this.root.addEventListener('mouseleave', () => {
      this.root.style.transform = 'scale(1)';
    });

    // 点击：让 InfoPanel 切到 tab 3（祈福 tab）
    this.root.addEventListener('click', () => {
      // 让 InfoPanel 定位到玩家所在 tile + 切到祈福 tab
      // 用 EventBus 解耦：InfoPanel 订阅以下两个事件
      const gs = window.__gameDirector?.getGS?.();
      const tileIdx = gs?.player?.x ?? 0;
      EventBus.emit(GE.TILE_CLICKED, { tileIdx });
      EventBus.emit('ui:infoShowBless', {});
    });

    return this.root;
  }
}

export default SpiritArea;
